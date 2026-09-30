/* 长任务队列：出图、口播转写与文字总评、语音测评、视频测评。
 *
 * 登记写在 PostgreSQL（任务中心和重启恢复都看这张表），真正执行交给 BullMQ（队列在 Redis 里）。
 * 任务状态以 PostgreSQL 为准；Redis 里只放「该跑哪一条」的号码，丢了可以按表重新投递：
 *   - 启动时 startQueue() 把表里「排队中」的投进去（按任务号去重，重复投递没副作用）；
 *   - 之后每分钟 sweep() 再对一次账，Redis 重启丢了数据、或者入队那一刻 Redis 正好不通，都能补上。
 * 全局并发是 Worker 的 concurrency。每人并发超了就把这条延后；有人让出名额时直接把他等着的那条提前。
 *
 * 用法：
 *   defineJob('image', { label: '配图', run: async (job, ctx) => result, onFail?: async (job, message) => {} })
 *   enqueue(userId, 'image', { ref: 'image:12:__main__:0', label: '配图第 1 张', payload: {...} })
 * run 里要花点数的，用 ctx.hold(功能, 用量) 预扣、ctx.settle(实际用量) 结算：
 *   - run 抛错时，没结算的预扣自动整笔退回；
 *   - run 正常返回但没调 settle，视为按预扣的量花掉了。
 *
 * 停机：stopQueue() 先让 Worker 把手上正在跑的做完（最多等 JOB_DRAIN_MS），再断开 Redis。
 * 部署时 pm2 发 SIGTERM，server/index.js 会调它，正在出的图、正在评的口播不会被打断。
 */
import { Queue, Worker, DelayedError } from 'bullmq';
import { Jobs, Quota } from './db.js';
import { reserve, settle } from './quota.js';

const KINDS = new Map();
const waiters = new Map();            // 任务号 → [fn(job)]，同步等结果的请求挂在这里
const perUser = new Map();            // userId → 正在跑的数量（本进程）
const deferred = new Map();           // userId → [BullMQ 任务号]，因为每人上限被延后的
let running = 0;
let queue;
let worker;
let sweeper;
let closing = false;           // 停机中：不再投递、不再提前，免得关掉的队列又被重新建出来

export const MAX_ATTEMPTS = 2;
const LIMIT_ALL = () => Math.max(1, Number(process.env.JOB_CONCURRENCY) || 3);
const LIMIT_USER = () => Math.max(1, Number(process.env.JOB_PER_USER) || 2);
// 每人上限满了以后多久再看一次。有人让出名额会立刻提前，这个只是兜底，不要设太短（会空转）
const DEFER_MS = 3000;
const SWEEP_MS = 60_000;
const READY_MS = 10_000;
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

/* Redis 里的键前缀要和数据库一一对应：同一台 Redis 上的测试库、预发库、正式库互不相干。
   可以用 REDIS_PREFIX 显式指定。 */
export function queuePrefix() {
  if (process.env.REDIS_PREFIX) return process.env.REDIS_PREFIX;
  if (process.env.NODE_ENV === 'test') return `ipstudio-test-${process.pid}`;
  let dbName = 'default';
  try { dbName = new URL(process.env.DATABASE_URL || 'postgres://x/ip_studio').pathname.slice(1) || 'default'; } catch { /* 用默认 */ }
  const schema = process.env.DB_SCHEMA || 'public';
  return `ipstudio:${dbName}${schema === 'public' ? '' : `:${schema}`}`;
}

const bullId = (id) => `j${id}`;

export function defineJob(kind, def) {
  KINDS.set(kind, def);
}

function queueOpts() {
  return { connection: redisConnection(), prefix: queuePrefix() };
}

/* Redis 断线时 ioredis 会每次重连失败都报一次错，日志别刷屏：同一条消息一分钟最多记一次 */
const lastLogged = new Map();
function logRedis(where, err) {
  const msg = String(err?.message || err);
  const key = `${where}:${msg}`;
  if (Date.now() - (lastLogged.get(key) || 0) < 60_000) return;
  lastLogged.set(key, Date.now());
  console.error(`[jobs] ${where}：${msg}`);
}

function ensureQueue() {
  if (!queue) {
    queue = new Queue(QUEUE_NAME, queueOpts());
    queue.on('error', (err) => logRedis('队列', err));
  }
  return queue;
}

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(QUEUE_NAME, processBull, { ...queueOpts(), concurrency: LIMIT_ALL() });
  worker.on('error', (err) => logRedis('Worker', err));
  return worker;
}

