/* 长任务：出图、口播转写与总评、语音 / 视频测评都在服务端的任务队列里跑。
 *
 * 前端发起时带 async: true，立刻拿到一个任务，之后轮询 /api/jobs 看它做完没有。
 * 页面刷新了也不怕：进应用时拉一次列表，还在跑的接着盯；做完了弹提示、发 job-done 通知，
 * 各功能自己决定要不要刷新。
 *
 *   const { job } = await jobs.start('/drafts/1/illus/0/image', { version: '' });
 *   const result = await jobs.wait(job);        // 失败会抛错，错误文案就是任务的 error */
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api } from '../lib/api.js';
import { emit, on } from '../lib/bus.js';
import { toast } from '../lib/feedback.js';

export const ACTIVE = new Set(['queued', 'running']);

export const JOB_STATUS = { queued: '排队中', running: '进行中', done: '完成', failed: '失败', cancelled: '已取消' };

export const useJobsStore = defineStore('jobs', () => {
  const list = ref([]);            // 最近的任务（服务端给的顺序：新的在前）
  const show = ref(false);
  const waiting = new Map();       // 任务号 → [{ resolve, reject }]
  let timer = null;

  const activeCount = computed(() => list.value.filter((j) => ACTIVE.has(j.status)).length);

  /* 这件事（某张图、某遍口播的某种评测）现在有没有在做 */
  const active = (kind, match = () => true) =>
    list.value.find((j) => j.kind === kind && ACTIVE.has(j.status) && match(j.payload || {})) || null;

  function jobError(job) {
    const err = new Error(job.status === 'cancelled' ? '任务已取消' : (job.error || '任务失败'));
    err.code = job.code;
    if (job.code === 402) emit('quota', { message: job.error });
    return err;
  }

  function track(job) {
    const i = list.value.findIndex((j) => j.id === job.id);
    if (i >= 0) list.value.splice(i, 1, job);
    else list.value.unshift(job);
    schedule(1200);
  }

  async function start(path, body = {}) {
    const data = await api(path, { method: 'POST', body: { ...body, async: true } });
    if (data.job) track(data.job);
    return data;
  }

  function wait(job) {
    if (!ACTIVE.has(job.status)) return job.status === 'done' ? Promise.resolve(job.result) : Promise.reject(jobError(job));
    return new Promise((resolve, reject) => {
      waiting.set(job.id, [...(waiting.get(job.id) || []), { resolve, reject }]);
      track(job);
    });
  }

  function schedule(delay = 1500) {
    if (timer) return;
    timer = setTimeout(poll, delay);
  }

  async function poll() {
    clearTimeout(timer);
    timer = null;
    let data;
    try {
      data = await api('/jobs');
    } catch {
      // 未登录或网络抖了：有要盯的就过一会儿再试
      if (waiting.size || activeCount.value) schedule(5000);
      return;
    }
    const before = new Map(list.value.map((j) => [j.id, j]));
    list.value = data.jobs || [];
    for (const j of list.value) {
      const prev = before.get(j.id);
      if ((prev && ACTIVE.has(prev.status) && !ACTIVE.has(j.status)) || (waiting.has(j.id) && !ACTIVE.has(j.status))) finished(j);
    }
    if (data.active || waiting.size) schedule();
  }

  function finished(job) {
    const ws = waiting.get(job.id) || [];
    waiting.delete(job.id);
    for (const w of ws) {
      if (job.status === 'done') w.resolve(job.result);
      else w.reject(jobError(job));
    }
    emit('job-done', job);
    emit('spent');
    // 发起的地方在等的，由它自己提示；没人等的（刷新前发起的、切走了的）在这里提示
    if (!ws.length) toast(job.status === 'done' ? `${job.label}：好了` : `${job.label}：${job.error || '没做成'}`);
  }

  function open() {
    show.value = true;
    poll();
  }

  async function cancel(id) {
    const { job } = await api(`/jobs/${id}/cancel`, { method: 'POST', body: {} });
    track(job);
  }

  async function retry(id) {
    const { job } = await api(`/jobs/${id}/retry`, { method: 'POST', body: {} });
    track(job);
    poll();
  }

  // 进应用时拉一次：接上刷新前还在跑的任务
  on('enter', () => poll());

  return { list, show, activeCount, active, start, wait, track, poll, open, cancel, retry };
});
