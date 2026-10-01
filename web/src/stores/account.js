/* 账号设定：侧栏的账号列表、账号设定页（基本设定 / 个人人设 / 素材库 / 语气样本）、快速建号。
 *
 * 切换账号 = 切换创作语境：简报的默认值、创作记录、推荐题材、热点比对都跟着换。
 * 刷新后停在原来的账号（记在 localStorage）：不记的话每次回来都跳回第一个，多账号的人还容易在错的账号下开始写。 */
import { defineStore } from 'pinia';
import { computed, reactive, ref } from 'vue';
import { api } from '../lib/api.js';
import { ask, toast } from '../lib/feedback.js';
import { useStudioStore } from './studio.js';
import { useBriefStore } from './brief.js';
import { useHistoryStore } from './history.js';
import { useSectionsStore } from './sections.js';

export const PERSONA_FIELDS = [
  'name', 'platform', 'tone', 'content_focus', 'audience', 'problem', 'notes',
  'creator_age', 'creator_gender', 'creator_industry', 'creator_role', 'creator_traits',
];

/* 账号设定的板块。needsSaved 的要先有账号才有意义——素材、样本都挂在账号 id 上 */
export const ACCOUNT_TABS = [
  { key: 'basic', label: '基本设定', hint: '这个号是谁、写给谁' },
  { key: 'persona', label: '个人人设', hint: '第一人称用谁的口吻' },
  { key: 'material', label: '素材库', hint: '你的真实经历与数据', needsSaved: true },
  { key: 'style', label: '语气样本', hint: '喂成稿学你的语感', needsSaved: true },
];

const PERSONA_KEY = 'lastPersona';

function remembered() {
  try { return localStorage.getItem(PERSONA_KEY); } catch { return null; }     // 隐私模式下读不了
}

function remember(id) {
  try { localStorage.setItem(PERSONA_KEY, id == null ? '' : String(id)); } catch { /* 隐私模式 */ }
}

/* 个人人设的一行摘要：32 岁 · 女 · 互联网 / 产品经理 */
export function creatorLine(p) {
  const age = String(p.creator_age || '').trim();
  const job = [p.creator_industry, p.creator_role].filter(Boolean).join(' / ');
  return [age ? (/^\d+$/.test(age) ? `${age} 岁` : age) : '', p.creator_gender, job].filter(Boolean).join(' · ');
}

const emptyForm = () => Object.fromEntries(PERSONA_FIELDS.map((k) => [k, '']));

