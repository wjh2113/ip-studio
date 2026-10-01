/* 素材库一级页：素材 CRUD + 选题池管理。挂在顶栏「素材库」。
 * 素材归当前用户，不挂账号；选题池仍可按左侧账号筛。 */
import { defineStore } from 'pinia';
import { reactive, ref } from 'vue';
import { api } from '../lib/api.js';
import { ask, toast } from '../lib/feedback.js';
import { useStudioStore } from './studio.js';
import { useBriefStore } from './brief.js';

const BODY_MAX = 15000;
const FOLDER_FILE_CAP = 2000; // 目录树最多列这么多文件，防炸

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
    kind: '',
    title: '',
    body: '',
    tags: '',
    sourceUrl: '',
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
      const data = await api('/materials');
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

  function startCreate(preset = {}) {
    form.open = true;
    form.id = null;
    form.kind = preset.kind || kinds.value[0] || '文章';
    form.title = preset.title || '';
    form.body = preset.body || '';
    form.tags = preset.tags || '';
    form.sourceUrl = preset.sourceUrl || '';
    error.value = '';
  }

  /* 从剪贴板起草稿：第一行当标题，其余当正文 */
  async function importClipboard() {
    let text = '';
    try {
      text = (await navigator.clipboard.readText()).trim();
    } catch {
      toast('读不到剪贴板，请允许权限或手动新建后粘贴');
      return;
    }
    if (!text) { toast('剪贴板是空的'); return; }
    const lines = text.split(/\r?\n/);
    startCreate({
      title: lines[0].trim().slice(0, 80),
      body: (lines.length > 1 ? lines.slice(1).join('\n') : text).trim().slice(0, BODY_MAX),
    });
    toast('已从剪贴板填入，核对后保存');
  }

  /* 粘贴链接 → 服务端抓正文 → 打开表单核对 */
  async function importFromUrl() {
    const filled = await ask.form({
      title: '从链接提取',
      fields: [
        { key: 'url', label: '网页链接', placeholder: 'https://…', required: true },
      ],
      ok: '提取正文',
    });
    if (!filled) return;
    const url = String(filled.url || '').trim();
    if (!url) { toast('请贴一个链接'); return; }
    try {
      const data = await api('/materials/extract-url', { method: 'POST', body: { url } });
      startCreate({
        kind: '链接',
        title: data.title || url,
        body: data.body || '',
        tags: '链接',
        sourceUrl: data.url || url,
      });
      toast('已提取，核对后保存');
    } catch (err) {
      toast(err.message || '提取失败');
    }
  }

  /* 选本地文件夹：浏览器读出相对路径，拼成目录树存成一条素材 */
  async function importFolder(fileList) {
    const files = [...(fileList || [])].filter((f) => f && f.webkitRelativePath);
    if (!files.length) { toast('没有读到文件夹内容'); return; }
    const root = files[0].webkitRelativePath.split('/')[0] || '本地文件夹';
    const paths = files
      .map((f) => f.webkitRelativePath)
      .filter((p) => !p.split('/').some((seg) => seg === '.DS_Store' || seg === 'Thumbs.db'))
      .sort((a, b) => a.localeCompare(b, 'zh'));
    const capped = paths.slice(0, FOLDER_FILE_CAP);
    const tree = formatDirTree(capped.map((p) => p.split('/').slice(1).filter(Boolean)));
    const omitted = paths.length > FOLDER_FILE_CAP
      ? `\n…另有 ${paths.length - FOLDER_FILE_CAP} 个文件未列出\n`
      : '';
    const body = [
      `文件夹：${root}`,
      `共 ${paths.length} 个文件`,
      '',
      tree || '(空文件夹)',
      omitted,
    ].join('\n').trim().slice(0, BODY_MAX);

    startCreate({
      kind: '文章',
      title: `本地目录 · ${root}`.slice(0, 80),
      body,
      tags: '本地文件夹,目录',
    });
    toast(`已读入「${root}」共 ${paths.length} 个文件，核对后保存`);
  }

  function startEdit(m) {
    form.open = true;
    form.id = m.id;
    form.kind = m.kind;
    form.title = m.title;
    form.body = m.body;
    form.tags = m.tags || '';
    form.sourceUrl = '';
    selectedId.value = m.id;
    error.value = '';
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
        await api('/materials', { method: 'POST', body });
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
    startCreate, importClipboard, importFromUrl, importFolder, startEdit, cancelForm, saveForm, remove,
    addPool, datePool, removePool, writePool,
  };
});

/* 把相对路径片段列表排成缩进树。paths: string[][]，不含根目录名 */
function formatDirTree(segmentsList) {
  const root = { name: '', kids: new Map(), file: false };
  for (const segs of segmentsList) {
    let node = root;
    segs.forEach((name, i) => {
      const isFile = i === segs.length - 1;
      if (!node.kids.has(name)) node.kids.set(name, { name, kids: new Map(), file: isFile });
      node = node.kids.get(name);
      if (isFile) node.file = true;
    });
  }
  const lines = [];
  function walk(node, prefix, isLast) {
    if (node.name) {
      lines.push(`${prefix}${isLast ? '└── ' : '├── '}${node.name}${node.file ? '' : '/'}`);
      prefix += isLast ? '    ' : '│   ';
    }
    const kids = [...node.kids.values()].sort((a, b) => {
      if (a.file !== b.file) return a.file ? 1 : -1;
      return a.name.localeCompare(b.name, 'zh');
    });
    kids.forEach((kid, i) => walk(kid, prefix, i === kids.length - 1));
  }
  walk(root, '', true);
  return lines.join('\n');
}
