<template>
<div class="pop-menu sel-menu" id="selMenu" ref="box" :class="{ hidden: !m }" :style="pos">
  <!-- 划词浮层：AI 改写 + 格式条（嵌在浮层里，不再被顶栏工具条穿透） -->
  <div class="sel-acts">
    <button v-for="a in topActs" :key="a.key" type="button" :data-action="a.key" @mousedown.prevent @click="pick(a)">{{ a.label }}</button>
  </div>
  <FormatBar variant="chips" class="sel-fmt" />
  <div class="sel-acts">
    <button v-for="a in bottomActs" :key="a.key" type="button" :data-action="a.key" @mousedown.prevent @click="pick(a)">{{ a.label }}</button>
  </div>
  <form class="pop-custom sel-custom" id="selCustom" @submit.prevent="custom">
    <input id="selCustomInput" v-model="want" maxlength="500" placeholder="按我的意见改：比如「加一个具体例子」「语气再坚定些」" @keydown.stop />
    <button type="submit" class="btn primary small" id="selCustomBtn" :disabled="!want.trim()">改这段</button>
  </form>
</div>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import FormatBar from './FormatBar.vue';
import { ASSIST_ACTIONS, useEditorStore } from '../stores/editor.js';
import { placeNear } from '../lib/caret.js';

const ed = useEditorStore();
const m = computed(() => ed.menus.sel);
const box = ref(null);
const pos = ref({});
const want = ref('');

/* 对照截图：上三下三夹格式条；缩写仍保留在下组 */
const topActs = ASSIST_ACTIONS.filter((a) => ['expand', 'professional', 'casual'].includes(a.key));
const bottomActs = ASSIST_ACTIONS.filter((a) => ['shorten', 'example', 'simplify', 'humanize'].includes(a.key));

watch(m, async (v) => {
  if (!v) return;
  want.value = '';
  await nextTick();
  pos.value = placeNear(box.value, v);
});

function pick(a) {
  const target = m.value?.target;
  ed.menus.sel = null;
  if (target) ed.runAssist({ action: a.key, kind: 'rewrite', target }, a.label);
}

function custom() {
  const target = m.value?.target;
  const text = want.value.trim();
  if (!target || !text) return;
  ed.menus.sel = null;
  want.value = '';
  ed.runAssist({ action: 'custom', kind: 'rewrite', instruction: text, target }, `按意见改：${text.slice(0, 16)}${text.length > 16 ? '…' : ''}`);
}
</script>
