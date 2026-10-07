<template>
  <div v-if="r.tone.open" class="tone-box" id="toneBox">
    <div class="tone-head">
      <b>AI 味扫描</b>
      <span class="hint">{{ head }}</span>
      <span class="grow"></span>
      <button class="icon-btn" id="toneClose" title="收起" @click="r.tone.open = false">×</button>
    </div>
    <p v-if="r.tone.error" class="form-error">{{ r.tone.error }}</p>
    <div v-for="(f, i) in r.tone.flags || []" :key="i" class="tone-item" :class="`lv-${f.level}`" :data-tone="f.rule">
      <p class="tone-what">{{ f.what }}</p>
      <p v-if="f.quote" class="flag-quote">「{{ f.quote }}」</p>
      <p class="flag-fix">建议：{{ f.suggestion }}</p>
    </div>
    <p v-if="r.tone.flags?.length" class="hint tone-tip">改法：进入「修改」，选中那一句，在弹出的菜单里点「去 AI 味」，会按你的语气重写这一段，事实不变。</p>
  </div>
</template>

<script setup>
/* 成稿区「检查结果」面板里的 AI 味扫描结果。数据在 stores/review.js（tone） */
import { computed } from 'vue';
import { useReviewStore } from '../stores/review.js';

const r = useReviewStore();
const head = computed(() => {
  if (r.tone.running) return '正在扫…';
  if (!r.tone.flags) return '';
  return r.tone.flags.length ? `找到 ${r.tone.flags.length} 处像 AI 写的地方（只看说法和结构，不花点数）` : '没找到明显的 AI 腔，挺好';
});
</script>
