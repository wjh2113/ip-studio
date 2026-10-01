<template>
  <div class="speak-review">
    <!-- 一遍口播的总评：分数、各维度、怎么提分、下一遍注意什么；语音 / 视频测评按需再做 -->
    <template v-if="speak.status === 'failed'">
      <div class="speak-fail">{{ speak.error || '评估失败' }}</div>
      <button class="btn ghost small" :data-speak-retry="speak.id" :disabled="sp.retrying.has(speak.id)" @click="sp.retry(speak.id)">{{ sp.retrying.has(speak.id) ? '评估中…' : '重新评估' }}</button>
    </template>
    <div v-else-if="speak.status !== 'ready' || !speak.review" class="hint">正在转写和总评…可以先去做别的，好了会提示</div>
    <template v-else>
      <div class="speak-score">{{ speak.review.score == null ? '—' : speak.review.score }}<em>分</em></div>
      <div class="speak-dims">
        <div v-for="d in speak.review.dims || []" :key="d.key" class="speak-dim"><b>{{ d.key }}</b><span>{{ d.score == null ? '—' : d.score }}</span>
          <em>{{ d.note || '' }}</em></div>
      </div>
      <ol v-if="speak.review.lifts?.length" class="speak-lifts">
        <li v-for="(l, i) in speak.review.lifts" :key="i"><b>{{ l.quote || '整遍' }}</b>　{{ l.do }}<span v-if="l.lose" class="hint"> −{{ l.lose }}</span></li>
      </ol>
      <p class="speak-next">{{ speak.review.next || '' }}</p>
      <div class="speak-extra">
        <button v-if="sp.isChecking(speak.id, 'voice')" type="button" class="btn ghost small" :data-speak-pron="speak.id" disabled>测评中…</button>
        <button v-else type="button" class="btn ghost small" :data-speak-pron="speak.id" @click.stop="sp.runCheck(speak.id, 'voice')">{{ speak.review.checks?.voice ? '重新语音测评' : '语音测评' }}</button>
        <button v-if="sp.isChecking(speak.id, 'video')" type="button" class="btn ghost small" :data-speak-look="speak.id" disabled>测评中…</button>
        <button v-else-if="audioOnly(speak)" type="button" class="btn ghost small" :data-speak-look="speak.id" disabled title="这一遍只有声音、没有画面，不做出镜评测">视频测评</button>
        <button v-else type="button" class="btn ghost small" :data-speak-look="speak.id" @click.stop="sp.runCheck(speak.id, 'video')">{{ speak.review.checks?.video ? '重新视频测评' : '视频测评' }}</button>
      </div>
      <!-- 视频用 video，纯音频用 audio；两者都带 controls，方便在口播页直接回看 -->
      <video v-if="speak.audio && !audioOnly(speak)" class="speak-media" controls preload="metadata" :src="speak.audio"></video>
      <audio v-else-if="speak.audio" class="speak-media" controls preload="none" :src="speak.audio"></audio>
    </template>
  </div>
</template>

<script setup>
import { audioOnly, useSpeakStore } from '../stores/speak.js';

defineProps({ speak: { type: Object, required: true } });
const sp = useSpeakStore();
</script>
