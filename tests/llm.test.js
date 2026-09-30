/* 真实通道的行为（超时、中断计费）用本地假上游测，不连外网 */
import http from 'node:http';

let mode = 'hang';
const upstream = http.createServer((req, res) => {
  if (mode === 'hang') return;                         // 永远不回
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const chunk = (t) => res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`);
  chunk('这是一段'.repeat(50));                         // 200 字后断开
  setTimeout(() => res.destroy(), 30);
});
await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
Object.assign(process.env, {
  LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'test', OPENAI_BASE_URL: `http://127.0.0.1:${upstream.address().port}/v1`,
  LLM_TIMEOUT_MS: '800', LLM_STREAM_TIMEOUT_MS: '1000',
});
await import('./setup.js');

const test = (await import('node:test')).default;
const assert = (await import('node:assert/strict')).default;
const llm = await import('../server/llm.js');
const { describe } = await import('../server/routes.js');
const { Users } = await import('../server/db.js');
const { snapshot } = await import('../server/quota.js');

test.after(() => upstream.close());

test('非流式调用按时超时，提示「模型响应超时」', async () => {
  mode = 'hang';
  const t = Date.now();
  await assert.rejects(llm.generateText({ system: 's', user: 'u', mock: () => '' }), (e) => describe(e) === '模型响应超时，请稍后再试');
  assert.ok(Date.now() - t < 3000);
});

test('流式调用按时超时', async () => {
  mode = 'hang';
  await assert.rejects(llm.streamText({ system: 's', user: 'u', onDelta() {}, mock: () => '' }), (e) => describe(e) === '模型响应超时，请稍后再试');
});

test('流式中途断开：按已收到的字数扣点', async () => {
  mode = 'partial';
  const u = Users.create('stream-user', 'x:y');
  let got = '';
  await assert.rejects(llm.streamText({
    system: 's'.repeat(1000), user: 'u', onDelta: (t) => { got += t; }, mock: () => '',
    meta: { feature: '成稿', userId: u.id },
  }));
  assert.equal(got.length, 200);
  assert.ok(snapshot(u.id).used > 0, '中断的调用也要扣点');
});
