import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { scanLexicon, mergeLexicon } from '../server/lexicon.js';

test('严格词报高，宽口径词报中，日常搭配不报', async () => {
  const hits = scanLexicon('这是史上最好用的锅。你最好先备菜。第一次做也不怕，我们是第一品牌。');
  const byWord = Object.fromEntries(hits.map((h) => [h.quote, h.level]));
  assert.equal(byWord['史上最'], '高');
  assert.equal(byWord['第一'], '中');                 // 「第一品牌」
  assert.ok(!hits.some((h) => h.quote === '最好'));    // 「最好先」是日常说法
});

test('医疗、收益承诺报高', async () => {
  const q = scanLexicon('喝了能降血压，理财稳赚不赔').map((h) => h.rule);
  assert.ok(q.includes('medical'));
  assert.ok(q.includes('finance'));
});

test('站外引流：公众号不报，小红书报', async () => {
  assert.equal(scanLexicon('需要的加我微信', { platform: 'gongzhonghao' }).length, 0);
  assert.equal(scanLexicon('需要的加我微信', { platform: 'xiaohongshu' })[0].rule, 'diversion');
});

test('并进模型结果：不重复、重算风险', async () => {
  const review = { flags: [{ dimension: '法律风险', level: '中', quote: '史上最好用', what: '绝对化' }], risk: '中' };
  const out = mergeLexicon(review, '史上最好用。喝了能根治失眠。', {});
  assert.equal(out.flags.filter((f) => f.quote === '史上最').length, 0);   // 模型已报过
  assert.ok(out.flags.some((f) => f.quote === '根治'));
  assert.equal(out.risk, '高');
});
