import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanTitles } from '../server/routes/publish.js';
import { titlesUser, TITLE_LIMITS } from '../server/prompts.js';

test('标题候选：去掉和现在一样的与重复的、去掉 # 前缀、按字符计数并标出超限和违禁词', async () => {
  const out = cleanTitles({ titles: [
    { text: '现在的标题', type: '数字型', why: 'x' },
    { text: '# 周末备菜 3 步走', type: '数字型', why: 'a' },
    { text: '周末备菜 3 步走', type: '数字型', why: 'dup' },
    { text: '这是史上最省事的备菜法，真的一点都不难学会', type: '结果型', why: 'b' },
    { text: '不是标题党', type: '乱写', why: 'c' },
  ] }, { current: '现在的标题', limit: 20 });
  assert.deepEqual(out.map((t) => t.text), ['周末备菜 3 步走', '这是史上最省事的备菜法，真的一点都不难学会', '不是标题党']);
  assert.equal(out[1].over, true);
  assert.deepEqual(out[1].risk, ['史上最']);
  assert.equal(out[2].type, '');
});

test('标题提示词带平台字数上限', async () => {
  assert.equal(TITLE_LIMITS.xiaohongshu, 20);
  assert.match(titlesUser({ platform: 'xiaohongshu', title: 't' }, null, '正文'), /不超过 20 字/);
});
