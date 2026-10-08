import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_FRAMEWORKS, normalizeFramework, recommendFrameworks, frameworkBlock, frameworkSnapshot } from '../server/frameworks.js';
import { contentUser, topicsUser, PLATFORMS } from '../server/prompts.js';
import { Users, Frameworks, Drafts } from '../server/db.js';

test('内置框架：key 唯一、每个框架篇幅占比合计为 1、平台 key 都存在', async () => {
  const keys = new Set();
  for (const f of BUILTIN_FRAMEWORKS) {
    assert.ok(!keys.has(f.key), f.key); keys.add(f.key);
    const sum = f.slots.reduce((n, x) => n + x.ratio, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `${f.key} 合计 ${sum}`);
    for (const p of f.platforms) assert.ok(PLATFORMS[p], `${f.key} 平台 ${p}`);
    // 内置框架都补了详细解释和示例，作者点开就能照着学
    assert.ok(f.detail && f.detail.length >= 20, `${f.key} 缺详细解释`);
    assert.ok(f.example && f.example.length >= 20, `${f.key} 缺示例`);
  }
  assert.ok(BUILTIN_FRAMEWORKS.length >= 20);
});

test('清洗：占比归一化、空段丢掉、段数和名字校验', async () => {
  const f = normalizeFramework({ name: ' 我的框架 ', slots: [{ role: '开头', ratio: 1 }, { role: '', ratio: 5 }, { role: '主体', ratio: 3 }], platforms: ['xiaohongshu', 'nope'] }, Object.keys(PLATFORMS));
  assert.equal(f.name, '我的框架');
  assert.deepEqual(f.slots.map((x) => x.ratio), [0.25, 0.75]);
  assert.deepEqual(f.platforms, ['xiaohongshu']);
  assert.throws(() => normalizeFramework({ name: 'x', slots: [{ role: 'a' }] }), /至少/);
  assert.throws(() => normalizeFramework({ slots: [] }), /名字/);
});

test('清洗：detail 和 example 保留并截断', async () => {
  const long = 'x'.repeat(2000);
  const f = normalizeFramework({ name: 'F', detail: long, example: long, slots: [{ role: 'a', ratio: 1 }, { role: 'b', ratio: 1 }] }, Object.keys(PLATFORMS));
  assert.equal(f.detail.length, 1200);
  assert.equal(f.example.length, 2000);
  assert.equal(normalizeFramework({ name: 'F', slots: [{ role: 'a', ratio: 1 }, { role: 'b', ratio: 1 }] }, Object.keys(PLATFORMS)).detail, '');
});

test('推荐：别的平台专用的不推，本平台专用和场景命中的靠前', async () => {
  const list = BUILTIN_FRAMEWORKS.map((f) => ({ ...f, builtin: true, used_count: 0 }));
  const picks = recommendFrameworks(list, { platform: 'xiaohongshu', subject: '好物种草：周末备菜神器' });
  assert.equal(picks.length, 3);
  assert.equal(picks[0].key, 'b:xhs-seed');
  assert.ok(picks.every((f) => !f.platforms.length || f.platforms.includes('xiaohongshu')));
});

test('视频号：平台规范在，推荐时视频号专用框架排第一，短视频口播框架也能用', async () => {
  assert.equal(PLATFORMS.shipinhao.label, '视频号');
  assert.match(PLATFORMS.shipinhao.spec, /【口播】【画面】【字幕】/);
  const list = BUILTIN_FRAMEWORKS.map((f) => ({ ...f, builtin: true, used_count: 0 }));
  const picks = recommendFrameworks(list, { platform: 'shipinhao', subject: '孩子上小学前的经验' }, 5);
  assert.equal(picks[0].key, 'b:sph-view');
  assert.ok(picks.some((f) => f.key === 'b:dy-hook-3' || f.key === 'b:dy-story'));
  assert.ok(picks.every((f) => !f.platforms.length || f.platforms.includes('shipinhao')));
  assert.ok(!recommendFrameworks(list, { platform: 'douyin' }, 50).some((f) => f.key === 'b:sph-view'), '视频号专用框架不推给抖音');
});

test('框架块：按目标字数分配每段篇幅，拼进选题和成稿提示词', async () => {
  const fw = frameworkSnapshot(BUILTIN_FRAMEWORKS.find((f) => f.key === 'b:scqa'));
  const block = frameworkBlock(fw, 1000);
  assert.match(block, /答案 A（约 550 字）/);
  const d = { subject: '题材', platform: 'xiaohongshu', tone: '实用干货', length: 1000, framework: fw };
  assert.ok(topicsUser(d, null, []).includes('本篇写法框架：SCQA 结构'));
  assert.ok(contentUser(d, { title: 't', angle: 'a', hook: 'h', outline: ['x'] }, null, []).includes('本篇写法框架'));
  assert.ok(!topicsUser({ ...d, framework: null }, null, []).includes('写法框架'));
});

