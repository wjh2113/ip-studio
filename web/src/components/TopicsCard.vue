<template>
  <section class="card" id="topicsCard">
    <!-- 第二步：三个话题方向。一个方向一横条：左边是「这是什么」，右边是「怎么写」。
       原来三个窄长条并排，每条 900 多像素高，读起来要上下扫三趟，也没法横向比较 -->
    <div class="card-head">
      <button class="btn ghost small step-back" data-goto="1" @click="back">← 改题材</button>
      <h2>三个话题方向<span class="modal-sub" id="topicsFw">{{ d?.framework ? `写法：${d.framework.name}` : '' }}</span></h2>
      <BusyBtn class="btn ghost small" id="retopicsBtn" :busy="b.retopicking" :disabled="s.streaming" @click="b.retopics()">换一批</BusyBtn>
    </div>
    <div class="topics" id="topics">
      <div v-for="(t, i) in d?.topics || []" :key="i" class="topic" :class="{ chosen: d.chosen === i }">
        <div class="topic-main">
          <span class="topic-tag"><b>{{ i + 1 }}</b>{{ t.label || `方向 ${i + 1}` }}</span>
          <h3>{{ t.title }}</h3>
          <p class="angle"><b>差异</b>{{ t.angle }}</p>
          <p class="hook">{{ t.hook }}</p>
          <p v-if="t.audience_fit" class="fit">适合：{{ t.audience_fit }}</p>
          <button class="btn small" :class="d.chosen === i ? 'ghost' : 'primary'" :data-index="i" :disabled="s.streaming"
            @click="generate(i)">{{ d.chosen === i ? '重新生成这篇' : '用这个方向写' }}</button>
        </div>
        <div class="topic-outline">
          <b>结构</b>
          <ul><li v-for="(o, k) in t.outline" :key="k">{{ o }}</li></ul>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue';
import BusyBtn from './common/BusyBtn.vue';
import { useStudioStore } from '../stores/studio.js';
import { useBriefStore } from '../stores/brief.js';
import { useEditorStore } from '../stores/editor.js';

const s = useStudioStore();
const b = useBriefStore();
const d = computed(() => s.draft);

function back() {
  if (!s.streaming) b.goStep(1);
}

/* 选方向 → 第三步流式成稿 */
function generate(i) {
  useEditorStore().generate(i);
}
</script>