const pendingAdds = new Set();

function add(job) {
  const p = doAdd(job); // no-await-ok：记下这次投递，停机时等它落地
  pendingAdds.add(p);
  p.finally(() => pendingAdds.delete(p)).catch(() => {});
  return p;
}

async function doAdd(job) {
  if (closing) return;
  ensureQueue();
  ensureWorker();
  await queue.add(job.kind, { id: job.id, userId: job.userId }, {
    jobId: bullId(job.id),
    removeOnComplete: true,
    removeOnFail: true,
  }).catch((err) => {
    if (!/already exists|JobId/i.test(String(err?.message))) throw err;
  });
}

/* 登记一件事。同一个 ref（同一张图、同一遍口播的同一种评测）还没做完，就返回那一条，不重复建。
   去重靠数据库的唯一索引（迁移 2），并发连点也只会建出一条。 */
export async function enqueue(userId, kind, { ref = '', label = '', payload = {} } = {}) {
  const def = KINDS.get(kind);
  if (!def) throw new Error(`未知的任务类型：${kind}`);
  for (let i = 0; i < 3; i += 1) {
    const dup = await Jobs.activeByRef(userId, ref);
    if (dup) return dup;
    const job = await Jobs.create({ userId, kind, ref, label: label || def.label || kind, payload });
    if (!job) continue;              // 撞上唯一索引：别人刚建了同一件事，回头取那一条
    await def.onEnqueue?.(job);
    await Jobs.prune(userId);
    // 投递失败不影响登记：表里是「排队中」，sweep() 会补投
    void add(job).catch((err) => logRedis('投递', err));
    return job;
  }
  throw new Error('任务登记冲突，请再试一次');
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
    const list = deferred.get(row.userId) || [];
    if (!list.includes(bullJob.id)) deferred.set(row.userId, [...list, bullJob.id]);
    await bullJob.moveToDelayed(Date.now() + DEFER_MS, token);
    throw new DelayedError();
  }
  perUser.set(row.userId, (perUser.get(row.userId) || 0) + 1);
  // 拿到名额了：如果它之前被延后过，从延后名单里拿掉，免得之后「提前」用在一条已经跑起来的任务上
  const waiting = deferred.get(row.userId);
  if (waiting?.includes(bullJob.id)) {
    const rest = waiting.filter((x) => x !== bullJob.id);
    if (rest.length) deferred.set(row.userId, rest); else deferred.delete(row.userId);
  }
  try {
    if (!await Jobs.claim(row.id)) return;
    await run(await Jobs.byId(row.id));
  } finally {
    perUser.set(row.userId, Math.max(0, (perUser.get(row.userId) || 1) - 1));
    promoteNext(row.userId);
  }
}

/* 这个人让出了一个名额：把他最早被延后的那条立刻提前，不用干等 DEFER_MS */
function promoteNext(userId) {
  const list = deferred.get(userId);
  if (!list?.length || !queue || closing) return;
  const next = list.shift();
  if (!list.length) deferred.delete(userId);
  void queue.getJob(next)
    .then((j) => (j ? j.promote() : null))
    .catch(() => { /* 已经被别的路径跑起来或取消了，忽略 */ });
}

async function runOnFail(def, job, message) {
  try {
    await def?.onFail?.(job, message);
  } catch (e) {
    console.warn('[jobs] onFail', e?.message || e);
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
    if (hold) await ctx.settle(0).catch((e) => console.error('[jobs] 退回预扣失败', e?.message));
    const message = String(err?.message || err || '任务失败');
    const code = Number(err?.status) || 502;
    await runOnFail(def, job, message);
    done = await Jobs.finish(job.id, { status: 'failed', error: message, result: { code } });
  } finally {
    running -= 1;
  }
  notify(job.id, done);
}

function notify(id, done) {
  const list = waiters.get(id) || [];
  waiters.delete(id);
  for (const fn of list) fn(done);
}

/* 等一条任务做完，最多等 ms 毫秒；到点还没好就返回当时的状态。
   先挂上等待再查状态：否则查完、挂上之前那一瞬间任务正好做完，就会白等满 ms。 */
