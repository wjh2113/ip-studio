<template>
  <div
    id="editor"
    ref="root"
    class="editor rich-editor"
    :class="{ 'mark-over': over }"
    :data-doc="docText"
    @dragover="onDragOver"
    @dragleave="over = false"
    @drop="onDrop"
  >
    <div class="rich-toolbar" id="richToolbar">
      <FormatBar />
      <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden @change="onFilePicked" />
    </div>
    <EditorContent :editor="editor" class="rich-body" />
  </div>
</template>

<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Editor, EditorContent } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import FormatBar from './FormatBar.vue';
import { upload } from '../lib/api.js';
import { toast } from '../lib/feedback.js';
import { ImageMark, IMAGE_MARK } from '../lib/imageMark.js';
import { IllusDecor } from '../lib/illusDecor.js';
import { MdImage } from '../lib/mdImage.js';
import { useVersionsStore } from '../stores/versions.js';
import {
  docToHtml, isSafeImageSrc, sanitizeColor, sanitizeDoc, selectionToDoc, serializeEditor,
} from '../lib/richdoc.js';
import { squash } from '../lib/locate.js';

const props = defineProps({
  modelValue: { type: String, default: '' },
  draftId: { type: [Number, String], default: null },
});
const emit = defineEmits(['update:modelValue', 'select', 'slash', 'caret', 'ready', 'hist']);

const versions = useVersionsStore();
const root = ref(null);
const fileInput = ref(null);
const editor = ref(null);
const docText = ref('');
const applying = ref(false);
const over = ref(false);
const MARK_MIME = 'application/x-image-mark';

/* 格式刷记下的样式；再点一次刷到当前选区 */
let brush = null;
/* 点颜色板会抢走焦点、选区被折叠；先记下再上色 */
let savedSel = null;
function saveSel() {
  if (!editor.value) return;
  const { from, to } = editor.value.state.selection;
  savedSel = { from, to };
}

function setColor(raw) {
  if (!editor.value) return;
  const c = sanitizeColor(raw);
  const chain = editor.value.chain();
  if (savedSel) chain.setTextSelection(savedSel);
  if (!c) chain.focus().unsetColor().run();
  else chain.focus().setColor(c).run();
  savedSel = null;
}

function isActive(name) {
  const ed = editor.value;
  if (!ed) return false;
  if (name === 'brush') return !!brush;
  if (name === 'h1') return ed.isActive('heading', { level: 1 });
  if (name === 'h2') return ed.isActive('heading', { level: 2 });
  if (name === 'h3') return ed.isActive('heading', { level: 3 });
  if (name === 'h4') return ed.isActive('heading', { level: 4 });
  if (name === 'list') return ed.isActive('bulletList');
  if (name === 'ol') return ed.isActive('orderedList');
  if (name === 'quote') return ed.isActive('blockquote');
  return ed.isActive(name);
}

function captureBrush() {
  const ed = editor.value;
  if (!ed) return null;
  let heading = 0;
  for (const n of [1, 2, 3, 4]) {
    if (ed.isActive('heading', { level: n })) heading = n;
  }
  return {
    bold: ed.isActive('bold'),
    italic: ed.isActive('italic'),
    strike: ed.isActive('strike'),
    color: sanitizeColor(ed.getAttributes('textStyle')?.color),
    heading,
  };
}

function applyBrush() {
  const ed = editor.value;
  if (!ed || !brush) return;
  const chain = ed.chain();
  if (savedSel) chain.setTextSelection(savedSel);
  chain.focus().unsetAllMarks();
  if (brush.bold) chain.setBold();
  if (brush.italic) chain.setItalic();
  if (brush.strike) chain.setStrike();
  if (brush.color) chain.setColor(brush.color);
  if (brush.heading) chain.setHeading({ level: brush.heading });
  chain.run();
  savedSel = null;
}

function getColor() {
  return sanitizeColor(editor.value?.getAttributes('textStyle')?.color) || '#333333';
}

