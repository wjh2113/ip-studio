<template>
  <section class="card" id="contentCard" style="position:relative">
    <!-- 第三步：成稿。标题行 + 工具条吸顶：长文往下读的时候，模式切换和这几个动作始终够得着。
         sentinel 是吸顶判断用的：它滚出视口说明标题行已经贴在顶上了 -->
    <div ref="sentinel" style="position:absolute;top:0;height:1px;width:1px;pointer-events:none"></div>
    <div class="head-stick" :class="{ stuck }">
      <div class="card-head">
        <button class="btn ghost small step-back" data-goto="2" @click="!s.streaming && brief.goStep(2)">← 换方向</button>
        <h2 id="contentTitle">{{ title }}</h2>
        <span class="counter" id="counter">{{ counter }}</span>
        <span class="grow"></span>
        <!-- 模式指示器：只说明「你现在在哪个模式」，切换动作在工具条上 -->
        <span v-if="s.mode !== 'read'" class="mode-now" id="modeNow">{{ s.mode === 'edit' ? '编辑中' : '口播' }}</span>
      </div>

      <!-- 三个动作代替原来一排八个按钮：改 / 认了 / 拿走。后两个各带一个菜单——一次只让人做一个决定 -->
      <div class="toolbar">
        <button v-if="s.mode !== 'read'" class="btn ghost small" id="backReadBtn" @click="ed.setMode('read')">← 返回阅读</button>
        <button v-else class="btn ghost small" id="editBtn" :disabled="s.streaming" @click="ed.setMode('edit')">修改</button>
        <button class="btn ghost small" id="revBtn" :class="{ on: s.revOpen }" @click="toggleRevs">版本</button>
        <div class="menu-wrap">
          <button class="btn primary small" id="confirmBtn" aria-haspopup="true" @click.stop="toggleMenu('confirm')">确认 ▾</button>
          <div v-if="menu === 'confirm'" class="menu" id="confirmMenu">
            <div class="menu-head">这稿定了，接下来</div>
            <button v-for="a in CONFIRM.slice(0, 5)" :key="a.act" type="button" :data-act="a.act" :disabled="actDisabled(a.act)"
              :title="actDisabled(a.act) && a.act !== 'archive' ? '这几项都针对原文，先切回原文版本' : ''" @click="confirmAct(a.act)">{{ a.label }}<em>{{ a.hint }}</em></button>
            <hr>
            <button v-for="a in CONFIRM.slice(5)" :key="a.act" type="button" :data-act="a.act" :disabled="actDisabled(a.act)"
              :title="actDisabled(a.act) && a.act !== 'archive' ? '这几项都针对原文，先切回原文版本' : ''" @click="confirmAct(a.act)">{{ a.label }}<em>{{ a.hint }}</em></button>
          </div>
        </div>
        <div class="menu-wrap">
          <button class="btn ghost small" id="exportBtn" aria-haspopup="true" @click.stop="toggleMenu('export')">导出 ▾</button>
          <div v-if="menu === 'export'" class="menu" id="exportMenu">
            <div class="menu-head">导出格式</div>
            <button type="button" data-fmt="copy" @click="exportAs('copy')">复制<em id="copyHint">{{ copyHint }}</em></button>
            <button type="button" data-fmt="md" @click="exportAs('md')">下载 Markdown<em>纯文本，.md</em></button>
            <button type="button" data-fmt="html" @click="exportAs('html')">下载图文<em>单个 .html，图嵌在里面</em></button>
            <button type="button" data-fmt="docx" @click="exportAs('docx')">导出 Word<em>.docx，有配图就嵌进文档</em></button>
            <button type="button" data-fmt="pdf" @click="exportAs('pdf')">导出 PDF<em>走浏览器打印，在弹窗里选「另存为 PDF」</em></button>
          </div>
        </div>
        <span class="grow"></span>
        <span class="hint" id="toolHint">{{ ed.toolHint }}</span>
        <!-- 保存跟着编辑模式出现在这一行，和「确认 / 导出」在一起 -->
        <template v-if="s.mode === 'edit'">
          <span class="save-state" id="saveState" :class="ed.save.kind">{{ ed.save.text }}</span>
          <button class="btn ghost small" id="saveBtn" @click="ed.flushSave(true)">保存</button>
        </template>
      </div>
    </div>

    <RevPane v-if="s.revOpen" />
    <ReviewBox />
    <VersionBars />

    <article v-show="showArticle" class="content" id="content" ref="article" v-html="articleHtml"></article>

    <div v-if="s.mode === 'edit'" class="mark-dock" id="markDock">
      <span class="mark-chip" id="markBtn" draggable="true" role="button" tabindex="0" title="拖进正文，或点一下插到光标处"
        @dragstart="markDragStart" @dragend="markDragEnd" @click="markClick" @keydown.enter.prevent="insertMark()" @keydown.space.prevent="insertMark()">此处放图片</span>
      <button type="button" class="btn ghost small" id="voiceBtn" :class="{ recording: ed.voice.recording }" :disabled="ed.voice.recognizing"
        @click="ed.toggleVoice()">{{ ed.voice.recognizing ? '识别中…' : ed.voice.recording ? '说完了' : '语音改稿' }}</button>
      <span class="hint" id="markHint">先把光标点在要插图的地方，再把这个标签拖进去。语音改稿是说改哪里、怎么改。</span>
      <p v-if="ed.voiceNote" class="voice-note" id="voiceNote">
        <template v-if="ed.voiceNote.heard">{{ ed.voiceNote.heard }}<br></template>
        <template v-if="ed.voiceNote.understood">{{ ed.voiceNote.understood }}<br></template>
        <template v-if="ed.voiceNote.undo != null">改了 {{ ed.voiceNote.changed }} 处。<button type="button" class="mini" id="voiceUndoBtn" @click="ed.undoVoice()">撤销</button></template>
        <template v-else>正文没有改。{{ ed.voiceNote.why }}</template>
      </p>
    </div>
    <textarea v-show="s.mode === 'edit'" class="editor" id="editor" ref="editor" spellcheck="false" :class="{ 'mark-over': markOver }"
      :value="s.draft?.content || ''" @input="onEditorInput" @compositionend="onCompositionEnd" @mouseup="onEditorSelect" @keyup="onEditorKeyup"
      @dragover="onDragOver" @dragleave="markOver = false" @drop="onDrop"></textarea>

    <CuesPane v-if="s.mode === 'cue' && !v.current" />

    <div v-if="s.mode === 'edit'" class="editor-bar" id="editorBar">
      <span class="hint">选中文字 → 调 AI 改写　·　输入 <kbd>/</kbd> → 让 AI 接着写</span>
    </div>
  </section>
