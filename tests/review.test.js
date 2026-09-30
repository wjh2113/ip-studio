import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanReview } from '../server/routes.js';

const text = '今天我们聊聊备菜。备菜可以节省时间。这是最好的方法。';

test('issues：quote 对不上原文的丢掉并计数，重复的只留一条', async () => {
  const r = cleanReview({
    issues: [
      { quote: '备菜可以节省时间', fix: '备菜能省时间', type: '重复啰嗦', why: 'x' },
      { quote: '原文里没有这句', fix: 'y', type: '错字' },
      { quote: '备菜可以节省时间', fix: '重复一条', type: '重复啰嗦' },
      { quote: '今天', fix: '今天', type: '错字' },            // 改了等于没改
    ],
    flags: [],
  }, text);
  assert.equal(r.issues.length, 1);
  assert.equal(r.dropped, 3);
});

test('flags：丢掉「低」和「先承认符合再转折」的凑数项，保留「不符合……但」', async () => {
  const r = cleanReview({
    issues: [],
    flags: [
      { dimension: '法律风险', level: '高', quote: '这是最好的方法', what: '广告法绝对化用语' },
      { dimension: '账号调性', level: '中', what: '内容符合账号定位，但可以更有趣' },
      { dimension: '平台调性', level: '中', what: '不符合平台规范，但问题不大' },
      { dimension: '公序良俗', level: '低', what: '可以更好' },
    ],
  }, text);
  assert.deepEqual(r.flags.map((f) => f.dimension), ['法律风险', '平台调性']);
  assert.equal(r.flags[0].locatable, true);
  assert.equal(r.padded, 2);
  assert.equal(r.risk, '高');
});

test('verdict 缺失时按有无问题推断', async () => {
  assert.equal(cleanReview({ issues: [], flags: [] }, text).verdict, 'ok');
});