function format(op) {
  const ed = editor.value;
  if (!ed) return;
  if (op === 'undo') { emit('hist', 'undo'); return; }
  if (op === 'redo') { emit('hist', 'redo'); return; }
  if (op === 'image') { pickImage(); return; }
  if (op === 'mark') { insertMarkAtCaret(); return; }
  if (op === 'brush') {
    if (brush) { applyBrush(); brush = null; }
    else brush = captureBrush();
    return;
  }
  if (op === 'nocolor') { setColor(''); return; }
  if (op === 'clear') {
    const chain = ed.chain();
    if (savedSel) chain.setTextSelection(savedSel);
    chain.focus().unsetAllMarks();
    if (ed.isActive('heading')) chain.setParagraph();
    chain.run();
    savedSel = null;
    return;
  }
  const chain = ed.chain();
  if (savedSel && /^(bold|italic|strike|h\d|list|ol|quote)$/.test(op)) chain.setTextSelection(savedSel);
  chain.focus();
  if (op === 'bold') chain.toggleBold().run();
  else if (op === 'italic') chain.toggleItalic().run();
  else if (op === 'strike') chain.toggleStrike().run();
  else if (op === 'h1') chain.toggleHeading({ level: 1 }).run();
  else if (op === 'h2') chain.toggleHeading({ level: 2 }).run();
  else if (op === 'h3') chain.toggleHeading({ level: 3 }).run();
  else if (op === 'h4') chain.toggleHeading({ level: 4 }).run();
  else if (op === 'list') chain.toggleBulletList().run();
  else if (op === 'ol') chain.toggleOrderedList().run();
  else if (op === 'quote') chain.toggleBlockquote().run();
  savedSel = null;
}

function emitDoc(typing = true) {
  if (!editor.value || applying.value) return;
  const { text } = serializeEditor(editor.value);
  const next = sanitizeDoc(text);
  docText.value = next;
  if (next !== props.modelValue) emit('update:modelValue', next, { typing });
}

function bindBridge() {
  const el = root.value;
  if (!el || !editor.value) return;
  el._rich = {
    getDoc: () => serializeEditor(editor.value).text,
    setDoc: (t) => {
      applyExternal(t);
      const next = sanitizeDoc(t);
      emit('update:modelValue', next);
    },
    getSelection: () => selectionToDoc(editor.value),
    setSelection: (start, end, opts) => selectDocRange(start, end, opts),
    insertAt: (at, chunk) => insertAtDoc(at, chunk),
    locate: (quote) => locateQuote(quote),
    focus: (opts) => editor.value?.commands.focus(opts?.preventScroll ? undefined : 'end'),
    coordsAt: (docOff) => serializeEditor(editor.value).coords(docOff),
    caretFromPoint: (x, y) => {
      const pos = editor.value?.view.posAtCoords({ left: x, top: y });
      if (pos == null) return null;
      return serializeEditor(editor.value).pmToDoc(pos.pos);
    },
    format,
    isActive,
    getColor,
    setColor,
    saveSel,
    get scrollTop() { return el.querySelector('.ProseMirror')?.scrollTop || 0; },
    set scrollTop(v) {
      const pm = el.querySelector('.ProseMirror');
      if (pm) pm.scrollTop = v;
    },
  };
  Object.defineProperty(el, 'value', {
    configurable: true,
    get: () => el._rich.getDoc(),
    set: (v) => el._rich.setDoc(v),
  });
  Object.defineProperty(el, 'selectionStart', {
    configurable: true,
    get: () => el._rich.getSelection().start,
    set: (v) => { const s = el._rich.getSelection(); el._rich.setSelection(v, s.end); },
  });
  Object.defineProperty(el, 'selectionEnd', {
    configurable: true,
    get: () => el._rich.getSelection().end,
    set: (v) => { const s = el._rich.getSelection(); el._rich.setSelection(s.start, v); },
  });
  el.setSelectionRange = (a, b) => el._rich.setSelection(a, b);
  el.focus = (opts) => {
    editor.value?.commands.focus();
    if (opts?.preventScroll) {
      /* TipTap focus 可能滚动，尽量保持 */
    }
  };
}

function applyExternal(raw) {
  if (!editor.value) return;
  const next = sanitizeDoc(raw);
  const cur = serializeEditor(editor.value).text;
  if (next === cur) { docText.value = next; return; }
  applying.value = true;
  editor.value.commands.setContent(docToHtml(next), { emitUpdate: false });
  docText.value = next;
  applying.value = false;
}

