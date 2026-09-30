/* 前端 · jobs：长任务的进度和任务中心。
 *
 * 出图、口播转写与总评、语音/视频测评都在服务端的任务队列里跑。前端发起时带 async: true，
 * 立刻拿到一个任务，之后轮询 /api/jobs 看它做完没有。页面刷新了也不怕：启动时拉一次列表，
 * 还在跑的接着盯，做完了弹提示、广播 cw-job-done，各功能模块自己决定要不要刷新。
 *
 *   const { job } = await startJob('/drafts/1/illus/0/image', { version: '' });
 *   const result = await waitJob(job);        // 失败会抛错，错误文案就是任务的 error
 */
import { api, esc, state, toast } from './core.js';
import { setDraft } from './brief.js';
import { openSpeakRecord } from './speak.js';

const $ = (id) => document.getElementById(id);
const ui = { btn: $('jobsBtn'), modal: $('jobsModal'), close: $('jobsClose'), list: $('jobsList') };

const ACTIVE = new Set(['queued', 'running']);
const STATUS = { queued: '排队中', running: '进行中', done: '完成', failed: '失败', cancelled: '已取消' };
const SPEAK_KINDS = new Set(['speak', 'pronounce', 'appearance']);

const known = new Map();       // 任务号 → 最近一次看到的任务
const waiting = new Map();     // 任务号 → [{ resolve, reject }]
let list = [];
let timer = null;

export async function startJob(path, body = {}) {
  const data = await api(path, { method: 'POST', body: { ...body, async: true } });
  if (data.job) trackJob(data.job);
  return data;
}

export function waitJob(job) {
  if (!ACTIVE.has(job.status)) return job.status === 'done' ? Promise.resolve(job.result) : Promise.reject(jobError(job));
  return new Promise((resolve, reject) => {
    waiting.set(job.id, [...(waiting.get(job.id) || []), { resolve, reject }]);
    trackJob(job);
  });
}

/* 这件事（某张图、某遍口播的某种评测）现在有没有在做 */
export const activeJob = (kind, match = () => true) =>
  [...known.values()].find((j) => j.kind === kind && ACTIVE.has(j.status) && match(j.payload || {})) || null;

function jobError(job) {
  const err = new Error(job.status === 'cancelled' ? '任务已取消' : (job.error || '任务失败'));
  err.code = job.code;
  if (job.code === 402) window.dispatchEvent(new CustomEvent('cw-quota', { detail: { message: job.error } }));
  return err;
}

export function trackJob(job) {
  known.set(job.id, job);
  if (!list.some((j) => j.id === job.id)) list = [job, ...list];
  render();
  schedule(1200);
}

function schedule(delay = 1500) {
  if (timer) return;
  timer = setTimeout(poll, delay);
}

async function poll() {
  timer = null;
  let data;
  try {
    data = await api('/jobs');
  } catch {
    // 未登录或网络抖了：有要盯的就过一会儿再试
    if (waiting.size || [...known.values()].some((j) => ACTIVE.has(j.status))) schedule(5000);
    return;
  }
  list = data.jobs || [];
  for (const j of list) {
    const before = known.get(j.id);
    known.set(j.id, j);
    if (before && ACTIVE.has(before.status) && !ACTIVE.has(j.status)) finished(j);
  }
  render();
  if (data.active || waiting.size) schedule();
}

function finished(job) {
  const ws = waiting.get(job.id) || [];
  waiting.delete(job.id);
  for (const w of ws) {
    if (job.status === 'done') w.resolve(job.result);
    else w.reject(jobError(job));
  }
  window.dispatchEvent(new CustomEvent('cw-job-done', { detail: job }));
  window.dispatchEvent(new Event('cw-spent'));
  // 发起的地方在等的，由它自己提示；没人等的（刷新前发起的、切走了的）在这里提示
  if (!ws.length) toast(job.status === 'done' ? `${job.label}：好了` : `${job.label}：${job.error || '没做成'}`);
}

