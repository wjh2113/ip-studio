<template>
<div class="pop-menu" id="slashMenu" ref="box" :class="{ hidden: !m }" :style="pos">
  <!-- 编辑时输入 / 唤起：让 AI 接着写，或者直接说要写什么 -->
  <div class="pop-items" id="slashItems">
    <button v-for="a in COMPOSE_ACTIONS" :key="a.key" :data-compose="a.key" @click="run({ action: a.key }, a.label)">{{ a.label }}</button>
  </div>
  <div class="pop-custom">
    <input id="slashInput" v-model="text" placeholder="或直接说要写什么，回车确认" maxlength="200" @keydown.enter.prevent="custom" />
  </div>
</div>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import { COMPOSE_ACTIONS, useEditorStore } from '../stores/editor.js';
import { useStudioStore } from '../stores/studio.js';
import { placeNear } from '../lib/caret.js';

const ed = useEditorStore();
const s = useStudioStore();
const m = computed(() => ed.menus.slash);
const box = ref(null);
const pos = ref({});
const text = ref('');

watch(m, async (v) => {
  if (!v) return;
  text.value = '';
  await nextTick();
  pos.value = placeNear(box.value, v);
});

/* 去掉打出来的那个 / 或 ／，在那里插入 */
function consume() {
  const at = m.value.at;
  const raw = s.draft.content;
  ed.onInput(raw.slice(0, at) + raw.slice(at + 1));
  ed.menus.slash = null;
  return at;
}

function run(req, label) {
  if (!m.value || !s.draft) return;
  const at = consume();
  ed.runAssist({ ...req, kind: 'compose', target: { start: at, end: at, text: '' } }, label);
}

function custom() {
  const instruction = text.value.trim();
  if (instruction) run({ instruction }, instruction);
}
</script>
