/* 真实通道的行为（超时、中断计费）用本地假上游测，不连外网 */
import http from 'node:http';

let mode = 'hang';
let lastModel = '';
const upstream = http.createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  try { lastModel = JSON.parse(body).model; } catch { /* 忽略 */ }
  if (mode === 'hang') return;                         // 永远不回
  if (mode === 'ok') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: '{"ok":1}' } }], usage: { prompt_tokens: 1000, completion_tokens: 1000 } }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const chunk = (t) => res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`);
  chunk('这是一段'.repeat(50));                         // 200 字后断开
  setTimeout(() => res.destroy(), 30);
});
await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
Object.assign(process.env, {
  LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'test', OPENAI_BASE_URL: `http://127.0.0.1:${upstream.address().port}/v1`,
  LLM_TIMEOUT_MS: '800', LLM_STREAM_TIMEOUT_MS: '1000', OPENAI_MODEL_FAST: 'fast-model',
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
  const u = await Users.create('stream-user', 'x:y');
  let got = '';
  await assert.rejects(llm.streamText({
    system: 's'.repeat(1000), user: 'u', onDelta: (t) => { got += t; }, mock: () => '',
    meta: { feature: '成稿', userId: u.id },
  }));
  assert.equal(got.length, 200);
  assert.ok((await snapshot(u.id)).used > 0, '中断的调用也要扣点');
});

test('按功能分档：结构化的选题走 fast 模型，语气档案走主模型', async () => {
  mode = 'ok';
  await llm.generateJSON({ system: 's', user: 'u', schema: {}, mock: () => ({}), meta: { feature: '选题方向' } });
  assert.equal(lastModel, 'fast-model');
  await llm.generateText({ system: 's', user: 'u', mock: () => '', meta: { feature: '语气档案' } });
  assert.equal(lastModel, 'deepseek-chat');
  await llm.generateJSON({ system: 's', user: 'u', schema: {}, mock: () => ({}), meta: { feature: '口播总评' } });
  assert.equal(lastModel, 'deepseek-chat');
});

test('额度预扣后按实际结算：2000 token = 1 点', async () => {
  mode = 'ok';
  const u = await Users.create('settle-user', 'x:y');
  await llm.generateJSON({ system: 's', user: 'u', schema: {}, mock: () => ({}), meta: { feature: '选题方向', userId: u.id } });
  assert.equal((await snapshot(u.id)).used, 1);
});

test('同一用户同时最多 3 个生成；失败的调用退回预扣', async () => {
  mode = 'hang';
  const u = await Users.create('busy-user', 'x:y');
  const call = async () => llm.generateText({ system: 's', user: 'u', mock: () => '', meta: { feature: '语气档案', userId: u.id } });
  const running = [call(), call(), call()];
  for (let i = 0; i < 50 && (await snapshot(u.id)).used !== 15; i += 1) {
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.equal((await snapshot(u.id)).used, 15);                       // 3 × 预扣 5 点
  await assert.rejects(call(), (e) => e.status === 429);
  await Promise.allSettled(running);                            // 都超时失败
  assert.equal((await snapshot(u.id)).used, 0);                         // 全部退回
});
