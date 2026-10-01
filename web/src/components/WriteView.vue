<template>
    <div id="writeView" :class="{ hidden: s.view !== 'write' }">
      <!-- 步骤条同时是导航：走过的步骤可以点回去 -->
      <ol class="steps" id="steps">
        <template v-for="(x, i) in STEPS" :key="x.n">
          <li v-if="i" class="step-arrow" aria-hidden="true"><Icon name="arrow-right" :size="18" /></li>
          <li class="step" :class="stepClass(x.n)" :data-step="x.n" @click="b.clickStep(x.n)">
            <b><Icon v-if="stepClass(x.n).done && x.n !== s.step" name="check" :size="16" /><template v-else>{{ x.n }}</template></b>
            <span class="step-txt"><span class="step-label">{{ x.label }}</span><span class="step-desc">{{ x.desc }}</span></span>
          </li>
        </template>
      </ol>

      <!-- 引导：还没有账号设定 -->
      <section v-if="onboarding" class="card onboard" id="onboardCard">
        <div class="onboard-art" aria-hidden="true"><Icon name="user" :size="30" /></div>
        <div class="onboard-text">
          <h2>先给这个号定个位</h2>
          <p>设定账号的平台、内容方向、目标用户和要解决的问题之后，每次创作都会自动带上这份语境——
            选题不会跑偏，语气也不会每篇都换一个人。</p>
        </div>
        <div class="onboard-acts">
          <button class="onboard-opt primary" id="quickBtn" type="button" @click="account.quick.open = true"><b>贴一段自我介绍帮我填</b><span>自动识别并填好设定</span></button>
          <button class="onboard-opt" id="onboardBtn" @click="account.open(null)"><b>自己一项项填</b><span>手动设置账号信息</span></button>
          <button class="onboard-opt" id="skipOnboardBtn" @click="skipOnboard"><b>先不设定直接创作</b><span>跳过设置，直接开始</span></button>
        </div>
      </section>

      <BriefCard v-show="s.step === 1 && !onboarding" />
      <TopicsCard v-show="s.step === 2" />

      <ContentCard v-show="s.step === 3" />
    </div>
</template>

<script setup>
import { computed } from 'vue';
import Icon from './common/Icon.vue';
import BriefCard from './BriefCard.vue';
import TopicsCard from './TopicsCard.vue';
import ContentCard from './ContentCard.vue';
import { useStudioStore } from '../stores/studio.js';
import { useBriefStore } from '../stores/brief.js';
import { useAccountStore } from '../stores/account.js';

const s = useStudioStore();
const b = useBriefStore();
const account = useAccountStore();

const STEPS = [
  { n: 1, label: '确定选题', desc: '明确题材与创作方向' },
  { n: 2, label: '选择话题方向', desc: '从三个方向里挑最合适的' },
  { n: 3, label: '创作内容', desc: '成稿、配图与口播' },
];

const onboarding = computed(() => Boolean(s.user) && !s.personas.length && !s.skipOnboard);

/* 当前步高亮；之前的步骤、以及「这一步已完成」时的当前步打勾；能跳过去的可以点 */
function stepClass(n) {
  return {
    active: n === s.step,
    done: n < s.step || (b.stepDone && n === s.step),
    reachable: n !== s.step && b.reachable(n),
  };
}

function skipOnboard() {
  s.skipOnboard = true;
  b.focusSubject += 1;
}
</script>
