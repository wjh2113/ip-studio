/* 前端 · editor：成稿编辑器：保存、划词改写、/ 续写、AI 浮层、三动作工具条、正文历史、阅读/编辑模式、语音改稿。从原 app.js 原样拆出。 */
import { IMAGE_MARK } from '../place.js';
import { api, countChars, el, esc, state, toast } from './core.js';
import { loadHistory, readSSE } from './compose.js';
import { currentLabel, downloadAs, updateActionLabels } from './export.js';
import { loadDraftSpeaks, renderCues } from './speak.js';
import { illOf, renderIllusBar, renderMultiBar, renderVersionTabs, showVersion, ver, withIllus } from './versions.js';
import { openMetrics } from './insights.js';

/* ==================================================================
 * 成稿编辑器：阅读/编辑双模式、划词改 AI、/ 唤起续写
 * 正文的唯一真相是 state.draft.content（Markdown 原文）
 * ================================================================== */

const ASSIST_ACTIONS = [
  { key: 'expand', label: '扩写' },
  { key: 'professional', label: '专业点' },
  { key: 'casual', label: '轻松点' },
  { key: 'shorten', label: '缩写' },
  { key: 'example', label: '举个例子' },
  { key: 'simplify', label: '更好懂' },
];

const COMPOSE_ACTIONS = [
  { key: 'continue', label: '续写这一段' },
  { key: 'opening', label: '写个开头' },
  { key: 'heading', label: '加个小标题' },
  { key: 'ending', label: '写个结尾' },
];

export function renderContent() {
  const text = state.draft?.content || '';
  el.content.innerHTML = withIllus(text);   // 有配图就把图插进去
  updateActionLabels();
  if (el.editor.value !== text) el.editor.value = text;
  el.counter.textContent = `${countChars(text)} 字`;
}

export function setMode(mode) {
  if (state.streaming) return;
  if (state.mode === 'edit' && mode !== 'edit') {
    stopVoiceEdit();
    flushSave(true);   // 离开编辑就落盘，并留一版历史
  }
  state.mode = mode;
  const editing = mode === 'edit';
  const cueing = mode === 'cue';
  el.content.classList.toggle('hidden', editing || cueing);
  el.editor.classList.toggle('hidden', !editing);
  el.editorBar.classList.toggle('hidden', !editing);
  el.cuesPane.classList.toggle('hidden', !cueing);
  syncModeUi(mode);
  hideMenus();
  if (editing) {
    el.editor.value = state.draft?.content || '';
    el.editor.style.height = `${Math.max(360, el.editor.scrollHeight)}px`;
    el.editor.focus();
  }
  if (cueing) {
    renderCues(state.draft?.cues);
    loadDraftSpeaks();
  }
  scheduleRevPaint();
}

/* ---------------- 保存 ---------------- */
let saveTimer;

/* 只改「保存中 / 已保存 / 失败」这几个状态。藏不藏由是不是编辑模式决定，
   不要整段换 class，否则阅读模式的 hidden 会被清掉。 */
function setSaveState(text, kind) {
  if (!el.saveState) return;
  el.saveState.textContent = text;
  el.saveState.classList.remove('dirty', 'saved');
  if (kind) el.saveState.classList.add(kind);
  el.saveState.classList.toggle('hidden', state.mode !== 'edit');
}

export function markDirty() {
  state.dirty = true;
  setSaveState('未保存', 'dirty');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 1200);
}

/* snapshot = true：手动保存或离开编辑，服务端一定留一版历史；自动保存不带，按时间间隔留 */
export async function flushSave(snapshot = false) {
  clearTimeout(saveTimer);
  if (!state.dirty || !state.draft) return;
  const content = state.draft.content;
  state.dirty = false;
  setSaveState('保存中…');
  try {
    const { draft, kept } = await api(`/drafts/${state.draft.id}/content`, { method: 'PUT', body: { content, snapshot: snapshot === true } });
    const newer = Boolean(state.draft && state.draft.content !== content);
    state.draft = newer ? { ...draft, content: state.draft.content } : draft;
    if (state.mode === 'cue') renderCues(state.draft.cues);
    if (state.mode !== 'edit') {
      if (ver.current) showVersion();
      else renderContent();
    }
    renderVersionTabs();
    if (state.illusOpen) renderIllusBar();
    if (newer) markDirty();
    else setSaveState('已保存', 'saved');
    const notes = [];
    if (kept?.cuesDropped) notes.push(`口播提示拿掉了 ${kept.cuesDropped} 条对不上的`);
    if (kept?.illusDropped) notes.push(`配图拿掉了 ${kept.illusDropped} 张对不上的`);
    if (notes.length) toast(notes.join('，'));
    loadHistory();
    if (state.revOpen) loadRevs().catch(() => {});
  } catch (err) {
    state.dirty = true;
    setSaveState(`保存失败：${err.message}`, 'dirty');
    toast(`保存失败：${err.message}`);
  }
}

