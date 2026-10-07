/* 从发布数据里学：标题类型、开头类型的判断，按类型分组比中位数，喂进选题和成稿提示词，「数据告诉我们」；
 * 以及语气档案每月定期梳理。 */
import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Drafts, Personas, Samples, Users, db } from '../server/db.js';
import { personas } from '../server/schema.js';
import { eq } from 'drizzle-orm';
import { dataFindings, performanceOf } from '../server/performance.js';
import { contentUser, performanceBlock } from '../server/prompts.js';
import { openingType, titleType } from '../server/shapes.js';
import { refreshDue } from '../server/learning.js';
import { Jobs } from '../server/db.js';
import { startQueue } from '../server/jobs.js';

await startQueue();          // 每月梳理会排任务：要有队列（测试用独立的 Redis 前缀）

const user = await Users.create('data-user', 'x:y');
const persona = await Personas.create(user.id, {
  name: '数据号', platform: 'gongzhonghao', tone: '实用干货', content_focus: '', audience: '', problem: '', notes: '',
  creator_age: '', creator_gender: '', creator_industry: '', creator_role: '', creator_traits: '',
});

test('标题类型：提问 > 数字 > 反差 > 亲历 > 直给', () => {
  assert.equal(titleType('为什么 3 个人的团队反而更快？'), '提问式');
  assert.equal(titleType('带团队的 5 个教训'), '数字清单');
  assert.equal(titleType('不是你不努力，而是方向错了'), '反差对比');
  assert.equal(titleType('我第一次当组长那年'), '亲历讲述');
  assert.equal(titleType('管理就是翻译'), '直给观点');
  assert.equal(titleType(''), '');
});

test('开头类型：看正文第一段的第一句，跳过标题行', () => {
  assert.equal(openingType('# 标题\n\n你有没有想过，为什么周报总写不完？后来我想明白了。'), '抛出问题');
  assert.equal(openingType('# 标题\n\n去年冬天的一个晚上，我在公司加班到十一点。'), '场景故事');
  assert.equal(openingType('# 标题\n\n73% 的新经理在第一年会想辞职。这是一个调查。'), '数据事实');
  assert.equal(openingType('# 标题\n\n管理就是翻译。把老板的话翻成团队听得懂的话。'), '观点先行');
  assert.equal(openingType('# 标题\n\n这篇想聊聊带团队这件事，主要是这几年自己踩过的一些坑和一些想法。'), '直接切入');
  assert.equal(openingType(''), '');
});

async function published(title, opening, views) {
  const d = await Drafts.create(user.id, { subject: title, platform: 'gongzhonghao', tone: '实用干货', audience: '', keywords: '', length: 800 }, persona);
  await Drafts.setContent(d.id, user.id, { chosen: null, title, content: `# ${title}\n\n${opening}\n\n正文。`, status: 'done' });
  await Drafts.setMetrics(d.id, user.id, { views }, '2026-09-01');
  return d;
}

test('发布数据：不够 6 篇什么都不说；够了按标题、开头分组比中位数', async () => {
  for (const v of [900, 1000, 1100]) await published(`为什么要${v}？`, '去年冬天的一个晚上，我还在加班。', v * 3);
  assert.equal((await performanceOf(user.id, persona.id)).enough, false);
  assert.deepEqual(dataFindings(await performanceOf(user.id, persona.id)).lines, []);
  for (const v of [900, 1000, 1100]) await published(`管理就是第${v}种翻译`, '这篇想聊聊这些年带团队时自己踩过的一些坑和想法。', v);

  const perf = await performanceOf(user.id, persona.id);
  assert.equal(perf.enough, true);
  assert.equal(perf.n, 6);
  assert.equal(perf.byTitle['提问式'].n, 3);
  assert.equal(perf.byOpening['场景故事'].median, 3000);
  assert.ok(perf.byOpening['场景故事'].lift > 1.3);
  assert.ok(perf.byOpening['直接切入'].lift < 0.7);

  const f = dataFindings(perf);
  assert.ok(f.lines.some((l) => /开头用「场景故事」/.test(l.text)), JSON.stringify(f.lines));
  assert.ok(f.lines.some((l) => /标题用「提问式」/.test(l.text)));

  // 选题提示词带标题写法；成稿提示词带开头方式，而且有「方向优先」的话
  const topics = performanceBlock(perf, 'topics');
  assert.match(topics, /数据好的标题写法：「提问式」/);
  const content = performanceBlock(perf, 'content');
  assert.match(content, /数据好的开头方式：「场景故事」/);
  assert.match(content, /数据弱的开头方式：「直接切入」/);
  assert.match(content, /开篇钩子和事实要求优先/);
  const prompt = contentUser({ subject: 's', platform: 'gongzhonghao', tone: '', length: 800 }, { title: 't', angle: 'a', hook: 'h', outline: [] }, null, [], [], null, content);
  assert.match(prompt, /数据好的开头方式/);
});

test('每月定期梳理：上次从头梳理过了一个月、之后又加了样本的号才排', async () => {
  const long = '带团队这件事，我想了很久。'.repeat(12);
  await Samples.create(user.id, persona.id, { title: '一', content: long });
  await Personas.setDigest(persona.id, user.id, '旧档案', { fullCount: 1 });
  assert.equal(await refreshDue(), 0);                         // 刚梳理过
  await Samples.create(user.id, persona.id, { title: '二', content: long });
  assert.equal(await refreshDue(), 0);                         // 有新样本，但还没到一个月
  const old = new Date(Date.now() - 40 * 86400_000).toISOString();
  await db.update(personas).set({ digest_full_at: old, style_updated_at: old }).where(eq(personas.id, persona.id));
  assert.equal(await refreshDue(), 1);
  const job = await Jobs.activeByRef(user.id, `learn:${persona.id}:rebuild`);
  assert.ok(job, '没排上梳理任务');
  assert.equal(job.payload.reason, '每月定期梳理');
  // 关了自动学习的不排
  await Personas.setAutoLearn(persona.id, user.id, false);
  assert.equal(await refreshDue(), 0);
});
