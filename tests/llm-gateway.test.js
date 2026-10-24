/* 网关通道：模型列表、指定模型 / 自动选路时发给网关的请求体、流末尾的实际模型。用本地假网关测，不连外网 */
import http from 'node:http';

const bodies = [];
const gateway = http.createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  if (req.method === 'GET' && req.url === '/api/ai/models') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: [
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', capabilities: ['quality-chat'], available: true },
      { id: 'deepseek-v4-pro', name: '重复的', available: true },
      { id: 'kimi-k3', name: '', available: false },
    ] }));
    return;
  }
  const json = JSON.parse(body);
  bodies.push({ auth: req.headers.authorization, ...json });
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '你好' } }] })}\n\n`);
  res.write(`data: ${JSON.stringify({ gateway: { model: json.model || 'auto-picked-model', provider: 'x' } })}\n\n`);
  res.end('data: [DONE]\n\n');
});
await new Promise((r) => gateway.listen(0, '127.0.0.1', r));
Object.assign(process.env, {
  LLM_PROVIDER: 'gateway', LLM_GATEWAY_API_KEY: 'tenant-key',
  LLM_GATEWAY_URL: `http://127.0.0.1:${gateway.address().port}`,
});
await import('./setup.js');

const test = (await import('node:test')).default;
const assert = (await import('node:assert/strict')).default;
const llm = await import('../server/llm.js');

test.after(() => gateway.close());

test('模型列表：带租户 Key 取，按 id 去重，没名字用 id，available 照抄', async () => {
  const list = await llm.listModels({ fresh: true });
  assert.deepEqual(list, [
    { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', available: true },
    { id: 'kimi-k3', name: 'kimi-k3', available: false },
  ]);
});

test('指定模型：只发 model、fallback=false，不带 capability；回调拿到网关实际用的模型', async () => {
  let served = '';
  const text = await llm.streamText({
    system: 's', user: 'u', onDelta() {}, mock: () => '',
    meta: { feature: '编辑器对话', model: 'deepseek-v4-pro' }, onServed: (m) => { served = m; },
  });
  assert.equal(text, '你好');
  const b = bodies.at(-1);
  assert.equal(b.auth, 'Bearer tenant-key');
  assert.equal(b.model, 'deepseek-v4-pro');
  assert.equal(b.fallback, false);
  assert.equal(b.capability, undefined);
  assert.equal(served, 'deepseek-v4-pro');
});

test('自动：不带 model，按档位带 capability、fallback=true', async () => {
  let served = '';
  await llm.streamText({ system: 's', user: 'u', onDelta() {}, mock: () => '', meta: { feature: '编辑器对话' }, onServed: (m) => { served = m; } });
  const b = bodies.at(-1);
  assert.equal(b.model, undefined);
  assert.equal(b.capability, 'quality-chat');
  assert.equal(b.fallback, true);
  assert.equal(served, 'auto-picked-model');
});
