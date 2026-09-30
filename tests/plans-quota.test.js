import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { creditsFor, explain, planOf, periodOf } from '../server/plans.js';
import { assertQuota, consume, reserve, settle, snapshot, QuotaError } from '../server/quota.js';
import { Users, Quota } from '../server/db.js';

test('creditsFor：文案按千 token 0.4 点向上取整，配图 14 点一张，未知功能不计费', async () => {
  assert.equal(creditsFor('成稿', 1000), 1);
  assert.equal(creditsFor('成稿', 10000), 4);
  assert.equal(creditsFor('图文配图', 2), 28);
  assert.equal(creditsFor('不存在的功能', 5000), 0);
  assert.equal(creditsFor('成稿', 0), 0);
});

test('explain：免费档不展示配图', async () => {
  const free = explain(150, planOf('free')).map((x) => x.key);
  assert.ok(free.includes('成稿'));
  assert.ok(!free.includes('图文配图'));
});

test('periodOf 是自然月', async () => {
  assert.equal(periodOf(new Date('2026-09-30T10:00:00Z')), '2026-09');
});

test('配额：免费档不能配图；额度用完被拦；跨月重置', async () => {
  const u = await Users.create('quota-user', 'x:y');
  await assert.rejects(() => assertQuota(u.id, '图文配图', 1), (e) => e instanceof QuotaError && e.status === 402);
  await assertQuota(u.id, '文案');                   // 150 点够
  await consume(u.id, '文案', 370_000);              // 148 点
  assert.equal((await snapshot(u.id)).left, 2);
  await assert.rejects(() => assertQuota(u.id, '文案'), QuotaError);
  await Quota.state(u.id, '1999-01');               // 模拟跨月
  assert.equal((await snapshot(u.id)).used, 0);
});

test('预扣与结算：检查和预扣是一步，余额不够的第二个请求直接被拦', async () => {
  const u = await Users.create('reserve-user', 'x:y');
  await snapshot(u.id);                                 // 先进入本月计费周期
  await consume(u.id, '文案', 360_000);                 // 用掉 144 点，剩 6 点
  const a = await reserve(u.id, '文案');                // 预扣 5 点，剩 1 点
  assert.equal(a.held, 5);
  await assert.rejects(() => reserve(u.id, '文案'), QuotaError);
  await settle(u.id, '文案', a.held, 2000);             // 实际只用 1 点，退 4 点
  assert.equal((await snapshot(u.id)).left, 5);
  const b = await reserve(u.id, '文案');
  await settle(u.id, '文案', b.held, 0);                // 失败，整笔退回
  assert.equal((await snapshot(u.id)).left, 5);
});
