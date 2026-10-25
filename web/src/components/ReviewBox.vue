<template>
  <div class="review chat-card" :id="latest ? 'reviewBox' : null" :class="worst">
    <!-- 检查结果卡片（在右栏 AI 对话里）：错字、通顺性可以逐条采纳；调性与风险只提示，可以「交给 AI 改」接着在对话里改 -->
    <div class="review-head">
      <Icon name="shield" :size="14" />
      <span class="review-verdict" :id="latest ? 'reviewVerdict' : null" :class="res.verdict">{{ VERDICT_LABEL[res.verdict] || res.verdict || '已检查' }}</span>
      <span v-if="hasRisk" class="review-risk" :class="`lv-${res.risk}`">风险 {{ res.risk }}</span>
      <span v-if="ver" class="review-ver">{{ s.platformLabel(ver) }}版</span>
      <span class="grow"></span>
      <button v-if="openCount >= 2" type="button" class="mini primary" :id="latest ? 'reviewApplyAll' : null" data-act="apply-all" @click="c.applyAllIssues(m)">全部采纳</button>
    </div>
    <p class="review-summary" :id="latest ? 'reviewSummary' : null">{{ summary }}</p>

    <div v-if="res.issues?.length" class="review-list" :id="latest ? 'reviewList' : null">
      <div v-for="(it, i) in res.issues" :key="`i${i}`" class="issue locatable" :class="{ done: c.isHandled(m, i), gone: !c.isHandled(m, i) && !c.fitsIssue(m, i) }"
        :data-issue="i" title="点一下，在左边原文里定位到这句" @click="locate(c.isHandled(m, i) && !c.fitsIssue(m, i) ? it.fix : it.quote)">
        <div class="issue-top">
          <span class="issue-type">{{ it.type }}</span>
          <span class="issue-why">{{ it.why }}</span>
          <span v-if="it.count > 1" class="issue-why">· 原文出现 {{ it.count }} 次，只改第一处</span>
          <span v-if="!c.isHandled(m, i) && !c.fitsIssue(m, i)" class="issue-gone">原文已改，对不上了</span>
        </div>
        <div class="issue-diff">
          <div class="from">{{ it.quote }}</div>
          <div class="to">{{ it.fix }}</div>
        </div>
        <div class="issue-actions">
          <button type="button" class="mini primary" :data-apply="i" :disabled="c.isHandled(m, i) || !c.fitsIssue(m, i)" @click.stop="c.applyIssue(m, i)">{{ c.isHandled(m, i) ? '已处理' : '采纳' }}</button>
          <template v-if="!c.isHandled(m, i)">
            <button type="button" class="mini ghost" :data-skip="i" @click.stop="c.skipIssue(m, i)">忽略</button>
            <button type="button" class="mini ghost" data-askai="issue" title="不想照建议改：在对话里让 AI 换个改法"
              @click.stop="c.askAbout({ quote: it.quote, what: `${it.type}：${it.why}`, suggestion: it.fix ? `改成「${it.fix}」` : '', ver })">让 AI 改</button>
          </template>
        </div>
      </div>
    </div>

    <div v-if="res.flags?.length" class="review-flags" :id="latest ? 'reviewFlags' : null">
      <div v-for="(f, i) in res.flags" :key="`f${i}`" class="flag" :class="[`lv-${f.level}`, { locatable: f.quote }]"
        :title="f.quote ? '点一下，在左边原文里定位到这句' : null" :data-flag="i" @click="f.quote && locate(f.quote)">
        <div class="flag-top">
          <span class="flag-dim">{{ f.dimension }}</span>
          <span class="flag-level">{{ f.level }}</span>
          <span v-if="f.source === '词库'" class="flag-src" title="本地违禁词库命中：一定出现过，是否违规看语境">词库</span>
          <span v-if="f.source === '规则'" class="flag-src" title="AI 味规则命中：只是说法像 AI，改不改你定">规则</span>
          <span v-if="f.source === '模型'" class="flag-src" title="AI 味模型命中：说法和节奏">模型</span>
        </div>
        <p class="flag-what">{{ f.what }}</p>
        <p v-if="f.quote" class="flag-quote">「{{ f.quote }}」<em v-if="f.locatable === false">（原文里没精确匹配到，位置仅供参考）</em></p>
        <p class="flag-fix">建议：{{ f.suggestion }}</p>
        <button type="button" class="link-btn ask-ai" data-askai="flag" title="带着这句和这条意见，在对话里让 AI 改"
          @click.stop="c.askAbout({ quote: f.quote, what: `${f.dimension}：${f.what}`, suggestion: f.suggestion, ver })">让 AI 改</button>
      </div>
    </div>

    <p v-if="by" class="chat-by card-by">{{ by }}</p>

    <div class="chat-card-foot">
      <span v-if="handledCount" class="hint">已处理 {{ handledCount }} 条，剩下的照样能点。</span>
      <span class="grow"></span>
      <button type="button" class="link-btn" :id="latest ? 'reviewRecheck' : null" :disabled="r.running" @click="r.recheck()">改完了，再检查一遍</button>
      <button type="button" class="link-btn" :id="latest ? 'toneScanBtn' : null" :disabled="r.tone.running" title="用模型看说法和节奏像不像 AI，并上本地硬词规则" @click="r.scanTone()">扫 AI 味</button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import Icon from './common/Icon.vue';
import { VERDICT_LABEL, useReviewStore } from '../stores/review.js';
import { useChatStore } from '../stores/chat.js';
import { useEditorStore } from '../stores/editor.js';
import { useStudioStore } from '../stores/studio.js';

const p = defineProps({ m: { type: Object, required: true }, latest: { type: Boolean, default: false } });
const r = useReviewStore();
const c = useChatStore();
const ed = useEditorStore();
const s = useStudioStore();

const res = computed(() => p.m.review || {});
// 卡片底下标一句：哪个模型查的、对照了哪些技能
const by = computed(() => {
  const md = p.m.model;
  const model = !md ? '' : md.name ? `${md.auto ? '自动 · ' : ''}${md.name}` : (md.auto ? '自动选模型' : '');
  const skills = p.m.skills?.length ? `对照技能：${p.m.skills.map((k) => k.name).join('、')}` : '';
  return [model, skills].filter(Boolean).join(' · ');
});
const ver = computed(() => res.value.version || ed.editVer || '');
const hasRisk = computed(() => Boolean(res.value.risk && res.value.risk !== '无'));
const worst = computed(() => (res.value.risk === '高' ? 'bad' : res.value.risk === '中' ? 'minor' : res.value.verdict || ''));
const handledCount = computed(() => (p.m.handled || []).length);
const openCount = computed(() => (res.value.issues || []).filter((_, i) => !c.isHandled(p.m, i) && c.fitsIssue(p.m, i)).length);
const summary = computed(() => {
  const x = res.value;
  const notes = [x.dropped ? `${x.dropped} 条在原文里对不上` : '', x.padded ? `${x.padded} 条凑数提示` : ''].filter(Boolean);
  const base = x.summary || (x.issues?.length || x.flags?.length ? '' : '没发现要改的地方。');
  return base + (notes.length ? `（已忽略：${notes.join('、')}）` : '');
});

/* 点一条：在左边原文里定位到那句（在选字复制时不跳） */
function locate(quote) {
  if (window.getSelection?.().toString()) return;
  ed.locate(quote, { ver: ver.value });
}
</script>
