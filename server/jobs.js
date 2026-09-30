/* 长任务队列：出图、口播转写与文字总评、语音测评、视频测评这类要跑几十秒到几分钟的活。
 *
 * 为什么要队列：以前这些活挂在一个 HTTP 请求上。浏览器一刷新、手机一锁屏、nginx 一超时，
 * 结果就丢了，点数却可能已经花掉。现在请求只负责「登记一件事」，活由服务进程里的 worker 做完写回库，
 * 前端轮询任务状态，或者在任务中心里看。
 *
 * 单机部署（一台 Node + SQLite），worker 就在服务进程里，不另起进程。jobs 表保证重启不丢：
 * 启动时 recoverJobs() 把上次「在跑」的任务退回它预扣的点数，再重新排队（最多跑 MAX_ATTEMPTS 次）。
 *
 * 用法：
 *   defineJob('image', { label: '配图', run: async (job, ctx) => result, onFail?: (job, message) => {} })
 *   enqueue(userId, 'image', { ref: 'image:12:__main__:0', label: '配图第 1 张', payload: {...} })
 * run 里要花点数的，用 ctx.hold(功能, 用量) 预扣、ctx.settle(实际用量) 结算：
 *   - run 抛错时，没结算的预扣自动整笔退回；
 *   - run 正常返回但没调 settle，视为按预扣的量花掉了。
 */
import { Jobs, Quota } from './db.js';
import { reserve, settle } from './quota.js';

const KINDS = new Map();
const waiters = new Map();          // jobId → [fn(job)]，同步等结果的请求挂在这里
const perUser = new Map();          // userId → 正在跑的数量
let running = 0;

export const MAX_ATTEMPTS = 2;
const LIMIT_ALL = () => Math.max(1, Number(process.env.JOB_CONCURRENCY) || 3);
const LIMIT_USER = () => Math.max(1, Number(process.env.JOB_PER_USER) || 2);

export const ACTIVE = new Set(['queued', 'running']);

export function defineJob(kind, def) {
  KINDS.set(kind, def);
}

/* 登记一件事。同一个 ref（同一张图、同一遍口播的同一种评测）还没做完，就返回那一条，不重复建 */
export function enqueue(userId, kind, { ref = '', label = '', payload = {} } = {}) {
  const def = KINDS.get(kind);
  if (!def) throw new Error(`未知的任务类型：${kind}`);
  const dup = Jobs.activeByRef(userId, ref);
  if (dup) return dup;
  const job = Jobs.create({ userId, kind, ref, label: label || def.label || kind, payload });
  def.onEnqueue?.(job);
  Jobs.prune(userId);
  setImmediate(pump);
  return job;
}

/* 重试一条已经失败或取消的任务：按原样再登记一条 */
export function retry(job) {
  return enqueue(job.userId, job.kind, { ref: job.ref, label: job.label, payload: job.payload });
}

/* 有空位就领任务。全局和每人各有上限，一个人连点十张图不会把别人堵住 */
function pump() {
  for (const job of Jobs.queued()) {
    if (running >= LIMIT_ALL()) return;
    if ((perUser.get(job.userId) || 0) >= LIMIT_USER()) continue;
    if (!Jobs.claim(job.id)) continue;
    run(job);
  }
}

async function run(job) {
  running += 1;
  perUser.set(job.userId, (perUser.get(job.userId) || 0) + 1);

  let hold = null;          // { feature, held }
  const ctx = {
    hold(feature, units) {
      const { held } = reserve(job.userId, feature, units);
      hold = { feature, held };
      Jobs.setHeld(job.id, held, feature);
      return held;
    },
    settle(actualUnits) {
      if (!hold) return 0;
      const out = settle(job.userId, hold.feature, hold.held, actualUnits);
      hold = null;
      Jobs.setHeld(job.id, 0, '');
      return out;
    },
  };

  const def = KINDS.get(job.kind);
  let done;
  try {
    if (!def) throw new Error(`未知的任务类型：${job.kind}`);
    const result = await def.run(job, ctx);
    done = Jobs.finish(job.id, { status: 'done', result: result ?? null });
  } catch (err) {
    if (hold) ctx.settle(0);
    const message = String(err?.message || err || '任务失败');
    const code = Number(err?.status) || 502;
    try { def?.onFail?.(job, message); } catch (e) { console.warn('[jobs] onFail', e.message); }
    done = Jobs.finish(job.id, { status: 'failed', error: message, result: { code } });
  } finally {
    running -= 1;
    perUser.set(job.userId, Math.max(0, (perUser.get(job.userId) || 1) - 1));
  }

  const list = waiters.get(job.id) || [];
  waiters.delete(job.id);
  for (const fn of list) fn(done);
  setImmediate(pump);
}

/* 等一条任务做完，最多等 ms 毫秒；到点还没好就返回当时的状态 */
export function waitFor(id, ms = 0) {
  const job = Jobs.byId(id);
  if (!job || !ACTIVE.has(job.status) || ms <= 0) return Promise.resolve(job);
  return new Promise((resolve) => {
    const fn = (done) => { clearTimeout(timer); resolve(done); };
    const timer = setTimeout(() => {
      waiters.set(id, (waiters.get(id) || []).filter((f) => f !== fn));
      resolve(Jobs.byId(id));
    }, ms);
    waiters.set(id, [...(waiters.get(id) || []), fn]);
  });
}

/* 服务启动时调一次：上次没跑完的，退回预扣、重新排队；已经跑过 MAX_ATTEMPTS 次的记为失败 */
export function recoverJobs() {
  for (const job of Jobs.running()) {
    if (job.held > 0) Quota.refund(job.userId, job.held);
    if (job.attempts >= MAX_ATTEMPTS || !KINDS.has(job.kind)) {
      const message = '服务重启，任务中断了。可以在任务中心重试';
      try { KINDS.get(job.kind)?.onFail?.(job, message); } catch { /* 收尾失败不影响恢复 */ }
      Jobs.finish(job.id, { status: 'failed', error: message, result: { code: 503 } });
    } else {
      Jobs.requeue(job.id);
    }
  }
  pump();
}

/* 给前端看的样子：payload 里只有 id 和版本这类定位信息，可以原样给 */
export function presentJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    kind: job.kind,
    label: job.label,
    status: job.status,
    error: job.error,
    code: job.status === 'failed' ? (job.result?.code || 502) : null,
    result: job.status === 'done' ? job.result : null,
    payload: job.payload,
    attempts: job.attempts,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  };
}

/* 测试用：看 worker 现在有几个在跑 */
export const jobStats = () => ({ running, perUser: Object.fromEntries(perUser) });
