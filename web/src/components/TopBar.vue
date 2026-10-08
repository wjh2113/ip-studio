<template>
  <header class="topbar">
    <div class="brand"><span class="brand-mark" aria-hidden="true"></span><span>自媒体助手</span></div>
    <nav class="tabs-nav" id="viewNav">
      <button data-view="write" :class="{ active: s.view === 'write' }" @click="s.view = 'write'">创作</button>
      <button data-view="hot" :class="{ active: s.view === 'hot' }" @click="s.view = 'hot'">热点</button>
      <button data-view="speak" :class="{ active: s.view === 'speak' }" @click="s.view = 'speak'">口播</button>
      <button data-view="library" :class="{ active: s.view === 'library' }" @click="s.view = 'library'">素材库</button>
      <button data-view="frameworks" :class="{ active: s.view === 'frameworks' }" @click="s.view = 'frameworks'">框架库</button>
    </nav>
    <div class="topbar-right">
      <button class="top-btn jobs-btn" id="jobsBtn" type="button" :class="{ busy: jobs.activeCount > 0 }"
        title="出图、口播转写与评测这类要等的活，关掉页面也会接着做" @click="jobs.open()"><Icon name="bolt" />任务<span class="jobs-badge" :class="{ hidden: !jobs.activeCount }">{{ jobs.activeCount || '' }}</span></button>
      <button class="credit-chip" id="creditChip" :class="{ hidden: !quota, low }" :title="creditTitle" @click="plan.open()"><Icon name="crown" /><template v-if="quota">{{ quota.label }} · 剩 <b>{{ quota.left.toLocaleString() }}</b></template></button>
      <button type="button" class="user-chip" id="profileBtn" title="个人档案：你的工作经历、项目经历、数据成果和观点，所有账号共用" @click="learning.openProfile()"><span class="user-avatar" aria-hidden="true">{{ (s.user?.username || '·')[0].toUpperCase() }}</span><span class="user-name" id="userName">{{ s.user?.username }}</span><span class="user-sub">个人档案</span></button>
      <button v-if="s.user?.admin" class="top-link" id="inviteBtn" type="button" title="生成邀请码：发给对方，凭码注册自己的账号" @click="invites.open()"><Icon name="key" />邀请</button>
      <button class="top-link icon-only" id="syncBtn" type="button" title="同步到 Obsidian：把成稿定期写进知识库" aria-label="同步到 Obsidian" @click="sync.open()"><Icon name="refresh" /></button>
      <a class="top-link" href="/guide" target="_blank" rel="noopener" id="guideLink"
         title="新人操作手册：怎么上手、各功能怎么用"><Icon name="book" />使用说明</a>
      <a v-if="s.user?.admin" class="top-link" href="/prompts" target="_blank" rel="noopener" id="promptsLink"
         title="提示词说明书；要改内容需先登录管理后台"><Icon name="sparkles" />提示词</a>
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
import { useSyncStore } from '../stores/sync.js';
import { useLearningStore } from '../stores/learning.js';
import { useInvitesStore } from '../stores/invites.js';

const s = useStudioStore();
const plan = usePlanStore();
const jobs = useJobsStore();
const session = useSessionStore();
const sync = useSyncStore();
const learning = useLearningStore();
const invites = useInvitesStore();
const quota = computed(() => plan.quota);

// 低于 15% 变红——这时候提醒还来得及，撞到 402 才说就晚了
const low = computed(() => {
  const q = quota.value;
  return Boolean(q && (q.total ? q.left / q.total : 0) < 0.15);
});

const creditTitle = computed(() => (low.value ? '额度快用完了，点开看看' : '点开看用量与套餐'));
</script>