el.saveBtn.addEventListener('click', () => flushSave(true));

window.addEventListener('beforeunload', (e) => {
  if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
});

el.editor.addEventListener('compositionend', () => setTimeout(detectSlash, 0));

el.editor.addEventListener('input', () => {
  if (!state.draft) return;
  if (!state.voiceApplying) clearVoiceUndo();
  state.draft.content = el.editor.value;
  el.counter.textContent = `${countChars(el.editor.value)} 字`;
  el.editor.style.height = 'auto';
  el.editor.style.height = `${Math.max(360, el.editor.scrollHeight)}px`;
  markDirty();
  detectSlash();
  scheduleRevPaint();
});

/* ---------------- 划词菜单 ---------------- */

function hideMenus() {
  el.selMenu.classList.add('hidden');
  el.slashMenu.classList.add('hidden');
  state.slashAt = null;
}

/* 光标在 textarea 里的屏幕坐标：用一个同款式的镜像元素量出来 */
function caretRect(ta, index) {
  const cs = getComputedStyle(ta);
  const mirror = document.createElement('div');
  const copy = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'wordSpacing',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'boxSizing'];
  copy.forEach((k) => { mirror.style[k] = cs[k]; });
  Object.assign(mirror.style, {
    position: 'absolute', top: '0', left: '0', visibility: 'hidden',
    whiteSpace: 'pre-wrap', overflowWrap: 'break-word', width: `${ta.clientWidth}px`,
  });
  mirror.textContent = ta.value.slice(0, index);
  const marker = document.createElement('span');
  marker.textContent = ta.value.slice(index) || '.';
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const box = ta.getBoundingClientRect();
  const top = box.top + marker.offsetTop - ta.scrollTop;
  const left = box.left + marker.offsetLeft - ta.scrollLeft;
  mirror.remove();
  return { top, left, bottom: top + (parseFloat(cs.lineHeight) || 22) };
}

function placeMenu(node, point) {
  node.classList.remove('hidden');
  const box = node.getBoundingClientRect();
  const left = Math.min(Math.max(8, point.left), window.innerWidth - box.width - 8);
  const spaceBelow = window.innerHeight - point.bottom;
  const top = spaceBelow > box.height + 12 ? point.bottom + 6 : point.top - box.height - 6;
  node.style.left = `${left}px`;
  node.style.top = `${Math.max(8, top)}px`;
}

function openSelMenu(point, target) {
  state.selTarget = target;
  el.selMenu.innerHTML = ASSIST_ACTIONS
    .map((a) => `<button data-action="${a.key}">${a.label}</button>`).join('');
  placeMenu(el.selMenu, point);
}

/* 编辑模式：选区偏移直接可用 */
function editorSelection() {
  const { selectionStart: start, selectionEnd: end } = el.editor;
  if (end - start < 2) return null;
  return { start, end, text: el.editor.value.slice(start, end) };
}

