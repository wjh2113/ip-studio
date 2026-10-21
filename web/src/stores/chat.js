/* 右栏 AI 对话：写稿时和 AI 聊这篇稿子，或者让它改左边的正文。网页上「用一句话改稿」都走这里。
 *
 *   对话按「稿子 + 版本」各一串，存在服务端（保存天数每人自己定，默认 100 天）   load / clear / setKeep
 *   发一句：带上正在看的那一版正文（可能还没存完）和引用的片段；历史由服务端从记录里取   send
 *   局部改：AI 回一组 find / replace，先列在对话里，点「应用」才写进正文   apply / undo
 *     应用走 editor.replaceContent：算一步撤销，Ctrl+Z 也能退回，改完自动保存
 *   整篇改：AI 先问「开始吗」，点「开始重写」才调 editor.revise（整篇流式重写，留历史、出逐段对照）   startRewrite
 *   用嘴说：录一段 → 转成文字放进输入框，看过再发（转写不扣点）   toggleMic
 *   检查结果「交给 AI 改」：带着那句话和检查意见直接发一句   askAbout
 * 打开对话栏：右栏页签、工具条「问 AI」、划词菜单「问 AI」（带着选中的那段过来）   open */
import { defineStore } from 'pinia';
import { computed, reactive, ref } from 'vue';
import { api, upload } from '../lib/api.js';
import { toast } from '../lib/feedback.js';
import { applyEdits } from '../../../shared/edits.js';
import { useStudioStore } from './studio.js';
import { useEditorStore } from './editor.js';
import { useLayoutStore } from './layout.js';

export const CHAT_SUGGESTS = [
  '这篇的主线清楚吗？哪里最弱？',
  '开头改得更抓人一点',
  '结尾太弱，帮我改一下',
  '整篇换成更口语、更轻松的语气',
];

export const KEEP_CHOICES = [
  { days: 30, label: '30 天' },
  { days: 100, label: '100 天' },
  { days: 365, label: '1 年' },
  { days: 0, label: '一直保留' },
];

/* 服务端回来的一条，补上只在页面里用的状态：steps 是这次打开后应用过的（撤销用，刷新就没了） */
const local = (m) => ({ edits: [], rewrite: '', skipped: [], done: {}, started: false, ...m, steps: [] });

