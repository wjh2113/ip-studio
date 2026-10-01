<template>
  <div v-if="r.open" class="review" id="reviewBox" :class="[worst, { stale: r.stale }]">
    <!-- 成稿检查：错字、通顺性、调性与风险。逐条采纳，采纳后停手 2.5 秒自动再查一遍 -->
    <div class="review-head">
      <span class="review-verdict" id="reviewVerdict" :class="verdictClass">{{ verdictText }}</span>
      <span v-if="hasRisk" class="review-risk" id="reviewRisk" :class="`lv-${res.risk}`">风险 {{ res.risk }}</span>
      <span class="review-summary" id="reviewSummary">{{ summary }}</span>
      <span class="grow"></span>
      <button v-if="res && res.issues.length >= 2" class="btn ghost small" id="reviewApplyAll" @click="r.applyAll()">全部采纳</button>
      <button class="icon-btn" id="reviewClose" title="收起" @click="r.open = false">×</button>
    </div>
    <div class="review-flags" id="reviewFlags">
      <div v-for="(f, i) in res?.flags || []" :key="i" class="flag" :class="`lv-${f.level}`">
        <div class="flag-top">
          <span class="flag-dim">{{ f.dimension }}</span>
          <span class="flag-level">{{ f.level }}</span>
          <span v-if="f.source === '词库'" class="flag-src" title="本地违禁词库命中：一定出现过，是否违规看语境">词库</span>
        </div>
        <p class="flag-what">{{ f.what }}</p>
        <p v-if="f.quote" class="flag-quote">「{{ f.quote }}」<em v-if="!f.locatable">（原文里没精确匹配到，位置仅供参考）</em></p>
        <p class="flag-fix">建议：{{ f.suggestion }}</p>
      </div>
    </div>
    <div class="review-list" id="reviewList">
      <div v-for="(it, i) in res?.issues || []" :key="i" class="issue" :class="{ done: r.handled.has(i) }" :data-issue="i">
        <div class="issue-top">
          <span class="issue-type">{{ it.type }}</span>
          <span class="issue-why">{{ it.why }}</span>
          <span v-if="it.count > 1" class="issue-why">· 原文出现 {{ it.count }} 次，只改第一处</span>
        </div>
        <div class="issue-diff">
          <div class="from">{{ it.quote }}</div>
          <div class="to">{{ it.fix }}</div>
        </div>
        <div class="issue-actions">
          <button class="btn primary small" :data-apply="i" @click="r.apply(i)">采纳</button>
          <button class="btn ghost small" :data-skip="i" @click="r.skip(i)">忽略</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { VERDICT_LABEL, useReviewStore } from '../stores/review.js';

const r = useReviewStore();
const res = computed(() => r.result);

const hasRisk = computed(() => Boolean(res.value?.risk && res.value.risk !== '无'));
const worst = computed(() => {
  if (r.error) return 'bad';
  const x = res.value;
  if (!x) return '';
  return x.risk === '高' ? 'bad' : x.risk === '中' ? 'minor' : x.verdict;
});
const verdictClass = computed(() => (r.error ? 'bad' : res.value?.verdict || ''));
const verdictText = computed(() => {
  if (r.error) return '检查失败';
  if (!res.value) return '检查中';
  return VERDICT_LABEL[res.value.verdict] || res.value.verdict;
});
const summary = computed(() => {
  if (r.error) return r.error;
  if (r.stale) return '正文已改，正在重新检测…';
  const x = res.value;
  if (!x) return '正在通读全文…';
  const notes = [x.dropped ? `${x.dropped} 条在原文里对不上` : '', x.padded ? `${x.padded} 条凑数提示` : ''].filter(Boolean);
  return (x.summary || '') + (notes.length ? `　（已忽略：${notes.join('、')}）` : '');
});
</script>
