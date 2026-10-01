<template>
  <div class="rev-pane" id="revPane">
    <!-- 正文历史：每次保存前都会留下上一版。点一版，和现在这篇逐行对照 -->
    <div class="rev-bar">
      <span>每次保存前都会留下上一版。点一版，和现在这篇对照。正文没改过不会重复记。</span>
      <span class="grow"></span>
      <button type="button" class="btn ghost small" id="revClose" @click="ed.toggleRevs(false)">收起</button>
    </div>
    <div class="rev-body">
      <div class="rev-list" id="revList">
        <button v-for="(r, i) in s.revisions" :key="r.id" type="button" class="rev-item" :class="{ on: r.id === s.revId }"
          :data-rid="r.id" @click="open(r.id)">
          <b>{{ fmtRevTime(r.created_at) }}</b>
          <span>{{ r.chars }} 字{{ i === 0 ? ' · 最新存档' : '' }}</span>
        </button>
        <p v-if="!s.revisions.length" class="rev-empty">还没有存档。写出正文并保存之后，这里会留下每一版。</p>
      </div>
      <div class="rev-cols">
        <div class="rev-col">
          <div class="rev-col-h" id="revLeftLabel">{{ leftLabel }}</div>
          <div class="rev-text" id="revLeft"><div v-for="(row, i) in diff.left" :key="i" class="rev-line" :class="row.k === 'same' ? '' : row.k">{{ row.t || ' ' }}</div></div>
        </div>
        <div class="rev-col">
          <div class="rev-col-h">当前正文</div>
          <div class="rev-text" id="revRight"><div v-for="(row, i) in diff.right" :key="i" class="rev-line" :class="row.k === 'same' ? '' : row.k">{{ row.t || ' ' }}</div></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useStudioStore } from '../stores/studio.js';
import { fmtRevTime, lineDiff, useEditorStore } from '../stores/editor.js';
import { toast } from '../lib/feedback.js';

const s = useStudioStore();
const ed = useEditorStore();

/* 对照随正文变化：编辑时停手 200ms 再算，长文逐字重算会卡 */
const body = ref(s.draft?.content || '');
let timer = 0;
watch(() => s.draft?.content, (v) => {
  clearTimeout(timer);
  timer = setTimeout(() => { body.value = v || ''; }, 200);
});
onBeforeUnmount(() => clearTimeout(timer));

const diff = computed(() => {
  const d = lineDiff((s.revText || '').split('\n'), body.value.split('\n'));
  return {
    left: d.left.length ? d.left : [{ t: '', k: 'same' }],
    right: d.right.length ? d.right : [{ t: '', k: 'same' }],
  };
});

const leftLabel = computed(() => {
  const row = s.revisions.find((r) => r.id === s.revId);
  if (!row) return '选一版';
  return `${fmtRevTime(row.created_at)}${(s.revText || '') === body.value ? ' · 和当前一样' : ''}`;
});

function open(id) {
  ed.openRev(id).catch((err) => toast(err.message));
}
</script>