function selectDocRange(start, end, { scroll = true } = {}) {
  if (!editor.value) return;
  const { docToPm } = serializeEditor(editor.value);
  const from = docToPm(start);
  const to = docToPm(Math.max(start, end));
  const chain = editor.value.chain();
  if (scroll) chain.focus();
  else chain.focus(undefined, { scrollIntoView: false });
  chain.setTextSelection({ from, to: Math.max(from, to) }).run();
}

function insertAtDoc(at, chunk) {
  if (!editor.value) return;
  const { text, docToPm } = serializeEditor(editor.value);
  const index = Math.max(0, Math.min(at ?? text.length, text.length));
  const next = text.slice(0, index) + chunk + text.slice(index);
  applyExternal(next);
  emit('update:modelValue', sanitizeDoc(next), { typing: false });
  nextTick(() => selectDocRange(index + chunk.length, index + chunk.length));
}

function locateQuote(quote) {
  if (!editor.value || !quote) return false;
  const { text, coords } = serializeEditor(editor.value);
  let start = text.indexOf(quote);
  let end = start + quote.length;
  if (start < 0) {
    const SKIP = /[\s*_`#>~|]/;
    const want = squash(quote);
    const idx = [];
    let flat = '';
    for (let i = 0; i < text.length; i++) {
      if (SKIP.test(text[i])) continue;
      flat += text[i];
      idx.push(i);
    }
    const at = want ? flat.indexOf(want) : -1;
    if (at < 0) return false;
    start = idx[at];
    end = idx[at + want.length - 1] + 1;
  }
  selectDocRange(start, end);
  const box = coords(start);
  if (box) {
    const top = box.top;
    if (top < 80 || top > window.innerHeight - 80) {
      window.scrollBy({ top: top - window.innerHeight / 3, behavior: 'smooth' });
    }
  }
  return true;
}

function onSelectionUpdate() {
  if (!editor.value) return;
  const sel = selectionToDoc(editor.value);
  const c = serializeEditor(editor.value).coords(sel.end);
  emit('select', { ...sel, coords: c });
  emit('caret', { at: sel.end, coords: c });
  detectSlash();
}

function detectSlash() {
  if (!editor.value) return;
  const { doc, start } = selectionToDoc(editor.value);
  // start 是选区起点；光标时 start===end，斜杠在光标前一位
  const pos = start;
  const ch = doc[pos - 1];
  if (ch !== '/' && ch !== '／') { emit('slash', null); return; }
  const prev = doc[pos - 2];
  if (prev && /[A-Za-z0-9:/／]/.test(prev)) { emit('slash', null); return; }
  const c = serializeEditor(editor.value).coords(pos);
  emit('slash', { at: pos - 1, coords: c });
}

function insertMarkAtCaret() {
  const at = selectionToDoc(editor.value).start;
  insertMark(at);
}

function insertMark(at) {
  if (!editor.value) return;
  const { text } = serializeEditor(editor.value);
  const caret = selectionToDoc(editor.value).start;
  const index = Math.max(0, Math.min(at ?? caret, text.length));
  const pad = index > 0 && text[index - 1] !== '\n' ? '\n' : '';
  const tail = index < text.length && text[index] !== '\n' ? '\n' : '';
  const chunk = `${pad}${IMAGE_MARK}${tail}`;
  insertAtDoc(index, chunk);
}

async function uploadBlob(blob, filename) {
  if (!props.draftId) throw new Error('还没有稿子，无法上传图片');
  if (blob.size > 5 * 1024 * 1024) throw new Error('图片请小于 5MB');
  const data = await upload(`/drafts/${props.draftId}/assets`, blob, filename || 'paste.png');
  if (!isSafeImageSrc(data.url)) throw new Error('图片地址无效');
  return data.url;
}

function pickImage() {
  fileInput.value?.click();
}

async function onFilePicked(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    const url = await uploadBlob(file, file.name);
    editor.value?.chain().focus().setImage({ src: url, alt: '' }).run();
    emitDoc(false);
  } catch (err) {
    toast(err.message);
  }
}

function onDragOver(e) {
  const types = [...(e.dataTransfer?.types || [])];
  if (!types.includes(MARK_MIME) && !types.includes('text/plain')) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  over.value = true;
}

function onDrop(e) {
  const payload = e.dataTransfer?.getData(MARK_MIME) || e.dataTransfer?.getData('text/plain');
  if (payload !== IMAGE_MARK) return;
  e.preventDefault();
  over.value = false;
  const at = root.value?._rich?.caretFromPoint(e.clientX, e.clientY);
  insertMark(at ?? selectionToDoc(editor.value).start);
}

function onDocDragEnd() { over.value = false; }

onMounted(() => {
  document.addEventListener('dragend', onDocDragEnd);
  const ed = new Editor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] },
        undoRedo: false, // 撤销以 editor store 的 hist 为准
        codeBlock: false,
      }),
      TextStyle,
      Color,
      Image.configure({ inline: false, allowBase64: false }),
      Placeholder.configure({ placeholder: '在这里改正文…' }),
      ImageMark,
      IllusDecor,
      MdImage,
    ],
    content: docToHtml(props.modelValue),
    editorProps: {
      attributes: { class: 'ProseMirror rich-pm', spellcheck: 'false' },
      handleDOMEvents: {
        copy(view, event) {
          const sel = window.getSelection();
          if (!sel?.rangeCount || sel.isCollapsed) return false;
          const box = sel.getRangeAt(0).cloneContents();
          const imgs = [...box.querySelectorAll('img')];
          if (!imgs.length) return false;
          let wrote = false;
          for (const img of imgs) {
            const src = img.getAttribute('src') || '';
            const live = [...view.dom.querySelectorAll('img')].find((el) => el.getAttribute('src') === src || el.src === img.src);
            if (!live?.complete || !live.naturalWidth) continue;
            try {
              const canvas = document.createElement('canvas');
              canvas.width = live.naturalWidth;
              canvas.height = live.naturalHeight;
              canvas.getContext('2d').drawImage(live, 0, 0);
              img.setAttribute('src', canvas.toDataURL('image/png'));
              wrote = true;
            } catch { /* 跨域图画不进画布就保持原样 */ }
          }
          if (!wrote) return false;
          const holder = document.createElement('div');
          holder.appendChild(box);
          event.preventDefault();
          event.clipboardData.setData('text/html', holder.innerHTML);
          event.clipboardData.setData('text/plain', sel.toString());
          return true;
        },
      },
      handlePaste: (view, event) => {
        const items = [...(event.clipboardData?.items || [])];
        const img = items.find((it) => it.type.startsWith('image/'));
        if (img) {
          event.preventDefault();
          const file = img.getAsFile();
          if (file) {
            uploadBlob(file, file.name || 'paste.png').then((url) => {
              editor.value?.chain().focus().setImage({ src: url, alt: '' }).run();
              emitDoc(false);
            }).catch((err) => toast(err.message));
          }
          return true;
        }
        return false; // 让 TipTap 处理 HTML，随后 serialize 会 sanitize
      },
      handleKeyDown: (_view, event) => {
        if (!(event.ctrlKey || event.metaKey) || event.altKey || event.isComposing) return false;
        const k = event.key.toLowerCase();
        if (k === 'z') {
          event.preventDefault();
          emit('hist', event.shiftKey ? 'redo' : 'undo');
          return true;
        }
        if (k === 'y' && !event.shiftKey) {
          event.preventDefault();
          emit('hist', 'redo');
          return true;
        }
        return false;
      },
    },
    onUpdate: () => { emitDoc(true); },
    onSelectionUpdate: () => { onSelectionUpdate(); },
  });
  editor.value = ed;
  ed.storage.illusDecor.editor = ed;
  ed.storage.illusDecor.items = versions.illus?.items || [];
  docText.value = sanitizeDoc(props.modelValue);
  nextTick(() => {
    bindBridge();
    emit('ready', ed);
    if (ed.view) ed.view.dispatch(ed.state.tr);
  });
});

watch(() => versions.illus?.items, (items) => {
  const ed = editor.value;
  if (!ed?.storage?.illusDecor) return;
  ed.storage.illusDecor.items = items || [];
  ed.view.dispatch(ed.state.tr);
}, { deep: true });

watch(() => props.modelValue, (v) => {
  if (!editor.value || applying.value) return;
  const cur = serializeEditor(editor.value).text;
  if (sanitizeDoc(v) === cur) return;
  applyExternal(v);
});

onBeforeUnmount(() => {
  document.removeEventListener('dragend', onDocDragEnd);
  editor.value?.destroy();
  editor.value = null;
});

defineExpose({
  insertMark,
  focus: () => editor.value?.commands.focus(),
  getEditor: () => editor.value,
  root,
});
</script>
