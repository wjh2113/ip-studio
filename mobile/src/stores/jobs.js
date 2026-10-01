/* 后台任务（出图、口播转写与评测）。有在跑的就每 5 秒问一次，跑完发通知；没有就不轮询 */
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api } from '../lib/api.js';

const ACTIVE = new Set(['queued', 'running']);

export const useJobsStore = defineStore('jobs', () => {
  const list = ref([]);
  const loaded = ref(false);
  let timer = 0;

  const active = computed(() => list.value.filter((j) => ACTIVE.has(j.status)));
  const failed = computed(() => list.value.filter((j) => j.status === 'failed'));
  const done = computed(() => list.value.filter((j) => j.status === 'done'));

  async function load() {
    const before = new Map(list.value.map((j) => [j.id, j.status]));
    try {
      const { jobs } = await api('/jobs');
      list.value = jobs || [];
      loaded.value = true;
    } catch { return; }
    for (const j of list.value) {
      const was = before.get(j.id);
      if (was && ACTIVE.has(was) && !ACTIVE.has(j.status)) uni.$emit('job-done', j);
    }
    schedule();
  }

  function schedule() {
    clearTimeout(timer);
    if (active.value.length) timer = setTimeout(load, 5000);
  }

  async function cancel(id) { await api(`/jobs/${id}/cancel`, { method: 'POST', body: {} }); await load(); }
  async function retry(id) { await api(`/jobs/${id}/retry`, { method: 'POST', body: {} }); await load(); }

  function stop() { clearTimeout(timer); }

  return { list, loaded, active, failed, done, load, cancel, retry, stop };
});
