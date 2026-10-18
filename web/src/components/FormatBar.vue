<template>
  <div class="fmt-bar fmt-icons" role="toolbar" aria-label="格式" @mousedown.stop>
    <!-- 顶栏图标；命令走 #editor._rich -->
      <button type="button" class="fmt-btn" id="rtUndo" title="撤销" :disabled="!ed.canUndo" @mousedown.prevent @click="run('undo')"><Icon name="undo" :size="16" /></button>
      <button type="button" class="fmt-btn" id="rtRedo" title="重做" :disabled="!ed.canRedo" @mousedown.prevent @click="run('redo')"><Icon name="redo" :size="16" /></button>
      <span class="fmt-sep" />
      <button type="button" class="fmt-btn" id="rtBrush" title="格式刷：先点一次记下样式，再选中文字点一次套上" :class="{ on: active.brush }" @mousedown.prevent @click="run('brush')"><Icon name="brush" :size="16" /></button>
      <button type="button" class="fmt-btn" id="rtClear" title="清除格式" @mousedown.prevent @click="run('clear')"><Icon name="eraser" :size="16" /></button>
      <span class="fmt-sep" />
      <button type="button" class="fmt-btn" id="rtHeading" title="二级标题" :class="{ on: active.h2 }" @mousedown.prevent @click="run('h2')"><span class="fmt-letter">H<sub>2</sub></span></button>
      <button type="button" class="fmt-btn" id="rtH3" title="三级标题" :class="{ on: active.h3 }" @mousedown.prevent @click="run('h3')"><span class="fmt-letter">H<sub>3</sub></span></button>
      <span class="fmt-drop">
        <button type="button" class="fmt-btn fmt-caret" id="rtHn" title="其他标题" @mousedown.prevent @click="toggle('h')"><span class="fmt-letter">H<sub>n</sub></span><Icon name="chev-down" :size="10" /></button>
        <div v-if="open === 'h'" class="fmt-pop" @mousedown.prevent>
          <button type="button" :class="{ on: active.h1 }" @click="run('h1')">标题 1</button>
          <button type="button" :class="{ on: active.h4 }" @click="run('h4')">标题 4</button>
        </div>
      </span>
      <span class="fmt-sep" />
      <button type="button" class="fmt-btn" id="rtBold" title="加粗" :class="{ on: active.bold }" @mousedown.prevent @click="run('bold')"><b>B</b></button>
      <button type="button" class="fmt-btn" id="rtItalic" title="斜体" :class="{ on: active.italic }" @mousedown.prevent @click="run('italic')"><i>I</i></button>
      <button type="button" class="fmt-btn" id="rtStrike" title="删除线" :class="{ on: active.strike }" @mousedown.prevent @click="run('strike')"><s>S</s></button>
      <span class="fmt-sep" />
      <button type="button" class="fmt-btn" id="rtList" title="无序列表" :class="{ on: active.list }" @mousedown.prevent @click="run('list')"><Icon name="list" :size="16" /></button>
      <span class="fmt-drop">
        <button type="button" class="fmt-btn fmt-caret" id="rtListMore" title="列表" @mousedown.prevent @click="toggle('list')"><Icon name="chev-down" :size="10" /></button>
        <div v-if="open === 'list'" class="fmt-pop" @mousedown.prevent>
          <button type="button" :class="{ on: active.list }" @click="run('list')">无序列表</button>
          <button type="button" :class="{ on: active.ol }" @click="run('ol')">有序列表</button>
        </div>
      </span>
      <button type="button" class="fmt-btn" id="rtQuote" title="引用" :class="{ on: active.quote }" @mousedown.prevent @click="run('quote')"><Icon name="quill" :size="16" /></button>
      <span class="fmt-drop" id="rtColor" @mousedown.prevent="onColorDown">
        <input class="fmt-native-color" type="color" :value="color" @input="onColor($event.target.value)" />
        <button type="button" class="fmt-btn fmt-color" title="文字颜色" @click="toggle('color')">
          <span class="fmt-letter fmt-a" :style="{ borderBottomColor: color }">A</span>
        </button>
        <button type="button" class="fmt-btn fmt-caret" title="文字颜色" @click="toggle('color')"><Icon name="chev-down" :size="10" /></button>
        <div v-if="open === 'color'" class="fmt-pop fmt-palette" @mousedown.prevent>
          <div class="fmt-pal-label">主题色</div>
          <div class="fmt-pal-row">
            <button v-for="c in THEME" :key="c" type="button" class="fmt-swatch" :class="{ rim: c === '#FFFFFF' }" :style="{ background: c }" :title="c" @click="pickSwatch(c)" />
          </div>
          <div class="fmt-pal-grid">
            <button v-for="(c, i) in SHADES" :key="i" type="button" class="fmt-swatch" :style="{ background: c }" :title="c" @click="pickSwatch(c)" />
          </div>
          <div class="fmt-pal-label">标准色</div>
          <div class="fmt-pal-row">
            <button v-for="c in STANDARD" :key="c" type="button" class="fmt-swatch" :style="{ background: c }" :title="c" @click="pickSwatch(c)" />
          </div>
          <div class="fmt-pal-label">最近用过</div>
          <div class="fmt-pal-row">
            <button v-for="c in RECENT" :key="c" type="button" class="fmt-swatch" :style="{ background: c }" :title="c" @click="pickSwatch(c)" />
          </div>
          <div class="fmt-pal-foot">
            <button type="button" class="fmt-pal-act" title="去掉颜色" @click="run('nocolor')"><Icon name="eraser" :size="16" /></button>
            <button type="button" class="fmt-pal-act" title="更多颜色" @click="moreColor"><Icon name="palette" :size="16" /></button>
          </div>
        </div>
      </span>
      <span class="fmt-sep" />
      <button type="button" class="fmt-btn" id="rtImage" title="插入图片" @mousedown.prevent @click="run('image')"><Icon name="image" :size="16" /></button>
      <button type="button" class="fmt-btn" id="rtMark" title="插入「此处放图片」" @mousedown.prevent @click="run('mark')"><Icon name="layers" :size="16" /></button>
      <span class="fmt-drop fmt-width" id="rtWidth">
        <button type="button" class="fmt-btn fmt-caret fmt-width-btn" title="正文宽度（阅读和编辑共用）" @mousedown.prevent @click="toggle('width')">
          {{ widthShort }}<Icon name="chev-down" :size="10" />
        </button>
        <div v-if="open === 'width'" class="fmt-pop" @mousedown.prevent>
          <button
            v-for="w in CONTENT_WIDTHS" :key="w.px" type="button"
            :class="{ on: layout.contentWidth === w.px }"
            :data-w="w.px"
            @click="pickWidth(w.px)"
          >{{ w.label }}</button>
        </div>
      </span>
  </div>
