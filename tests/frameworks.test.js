import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_FRAMEWORKS, normalizeFramework, recommendFrameworks, frameworkBlock, frameworkSnapshot } from '../server/frameworks.js';
import { contentUser, topicsUser, PLATFORMS } from '../server/prompts.js';
import { Users, Frameworks, Drafts } from '../server/db.js';

test('内置框架：key 唯一、每个框架篇幅占比合计为 1、平台 key 都存在', () => {
  const keys = new Set();
  for (const f of BUILTIN_FRAMEWORKS) {
    assert.ok(!keys.has(f.key), f.key); keys.add(f.key);
    const sum = f.slots.reduce((n, x) => n + x.ratio, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `${f.key} 合计 ${sum}`);
    for (const p of f.platforms) assert.ok(PLATFORMS[p], `${f.key} 平台 ${p}`);
  }
  assert.ok(BUILTIN_FRAMEWORKS.length >= 20);
});

test('清洗：占比归一化、空段丢掉、段数和名字校验', () => {
  const f = normalizeFramework({ name: ' 我的框架 ', slots: [{ role: '开头', ratio: 1 }, { role: '', ratio: 5 }, { role: '主体', ratio: 3 }], platforms: ['xiaohongshu', 'nope'] }, Object.keys(PLATFORMS));
  assert.equal(f.name, '我的框架');
  assert.deepEqual(f.slots.map((x) => x.ratio), [0.25, 0.75]);
  assert.deepEqual(f.platforms, ['xiaohongshu']);
  assert.throws(() => normalizeFramework({ name: 'x', slots: [{ role: 'a' }] }), /至少/);
  assert.throws(() => normalizeFramework({ slots: [] }), /名字/);
});

test('推荐：别的平台专用的不推，本平台专用和场景命中的靠前', () => {
  const list = BUILTIN_FRAMEWORKS.map((f) => ({ ...f, builtin: true, used_count: 0 }));
  const picks = recommendFrameworks(list, { platform: 'xiaohongshu', subject: '好物种草：周末备菜神器' });
  assert.equal(picks.length, 3);
  assert.equal(picks[0].key, 'b:xhs-seed');
  assert.ok(picks.every((f) => !f.platforms.length || f.platforms.includes('xiaohongshu')));
});

test('框架块：按目标字数分配每段篇幅，拼进选题和成稿提示词', () => {
  const fw = frameworkSnapshot(BUILTIN_FRAMEWORKS.find((f) => f.key === 'b:scqa'));
  const block = frameworkBlock(fw, 1000);
  assert.match(block, /答案 A（约 550 字）/);
  const d = { subject: '题材', platform: 'xiaohongshu', tone: '实用干货', length: 1000, framework: fw };
  assert.ok(topicsUser(d, null, []).includes('本篇写法框架：SCQA 结构'));
  assert.ok(contentUser(d, { title: 't', angle: 'a', hook: 'h', outline: ['x'] }, null, []).includes('本篇写法框架'));
  assert.ok(!topicsUser({ ...d, framework: null }, null, []).includes('写法框架'));
});

test('我的框架增删改与草稿快照', () => {
  const u = Users.create('fw-user', 'x:y');
  const f = Frameworks.create(u.id, { name: 'A', slots: [{ role: '一', ratio: 0.5 }, { role: '二', ratio: 0.5 }] });
  assert.equal(f.key, `u:${f.id}`);
  Frameworks.markUsed(f.id, u.id);
  assert.equal(Frameworks.byId(f.id, u.id).used_count, 1);
  const d = Drafts.create(u.id, { subject: 's', platform: 'xiaohongshu', tone: 't', audience: '', keywords: '', length: 600 },
    null, null, null, null, frameworkSnapshot(f));
  Frameworks.remove(f.id, u.id);
  assert.equal(Drafts.byId(d.id, u.id).framework.name, 'A');       // 删了框架，历史稿件的快照还在
  const b = Drafts.create(u.id, { subject: 's', platform: 'xiaohongshu', tone: 't', audience: '', keywords: '', length: 600 },
    null, null, null, null, frameworkSnapshot({ key: 'b:scqa', name: 'SCQA', slots: [] }));
  assert.equal(Frameworks.builtinUsage(u.id)['b:scqa'], 1);
  assert.ok(b);
});
