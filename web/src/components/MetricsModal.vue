<template>
  <Modal id="metricsModal" v-model:open="m.metricsOpen" title="回填发布数据" sub="发完填一下，复盘才知道什么有效"
    close-id="metricsClose" :mask-close="false">
    <div class="grid">
      <label>发布日期<input type="date" id="metricsDate" v-model="m.form.published"></label>
      <label>这次记录的日期<input type="date" id="metricsOn" v-model="m.form.on" @change="m.fill()"></label>
      <label v-if="multi" class="full" id="metricsPlatformRow">哪个平台的数
        <select id="metricsPlatform" v-model="m.form.platform" @change="m.fill()">
          <option v-for="x in m.platforms" :key="x" :value="x">{{ s.platformLabel(x) }}</option>
        </select>
      </label>
    </div>
    <div class="grid" id="metricsFields">
      <label v-for="f in m.fields" :key="f.key">{{ f.label }}
        <input type="number" min="0" :data-metric="f.key" v-model="m.form.values[f.key]"
          :placeholder="m.lastBefore?.[f.key] != null ? `上次 ${m.lastBefore[f.key]}` : '留空不记'">
      </label>
    </div>
    <label class="full">备注<textarea id="metricsNote" rows="2" maxlength="300" v-model="m.form.note"
      placeholder="选填。例：这条被大号转了；标题改过一版；发的时间比平时晚"></textarea></label>
    <p class="hint">可以隔几天再填一次，每次存一份，复盘时能看走势、按「发布后第 7 天」同口径比。同一天再填会覆盖当天那份；全部清空并保存 = 删掉当天那份。</p>
    <div class="metrics-history" id="metricsHistory">
      <template v-if="m.history.length">
        <h4>历次回填</h4>
        <div v-for="h in m.history" :key="h.id" class="metrics-snap" :class="{ on: isCurrent(h) }">
          <span class="mono">{{ h.capturedOn }}</span>
          <span v-if="dayNo(h) != null">第 {{ dayNo(h) }} 天</span>
          <span v-if="multi">{{ s.platformLabel(h.platform) }}</span>
          <span class="grow" :title="h.note || ''">{{ nums(h) || h.note || '' }}</span>
          <button type="button" class="mini del" :data-metric-del="h.id" title="删掉这次" :disabled="deleting === h.id"
            @click="del(h.id)">删除</button>
        </div>
      </template>
    </div>
    <div class="modal-foot">
      <a class="btn ghost" href="#" id="insightsLink" @click.prevent="m.openInsights()">看复盘 →</a>
      <span class="grow"></span>
      <BusyBtn class="btn primary" id="metricsSave" :busy="m.saving" @click="m.saveMetrics()">保存</BusyBtn>
    </div>
  </Modal>
</template>

<script setup>
import { computed, ref } from 'vue';
import Modal from './common/Modal.vue';
import BusyBtn from './common/BusyBtn.vue';
import { useInsightsStore } from '../stores/insights.js';
import { useStudioStore } from '../stores/studio.js';
import { toast } from '../lib/feedback.js';

const m = useInsightsStore();
const s = useStudioStore();
const deleting = ref(null);

const multi = computed(() => m.platforms.length > 1);

const dayNo = (h) => {
  if (!m.form.published || !h.capturedOn) return null;
  return Math.round((Date.parse(h.capturedOn) - Date.parse(m.form.published)) / 86400000);
};

const nums = (h) => m.fields.filter((f) => h[f.key] != null).map((f) => `${f.label} ${h[f.key]}`).join(' · ');

const isCurrent = (h) => h.capturedOn === m.form.on && (h.platform || s.draft?.platform) === (m.form.platform || s.draft?.platform);

async function del(id) {
  deleting.value = id;
  try { await m.deleteSnap(id); } catch (err) { toast(err.message); } finally { deleting.value = null; }
}
</script>