['mouseup', 'keyup'].forEach((evt) => el.editor.addEventListener(evt, (e) => {
  if (evt === 'keyup' && !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
  const sel = editorSelection();
  if (!sel) { el.selMenu.classList.add('hidden'); return; }
  openSelMenu(caretRect(el.editor, sel.end), sel);
}));

/* 阅读模式：把渲染文本里的选区反查回 Markdown 原文的偏移 */
document.addEventListener('mouseup', () => {
  if (state.mode !== 'read' || !state.draft?.content) return;
  setTimeout(() => {
    const selection = window.getSelection();
    if (!selection.rangeCount || selection.isCollapsed) { el.selMenu.classList.add('hidden'); return; }
    const range = selection.getRangeAt(0);
    if (!el.content.contains(range.commonAncestorContainer)) return;
    const text = selection.toString().trim();
    if (text.length < 2) return;

    const target = locateInRaw(text, range);
    if (!target) { toast('这段包含格式符号，切到「编辑」再选一次就能改'); return; }
    openSelMenu(range.getBoundingClientRect(), target);
  }, 0);
});

/* 同一句话可能出现多次：用它在渲染文本里的相对位置挑最接近的那处 */
function locateInRaw(text, range) {
  const raw = state.draft.content;
  const hits = [];
  for (let i = raw.indexOf(text); i !== -1; i = raw.indexOf(text, i + 1)) hits.push(i);
  if (!hits.length) return null;

  let start = hits[0];
  if (hits.length > 1) {
    const probe = document.createRange();
    probe.selectNodeContents(el.content);
    probe.setEnd(range.startContainer, range.startOffset);
    const ratio = probe.toString().length / (el.content.innerText.length || 1);
    const guess = ratio * raw.length;
    start = hits.reduce((best, i) => (Math.abs(i - guess) < Math.abs(best - guess) ? i : best), hits[0]);
  }
  return { start, end: start + text.length, text };
}

el.selMenu.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const label = ASSIST_ACTIONS.find((a) => a.key === action).label;
  hideMenus();
  runAssist({ action, kind: 'rewrite', target: state.selTarget }, label);
});

/* ---------------- / 唤起续写 ---------------- */

/* 半角和全角斜杠都认（中文输入法全角状态下打出来的是／） */
const SLASH_KEYS = ['/', '\uFF0F'];

/* 只在这些字符后面不触发：URL、路径、分数——中文标点和汉字后面都要能唤起 */
const SLASH_BLOCKERS = /[A-Za-z0-9:/\uFF0F]/;

function detectSlash() {
  if (state.mode !== 'edit') return;
  const pos = el.editor.selectionStart;
  const value = el.editor.value;
  if (!SLASH_KEYS.includes(value[pos - 1])) {
    if (state.slashAt !== null && state.slashAt !== undefined) hideMenus();
    return;
  }
  const prev = value[pos - 2];
  if (prev && SLASH_BLOCKERS.test(prev)) return;
  state.slashAt = pos - 1;
  el.slashItems.innerHTML = COMPOSE_ACTIONS
    .map((a) => `<button data-compose="${a.key}">${a.label}</button>`).join('');
  el.slashInput.value = '';
  placeMenu(el.slashMenu, caretRect(el.editor, pos));
}

function consumeSlash() {
  if (state.slashAt === null || state.slashAt === undefined) return el.editor.selectionStart;
  const at = state.slashAt;
  const value = el.editor.value;
  el.editor.value = value.slice(0, at) + value.slice(at + 1);   // 去掉那个 / 或 ／
  state.draft.content = el.editor.value;
  state.slashAt = null;
  markDirty();
  return at;
}

el.slashItems.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-compose]');
  if (!btn) return;
  const key = btn.dataset.compose;
  const label = COMPOSE_ACTIONS.find((a) => a.key === key).label;
  const at = consumeSlash();
  hideMenus();
  runAssist({ action: key, kind: 'compose', target: { start: at, end: at, text: '' } }, label);
});

el.slashInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const instruction = el.slashInput.value.trim();
  if (!instruction) return;
  const at = consumeSlash();
  hideMenus();
  runAssist({ instruction, kind: 'compose', target: { start: at, end: at, text: '' } }, instruction);
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!el.slashMenu.classList.contains('hidden') || !el.selMenu.classList.contains('hidden')) hideMenus();
  else if (!el.assistPop.classList.contains('hidden')) closeAssist();
});

document.addEventListener('mousedown', (e) => {
  if (el.selMenu.contains(e.target) || el.slashMenu.contains(e.target)) return;
  hideMenus();
});

/* ---------------- AI 结果浮层 ---------------- */

