<template>
  <div class="fmt-bar" :class="[`fmt-${variant}`, variant === 'chips' ? 'fmt-chips' : '']" role="toolbar" aria-label="格式" @mousedown.stop>
    <!-- 顶栏图标版 / 划词浮层文字版；命令走 #editor._rich -->
    <template v-if="variant === 'icons'">
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
      <span class="fmt-drop">
        <label class="fmt-btn fmt-color" id="rtColor" title="文字颜色" @mousedown.prevent="onColorDown">
          <input type="color" :value="color" @input="onColor($event.target.value)" />
          <span class="fmt-letter fmt-a" :style="{ borderBottomColor: color }">A</span>
        </label>
        <button type="button" class="fmt-btn fmt-caret" title="常用颜色" @mousedown.prevent @click="toggle('color')"><Icon name="chev-down" :size="10" /></button>
        <div v-if="open === 'color'" class="fmt-pop fmt-swatches" @mousedown.prevent>
          <button v-for="c in COLORS" :key="c" type="button" class="fmt-swatch" :style="{ background: c }" :title="c" @click="pickSwatch(c)" />
        </div>
      </span>
      <span class="fmt-sep" />
      <button type="button" class="fmt-btn" id="rtImage" title="插入图片" @mousedown.prevent @click="run('image')"><Icon name="image" :size="16" /></button>
      <button type="button" class="fmt-btn" id="rtMark" title="插入「此处放图片」" @mousedown.prevent @click="run('mark')"><Icon name="layers" :size="16" /></button>
    </template>
    <template v-else>
      <button type="button" class="fmt-chip" data-fmt="bold" :class="{ on: active.bold }" @mousedown.prevent @click="run('bold')">加粗</button>
      <button type="button" class="fmt-chip" data-fmt="h2" :class="{ on: active.h2 }" @mousedown.prevent @click="run('h2')">标题</button>
      <button type="button" class="fmt-chip" data-fmt="list" :class="{ on: active.list }" @mousedown.prevent @click="run('list')">列表</button>
      <button type="button" class="fmt-chip" data-fmt="quote" :class="{ on: active.quote }" @mousedown.prevent @click="run('quote')">引用</button>
      <label class="fmt-chip fmt-color" data-fmt="color" @mousedown.prevent="onColorDown">
        <input type="color" :value="color" @input="onColor($event.target.value)" />
        颜色
      </label>
      <button type="button" class="fmt-chip" data-fmt="image" @mousedown.prevent @click="run('image')">图片</button>
      <button type="button" class="fmt-chip" data-fmt="mark" @mousedown.prevent @click="run('mark')">放图标记</button>
    </template>
  </div>
</template>

<script setup>
import { onMounted, onBeforeUnmount, reactive, ref } from 'vue';
import Icon from './common/Icon.vue';
import { useEditorStore } from '../stores/editor.js';

defineProps({
  variant: { type: String, default: 'icons' }, // icons | chips
});

const COLORS = ['#1F2329', '#D83931', '#DE7802', '#245BDB', '#6425D0', '#646A73'];

const ed = useEditorStore();
const color = ref('#333333');
const open = ref('');
const active = reactive({
  bold: false, italic: false, strike: false,
  h1: false, h2: false, h3: false, h4: false,
  list: false, ol: false, quote: false, brush: false,
});

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
