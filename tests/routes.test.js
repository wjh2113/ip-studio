/* 接口冒烟测试：真的把服务起起来，走一遍用户会走的路。
 *
 * 为什么要有：数据层从同步改成异步时漏了几个 await（划词改写、配图、口播上传、语气档案、后台设置），
 * 单测全绿，接口却是坏的——单测只测了数据层和纯函数，没人真的调过这些接口。
 * 这里起一个子进程跑 server/index.js：演示模式、独立 schema、不读 .env（ENV_FILE=none）。 */
import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fromRoot } from '../server/paths.js';

const PORT = 20000 + (process.pid % 20000);
const BASE = `http://127.0.0.1:${PORT}`;
let child;
let log = '';

function startServer() {
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    // pg 在连接串没写用户名时会用 USER；子进程环境必须带上，否则会报
    // 「no PostgreSQL user name specified in startup packet」
    USER: process.env.USER,
    LOGNAME: process.env.LOGNAME,
    ENV_FILE: 'none',
    NODE_ENV: 'test',
    PORT: String(PORT),
    HOST: '127.0.0.1',
    DATABASE_URL: process.env.DATABASE_URL,
    DB_SCHEMA: process.env.DB_SCHEMA,
    REDIS_URL: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
    DATA_DIR: process.env.DATA_DIR,
    DB_PATH: process.env.DB_PATH,
    LLM_PROVIDER: 'mock',
    IMAGE_PROVIDER: 'mock',
    PAY_PROVIDER: 'mock',
    ALLOW_SELF_UPGRADE: '1',
  };
  child = spawn(process.execPath, [fromRoot('server/index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = async () => {
      try {
        const r = await fetch(`${BASE}/health`);
        if (r.ok) return resolve();
      } catch { /* 还没起来 */ }
      if (child.exitCode != null) return reject(new Error(`服务没起来：\n${log}`));
      if (Date.now() - started > 20_000) return reject(new Error(`服务 20 秒没起来：\n${log}`));
      setTimeout(tick, 150);
    };
    tick();
  });
}