</template>

<script setup>
/* 成稿区。数据和动作在 stores/editor.js（正文、保存、改写、历史、导出）、versions.js（多平台与配图）、
 * review.js（检查）、speak.js（口播）；这里管界面：模式切换、菜单、划词和 / 的位置、拖标签进正文。 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import RevPane from './RevPane.vue';
import ReviewBox from './ReviewBox.vue';
import VersionBars from './VersionBars.vue';
import CuesPane from './CuesPane.vue';
import { IMAGE_MARK } from '../../../shared/place.js';
import { useStudioStore } from '../stores/studio.js';
import { useBriefStore } from '../stores/brief.js';
import { useEditorStore } from '../stores/editor.js';
import { useVersionsStore } from '../stores/versions.js';
import { useReviewStore } from '../stores/review.js';
import { useSpeakStore } from '../stores/speak.js';
import { useAccountStore } from '../stores/account.js';
import { useTitlesStore } from '../stores/titles.js';
import { useInsightsStore } from '../stores/insights.js';
import { toast } from '../lib/feedback.js';
import { countChars, esc, markdown } from '../lib/text.js';
import { caretFromPoint, caretRect } from '../lib/caret.js';
import { anyLayerOpen } from '../lib/escape.js';

const s = useStudioStore();
const brief = useBriefStore();
const ed = useEditorStore();
const v = useVersionsStore();

const sentinel = ref(null);
const article = ref(null);
const editor = ref(null);

const CONFIRM = [
  { act: 'cues', label: '生成口播提示', hint: '切段、标语气，配合提词器照着念' },
  { act: 'titles', label: '起标题', hint: '按不同写法出 6 个候选，挑一个替换' },
  { act: 'multi', label: '出多平台版本', hint: '事实不变，按各平台重排结构和篇幅' },
  { act: 'illus', label: '配图', hint: '正文写 <此处放图片> 就插在那里；没写则自动排位。出图要点「全部出图」' },
  { act: 'learn', label: '喂给账号学习', hint: '作为语气样本，影响以后的成稿' },
  { act: 'review', label: '再检查一遍', hint: '错字、通顺性、调性与风险' },
  { act: 'metrics', label: '回填发布数据', hint: '发完填几个数字，复盘才知道什么有效' },
  { act: 'archive', label: '归档', hint: '收进「已归档」，随时能恢复' },
];

/* ---------- 标题、字数、阅读区 ---------- */
const title = computed(() => ed.live.title || s.draft?.title || '完整文案');

