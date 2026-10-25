/* 我的技能：常用的改稿要求做成一整页（名字、描述、标签、正文、参考资料），像 Notion 的技能。
 *   技能菜单（对话框里）：搜索、点一个就用、右上角进技能库或新建   list / load
 *   技能页：整页编辑，正文写长篇要求，参考资料从素材库挑或贴范文   page / openPage / savePage
 *   技能库：全部技能，按标签筛、搜索、复制、删除   lib
 *   用：划词菜单里对选中那段（走划词改写 action=skill）；对话里一键发（带 skillId）。
 *       服务端把整个技能（正文 + 参考资料）作为一块「技能说明」交给模型 */
import { defineStore } from 'pinia';
import { computed, reactive, ref } from 'vue';
import { api } from '../lib/api.js';
import { ask, toast } from '../lib/feedback.js';
import { useEditorStore } from './editor.js';

/* 新建时可以从模板开始 */
export const SKILL_TEMPLATES = [
  { key: 'platform', name: '平台口吻', description: '把一段改成某个平台的写法', tags: ['平台'],
    instruction: '## 要改成什么样\n- 平台：小红书\n- 口吻：像朋友聊天，短句，多分段\n- 开头：一句话戳中痛点或给出反常识结论\n- 结尾：一句行动建议 + 3 个话题标签\n\n## 不要\n- 不要堆形容词和感叹号\n- 不要改动事实、数字和我的经历' },
  { key: 'hook', name: '加钩子', description: '开头抓人，让人想往下看', tags: ['开头'],
    instruction: '给这段（或全文）开头加一个钩子，三选一，挑最合适的：\n1. 反常识结论\n2. 具体场景（时间、地点、人、动作）\n3. 直接点出读者的痛点\n\n钩子控制在两行以内，后面自然接上原文，原文其余部分不动。' },
  { key: 'list', name: '改成清单', description: '把大段说明拆成能照做的步骤', tags: ['结构'],
    instruction: '把这段改成可以照着做的清单：\n- 每条以动词开头\n- 每条一句话，必要时补一句为什么\n- 顺序按实际操作先后\n- 原文里的数字、条件全部保留' },
  { key: 'example', name: '正反例子', description: '用好坏对比把道理讲透', tags: ['举例'],
    instruction: '在这段后面补一组「反例 → 正例」的对比：\n- 反例：常见的错误做法，一两句\n- 正例：按这段的道理怎么做，一两句\n- 例子要具体，有场景；不编造数据、机构和他人引语' },
];

const blank = () => ({ name: '', description: '', tags: [], instruction: '', refs: [], inReview: false });

