/* 长任务队列：出图、口播转写与文字总评、语音测评、视频测评。
 *
 * 登记写在 PostgreSQL（任务中心和重启恢复都看这张表）。真正执行交给 BullMQ，
 * 队列在 Redis 里，进程重启后由 startQueue() 按表里的「排队中」重新投递。
 * 全局并发是 Worker 的 concurrency，每人并发超了就把这条延后，不占住名额。
 *
 * 用法：
 *   defineJob('image', { label: '配图', run: async (job, ctx) => result, onFail?: (job, message) => {} })
 *   enqueue(userId, 'image', { ref: 'image:12:__main__:0', label: '配图第 1 张', payload: {...} })
 * run 里要花点数的，用 ctx.hold(功能, 用量) 预扣、ctx.settle(实际用量) 结算：
 *   - run 抛错时，没结算的预扣自动整笔退回；
 *   - run 正常返回但没调 settle，视为按预扣的量花掉了。
 */
import { Queue, Worker, DelayedError } from 'bullmq';
import { Jobs, Quota } from './db.js';
import { reserve, settle } from './quota.js';

const KINDS = new Map();
const waiters = new Map();
const perUser = new Map();
let running = 0;
let queue;
let worker;

export const MAX_ATTEMPTS = 2;
const LIMIT_ALL = () => Math.max(1, Number(process.env.JOB_CONCURRENCY) || 3);
const LIMIT_USER = () => Math.max(1, Number(process.env.JOB_PER_USER) || 2);
const QUEUE_NAME = 'ip-studio';

export const ACTIVE = new Set(['queued', 'running']);

function redisConnection() {
  const raw = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  const u = new URL(raw);
  const dbFromPath = u.pathname && u.pathname !== '/' ? Number(u.pathname.slice(1)) : 0;
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: process.env.NODE_ENV === 'test' ? 15 : (Number.isFinite(dbFromPath) ? dbFromPath : 0),
    maxRetriesPerRequest: null,
  };
}

const prefix = () => (process.env.NODE_ENV === 'test' ? `ipstudio-test-${process.pid}` : 'ipstudio');
const bullId = (id) => `j${id}`;

export function defineJob(kind, def) {
  KINDS.set(kind, def);
}

function queueOpts() {
  return { connection: redisConnection(), prefix: prefix() };
}

function ensureQueue() {
  if (!queue) queue = new Queue(QUEUE_NAME, queueOpts());
  return queue;
}

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(QUEUE_NAME, processBull, { ...queueOpts(), concurrency: LIMIT_ALL() });
  worker.on('error', (err) => console.error('[jobs]', err.message));
  return worker;
}

async function add(job) {
  ensureQueue();
  ensureWorker();
  await queue.add(job.kind, { id: job.id }, {
    jobId: bullId(job.id),
    removeOnComplete: true,
    removeOnFail: true,
  }).catch((err) => {
    if (!/already exists|JobId/i.test(String(err?.message))) throw err;
  });
}

/* 登记一件事。同一个 ref（同一张图、同一遍口播的同一种评测）还没做完，就返回那一条，不重复建 */
export async function enqueue(userId, kind, { ref = '', label = '', payload = {} } = {}) {
  const def = KINDS.get(kind);
  if (!def) throw new Error(`未知的任务类型：${kind}`);
  const dup = await Jobs.activeByRef(userId, ref);
  if (dup) return dup;
  const job = await Jobs.create({ userId, kind, ref, label: label || def.label || kind, payload });
  await def.onEnqueue?.(job);
  await Jobs.prune(userId);
  void add(job).catch((err) => console.error('[jobs] 入队失败', err.message));
  return job;
}

/* 重试一条已经失败或取消的任务：按原样再登记一条 */
export async function retry(job) {
  return enqueue(job.userId, job.kind, { ref: job.ref, label: job.label, payload: job.payload });
}

/* 排队中的任务取消后，把 Redis 里对应的那条也拿掉，避免过一会儿又跑起来 */
export async function forgetQueued(id) {
  if (!queue) return;
  await queue.remove(bullId(id)).catch(() => {});
}

