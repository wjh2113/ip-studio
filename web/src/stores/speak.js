/* 口播：口播提示（语气 / 重读 / 停顿 / 表情 / 动作，单独一层，正文保持干净）、口播记录与评测、提词器。
 *
 * 上传录音（或在提词器里直接录）→ 后台任务转写并总评 → 留档。改稿不会清掉这些记录。
 * 语音测评、视频测评要点开某一遍再做（也是后台任务，刷新页面不丢）。
 * 顶栏「口播」一级页：待练列表 + 全部评测记录（含音视频回看）。 */
import { defineStore } from 'pinia';
import { computed, reactive, ref, watch } from 'vue';
import { api, upload } from '../lib/api.js';
import { on } from '../lib/bus.js';
import { ask, toast } from '../lib/feedback.js';
import { useStudioStore } from './studio.js';
import { useJobsStore } from './jobs.js';
import { useBriefStore } from './brief.js';
import { useEditorStore } from './editor.js';
import { sceneNotes } from '../lib/scenes.js';

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

  /* 口播有几版：原文一版；多平台里每个视频平台的版本（视频号、抖音、B 站）各一版，口播提示存在那个版本上。
     原文是给人看的文章（公众号、知乎、小红书、微博）而还没出视频号版本时，也先挂一个「视频号口播版」，
     点生成会先改写出视频号版本。version '' = 原文 */
  const VIDEO = ['douyin', 'shipinhao', 'bilibili'];
  const TRACK_LABEL = { shipinhao: '视频号口播版', douyin: '抖音口播版', bilibili: 'B 站口播版' };
  const TRACK_HINT = {
    shipinhao: '视频号版本：1～3 分钟、能直接念的脚本（事实不变）',
    douyin: '抖音版本：开头 3 秒抓人、短句快节奏的口播脚本',
    bilibili: 'B 站版本：信息密度高一些、可以讲得更完整',
  };
  const version = ref('');
  const tracks = computed(() => {
    const d = s().draft;
    if (!d) return [];
    const label = s().platformLabel(d.platform);
    const isVideo = VIDEO.includes(d.platform);
    const list = [{ key: '', label: isVideo ? `${label}口播` : `${label}朗读版`, hint: isVideo ? '照着原文念' : '原样念这篇文章，配朗读音频或念全文的视频', cues: d.cues || null, exists: true }];
    for (const k of ['shipinhao', 'douyin', 'bilibili']) {
      if (k === d.platform) continue;
      const v = d.variants?.[k];
      const exists = Boolean(v?.content);
      if (!exists && !(k === 'shipinhao' && !isVideo)) continue;
      list.push({ key: k, label: TRACK_LABEL[k], hint: exists ? TRACK_HINT[k] : '先改写成 1～3 分钟、能直接念的视频号脚本（事实不变），再标口播', cues: v?.cues || null, exists });
    }
    return list;
  });
  /* 某个版本能不能做口播（原文总能；平台版本要是视频平台） */
  const hasTrack = (key) => tracks.value.some((t) => t.key === (key || ''));
  const track = computed(() => tracks.value.find((t) => t.key === version.value) || tracks.value[0] || null);
  const cues = computed(() => track.value?.cues || null);
  /* 这一版要念的稿子 */
  const trackText = computed(() => {
    const d = s().draft;
    if (!d) return '';
    return version.value ? String(d.variants?.[version.value]?.content || '') : String(d.content || '');
  });
  watch(() => s().draft?.id, () => { version.value = ''; });

  /* 【画面】【字幕】这类拍摄标注：挂到后面那一段口播上，口播区、提词器、复制口播稿都显示 */
  const scenes = computed(() => sceneNotes(trackText.value, cues.value?.cues));

  function putTrackCues(draft, ver, got) {
    if (!ver) { draft.cues = got; return; }
    const variants = { ...(draft.variants || {}) };
    variants[ver] = { ...(variants[ver] || {}), cues: got };
    draft.variants = variants;
  }

  async function runCues(ver = version.value) {
    const st = s();
    const draft = st.draft;
    if (!draft?.content?.trim()) { toast('还没有正文'); return; }
    if (cuesRunning.value) return;
    await useEditorStore().flushSave();
    cuesRunning.value = true;
    cuesError.value = '';
    try {
      // 视频号口播版：还没有视频号版本就先改写出来（和「多平台」出的是同一个版本）
      if (ver && !draft.variants?.[ver]?.content) {
        const { platform, variant } = await api(`/drafts/${draft.id}/variants`, { method: 'POST', body: { platform: ver } });
        if (st.draft?.id !== draft.id) return;
        draft.variants = { ...(draft.variants || {}), [platform]: variant };
      }
      const { cues: got } = await api(`/drafts/${draft.id}/cues`, { method: 'POST', body: { version: ver } });
      if (st.draft?.id === draft.id) putTrackCues(st.draft, ver, got);
    } catch (err) {
      cuesError.value = err.message;
    } finally {
      cuesRunning.value = false;
    }
  }

  /* 改口播：改某一段的语气、重读、停顿、表情、动作，或者改这一段要念的词。
     改词 = 改这一版的稿子（原文就是改正文，留一版历史）；其他段的提示不动 */
  const cueSaving = ref(false);
  async function saveCue(index, patch) {
    const st = s();
    const draft = st.draft;
    const c = cues.value;
    if (!draft || !c?.cues?.[index] || cueSaving.value) return false;
    const old = c.cues[index];
    let text = trackText.value;
    const quote = String(patch.quote ?? old.quote);
    if (!quote.trim()) { toast('这一段的词不能是空的'); return false; }
    if (quote !== old.quote) {
      // 在这一段原来的位置换词：从前一段之后开始找，免得换到别处同样的句子
      let from = 0;
      for (let i = 0; i < index; i += 1) {
        const at = text.indexOf(c.cues[i].quote, from);
        if (at >= 0) from = at + c.cues[i].quote.length;
      }
      const at = text.indexOf(old.quote, from) >= 0 ? text.indexOf(old.quote, from) : text.indexOf(old.quote);
      if (at < 0) { toast('这一段在稿子里找不到了，刷新后再改'); return false; }
      text = text.slice(0, at) + quote + text.slice(at + old.quote.length);
    }
    const stress = (Array.isArray(patch.stress) ? patch.stress : String(patch.stress ?? old.stress.join('、')).split(/[、,，\s]+/))
      .map((w) => w.trim()).filter((w) => w && quote.includes(w));
    const list = c.cues.map((x, i) => (i === index ? { ...x, ...patch, quote, stress } : x));
    if (useEditorStore().save.kind === 'dirty' && !version.value) await useEditorStore().flushSave();
    cueSaving.value = true;
    try {
      const out = await api(`/drafts/${draft.id}/cues`, { method: 'PUT', body: { version: version.value, cues: list, text } });
      if (st.draft?.id !== draft.id) return false;
      if (!version.value) {
        st.draft = out.draft;
      } else {
        putTrackCues(st.draft, version.value, out.cues);
        st.draft.variants[version.value].content = text;
      }
      toast(quote !== old.quote ? '已改，口播稿跟着改了' : '已保存');
      return true;
    } catch (err) {
      toast(err.message);
      return false;
    } finally {
      cueSaving.value = false;
    }
  }

  async function saveOverall(overall) {
    const st = s();
    const draft = st.draft;
    const c = cues.value;
    if (!draft || !c) return false;
    try {
      const out = await api(`/drafts/${draft.id}/cues`, { method: 'PUT', body: { version: version.value, cues: c.cues, overall } });
      if (st.draft?.id === draft.id) putTrackCues(st.draft, version.value, out.cues);
      toast('已保存');
      return true;
    } catch (err) { toast(err.message); return false; }
  }

  /* 导出成可以直接照着念的稿子 */
  async function copyCues() {
    const c = cues.value;
    if (!c) return;
    const o = c.overall || {};
    const head = [`【整体基调】${o.tone || '—'}`, `【语速节奏】${o.pace || '—'}`, o.note ? `【出镜提醒】${o.note}` : null]
      .filter(Boolean).join('\n');
    const sc = scenes.value;
    const hasScene = sc.tail.length > 0 || sc.before.some((a) => a.length);
    const sceneLines = (arr) => arr.map((y) => `【${y.tag}】${y.text}\n`).join('');
    const body = c.cues.map((x, i) => {
      const marks = [
        x.emotion ? `语气：${x.emotion}` : null,
        x.stress?.length ? `重读：${x.stress.join('、')}` : null,
        x.pause ? `停顿：${x.pause}` : null,
        x.expression ? `表情：${x.expression}` : null,
        x.gesture ? `动作：${x.gesture}` : null,
      ].filter(Boolean).join('　');
      return `${sceneLines(sc.before[i] || [])}${hasScene ? '【口播】' : ''}${x.quote}${marks ? `\n（${marks}）` : ''}`;
    }).join('\n\n') + (sc.tail.length ? `\n\n${sceneLines(sc.tail).trimEnd()}` : '');
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
      const ver = version.value ? `&version=${encodeURIComponent(version.value)}` : '';
      const data = await upload(`/drafts/${st.draft.id}/speaks?async=1${ver}`, blob, filename);
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
    cues, cuesRunning, cuesError, runCues, copyCues, version, tracks, track, trackText, hasTrack, scenes, saveCue, saveOverall, cueSaving,
    list, history, orphan, uploading, loadDraftSpeaks, loadHistory, submitTake,
    isChecking, runCheck, retry, retrying, remove, toggleOpen, openRecord, reset,
    pageTab, todo, readyCues, detail, pageLoading, pageError, q, loadPage, selectSpeak, practiceDraft,
  };
});