test('我的框架增删改与草稿快照', async () => {
  const u = await Users.create('fw-user', 'x:y');
  const f = await Frameworks.create(u.id, { name: 'A', slots: [{ role: '一', ratio: 0.5 }, { role: '二', ratio: 0.5 }] });
  assert.equal(f.key, `u:${f.id}`);
  await Frameworks.markUsed(f.id, u.id);
  assert.equal((await Frameworks.byId(f.id, u.id)).used_count, 1);
  const d = await Drafts.create(u.id, { subject: 's', platform: 'xiaohongshu', tone: 't', audience: '', keywords: '', length: 600 },
    null, null, null, null, frameworkSnapshot(f));
  await Frameworks.remove(f.id, u.id);
  assert.equal((await Drafts.byId(d.id, u.id)).framework.name, 'A');       // 删了框架，历史稿件的快照还在
  const b = await Drafts.create(u.id, { subject: 's', platform: 'xiaohongshu', tone: 't', audience: '', keywords: '', length: 600 },
    null, null, null, null, frameworkSnapshot({ key: 'b:scqa', name: 'SCQA', slots: [] }));
  assert.equal((await Frameworks.builtinUsage(u.id))['b:scqa'], 1);
  assert.ok(b);
});

import { copyOverlap } from '../server/frameworks.js';
import { withCopyCheck } from '../server/routes/review.js';
import { Sections, Personas } from '../server/db.js';

test('防洗稿：连续 8 字以上相同的片段被找出来，标点空白不算', async () => {
  const src = '周末花两个小时把一周的菜备好，工作日下班十五分钟就能吃上热饭。';
  const hits = copyOverlap('我也试过：周末花两个小时，把一周的菜备好！结果真的很香。', src);
  assert.deepEqual(hits, ['周末花两个小时把一周的菜备好']);
  assert.deepEqual(copyOverlap('完全不同的一段话，讲的是别的事情。', src), []);
});

test('检查里的防洗稿：用范文拆出来的框架时比对原文', async () => {
  const u = await Users.create('copy-user', 'x:y');
  const src = '第一段范文内容写得很好很长。第二段范文内容也写得很好。第三段范文内容同样出色。';
  const f = await Frameworks.create(u.id, { name: 'F', slots: [{ role: 'a', ratio: 0.5 }, { role: 'b', ratio: 0.5 }], source_text: src });
  const draft = { framework: { key: f.key } };
  const base = { flags: [], risk: '无', issues: [] };
  const out = await withCopyCheck(base, draft, '第一段范文内容写得很好很长，第二段范文内容也写得很好，第三段范文内容同样出色', u.id);
  assert.equal(out.flags[0].dimension, '原创度');
  assert.equal(out.flags[0].level, '高');
  assert.equal(out.risk, '高');
  assert.equal(await withCopyCheck(base, { framework: { key: 'b:scqa' } }, src, u.id), base);   // 内置框架没有范文
});

test('栏目可以设默认框架', async () => {
  const u = await Users.create('sec-user', 'x:y');
  const p = await Personas.create(u.id, { name: 'p', platform: 'xiaohongshu', tone: 't', content_focus: '', audience: '', problem: '', notes: '',
    creator_age: '', creator_gender: '', creator_industry: '', creator_role: '', creator_traits: '' });
  const s = await Sections.create(u.id, p.id, { name: '来时路', purpose: '', guide: '', fields: [], default_framework: 'b:story-three-act' });
  assert.equal(s.default_framework, 'b:story-three-act');
});

test('内置「课程稿：微课八步」：八段按模版顺序、占比合计 1、示例带互动标注', async () => {
  const { builtinOf } = await import('../server/frameworks.js');
  const f = builtinOf('b:micro-course');
  assert.ok(f, '没有课程稿框架');
  assert.deepEqual(f.slots.map((x) => x.role), ['破冰', '导入', '主题', '背景', '目录', '展开', '回顾', '结尾']);
  assert.ok(Math.abs(f.slots.reduce((n, x) => n + x.ratio, 0) - 1) < 1e-9);
  assert.ok(f.slots.every((x) => x.guide.length <= 200));
  assert.match(f.example, /停顿，等回应/);
  assert.ok(f.scenes.includes('课程'));
});

test('内置「信念萃取与植入」：讲话顺序、占比合计 1、示例先萃取四要素', async () => {
  const { builtinOf } = await import('../server/frameworks.js');
  const f = builtinOf('b:belief');
  assert.ok(f, '没有信念框架');
  assert.deepEqual(f.slots.map((x) => x.role), ['故事引入', '故事的结论', '问题行为', '理解背后信念', '扩大格局', '植入信念', '目标行为', '价值收尾']);
  assert.ok(Math.abs(f.slots.reduce((n, x) => n + x.ratio, 0) - 1) < 1e-9);
  assert.ok(f.slots.every((x) => x.guide.length <= 200));
  for (const k of ['问题行为', '背后信念', '目标行为', '植入信念']) assert.ok(f.example.includes(k), k);
});
