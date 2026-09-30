<template>
  <header class="topbar">
    <div class="brand"><span class="brand-mark" aria-hidden="true"></span><span>自媒体助手</span></div>
    <nav class="tabs-nav" id="viewNav">
      <button data-view="write" class="active">创作</button>
      <button data-view="hot">热点</button>
    </nav>
    <div class="topbar-right">
      <!-- 模型标识和余额由 Vue 渲染：数据在 store 的 llm / quota，功能模块只改数据 -->
      <span class="chip" :class="{ warn: s.llm && !s.llm.live }" :title="llmTitle">{{ llmText }}</span>
      <button class="btn ghost small jobs-btn" id="jobsBtn" type="button" title="出图、口播转写与评测这类要等的活，关掉页面也会接着做">任务<span class="jobs-badge hidden" id="jobsBadge"></span></button>
      <!-- id 留着：plan.js 在这个按钮上挂了点击打开用量面板。按钮本身不会被 Vue 换掉，只换里面的字 -->
      <button class="credit-chip" id="creditChip" :class="{ hidden: !s.quota, low }" :title="creditTitle"><template v-if="s.quota">{{ s.quota.label }} · 剩 <b>{{ s.quota.left.toLocaleString() }}</b></template></button>
      <span class="user-name" id="userName"></span>
      <a class="btn ghost small" href="/prompts" target="_blank" rel="noopener"
         title="每条提示词的产品定位、价值与功能逻辑">说明书</a>
      <button class="btn ghost small" id="logoutBtn">退出</button>
    </div>
  </header>
</template>

<script setup>
import { computed } from 'vue';
import { useStudioStore } from '../stores/studio.js';

const s = useStudioStore();

const llmText = computed(() => {
  const l = s.llm;
  if (!l) return '…';
  return l.live ? `${l.label} · ${l.model}` : l.label;
});

const llmTitle = computed(() => {
  const l = s.llm;
  if (!l) return '当前模型通道';
  return l.live
    ? `当前模型通道：${l.provider} / ${l.model}`
    : '未检测到模型密钥，当前为演示模式：流程完整，内容是本地模板。在 .env 中配置密钥后自动切换。';
});

// 低于 15% 变红——这时候提醒还来得及，撞到 402 才说就晚了
const low = computed(() => {
  const q = s.quota;
  return Boolean(q && (q.total ? q.left / q.total : 0) < 0.15);
});

const creditTitle = computed(() => (low.value ? '额度快用完了，点开看看' : '点开看用量与套餐'));
</script>
