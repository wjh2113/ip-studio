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
    await Drafts.setTopics(d.id, u.id, [{ label, title: `标题${views}`, chosen: true }], null);
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
  assert.match(block, /不要为了套类型硬凑/);
});
