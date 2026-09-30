import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Jobs, Users } from '../server/db.js';
import { snapshot } from '../server/quota.js';
import { defineJob, enqueue, recoverJobs, retry, stopQueue, waitFor } from '../server/jobs.js';

const user = (name) => {
  const u = Users.create(name, 'x:y');
  snapshot(u.id);                                  // 进入本月计费周期
  return u;
};

test.after(async () => { await stopQueue(); });

async function until(pred, ms = 2000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('队列状态没有在预期时间内变化');
}

test('登记 → 做完 → 结果落库；同一件事没做完不重复建', async () => {
  let calls = 0;
  defineJob('t-ok', { label: '测试', run: async (job) => { calls += 1; await new Promise((r) => setTimeout(r, 30)); return { got: job.payload.n }; } });
  const u = user('job-ok');
  const a = enqueue(u.id, 't-ok', { ref: 'same', payload: { n: 1 } });
  const b = enqueue(u.id, 't-ok', { ref: 'same', payload: { n: 2 } });
  assert.equal(a.id, b.id);
  const done = await waitFor(a.id, 2000);
  assert.equal(done.status, 'done');
  assert.deepEqual(done.result, { got: 1 });
  assert.equal(calls, 1);
  // 做完之后同一个 ref 可以再登记
  const c = enqueue(u.id, 't-ok', { ref: 'same', payload: { n: 3 } });
  assert.notEqual(c.id, a.id);
  assert.equal((await waitFor(c.id, 2000)).result.got, 3);
});

test('失败：预扣的点数整笔退回，错误和状态码记下来，可以重试', async () => {
  let fail = true;
  defineJob('t-fail', {
    run: async (job, ctx) => {
      ctx.hold('文案');
      if (fail) { const e = new Error('网关挂了'); e.status = 502; throw e; }
      ctx.settle(1000);
      return { ok: true };
    },
  });
  const u = user('job-fail');
  const before = snapshot(u.id).used;
  const job = enqueue(u.id, 't-fail', { ref: 'x' });
  const done = await waitFor(job.id, 2000);
  assert.equal(done.status, 'failed');
  assert.equal(done.error, '网关挂了');
  assert.equal(done.result.code, 502);
  assert.equal(snapshot(u.id).used, before);
  fail = false;
  const again = await waitFor(retry(done).id, 2000);
  assert.equal(again.status, 'done');
  assert.equal(snapshot(u.id).used, before + 1);  // 1000 token ≈ 0.4 点，向上取整 1 点
});

test('每人并发有上限：同一个人第三件事要排队', async () => {
  const gates = [];
  defineJob('t-slow', { run: () => new Promise((r) => gates.push(r)) });
  const u = user('job-limit');
  const jobs = [1, 2, 3].map((i) => enqueue(u.id, 't-slow', { ref: `s${i}` }));
  await until(() => jobs.map((j) => Jobs.byId(j.id).status).join() === 'running,running,queued');
  gates.shift()();
  await waitFor(jobs[0].id, 2000);
  await until(() => Jobs.byId(jobs[2].id).status === 'running');
  while (gates.length) gates.shift()();
  await new Promise((r) => setTimeout(r, 30));
  gates.forEach((g) => g());
  await waitFor(jobs[2].id, 1000);
});

test('取消只对排队中的有效', async () => {
  const gates = [];
  defineJob('t-cancel', { run: () => new Promise((r) => gates.push(r)) });
  const u = user('job-cancel');
  const jobs = [1, 2, 3].map((i) => enqueue(u.id, 't-cancel', { ref: `c${i}` }));
  await until(() => Jobs.byId(jobs[0].id).status === 'running' && Jobs.byId(jobs[2].id).status === 'queued');
  assert.equal(Jobs.cancel(jobs[0].id, u.id), false);   // 在跑
  assert.equal(Jobs.cancel(jobs[2].id, u.id), true);    // 在排队
  assert.equal(Jobs.byId(jobs[2].id).status, 'cancelled');
  gates.forEach((g) => g());
  await Promise.all(jobs.slice(0, 2).map((j) => waitFor(j.id, 1000)));
});

test('重启恢复：在跑的退回预扣、重新排队；跑满次数的记失败并收尾', async () => {
  let failed = null;
  defineJob('t-recover', { run: async () => ({ ok: 1 }), onFail: (job, msg) => { failed = msg; } });
  const u = user('job-recover');
  const base = snapshot(u.id).used;
  // 模拟上次进程死在半路：两条「在跑」、各预扣了 5 点
  const a = Jobs.create({ userId: u.id, kind: 't-recover', ref: 'r1' });
  const b = Jobs.create({ userId: u.id, kind: 't-recover', ref: 'r2' });
  for (const j of [a, b]) {
    Jobs.claim(j.id);
    Jobs.setHeld(j.id, 5, '文案');
  }
  Jobs.claim(b.id);                                        // 不会重复领
  const { db } = await import('../server/db.js');
  db.prepare('UPDATE jobs SET attempts = 2 WHERE id = ?').run(b.id);
  db.prepare('UPDATE users SET used = used + 10 WHERE id = ?').run(u.id);
  recoverJobs();
  assert.equal(snapshot(u.id).used, base);
  const doneA = await waitFor(a.id, 2000);
  assert.equal(doneA.status, 'done');
  const doneB = Jobs.byId(b.id);
  assert.equal(doneB.status, 'failed');
  assert.match(failed, /服务重启/);
});
