<template>
  <div class="tone-box chat-card" :id="latest ? 'toneBox' : null">
    <!-- AI 味扫描卡片（在右栏 AI 对话里）：点一条定位到原句，「让 AI 改」在对话里按你的语气改 -->
    <div class="tone-head">
      <Icon name="sparkles" :size="14" />
      <b>AI 味扫描</b>
      <span class="hint">{{ m.flags?.length ? `找到 ${m.flags.length} 处像 AI 写的地方` : '没找到明显的 AI 腔，挺好' }}</span>
    </div>
    <div v-for="(f, i) in m.flags || []" :key="i" class="tone-item" :class="[`lv-${f.level}`, { locatable: f.quote }]" :data-tone="f.rule"
      :title="f.quote ? '点一下，在左边原文里定位到这句' : null" @click="f.quote && locate(f.quote)">
      <div class="flag-top">
        <span class="flag-level">{{ f.level }}</span>
        <span v-if="f.source === '规则'" class="flag-src" title="本地硬词/结构规则命中">规则</span>
        <span v-else-if="f.source === '模型'" class="flag-src" title="模型看说法和节奏">模型</span>
      </div>
      <p class="tone-what">{{ f.what }}</p>
      <p v-if="f.quote" class="flag-quote">「{{ f.quote }}」</p>
      <p class="flag-fix">建议：{{ f.suggestion }}</p>
      <button type="button" class="link-btn ask-ai" data-askai="tone" title="带着这句，在对话里让 AI 按你的语气改"
        @click.stop="c.askAbout({ quote: f.quote, what: `像 AI 写的：${f.what}`, suggestion: f.suggestion, ver: ed.editVer })">让 AI 改</button>
    </div>
    <p v-if="m.model && (m.model.name || m.model.auto)" class="chat-by card-by">{{ m.model.name ? `${m.model.auto ? '自动 · ' : ''}${m.model.name}` : '自动选模型' }}</p>
  </div>
</template>

<script setup>
import Icon from './common/Icon.vue';
import { useChatStore } from '../stores/chat.js';
import { useEditorStore } from '../stores/editor.js';

defineProps({ m: { type: Object, required: true }, latest: { type: Boolean, default: false } });
const c = useChatStore();
const ed = useEditorStore();

function locate(quote) {
  if (window.getSelection?.().toString()) return;
  ed.locate(quote, { ver: ed.editVer });
}
</script>
