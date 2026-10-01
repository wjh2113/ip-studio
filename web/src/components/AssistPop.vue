<template>
<div class="assist-pop" id="assistPop" ref="box" :class="{ hidden: !a }" :style="pos">
  <!-- AI 改写 / 续写的结果：先看，再决定替换、插入还是重来 -->
  <div class="assist-head">
    <span id="assistTitle">AI · {{ a?.label }}</span>
    <button class="icon-btn" id="assistClose" title="关闭" @click="ed.closeAssist()">×</button>
  </div>
  <div class="assist-body" id="assistBody">
    <span v-if="a?.error" class="err">{{ a.error }}</span>
    <template v-else>{{ a?.text }}<span v-if="a && !a.done" class="cursor"></span></template>
  </div>
  <div class="assist-foot">
    <button class="btn ghost small" id="assistRetry" @click="ed.retryAssist()">重来一次</button>
    <span class="grow"></span>
    <button v-if="a?.kind !== 'compose'" class="btn ghost small" id="assistInsert" :disabled="!a?.text || !a?.done" @click="ed.applyAssist('after')">插入到后面</button>
    <button class="btn primary small" id="assistReplace" :disabled="!a?.text || !a?.done" @click="ed.applyAssist('replace')">{{ a?.kind === 'compose' ? '插入到光标处' : '替换原文' }}</button>
  </div>
</div>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import { useEditorStore } from '../stores/editor.js';

const ed = useEditorStore();
const a = computed(() => ed.assist);
const box = ref(null);
const pos = ref({});

/* 浮在成稿卡片的右上角，不盖住选中的那段 */
watch(a, async (v, old) => {
  if (!v || v === old) return;
  await nextTick();
  const anchor = document.getElementById('contentCard')?.getBoundingClientRect();
  if (!anchor || !box.value) return;
  const b = box.value.getBoundingClientRect();
  pos.value = {
    left: `${Math.max(8, Math.min(anchor.right - b.width, window.innerWidth - b.width - 8))}px`,
    top: `${Math.max(8, Math.min(window.innerHeight - b.height - 8, anchor.top + 60))}px`,
  };
});
</script>
