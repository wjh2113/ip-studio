/* 第三步：成稿区。正文的唯一真相是 studio.draft.content（Markdown 原文）。
 *
 *   流式成稿（选了方向之后）      generate
 *   阅读 / 编辑 / 口播三种模式    setMode
 *   保存：改完 1.2 秒自动存，离开编辑或手动保存时一定留一版历史   markDirty / flushSave
 *   划词改写、/ 续写的 AI 浮层     runAssist / applyAssist
 *   正文历史：保存前留下的每一版，和现在这篇逐行对照   toggleRevs / openRev
 *   按意见整篇重写（右栏对话确认后调用），写完列逐段对照   revise
 *   归档、导出（复制 / Markdown / 图文 / Word / PDF）
 * 多平台版本和配图在 versions.js，口播在 speak.js，成稿检查在 review.js。 */
import { defineStore } from 'pinia';
import { computed, nextTick, reactive, ref } from 'vue';
import { api, saveBlob, stream } from '../lib/api.js';
import { toast } from '../lib/feedback.js';
import { esc, markdown, safeName } from '../lib/text.js';
import { caretRect } from '../lib/caret.js';
import { locateInArticle, locateInTextarea } from '../lib/locate.js';
import { useStudioStore } from './studio.js';
import { useBriefStore } from './brief.js';
import { useHistoryStore } from './history.js';
import { imageUrl, useVersionsStore, weave } from './versions.js';
import { useSpeakStore } from './speak.js';
import { IMAGE_MARK } from '../../../shared/place.js';

export const ASSIST_ACTIONS = [
  { key: 'expand', label: '扩写' },
  { key: 'professional', label: '专业点' },
  { key: 'casual', label: '轻松点' },
  { key: 'shorten', label: '缩写' },
  { key: 'example', label: '举个例子' },
  { key: 'simplify', label: '更好懂' },
  { key: 'humanize', label: '去 AI 味' },
  { key: 'summarize', label: '总结要点' },
  { key: 'translate', label: '译成英文' },
];

export const COMPOSE_ACTIONS = [
  { key: 'continue', label: '续写这一段' },
  { key: 'opening', label: '写个开头' },
  { key: 'heading', label: '加个小标题' },
  { key: 'ending', label: '写个结尾' },
];

/* 插入时补足空行，避免和上下文粘在一起 */
export function insertAt(raw, at, text) {
  const before = raw.slice(0, at);
  const after = raw.slice(at);
  const lead = before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : '';
  const tail = after && !after.startsWith('\n\n') ? (after.startsWith('\n') ? '\n' : '\n\n') : '';
  return before + lead + text + tail + after;
}

/* 逐行对照（LCS）。太长就退回按行号对齐，免得卡住页面 */
export function lineDiff(aLines, bLines) {
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
      dp[i][j] = aLines[i] === bLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
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
  while (i < n) { left.push({ t: aLines[i], k: 'diff' }); right.push({ t: '', k: 'gap' }); i += 1; }
  while (j < m) { left.push({ t: '', k: 'gap' }); right.push({ t: bLines[j], k: 'diff' }); j += 1; }
  return { left, right };
}

