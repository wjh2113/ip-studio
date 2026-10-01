/* 素材库一级页：素材 CRUD + 选题池管理。挂在顶栏「素材库」。
 * 素材归当前用户，不挂账号；选题池仍可按左侧账号筛。
 * 新增 / 编辑素材是整页表单（form.open），不是弹窗：左边录内容（文本 / 链接 / 图片 / 视频 / 语音），右边定属性和去处。 */
import { defineStore } from 'pinia';
import { reactive, ref, watch } from 'vue';
import { api, upload } from '../lib/api.js';
import { ask, toast } from '../lib/feedback.js';
import { useStudioStore } from './studio.js';
import { useBriefStore } from './brief.js';

const BODY_MAX = 15000;
const FOLDER_FILE_CAP = 2000; // 目录树最多列这么多文件，防炸
export const TITLE_MAX = 80;
export const TAG_MAX = 20;    // 一条素材最多 20 个标签（服务端按 200 字截）
const IMAGE_MAX = 3 * 1024 * 1024; // 和 /api/inbox 的图片上限一致
const DRAFT_KEY = 'ip:materialDraft';
export const PAGE_SIZE = 20;

/* 每种素材的图标，列表、侧栏、表单共用 */
export const KIND_ICON = {
  文章: 'doc', 图片: 'image', 视频: 'video', 链接: 'link',
  语音: 'mic', 框架参考: 'layers', 对标账号: 'users', 选题灵感: 'bulb',
};
export const kindIcon = (k) => KIND_ICON[k] || 'inbox';
export const POOL_KIND = '选题灵感'; // 表单里的「选题灵感」= 存进选题池，不是一种素材

/* 标签：逗号、顿号、空格都算分隔（手机端收件箱存的是空格分隔） */
export const tagList = (tags) => String(tags || '').split(/[,，、\s]+/).map((t) => t.trim()).filter(Boolean);

