import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { adoption, editRatio, sentences } from '../server/quality.js';

test('切句：中英文句末标点和换行，去掉标题符号', async () => {
  assert.deepEqual(sentences('# 标题\n第一句。第二句！Third?\n\n最后'), ['标题', '第一句。', '第二句！', 'Third?', '最后']);
});

test('改动比例：原样 0，全换 1，改一句按那句的字数算', async () => {
  const g = '# 周末备菜\n第一句话写在这里。第二句话写在这里。第三句话比较长一点写在这里。';
  assert.equal(editRatio(g, g), 0);
  assert.equal(editRatio(g, '完全不一样的内容。'), 1);
  const r = editRatio(g, g.replace('第二句话写在这里。', '第二句我改过了。'));
  assert.ok(r > 0 && r < 0.4, String(r));
  assert.equal(editRatio('', 'x'), null);
});

test('采纳：原句不在了算改了，建议的写法出现了算照着改', async () => {
  const issues = [{ quote: '非常非常好', fix: '很好' }, { quote: '错别子', fix: '错别字' }, { quote: '没动的', fix: '改成这样' }];
  const got = adoption(issues, '这个很好。这里有错别字吗。没动的还在。');
  assert.deepEqual(got, { total: 3, changed: 2, applied: 2 });
});

test('发布数据进推荐：样本不够不说话；够了按中位数给框架加减分、给提示词一段资料', async () => {
  const { Drafts, Metrics, Users } = await import('../server/db.js');
  const { performanceOf, frameworkBonus } = await import('../server/performance.js');
  const { performanceBlock } = await import('../server/prompts.js');
  const u = await Users.create('perf-user', 'x:y');
  const mk = async (fw, label, views) => {
    const d = await Drafts.create(u.id, { subject: `题材${views}`, platform: 'xiaohongshu', tone: 't', audience: '', keywords: '', length: 600 },
      null, null, null, null, fw ? { key: fw, name: fw, slots: [] } : null);
    // 和线上一样：方向对象上没有 chosen 字段，用的是第几个方向记在 drafts.chosen。
    // 选的是第二个方向；第一个方向的类型是个诱饵，统计时不能算到它头上
    await Drafts.setTopics(d.id, u.id, [{ label: '诱饵', title: '不是这个' }, { label, title: `标题${views}` }], null);
    await Drafts.setContent(d.id, u.id, { chosen: 1, title: `标题${views}`, content: '正文', status: 'done' });
    await Drafts.setMetrics(d.id, u.id, { views }, '2026-09-01');
    await Metrics.put(d.id, u.id, { platform: 'xiaohongshu', capturedOn: '2026-09-02', values: { views } });
  };
  await mk('b:a', '反常识', 5000);
  await mk('b:a', '反常识', 6000);
  assert.equal((await performanceOf(u.id)).enough, false);
  assert.equal(performanceBlock(await performanceOf(u.id)), '');
  await mk('b:a', '反常识', 7000);
  await mk('b:b', '清单', 800);
  await mk('b:b', '清单', 900);
  await mk('b:b', '清单', 1000);
  const perf = await performanceOf(u.id);
  assert.equal(perf.enough, true);
  assert.equal(perf.byFramework['b:a'].n, 3);
  assert.ok(frameworkBonus(perf, 'b:a') > 0);
  assert.ok(frameworkBonus(perf, 'b:b') < 0);
  assert.equal(frameworkBonus(perf, 'b:none'), 0);
  const block = performanceBlock(perf, 'topics');
  assert.match(block, /<performance>[\s\S]*「反常识」[\s\S]*<\/performance>/);
  assert.match(block, /数据弱的方向类型：「清单」/);
  assert.ok(!perf.byLabel['诱饵'], '按方向类型分组用错了方向');
  assert.match(block, /不要为了套类型硬凑/);
});

test('用的哪个方向：看 drafts.chosen 的下标，没选过就不归类', async () => {
  const { chosenTopic } = await import('../server/performance.js');
  const topics = JSON.stringify([{ label: '甲' }, { label: '乙' }]);
  assert.equal(chosenTopic({ topics_json: topics, chosen: 1 }).label, '乙');
  assert.equal(chosenTopic({ topics_json: topics, chosen: 0 }).label, '甲');
  assert.equal(chosenTopic({ topics_json: topics, chosen: null }), null);
  assert.equal(chosenTopic({ topics_json: topics, chosen: 5 }), null);
  assert.equal(chosenTopic({ topics_json: 'oops', chosen: 0 }), null);
});

test('成稿失败：有正文就恢复原样，第一次生成才退回选方向', async () => {
  const { Drafts, Users } = await import('../server/db.js');
  const { restoreAfterFailure } = await import('../server/routes/drafts.js');
  const u = await Users.create('restore-user', 'x:y');
  const d = await Drafts.create(u.id, { subject: 's', platform: 'xiaohongshu', tone: 't', audience: '', keywords: '', length: 600 });
  await Drafts.setTopics(d.id, u.id, [{ label: 'a', title: 'A' }, { label: 'b', title: 'B' }], null);
  await Drafts.setContent(d.id, u.id, { chosen: 0, title: 'A', content: '# A\n\n写好的正文', status: 'done' });
  const before = await Drafts.byId(d.id, u.id);
  // 重新生成：开始时清空、标成 writing，然后失败了
  await Drafts.setContent(d.id, u.id, { chosen: 1, title: 'B', content: '', status: 'writing' });
  assert.equal(await restoreAfterFailure(d.id, u.id, { chosen: before.chosen, title: before.title, content: before.content, status: before.status }, 1), true);
  const after = await Drafts.byId(d.id, u.id);
  assert.equal(after.content, '# A\n\n写好的正文');
  assert.equal(after.chosen, 0);
  assert.equal(after.status, 'done');
  // 第一次生成就失败：退回选方向
  const d2 = await Drafts.create(u.id, { subject: 's2', platform: 'xiaohongshu', tone: 't', audience: '', keywords: '', length: 600 });
  await Drafts.setContent(d2.id, u.id, { chosen: 0, title: 'A', content: '', status: 'writing' });
  await restoreAfterFailure(d2.id, u.id, { chosen: null, title: '', content: '', status: 'topics' }, 0);
  const again = await Drafts.byId(d2.id, u.id);
  assert.equal(again.status, 'topics');
  assert.equal(again.chosen, null);
  // 生成期间另一个标签页保存了正文：失败后不能拿旧快照覆盖它
  await Drafts.setContent(d.id, u.id, { chosen: 1, title: 'B', content: '', status: 'writing' });
  await Drafts.saveContent(d.id, u.id, '另一个标签页刚存的', { snapshot: true });
  assert.equal(await restoreAfterFailure(d.id, u.id, { chosen: 0, title: 'A', content: '# A\n\n写好的正文', status: 'done' }, 1), false);
  assert.equal((await Drafts.byId(d.id, u.id)).content, '另一个标签页刚存的');
});
