<template>
  <div v-if="cmp" class="revise-diff" id="reviseDiff">
    <div class="rev-bar">
      <span>按意见重写后的对照：改动的段落已标出，不满意可单独退回。</span>
      <span class="grow"></span>
      <button type="button" class="btn ghost small" id="reviseDiffClose" @click="ed.closeReviseCompare()">收起</button>
    </div>
    <div class="revise-paras">
      <div v-for="(p, i) in paras" :key="i" class="revise-para" :class="{ changed: p.changed }">
        <div class="revise-para-h">
          <b>第 {{ i + 1 }} 段</b>
          <span v-if="p.changed" class="revise-tag">有改动</span>
          <span class="grow"></span>
          <button v-if="p.changed && p.old" type="button" class="btn ghost small" :data-para="i"
            @click="ed.revertReviseParagraph(i)">退回这段</button>
        </div>
        <div class="revise-para-body">{{ p.new || '（空）' }}</div>
        <div v-if="p.changed && p.old" class="revise-para-old">重写前：{{ p.old }}</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useEditorStore } from '../stores/editor.js';

const ed = useEditorStore();
const cmp = computed(() => ed.reviseCompare);

const paras = computed(() => {
  const c = cmp.value;
  if (!c) return [];
  const oldParts = String(c.before || '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
  const newParts = String(c.after || '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
  const n = Math.max(oldParts.length, newParts.length);
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const o = oldParts[i] ?? '';
    const nw = newParts[i] ?? '';
    out.push({ old: o, new: nw, changed: o !== nw });
  }
  return out;
});
</script>
