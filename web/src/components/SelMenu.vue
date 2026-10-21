<template>
<div class="pop-menu sel-menu" id="selMenu" ref="box" :class="{ hidden: !m }" :style="pos">
  <!-- 改写只出一键动作；想按自己的意思改，点「问 AI」带着这段去右栏对话。加粗、颜色、列表在顶栏工具条 -->
  <div class="sel-acts">
    <button v-for="a in acts" :key="a.key" type="button" :data-action="a.key" @mousedown.prevent @click="pick(a)">{{ a.label }}</button>
    <!-- 带着这段去右栏对话：「这段」就指它 -->
    <button type="button" class="sel-ask" id="selAskBtn" data-action="ask" @mousedown.prevent @click="askAi">问 AI：说说怎么改</button>
  </div>
</div>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import { ASSIST_ACTIONS, useEditorStore } from '../stores/editor.js';
import { placeNear } from '../lib/caret.js';
import { useChatStore } from '../stores/chat.js';

const ed = useEditorStore();
const m = computed(() => ed.menus.sel);
const box = ref(null);
const pos = ref({});

const acts = ASSIST_ACTIONS;

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

function askAi() {
  const target = m.value?.target;
  ed.menus.sel = null;
  if (target?.text) useChatStore().open({ quote: target.text });
}

</script>