async function runAssist(req, label) {
  const draft = state.draft;
  if (!draft) return;
  state.assist = { ...req, label, text: '' };

  el.assistTitle.textContent = `AI · ${label}`;
  el.assistBody.textContent = '';
  el.assistBody.innerHTML = '<span class="cursor"></span>';
  el.assistPop.classList.remove('hidden');
  el.assistReplace.disabled = true;
  el.assistInsert.disabled = true;
  el.assistReplace.textContent = req.kind === 'compose' ? '插入到光标处' : '替换原文';
  el.assistInsert.classList.toggle('hidden', req.kind === 'compose');
  positionAssist();

  const { start, end, text } = req.target;
  const raw = draft.content;
  const body = {
    kind: req.kind === 'compose' ? 'compose' : 'rewrite',
    action: req.action,
    instruction: req.instruction,
    selection: text,
    before: raw.slice(Math.max(0, start - 600), start),
    after: raw.slice(end, end + 600),
  };

  try {
    const res = await fetch(`/api/drafts/${draft.id}/assist`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || '请求失败');

    let out = '';
    await readSSE(res, (event, data) => {
      if (event === 'delta') {
        out += data.text;
        el.assistBody.textContent = out;
        el.assistBody.innerHTML = `${esc(out)}<span class="cursor"></span>`;
      } else if (event === 'done') {
        out = (data.text || out).trim();
        el.assistBody.textContent = out;
      } else if (event === 'error') {
        throw new Error(data.message);
      }
    });
    state.assist.text = out.trim();
    el.assistReplace.disabled = !state.assist.text;
    el.assistInsert.disabled = !state.assist.text;
  } catch (err) {
    el.assistBody.innerHTML = `<span class="err">${esc(err.message)}</span>`;
  }
}

function positionAssist() {
  const anchor = el.contentCard.getBoundingClientRect();
  const box = el.assistPop.getBoundingClientRect();
  el.assistPop.style.left = `${Math.max(8, Math.min(anchor.right - box.width, window.innerWidth - box.width - 8))}px`;
  el.assistPop.style.top = `${Math.max(8, Math.min(window.innerHeight - box.height - 8, anchor.top + 60))}px`;
}

export function closeAssist() {
  el.assistPop.classList.add('hidden');
  state.assist = null;
}

el.assistClose.addEventListener('click', closeAssist);

el.assistRetry.addEventListener('click', () => {
  const a = state.assist;
  if (a) runAssist({ action: a.action, kind: a.kind, instruction: a.instruction, target: a.target }, a.label);
});

el.assistReplace.addEventListener('click', () => applyAssist('replace'));

el.assistInsert.addEventListener('click', () => applyAssist('after'));

function applyAssist(how) {
  const a = state.assist;
  if (!a?.text) return;
  const { start, end } = a.target;
  const raw = state.draft.content;

  const next = how === 'replace' && a.kind !== 'compose'
    ? raw.slice(0, start) + a.text + raw.slice(end)
    : a.kind === 'compose'
      ? insertAt(raw, start, a.text)
      : insertAt(raw, end, a.text);

  state.draft.content = next;
  renderContent();
  markDirty();
  closeAssist();
  toast(how === 'replace' && a.kind !== 'compose' ? '已替换' : '已插入');
}

/* 插入时补足空行，避免和上下文粘在一起 */
function insertAt(raw, at, text) {
  const before = raw.slice(0, at);
  const after = raw.slice(at);
  const lead = before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : '';
  const tail = after && !after.startsWith('\n\n') ? (after.startsWith('\n') ? '\n' : '\n\n') : '';
  return before + lead + text + tail + after;
}

/* ==================================================================
 * 三动作工具条：修改 / 确认 / 导出
 *
 * 之前一排八个按钮平铺，等于把八个决定同时摆在人面前。
 * 现在只问一件事：这稿你是要改、认了、还是拿走？
 * 认了之后再问"接下来做什么"，拿走之前再问"要什么格式"——一次一个决定。
 * ================================================================== */

const closeMenus = () => {
  [el.confirmMenu, el.exportMenu].forEach((m) => m?.classList.add('hidden'));
};

function toggleMenu(menu) {
  const open = menu.classList.contains('hidden');
  closeMenus();
  if (open) menu.classList.remove('hidden');
}

el.confirmBtn.addEventListener('click', (e) => { e.stopPropagation(); syncConfirmMenu(); toggleMenu(el.confirmMenu); });

el.exportBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(el.exportMenu); });

document.addEventListener('click', (e) => { if (!e.target.closest('.menu-wrap')) closeMenus(); });

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenus(); });

/* 菜单打开前先把不可用的项灰掉，并说明为什么——比点了没反应强 */
function syncConfirmMenu() {
  const onVariant = Boolean(ver.current);
  const has = (a) => el.confirmMenu.querySelector(`[data-act="${a}"]`);
  // 口播、学习、多平台都针对原文；配图是按版本来的
  for (const a of ['cues', 'multi', 'learn', 'review']) {
    const b = has(a);
    b.disabled = onVariant;
    b.title = onVariant ? '这几项都针对原文，先切回原文版本' : '';
  }
  has('archive').disabled = Boolean(state.draft?.archived_at);
}

