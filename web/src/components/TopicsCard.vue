<template>
  <section class="card topics-card" id="topicsCard">
    <!-- 第二步：三个话题方向并排成三张卡，从上到下是「是什么 → 差在哪 → 怎么写 → 用它」，横着一眼能比 -->
    <div class="card-head">
      <button class="btn ghost small step-back" data-goto="1" @click="back"><Icon name="arrow-left" :size="14" />改题材</button>
      <div class="topics-title">
        <h2>三个话题方向</h2>
        <span class="topics-fw" id="topicsFw">{{ d?.framework ? `写法：${d.framework.name}` : '' }}</span>
      </div>
      <span class="grow"></span>
      <BusyBtn class="btn soft" id="retopicsBtn" :busy="b.retopicking" :disabled="s.streaming" @click="b.retopics()"><Icon name="refresh" :size="15" />换一批</BusyBtn>
    </div>
    <div class="topics" id="topics">
      <div v-for="(t, i) in d?.topics || []" :key="i" class="topic" :class="[{ chosen: d.chosen === i }, `t${i}`]">
        <Icon v-if="d.chosen === i" class="topic-check" name="check" :size="13" />
        <div class="topic-top">
          <span class="topic-no">{{ i + 1 }}</span>
          <span class="topic-tag">{{ t.label || `方向 ${i + 1}` }}</span>
        </div>
        <h3>{{ t.title }}</h3>
        <p class="hook">{{ t.hook }}</p>
        <div class="topic-sec">
          <b><Icon name="bulb" :size="14" />差异</b>
          <p class="angle">{{ t.angle }}</p>
        </div>
        <div class="topic-sec topic-outline">
          <b><Icon name="list" :size="14" />结构</b>
          <ul><li v-for="(o, k) in t.outline" :key="k">{{ o }}</li></ul>
        </div>
        <p v-if="t.audience_fit" class="fit">适合：{{ t.audience_fit }}</p>
        <button class="btn block" :class="d.chosen === i ? 'primary' : 'ghost'" :data-index="i" :disabled="s.streaming"
          @click="generate(i)"><Icon name="pen" :size="15" />{{ d.chosen === i ? '重新生成这篇' : '用这个方向写' }}</button>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue';
import BusyBtn from './common/BusyBtn.vue';
import Icon from './common/Icon.vue';
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