export function fmtRevTime(s) {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s || '';
  return d.toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export const useEditorStore = defineStore('editor', () => {
  const s = () => useStudioStore();

  /* ---------- 流式成稿 ---------- */
  const live = reactive({ text: '', error: '', title: '' });   // 生成中的正文、出错时的说明

  /* 停止：成稿、整篇重写共用一个；点了就断开连接，服务端停掉模型、把原稿恢复（按已生成字数扣点） */
  let streamCtrl = null;
  function stopStream() { streamCtrl?.abort(); }

  async function generate(index) {
    const st = s();
    const draft = st.draft;
    const topic = draft?.topics?.[index];
    if (!topic || st.streaming) return;
    // 从编辑模式直接选方向：先把没存的改动存完，再开始生成——不然保存可能落在「生成中」之后，把状态搅乱
    if (st.mode === 'edit') { await flushSave(true); st.mode = 'read'; }
    closeAssist();
    st.streaming = true;
    useBriefStore().goStep(3);
    live.title = topic.title;
    live.text = '';
    live.error = '';
    const ctrl = (streamCtrl = new AbortController());
    try {
      await stream(`/drafts/${draft.id}/content`, { index }, (event, data) => {
        if (event === 'delta') live.text += data.text;
        else if (event === 'done') {
          if (st.draft?.id !== draft.id) return;     // 生成期间被切走了（理论上会拦住，这里再兜一层）
          st.draft = data.draft;
          resetHistory();                    // 新生成的正文：之前的撤销记录不再适用
          live.title = '';
          useBriefStore().goStep(3, { done: true, scroll: false });
          useHistoryStore().load();
          // 成稿检查改手动：工具栏点「检查」。避免重新生成 / 换方向时反复花额度
        } else if (event === 'error') {
          throw new Error(data.message);
        }
      }, { signal: ctrl.signal });
    } catch (err) {
      live.error = ctrl.signal.aborted ? '已停止' : err.message;
      // 服务端在失败时会把原来的稿子恢复回去（重新生成失败不会把已有的正文清掉）：取回来显示。
      // 网络断开时服务端可能还没来得及恢复（它要先察觉连接断了）：看到还是 writing 就稍等再取
      try {
        let fresh;
        for (let i = 0; i < 5; i += 1) {
          ({ draft: fresh } = await api(`/drafts/${draft.id}`));
          if (fresh.status !== 'writing') break;
          await new Promise((r) => setTimeout(r, 400));
        }
        if (st.draft?.id === fresh.id && fresh.status !== 'writing') {
          st.draft = fresh;
          if (fresh.content) {
            live.error = '';
            live.title = '';
            toast(ctrl.signal.aborted ? '已停止，原来那版还在' : `生成中断：${err.message}。原来那版还在`);
          }
          useHistoryStore().load();
        }
      } catch { /* 取不回来就停在错误提示上 */ }
    } finally {
      st.streaming = false;
      if (streamCtrl === ctrl) streamCtrl = null;
    }
  }

  /* 按意见重写之后的段落对照：before/after，可单独退回某段 */
  const reviseCompare = ref(null);   // { version, before, after } | null
  const progressLabel = ref('');     // 慢操作当前步骤文案

  /* 按意见重写：整篇在原稿上重写（版本栏开着哪一版就改哪一版）。入口在右栏对话：AI 判断要整篇改、作者点「开始重写」。
     mode = 'full' 直接整篇重写（对话已经判断过）；不传由服务端按意见里的关键词决定。
     流式显示；写完服务端才落盘，原稿留一版历史，这里再记一步撤销，Ctrl+Z 能退回。失败原稿不动 */
  async function revise(notes, { mode = '', from = '' } = {}) {
    const st = s();
    const draft = st.draft;
    const ver = editVer.value;
    const before = textOf(ver);
    if (!draft || !before.trim() || st.streaming) return false;
    if (st.mode === 'edit') { await flushSave(true); st.mode = 'read'; }
    else await flushSave();
    closeAssist();
    reviseCompare.value = null;
    st.streaming = true;
    live.title = '按意见重写中';
    live.text = '';
    live.error = '';
    progressLabel.value = '正在按意见重写…';
    let ok = false;
    let after = '';
    const ctrl = (streamCtrl = new AbortController());
    try {
      await stream(`/drafts/${draft.id}/revise`, { notes, version: ver, ...(mode ? { mode } : {}), ...(from ? { from } : {}) }, (event, data) => {
        if (event === 'progress') progressLabel.value = data.label || progressLabel.value;
        else if (event === 'delta') live.text += data.text;
        else if (event === 'done') {
          if (st.draft?.id !== draft.id) return;
          if (hist.id !== histKey()) resetHistory();
          hist.undo.push(before);
          hist.redo = [];
          st.draft = data.draft;
          after = textOf(ver);
          ok = true;
        } else if (event === 'error') throw new Error(data.message);
      }, { signal: ctrl.signal });
    } catch (err) {
      toast(ctrl.signal.aborted ? '已停止，原稿没动' : `没改成：${err.message}。原稿没动`);
    } finally {
      live.title = '';
      live.text = '';
      progressLabel.value = '';
      st.streaming = false;   // 先放开：后面 toast / 打开对照时 Ctrl+Z 才能撤
      if (streamCtrl === ctrl) streamCtrl = null;
    }
    if (ok) {
      reviseCompare.value = { version: ver, before, after: textOf(ver) || after };
      toast('已按意见重写：对照里可把某段退回');
      useHistoryStore().load();
      if (!ver) await toggleRevs(true);   // 原文顺带打开历史对照
    }
    return ok;
  }

  function closeReviseCompare() { reviseCompare.value = null; }

  /* 把第 i 段（按空行分段）退回重写前的内容 */
  function revertReviseParagraph(i) {
    const cmp = reviseCompare.value;
    if (!cmp) return;
    const oldParts = splitParas(cmp.before);
    const newParts = splitParas(textOf(cmp.version));
    if (i < 0 || i >= newParts.length || i >= oldParts.length) return;
    newParts[i] = oldParts[i];
    const next = newParts.join('\n\n');
    replaceContent(next, cmp.version);
    reviseCompare.value = { ...cmp, after: next };
    toast(`已退回第 ${i + 1} 段`);
  }

  function splitParas(text) {
    return String(text || '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
  }

  /* 阅读区现在该显示什么：生成中 / 出错 / 正文 */
  const streamingView = computed(() => s().streaming || Boolean(live.error));

  /* 全屏：中间成稿框铺满视口，阅读和编辑都可用 */
  const editFs = ref(false);
  function setEditFs(on) {
    editFs.value = !!on;
    document.body.classList.toggle('edit-fs-on', editFs.value);
    if (!editFs.value) return;
    window.scrollTo(0, 0);
    requestAnimationFrame(() => {
      const el = document.getElementById('workMain');
      if (el) el.scrollTop = 0;
    });
  }
  function toggleEditFs() { setEditFs(!editFs.value); }

  /* ---------- 模式 ---------- */
  function setMode(mode) {
    const st = s();
    if (st.streaming) return;
    if (st.mode === 'edit' && mode !== 'edit') {
      flushSave(true);      // 离开编辑就落盘，并留一版历史
    }
    st.mode = mode;
    menus.sel = null;
    menus.slash = null;
    if (mode === 'cue') useSpeakStore().loadDraftSpeaks();
  }

  /* ---------- 定位：检查结果、AI 味提示点一下，左边正文滚到那句并高亮 ----------
     ver：这句话在哪一版里（检查只针对原文，所以默认 ''）。口播模式下正文不在，先回到阅读 */
  async function locate(quote, { ver = '', quiet = false } = {}) {
    const st = s();
    if (!quote || !st.draft || st.streaming) return false;
    const v = useVersionsStore();
    if ((v.current || '') !== ver) v.switchTo(ver);
    if (st.mode === 'cue') setMode('read');
    await nextTick();
    await nextTick();
    const el = document.getElementById('editor');
    const ok = st.mode === 'edit'
      ? (el?._rich ? el._rich.locate(quote) : locateInTextarea(el, quote, caretRect))
      : locateInArticle(document.getElementById('content'), quote);
    if (!ok && !quiet) toast('正文里没找到这一句，可能已经改过了');
    return ok;
  }

  /* ---------- 保存 ---------- */
  const save = reactive({ text: '', kind: '' });     // 保存中 / 已保存 / 未保存 / 失败
  let saveTimer = 0;

  /* 编辑的是哪一版：版本栏选了小红书，编辑框里就是小红书版本，改的也是它。'' = 原文 */
  const editVer = computed(() => useVersionsStore().current || '');
  const textOf = (ver) => {
    const d = s().draft;
    if (!d) return '';
    return ver ? String(d.variants?.[ver]?.content ?? '') : String(d.content ?? '');
  };
  /* 编辑框里显示的正文 */
  const text = computed(() => textOf(editVer.value));
  function setText(ver, value) {
    const d = s().draft;
    if (!ver) { d.content = value; return; }
    const variants = { ...(d.variants || {}) };
    variants[ver] = { ...(variants[ver] || {}), content: value, chars: value.length };
    d.variants = variants;
  }
  const dirtyVers = new Set();      // 改过还没存的平台版本

  function markDirty(ver = '') {
    const st = s();
    if (ver) dirtyVers.add(ver);
    else st.dirty = true;
    save.text = '未保存';
    save.kind = 'dirty';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 1200);
  }

  /* snapshot = true：手动保存或离开编辑，服务端一定留一版历史；自动保存不带，按时间间隔留 */
  async function flushSave(snapshot = false) {
    clearTimeout(saveTimer);
    const st = s();
    if (st.draft && dirtyVers.size) await flushVariants();
    if (!st.dirty || !st.draft) return;
    const content = st.draft.content;
    const id = st.draft.id;
    st.dirty = false;
    save.text = '保存中…';
    save.kind = '';
    try {
      const { draft, kept } = await api(`/drafts/${id}/content`, { method: 'PUT', body: { content, snapshot: snapshot === true } });
      if (st.draft?.id !== id) return;
      // 保存在路上的时候又改了：服务端回来的是旧正文，留着本地新的，再存一次
      const newer = st.draft.content !== content;
      st.draft = newer ? { ...draft, content: st.draft.content } : draft;
      if (newer) markDirty();
      else { save.text = '已保存'; save.kind = 'saved'; }
      const notes = [];
      if (kept?.cuesDropped) notes.push(`口播提示拿掉了 ${kept.cuesDropped} 条对不上的`);
      if (kept?.illusDropped) notes.push(`配图拿掉了 ${kept.illusDropped} 张对不上的`);
      if (notes.length) toast(notes.join('，'));
      useHistoryStore().load();
      if (st.revOpen) loadRevs().catch(() => {});
    } catch (err) {
      st.dirty = true;
      save.text = `保存失败：${err.message}`;
      save.kind = 'dirty';
      toast(`保存失败：${err.message}`);
    }
  }

  /* 平台版本：只存改过的那几版 */
  async function flushVariants() {
    const st = s();
    const id = st.draft.id;
    const vers = [...dirtyVers];
    dirtyVers.clear();
    save.text = '保存中…';
    save.kind = '';
    for (const ver of vers) {
      const content = textOf(ver);
      try {
        const { variant } = await api(`/drafts/${id}/variants/${ver}`, { method: 'PUT', body: { content } });
        if (st.draft?.id !== id) return;
        // 存的时候又改了：留着本地新的，再存一次
        if (textOf(ver) !== content) { markDirty(ver); continue; }
        st.draft.variants = { ...(st.draft.variants || {}), [ver]: variant };
      } catch (err) {
        dirtyVers.add(ver);
        save.text = `保存失败：${err.message}`;
        save.kind = 'dirty';
        toast(`保存失败：${err.message}`);
        return;
      }
    }
    if (!st.dirty && !dirtyVers.size) { save.text = '已保存'; save.kind = 'saved'; }
  }

  /* ---------- 撤销 / 重做（Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y） ----------
     浏览器自带的撤销只认键盘敲的字：正文一被脚本改过（AI 改写、采纳检查、插图片标记、语音改稿），
     自带的撤销记录就断了，Ctrl+Z 什么都不做。所以撤销自己记：每次改正文前存一份「改之前」，
     连续打字（两次输入间隔不到 1.2 秒）算一步，AI 和采纳这类改动各自算一步。换一篇稿子、重新生成就清空。 */
  const UNDO_MAX = 200;
  const TYPE_GAP = 1200;
  const hist = reactive({ id: null, undo: [], redo: [] });
  let typingAt = 0;
  // 每一版各有自己的撤销记录：在小红书版里 Ctrl+Z 不会撤到原文上
  const histKey = () => (s().draft ? `${s().draft.id}:${editVer.value}` : null);

  function resetHistory() {
    hist.id = histKey();
    hist.undo = [];
    hist.redo = [];
    typingAt = 0;
  }

  function record(before, typing) {
    const st = s();
    if (!st.draft) return;
    if (hist.id !== histKey()) resetHistory();
    const now = Date.now();
    if (typing && typingAt && now - typingAt < TYPE_GAP) { typingAt = now; return; }   // 同一段连续输入
    hist.undo.push(before);
    if (hist.undo.length > UNDO_MAX) hist.undo.shift();
    hist.redo = [];
    typingAt = typing ? now : 0;
  }

  const canUndo = computed(() => hist.id === histKey() && hist.undo.length > 0);
  const canRedo = computed(() => hist.id === histKey() && hist.redo.length > 0);

  /* 回到上一步 / 下一步；返回 { before, after } 给编辑框放光标，没得撤就返回 null */
  function step(from, to) {
    const st = s();
    if (!st.draft || hist.id !== histKey() || !from.length || st.streaming) return null;
    const ver = editVer.value;
    const before = textOf(ver);
    const after = from.pop();
    to.push(before);
    typingAt = 0;
    setText(ver, after);
    markDirty(ver);
    return { before, after };
  }
  const undo = () => step(hist.undo, hist.redo);
  const redo = () => step(hist.redo, hist.undo);

  /* 编辑框里改了字。typing = 键盘输入（连续的合成一步撤销）；其余（插标记、删斜杠）各算一步 */
  function onInput(value, { typing = false } = {}) {
    const st = s();
    const ver = editVer.value;
    if (!st.draft || value === textOf(ver)) return;
    record(textOf(ver), typing);
    setText(ver, value);
    markDirty(ver);
  }

  /* 改写、采纳检查意见这类直接改正文的：单独算一步，Ctrl+Z 能撤回。
     ver 不给 = 编辑框正在编辑的那一版；检查结果只针对原文，传 '' */
  function replaceContent(next, ver = editVer.value) {
    const st = s();
    if (!st.draft || next === textOf(ver)) return;
    if (ver === editVer.value) record(textOf(ver), false);
    setText(ver, next);
    markDirty(ver);
  }

  /* ---------- 划词菜单与 / 菜单（位置由组件量好放进来） ---------- */
  const menus = reactive({ sel: null, slash: null });   // sel: { left, top, bottom, target } · slash: { left, top, bottom, at }

  /* ---------- AI 浮层：划词改写、/ 续写 ---------- */
  const assist = ref(null);
  let assistCtrl = null;   // { label, kind, action, instruction, target, text, done, error }

  async function runAssist(req, label) {
    const st = s();
    const draft = st.draft;
    if (!draft) return;
    assistCtrl?.abort();
    const ctrl = (assistCtrl = new AbortController());
    const a = reactive({ ...req, label, text: '', done: false, error: '', stopped: false });
    assist.value = a;
    const { start, end, text } = req.target;
    const raw = textOf(editVer.value);
    const body = {
      kind: req.kind === 'compose' ? 'compose' : 'rewrite',
      action: req.action,
      instruction: req.instruction,
      ...(req.skillId ? { skillId: req.skillId } : {}),
      selection: text,
      before: raw.slice(Math.max(0, start - 600), start),
      after: raw.slice(end, end + 600),
    };
    try {
      await stream(`/drafts/${draft.id}/assist`, body, (event, data) => {
        if (assist.value !== a) return;
        if (event === 'delta') a.text += data.text;
        else if (event === 'done') a.text = (data.text || a.text).trim();
        else if (event === 'error') throw new Error(data.message);
      }, { signal: ctrl.signal });
      a.text = a.text.trim();
      a.done = true;
    } catch (err) {
      if (ctrl.signal.aborted) {
        // 点了「停止」：写出来的留着，照样能替换、插入
        if (assist.value === a) { a.text = a.text.trim(); a.done = true; a.stopped = true; }
        return;
      }
      a.error = err.message;
    } finally {
      if (assistCtrl === ctrl) assistCtrl = null;
    }
  }

  function stopAssist() { assistCtrl?.abort(); }

  function retryAssist() {
    const a = assist.value;
    if (a) runAssist({ action: a.action, kind: a.kind, instruction: a.instruction, skillId: a.skillId, target: a.target }, a.label);
  }

  function closeAssist() {
    assistCtrl?.abort();      // 关浮层也顺手停掉还在写的
    assist.value = null;
  }

  function applyAssist(how) {
    const a = assist.value;
    const st = s();
    if (!a?.text || !st.draft) return;
    const { start, end } = a.target;
    const raw = textOf(editVer.value);
    const next = how === 'replace' && a.kind !== 'compose'
      ? raw.slice(0, start) + a.text + raw.slice(end)
      : insertAt(raw, a.kind === 'compose' ? start : end, a.text);
    replaceContent(next);
    closeAssist();
    toast(how === 'replace' && a.kind !== 'compose' ? '已替换' : '已插入');
  }

  /* ---------- 正文历史 ---------- */
  async function toggleRevs(force) {
    const st = s();
    const open = typeof force === 'boolean' ? force : !st.revOpen;
    if (open && !st.draft?.content && !st.revisions?.length) {
      toast('还没有正文，写完保存后才能对照');
      return;
    }
    st.revOpen = open;
    if (open) await loadRevs();
  }

  async function loadRevs() {
    const st = s();
    if (!st.draft?.id) return;
    const { revisions } = await api(`/drafts/${st.draft.id}/revisions`);
    st.revisions = revisions;
    const still = revisions.some((r) => r.id === st.revId);
    // 默认对照上一版（最新那版通常就是现在这篇）
    const pick = still ? st.revId : (revisions[1]?.id || revisions[0]?.id || null);
    if (pick) await openRev(pick);
    else st.revText = '';
  }

  async function openRev(id) {
    const st = s();
    if (!st.draft) return;
    st.revId = id;
    const { revision } = await api(`/drafts/${st.draft.id}/revisions/${id}`);
    if (st.revId === id) st.revText = revision.content;
  }

  /* ---------- 归档 ---------- */
  async function archiveCurrent() {
    const st = s();
    if (!st.draft?.id) return;
    try {
      await api(`/drafts/${st.draft.id}/archive`, { method: 'POST', body: { archived: true } });
      st.draft.archived_at = new Date().toISOString();
      toast('已归档，可以在「已归档」里找回');
      useHistoryStore().load();
    } catch (err) { toast(err.message); }
  }

  /* ---------- 导出：都跟着当前正在看的版本走 ---------- */
  const toolHint = ref('');
  const exporting = ref(false);

  const fileBase = () => {
    const d = s().draft;
    const v = useVersionsStore();
    return safeName(d.title || d.subject || '文案') + (v.current ? `-${v.label}` : '');
  };

  const readDataUri = (blob) => new Promise((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(r.result);
    r.onerror = no;
    r.readAsDataURL(blob);
  });

  /* 把图读成 data URI。剪贴板里放图片链接没用——指向本站且要登录态，粘到公众号编辑器那边取不到 */
  async function inlineImages(items) {
    const out = new Map();
    await Promise.all(items.filter((it) => it.image).map(async (it) => {
      try {
        const res = await fetch(imageUrl(it.image));
        if (!res.ok) return;
        out.set(it.i, await readDataUri(await res.blob()));
      } catch { /* 单张读不到就跳过，别让整次复制失败 */ }
    }));
    return out;
  }

  /* 正文里手贴的图是 ![](/image/…)，不在配图方案里，复制时也要嵌成 data URI */
  async function inlineDocImages(text) {
    const urls = [...new Set([...String(text).matchAll(/!\[([^\]]*)\]\((\/image\/\d+\/[\w.-]+)\)/g)].map((m) => m[2]))];
    const out = new Map();
    await Promise.all(urls.map(async (url) => {
      try {
        const res = await fetch(url);
        if (!res.ok) return;
        out.set(url, await readDataUri(await res.blob()));
      } catch { /* 单张读不到就跳过 */ }
    }));
    return out;
  }

  /* 带图的富文本：配图方案和正文里的图都嵌成 data URI */
  async function richHtml(text) {
    const items = useVersionsStore().illus?.items || [];
    const [uris, docImgs] = await Promise.all([inlineImages(items), inlineDocImages(text)]);
    let html = weave(text, items, markdown, (it) => {
      const uri = uris.get(it.i);
      if (!uri) return '';
      return `<figure style="margin:22px 0"><img src="${uri}" alt="${esc(it.alt)}" style="max-width:100%">`
        + (it.alt ? `<figcaption style="font-size:13px;color:#888;text-align:center;margin-top:6px">${esc(it.alt)}</figcaption>` : '')
        + '</figure>';
    });
    html = html.replace(/src="(\/image\/\d+\/[\w.-]+)"/g, (full, url) => (docImgs.get(url) ? `src="${docImgs.get(url)}"` : full));
    html = inlineTableStyle(html);
    return { html, imgs: uris.size + docImgs.size };
  }

  /* 表格贴到公众号、Word 里没有我们的样式表：边框、表头底色、内边距写成行内样式 */
  function inlineTableStyle(html) {
    const cell = 'border:1px solid #d9d9d9;padding:6px 10px;vertical-align:top;';
    return html
      .replace(/<div class="md-table">/g, '<div>')
      .replace(/<table>/g, '<table style="border-collapse:collapse;width:100%;margin:16px 0;font-size:14px;line-height:1.6">')
      .replace(/<th( style="text-align:(\w+)")?>/g, (_, __, a) => `<th style="${cell}background:#f5f6f8;font-weight:600;text-align:${a || 'left'}">`)
      .replace(/<td( style="text-align:(\w+)")?>/g, (_, __, a) => `<td style="${cell}${a ? `text-align:${a};` : ''}">`);
  }

  /* 纯文本出口（复制时的纯文本、下载 Markdown）：「此处放图片」只是编辑时的插图位置记号，不该带出去。
     带图的富文本里，有图的位置换成图、没图的直接去掉（weave 已经处理）；纯文本里一律去掉，多出的空行收掉 */
  function plainOut(text) {
    return String(text || '').split(IMAGE_MARK).join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  /* 剪贴板 HTML 带上片段标记，公众号 / Word 才会认加粗、颜色，而不是只取纯文本 */
  function clipboardHtml(body) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><!--StartFragment-->${body}<!--EndFragment--></body></html>`;
  }

  async function copy() {
    const v = useVersionsStore();
    const text = v.text;
    if (!text || exporting.value) return;
    exporting.value = true;
    const label = v.current ? `「${v.label}」版本` : '';
    try {
      const { html, imgs } = await richHtml(text);
      if (window.ClipboardItem) {
        // 富文本编辑器取 HTML（加粗、颜色、图），纯文本处取 markdown
        await navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([clipboardHtml(html)], { type: 'text/html' }),
          'text/plain': new Blob([plainOut(text)], { type: 'text/plain' }),
        })]);
        toast(imgs ? `已复制${label}，带 ${imgs} 张图` : `已复制${label || '到剪贴板'}`);
        return;
      }
      await navigator.clipboard.writeText(plainOut(text));
      toast(imgs ? `已复制${label}（这个浏览器带不了图，用「下载图文」）` : `已复制${label || '到剪贴板'}`);
    } catch {
      toast('复制失败，请手动选中文本');
    } finally {
      exporting.value = false;
    }
  }

  /* md：纯文本；html：自包含的单个网页，图嵌在里面（浏览器打开全选复制，任何富文本编辑器都能接） */
  async function download(fmt) {
    const v = useVersionsStore();
    const text = v.text;
    if (!text || exporting.value) return;
    exporting.value = true;
    try {
      const base = fileBase();
      if (fmt === 'md') {
        saveBlob(new Blob([plainOut(text)], { type: 'text/markdown;charset=utf-8' }), `${base}.md`);
        return;
      }
      const { html, imgs } = await richHtml(text);
      const page = `<!doctype html><meta charset="utf-8"><title>${esc(base)}</title>`
        + '<body style="max-width:720px;margin:40px auto;padding:0 20px;'
        + 'font:16px/1.8 -apple-system,\'PingFang SC\',sans-serif;color:#1a1a1a">' + html;
      saveBlob(new Blob([page], { type: 'text/html;charset=utf-8' }), `${base}.html`);
      if (imgs) toast(`已下载，含 ${imgs} 张图（浏览器打开后全选复制即可粘进编辑器）`);
    } finally {
      exporting.value = false;
    }
  }

  async function downloadDocx() {
    await flushSave(true);
    const st = s();
    const v = useVersionsStore();
    if (!st.draft?.id) return;
    const q = v.current ? `?version=${encodeURIComponent(v.current)}` : '';
    try {
      const res = await fetch(`/api/drafts/${st.draft.id}/export.docx${q}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data.error || '导出 Word 失败');
        return;
      }
      saveBlob(await res.blob(), `${fileBase()}.docx`);
      toast(v.imageCount ? `已导出 Word，含 ${v.imageCount} 张图` : '已导出 Word');
    } catch (err) {
      toast(err.message || '导出 Word 失败');
    }
  }

  /* 打印时先露出阅读排版（编辑框在打印样式里是藏掉的），加粗和颜色才进得了 PDF */
  const printing = ref(false);
  async function exportPdf() {
    await flushSave(true);
    printing.value = true;
    toolHint.value = '打印窗口里选「目标：另存为 PDF」';
    await nextTick();
    const done = () => {
      printing.value = false;
      toolHint.value = '';
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    window.print();
  }

  /* 换了一篇稿子：成稿区回到初始状态 */
  function reset() {
    const st = s();
    clearTimeout(saveTimer);
    reviseCompare.value = null;
    progressLabel.value = '';
    closeAssist();
    menus.sel = null;
    menus.slash = null;
    live.text = '';
    live.error = '';
    live.title = '';
    save.text = '';
    save.kind = '';
    st.mode = 'read';
    st.revOpen = false;
    setEditFs(false);
  }

  return {
    live, streamingView, generate, setMode, editFs, setEditFs, toggleEditFs,
    revise, reviseCompare, closeReviseCompare, revertReviseParagraph, progressLabel,
    save, markDirty, flushSave, onInput, replaceContent, text, editVer, locate, undo, redo, canUndo, canRedo, resetHistory,
    menus, assist, runAssist, retryAssist, closeAssist, applyAssist, stopAssist, stopStream,
    toggleRevs, loadRevs, openRev,
    archiveCurrent, toolHint, exporting, printing, copy, download, downloadDocx, exportPdf,
    reset,
  };
});
