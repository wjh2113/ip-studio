<template>
<div class="pop-menu" id="selMenu" ref="box" :class="{ hidden: !m }" :style="pos">
  <!-- 划词菜单：选中正文里的一段，挑一种改法；或者自己写一句意见，只改这一段 -->
  <div class="sel-acts">
    <button v-for="a in ASSIST_ACTIONS" :key="a.key" type="button" :data-action="a.key" @click="pick(a)">{{ a.label }}</button>
  </div>
  <form class="pop-custom sel-custom" id="selCustom" @submit.prevent="custom">
    <input id="selCustomInput" v-model="want" maxlength="500" placeholder="按我的意见改：比如「加一个具体例子」「语气再坚定些」" @keydown.stop />
    <button type="submit" class="btn primary small" id="selCustomBtn" :disabled="!want.trim()">改这段</button>
  </form>
</div>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import { ASSIST_ACTIONS, useEditorStore } from '../stores/editor.js';
import { placeNear } from '../lib/caret.js';

const ed = useEditorStore();
const m = computed(() => ed.menus.sel);
const box = ref(null);
const pos = ref({});
const want = ref('');

// 先显示出来量尺寸，再放到选区旁边（下面放不下放上面）
watch(m, async (v) => {
  if (!v) return;
  await nextTick();
  pos.value = placeNear(box.value, v);
});

function pick(a) {
  const target = m.value?.target;
  ed.menus.sel = null;
  if (target) ed.runAssist({ action: a.key, kind: 'rewrite', target }, a.label);
}

/* 自己写的意见：只改选中这段，结果照样在浮层里看了再替换，能撤销 */
function custom() {
  const target = m.value?.target;
  const text = want.value.trim();
  if (!target || !text) return;
  ed.menus.sel = null;
  want.value = '';
  ed.runAssist({ action: 'custom', kind: 'rewrite', instruction: text, target }, `按意见改：${text.slice(0, 16)}${text.length > 16 ? '…' : ''}`);
}
</script>
