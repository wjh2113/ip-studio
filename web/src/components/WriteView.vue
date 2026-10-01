<template>
    <div id="writeView" :class="{ hidden: s.view !== 'write' }">
      <!-- 步骤条同时是导航：走过的步骤可以点回去 -->
      <ol class="steps" id="steps">
        <li v-for="x in STEPS" :key="x.n" class="step" :class="stepClass(x.n)" :data-step="x.n" @click="b.clickStep(x.n)"><b>{{ x.n }}</b> {{ x.label }}</li>
      </ol>

      <!-- 引导：还没有账号设定 -->
      <section v-if="onboarding" class="card onboard" id="onboardCard">
        <h2>先给这个号定个位</h2>
        <p>设定账号的平台、内容方向、目标用户和要解决的问题之后，每次创作都会自动带上这份语境——
          选题不会跑偏，语气也不会每篇都换一个人。</p>
        <div class="actions">
          <button class="btn primary" id="quickBtn" type="button" @click="account.quick.open = true">贴一段自我介绍，帮我填</button>
          <button class="btn ghost" id="onboardBtn" @click="account.open(null)">自己一项项填</button>
          <button class="btn ghost" id="skipOnboardBtn" @click="skipOnboard">先不设定，直接创作</button>
        </div>
      </section>

      <BriefCard v-show="s.step === 1 && !onboarding" />
      <TopicsCard v-show="s.step === 2" />

      <ContentCard v-show="s.step === 3" />
    </div>
</template>

<script setup>
import { computed } from 'vue';
import BriefCard from './BriefCard.vue';
import TopicsCard from './TopicsCard.vue';
import ContentCard from './ContentCard.vue';
import { useStudioStore } from '../stores/studio.js';
import { useBriefStore } from '../stores/brief.js';
import { useAccountStore } from '../stores/account.js';

const s = useStudioStore();
const b = useBriefStore();
const account = useAccountStore();

const STEPS = [{ n: 1, label: '确定选题' }, { n: 2, label: '选择话题方向' }, { n: 3, label: '创作内容' }];

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
