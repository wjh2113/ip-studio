import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { scriptLanguage, cueLook, isAudioOnly, settleReview, applyDim, scoreAppearance } from '../server/speak.js';
import { sceneNotes } from '../web/src/lib/scenes.js';

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

test('拍摄标注：【画面】【字幕】挂到后面那一段口播上，最后的放 tail；不念的不进提示', async () => {
  const text = '【画面】博主出镜，字幕弹出：别等\n\n【口播】别等数据治理做完再上大模型。\n\n【画面】字幕：中台建完了\n\n【口播】上次流行这句话。结果中台建完了。\n\n【字幕】 \n\n【转场】黑场';
  const cues = [{ quote: '别等数据治理做完再上大模型。' }, { quote: '上次流行这句话。' }, { quote: '结果中台建完了。' }, { quote: '不在稿子里' }];
  const sc = sceneNotes(text, cues);
  assert.deepEqual(sc.before[0], [{ tag: '画面', text: '博主出镜，字幕弹出：别等' }]);
  assert.deepEqual(sc.before[1], [{ tag: '画面', text: '字幕：中台建完了' }]);
  assert.deepEqual(sc.before[2], []);
  assert.deepEqual(sc.tail, [{ tag: '转场', text: '黑场' }]);     // 空的【字幕】不算
  assert.deepEqual(sceneNotes('没有标注的稿子', cues).tail, []);
});
