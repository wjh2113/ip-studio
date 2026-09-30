import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { creditsFor, explain, planOf, periodOf } from '../server/plans.js';
import { assertQuota, consume, snapshot, QuotaError } from '../server/quota.js';
import { Users, Quota } from '../server/db.js';

test('creditsFor：文案按千 token 0.4 点向上取整，配图 14 点一张，未知功能不计费', () => {
  assert.equal(creditsFor('成稿', 1000), 1);
  assert.equal(creditsFor('成稿', 10000), 4);
  assert.equal(creditsFor('图文配图', 2), 28);
  assert.equal(creditsFor('不存在的功能', 5000), 0);
  assert.equal(creditsFor('成稿', 0), 0);
});

test('explain：免费档不展示配图', () => {
  const free = explain(150, planOf('free')).map((x) => x.key);
  assert.ok(free.includes('成稿'));
  assert.ok(!free.includes('图文配图'));
});

test('periodOf 是自然月', () => {
  assert.equal(periodOf(new Date('2026-09-30T10:00:00Z')), '2026-09');
});

test('配额：免费档不能配图；额度用完被拦；跨月重置', () => {
  const u = Users.create('quota-user', 'x:y');
  assert.throws(() => assertQuota(u.id, '图文配图', 1), (e) => e instanceof QuotaError && e.status === 402);
  assertQuota(u.id, '文案');                   // 150 点够
  consume(u.id, '文案', 370_000);              // 148 点
  assert.equal(snapshot(u.id).left, 2);
  assert.throws(() => assertQuota(u.id, '文案'), QuotaError);
  Quota.state(u.id, '1999-01');               // 模拟跨月
  assert.equal(snapshot(u.id).used, 0);
});
