/* 素材库一级页：素材 CRUD + 选题池管理。挂在顶栏「素材库」，不钻进账号设定。
 * 数据按左侧选中的账号筛选（与创作记录同一套 personaId；「全部」看所有账号）。 */
import { defineStore } from 'pinia';
import { reactive, ref } from 'vue';
import { api } from '../lib/api.js';
import { ask, toast } from '../lib/feedback.js';
import { useStudioStore } from './studio.js';
import { useBriefStore } from './brief.js';

export const useLibraryStore = defineStore('library', () => {
  const tab = ref('materials'); // materials | pool
  const kind = ref('');         // '' = 全部种类
  const q = ref('');
  const sort = ref('used');     // used | recent
  const viewMode = ref('list'); // list | card
  const loading = ref(false);
  const list = ref([]);
  const kinds = ref([]);
  const selectedId = ref(null);
  const pool = ref([]);
  const error = ref('');

  const form = reactive({
    open: false,
    id: null,
    personaId: null,
    kind: '',
    title: '',
    body: '',
    tags: '',
  });

  const poolForm = reactive({ subject: '', note: '', plan_date: '' });

  function personaQuery() {
    const s = useStudioStore();
    if (s.personaId == null) return '';
    return `?persona=${s.personaId}`;
  }

  async function loadMaterials() {
    loading.value = true;
    error.value = '';
    try {
      const data = await api(`/materials${personaQuery()}`);
      list.value = data.materials || [];
      kinds.value = data.kinds || [];
      if (selectedId.value && !list.value.some((m) => m.id === selectedId.value)) selectedId.value = null;
    } catch (err) {
      list.value = [];
      error.value = err.message;
    } finally {
      loading.value = false;
    }
  }

  async function loadPool() {
    try {
      pool.value = (await api(`/pool${personaQuery()}`)).pool || [];
    } catch {
      pool.value = [];
    }
  }

  async function open() {
    await Promise.all([loadMaterials(), loadPool()]);
  }

  function filtered() {
    const needle = q.value.trim().toLowerCase();
    const rows = list.value.filter((m) => {
      if (kind.value && m.kind !== kind.value) return false;
      if (!needle) return true;
      return `${m.title} ${m.body} ${m.tags}`.toLowerCase().includes(needle);
    });
    if (sort.value === 'used') {
      return [...rows].sort((a, b) => (b.used_count || 0) - (a.used_count || 0) || b.id - a.id);
    }
    return [...rows].sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')) || b.id - a.id);
  }

  function selected() {
    return list.value.find((m) => m.id === selectedId.value) || null;
  }

  function startCreate() {
    const s = useStudioStore();
    if (!s.personas.length) {
      toast('先建一个账号，素材要挂在账号下');
      return;
    }
    form.open = true;
    form.id = null;
    form.personaId = s.personaId || s.personas[0].id;
    form.kind = kinds.value[0] || '经历';
    form.title = '';
    form.body = '';
    form.tags = '';
  }

  /* 从剪贴板起草稿：第一行当标题，其余当正文 */
  async function importClipboard() {
    const s = useStudioStore();
    if (!s.personas.length) {
      toast('先建一个账号，素材要挂在账号下');
      return;
    }
    let text = '';
    try {
      text = (await navigator.clipboard.readText()).trim();
    } catch {
      toast('读不到剪贴板，请允许权限或手动新建后粘贴');
      return;
    }
    if (!text) { toast('剪贴板是空的'); return; }
    startCreate();
    const lines = text.split(/\r?\n/);
    form.title = lines[0].trim().slice(0, 80);
    form.body = (lines.length > 1 ? lines.slice(1).join('\n') : text).trim().slice(0, 4000);
    toast('已从剪贴板填入，核对后保存');
  }

  function startEdit(m) {
    form.open = true;
    form.id = m.id;
    form.personaId = m.persona_id;
    form.kind = m.kind;
    form.title = m.title;
    form.body = m.body;
    form.tags = m.tags || '';
    selectedId.value = m.id;
  }

  function cancelForm() {
    form.open = false;
  }

  async function saveForm() {
    error.value = '';
    const body = {
      kind: form.kind,
      title: form.title.trim(),
      body: form.body.trim(),
      tags: form.tags.trim(),
    };
    if (!body.title || !body.body) { error.value = '标题和内容都要填'; return; }
    try {
      if (form.id) {
        await api(`/materials/${form.id}`, { method: 'PUT', body });
        toast('已更新');
      } else {
        if (!form.personaId) { error.value = '请选择账号'; return; }
        await api(`/personas/${form.personaId}/materials`, { method: 'POST', body });
        toast('已存进素材库');
      }
      form.open = false;
      await loadMaterials();
    } catch (err) {
      error.value = err.message;
    }
  }

  async function remove(m) {
    if (!await ask.confirm({ title: `删掉素材「${m.title}」？`, ok: '删除', danger: true })) return;
    try {
      await api(`/materials/${m.id}`, { method: 'DELETE' });
      if (selectedId.value === m.id) selectedId.value = null;
      await loadMaterials();
    } catch (err) { toast(err.message); }
  }

  async function addPool() {
    const subject = poolForm.subject.trim();
    if (!subject) { toast('题材不能为空'); return; }
    try {
      const s = useStudioStore();
      await api('/pool', {
        method: 'POST',
        body: {
          subject,
          note: poolForm.note.trim(),
          plan_date: poolForm.plan_date,
          source: '手动',
          persona_id: s.personaId,
        },
      });
      poolForm.subject = '';
      poolForm.note = '';
      poolForm.plan_date = '';
      await loadPool();
      toast('已存进选题池');
    } catch (err) { toast(err.message); }
  }

  async function datePool(id, plan_date) {
    try {
      await api(`/pool/${id}`, { method: 'PUT', body: { plan_date } });
      await loadPool();
    } catch (err) { toast(err.message); }
  }

  async function removePool(x) {
    if (!await ask.confirm({ title: '从选题池去掉？', body: '已经写成的稿子还在。', ok: '删除', danger: true })) return;
    try {
      await api(`/pool/${x.id}`, { method: 'DELETE' });
      await loadPool();
    } catch (err) { toast(err.message); }
  }

  function writePool(x) {
    useStudioStore().view = 'write';
    useBriefStore().writePool(x);
  }

  function countsByKind() {
    const map = { '': list.value.length };
    for (const k of kinds.value) map[k] = 0;
    for (const m of list.value) map[m.kind] = (map[m.kind] || 0) + 1;
    return map;
  }

  return {
    tab, kind, q, sort, viewMode, loading, list, kinds, selectedId, pool, error, form, poolForm,
    open, loadMaterials, loadPool, filtered, selected, countsByKind,
    startCreate, importClipboard, startEdit, cancelForm, saveForm, remove,
    addPool, datePool, removePool, writePool,
  };
});
