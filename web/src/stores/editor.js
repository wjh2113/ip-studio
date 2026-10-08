/* 第三步：成稿区。正文的唯一真相是 studio.draft.content（Markdown 原文）。
 *
 *   流式成稿（选了方向之后）      generate
 *   阅读 / 编辑 / 口播三种模式    setMode
 *   保存：改完 1.2 秒自动存，离开编辑或手动保存时一定留一版历史   markDirty / flushSave
 *   划词改写、/ 续写的 AI 浮层     runAssist / applyAssist
 *   正文历史：保存前留下的每一版，和现在这篇逐行对照   toggleRevs / openRev
 *   语音改稿：说改哪里、怎么改    toggleVoice
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
import { useReviewStore } from './review.js';
import { useSpeakStore } from './speak.js';

export const ASSIST_ACTIONS = [
  { key: 'expand', label: '扩写' },
  { key: 'professional', label: '专业点' },
  { key: 'casual', label: '轻松点' },
  { key: 'shorten', label: '缩写' },
  { key: 'example', label: '举个例子' },
  { key: 'simplify', label: '更好懂' },
  { key: 'humanize', label: '去 AI 味' },
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

  async function generate(index) {
    const st = s();
    const draft = st.draft;
    const topic = draft?.topics?.[index];
    if (!topic || st.streaming) return;
    // 从编辑模式直接选方向：先把没存的改动存完，再开始生成——不然保存可能落在「生成中」之后，把状态搅乱
    if (st.mode === 'edit') { stopVoice(); await flushSave(true); st.mode = 'read'; }
    closeAssist();
    st.streaming = true;
    useBriefStore().goStep(3);
    live.title = topic.title;
    live.text = '';
    live.error = '';
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
          useReviewStore().run();          // 出稿后自动过一遍错字和通顺性
        } else if (event === 'error') {
          throw new Error(data.message);
        }
      });
    } catch (err) {
      live.error = err.message;
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
            toast(`生成中断：${err.message}。原来那版还在`);
          }
          useHistoryStore().load();
        }
      } catch { /* 取不回来就停在错误提示上 */ }
    } finally {
      st.streaming = false;
    }
  }

  /* 阅读区现在该显示什么：生成中 / 出错 / 正文 */
  const streamingView = computed(() => s().streaming || Boolean(live.error));

  /* ---------- 模式 ---------- */
  function setMode(mode) {
    const st = s();
    if (st.streaming) return;
    if (st.mode === 'edit' && mode !== 'edit') {
      stopVoice();
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
    const ok = st.mode === 'edit'
      ? locateInTextarea(document.getElementById('editor'), quote, caretRect)
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
    voiceNote.value = null;
    setText(ver, after);
    markDirty(ver);
    return { before, after };
  }
  const undo = () => step(hist.undo, hist.redo);
  const redo = () => step(hist.redo, hist.undo);

  /* 编辑框里改了字。typing = 键盘输入（连续的合成一步撤销）；其余（插标记、删斜杠、语音改稿）各算一步 */
  function onInput(value, { voice = false, typing = false } = {}) {
    const st = s();
    const ver = editVer.value;
    if (!st.draft || value === textOf(ver)) return;
    if (!voice) voiceNote.value = null;          // 手动改过了，语音改稿的「撤销」就不作数了
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
  const assist = ref(null);   // { label, kind, action, instruction, target, text, done, error }

  async function runAssist(req, label) {
    const st = s();
    const draft = st.draft;
    if (!draft) return;
    const a = reactive({ ...req, label, text: '', done: false, error: '' });
    assist.value = a;
    const { start, end, text } = req.target;
    const raw = textOf(editVer.value);
    const body = {
      kind: req.kind === 'compose' ? 'compose' : 'rewrite',
      action: req.action,
      instruction: req.instruction,
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
      });
      a.text = a.text.trim();
      a.done = true;
    } catch (err) {
      a.error = err.message;
    }
  }

  function retryAssist() {
    const a = assist.value;
    if (a) runAssist({ action: a.action, kind: a.kind, instruction: a.instruction, target: a.target }, a.label);
  }

  function closeAssist() {
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

  /* ---------- 语音改稿 ---------- */
  const voice = reactive({ recording: false, recognizing: false });
  const voiceNote = ref(null);       // { heard, understood, changed, why, undo }
  let rec = null;
  let chunks = [];
  let voiceTimer = 0;

  function stopVoice() {
    clearTimeout(voiceTimer);
    if (rec && rec.state !== 'inactive') rec.stop();
  }

  async function toggleVoice() {
    const st = s();
    if (!st.draft?.content?.trim()) { toast('还没有正文'); return; }
    if (rec && rec.state === 'recording') { rec.stop(); return; }
    if (editVer.value) { toast('语音改稿只改原文：先在版本栏切回原文'); return; }
    let mediaStream;
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast('没有拿到麦克风');
      return;
    }
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
      : (MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '');
    const r = new MediaRecorder(mediaStream, mime ? { mimeType: mime } : undefined);
    chunks = [];
    r.ondataavailable = (ev) => { if (ev.data?.size) chunks.push(ev.data); };
    r.onstop = () => {
      mediaStream.getTracks().forEach((t) => t.stop());
      rec = null;
      clearTimeout(voiceTimer);
      voice.recording = false;
      const blob = new Blob(chunks, { type: r.mimeType || 'audio/webm' });
      chunks = [];
      if (s().mode === 'edit' && blob.size > 0) submitVoice(blob);
    };
    rec = r;
    r.start();
    voice.recording = true;
    voiceTimer = setTimeout(() => { if (rec) rec.stop(); }, 90000);      // 一次最多说一分半
  }

  async function submitVoice(blob) {
    const st = s();
    if (!st.draft) return;
    const id = st.draft.id;
    voice.recognizing = true;
    try {
      const res = await fetch(`/api/drafts/${id}/voice-edit`, {
        method: 'POST',
        headers: { 'Content-Type': blob.type || 'audio/webm', 'X-Filename': 'voice.webm' },
        body: blob,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `语音改稿失败（${res.status}）`);
      // 识别期间换了稿子或离开了编辑：结果对不上了，不能写到现在这篇上
      if (st.draft?.id !== id || st.mode !== 'edit' || editVer.value) { toast('已经换了稿子或版本，这次语音改稿没有应用'); return; }
      const note = {
        heard: data.transcript ? `听到：${data.transcript}` : '',
        understood: data.note ? `理解成：${data.note}` : '',
        changed: 0, why: '', undo: null,
      };
      if (data.changed && data.content && data.content !== st.draft.content) {
        note.undo = st.draft.content;
        note.changed = (data.applied || []).reduce((n, x) => n + (x.count || 1), 0);
        onInput(data.content, { voice: true });
      } else {
        note.why = (data.skipped || []).filter(Boolean).join('；');
      }
      voiceNote.value = note;
    } catch (err) {
      toast(err.message);
    } finally {
      voice.recognizing = false;
    }
  }

  function undoVoice() {
    const n = voiceNote.value;
    if (n?.undo == null) return;
    onInput(n.undo, { voice: true });
    voiceNote.value = null;
    toast('已撤销这次语音改稿');
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

  /* 把图读成 data URI。剪贴板里放图片链接没用——指向本站且要登录态，粘到公众号编辑器那边取不到 */
  async function inlineImages(items) {
    const out = new Map();
    await Promise.all(items.filter((it) => it.image).map(async (it) => {
      try {
        const res = await fetch(imageUrl(it.image));
        if (!res.ok) return;
        const blob = await res.blob();
        out.set(it.i, await new Promise((ok, no) => {
          const r = new FileReader();
          r.onload = () => ok(r.result);
          r.onerror = no;
          r.readAsDataURL(blob);
        }));
      } catch { /* 单张读不到就跳过，别让整次复制失败 */ }
    }));
    return out;
  }

  /* 带图的富文本：和阅读区同一套插图逻辑，只是图换成了 data URI */
  async function richHtml(text) {
    const items = useVersionsStore().illus?.items || [];
    const uris = await inlineImages(items);
    const html = weave(text, items, markdown, (it) => {
      const uri = uris.get(it.i);
      if (!uri) return '';
      return `<figure style="margin:22px 0"><img src="${uri}" alt="${esc(it.alt)}" style="max-width:100%">`
        + (it.alt ? `<figcaption style="font-size:13px;color:#888;text-align:center;margin-top:6px">${esc(it.alt)}</figcaption>` : '')
        + '</figure>';
    });
    return { html, imgs: uris.size };
  }

  async function copy() {
    const v = useVersionsStore();
    const text = v.text;
    if (!text || exporting.value) return;
    exporting.value = true;
    const label = v.current ? `「${v.label}」版本` : '';
    try {
      const { html, imgs } = await richHtml(text);
      if (imgs && window.ClipboardItem) {
        // 同时写两种格式：富文本编辑器取 HTML（带图），纯文本处取 markdown
        await navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        })]);
        toast(`已复制${label}，带 ${imgs} 张图`);
        return;
      }
      await navigator.clipboard.writeText(text);
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
        saveBlob(new Blob([text], { type: 'text/markdown;charset=utf-8' }), `${base}.md`);
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

  /* PDF 走浏览器打印。自己生成 PDF 要嵌中文字体，体积和复杂度都不划算；交给浏览器排版，断行和图片都是对的 */
  function exportPdf() {
    toolHint.value = '打印窗口里选「目标：另存为 PDF」';
    setTimeout(() => { window.print(); }, 60);
    setTimeout(() => { toolHint.value = ''; }, 6000);
  }

  /* 换了一篇稿子：成稿区回到初始状态 */
  function reset() {
    const st = s();
    clearTimeout(saveTimer);
    stopVoice();
    voiceNote.value = null;
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
  }

  return {
    live, streamingView, generate, setMode,
    save, markDirty, flushSave, onInput, replaceContent, text, editVer, locate, undo, redo, canUndo, canRedo, resetHistory,
    menus, assist, runAssist, retryAssist, closeAssist, applyAssist,
    toggleRevs, loadRevs, openRev,
    voice, voiceNote, toggleVoice, undoVoice, stopVoice,
    archiveCurrent, toolHint, exporting, copy, download, downloadDocx, exportPdf,
    reset,
  };
});