export const useSkillsStore = defineStore('skills', () => {
  const list = ref([]);          // 列表：不带正文
  const max = ref(30);
  const me = ref('');
  const loaded = ref(false);

  async function load(force = false) {
    if (loaded.value && !force) return;
    try {
      const data = await api('/skills');
      list.value = data.skills;
      max.value = data.max;
      me.value = data.me || '';
      loaded.value = true;
    } catch (err) { toast(err.message); }
  }

  /* 搜名字、描述、标签 */
  function search(q) {
    const k = String(q || '').trim().toLowerCase();
    if (!k) return list.value;
    return list.value.filter((x) => [x.name, x.description, ...(x.tags || [])].some((t) => String(t || '').toLowerCase().includes(k)));
  }
  const allTags = computed(() => [...new Set(list.value.flatMap((x) => x.tags || []))]);
  /* 打开了「检查时也参考」的技能：成稿检查会带上（服务端最多带 3 个）。stamp 给检查判断「设置变没变」 */
  const inReview = computed(() => list.value.filter((x) => x.inReview));
  const reviewStamp = computed(() => inReview.value.map((x) => `${x.id}:${x.updated_at}`).join(','));

  /* ---------- 技能页：整页编辑 ---------- */
  const page = reactive({ open: false, id: null, draft: blank(), saved: '', saving: false, loading: false, created_at: '', updated_at: '' });
  const dirty = computed(() => page.open && JSON.stringify(page.draft) !== page.saved);

  function fill(s) {
    page.id = s?.id ?? null;
    page.draft = { name: s?.name || '', description: s?.description || '', tags: [...(s?.tags || [])], instruction: s?.instruction || '', refs: (s?.refs || []).map((r) => ({ ...r })), inReview: Boolean(s?.inReview) };
    page.saved = JSON.stringify(page.draft);
    page.created_at = s?.created_at || '';
    page.updated_at = s?.updated_at || '';
  }

  /* id = null 新建；preset 预填（模板、对话里「存成技能」） */
  async function openPage(id = null, preset = null) {
    if (id == null && list.value.length >= max.value) { toast(`技能最多存 ${max.value} 个，删掉不用的再加`); return; }
    page.open = true;
    if (id == null) {
      fill(null);
      if (preset) Object.assign(page.draft, { ...blank(), ...preset, tags: [...(preset.tags || [])], refs: [] });
      if (preset) page.saved = JSON.stringify(blank());       // 预填的内容也算没存
      return;
    }
    page.loading = true;
    try {
      const { skill } = await api(`/skills/${id}`);
      fill(skill);
    } catch (err) { toast(err.message); page.open = false; } finally { page.loading = false; }
  }

  async function closePage() {
    if (dirty.value && !(await ask.confirm({ title: '还没保存，确定离开？', body: '离开后这次的改动会丢掉。', ok: '不保存，离开', danger: true }))) return false;
    page.open = false;
    return true;
  }

  async function savePage() {
    if (page.saving) return false;
    page.saving = true;
    try {
      const body = { ...page.draft, refs: page.draft.refs.map((r) => (r.type === 'material' ? { type: 'material', id: r.id } : { type: 'text', title: r.title, text: r.text })) };
      const { skill } = page.id
        ? await api(`/skills/${page.id}`, { method: 'PUT', body })
        : await api('/skills', { method: 'POST', body });
      const isNew = !page.id;
      fill(skill);
      await load(true);
      toast(isNew ? `已建好技能「${skill.name}」` : '已保存');
      return true;
    } catch (err) { toast(err.message); return false; } finally { page.saving = false; }
  }

  async function copy(id) {
    try {
      const { skill } = await api(`/skills/${id}/copy`, { method: 'POST' });
      await load(true);
      toast(`已复制成「${skill.name}」`);
      return skill;
    } catch (err) { toast(err.message); return null; }
  }

  async function remove(s) {
    if (!(await ask.confirm({ title: `删掉技能「${s.name}」？`, body: '只删这个技能，已经改过的稿子不受影响。', ok: '删除', danger: true }))) return false;
    try {
      await api(`/skills/${s.id}`, { method: 'DELETE' });
      list.value = list.value.filter((x) => x.id !== s.id);
      if (page.open && page.id === s.id) page.open = false;
      toast('已删除');
      return true;
    } catch (err) { toast(err.message); return false; }
  }

  /* 参考资料：素材库里挑（最多 5 条，和贴的范文合计） */
  const materials = ref([]);
  async function loadMaterials() {
    try { materials.value = (await api('/materials')).materials || []; } catch (err) { toast(err.message); }
  }
  function addMaterialRef(m) {
    if (page.draft.refs.length >= 5) { toast('参考资料最多 5 条'); return; }
    if (page.draft.refs.some((r) => r.type === 'material' && r.id === m.id)) return;
    page.draft.refs.push({ type: 'material', id: m.id, title: m.title, kind: m.kind });
  }
  async function addTextRef() {
    if (page.draft.refs.length >= 5) { toast('参考资料最多 5 条'); return; }
    const got = await ask.form({ title: '贴一段范文', body: 'AI 会学它的写法和口吻，不会照抄里面的事实和数字。', ok: '加上',
      fields: [{ key: 'title', label: '叫什么', placeholder: '比如：上周那篇爆款' }, { key: 'text', label: '范文', multiline: true, rows: 8, required: true }] });
    if (got?.text) page.draft.refs.push({ type: 'text', title: got.title || '范文', text: got.text.slice(0, 3000) });
  }

  /* ---------- 技能库 ---------- */
  const lib = reactive({ open: false });

  /* 划词菜单里对选中那段用：结果出在改写浮层里，替换 / 插入 / 重来 */
  function runOn(target, s) {
    if (!target?.text) return;
    useEditorStore().runAssist({ action: 'skill', skillId: s.id, kind: 'rewrite', target }, s.name);
  }

  return {
    inReview, reviewStamp,
    list, max, me, loaded, load, search, allTags,
    page, dirty, openPage, closePage, savePage, copy, remove,
    materials, loadMaterials, addMaterialRef, addTextRef,
    lib, runOn,
  };
});
