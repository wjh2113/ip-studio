/* 口播：口播提示（语气 / 重读 / 停顿 / 表情 / 动作，单独一层，正文保持干净）、口播记录与评测、提词器。
 *
 * 上传录音（或在提词器里直接录）→ 后台任务转写并总评 → 留档。改稿不会清掉这些记录。
 * 语音测评、视频测评要点开某一遍再做（也是后台任务，刷新页面不丢）。
 * 顶栏「口播」一级页：待练列表 + 全部评测记录（含音视频回看）。 */
import { defineStore } from 'pinia';
import { computed, reactive, ref } from 'vue';
import { api, upload } from '../lib/api.js';
import { on } from '../lib/bus.js';
import { ask, toast } from '../lib/feedback.js';
import { useStudioStore } from './studio.js';
import { useJobsStore } from './jobs.js';
import { useBriefStore } from './brief.js';
import { useEditorStore } from './editor.js';

export const MAX_TAKE = 24 * 1024 * 1024;

/* 纯音频没有画面：视频测评按钮置灰（网关对纯音频也会回 400） */
export const audioOnly = (x) => /^audio\//i.test(x.mime || '') || (!x.mime && /\.(mp3|wav|m4a|ogg|aac)$/i.test(x.audio || ''));

/* 一遍口播的一行说明 */
export const speakLine = (x) => (x.draftGone ? '稿子已不在' : (x.stale ? '当时的稿子' : (x.next || x.error || '总评')));