/* 一个带 cookie 的小客户端 */
function client() {
  const jar = new Map();
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const keep = (res) => {
    for (const c of res.headers.getSetCookie?.() || []) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
  };
  async function call(method, path, body, headers = {}) {
    const isRaw = body instanceof Uint8Array;
    const res = await fetch(BASE + path, {
      method,
      headers: { cookie: cookie(), ...(body && !isRaw ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body == null ? undefined : (isRaw ? body : JSON.stringify(body)),
    });
    keep(res);
    const text = await res.text();
    let data = text;
    try { data = JSON.parse(text); } catch { /* 流式或文本 */ }
    return { status: res.status, data, text, headers: res.headers };
  }
  return { call, cookieHeader: cookie };
}

async function untilJob(api, id, ms = 10_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const { data } = await api.call('GET', `/api/jobs/${id}`);
    if (!['queued', 'running'].includes(data.job?.status)) return data.job;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`任务 ${id} 没在 ${ms}ms 内做完`);
}

const api = client();
let draftId;

test('起服务', { timeout: 30_000 }, async () => {
  await startServer();
});

test('注册、升级、出三个方向、流式成稿', async () => {
  let r = await api.call('POST', '/api/auth/register', { username: `rt${process.pid}`, password: 'secret123' });
  assert.equal(r.status, 200, r.text);
  r = await api.call('POST', '/api/plan', { plan: 'pro' });
  assert.equal(r.status, 200, r.text);
  r = await api.call('POST', '/api/drafts/topics', { subject: '周末备菜', platform: 'gongzhonghao', tone: '实用干货', length: 1500 });
  assert.equal(r.status, 200, r.text);
  draftId = r.data.draft.id;
  r = await api.call('POST', `/api/drafts/${draftId}/content`, { index: 0 });
  assert.equal(r.status, 200);
  assert.match(r.text, /event: done/);
});

test('重新生成中途断开：原来的稿子还在（以前会被清回选方向）', async () => {
  const before = (await api.call('GET', `/api/drafts/${draftId}`)).data.draft;
  assert.ok(before.content);
  const ctrl = new AbortController();
  const res = await fetch(`${BASE}/api/drafts/${draftId}/content`, {
    method: 'POST', signal: ctrl.signal,
    headers: { 'content-type': 'application/json', cookie: api.cookieHeader() },
    body: JSON.stringify({ index: 1 }),
  });
  const reader = res.body.getReader();
  await reader.read();                                   // 收到第一段就断开
  ctrl.abort();
  let after;
  for (let i = 0; i < 40; i += 1) {
    await new Promise((r) => setTimeout(r, 100));
    after = (await api.call('GET', `/api/drafts/${draftId}`)).data.draft;
    if (after.status !== 'writing') break;
  }
  assert.equal(after.status, before.status);
  assert.equal(after.chosen, before.chosen);
  assert.equal(after.content, before.content);
});

test('划词改写和 / 续写（以前 500：selection.trim is not a function）', async () => {
  let r = await api.call('POST', `/api/drafts/${draftId}/assist`, { action: 'expand', selection: '周末备菜很省事', before: '', after: '' });
  assert.equal(r.status, 200, r.text);
  assert.match(r.text, /event: done/);
  r = await api.call('POST', `/api/drafts/${draftId}/assist`, { kind: 'compose', instruction: '补一个例子', before: '前文', after: '' });
  assert.equal(r.status, 200, r.text);
  assert.match(r.text, /event: done/);
});

test('配图：排版位有画面提示词，出图走任务；同一张连点只建一个任务', async () => {
  let r = await api.call('POST', `/api/drafts/${draftId}/illus`, {});
  assert.equal(r.status, 200, r.text);
  const items = r.data.illus.items;
  assert.ok(items.length >= 1);
  assert.ok(items[0].prompt, `排版位没有提示词：${JSON.stringify(items[0])}`);

  const burst = await Promise.all(Array.from({ length: 10 }, () => api.call('POST', `/api/drafts/${draftId}/illus/0/image`, { async: true })));
  burst.forEach((b) => assert.equal(b.status, 202, b.text));
  const ids = new Set(burst.map((b) => b.data.job.id));
  assert.equal(ids.size, 1, `连点建出了 ${ids.size} 个任务`);
  const job = await untilJob(api, [...ids][0]);
  assert.equal(job.status, 'done', job.error);
  assert.ok(job.result.image.file);
});

test('配图：改过的画面提示词随出图请求带上，存下来并用它出图', async () => {
  const r = await api.call('POST', `/api/drafts/${draftId}/illus/0/image`, { async: true, prompt: '  窗边的一盆绿萝，清晨的光  ' });
  assert.equal(r.status, 202, r.text);
  const job = await untilJob(api, r.data.job.id);
  assert.equal(job.status, 'done', job.error);
  const d = (await api.call('GET', `/api/drafts/${draftId}`)).data.draft;
  assert.equal(d.illus.__main__.items[0].prompt, '窗边的一盆绿萝，清晨的光');
});

test('口播：上传录音（异步有任务号，同步等到总评），语音测评', async () => {
  let r = await api.call('POST', `/api/drafts/${draftId}/cues`, {});
  assert.equal(r.status, 200, r.text);
  const audio = new Uint8Array(4096).fill(1);
  r = await api.call('POST', `/api/drafts/${draftId}/speaks?async=1`, audio, { 'content-type': 'audio/webm', 'x-filename': 'take.webm' });
  assert.equal(r.status, 202, r.text);
  assert.ok(r.data.job?.id, `异步上传没有任务号：${r.text}`);
  const job = await untilJob(api, r.data.job.id);
  assert.equal(job.status, 'done', job.error);

  r = await api.call('POST', `/api/drafts/${draftId}/speaks`, audio, { 'content-type': 'audio/webm', 'x-filename': 'take.webm' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.speak.status, 'ready', `同步上传没等到总评：${r.data.speak.status}`);
  const sid = r.data.speak.id;

  r = await api.call('POST', `/api/speaks/${sid}/pronounce`, {});
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.speak.review.checks.voice, true);

  r = await api.call('POST', `/api/speaks/${sid}/retry`, { async: true });
  assert.equal(r.status, 202, r.text);
  assert.ok(r.data.job?.id);
  assert.equal((await untilJob(api, r.data.job.id)).status, 'done');
});

test('语气样本：加一篇就重建语气档案（以前 .map is not a function）', async () => {
  let r = await api.call('POST', '/api/personas', { name: '接口测试号' });
  assert.equal(r.status, 200, r.text);
  const pid = r.data.persona.id;
  r = await api.call('POST', `/api/personas/${pid}/samples`, { title: '样本', content: '周末花两个小时把一周的菜备好。'.repeat(10) });
  assert.equal(r.status, 200, r.text);
  assert.ok(r.data.digest, '语气档案是空的');
  r = await api.call('POST', `/api/personas/${pid}/samples/batch`, { samples: [{ title: 'b', content: '下班十五分钟就能吃上热饭。'.repeat(12) }] });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.added, 1);
});

test('管理后台：设置列表、保存设置报错、Eval 运行', async () => {
  const admin = client();
  let r = await admin.call('POST', '/api/admin/setup', { username: 'boss', password: 'adminpass9' });
  assert.equal(r.status, 200, r.text);
  r = await admin.call('GET', '/api/admin/settings');
  assert.equal(r.status, 200, r.text);
  assert.ok(Array.isArray(r.data.fields) && r.data.fields.length, `设置列表不是数组：${r.text}`);
  r = await admin.call('POST', '/api/admin/settings', { key: '没有这个配置', value: 'x' });
  assert.equal(r.status, 400, `保存出错应当回 400：${r.text}`);

  r = await admin.call('POST', '/api/admin/variants', { feature: 'topics', name: 'B', system: '你是一位选题编辑。'.repeat(8), weight: 1, active: true });
  assert.equal(r.status, 200, r.text);
  r = await admin.call('POST', '/api/admin/eval/cases', { feature: 'topics', title: '备菜', input: { subject: '周末备菜' } });
  assert.equal(r.status, 200, r.text);
  r = await admin.call('POST', '/api/admin/eval/run', { feature: 'topics' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.variants, 2);
});

test('重复注册回 409，不是 500', async () => {
  const r = await client().call('POST', '/api/auth/register', { username: `rt${process.pid}`, password: 'secret123' });
  assert.equal(r.status, 409, r.text);
});

test('Fastify 自己拒掉的请求也是 JSON、也带安全头', async () => {
  const r = await fetch(`${BASE}/%zz`);
  assert.equal(r.status, 400);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.ok((await r.json()).error);
});

test('缺失的构建文件回 404，不回首页', async () => {
  const r = await fetch(`${BASE}/assets/not-there-123.js`);
  assert.equal(r.status, 404);
});

test('停服务：收到 SIGTERM 正常退出', { timeout: 40_000 }, async () => {
  const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
  child.kill('SIGTERM');
  assert.equal(await exited, 0, log.slice(-2000));
});