export const useChatStore = defineStore('chat', () => {
  const threads = reactive({});       // `${稿子 id}:${版本}` → 消息列表（null = 还没取）
  const loading = ref(false);
  const busy = ref(false);
  const input = ref('');
  const quote = ref('');              // 引用的片段：「这段」指它
  const focusTick = ref(0);           // 加一 = 让输入框拿到焦点
  const keepDays = ref(100);

  const key = computed(() => {
    const d = useStudioStore().draft;
    return d?.id ? `${d.id}:${useEditorStore().editVer}` : '';
  });
  const messages = computed(() => (key.value && threads[key.value]) || []);

  function open({ quote: q } = {}) {
    const layout = useLayoutStore();
    layout.work = false;
    layout.pane = 'chat';
    if (q) quote.value = String(q).trim();
    focusTick.value += 1;
  }

  /* 取这篇这一版的对话记录（每串只取一次；清空、换稿子再回来不重复取） */
  async function load(force = false) {
    const k = key.value;
    if (!k || (threads[k] && !force)) return;
    const [id, ver] = [Number(k.split(':')[0]), useEditorStore().editVer];
    loading.value = true;
    try {
      const data = await api(`/drafts/${id}/chat${ver ? `?version=${encodeURIComponent(ver)}` : ''}`);
      if (!threads[k] || force) threads[k] = data.messages.map(local);
      keepDays.value = data.keepDays;
    } catch (err) {
      if (!threads[k]) threads[k] = [];
      toast(`对话记录没取到：${err.message}`);
    } finally {
      loading.value = false;
    }
  }

  async function send(text, { quote: q = quote.value } = {}) {
    const st = useStudioStore();
    const ed = useEditorStore();
    const msg = String(text ?? input.value).trim();
    if (!msg || busy.value || !st.draft?.id) return false;
    if (st.streaming) { toast('正在生成，等写完再聊'); return false; }
    if (!ed.text.trim()) { toast('还没有正文'); return false; }
    const k = key.value;
    const ver = ed.editVer;
    const id = st.draft.id;
    if (!threads[k]) threads[k] = [];
    const list = threads[k];
    list.push(local({ role: 'user', content: msg, quote: q, temp: true }));
    list.push(local({ role: 'assistant', content: '', pending: true }));
    const mine = list[list.length - 2];
    const reply = list[list.length - 1];      // 取回响应式代理，后面改它界面才会跟着变
    if (text == null) input.value = '';
    quote.value = '';
    busy.value = true;
    try {
      const data = await api(`/drafts/${id}/chat`, { method: 'POST', body: { message: msg, version: ver, text: ed.text, quote: q } });
      Object.assign(mine, local(data.user));
      Object.assign(reply, local(data.reply));
    } catch (err) {
      reply.error = err.message;
      reply.retry = { content: msg, quote: q };
    } finally {
      reply.pending = false;
      busy.value = false;
    }
    return true;
  }

  /* 出错的那一轮重发：这一问一答没存进记录，拿掉后原话再发一次 */
  function retry(m) {
    const list = threads[key.value];
    const i = list?.indexOf(m) ?? -1;
    if (i < 1 || !m.retry) return;
    list.splice(i - 1, 2);
    send(m.retry.content, { quote: m.retry.quote || '' });
  }

  /* 检查结果里的一条「交给 AI 改」：引用那句，把检查意见说给 AI */
  function askAbout({ quote: q, what, suggestion, ver = '' }) {
    const ed = useEditorStore();
    if (ver !== ed.editVer) { toast('这条检查针对的版本不是正开着的这一版，先在版本栏切过去'); return; }
    open();
    const msg = `检查提示：${what}${suggestion ? `。建议：${suggestion}` : ''}。帮我按这个改${q ? '这一句' : ''}，别的地方不动。`;
    send(msg, { quote: q || '' });
  }

  const allDone = (m) => (m.rewrite ? m.started : m.edits.every((_, i) => m.done[i]));

  /* 应用了哪几处记到服务端：刷新后还显示「已应用」 */
  function mark(m, body) {
    if (!m.id) return;
    void api(`/chat/${m.id}`, { method: 'PUT', body }).catch(() => {});
  }

  /* i 不给 = 全部；给了只应用那一处 */
  function apply(m, i = null) {
    const st = useStudioStore();
    const ed = useEditorStore();
    if (st.streaming || !st.draft) return;
    const before = ed.text;
    const idx = i == null ? m.edits.map((_, j) => j).filter((j) => !m.done[j]) : [i];
    const r = applyEdits(before, idx.map((j) => m.edits[j]));
    if (r.content === before) {
      toast(r.skipped[0] ? `没对上正文：${r.skipped[0]}。正文可能已经改过了` : '正文已经是这样了');
      return;
    }
    ed.replaceContent(r.content);
    m.steps.push({ before, after: r.content, idx });
    for (const j of idx) m.done[j] = true;
    mark(m, { done: m.done });
    toast(`已应用 ${idx.length} 处，可撤销`);
    locate(m, idx[0], { quiet: true });
  }

  /* 撤销这条消息最近一次应用。之后正文又改过就不硬撤，免得把后来的改动一起抹掉 */
  function undo(m) {
    const ed = useEditorStore();
    const last = m.steps[m.steps.length - 1];
    if (!last) return;
    if (ed.text !== last.after) { toast('应用之后正文又改过了，用 Ctrl+Z 一步步退回，或在「版本对照」里找回'); return; }
    ed.replaceContent(last.before);
    m.steps.pop();
    for (const j of last.idx) delete m.done[j];
    mark(m, { done: m.done });
    toast('已撤销');
  }

  /* 整篇重写：AI 已经问过「开始吗」，作者点了才动手。重写完左边正文上方有逐段对照，可单段退回 */
  async function startRewrite(m) {
    const ed = useEditorStore();
    if (!m.rewrite || m.started || busy.value) return;
    m.running = true;
    const ok = await ed.revise(m.rewrite, { mode: 'full' });
    m.running = false;
    if (!ok) return;
    m.started = true;
    mark(m, { done: {}, started: true });
  }

  /* 左边正文滚到这处改动：应用过的找新句子，没应用的找原句。去掉 Markdown 符号，取一行里的一截 */
  function locate(m, i, { quiet = false } = {}) {
    const e = m.edits[i];
    if (!e) return;
    const src = m.done[i] ? (e.replace || e.find) : e.find;
    const line = String(src).split('\n').map((l) => l.replace(/^\s*(#+|>|[-*+]|\d+\.)\s*/, '').replace(/[*_`~]/g, '').trim()).find((l) => l.length >= 2) || '';
    if (!line) return;
    const ed = useEditorStore();
    ed.locate(line.slice(0, 40), { ver: ed.editVer, quiet });
  }

  async function clear() {
    const st = useStudioStore();
    const ver = useEditorStore().editVer;
    const k = key.value;
    if (!k || !st.draft?.id) return;
    try {
      await api(`/drafts/${st.draft.id}/chat${ver ? `?version=${encodeURIComponent(ver)}` : ''}`, { method: 'DELETE' });
      threads[k] = [];
      quote.value = '';
    } catch (err) { toast(err.message); }
  }

  async function setKeep(days) {
    try {
      const data = await api('/chat-keep', { method: 'PUT', body: { days: Number(days) } });
      keepDays.value = data.keepDays;
      toast(data.keepDays ? `对话记录保存 ${KEEP_CHOICES.find((c) => c.days === data.keepDays)?.label || `${data.keepDays} 天`}，过期自动删` : '对话记录一直保留');
    } catch (err) { toast(err.message); }
  }

  /* ---------- 用嘴说：录音 → 转成文字放进输入框（不扣点），看过再发 ---------- */
  const mic = reactive({ recording: false, recognizing: false });
  let rec = null;
  let micTimer = 0;

  async function toggleMic() {
    if (rec && rec.state === 'recording') { rec.stop(); return; }
    if (mic.recognizing) return;
    let media;
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast('没有拿到麦克风');
      return;
    }
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
      : (MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '');
    const r = new MediaRecorder(media, mime ? { mimeType: mime } : undefined);
    const chunks = [];
    r.ondataavailable = (ev) => { if (ev.data?.size) chunks.push(ev.data); };
    r.onstop = async () => {
      media.getTracks().forEach((t) => t.stop());
      clearTimeout(micTimer);
      rec = null;
      mic.recording = false;
      const blob = new Blob(chunks, { type: r.mimeType || 'audio/webm' });
      if (!blob.size) return;
      mic.recognizing = true;
      try {
        const { text } = await upload('/transcribe', blob, 'voice.webm');
        const said = String(text || '').trim();
        if (said) input.value = input.value.trim() ? `${input.value.trim()}\n${said}` : said;
        focusTick.value += 1;
      } catch (err) {
        toast(err.message);
      } finally {
        mic.recognizing = false;
      }
    };
    rec = r;
    r.start();
    mic.recording = true;
    micTimer = setTimeout(() => { if (rec) rec.stop(); }, 90000);      // 一次最多说一分半
  }

  function stopMic() {
    clearTimeout(micTimer);
    if (rec && rec.state !== 'inactive') rec.stop();
  }

  return {
    threads, messages, loading, busy, input, quote, focusTick, keepDays, mic,
    open, load, send, retry, askAbout, apply, undo, startRewrite, locate, allDone, clear, setKeep, toggleMic, stopMic,
  };
});
