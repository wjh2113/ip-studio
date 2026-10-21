<template>
  <div v-if="r.tone.open" class="tone-box" id="toneBox">
    <div class="tone-head">
      <b>AI 味扫描</b>
      <span class="hint">{{ head }}</span>
      <span class="grow"></span>
      <button class="icon-btn" id="toneClose" title="收起" @click="r.tone.open = false">×</button>
    </div>
    <p v-if="r.tone.error" class="form-error">{{ r.tone.error }}</p>
    <div v-for="(f, i) in r.tone.flags || []" :key="i" class="tone-item" :class="[`lv-${f.level}`, { locatable: f.quote }]" :data-tone="f.rule"
      :title="f.quote ? '点一下，在左边原文里定位到这句' : null" @click="f.quote && ed.locate(f.quote, { ver: r.tone.version || '' })">
      <div class="flag-top">
        <span class="flag-level">{{ f.level }}</span>
        <span v-if="f.source === '规则'" class="flag-src" title="本地硬词/结构规则命中">规则</span>
        <span v-else-if="f.source === '模型'" class="flag-src" title="模型看说法和节奏">模型</span>
      </div>
      <p class="tone-what">{{ f.what }}</p>
      <p v-if="f.quote" class="flag-quote">「{{ f.quote }}」</p>
      <p class="flag-fix">建议：{{ f.suggestion }}</p>
      <button type="button" class="link-btn ask-ai" data-askai="tone" title="带着这句去右栏 AI 对话，让它按你的语气改"
        @click.stop="chat.askAbout({ quote: f.quote, what: `像 AI 写的：${f.what}`, suggestion: f.suggestion, ver: r.tone.version || '' })">交给 AI 改</button>
    </div>
    <p v-if="r.tone.flags?.length" class="hint tone-tip">点一条会在左边原文里定位到那句。改法：点那条的「交给 AI 改」，或选中那一句，在改写菜单里点「去 AI 味」，都会按你的语气重写，事实不变。</p>
  </div>
</template>

<script setup>
/* 成稿区「检查结果」面板里的 AI 味扫描结果。数据在 stores/review.js（tone） */
import { computed } from 'vue';
import { useReviewStore } from '../stores/review.js';
import { useEditorStore } from '../stores/editor.js';
import { useChatStore } from '../stores/chat.js';

const r = useReviewStore();
const ed = useEditorStore();
const chat = useChatStore();
const head = computed(() => {
  if (r.tone.running) return '正在扫…';
  if (!r.tone.flags) return '';
  return r.tone.flags.length ? `找到 ${r.tone.flags.length} 处像 AI 写的地方` : '没找到明显的 AI 腔，挺好';
});
</script>