async function processBull(bullJob, token) {
  const row = await Jobs.byId(bullJob.data.id);
  if (!row || row.status !== 'queued') return;
  /* 占名额发生在下一次 await 之前，并发进来的任务不会一起挤过每人上限。 */
  if ((perUser.get(row.userId) || 0) >= LIMIT_USER()) {
    await bullJob.moveToDelayed(Date.now() + 40, token);
    throw new DelayedError();
  }
  perUser.set(row.userId, (perUser.get(row.userId) || 0) + 1);
  try {
    if (!await Jobs.claim(row.id)) return;
    await run(await Jobs.byId(row.id));
  } finally {
    perUser.set(row.userId, Math.max(0, (perUser.get(row.userId) || 1) - 1));
  }
}

async function run(job) {
  running += 1;

  let hold = null;
  const ctx = {
    async hold(feature, units) {
      const { held } = await reserve(job.userId, feature, units);
      hold = { feature, held };
      await Jobs.setHeld(job.id, held, feature);
      return held;
    },
    async settle(actualUnits) {
      if (!hold) return 0;
      const out = await settle(job.userId, hold.feature, hold.held, actualUnits);
      hold = null;
      await Jobs.setHeld(job.id, 0, '');
      return out;
    },
  };

  const def = KINDS.get(job.kind);
  let done;
  try {
    if (!def) throw new Error(`未知的任务类型：${job.kind}`);
    const result = await def.run(job, ctx);
    done = await Jobs.finish(job.id, { status: 'done', result: result ?? null });
  } catch (err) {
    if (hold) await ctx.settle(0);
    const message = String(err?.message || err || '任务失败');
    const code = Number(err?.status) || 502;
    try { def?.onFail?.(job, message); } catch (e) { console.warn('[jobs] onFail', e.message); }
    done = await Jobs.finish(job.id, { status: 'failed', error: message, result: { code } });
  } finally {
    running -= 1;
  }

  const list = waiters.get(job.id) || [];
  waiters.delete(job.id);
  for (const fn of list) fn(done);
}

/* 等一条任务做完，最多等 ms 毫秒；到点还没好就返回当时的状态 */
export async function waitFor(id, ms = 0) {
  const job = await Jobs.byId(id);
  if (!job || !ACTIVE.has(job.status) || ms <= 0) return job;
  return new Promise((resolve) => {
    const fn = (done) => { clearTimeout(timer); resolve(done); };
    const timer = setTimeout(() => {
      waiters.set(id, (waiters.get(id) || []).filter((f) => f !== fn));
      void Jobs.byId(id).then(resolve);
    }, ms);
    waiters.set(id, [...(waiters.get(id) || []), fn]);
  });
}

/* 服务启动时调一次：上次没跑完的，退回预扣、重新排队；已经跑过 MAX_ATTEMPTS 次的记为失败。
 * 表改完以后由 startQueue() 把「排队中」投进 Redis。测试里没有单独的启动步骤，这里直接投。 */
export async function recoverJobs() {
  for (const job of await Jobs.running()) {
    if (job.held > 0) await Quota.refund(job.userId, job.held);
    if (job.attempts >= MAX_ATTEMPTS || !KINDS.has(job.kind)) {
      const message = '服务重启，任务中断了。可以在任务中心重试';
      try { KINDS.get(job.kind)?.onFail?.(job, message); } catch { /* 收尾失败不影响恢复 */ }
      await Jobs.finish(job.id, { status: 'failed', error: message, result: { code: 503 } });
    } else {
      await Jobs.requeue(job.id);
    }
  }
  if (process.env.NODE_ENV === 'test') {
    for (const job of await Jobs.queued()) await add(job);
  }
}

/* 清空 Redis 里上次进程留下的条目，再按数据库里的排队记录投递。任务状态以 PostgreSQL 为准。 */
export async function startQueue() {
  ensureQueue();
  await queue.obliterate({ force: true });
  ensureWorker();
  for (const job of await Jobs.queued()) await add(job);
}

export async function stopQueue() {
  await worker?.close();
  await queue?.close();
  worker = null;
  queue = null;
}

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

export const jobStats = () => ({ running, perUser: Object.fromEntries(perUser) });