export async function waitFor(id, ms = 0) {
  if (!id) return null;
  if (ms <= 0) return Jobs.byId(id);
  let fn;
  let timer;
  const settled = new Promise((resolve) => {
    fn = (done) => { clearTimeout(timer); resolve(done); };
    timer = setTimeout(() => {
      waiters.set(id, (waiters.get(id) || []).filter((f) => f !== fn));
      void Jobs.byId(id).then(resolve, () => resolve(null));
    }, ms);
  });
  waiters.set(id, [...(waiters.get(id) || []), fn]);
  const now = await Jobs.byId(id);
  if (!now || !ACTIVE.has(now.status)) {
    waiters.set(id, (waiters.get(id) || []).filter((f) => f !== fn));
    clearTimeout(timer);
    return now;
  }
  return settled;
}

/* 服务启动时调一次：上次没跑完的，退回预扣、重新排队；已经跑过 MAX_ATTEMPTS 次的记为失败。
 * 表改完以后由 startQueue() 把「排队中」投进 Redis。测试里没有单独的启动步骤，这里直接投。 */
export async function recoverJobs() {
  for (const job of await Jobs.running()) {
    if (job.held > 0) await Quota.refund(job.userId, job.held);
    if (job.attempts >= MAX_ATTEMPTS || !KINDS.has(job.kind)) {
      const message = '服务重启，任务中断了。可以在任务中心重试';
      await runOnFail(KINDS.get(job.kind), job, message);
      await Jobs.finish(job.id, { status: 'failed', error: message, result: { code: 503 } });
    } else {
      await Jobs.requeue(job.id);
    }
  }
  if (process.env.NODE_ENV === 'test') {
    for (const job of await Jobs.queued()) await add(job);
  }
}

/* 对账：表里「排队中」的都投一遍（按任务号去重）。Redis 丢数据、入队时正好断线，都靠这个补 */
let sweeping = false;
async function sweep() {
  // Redis 断着的时候投递会一直等；上一轮没结束就别再开一轮，免得每分钟叠一个
  if (sweeping) return;
  sweeping = true;
  try {
    for (const job of await Jobs.queued()) await add(job);
  } catch (err) {
    logRedis('对账', err);
  } finally {
    sweeping = false;
  }
}

const withTimeout = (p, ms, message) => Promise.race([
  p,
  new Promise((_, reject) => { setTimeout(() => reject(new Error(message)), ms).unref(); }),
]);

/* 启动：连上 Redis 后按表投递排队中的任务。
 * 不再清空整个队列（以前的 obliterate）：同一个 Redis 上的其他实例、或者上一进程留下的任务号，
 * 由任务号去重和「表里不是排队中就跳过」来处理，不需要也不应该一刀切。
 * Redis 连不上时不阻塞启动：HTTP 照常服务，任务先记在表里，Redis 恢复后由 sweep() 投递。 */
export async function startQueue() {
  closing = false;
  ensureQueue();
  ensureWorker();
  try {
    await withTimeout(queue.waitUntilReady(), READY_MS, `${READY_MS / 1000} 秒内连不上 Redis`);
    await sweep();
  } catch (err) {
    const { host, port, db } = redisConnection();
    console.error(`[jobs] 任务队列暂时不可用（Redis ${host}:${port}/${db}）：${err.message}。`
      + '服务照常启动，任务会先记在数据库里，Redis 恢复后自动开始执行。');
  }
  if (!sweeper) {
    sweeper = setInterval(sweep, SWEEP_MS);
    sweeper.unref();
  }
}

/* 停机：Worker 先不接新任务、把手上的做完（最多等 drainMs），再断开 Redis。
 * 等不完的那几条留在表里是「在跑」，下次启动由 recoverJobs() 退回预扣、重新排队。 */
export async function stopQueue({ drainMs = Number(process.env.JOB_DRAIN_MS) || 25_000 } = {}) {
  closing = true;
  if (sweeper) { clearInterval(sweeper); sweeper = null; }
  // 还在路上的投递先等它落地，不然断开之后它又在 Redis 里写一遍
  await withTimeout(Promise.allSettled([...pendingAdds]), 3000, 'add timeout').catch(() => {});
  if (worker) {
    const w = worker;
    worker = null;
    // pause() 不再接新任务、等手上的做完；等不完就不等了，直接强制关（close(true)）。
    // 不能用 close() 等超时再 close(true)：BullMQ 里第二次 close 会复用第一次那个还在等的 Promise
    await withTimeout(w.pause(), drainMs, 'drain timeout').catch(() => {});
    await w.close(true).catch(() => {});
  }
  if (queue) {
    const q = queue;
    queue = null;
    if (process.env.NODE_ENV === 'test') await q.obliterate({ force: true }).catch(() => {});
    await q.close().catch(() => {});
  }
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
