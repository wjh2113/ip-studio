<template>
  <div class="field" id="fwPick">
    <!-- 写法框架：默认不套；推荐三个，点一下就用。框架管结构，素材管事实 -->
    <span class="field-label">写法框架<em>选一个合适的结构，帮你更好地组织内容</em></span>
    <div class="fw-picks" id="fwChips">
      <button v-for="f in fw.pickList" :key="f.key" type="button" class="fw-pick" :class="{ on: s.frameworkKey === f.key }"
        :data-fw="f.key" :title="perfTip(f) || ''" @click="fw.choose(f)">
        <span class="fw-pick-name">{{ f.name }}<span v-if="!f.builtin" class="n">我的</span><span v-if="f.perf?.lift >= 1.2" class="n up">数据好</span></span>
        <span class="fw-pick-sum">{{ f.summary || '按这个结构分段' }}</span>
        <Icon v-if="s.frameworkKey === f.key" class="fw-pick-check" name="check" :size="12" />
      </button>
    </div>
    <div class="fw-pick-acts">
      <button type="button" class="btn ghost small" id="fwLibBtn" @click="s.view = 'frameworks'"><Icon name="book" :size="14" />打开框架库</button>
      <button type="button" class="btn ghost small fw-none" :class="{ on: !s.frameworkKey }" data-fw="" @click="fw.choose(null)">不套框架</button>
    </div>
  </div>
</template>

<script setup>
import Icon from './common/Icon.vue';
import { useFrameworksStore } from '../stores/frameworks.js';
import { useStudioStore } from '../stores/studio.js';

const fw = useFrameworksStore();
const s = useStudioStore();

/* 推荐理由：这个号用这个框架的稿子，阅读中位数比整体高多少 */
const perfTip = (f) => (f.perf
  ? `你用它写的 ${f.perf.n} 篇，阅读中位数 ${f.perf.median}，整体是 ${f.perf.overall}${f.summary ? `\n${f.summary}` : ''}`
  : '');
</script>
