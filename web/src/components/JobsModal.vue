<template>
  <Modal id="jobsModal" v-model:open="jobs.show" title="任务" sub="出图和口播评测在后台做，关掉页面也不会丢" close-id="jobsClose">
    <div class="job-list" id="jobsList">
      <p v-if="!jobs.list.length" class="hint">还没有任务。出图、上传口播、语音测评和视频测评会出现在这里，关掉页面也会接着做。</p>
      <div v-for="j in jobs.list" :key="j.id" class="job-row" :data-job="j.id">
        <span class="job-dot" :class="j.status" aria-hidden="true"></span>
        <div class="job-main">
          <b>{{ j.label }}</b>
          <div class="hint">
            <span class="job-st" :class="j.status">{{ JOB_STATUS[j.status] || j.status }}</span>
            · {{ clock(j.createdAt) }}<template v-if="took(j)"> · 用时 {{ took(j) }}</template>
            <span v-if="j.status === 'failed' && j.error" class="form-error"> · {{ j.error }}</span>
          </div>
        </div>
        <button v-if="j.status === 'queued'" type="button" class="btn ghost small" :data-job-cancel="j.id"
          :disabled="pending === j.id" @click="act(j, 'cancel')">取消</button>
        <button v-if="['failed', 'cancelled'].includes(j.status)" type="button" class="btn ghost small" :data-job-retry="j.id"
          :disabled="pending === j.id" @click="act(j, 'retry')">重试</button>
        <button v-if="target(j) && j.status !== 'cancelled'" type="button" class="btn ghost small" :data-job-open="j.id"
          :disabled="pending === j.id" @click="act(j, 'open')">去看看</button>
      </div>
    </div>
  </Modal>
</template>

<script setup>
import { ref } from 'vue';
import Modal from './common/Modal.vue';
import { JOB_STATUS, useJobsStore } from '../stores/jobs.js';
import { useStudioStore } from '../stores/studio.js';
import { api } from '../lib/api.js';
import { toast } from '../lib/feedback.js';
import { clock } from '../lib/text.js';
import { useBriefStore } from '../stores/brief.js';
import { useSpeakStore } from '../stores/speak.js';

const jobs = useJobsStore();
const s = useStudioStore();
const pending = ref(null);

const SPEAK_KINDS = new Set(['speak', 'pronounce', 'appearance']);

const target = (j) => j.payload?.draftId || j.payload?.speakId;

const took = (j) => {
  if (!j.startedAt || !j.finishedAt) return '';
  const sec = Math.round((new Date(j.finishedAt) - new Date(j.startedAt)) / 1000);
  return sec >= 60 ? `${Math.floor(sec / 60)} 分 ${sec % 60} 秒` : `${sec} 秒`;
};

async function act(j, what) {
  pending.value = j.id;
  try {
    if (what === 'cancel') await jobs.cancel(j.id);
    else if (what === 'retry') await jobs.retry(j.id);
    else {
      jobs.show = false;
      if (SPEAK_KINDS.has(j.kind)) await useSpeakStore().openRecord(j.payload.speakId);
      else if (j.payload?.draftId) {
        if (s.draft?.id !== j.payload.draftId) {
          const { draft } = await api(`/drafts/${j.payload.draftId}`);
          useBriefStore().setDraft(draft);
        }
        if (j.kind === 'image') toast('配图在正文上方的「配图」里');
      }
    }
  } catch (err) {
    toast(err.message);
  } finally {
    pending.value = null;
  }
}
</script>