</template>

<script setup>
import { computed, onMounted, onBeforeUnmount, reactive, ref } from 'vue';
import Icon from './common/Icon.vue';
import { CONTENT_WIDTHS, useLayoutStore } from '../stores/layout.js';
import { useEditorStore } from '../stores/editor.js';

const THEME = ['#FFFFFF', '#1F2329', '#F4EFE6', '#1C2B4A', '#5C7A99', '#C4564A', '#6E7D45', '#7D6B86', '#2E6E6A', '#C56A2F'];
const STANDARD = ['#C00000', '#FF0000', '#FFC000', '#FFFF00', '#92D050', '#00B050', '#00B0F0', '#0070C0', '#002060', '#7030A0'];
const RECENT = ['#D83931', '#DE7802', '#245BDB', '#6425D0', '#646A73'];

function mix(hex, toward, t) {
  const h = hex.slice(1);
  const p = (i) => parseInt(h.slice(i, i + 2), 16);
  const q = (i) => parseInt(toward.slice(i + 1, i + 3), 16);
  const ch = (i) => Math.round(p(i) + (q(i) - p(i)) * t).toString(16).padStart(2, '0');
  return `#${ch(0)}${ch(2)}${ch(4)}`.toUpperCase();
}
const SHADES = [0.82, 0.64, 0.46, 0.28, 0.12].flatMap((t) => THEME.map((c) => (
  c === '#FFFFFF' ? mix('#F3F4F6', '#6B7280', 1 - t) : mix('#FFFFFF', c, 1 - t)
)));

const ed = useEditorStore();
const layout = useLayoutStore();
const color = ref('#333333');
const open = ref('');
const active = reactive({
  bold: false, italic: false, strike: false,
  h1: false, h2: false, h3: false, h4: false,
  list: false, ol: false, quote: false, brush: false,
});
const widthShort = computed(() => (layout.contentWidth > 0 ? String(layout.contentWidth) : '满'));

function pickWidth(px) {
  layout.setContentWidth(px);
  closeMenus();
}

function api() {
  return document.getElementById('editor')?._rich;
}

function sync() {
  const r = api();
  if (!r?.isActive) return;
  active.bold = r.isActive('bold');
  active.italic = r.isActive('italic');
  active.strike = r.isActive('strike');
  active.h1 = r.isActive('h1');
  active.h2 = r.isActive('h2');
  active.h3 = r.isActive('h3');
  active.h4 = r.isActive('h4');
  active.list = r.isActive('list');
  active.ol = r.isActive('ol');
  active.quote = r.isActive('quote');
  active.brush = r.isActive('brush');
  color.value = r.getColor?.() || '#333333';
}

function toggle(name) {
  open.value = open.value === name ? '' : name;
}

function closeMenus() { open.value = ''; }

function refreshSelTarget() {
  const r = api();
  const sel = r?.getSelection?.();
  if (!sel || !ed.menus.sel) return;
  const coords = r.coordsAt?.(sel.end) || {};
  ed.menus.sel = {
    ...ed.menus.sel,
    left: coords.left ?? ed.menus.sel.left,
    top: coords.top ?? ed.menus.sel.top,
    bottom: coords.bottom ?? ed.menus.sel.bottom,
    target: { start: sel.start, end: sel.end, text: sel.text },
  };
}

/* 点浮层按钮时浏览器常先收掉选区；有划词菜单就按记下的区间再套格式 */
function restoreSel() {
  const r = api();
  const t = ed.menus.sel?.target;
  if (!r?.setSelection || !t || !(t.end > t.start)) return;
  r.setSelection(t.start, t.end);
}

function run(op) {
  restoreSel();
  api()?.format?.(op);
  closeMenus();
  sync();
  refreshSelTarget();
}

function pickSwatch(c) {
  onColor(c);
  closeMenus();
}

function moreColor() {
  document.querySelector('#rtColor input')?.click();
}

function onColorDown() {
  restoreSel();
  api()?.saveSel?.();
}

function onColor(v) {
  restoreSel();
  api()?.setColor?.(v);
  sync();
  refreshSelTarget();
}

let tick = 0;
function onDocClick(e) {
  if (!e.target.closest?.('.fmt-drop')) closeMenus();
}
onMounted(() => {
  sync();
  tick = window.setInterval(sync, 400);
  document.addEventListener('selectionchange', sync);
  document.addEventListener('mousedown', onDocClick);
});
onBeforeUnmount(() => {
  clearInterval(tick);
  document.removeEventListener('selectionchange', sync);
  document.removeEventListener('mousedown', onDocClick);
});
</script>