const counter = computed(() => {
  if (s.streaming) return ed.live.text ? `${countChars(ed.live.text)} 字 · 生成中` : '生成中…';
  if (ed.live.error) return '';
  return `${countChars(s.mode === 'edit' ? s.draft?.content : v.text)} 字`;
});

const articleHtml = computed(() => {
  if (s.streaming) return `${markdown(ed.live.text)}<span class="cursor"></span>`;
  if (ed.live.error) return `<p style="color:var(--danger)">生成中断：${esc(ed.live.error)}</p>${ed.live.text ? markdown(ed.live.text) : ''}`;
  return v.html;
});

// 编辑和口播都针对原文；口播模式下切到别的平台版本时只能看那个版本的正文
const showArticle = computed(() => s.streaming || s.mode === 'read' || (s.mode === 'cue' && Boolean(v.current)));

/* ---------- 工具条菜单 ---------- */
const menu = ref('');
const toggleMenu = (m) => { menu.value = menu.value === m ? '' : m; };
const closeMenu = () => { menu.value = ''; };

/* 口播、标题、多平台、学习、检查都针对原文：看别的平台版本时灰掉，并说明为什么 */
function actDisabled(act) {
  if (act === 'archive') return Boolean(s.draft?.archived_at);
  return ['cues', 'multi', 'learn', 'review', 'titles'].includes(act) && Boolean(v.current);
}

async function confirmAct(act) {
  if (actDisabled(act)) return;
  closeMenu();
  if (act === 'cues') { ed.setMode('cue'); if (!s.draft?.cues) useSpeakStore().runCues(); return; }
  if (act === 'multi') { v.openMulti(); return; }
  if (act === 'illus') { v.toggleIllus(); return; }
  if (act === 'learn') { useAccountStore().learn(s.draft, { beforeSave: () => ed.flushSave() }); return; }
  if (act === 'review') { useReviewStore().run(); return; }
  if (act === 'metrics') { useInsightsStore().openMetrics(); return; }
  if (act === 'titles') { useTitlesStore().open(); return; }
  if (act === 'archive') await ed.archiveCurrent();
}

const copyHint = computed(() => `${v.current ? `${v.label}版` : '正文'}${v.imageCount ? '；连图一起（富文本）' : ''}`);

function exportAs(fmt) {
  closeMenu();
  if (fmt === 'copy') ed.copy();
  else if (fmt === 'pdf') ed.exportPdf();
  else if (fmt === 'docx') ed.downloadDocx();
  else ed.download(fmt);
}

