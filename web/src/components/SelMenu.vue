<template>
<div class="pop-menu" id="selMenu" ref="box" :class="{ hidden: !m }" :style="pos">
  <!-- 划词菜单：选中正文里的一段，挑一种改法 -->
  <button v-for="a in ASSIST_ACTIONS" :key="a.key" :data-action="a.key" @click="pick(a)">{{ a.label }}</button>
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
</script>