export const useSpeakStore = defineStore('speak', () => {
  const s = () => useStudioStore();

  /* ---------- 口播提示 ---------- */
  const cuesRunning = ref(false);
  const cuesError = ref('');
  const cues = computed(() => s().draft?.cues || null);

  async function runCues() {
    const st = s();
    const draft = st.draft;
    if (!draft?.content?.trim()) { toast('还没有正文'); return; }
    if (cuesRunning.value) return;
    await useEditorStore().flushSave();
    cuesRunning.value = true;
    cuesError.value = '';
    try {
      const { cues: got } = await api(`/drafts/${draft.id}/cues`, { method: 'POST', body: {} });
      if (st.draft?.id === draft.id) st.draft.cues = got;
    } catch (err) {
      cuesError.value = err.message;
    } finally {
      cuesRunning.value = false;
    }
  }

  /* 导出成可以直接照着念的稿子 */
  async function copyCues() {
    const c = cues.value;
    if (!c) return;
    const o = c.overall || {};
    const head = [`【整体基调】${o.tone || '—'}`, `【语速节奏】${o.pace || '—'}`, o.note ? `【出镜提醒】${o.note}` : null]
      .filter(Boolean).join('\n');
    const body = c.cues.map((x) => {
      const marks = [
        x.emotion ? `语气：${x.emotion}` : null,
        x.stress?.length ? `重读：${x.stress.join('、')}` : null,
        x.pause ? `停顿：${x.pause}` : null,
        x.expression ? `表情：${x.expression}` : null,
        x.gesture ? `动作：${x.gesture}` : null,
      ].filter(Boolean).join('　');
      return `${x.quote}\n（${marks}）`;
    }).join('\n\n');
    try {
      await navigator.clipboard.writeText(`${head}\n\n${'—'.repeat(20)}\n\n${body}\n`);
      toast('口播稿已复制');
    } catch {
      toast('复制失败，请手动选中');
    }
  }

  /* ---------- 这篇的口播记录 ---------- */
  const list = ref([]);              // 当前稿子的口播记录
  const history = ref([]);           // 侧栏「口播」筛选 / 口播页的全部记录
  const orphan = ref(null);          // 稿子已经不在的那一遍：在侧栏那条下面展开它的总评
  const uploading = ref(false);
  const checking = reactive(new Set());   // `${id}:voice` / `${id}:video`
  const retrying = reactive(new Set());

  /* ---------- 顶栏口播页 ---------- */
  const pageTab = ref('records');    // practice | records
  const todo = ref([]);              // 有提示、还没合格录音的稿子
  const readyCues = ref([]);         // 成稿且已有口播提示，可再练
  const detail = ref(null);          // 当前展开的一遍（完整：review + audio）
  const pageLoading = ref(false);
  const pageError = ref('');
  const q = ref('');

  function personaQuery() {
    const st = s();
    if (st.personaId == null) return '';
    return `?persona=${st.personaId}`;
  }

  async function loadDraftSpeaks() {
    const st = s();
    if (!st.draft || st.mode !== 'cue') return;
    const id = st.draft.id;
    try {
      const { speaks } = await api(`/drafts/${id}/speaks`);
      // 响应体读坏了（连接中途断开）时 api() 会给空对象：别把列表弄成 undefined
      if (st.draft?.id === id) list.value = Array.isArray(speaks) ? speaks : [];
    } catch (err) { toast(err.message); }
  }

  async function loadHistory() {
    try {
      const { speaks } = await api('/speaks');
      history.value = Array.isArray(speaks) ? speaks : [];
      s().speakCount = history.value.length;
    } catch { /* 未登录时静默 */ }
  }

  async function loadPage() {
    pageLoading.value = true;
    pageError.value = '';
    try {
      const [today, speaksRes] = await Promise.all([
        api(`/today${personaQuery()}`),
        api('/speaks'),
      ]);
      todo.value = today.speakTodo || [];
      readyCues.value = (today.ready || []).filter((x) => x.hasCues);
      history.value = Array.isArray(speaksRes.speaks) ? speaksRes.speaks : [];
      s().speakCount = history.value.length;
      if (detail.value && !history.value.some((x) => x.id === detail.value.id)) detail.value = null;
      else if (detail.value) {
        // 任务刚跑完：用列表摘要刷新分数，完整总评再拉一次
        const hit = history.value.find((x) => x.id === detail.value.id);
        if (hit && (hit.score !== detail.value.score || hit.status !== detail.value.status)) {
          await selectSpeak(hit.id, { silent: true });
        }
      }
    } catch (err) {
      pageError.value = err.message;
    } finally {
      pageLoading.value = false;
    }
  }

  function refreshLists() {
    const st = s();
    if (st.draft && st.mode === 'cue') loadDraftSpeaks();
    if (st.historyMode === 'speaks') loadHistory();
    if (st.view === 'speak') loadPage();
  }

  function replace(speak) {
    s().focusSpeakId = speak.id;
    list.value = list.value.some((x) => x.id === speak.id)
      ? list.value.map((x) => (x.id === speak.id ? speak : x))
      : [speak, ...list.value];
    if (orphan.value?.id === speak.id) orphan.value = speak;
    if (detail.value?.id === speak.id) detail.value = speak;
    history.value = history.value.some((x) => x.id === speak.id)
      ? history.value.map((x) => (x.id === speak.id ? { ...x, score: speak.score, status: speak.status, next: speak.next, error: speak.error, mime: speak.mime, audio: speak.audio } : x))
      : history.value;
  }

  /* 上传一遍（文件或提词器里录的），转写和总评在后台做 */
  async function submitTake(blob, filename) {
    const st = s();
    if (!st.draft) return false;
    if (blob.size > MAX_TAKE) { toast('录音请小于 24MB'); return false; }
    uploading.value = true;
    try {
      const data = await upload(`/drafts/${st.draft.id}/speaks?async=1`, blob, filename);
      st.focusSpeakId = data.speak?.id || null;
      if (data.job) useJobsStore().track(data.job);
      if (st.mode !== 'cue') useEditorStore().setMode('cue');
      else await loadDraftSpeaks();
      if (st.historyMode === 'speaks' || st.view === 'speak') loadHistory();
      if (st.view === 'speak') loadPage();
      toast('录音已上传，正在转写和总评。可以先去做别的，好了会提示');
      return true;
    } catch (err) {
      toast(err.message);
      return false;
    } finally {
      uploading.value = false;
    }
  }

  /* 语音 / 视频测评按钮：任务在跑时显示「测评中…」，刷新页面后也一样 */
  function isChecking(id, kind) {
    if (checking.has(`${id}:${kind}`)) return true;
    return Boolean(useJobsStore().active(kind === 'voice' ? 'pronounce' : 'appearance', (p) => p.speakId === id));
  }

  async function runCheck(id, kind) {
    const tag = `${id}:${kind}`;
    if (checking.has(tag)) return;
    checking.add(tag);
    try {
      const jobs = useJobsStore();
      const { job } = await jobs.start(kind === 'video' ? `/speaks/${id}/appearance` : `/speaks/${id}/pronounce`);
      await jobs.wait(job);
      const { speak } = await api(`/speaks/${id}`);
      replace(speak);
      toast(kind === 'video' ? '视频测评好了' : '语音测评好了');
    } catch (err) {
      toast(err.message);
    } finally {
      checking.delete(tag);
    }
  }

  async function retry(id) {
    if (retrying.has(id)) return;
    retrying.add(id);
    try {
      const { speak } = await useJobsStore().start(`/speaks/${id}/retry`);
      s().focusSpeakId = speak.id;
      await loadDraftSpeaks();
      if (s().historyMode === 'speaks' || s().view === 'speak') loadHistory();
      if (s().view === 'speak') await selectSpeak(id, { silent: true });
    } catch (err) { toast(err.message); } finally { retrying.delete(id); }
  }

  async function remove(id) {
    if (!await ask.confirm({ title: '删除这一遍口播记录？', body: '录音和总评会一起去掉。', ok: '删除', danger: true })) return;
    try {
      await api(`/speaks/${id}`, { method: 'DELETE' });
      const st = s();
      if (st.focusSpeakId === id) st.focusSpeakId = null;
      if (orphan.value?.id === id) orphan.value = null;
      if (detail.value?.id === id) detail.value = null;
      toast('已删除这遍口播');
      await loadDraftSpeaks();
      loadHistory();
      if (st.view === 'speak') loadPage();
    } catch (err) { toast(err.message); }
  }

  function toggleOpen(id) {
    const st = s();
    st.focusSpeakId = st.focusSpeakId === id ? null : id;
  }

  /* 从侧栏或任务中心打开一遍：稿子还在就切到那篇的口播模式；不在了就在侧栏那条下面展开当时的总评 */
  async function openRecord(id) {
    const st = s();
    if (st.streaming) return;
    let speak;
    try {
      speak = (await api(`/speaks/${id}`)).speak;
    } catch (err) { toast(err.message); return; }
    st.focusSpeakId = id;
    if (!speak.draftId || speak.draftGone) {
      orphan.value = speak;
      if (st.view === 'speak') {
        detail.value = speak;
        pageTab.value = 'records';
      }
      toast(speak.draftGone ? '稿子已经不在了，这是当时的总评' : '这遍口播还在');
      return;
    }
    orphan.value = null;
    if (st.view === 'speak') {
      detail.value = speak;
      pageTab.value = 'records';
      return;
    }
    if (st.draft?.id !== speak.draftId) {
      const { draft } = await api(`/drafts/${speak.draftId}`);
      useBriefStore().setDraft(draft);
    }
    if (st.mode !== 'cue') useEditorStore().setMode('cue');
    else loadDraftSpeaks();
  }

  /* 口播页点开一条记录：拉完整总评 + 音视频地址 */
  async function selectSpeak(id, { silent = false } = {}) {
    try {
      const { speak } = await api(`/speaks/${id}`);
      detail.value = speak;
      s().focusSpeakId = id;
      pageTab.value = 'records';
    } catch (err) {
      if (!silent) toast(err.message);
    }
  }

  /* 选一篇成稿去练：切到创作 · 口播模式（提词器、上传都在那儿） */
  async function practiceDraft(draftId) {
    const st = s();
    if (st.streaming) { toast('正在出稿，先等这一轮结束'); return; }
    try {
      const { draft } = await api(`/drafts/${draftId}`);
      useBriefStore().setDraft(draft);
      st.view = 'write';
      useEditorStore().setMode('cue');
      if (!draft.cues?.cues?.length) {
        toast('这篇还没有口播提示，正在生成…');
        await runCues();
      } else {
        toast('已打开口播区，可以提词或上传音视频');
      }
    } catch (err) {
      toast(err.message);
    }
  }

  function reset() {
    list.value = [];
    cuesError.value = '';
  }

  // 后台任务做完：转写总评或测评好了，刷新口播记录（发起的人可能已经切走了，这里兜底）
  on('job-done', (job) => {
    if (['speak', 'pronounce', 'appearance'].includes(job.kind)) refreshLists();
  });

  return {
    cues, cuesRunning, cuesError, runCues, copyCues,
    list, history, orphan, uploading, loadDraftSpeaks, loadHistory, submitTake,
    isChecking, runCheck, retry, retrying, remove, toggleOpen, openRecord, reset,
    pageTab, todo, readyCues, detail, pageLoading, pageError, q, loadPage, selectSpeak, practiceDraft,
  };
});