function toggleRevs() {
  ed.toggleRevs().catch((err) => toast(err.message));
}

/* ---------- 编辑框 ---------- */
function autosize() {
  const ta = editor.value;
  if (!ta) return;
  ta.style.height = 'auto';
  ta.style.height = `${Math.max(360, ta.scrollHeight)}px`;
}

// 进编辑模式：撑开高度、放光标；内容被别处改了（采纳、语音改稿）也要重新撑
watch(() => s.mode, async (mode) => {
  closeMenu();
  if (mode !== 'edit') return;
  await nextTick();
  autosize();
  editor.value?.focus();
});
watch(() => s.draft?.content, () => { if (s.mode === 'edit') nextTick(autosize); });

function onEditorInput(e) {
  ed.onInput(e.target.value);
  autosize();
  detectSlash();
}

function onCompositionEnd() {
  setTimeout(detectSlash, 0);
}

/* ---------- 划词改写 ---------- */
function onEditorSelect() {
  const ta = editor.value;
  const { selectionStart: start, selectionEnd: end } = ta;
  if (end - start < 2) { ed.menus.sel = null; return; }
  ed.menus.sel = { ...caretRect(ta, end), target: { start, end, text: ta.value.slice(start, end) } };
}

function onEditorKeyup(e) {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) onEditorSelect();
}

/* 阅读模式：把渲染文本里的选区反查回 Markdown 原文的偏移。同一句话可能出现多次，用相对位置挑最接近的那处 */
function locateInRaw(text, range) {
  const raw = s.draft.content;
  const hits = [];
  for (let i = raw.indexOf(text); i !== -1; i = raw.indexOf(text, i + 1)) hits.push(i);
  if (!hits.length) return null;
  let start = hits[0];
  if (hits.length > 1) {
    const probe = document.createRange();
    probe.selectNodeContents(article.value);
    probe.setEnd(range.startContainer, range.startOffset);
    const guess = (probe.toString().length / (article.value.innerText.length || 1)) * raw.length;
    start = hits.reduce((best, i) => (Math.abs(i - guess) < Math.abs(best - guess) ? i : best), hits[0]);
  }
  return { start, end: start + text.length, text };
}

function onDocMouseUp() {
  if (s.mode !== 'read' || !s.draft?.content || s.streaming || v.current) return;
  setTimeout(() => {
    const sel = window.getSelection();
    if (!sel.rangeCount || sel.isCollapsed) { ed.menus.sel = null; return; }
    const range = sel.getRangeAt(0);
    if (!article.value?.contains(range.commonAncestorContainer)) return;
    const text = sel.toString().trim();
    if (text.length < 2) return;
    const target = locateInRaw(text, range);
    if (!target) { toast('这段包含格式符号，切到「编辑」再选一次就能改'); return; }
    const r = range.getBoundingClientRect();
    ed.menus.sel = { left: r.left, top: r.top, bottom: r.bottom, target };
  }, 0);
}

/* ---------- / 唤起续写 ---------- */
/* 半角和全角斜杠都认（中文输入法全角状态下打出来的是／）；URL、路径、分数后面的不算 */
const SLASH_KEYS = ['/', '／'];
const SLASH_BLOCKERS = /[A-Za-z0-9:/／]/;

function detectSlash() {
  if (s.mode !== 'edit') return;
  const ta = editor.value;
  const pos = ta.selectionStart;
  const value = ta.value;
  if (!SLASH_KEYS.includes(value[pos - 1])) { ed.menus.slash = null; return; }
  const prev = value[pos - 2];
  if (prev && SLASH_BLOCKERS.test(prev)) return;
  ed.menus.slash = { ...caretRect(ta, pos), at: pos - 1 };
}

/* ---------- 拖「此处放图片」进正文 ---------- */
const MARK_MIME = 'application/x-image-mark';
const markOver = ref(false);
let markDragged = false;
let markCaret = null;

