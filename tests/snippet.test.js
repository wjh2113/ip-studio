import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { packMaterial, relevantSnippet } from '../server/snippet.js';
import { isStructuralRevise } from '../server/prompts.js';
import { resolveCueQuote } from '../server/routes/speak.js';

test('relevantSnippet：长文只截最相关的一段', () => {
  const body = `${'甲'.repeat(200)}周末备菜三步搞定省时又省钱${'乙'.repeat(200)}无关的结尾废话`;
  const snip = relevantSnippet(body, '备菜 省时', 40);
  assert.ok(snip.length <= 42); // 可能带省略号
  assert.match(snip, /备菜|省时/);
});

test('packMaterial：有摘要时用摘要，否则用相关片段', () => {
  const withSum = packMaterial({ title: 't', body: 'x'.repeat(2000), summary: '一句摘要' }, '备菜');
  assert.equal(withSum.body, '一句摘要');
  const long = packMaterial({ title: 't', body: `${'前'.repeat(300)}关键词命中处${'后'.repeat(300)}` }, '关键词命中', 50);
  assert.ok(long.body.length <= 52);
  assert.match(long.body, /关键词命中/);
});

test('isStructuralRevise：局部意见走补丁，结构意见走整篇', () => {
  assert.equal(isStructuralRevise('结尾别喊口号'), false);
  assert.equal(isStructuralRevise('把第二段的「赋能」删掉'), false);
  assert.equal(isStructuralRevise('整篇换语气，改成轻松幽默'), true);
  assert.equal(isStructuralRevise('重排一下顺序'), true);
});

test('resolveCueQuote：用 head/tail 截出整段，兼容旧 quote', () => {
  const text = '第一句开场白。中间还有一句。最后收束。';
  assert.equal(resolveCueQuote({ head: '第一句', tail: '开场白。' }, text), '第一句开场白。');
  assert.equal(resolveCueQuote({ head: '中间还有一句。', tail: '中间还有一句。' }, text), '中间还有一句。');
  assert.equal(resolveCueQuote({ quote: '最后收束。' }, text), '最后收束。');
  assert.equal(resolveCueQuote({ head: '没有', tail: '这段' }, text), '');
});

test('resolveCueQuote：按顺序找（同样的开头落到后面那段）；不跨【画面】、不截超长段', () => {
  const text = '好，我们开始。第一段讲背景。\n\n好，我们开始。第二段讲方法。';
  const first = text.indexOf('第一段讲背景。') + '第一段讲背景。'.length;
  assert.equal(resolveCueQuote({ head: '好，我们开始。', tail: '第二段讲方法。' }, text, first), '好，我们开始。第二段讲方法。');
  const script = '【口播】先说结论。\n【画面】切到图表\n【口播】再讲原因。';
  assert.equal(resolveCueQuote({ head: '先说结论。', tail: '再讲原因。' }, script), '');
  const long = `开头${'很长'.repeat(400)}结尾。`;
  assert.equal(resolveCueQuote({ head: '开头', tail: '结尾。' }, long), '');
});