const stamp = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const took = (j) => {
  if (!j.startedAt || !j.finishedAt) return '';
  const s = Math.round((new Date(j.finishedAt) - new Date(j.startedAt)) / 1000);
  return s >= 60 ? `${Math.floor(s / 60)} 分 ${s % 60} 秒` : `${s} 秒`;
};

function render() {
  const active = list.filter((j) => ACTIVE.has(j.status)).length;
  // 角标由 Vue 渲染（TopBar.vue 读 state.jobsActive）
  state.jobsActive = active;
  if (!ui.modal || ui.modal.classList.contains('hidden')) return;
  if (!list.length) {
    ui.list.innerHTML = '<p class="hint">还没有任务。出图、上传口播、语音测评和视频测评会出现在这里，关掉页面也会接着做。</p>';
    return;
  }
  ui.list.innerHTML = list.map((j) => {
    const target = j.payload?.draftId || j.payload?.speakId;
    return `
    <div class="job-row" data-job="${j.id}">
      <span class="job-dot ${j.status}" aria-hidden="true"></span>
      <div class="job-main">
        <b>${esc(j.label)}</b>
        <div class="hint">
          <span class="job-st ${j.status}">${STATUS[j.status] || j.status}</span>
          · ${esc(stamp(j.createdAt))}${took(j) ? ` · 用时 ${took(j)}` : ''}
          ${j.status === 'failed' && j.error ? `<span class="form-error"> · ${esc(j.error)}</span>` : ''}
        </div>
      </div>
      ${j.status === 'queued' ? `<button type="button" class="btn ghost small" data-job-cancel="${j.id}">取消</button>` : ''}
      ${['failed', 'cancelled'].includes(j.status) ? `<button type="button" class="btn ghost small" data-job-retry="${j.id}">重试</button>` : ''}
      ${target && j.status !== 'cancelled' ? `<button type="button" class="btn ghost small" data-job-open="${j.id}">去看看</button>` : ''}
    </div>`;
  }).join('');
}

export function openJobs() {
  ui.modal.classList.remove('hidden');
  render();
  clearTimeout(timer);
  timer = null;
  poll();
}

const close = () => ui.modal.classList.add('hidden');
ui.btn?.addEventListener('click', openJobs);
ui.close?.addEventListener('click', close);
ui.modal?.addEventListener('click', (e) => { if (e.target === ui.modal) close(); });

ui.list?.addEventListener('click', async (e) => {
  const cancel = e.target.closest('[data-job-cancel]');
  const again = e.target.closest('[data-job-retry]');
  const open = e.target.closest('[data-job-open]');
  const btn = cancel || again || open;
  if (!btn) return;
  const id = Number(btn.dataset.jobCancel || btn.dataset.jobRetry || btn.dataset.jobOpen);
  const job = known.get(id) || list.find((j) => j.id === id);
  btn.disabled = true;
  try {
    if (cancel) {
      const { job: next } = await api(`/jobs/${id}/cancel`, { method: 'POST', body: {} });
      known.set(id, next);
      list = list.map((j) => (j.id === id ? next : j));
      render();
    } else if (again) {
      const { job: next } = await api(`/jobs/${id}/retry`, { method: 'POST', body: {} });
      trackJob(next);
      poll();
    } else if (job) {
      close();
      if (SPEAK_KINDS.has(job.kind)) await openSpeakRecord(job.payload.speakId);
      else if (job.payload?.draftId) {
        if (state.draft?.id !== job.payload.draftId) {
          const { draft } = await api(`/drafts/${job.payload.draftId}`);
          setDraft(draft);
        }
        if (job.kind === 'image') toast('配图在正文上方的「配图」里');
      }
    }
  } catch (err) {
    toast(err.message);
    btn.disabled = false;
  }
});

/* 进应用时拉一次：接上刷新前还在跑的任务 */
window.addEventListener('cw-enter', () => { clearTimeout(timer); timer = null; poll(); });
