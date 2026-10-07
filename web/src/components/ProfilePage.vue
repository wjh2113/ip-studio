<template>
<div class="account-page" id="profilePage" :class="{ hidden: !L.profileOpen }">
  <div class="acc-form">
    <header class="acc-head">
      <div class="brand"><span class="brand-mark" aria-hidden="true"></span><span>自媒体助手</span></div>
      <button class="acc-back" type="button" id="profileCloseBtn" title="返回" @click="L.closeProfile()"><Icon name="arrow-left" :size="15" />返回</button>
      <h2>个人档案 · {{ s.user?.username }}</h2>
      <span class="grow"></span>
    </header>
    <div class="acc-body">
      <nav class="acc-nav">
        <p class="acc-nav-note pp-note">
          <Icon name="info" :size="14" />
          <span>这里放<b>你本人</b>的东西：工作经历、项目经历、数据成果、一贯观点。<br />所有账号共用；写稿时按题材挑相关的几条，档案里没有的经历 AI 不会替你编。</span>
        </p>
        <p class="acc-nav-note pp-note">
          <Icon name="layers" :size="14" />
          <span>文章、链接、图片、对标账号这些<b>外部资料</b>放在顶部的「素材库」，不放这里。</span>
        </p>
      </nav>
      <div class="acc-main">
        <ProfilePanel v-if="seen" />
      </div>
    </div>
  </div>
</div>
</template>

<script setup>
/* 个人档案：右上角头像打开，整屏盖在应用上（和账号设定同一种版式）。数据和动作在 stores/learning.js */
import { ref, watch } from 'vue';
import Icon from './common/Icon.vue';
import ProfilePanel from './ProfilePanel.vue';
import { useLearningStore } from '../stores/learning.js';
import { useStudioStore } from '../stores/studio.js';
import { escStack } from '../lib/escape.js';

const L = useLearningStore();
const s = useStudioStore();
const seen = ref(false);          // 第一次打开才挂载（会去拉档案）

const esc = escStack(() => L.profileOpen, () => L.closeProfile());
watch(() => L.profileOpen, (open) => {
  if (open) seen.value = true;
  esc.toggle(open);
  document.body.classList.toggle('no-scroll', open);
}, { immediate: true });
</script>