el.confirmMenu.addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b || b.disabled) return;
  closeMenus();
  const act = b.dataset.act;
  if (act === 'cues') { setMode('cue'); if (!state.draft?.cues) el.cuesRunBtn.click(); return; }
  if (act === 'multi') { state.multiOpen = true; renderMultiBar(); return; }
  if (act === 'illus') { el.illusBtn.click(); return; }
  if (act === 'learn') { el.learnBtn.click(); return; }
  if (act === 'review') { el.reviewBtn.click(); return; }
  if (act === 'metrics') { openMetrics(); return; }
  if (act === 'archive') await archiveCurrent();
});

async function archiveCurrent() {
  if (!state.draft?.id) return;
  try {
    await api(`/drafts/${state.draft.id}/archive`, { method: 'POST', body: { archived: true } });
    state.draft.archived_at = new Date().toISOString();
    toast('已归档，可以在「已归档」里找回');
    loadHistory();
  } catch (err) { toast(err.message); }
}

el.exportMenu.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-fmt]');
  if (!b) return;
  closeMenus();
  const fmt = b.dataset.fmt;
  if (fmt === 'copy') el.copyBtn.click();
  else if (fmt === 'pdf') exportPdf();
  else if (fmt === 'docx') downloadDocx();
  else downloadAs(fmt);          // md / html
});

/* PDF 走浏览器打印。
   自己生成 PDF 字节流要嵌中文字体，体积和复杂度都不划算；
   交给浏览器排版，中文断行和图片都是对的，用户在弹窗里选「另存为 PDF」。 */
function exportPdf() {
  el.toolHint.textContent = '打印窗口里选「目标：另存为 PDF」';
  setTimeout(() => { window.print(); }, 60);
  setTimeout(() => { el.toolHint.textContent = ''; }, 6000);
}

