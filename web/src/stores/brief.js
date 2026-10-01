/* 创作三步的前两步：创作简报 → 三个话题方向。第三步（成稿、编辑）的数据也从这里的 setDraft 进来。
 *
 * 三步各占一屏，一次只显示一张卡（以前三张堆着往下滚，到第三步时前两步还杵在上面）。
 * 简报参数默认跟账号设定走，只展示不可改；点「修改」才展开成表单。 */
import { defineStore } from 'pinia';
import { computed, reactive, ref } from 'vue';
import { api } from '../lib/api.js';
import { toast } from '../lib/feedback.js';
import { useStudioStore } from './studio.js';
import { useFrameworksStore } from './frameworks.js';
import { useHistoryStore } from './history.js';
import { useSectionsStore } from './sections.js';
import { useEditorStore } from './editor.js';
import { useVersionsStore } from './versions.js';
import { useReviewStore } from './review.js';
import { useSpeakStore } from './speak.js';

const emptyForm = () => ({ subject: '', platform: '', tone: '', audience: '', length: '', keywords: '' });

export const useBriefStore = defineStore('brief', () => {
  /* ---------- 步骤 ---------- */
  const stepDone = ref(false);       // 当前这一步算不算完成（第三步出完稿就是完成）

  /* 往回走随便走，往前只能走到已经有内容的那一步 */
  function reachable(n) {
    const d = useStudioStore().draft;
    if (n === 1) return true;
    if (n === 2) return Boolean(d?.topics?.length);
    return Boolean(d?.content);
  }

  function goStep(n, { done = false, scroll = true } = {}) {
    useStudioStore().step = n;
    stepDone.value = done;
    if (scroll) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* 步骤条上点：走过的、能到的才响应 */
  function clickStep(n) {
    const s = useStudioStore();
    if (!n || n === s.step || s.streaming || !reachable(n)) return;
    goStep(n, { done: n === 3 });
  }

  /* ---------- 表单 ---------- */
  const form = reactive(emptyForm());
  const locked = ref(false);         // 参数是否「跟账号走、只展示」
  const draftNote = ref(null);       // 打开旧稿时：这篇基于哪个账号（null = 按当前账号说）
  const hint = reactive({ text: '', error: false });
  const pendingHotspot = ref(null);  // 借势的热点，提交时一起带上
  const inputs = reactive({});       // 栏目要的素材：label → 文本
  const submitting = ref(false);
  const retopicking = ref(false);

  const platformInfo = (key) => useStudioStore().meta?.platforms?.find((p) => p.key === key) || null;

  /* 字数跟平台走：换平台就换成那个平台的常用篇幅 */
  function syncLength() {
    const p = platformInfo(form.platform);
    if (p) form.length = p.length;
  }

  /* 把账号设定填进表单，并回到「只展示」状态 */
  function applyPersonaDefaults() {
    const s = useStudioStore();
    const p = s.currentPersona;
    if (!form.platform) form.platform = s.meta?.platforms?.[0]?.key || '';
    if (!form.tone) form.tone = s.meta?.tones?.[0]?.key || '';
    if (p) {
      form.platform = p.platform;
      form.tone = p.tone;
      form.audience = p.audience || '';
    }
    syncLength();
    locked.value = Boolean(p);
  }

  function setHint(text, error = false) {
    hint.text = text;
    hint.error = error;
  }

  /* 栏目要的素材：必填的没填就别发请求，省一次调用 */
  const section = computed(() => {
    const s = useStudioStore();
    return s.sections.find((x) => x.id === s.sectionId) || null;
  });
  const collectInputs = () => {
    const out = {};
    for (const f of section.value?.fields || []) {
      const v = String(inputs[f.label] || '').trim();
      if (v) out[f.label] = v;
    }
    return Object.keys(out).length ? out : null;
  };
  const missingRequired = () => {
    const v = collectInputs() || {};
    return (section.value?.fields || []).filter((f) => f.required && !v[f.label]).map((f) => f.label);
  };

  function pickSection(id) {
    useStudioStore().sectionId = id;
    useFrameworksStore().applySectionDefault();
  }

  function clearInputs() {
    for (const k of Object.keys(inputs)) delete inputs[k];
  }

  async function submit() {
    const s = useStudioStore();
    if (submitting.value || s.streaming) return false;
    const body = { ...form, persona_id: s.personaId ?? '' };
    if (pendingHotspot.value) body.hotspot = pendingHotspot.value;
    if (s.sectionId) {
      const missing = missingRequired();
      if (missing.length) { setHint(`先补上：${missing.join('、')}`, true); return 'missing'; }
      body.section_id = s.sectionId;
      const got = collectInputs();
      if (got) body.inputs = got;
    }
    if (s.frameworkKey) body.framework = s.frameworkKey;
    const p = s.currentPersona;
    setHint(p ? `正在以「${p.name}」的定位拆解题材…` : '正在拆解题材，生成三个差异化方向…');
    submitting.value = true;
    try {
      const { draft } = await api('/drafts/topics', { method: 'POST', body });
      setHint('');
      setDraft(draft);
      useHistoryStore().load();
      reloadIdeas();
      return true;
    } catch (err) {
      setHint(err.message, true);
      return false;
    } finally {
      submitting.value = false;
    }
  }

  async function retopics() {
    const s = useStudioStore();
    if (!s.draft || retopicking.value) return;
    retopicking.value = true;
    try {
      const { draft } = await api(`/drafts/${s.draft.id}/topics`, { method: 'POST', body: {} });
      setDraft(draft);
    } catch (err) {
      toast(err.message);
    } finally {
      retopicking.value = false;
    }
  }

  /* 离开当前稿子之前：编辑中没存的先存掉（存的是这篇，不会写到下一篇上），成稿区各块回到初始状态 */
  function leaveDraft() {
    const s = useStudioStore();
    const ed = useEditorStore();
    if (s.dirty) ed.flushSave(true);
    ed.reset();
    useVersionsStore().reset();
    useReviewStore().reset();
    useSpeakStore().reset();
  }

  /* 打开一篇稿子（新出的方向、历史里点的、任务中心跳过来的）：直接落到它已经走到的那一步 */
  function setDraft(draft) {
    const s = useStudioStore();
    leaveDraft();
    s.revOpen = false;
    s.revId = null;
    s.revText = '';
    s.revisions = [];
    s.draft = draft;
    fillFrom(draft);
    if (draft.content) goStep(3, { done: true });
    else goStep(draft.topics?.length ? 2 : 1);
  }

  function fillFrom(d) {
    draftNote.value = d.persona ? { name: d.persona.name } : { name: '' };
    Object.assign(form, {
      subject: d.subject,
      platform: d.platform,
      tone: d.tone,
      audience: d.audience || d.persona?.audience || '',
      keywords: d.keywords || '',
      length: d.length,
    });
    const s = useStudioStore();
    s.sectionId = d.section_id ?? null;
    clearInputs();
    Object.assign(inputs, d.inputs || {});
    const fw = useFrameworksStore();
    s.frameworkKey = d.framework?.key || null;
    if (d.framework?.key) fw.chosen = d.framework;
    locked.value = true;
  }

  /* 回到空白简报（新建、换账号、删掉当前稿时） */
  function reset() {
    const s = useStudioStore();
    leaveDraft();
    s.draft = null;
    goStep(1);
    Object.assign(form, emptyForm());
    draftNote.value = null;
    pendingHotspot.value = null;
    setHint('');
    clearInputs();
    applyPersonaDefaults();
    useSectionsStore().load(s.personaId);
    reloadIdeas();
    loadPool();
  }

  /* 选定题材（可能挂着一条热点，一起带进创作） */
  function useSubject(subject, hotspot) {
    pendingHotspot.value = hotspot || null;
    form.subject = subject;
    focusSubject.value += 1;
  }
  const focusSubject = ref(0);      // 组件监听它把光标放进题材框（store 不碰 DOM）

  function clearHotspot() {
    pendingHotspot.value = null;
    toast('已取消借势，本篇按普通题材写');
  }

  /* ---------- 推荐题材 ---------- */
  /* 缓存里有就直接显示；空了就自动补一批。自动失败过的账号本次会话不再自动重试，避免没配密钥时反复打扰 */
  const ideas = reactive({ list: [], loading: false, message: '', error: false });

  async function reloadIdeas() {
    const s = useStudioStore();
    const persona = s.currentPersona;
    ideas.list = [];
    ideas.message = '';
    ideas.error = false;
    if (!persona) return;
    try {
      const { ideas: got } = await api(`/personas/${persona.id}/subjects`);
      if (s.personaId !== persona.id) return;
      if (got.length >= 3) { ideas.list = got; return; }
      if (s.ideaFailed.has(persona.id)) {
        // 补不满就先把有的显示出来，别让用户对着空白
        if (got.length) ideas.list = got;
        else ideas.message = '点「换一批」让 AI 想几个';
        return;
      }
      if (got.length) ideas.list = got;   // 先显示热点那几条，常规的在后面补进来
      await refreshIdeas({ auto: true });
    } catch (err) {
      ideas.message = err.message;
      ideas.error = true;
    }
  }

  async function refreshIdeas({ auto = false } = {}) {
    const s = useStudioStore();
    const persona = s.currentPersona;
    if (!persona || ideas.loading) return;
    ideas.loading = true;
    ideas.message = '';
    ideas.error = false;
    try {
      const { ideas: got } = await api(`/personas/${persona.id}/subjects`, { method: 'POST', body: {} });
      s.ideaFailed.delete(persona.id);
      if (s.personaId === persona.id) ideas.list = got;
    } catch (err) {
      if (auto) s.ideaFailed.add(persona.id);
      ideas.list = [];
      ideas.message = err.message;
      ideas.error = true;
    } finally {
      ideas.loading = false;
    }
  }

  /* ---------- 选题池：热点里看到的、推荐里想留的，不当场写也不丢。日期是「排到哪天」，空着就只是待选 ---------- */
  const pool = reactive({ list: [], open: false });

  async function loadPool() {
    const s = useStudioStore();
    try {
      pool.list = (await api(`/pool${s.personaId ? `?persona=${s.personaId}` : ''}`)).pool;
    } catch { pool.list = []; }
  }

  async function addPool(subject, source = '手动', note = '') {
    if (!String(subject || '').trim()) return false;
    try {
      await api('/pool', { method: 'POST', body: { subject, source, note, persona_id: useStudioStore().personaId } });
      pool.open = true;
      await loadPool();
      toast('已存进选题池');
      return true;
    } catch (err) { toast(err.message); return false; }
  }

  async function removePool(id) {
    try { await api(`/pool/${id}`, { method: 'DELETE' }); await loadPool(); } catch (err) { toast(err.message); }
  }

  async function datePool(id, date) {
    try { await api(`/pool/${id}`, { method: 'PUT', body: { plan_date: date } }); await loadPool(); } catch (err) { toast(err.message); }
  }

  /* 「写这条」= 把题材填进简报并标记为已用，不自动生成——生成要花钱，让人自己按 */
  async function writePool(x) {
    goStep(1);
    form.subject = x.subject;
    focusSubject.value += 1;
    try { await api(`/pool/${x.id}`, { method: 'PUT', body: { status: 'done' } }); await loadPool(); } catch { /* 标记失败不影响填入 */ }
  }

  return {
    stepDone, reachable, goStep, clickStep,
    form, locked, draftNote, hint, pendingHotspot, inputs, submitting, retopicking, section,
    syncLength, applyPersonaDefaults, setHint, pickSection, submit, retopics, setDraft, reset,
    useSubject, focusSubject, clearHotspot, missingRequired,
    ideas, reloadIdeas, refreshIdeas,
    pool, loadPool, addPool, removePool, datePool, writePool,
  };
});