function insertMark(at) {
  const ta = editor.value;
  if (!ta || !s.draft) return;
  const value = ta.value;
  const index = Math.max(0, Math.min(at ?? ta.selectionStart ?? value.length, value.length));
  const pad = index > 0 && value[index - 1] !== '\n' ? '\n' : '';
  const tail = index < value.length && value[index] !== '\n' ? '\n' : '';
  const chunk = `${pad}${IMAGE_MARK}${tail}`;
  ed.onInput(value.slice(0, index) + chunk + value.slice(index));
  nextTick(() => {
    ta.focus();
    ta.selectionStart = ta.selectionEnd = index + chunk.length;
    autosize();
  });
}

function markDragStart(e) {
  markDragged = true;
  markCaret = editor.value?.selectionStart ?? null;
  e.dataTransfer.setData(MARK_MIME, IMAGE_MARK);
  e.dataTransfer.setData('text/plain', IMAGE_MARK);
  e.dataTransfer.effectAllowed = 'copy';
}

function markDragEnd() {
  markOver.value = false;
  setTimeout(() => { markDragged = false; }, 0);
}

function markClick() {
  if (markDragged) { markDragged = false; return; }
  insertMark(editor.value?.selectionStart);
}

function onDragOver(e) {
  if (!markDragged) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  markOver.value = true;
  const at = caretFromPoint(editor.value, e.clientX, e.clientY);
  if (at != null) {
    markCaret = at;
    editor.value.setSelectionRange(at, at);
  }
}

function onDrop(e) {
  const payload = e.dataTransfer?.getData(MARK_MIME) || e.dataTransfer?.getData('text/plain');
  if (payload !== IMAGE_MARK) return;
  e.preventDefault();
  markOver.value = false;
  const at = caretFromPoint(editor.value, e.clientX, e.clientY);
  insertMark(at ?? markCaret ?? editor.value.selectionStart);
}

/* ---------- 全局：点空白关菜单、Esc、关页面前提醒没保存 ---------- */
function onDocClick(e) {
  if (!e.target.closest('.menu-wrap')) closeMenu();
}

function onDocMouseDown(e) {
  if (e.target.closest('#selMenu, #slashMenu')) return;
  ed.menus.sel = null;
  ed.menus.slash = null;
}

function onKey(e) {
  if (e.key !== 'Escape' || anyLayerOpen()) return;
  if (menu.value) { closeMenu(); return; }
  if (ed.menus.sel || ed.menus.slash) { ed.menus.sel = null; ed.menus.slash = null; return; }
  if (ed.assist) ed.closeAssist();
}

function onBeforeUnload(e) {
  if (s.dirty) { e.preventDefault(); e.returnValue = ''; }
}

/* 吸顶：贴到顶了才给分隔线和投影。用 IntersectionObserver 而不是 scroll 事件——只需要知道「越界了没有」 */
const stuck = ref(false);
let observer = null;

onMounted(() => {
  document.addEventListener('mouseup', onDocMouseUp);
  document.addEventListener('click', onDocClick);
  document.addEventListener('mousedown', onDocMouseDown);
  document.addEventListener('keydown', onKey);
  window.addEventListener('beforeunload', onBeforeUnload);
  // 和 CSS 里的 --topbar-h 保持一致，别在两个地方各写一个数
  const top = getComputedStyle(document.documentElement).getPropertyValue('--topbar-h').trim() || '66px';
  observer = new IntersectionObserver(([en]) => { stuck.value = !en.isIntersecting; }, { rootMargin: `-${top} 0px 0px 0px`, threshold: 0 });
  observer.observe(sentinel.value);
});

onBeforeUnmount(() => {
  document.removeEventListener('mouseup', onDocMouseUp);
  document.removeEventListener('click', onDocClick);
  document.removeEventListener('mousedown', onDocMouseDown);
  document.removeEventListener('keydown', onKey);
  window.removeEventListener('beforeunload', onBeforeUnload);
  observer?.disconnect();
});
</script>