async function downloadDocx() {
  if (!state.draft?.id) return;
  const q = ver.current ? `?version=${encodeURIComponent(ver.current)}` : '';
  try {
    const res = await fetch(`/api/drafts/${state.draft.id}/export.docx${q}`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast(data.error || '导出 Word 失败');
      return;
    }
    const blob = await res.blob();
    const base = (state.draft.title || state.draft.subject || '文案').slice(0, 40).replace(/[\\/:*?"<>|]/g, '')
      + (ver.current ? `-${currentLabel()}` : '');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${base}.docx`;
    a.click();
    URL.revokeObjectURL(url);
    const n = (illOf()?.items || []).filter((it) => it.image).length;
    toast(n ? `已导出 Word，含 ${n} 张图` : '已导出 Word');
  } catch (err) {
    toast(err.message || '导出 Word 失败');
  }
}

/* ---------------- 正文历史：保存前留下的每一版 ---------------- */

function currentBody() {
  return state.mode === 'edit' ? (el.editor?.value || '') : (state.draft?.content || '');
}

function fmtRevTime(s) {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s || '';
  return d.toLocaleString('zh-CN', {
    hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

let revPaintTimer = 0;

function scheduleRevPaint() {
  if (!state.revOpen) return;
  clearTimeout(revPaintTimer);
  revPaintTimer = setTimeout(paintRev, 200);
}

async function toggleRevs(force) {
  const open = typeof force === 'boolean' ? force : !state.revOpen;
  if (open && !state.draft?.content && !state.revisions?.length) {
    toast('还没有正文，写完保存后才能对照');
    return;
  }
  state.revOpen = open;
  el.revPane.classList.toggle('hidden', !open);
  el.revBtn.classList.toggle('on', open);
  if (open) await loadRevs();
}

async function loadRevs() {
  if (!state.draft?.id) return;
  const { revisions } = await api(`/drafts/${state.draft.id}/revisions`);
  state.revisions = revisions;
  const still = revisions.some((r) => r.id === state.revId);
  const pick = still ? state.revId : (revisions[1]?.id || revisions[0]?.id || null);
  if (pick) await openRev(pick);
  else {
    state.revText = '';
    renderRevList();
    paintRev();
  }
}

function renderRevList() {
  const rows = state.revisions || [];
  el.revList.innerHTML = rows.length
    ? rows.map((r, i) => `
      <button type="button" class="rev-item ${r.id === state.revId ? 'on' : ''}" data-rid="${r.id}">
        <b>${esc(fmtRevTime(r.created_at))}</b>
        <span>${r.chars} 字${i === 0 ? ' · 最新存档' : ''}</span>
      </button>`).join('')
    : '<p class="rev-empty">还没有存档。写出正文并保存之后，这里会留下每一版。</p>';
}

async function openRev(id) {
  if (!state.draft) return;
  state.revId = id;
  const { revision } = await api(`/drafts/${state.draft.id}/revisions/${id}`);
  state.revText = revision.content;
  renderRevList();
  paintRev();
}

function lineDiff(aLines, bLines) {
  if (aLines.length > 800 || bLines.length > 800) {
    const n = Math.max(aLines.length, bLines.length);
    const left = [];
    const right = [];
    for (let i = 0; i < n; i++) {
      const av = aLines[i];
      const bv = bLines[i];
      const same = (av ?? '') === (bv ?? '');
      left.push({ t: av ?? '', k: av === undefined ? 'gap' : (same ? 'same' : 'diff') });
      right.push({ t: bv ?? '', k: bv === undefined ? 'gap' : (same ? 'same' : 'diff') });
    }
    return { left, right };
  }
  const n = aLines.length;
  const m = bLines.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = aLines[i] === bLines[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const left = [];
  const right = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (aLines[i] === bLines[j]) {
      left.push({ t: aLines[i], k: 'same' });
      right.push({ t: bLines[j], k: 'same' });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      left.push({ t: aLines[i], k: 'diff' });
      right.push({ t: '', k: 'gap' });
      i += 1;
    } else {
      left.push({ t: '', k: 'gap' });
      right.push({ t: bLines[j], k: 'diff' });
      j += 1;
    }
  }
  while (i < n) {
    left.push({ t: aLines[i], k: 'diff' });
    right.push({ t: '', k: 'gap' });
    i += 1;
  }
  while (j < m) {
    left.push({ t: '', k: 'gap' });
    right.push({ t: bLines[j], k: 'diff' });
    j += 1;
  }
  return { left, right };
}

function paintRev() {
  const left = state.revText || '';
  const right = currentBody();
  const { left: a, right: b } = lineDiff(left.split('\n'), right.split('\n'));
  const html = (rows) => (rows.length
    ? rows.map((row) => `<div class="rev-line ${row.k === 'same' ? '' : row.k}">${esc(row.t) || '&nbsp;'}</div>`).join('')
    : '<div class="rev-line">&nbsp;</div>');
  el.revLeft.innerHTML = html(a);
  el.revRight.innerHTML = html(b);
  const row = (state.revisions || []).find((r) => r.id === state.revId);
  const same = left === right;
  el.revLeftLabel.textContent = row
    ? `${fmtRevTime(row.created_at)}${same ? ' · 和当前一样' : ''}`
    : '选一版';
}

/* ---------------- 模式：修改 / 返回阅读 ---------------- */

el.editBtn.addEventListener('click', () => setMode('edit'));

el.revBtn.addEventListener('click', () => { toggleRevs().catch((err) => toast(err.message)); });

el.revClose.addEventListener('click', () => { toggleRevs(false).catch((err) => toast(err.message)); });

el.revList.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-rid]');
  if (!btn || !state.draft) return;
  openRev(Number(btn.dataset.rid)).catch((err) => toast(err.message));
});

el.backReadBtn.addEventListener('click', () => setMode('read'));

const MARK_MIME = 'application/x-image-mark';

let markDragged = false;

let markCaret = null;

function insertImageMark(at) {
  const ta = el.editor;
  if (!ta || !state.draft) return;
  const index = Math.max(0, Math.min(at ?? ta.selectionStart ?? ta.value.length, ta.value.length));
  const pad = index > 0 && ta.value[index - 1] !== '\n' ? '\n' : '';
  const tail = index < ta.value.length && ta.value[index] !== '\n' ? '\n' : '';
  const chunk = `${pad}${IMAGE_MARK}${tail}`;
  ta.value = ta.value.slice(0, index) + chunk + ta.value.slice(index);
  const caret = index + chunk.length;
  ta.focus();
  ta.selectionStart = ta.selectionEnd = caret;
  ta.dispatchEvent(new Event('input'));
}

/* 拖进正文时，尽量落在鼠标下的那个字。textarea 没有可靠的光标坐标时，用拖之前记下的光标。 */
function caretFromPoint(textarea, x, y) {
  const direct = document.caretPositionFromPoint?.(x, y);
  if (direct && direct.offsetNode === textarea) return direct.offset;
  const range = document.caretRangeFromPoint?.(x, y);
  if (range && range.startContainer === textarea) return range.startOffset;

  const rect = textarea.getBoundingClientRect();
  if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return null;
  const style = getComputedStyle(textarea);
  const mirror = document.createElement('div');
  mirror.style.cssText = 'position:absolute;visibility:hidden;white-space:pre-wrap;word-wrap:break-word;overflow:hidden;';
  for (const p of ['boxSizing', 'width', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'fontStyle', 'fontWeight', 'fontSize', 'fontFamily', 'lineHeight', 'letterSpacing', 'textIndent', 'tabSize']) {
    mirror.style[p] = style[p];
  }
  mirror.style.width = `${textarea.clientWidth}px`;
  document.body.appendChild(mirror);
  const localX = x - rect.left - parseFloat(style.borderLeftWidth) + textarea.scrollLeft;
  const localY = y - rect.top - parseFloat(style.borderTopWidth) + textarea.scrollTop;
  const text = textarea.value;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    mirror.textContent = text.slice(0, mid);
    const span = document.createElement('span');
    span.textContent = text[mid] || ' ';
    mirror.appendChild(span);
    const top = span.offsetTop;
    const left = span.offsetLeft;
    const w = span.offsetWidth || 8;
    const h = span.offsetHeight || parseFloat(style.lineHeight) || 20;
    span.remove();
    if (top + h < localY || (top <= localY && top + h >= localY && left + w <= localX)) lo = mid + 1;
    else hi = mid;
  }
  mirror.remove();
  return lo;
}

el.markBtn?.addEventListener('dragstart', (e) => {
  markDragged = true;
  markCaret = el.editor?.selectionStart ?? null;
  e.dataTransfer.setData(MARK_MIME, IMAGE_MARK);
  e.dataTransfer.setData('text/plain', IMAGE_MARK);
  e.dataTransfer.effectAllowed = 'copy';
});

el.markBtn?.addEventListener('dragend', () => {
  el.editor?.classList.remove('mark-over');
  setTimeout(() => { markDragged = false; }, 0);
});

el.markBtn?.addEventListener('click', () => {
  if (markDragged) { markDragged = false; return; }
  insertImageMark(el.editor?.selectionStart);
});

el.markBtn?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); insertImageMark(el.editor?.selectionStart); }
});

el.editor.addEventListener('dragover', (e) => {
  if (!markDragged) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  el.editor.classList.add('mark-over');
  const at = caretFromPoint(el.editor, e.clientX, e.clientY);
  if (at != null) {
    markCaret = at;
    el.editor.setSelectionRange(at, at);
  }
});

el.editor.addEventListener('dragleave', () => el.editor.classList.remove('mark-over'));

el.editor.addEventListener('drop', (e) => {
  const payload = e.dataTransfer?.getData(MARK_MIME) || e.dataTransfer?.getData('text/plain');
  if (payload !== IMAGE_MARK) return;
  e.preventDefault();
  el.editor.classList.remove('mark-over');
  const at = caretFromPoint(el.editor, e.clientX, e.clientY);
  insertImageMark(at ?? markCaret ?? el.editor.selectionStart);
});

/* ---------------- 语音改稿 ---------------- */

let voiceRec = null;

let voiceChunks = [];

let voiceUndo = null;

let voiceTimer = null;

function clearVoiceUndo() {
  voiceUndo = null;
  el.voiceNote?.classList.add('hidden');
}

function stopVoiceEdit() {
  if (voiceTimer) { clearTimeout(voiceTimer); voiceTimer = null; }
  if (voiceRec && voiceRec.state !== 'inactive') voiceRec.stop();
}

function setVoiceBtn(recording) {
  if (!el.voiceBtn) return;
  el.voiceBtn.classList.toggle('recording', recording);
  el.voiceBtn.textContent = recording ? '说完了' : '语音改稿';
  el.voiceBtn.disabled = false;
}

el.voiceBtn?.addEventListener('click', async () => {
  if (!state.draft?.content?.trim()) { toast('还没有正文'); return; }
  if (voiceRec && voiceRec.state === 'recording') { voiceRec.stop(); return; }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    toast('没有拿到麦克风');
    return;
  }
  const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : (MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '');
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  voiceChunks = [];
  rec.ondataavailable = (ev) => { if (ev.data?.size) voiceChunks.push(ev.data); };
  rec.onstop = () => {
    stream.getTracks().forEach((t) => t.stop());
    voiceRec = null;
    if (voiceTimer) { clearTimeout(voiceTimer); voiceTimer = null; }
    const blob = new Blob(voiceChunks, { type: rec.mimeType || 'audio/webm' });
    voiceChunks = [];
    if (state.mode === 'edit' && blob.size > 0) submitVoiceEdit(blob);
    else setVoiceBtn(false);
  };
  voiceRec = rec;
  rec.start();
  setVoiceBtn(true);
  voiceTimer = setTimeout(() => { if (voiceRec) voiceRec.stop(); }, 90000);
});

async function submitVoiceEdit(blob) {
  if (!el.voiceBtn || !state.draft) return;
  el.voiceBtn.disabled = true;
  el.voiceBtn.textContent = '识别中…';
  try {
    const res = await fetch(`/api/drafts/${state.draft.id}/voice-edit`, {
      method: 'POST',
      headers: {
        'Content-Type': blob.type || 'audio/webm',
        'X-Filename': 'voice.webm',
      },
      body: blob,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `语音改稿失败（${res.status}）`);
    showVoiceResult(data);
  } catch (err) {
    toast(err.message);
  } finally {
    setVoiceBtn(false);
  }
}

function showVoiceResult(data) {
  const heard = data.transcript ? `听到：${data.transcript}` : '';
  const understood = data.note ? `理解成：${data.note}` : '';
  if (data.changed && data.content && data.content !== el.editor.value) {
    voiceUndo = el.editor.value;
    state.voiceApplying = true;
    el.editor.value = data.content;
    el.editor.dispatchEvent(new Event('input'));
    state.voiceApplying = false;
    const n = (data.applied || []).reduce((s, x) => s + (x.count || 1), 0);
    el.voiceNote.innerHTML = `${esc(heard)}<br>${esc(understood)}<br>改了 ${n} 处。`
      + `<button type="button" class="mini" id="voiceUndoBtn">撤销</button>`;
    el.voiceNote.classList.remove('hidden');
    document.getElementById('voiceUndoBtn')?.addEventListener('click', () => {
      if (voiceUndo == null) return;
      state.voiceApplying = true;
      el.editor.value = voiceUndo;
      el.editor.dispatchEvent(new Event('input'));
      state.voiceApplying = false;
      clearVoiceUndo();
      toast('已撤销这次语音改稿');
    });
    return;
  }
  const why = (data.skipped || []).filter(Boolean).join('；');
  el.voiceNote.innerHTML = `${esc(heard)}${understood ? `<br>${esc(understood)}` : ''}`
    + `<br>正文没有改。${why ? esc(why) : ''}`;
  el.voiceNote.classList.remove('hidden');
  voiceUndo = null;
}

/* 模式变了就更新工具条的样子——哪个按钮该出现、指示器写什么 */
function syncModeUi(mode) {
  const reading = mode === 'read';
  const editing = mode === 'edit';
  el.editBtn.classList.toggle('hidden', !reading);
  el.backReadBtn.classList.toggle('hidden', reading);
  el.modeNow.classList.toggle('hidden', reading);
  el.modeNow.textContent = editing ? '编辑中' : mode === 'cue' ? '口播' : '';
  // 保存只在编辑时有意义，跟着模式露出/收起
  el.saveBtn.classList.toggle('hidden', !editing);
  el.saveState.classList.toggle('hidden', !editing);
  el.markDock?.classList.toggle('hidden', !editing);
}

/* 完整设定默认折起来——侧栏是长期占屏的东西，平时用不着把整份设定摊在那儿 */
el.personaMoreBtn.addEventListener('click', () => {
  state.personaOpen = !state.personaOpen;
  el.personaMoreBtn.setAttribute('aria-expanded', String(state.personaOpen));
  el.personaMoreBtn.firstChild.textContent = state.personaOpen ? '收起完整设定 ' : '展开完整设定 ';
  el.personaSummary.classList.toggle('hidden', !state.personaOpen);
});
