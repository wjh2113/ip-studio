import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { scriptLanguage, cueLook, isAudioOnly, settleReview, applyDim, scoreAppearance } from '../server/speak.js';

test('语种：假名→ja，拉丁字母明显多→en，其余→zh', async () => {
  assert.equal(scriptLanguage('こんにちは、今日は'), 'ja');
  assert.equal(scriptLanguage('This is a simple English script for testing'), 'en');
  assert.equal(scriptLanguage('今天聊聊 AI 备菜'), 'zh');
});

test('出镜 text 只带出镜提醒、表情、动作，不带稿子正文', async () => {
  const cues = { overall: { note: '看镜头' }, cues: [
    { quote: '稿子正文', expression: '挑眉', gesture: '' },
    { quote: '第二句', expression: '', gesture: '' },
  ] };
  const t = cueLook(cues, 'zh');
  assert.equal(t, '出镜提醒：看镜头\n表情：挑眉');
  assert.ok(!t.includes('稿子正文'));
  assert.equal(cueLook(null, 'en'), 'none');
});

test('纯音频识别', async () => {
  assert.equal(isAudioOnly('audio/webm', 'a.webm'), true);
  assert.equal(isAudioOnly('video/webm', 'a.webm'), false);
  assert.equal(isAudioOnly('', 'a.m4a'), true);
});

test('纯音频做出镜评测：400，不编分（演示模式也一样）', async () => {
  await assert.rejects(
    scoreAppearance({ buffer: Buffer.from('x'), mime: 'audio/webm', filename: 'a.webm', script: '今天' }),
    (e) => e.status === 400,
  );
});

test('总分按权重重算，没测的发音、出镜保持 null 且不计入', async () => {
  const r = settleReview({ dims: [
    { key: '完整', score: 80 }, { key: '节奏', score: 60 }, { key: '表达', score: 70 },
    { key: '发音', score: 99 }, { key: '出镜', score: 99 },
  ] }, '稿子', null);
  assert.equal(r.dims.find((d) => d.key === '发音').score, null);   // 模型猜的发音分不采用
  assert.equal(r.dims.find((d) => d.key === '出镜').score, null);
  assert.equal(r.score, Math.round((80 * 25 + 60 * 20 + 70 * 20) / 65));
});

test('applyDim：出镜 null 是合法结果，不当 0 分', async () => {
  const base = settleReview({ dims: [{ key: '完整', score: 80 }] }, '稿子', null);
  const next = applyDim(base, '出镜', null, '没有看到出镜的人');
  assert.equal(next.dims.find((d) => d.key === '出镜').score, null);
  assert.equal(next.score, 80);
});
