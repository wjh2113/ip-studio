<template>
  <header class="topbar">
    <div class="brand"><span class="brand-mark" aria-hidden="true"></span><span>自媒体助手</span></div>
    <nav class="tabs-nav" id="viewNav">
      <button data-view="write" :class="{ active: s.view === 'write' }" @click="s.view = 'write'">创作</button>
      <button data-view="hot" :class="{ active: s.view === 'hot' }" @click="s.view = 'hot'">热点</button>
    </nav>
    <div class="topbar-right">
      <span class="chip llm-chip" :class="{ warn: s.llm && !s.llm.live }" :title="llmTitle"><i class="dot" aria-hidden="true"></i>{{ llmText }}</span>
      <button class="top-btn jobs-btn" id="jobsBtn" type="button" :class="{ busy: jobs.activeCount > 0 }"
        title="出图、口播转写与评测这类要等的活，关掉页面也会接着做" @click="jobs.open()"><Icon name="bolt" />任务<span class="jobs-badge" :class="{ hidden: !jobs.activeCount }">{{ jobs.activeCount || '' }}</span></button>
      <button class="credit-chip" id="creditChip" :class="{ hidden: !quota, low }" :title="creditTitle" @click="plan.open()"><Icon name="crown" /><template v-if="quota">{{ quota.label }} · 剩 <b>{{ quota.left.toLocaleString() }}</b></template></button>
      <span class="user-chip"><span class="user-avatar" aria-hidden="true">{{ (s.user?.username || '·')[0].toUpperCase() }}</span><span class="user-name" id="userName">{{ s.user?.username }}</span></span>
      <a class="top-link" href="/prompts" target="_blank" rel="noopener"
         title="每条提示词的产品定位、价值与功能逻辑"><Icon name="book" />说明书</a>
      <button class="top-link" id="logoutBtn" @click="session.logout()"><Icon name="logout" />退出</button>
    </div>
  </header>
</template>

<script setup>
import { computed } from 'vue';
import Icon from './common/Icon.vue';
import { useStudioStore } from '../stores/studio.js';
import { usePlanStore } from '../stores/plan.js';
import { useJobsStore } from '../stores/jobs.js';
import { useSessionStore } from '../stores/session.js';

const s = useStudioStore();
const plan = usePlanStore();
const jobs = useJobsStore();
const session = useSessionStore();
const quota = computed(() => plan.quota);

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
  const q = quota.value;
  return Boolean(q && (q.total ? q.left / q.total : 0) < 0.15);
});

const creditTitle = computed(() => (low.value ? '额度快用完了，点开看看' : '点开看用量与套餐'));
</script>
