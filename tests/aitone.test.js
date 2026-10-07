/* AI 味扫描：规则命中、只看最后一段的升华、整体节奏；并进成稿检查时不重复、不抬风险等级 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeAiTone, scanAiTone } from '../server/aitone.js';
import { ASSIST_ACTIONS, ASSIST_SYSTEM, CONTENT_SYSTEM, HUMAN_STYLE } from '../server/prompts.js';

const AI = `在当今快节奏的时代，很多事情都在变。

首先，我们要明白时间管理至关重要，它能为个人成长赋能。其次，要学会拒绝。最后，要坚持复盘。

总而言之，时间是公平的，时间是有限的，时间是宝贵的。

让我们一起成为更好的自己，未来可期！`;

test('套话开头、AI 腔词、模板连接、排比、升华结尾都能标出来', () => {
  const flags = scanAiTone(AI);
  const rules = new Set(flags.map((f) => f.rule));
  for (const k of ['cliche-open', 'ai-words', 'connectors', 'first-then', 'parallel', 'uplift']) assert.ok(rules.has(k), `没标出 ${k}：${[...rules]}`);
  assert.ok(flags.every((f) => f.dimension === 'AI 味' && f.source === '规则'));
  assert.ok(flags.filter((f) => f.quote).every((f) => AI.includes(f.quote)));
  assert.ok(flags.length <= 12);
});

test('人话不误报；「让我们」只在结尾才算升华', () => {
  const human = `去年冬天的一个晚上，我在公司加班到十一点。\n\n老板路过说了句「别这么晚」，我愣了一下。\n\n后来我想明白了：他不在乎我多累，在乎的是结果别让他担心。让我们组的人都按时下班，是我那年做的最对的一件事。\n\n明天开始，把加班换成交付。`;
  assert.deepEqual(scanAiTone(human), []);
});

test('段落长短太整齐也提醒', () => {
  const para = '这一段写的是一件很普通的事情，长度和别的段落差不多，读起来像是一段一段填出来的样子。';
  const flags = scanAiTone(Array(6).fill(para).join('\n\n'));
  assert.ok(flags.some((f) => f.rule === 'even' && !f.quote));
});

test('并进检查结果：模型报过的不重复，风险等级不变', () => {
  const review = { flags: [{ dimension: '平台调性', level: '中', quote: '在当今快节奏的时代' }], risk: '中', issues: [] };
  const out = mergeAiTone(review, AI);
  assert.equal(out.risk, '中');
  assert.equal(out.flags.filter((f) => f.quote === '在当今快节奏的时代').length, 1);
  assert.equal(out.aiTone, out.flags.length - 1);
});

test('成稿和改写的提示词带上去 AI 味的要求；划词菜单有「去 AI 味」', () => {
  assert.ok(CONTENT_SYSTEM.includes(HUMAN_STYLE));
  assert.ok(ASSIST_SYSTEM.includes(HUMAN_STYLE));
  assert.equal(ASSIST_ACTIONS.humanize.mode, 'replace');
  assert.match(ASSIST_ACTIONS.humanize.instruction, /事实、数字、观点一个都不改/);
});