/* 正文里收件箱 / 本页上传的图片：「图片：/api/inbox/files/…」一行 */
export function materialImage(m) {
  const hit = String(m?.body || '').match(/(?:^|\n)图片：\s*(\/api\/inbox\/files\/[\w.-]+)/);
  return hit ? hit[1] : '';
}
/* 从正文「来源：…」或正文/标题里的 http(s) 取出可点开的地址 */
export function materialUrl(m) {
  const body = String(m?.body || '');
  const sourced = body.match(/(?:^|\n)来源：\s*(https?:\/\/\S+)/i);
  if (sourced) return sourced[1].replace(/[)\]】》"'>]+$/, '');
  const titled = String(m?.title || '').trim();
  if (/^https?:\/\//i.test(titled)) return titled;
  const any = body.match(/https?:\/\/[^\s)\]】》"'>]+/i);
  return any ? any[0] : '';
}
/* 展示用正文：去掉末尾的「来源：」「图片：」两行，它们在详情里单独显示 */
export function materialText(m) {
  return String(m?.body || '').split('\n').filter((l) => !/^(来源|图片)：/.test(l.trim())).join('\n').trim();
}

export const useLibraryStore = defineStore('library', () => {
  const tab = ref('materials'); // materials | pool
  const kind = ref('');         // '' = 全部种类
  const tag = ref('');          // '' = 不按标签筛；经历/数据等内容性质走标签
  const q = ref('');
  const sort = ref('used');     // used | recent
  const viewMode = ref('list'); // list | card
  const page = ref(1);
  const checked = ref([]);      // 列表里勾选的素材 id
  const loading = ref(false);
  const list = ref([]);
  const kinds = ref([]);
  const selectedId = ref(null);
  const pool = ref([]);
  const error = ref('');

  /* 内容性质：原产品分类，现作推荐标签（左侧 kind 跟设计稿的形态分类） */
  const CONTENT_TAGS = ['经历', '数据', '案例', '金句', '观察'];


  const form = reactive({
    open: false,
    id: null,
    mode: 'text',      // 录入方式：text | link | image | video | voice
    target: 'material', // material = 存入素材库；pool = 存进选题池
    personaId: null,    // 只对选题池有意义（素材归本人，不挂账号）
    kind: '',
    title: '',
    body: '',
    tags: '',
    sourceUrl: '',
    image: '',          // data URL（新建图片素材时）
    imageName: '',
    preview: null,      // 链接预览 { title, excerpt, url }
    extracting: false,
    recording: false,
    transcribing: false,
  });
  const draftSaved = ref(false);

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
    const wantTag = tag.value.trim();
    const rows = list.value.filter((m) => {
      if (kind.value && m.kind !== kind.value) return false;
      if (wantTag) {
        const tags = tagList(m.tags);
        if (!tags.includes(wantTag)) return false;
      }
      if (!needle) return true;
      return `${m.title} ${m.body} ${m.tags}`.toLowerCase().includes(needle);
    });
    if (sort.value === 'used') {
      return [...rows].sort((a, b) => (b.used_count || 0) - (a.used_count || 0) || b.id - a.id);
    }
    return [...rows].sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')) || b.id - a.id);
  }

  watch([kind, tag, q, sort], () => { page.value = 1; checked.value = []; });

  function pageCount(rows) { return Math.max(1, Math.ceil(rows.length / PAGE_SIZE)); }
  function paged(rows) {
    const n = pageCount(rows);
    if (page.value > n) page.value = n;
    return rows.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE);
  }

  /* 标签栏：推荐内容标签在前，再跟素材里出现过的其它标签 */
  function allTags() {
    const seen = new Set();
    const out = [];
    for (const t of CONTENT_TAGS) {
      if (!seen.has(t)) { seen.add(t); out.push(t); }
    }
    for (const m of list.value) {
      for (const t of tagList(m.tags)) {
        if (!seen.has(t)) { seen.add(t); out.push(t); }
      }
    }
    return out;
  }

  function countsByTag() {
    const map = {};
    for (const t of allTags()) map[t] = 0;
    for (const m of list.value) {
      for (const t of tagList(m.tags)) {
        map[t] = (map[t] || 0) + 1;
      }
    }
    return map;
  }

  function toggleFormTag(name) {
    const cur = tagList(form.tags);
    const i = cur.indexOf(name);
    if (i >= 0) cur.splice(i, 1);
    else cur.push(name);
    form.tags = cur.join('，');
  }

  function formHasTag(name) {
    return tagList(form.tags).includes(name);
  }

  function selected() {
    return list.value.find((m) => m.id === selectedId.value) || null;
  }

  function resetForm(preset = {}) {
    Object.assign(form, {
      id: null,
      mode: preset.mode || 'text',
      target: preset.target || 'material',
      personaId: preset.personaId ?? useStudioStore().personaId ?? null,
      kind: preset.kind || kinds.value[0] || '文章',
      title: preset.title || '',
      body: preset.body || '',
      tags: preset.tags || '',
      sourceUrl: preset.sourceUrl || '',
      image: '', imageName: '',
      preview: preset.preview || null,
      extracting: false, recording: false, transcribing: false,
    });
    error.value = '';
  }

  /* 新建：带着预设打开整页表单；没有预设时接着上次没存的草稿 */
  function startCreate(preset = {}) {
    resetForm(preset);
    if (!Object.keys(preset).length) restoreDraft();
    form.open = true;
    tab.value = 'materials';
  }

  /* 选录入方式：顺手把种类设成对应的（还没改过种类时） */
  const MODE_KIND = { text: '文章', link: '链接', image: '图片', video: '视频', voice: '语音' };
  function setMode(mode) {
    const prevKind = MODE_KIND[form.mode];
    form.mode = mode;
    if (form.target === 'material' && (!form.kind || form.kind === prevKind)) form.kind = MODE_KIND[mode];
  }

  /* 种类里的「选题灵感」和「目标：选题池」是一回事，两边联动 */
  function setKind(k) {
    if (k === POOL_KIND) { form.target = 'pool'; return; }
    form.kind = k;
    form.target = 'material';
  }
  function setTarget(t) {
    form.target = t;
    if (t === 'material' && !form.kind) form.kind = MODE_KIND[form.mode] || '文章';
  }

  /* —— 草稿：新建时边填边存在本机，误关页面不丢 —— */
  function saveDraft() {
    if (!form.open || form.id) return;
    const has = form.title.trim() || form.body.trim() || form.tags.trim();
    try {
      if (!has) { localStorage.removeItem(DRAFT_KEY); draftSaved.value = false; return; }
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        mode: form.mode, target: form.target, kind: form.kind, title: form.title, body: form.body,
        tags: form.tags, sourceUrl: form.sourceUrl, personaId: form.personaId,
      }));
      draftSaved.value = true;
    } catch { draftSaved.value = false; }
  }
  function restoreDraft() {
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
      if (!d) return;
      Object.assign(form, {
        mode: d.mode || 'text', target: d.target === 'pool' ? 'pool' : 'material', kind: d.kind || form.kind,
        title: d.title || '', body: d.body || '', tags: d.tags || '', sourceUrl: d.sourceUrl || '',
        personaId: d.personaId ?? form.personaId,
      });
      draftSaved.value = true;
    } catch { /* 坏了就当没有 */ }
  }
  function clearDraft() {
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* 无痕模式 */ }
    draftSaved.value = false;
  }
  let draftTimer = null;
  watch(() => [form.mode, form.target, form.kind, form.title, form.body, form.tags, form.sourceUrl, form.personaId], () => {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, 400);
  });

  /* 链接预览：抓标题和摘要；正文空着时顺手填进去 */
  async function extractPreview(raw) {
    const url = String(raw ?? form.sourceUrl ?? '').trim();
    if (!/^https?:\/\//i.test(url)) { toast('请贴一个 http(s) 开头的链接'); return; }
    form.sourceUrl = url;
    form.extracting = true;
    try {
      const data = await api('/materials/extract-url', { method: 'POST', body: { url } });
      const text = materialText({ body: data.body });
      form.preview = { title: data.title || url, excerpt: data.excerpt || text.slice(0, 120), url: data.url || url };
      form.sourceUrl = data.url || url;
      if (!form.title.trim()) form.title = String(data.title || '').slice(0, TITLE_MAX);
      if (!form.body.trim() && text) form.body = text.slice(0, BODY_MAX);
    } catch (err) {
      toast(err.message || '提取失败，可以直接把正文贴进来');
    } finally {
      form.extracting = false;
    }
  }
  function clearPreview() {
    form.preview = null;
    form.sourceUrl = '';
  }

  /* 图片：只收 JPEG / PNG，≤ 3MB，存成 data URL，保存时走 /api/inbox（服务端校验文件头再落盘） */
  async function pickImage(file) {
    if (!file) return;
    if (!/^image\/(jpeg|png)$/.test(file.type)) { toast('图片只支持 JPG 或 PNG'); return; }
    if (file.size > IMAGE_MAX) { toast('图片不能超过 3MB'); return; }
    form.image = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error('读不到这张图'));
      r.readAsDataURL(file);
    });
    form.imageName = file.name;
    if (!form.title.trim()) form.title = file.name.replace(/\.[^.]+$/, '').slice(0, TITLE_MAX);
  }

  /* 语音：按一下开始录，再按一下停，转成文字接在正文后面 */
  let recorder = null;
  let chunks = [];
  async function toggleRecord() {
    if (form.recording) { recorder?.stop(); return; }
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      toast('这个浏览器不能在页面里录音'); return;
    }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch {
      toast('打不开麦克风，检查一下浏览器权限'); return;
    }
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
      : (MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '');
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    chunks = [];
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      form.recording = false;
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      if (blob.size < 1000) { toast('太短了，再说一次'); return; }
      form.transcribing = true;
      try {
        const { text } = await upload('/transcribe', blob, 'note.webm');
        form.body = form.body.trim() ? `${form.body.trim()}\n${text}` : text;
        if (!form.title.trim()) form.title = text.slice(0, 30);
      } catch (err) {
        toast(err.message || '没转成文字');
      } finally {
        form.transcribing = false;
      }
    };
    recorder.start();
    form.recording = true;
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
    if (!form.open) { resetForm(); form.open = true; }
    if (/^https?:\/\/\S+$/i.test(text)) {
      setMode('link');
      await extractPreview(text);
      return;
    }
    const lines = text.split(/\r?\n/);
    if (!form.title.trim()) form.title = lines[0].trim().slice(0, TITLE_MAX);
    const rest = (lines.length > 1 ? lines.slice(1).join('\n') : text).trim();
    form.body = (form.body.trim() ? `${form.body.trim()}\n${rest}` : rest).slice(0, BODY_MAX);
    toast('已从剪贴板填入，核对后保存');
  }

  /* 从链接提取：打开新增页，停在「链接」 */
  function importFromUrl() {
    startCreate({ mode: 'link', kind: '链接' });
  }

  /* 选本地文件夹：浏览器读出相对路径，拼成目录树存成一条素材 */
  async function importFolder(fileList) {
    const payload = folderPayloadFromFiles(fileList);
    if (!payload) { toast('没有读到文件夹内容'); return; }
    startCreate(payload);
    toast(`已读入「${payload.root}」共 ${payload.fileCount} 个文件，核对后保存`);
  }

  /* 刷新已存的本地目录素材：再选一次同一文件夹，覆盖正文 */
  async function refreshFolder(m, fileList) {
    if (!m?.id) return;
    const payload = folderPayloadFromFiles(fileList);
    if (!payload) { toast('没有读到文件夹内容'); return; }
    try {
      await api(`/materials/${m.id}`, {
        method: 'PUT',
        body: {
          kind: m.kind || '文章',
          title: payload.title,
          body: payload.body,
          tags: payload.tags,
        },
      });
      selectedId.value = m.id;
      await loadMaterials();
      toast(`已刷新「${payload.root}」共 ${payload.fileCount} 个文件`);
    } catch (err) {
      toast(err.message || '刷新失败');
    }
  }

  function isLocalFolder(m) {
    const tags = String(m?.tags || '');
    return tags.includes('本地文件夹') || String(m?.title || '').startsWith('本地目录');
  }

  function startEdit(m) {
    const MODE = { 链接: 'link', 图片: 'image', 视频: 'video', 语音: 'voice' };
    resetForm({ kind: m.kind, mode: MODE[m.kind] || 'text', title: m.title, body: m.body, tags: m.tags || '' });
    form.id = m.id;
    form.open = true;
    selectedId.value = m.id;
  }

  /* 取消：新建的草稿删掉（用户明确不要了） */
  function cancelForm() {
    if (recorder && form.recording) recorder.stop();
    if (!form.id) clearDraft();
    form.open = false;
  }

  /* 保存。again = 「保存并继续新建」：存完留在新增页，清空内容但保留种类、去处和账号 */
  async function saveForm({ again = false } = {}) {
    error.value = '';
    let text = form.body.trim();
    const src = String(form.sourceUrl || '').trim();
    if (src && !text.includes(src)) text = `${text}\n\n来源：${src}`.trim();
    text = text.slice(0, BODY_MAX);
    const tags = tagList(form.tags);
    if (tags.length > TAG_MAX) { error.value = `标签最多 ${TAG_MAX} 个`; return false; }
    const title = form.title.trim() || text.split('\n')[0].slice(0, TITLE_MAX);
    if (form.target === 'pool') {
      if (!title) { error.value = '写一句想写的题材'; return false; }
    } else if (!title || (!text && !form.image)) {
      error.value = form.image ? '给这张图起个标题' : '标题和内容都要填';
      return false;
    }
    try {
      if (form.id) {
        await api(`/materials/${form.id}`, { method: 'PUT', body: { kind: form.kind, title, body: text, tags: tags.join('，') } });
        toast('已更新');
      } else if (form.image) {
        // 带图：走收件箱接口，服务端校验并存图，正文末尾加「图片：」一行
        const item = form.target === 'pool'
          ? { kind: 'pool', personaId: form.personaId, subject: title.slice(0, 200), note: text.slice(0, 500), image: form.image, source: '手动' }
          : { kind: 'material', title, body: text, materialKind: form.kind, tags: tags.join(' '), image: form.image };
        const { results } = await api('/inbox', { method: 'POST', body: { items: [{ key: `web${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`, ...item }] } });
        if (!results?.[0]?.ok) throw new Error(results?.[0]?.error || '保存失败');
        toast(form.target === 'pool' ? '已存进选题池' : '已存进素材库');
      } else if (form.target === 'pool') {
        await api('/pool', { method: 'POST', body: { subject: title.slice(0, 200), note: text.slice(0, 500), source: '手动', persona_id: form.personaId } });
        toast('已存进选题池');
      } else {
        await api('/materials', { method: 'POST', body: { kind: form.kind, title, body: text, tags: tags.join('，') } });
        toast('已存进素材库');
      }
    } catch (err) {
      error.value = err.message;
      return false;
    }
    const wasPool = form.target === 'pool';
    if (!form.id) clearDraft();
    if (again) {
      resetForm({ mode: form.mode, target: form.target, kind: form.kind, personaId: form.personaId });
    } else {
      form.open = false;
      if (wasPool) tab.value = 'pool';
    }
    await (wasPool ? loadPool() : loadMaterials());
    return true;
  }

  /* 详情里直接加标签 */
  async function addTag(m, name) {
    const t = String(name || '').trim().slice(0, 20);
    if (!t) return;
    const cur = tagList(m.tags);
    if (cur.includes(t)) return;
    if (cur.length >= TAG_MAX) { toast(`标签最多 ${TAG_MAX} 个`); return; }
    try {
      await api(`/materials/${m.id}`, { method: 'PUT', body: { kind: m.kind, title: m.title, body: m.body, tags: [...cur, t].join('，') } });
      await loadMaterials();
    } catch (err) { toast(err.message); }
  }

  /* 批量删除勾选的 */
  async function removeChecked() {
    const ids = [...checked.value];
    if (!ids.length) return;
    if (!await ask.confirm({ title: `删掉选中的 ${ids.length} 条素材？`, ok: '删除', danger: true })) return;
    let failed = 0;
    for (const id of ids) {
      try { await api(`/materials/${id}`, { method: 'DELETE' }); } catch { failed += 1; }
    }
    checked.value = [];
    if (ids.includes(selectedId.value)) selectedId.value = null;
    await loadMaterials();
    toast(failed ? `删了 ${ids.length - failed} 条，${failed} 条没删掉` : `已删除 ${ids.length} 条`);
  }

  async function remove(m) {
    if (!await ask.confirm({ title: `删掉素材「${m.title}」？`, ok: '删除', danger: true })) return;
    try {
      await api(`/materials/${m.id}`, { method: 'DELETE' });
      if (selectedId.value === m.id) selectedId.value = null;
      checked.value = checked.value.filter((id) => id !== m.id);
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
    tab, kind, tag, q, sort, viewMode, page, checked, loading, list, kinds, selectedId, pool, error, form, poolForm, draftSaved,
    CONTENT_TAGS,
    open, loadMaterials, loadPool, filtered, paged, pageCount, selected, countsByKind, allTags, countsByTag,
    toggleFormTag, formHasTag,
    startCreate, setMode, setKind, setTarget, extractPreview, clearPreview, pickImage, toggleRecord,
    importClipboard, importFromUrl, importFolder, refreshFolder, isLocalFolder,
    startEdit, cancelForm, saveForm, addTag, removeChecked, remove,
    addPool, datePool, removePool, writePool,
  };
});

function folderPayloadFromFiles(fileList) {
  const files = [...(fileList || [])].filter((f) => f && f.webkitRelativePath);
  if (!files.length) return null;
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
  return {
    root,
    fileCount: paths.length,
    kind: '文章',
    title: `本地目录 · ${root}`.slice(0, 80),
    body,
    tags: '本地文件夹,目录',
  };
}

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
