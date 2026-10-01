<template>
  <!-- 写法框架：默认不套；推荐三个，点一下就用。框架管结构，素材管事实 -->
  <div class="sections-pick" id="fwPick">
    <span class="sections-label">写法框架</span>
    <div class="section-chips" id="fwChips">
      <button type="button" class="section-chip" :class="{ on: !s.frameworkKey }" data-fw="" @click="fw.choose(null)">不套框架</button>
      <button v-for="f in fw.pickList" :key="f.key" type="button" class="section-chip" :class="{ on: s.frameworkKey === f.key }"
        :data-fw="f.key" :title="perfTip(f) || f.summary || ''" @click="fw.choose(f)">{{ f.name }}<span v-if="!f.builtin" class="n">我的</span><span
          v-if="f.perf?.lift >= 1.2" class="n up">数据好</span></button>
    </div>
    <button type="button" class="btn ghost small" id="fwLibBtn" @click="fw.libOpen = true">框架库</button>
  </div>
</template>

<script setup>
import { useFrameworksStore } from '../stores/frameworks.js';
import { useStudioStore } from '../stores/studio.js';

const fw = useFrameworksStore();
const s = useStudioStore();

/* 推荐理由：这个号用这个框架的稿子，阅读中位数比整体高多少 */
const perfTip = (f) => (f.perf
  ? `你用它写的 ${f.perf.n} 篇，阅读中位数 ${f.perf.median}，整体是 ${f.perf.overall}${f.summary ? `\n${f.summary}` : ''}`
  : '');
</script>