export const useAccountStore = defineStore('account', () => {
  const summaryOpen = ref(false);      // 侧栏「展开完整设定」

  /* ---------- 账号列表 ---------- */
  async function loadPersonas(preferId) {
    const s = useStudioStore();
    const { personas } = await api('/personas');
    s.personas = personas;
    if (preferId !== undefined) s.personaId = preferId;
    else if (!personas.some((p) => p.id === s.personaId)) {
      const saved = remembered();
      // 空串是「全部创作」，和「没存过」要分开；存的账号可能已经被删了，删了就回落到第一个
      const hit = saved === '' ? null
        : saved != null && personas.some((p) => p.id === Number(saved)) ? Number(saved)
          : undefined;
      s.personaId = hit === undefined ? (personas[0]?.id ?? null) : hit;
    }
    remember(s.personaId);
  }

  function select(id) {
    const s = useStudioStore();
    if (s.streaming || id === s.personaId) return;
    s.personaId = id;
    remember(id);
    useBriefStore().reset();
    useHistoryStore().load();
  }

  /* ---------- 账号设定页 ---------- */
  const page = reactive({
    open: false,
    id: null,                 // 正在编辑的账号；null = 新建
    tab: 'basic',
    form: emptyForm(),
    quickFilled: new Set(),   // 快速建号帮忙填的字段（高亮提示「看一眼」，改过就去掉）
    hint: '',
    error: '',
    saving: false,
  });
  let pendingSamples = [];    // 快速建号带来的旧文章：账号保存成功后再存成语气样本

  const editingPersona = computed(() => useStudioStore().personas.find((p) => p.id === page.id) || null);

  function open(persona) {
    // 同一个账号来回开关记住停在哪个板块；换了账号就回到基本设定
    if (page.id !== (persona?.id ?? null)) page.tab = 'basic';
    page.id = persona?.id ?? null;
    Object.assign(page.form, emptyForm());      // 原地改：表单组件拿着的是这个对象
    if (persona) for (const k of PERSONA_FIELDS) page.form[k] = persona[k] ?? '';
    else {
      const meta = useStudioStore().meta;
      page.form.platform = meta?.platforms?.[0]?.key || '';
      page.form.tone = meta?.tones?.[0]?.key || '';
    }
    page.quickFilled = new Set();
    page.error = '';
    page.hint = persona ? '' : '先填名称并保存，才能设置素材库和语气样本';
    if (ACCOUNT_TABS.find((t) => t.key === page.tab)?.needsSaved && !page.id) page.tab = 'basic';
    page.open = true;
    pendingSamples = [];
    loadSamples(page.id);
    mat.editing = null;
    loadMaterials(page.id);
  }

  function editCurrent() {
    const p = useStudioStore().currentPersona;
    if (p) open(p);
  }

  function close() {
    page.open = false;
    pendingSamples = [];                 // 没保存就关掉：带来的旧文章作废，别挂到下一个新建的账号上
    useSectionsStore().load(useStudioStore().personaId);   // 栏目可能刚被增删，简报那边要跟上
  }

  async function save() {
    if (page.saving) return;
    page.error = '';
    const id = page.id;
    page.saving = true;
    try {
      const { persona } = await api(id ? `/personas/${id}` : '/personas', { method: id ? 'PUT' : 'POST', body: { ...page.form } });
      const s = useStudioStore();
      s.skipOnboard = false;
      page.quickFilled = new Set();
      if (!id) {
        // 新建之后留在页面上：素材库、样本都要有账号 id 才能设，这会儿关掉等于逼人再点开一次
        page.id = persona.id;
        page.hint = '已创建 —— 左边的素材库、语气样本现在可以设了';
        loadSamples(persona.id);
        loadMaterials(persona.id);
        await loadPersonas(persona.id);
        useBriefStore().reset();
        useHistoryStore().load();
        toast('账号已创建，之后的创作都会带上这份设定');
        await saveQuickSamples(persona.id);
        return;
      }
      page.open = false;
      await loadPersonas(persona.id);
      useBriefStore().reloadIdeas();
      useHistoryStore().load();
      useSectionsStore().load(s.personaId);
      toast('账号设定已更新');
    } catch (err) {
      page.error = err.message;
    } finally {
      page.saving = false;
    }
  }

  async function remove() {
    const p = editingPersona.value;
    if (!p) return;
    const n = p.draft_count || 0;
    if (!await ask.confirm({
      title: `删除账号「${p.name}」？`,
      body: n ? `其下 ${n} 条创作会保留在「全部创作」里。` : '',
      ok: '删除', danger: true,
    })) return;
    try {
      await api(`/personas/${p.id}`, { method: 'DELETE' });
    } catch (err) { toast(err.message); return; }
    page.open = false;
    await loadPersonas(undefined);
    useBriefStore().reset();
    useHistoryStore().load();
    toast('账号已删除');
  }

  /* ---------- 快速建号：贴一段自我介绍，模型把设定填好放进表单，人检查后再保存 ---------- */
  const quick = reactive({ open: false, intro: '', posts: '', error: '', running: false });

  async function runQuick() {
    if (quick.running) return;
    quick.error = '';
    quick.running = true;
    try {
      const { fields, samples, empty } = await api('/personas/quickstart', {
        method: 'POST', body: { intro: quick.intro, posts: quick.posts },
      });
      quick.open = false;
      // 设定页已经开着（从「新建账号」里点进来的）就直接填，不然先打开一个新的
      if (!page.open || page.id) open(null);
      const filled = new Set();
      for (const [k, v] of Object.entries(fields)) {
        if (!v || !(k in page.form)) continue;
        page.form[k] = v;
        filled.add(k);
      }
      page.quickFilled = filled;
      pendingSamples = samples || [];
      const blank = (empty || []).length;
      page.hint = `已按你的介绍填好${blank ? `，${blank} 项看不出来留空了` : ''}。检查一下再保存`
        + (pendingSamples.length ? `；保存后 ${pendingSamples.length} 篇旧文章会存成语气样本` : '');
      toast('填好了，改完点保存');
    } catch (err) {
      quick.error = err.message;
    } finally {
      quick.running = false;
    }
  }

  async function saveQuickSamples(personaId) {
    if (!pendingSamples.length) return;
    const list = pendingSamples;
    pendingSamples = [];
    page.hint = `正在把 ${list.length} 篇旧文章存成语气样本，顺便总结你的语气…`;
    try {
      const out = await api(`/personas/${personaId}/samples/batch`, { method: 'POST', body: { samples: list } });
      page.hint = `已创建，存了 ${out.added} 篇语气样本${out.skipped ? `（${out.skipped} 篇太短没存）` : ''}，语气档案也好了`;
      loadSamples(personaId);
      loadPersonas(useStudioStore().personaId);
    } catch (err) {
      page.hint = `账号已创建，但语气样本没存上：${err.message}。可以在「语气样本」里再加`;
    }
  }

  /* ---------- 语气样本 ---------- */
  const style = reactive({ samples: [], digest: '', error: '', loading: false });

  async function loadSamples(pid) {
    style.samples = [];
    style.digest = '';
    style.error = '';
    if (!pid) return;
    try {
      const { samples, digest } = await api(`/personas/${pid}/samples`);
      if (page.id !== pid) return;
      style.samples = samples;
      style.digest = digest || '';
    } catch (err) { style.error = err.message; }
  }

  async function deleteSample(sampleId) {
    if (!await ask.confirm({ title: '删除这篇样本？', body: '语气档案会用剩下的样本重新学一遍。', ok: '删除', danger: true })) return;
    try {
      const { samples, digest } = await api(`/personas/${page.id}/samples/${sampleId}`, { method: 'DELETE' });
      style.samples = samples;
      style.digest = digest || '';
      loadPersonas(useStudioStore().personaId);
    } catch (err) { toast(err.message); }
  }

  async function rebuildDigest() {
    try {
      const { digest } = await api(`/personas/${page.id}/digest`, { method: 'POST', body: {} });
      const { samples } = await api(`/personas/${page.id}/samples`);
      style.samples = samples;
      style.digest = digest || '';
      loadPersonas(useStudioStore().personaId);
      toast('语气档案已重新学习');
    } catch (err) { toast(err.message); }
  }

  /* 把成稿喂给账号学语气（成稿页「确认 → 喂给账号学习」） */
  async function learn(draft, { beforeSave } = {}) {
    if (!draft?.content?.trim()) return;
    if (!draft.persona_id) { toast('这篇没有绑定账号，先在侧栏选一个账号再创作'); return; }
    const s = useStudioStore();
    const persona = s.personas.find((p) => p.id === draft.persona_id);
    const name = persona?.name || draft.persona?.name || '该账号';
    if (!await ask.confirm({
      title: `把这篇喂给账号「${name}」学语气？`,
      body: '之后这个号的选题和成稿都会模仿它的语感。可以随时在账号设定里删掉样本。',
      ok: '喂进去',
    })) return;
    if (beforeSave) await beforeSave();
    try {
      const { digest } = await api(`/personas/${draft.persona_id}/samples`, { method: 'POST', body: { draft_id: draft.id } });
      await loadPersonas(s.personaId);
      toast(digest ? '学好了，语气档案已更新' : '已加入样本');
    } catch (err) { toast(err.message); }
  }

  /* ---------- 素材库：作者的真实经历、数据、案例，写作时按题材召回 ---------- */
  const mat = reactive({ list: [], kinds: [], editing: null, edit: null, error: '' });

  async function loadMaterials(pid) {
    if (!pid) { mat.list = []; return; }
    try {
      const { materials, kinds } = await api(`/personas/${pid}/materials`);
      if (page.id !== pid) return;
      mat.list = materials;
      mat.kinds = kinds;
    } catch { mat.list = []; }
  }

  async function addMaterial(body) {
    mat.error = '';
    if (!body.title || !body.body) { mat.error = '标题和内容都要填'; return false; }
    try {
      await api(`/personas/${page.id}/materials`, { method: 'POST', body });
      await loadMaterials(page.id);
      toast('已存进素材库');
      return true;
    } catch (err) { mat.error = err.message; return false; }
  }

  function startEditMaterial(m) {
    mat.editing = m.id;
    mat.edit = { kind: m.kind, title: m.title, body: m.body, tags: m.tags || '' };
  }

  async function saveMaterial(id) {
    const e = mat.edit;
    try {
      await api(`/materials/${id}`, { method: 'PUT', body: { kind: e.kind, title: e.title.trim(), body: e.body.trim(), tags: e.tags.trim() } });
      mat.editing = null;
      await loadMaterials(page.id);
      toast('已更新');
    } catch (err) { toast(err.message); }
  }

  async function deleteMaterial(m) {
    if (!await ask.confirm({ title: `删掉素材「${m.title}」？`, ok: '删除', danger: true })) return;
    try {
      await api(`/materials/${m.id}`, { method: 'DELETE' });
      await loadMaterials(page.id);
    } catch (err) { toast(err.message); }
  }

  return {
    summaryOpen, loadPersonas, select,
    page, editingPersona, open, editCurrent, close, save, remove,
    quick, runQuick,
    style, loadSamples, deleteSample, rebuildDigest, learn,
    mat, loadMaterials, addMaterial, startEditMaterial, saveMaterial, deleteMaterial,
  };
});
