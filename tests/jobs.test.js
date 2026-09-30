import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { eq, sql } from 'drizzle-orm';
import { Jobs, Users, db } from '../server/db.js';
import { jobs as jobTable, users } from '../server/schema.js';
import { snapshot } from '../server/quota.js';
import { defineJob, enqueue, recoverJobs, retry, stopQueue, waitFor } from '../server/jobs.js';

const user = async (name) => {
  const u = await Users.create(name, 'x:y');
  await snapshot(u.id);                                  // 进入本月计费周期
  return u;
};

test.after(async () => { await stopQueue(); });

async function until(pred, ms = 2000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (await pred()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('队列状态没有在预期时间内变化');
}

test('登记 → 做完 → 结果落库；同一件事没做完不重复建', async () => {
  let calls = 0;
  defineJob('t-ok', { label: '测试', run: async (job) => { calls += 1; await new Promise((r) => setTimeout(r, 30)); return { got: job.payload.n }; } });
  const u = await user('job-ok');
  const a = await enqueue(u.id, 't-ok', { ref: 'same', payload: { n: 1 } });
  const b = await enqueue(u.id, 't-ok', { ref: 'same', payload: { n: 2 } });
  assert.equal(a.id, b.id);
  const done = await waitFor(a.id, 2000);
  assert.equal(done.status, 'done');
  assert.deepEqual(done.result, { got: 1 });
  assert.equal(calls, 1);
  // 做完之后同一个 ref 可以再登记
  const c = await enqueue(u.id, 't-ok', { ref: 'same', payload: { n: 3 } });
  assert.notEqual(c.id, a.id);
  assert.equal((await waitFor(c.id, 2000)).result.got, 3);
});

test('失败：预扣的点数整笔退回，错误和状态码记下来，可以重试', async () => {
  let fail = true;
  defineJob('t-fail', {
    run: async (job, ctx) => {
      await ctx.hold('文案');
      if (fail) { const e = new Error('网关挂了'); e.status = 502; throw e; }
      await ctx.settle(1000);
      return { ok: true };
    },
  });
  const u = await user('job-fail');
  const before = (await snapshot(u.id)).used;
  const job = await enqueue(u.id, 't-fail', { ref: 'x' });
  const done = await waitFor(job.id, 2000);
  assert.equal(done.status, 'failed');
  assert.equal(done.error, '网关挂了');
  assert.equal(done.result.code, 502);
  assert.equal((await snapshot(u.id)).used, before);
  fail = false;
  const again = await waitFor((await retry(done)).id, 2000);
  assert.equal(again.status, 'done');
  assert.equal((await snapshot(u.id)).used, before + 1);  // 1000 token ≈ 0.4 点，向上取整 1 点
});

test('每人并发有上限：同一个人第三件事要排队', async () => {
  const gates = [];
  defineJob('t-slow', { run: () => new Promise((r) => gates.push(r)) });
  const u = await user('job-limit');
  const jobs = [];
  for (const i of [1, 2, 3]) jobs.push(await enqueue(u.id, 't-slow', { ref: `s${i}` }));
  const statuses = async () => (await Promise.all(jobs.map((j) => Jobs.byId(j.id)))).map((j) => j.status);
  try {
    await until(async () => {
      const list = await statuses();
      return list.filter((s) => s === 'running').length === 2 && list.filter((s) => s === 'queued').length === 1;
    });
    assert.equal(gates.length, 2);
    gates.shift()();
    await until(async () => (await statuses()).filter((s) => s === 'done').length === 1
      && (await statuses()).filter((s) => s === 'running').length === 2);
  } catch (err) {
    const list = await statuses().catch(() => []);
    err.message = `${err.message}；实际状态 ${list.join(',')}`;
    throw err;
  } finally {
    while (gates.length) gates.shift()();
    await Promise.all(jobs.map((j) => waitFor(j.id, 1000)));
  }
});

test('取消只对排队中的有效', async () => {
  const gates = [];
  defineJob('t-cancel', { run: () => new Promise((r) => gates.push(r)) });
  const u = await user('job-cancel');
  const jobs = [];
  for (const i of [1, 2, 3]) jobs.push(await enqueue(u.id, 't-cancel', { ref: `c${i}` }));
  await until(async () => (await Jobs.byId(jobs[0].id)).status === 'running' && (await Jobs.byId(jobs[2].id)).status === 'queued');
  assert.equal(await Jobs.cancel(jobs[0].id, u.id), false);   // 在跑
  assert.equal(await Jobs.cancel(jobs[2].id, u.id), true);    // 在排队
  assert.equal((await Jobs.byId(jobs[2].id)).status, 'cancelled');
  gates.forEach((g) => g());
  await Promise.all(jobs.slice(0, 2).map(async (j) => await waitFor(j.id, 1000)));
});

test('重启恢复：在跑的退回预扣、重新排队；跑满次数的记失败并收尾', async () => {
  let failed = null;
  defineJob('t-recover', { run: async () => ({ ok: 1 }), onFail: (job, msg) => { failed = msg; } });
  const u = await user('job-recover');
  const base = (await snapshot(u.id)).used;
  // 模拟上次进程死在半路：两条「在跑」、各预扣了 5 点
  const a = await Jobs.create({ userId: u.id, kind: 't-recover', ref: 'r1' });
  const b = await Jobs.create({ userId: u.id, kind: 't-recover', ref: 'r2' });
  for (const j of [a, b]) {
    await Jobs.claim(j.id);
    await Jobs.setHeld(j.id, 5, '文案');
  }
  await Jobs.claim(b.id);                                        // 不会重复领
  await db.update(jobTable).set({ attempts: 2 }).where(eq(jobTable.id, b.id));
  await db.update(users).set({ used: sql`${users.used} + 10` }).where(eq(users.id, u.id));
  await recoverJobs();
  assert.equal((await snapshot(u.id)).used, base);
  const doneA = await waitFor(a.id, 2000);
  assert.equal(doneA.status, 'done');
  const doneB = await Jobs.byId(b.id);
  assert.equal(doneB.status, 'failed');
  assert.match(failed, /服务重启/);
});
