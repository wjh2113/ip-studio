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
  assert.match(r.text, /event: done/);  r = await api.call('POST', `/api/drafts/${draftId}/assist`, { action: 'humanize', selection: '在当今快节奏的时代，备菜至关重要', before: '', after: '' });
  assert.equal(r.status, 200, r.text);
  assert.match(r.text, /event: done/);
});

test('AI 味扫描：不调模型，直接回规则命中', async () => {
  const r = await api.call('POST', `/api/drafts/${draftId}/ai-tone`, { content: '在当今快节奏的时代，备菜至关重要。\n\n让我们一起加油，未来可期！' });
  assert.equal(r.status, 200, r.text);
  assert.ok(r.data.flags.some((f) => f.rule === 'cliche-open'));
  assert.ok(r.data.flags.some((f) => f.rule === 'uplift'));
  assert.equal((await api.call('POST', `/api/drafts/${draftId}/ai-tone`, { content: ' ' })).status, 400);
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

test('手改平台版本：PUT 存正文，原文不动；没有的版本 404，空的 400', async () => {
  let r = await api.call('POST', `/api/drafts/${draftId}/variants`, { platform: 'xiaohongshu' });
  assert.equal(r.status, 200, r.text);
  const before = (await api.call('GET', `/api/drafts/${draftId}`)).data.draft.content;
  r = await api.call('PUT', `/api/drafts/${draftId}/variants/xiaohongshu`, { content: '手改的小红书版本\n\n第二段' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.variant.content, '手改的小红书版本\n\n第二段');
  assert.ok(r.data.variant.editedAt);
  const d = (await api.call('GET', `/api/drafts/${draftId}`)).data.draft;
  assert.equal(d.variants.xiaohongshu.content, '手改的小红书版本\n\n第二段');
  assert.equal(d.content, before);
  r = await api.call('PUT', `/api/drafts/${draftId}/variants/zhihu`, { content: 'x' });
  assert.equal(r.status, 404);
  r = await api.call('PUT', `/api/drafts/${draftId}/variants/xiaohongshu`, { content: '  ' });
  assert.equal(r.status, 400);
});

test('检查、语音改稿按版本：查小红书版、改小红书版，原文不动', async () => {
  // 上一条已经出过小红书版本并手改过
  const d0 = (await api.call('GET', `/api/drafts/${draftId}`)).data.draft;
  let r = await api.call('POST', `/api/drafts/${draftId}/review`, { version: 'xiaohongshu' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.review.version, 'xiaohongshu');
  r = await api.call('POST', `/api/drafts/${draftId}/review`, { version: 'weibo' });
  assert.equal(r.status, 404);
  const audio = new Uint8Array(2048).fill(3);
  r = await api.call('POST', `/api/drafts/${draftId}/voice-edit?version=xiaohongshu`, audio, { 'content-type': 'audio/webm', 'x-filename': 'v.webm' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.version, 'xiaohongshu');
  // 返回的是小红书版改后的正文（演示模式只换前 12 个字成自己），不是原文
  assert.ok(r.data.content.startsWith(d0.variants.xiaohongshu.content.slice(0, 12)), r.data.content.slice(0, 30));
  const d1 = (await api.call('GET', `/api/drafts/${draftId}`)).data.draft;
  assert.equal(d1.content, d0.content);
});

test('口播两版：公众号原文朗读版 + 视频号口播版；逐段改词和提示', async () => {
  // 还没有视频号版本时不能直接标
  let r = await api.call('POST', `/api/drafts/${draftId}/cues`, { version: 'shipinhao' });
  assert.equal(r.status, 404, r.text);
  r = await api.call('POST', `/api/drafts/${draftId}/variants`, { platform: 'shipinhao' });
  assert.equal(r.status, 200, r.text);
  r = await api.call('POST', `/api/drafts/${draftId}/cues`, { version: 'shipinhao' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.version, 'shipinhao');
  assert.equal(r.data.cues.mode, 'video');
  let d = (await api.call('GET', `/api/drafts/${draftId}`)).data.draft;
  const vc = d.variants.shipinhao.cues;
  assert.ok(vc.cues.length > 0);

  // 改视频号版第一段：换词 + 改语气、重读；稿子跟着改，原文不动
  const before = d.content;
  const first = vc.cues[0];
  const quote = `${first.quote}（改过）`;
  const text = d.variants.shipinhao.content.replace(first.quote, quote);
  const cues = vc.cues.map((c, i) => (i === 0 ? { ...c, quote, emotion: '笑着说', stress: ['改过', '不存在的词'] } : c));
  r = await api.call('PUT', `/api/drafts/${draftId}/cues`, { version: 'shipinhao', cues, text });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.cues.cues[0].emotion, '笑着说');
  assert.deepEqual(r.data.cues.cues[0].stress, ['改过']);        // 不在这一段里的重读词丢掉
  assert.ok(r.data.cues.edited);
  d = r.data.draft;
  assert.ok(d.variants.shipinhao.content.includes(quote));
  assert.equal(d.content, before);

  // 对不上稿子的段落：拒收
  r = await api.call('PUT', `/api/drafts/${draftId}/cues`, { version: 'shipinhao', cues: [{ quote: '稿子里没有这句话' }] });
  assert.equal(r.status, 400);

  // 原文朗读版：公众号文章按朗读标
  r = await api.call('POST', `/api/drafts/${draftId}/cues`, {});
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.cues.mode, 'read');

  // 抖音、B 站版本也能各自标口播、上传录音（录音标题带上是哪一版）
  for (const [ver, name] of [['douyin', '抖音版'], ['bilibili', 'B 站版']]) {
    r = await api.call('POST', `/api/drafts/${draftId}/variants`, { platform: ver });
    assert.equal(r.status, 200, r.text);
    r = await api.call('POST', `/api/drafts/${draftId}/cues`, { version: ver });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.data.cues.mode, 'video');
    assert.ok(r.data.cues.cues.length > 0);
    assert.ok(r.data.cues.cues.every((c) => !c.quote.startsWith('【')), '分栏标注混进了要念的词');
    const audio = new Uint8Array(2048).fill(2);
    r = await api.call('POST', `/api/drafts/${draftId}/speaks?version=${ver}`, audio, { 'content-type': 'audio/webm', 'x-filename': 'take.webm' });
    assert.equal(r.status, 200, r.text);
    assert.ok(r.data.speak.title.endsWith(`（${name}）`), r.data.speak.title);
  }
  d = (await api.call('GET', `/api/drafts/${draftId}`)).data.draft;
  assert.ok(d.variants.douyin.cues && d.variants.bilibili.cues && d.variants.shipinhao.cues);
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

test('Word / PDF 导入：传原始字节取文字；读不了的回 4xx 和办法', async () => {
  const { readFileSync } = await import('node:fs');
  const docx = readFileSync(fromRoot('tests/fixtures/files/article.docx'));
  let r = await api.call('POST', '/api/files/extract', new Uint8Array(docx), { 'content-type': 'application/octet-stream', 'x-filename': encodeURIComponent('我的文章.docx') });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.kind, 'docx');
  assert.equal(r.data.title, '我做产品经理的第五年');
  assert.equal(r.data.name, '我的文章.docx');
  assert.ok(r.data.chars > 100);
  const pdf = readFileSync(fromRoot('tests/fixtures/files/image-only.pdf'));
  r = await api.call('POST', '/api/files/extract', new Uint8Array(pdf), { 'x-filename': 'scan.pdf' });
  assert.equal(r.status, 422);
  assert.match(r.data.error, /扫描件/);
  r = await fetch(`${BASE}/api/files/extract`, { method: 'POST', body: docx });
  assert.equal(r.status, 401);
});

test('素材库：用户级创建、列表、链接提取、增删改（不挂账号）', async () => {
  let r = await api.call('POST', '/api/materials', {
    kind: '文章', title: '第一次带队翻车', body: '把人带走一半之后才学会复盘。', tags: '管理,复盘',
  });
  assert.equal(r.status, 200, r.text);
  const mid = r.data.material.id;
  assert.equal(r.data.material.persona_id, null);
  assert.equal(r.data.material.kind, '文章');

  r = await api.call('GET', '/api/materials');
  assert.equal(r.status, 200, r.text);
  assert.ok(r.data.materials.some((m) => m.id === mid));
  assert.ok(r.data.kinds.includes('文章'));
  assert.ok(r.data.kinds.includes('链接'));

  r = await api.call('PUT', `/api/materials/${mid}`, {
    kind: '对标账号', title: '第一次带队翻车', body: '复盘写进了新人手册。', tags: '管理',
  });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.material.kind, '对标账号');

  r = await api.call('POST', '/api/materials/extract-url', { url: '' });
  assert.equal(r.status, 400);

  r = await api.call('DELETE', `/api/materials/${mid}`);
  assert.equal(r.status, 200, r.text);
  r = await api.call('GET', '/api/materials');
  assert.ok(!r.data.materials.some((m) => m.id === mid));

  // 以前存在素材库里的自己的经历、数据：挪到个人档案（建一条档案、删掉素材）
  r = await api.call('POST', '/api/materials', { kind: '文章', title: '公众号三个月涨粉 2 万', body: '从 3000 涨到 23000，靠的是固定周更。', tags: '数据' });
  const own = r.data.material.id;
  r = await api.call('POST', `/api/materials/${own}/to-profile`, { kind: 'data' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.entry.kind, 'data');
  assert.equal(r.data.entry.source, 'material');
  assert.equal(r.data.entry.title, '公众号三个月涨粉 2 万');
  r = await api.call('GET', '/api/materials');
  assert.ok(!r.data.materials.some((m) => m.id === own));
  r = await api.call('GET', '/api/profile');
  assert.ok(r.data.entries.some((e) => e.title === '公众号三个月涨粉 2 万' && e.kind === 'data'));
  r = await api.call('POST', `/api/materials/${own}/to-profile`, {});
  assert.equal(r.status, 404);
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

test('提示词说明书：未登录只读；管理员可保存并切回', async () => {
  const guest = client();
  let r = await guest.call('GET', '/api/prompt-docs');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.canEdit, false);
  const original = r.data.prompts.find((p) => p.key === 'topics')?.system || '';
  assert.ok(original.length > 20, 'topics 提示词应有正文');

  r = await guest.call('PUT', '/api/prompt-docs/topics', { system: `${original}\n\n（访客不该能存）` });
  assert.equal(r.status, 401, `未登录保存应 401：${r.text}`);

  const admin = client();
  r = await admin.call('POST', '/api/admin/login', { username: 'boss', password: 'adminpass9' });
  if (r.status === 401) {
    r = await admin.call('POST', '/api/admin/setup', { username: 'boss', password: 'adminpass9' });
  }
  assert.equal(r.status, 200, r.text);

  r = await admin.call('GET', '/api/prompt-docs');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.canEdit, true);

  const edited = `${original}\n\n（接口测试手改 ${Date.now()}）`;
  r = await admin.call('PUT', '/api/prompt-docs/topics', { system: edited });
  assert.equal(r.status, 200, r.text);
  assert.ok(r.data.history?.some((h) => h.active && h.source === 'edit'));
  assert.equal(r.data.system, edited);

  const codeRev = r.data.history.find((h) => h.source === 'code');
  assert.ok(codeRev, '应有代码版可切回');
  r = await admin.call('POST', `/api/prompt-docs/topics/revisions/${codeRev.id}/activate`, {});
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.system, codeRev.system);
});

test('重复注册回 409，不是 500', async () => {
  const r = await client().call('POST', '/api/auth/register', { username: `rt${process.pid}`, password: 'secret123' });
  assert.equal(r.status, 409, r.text);
});

test('移动端：X-Client: app 登录回 token，Bearer 调今天、日历、发布包（细节在 mobile.test.js）', async () => {
  const r = await client().call('POST', '/api/auth/login', { username: `rt${process.pid}`, password: 'secret123' }, { 'x-client': 'app' });
  assert.equal(r.status, 200, r.text);
  const bearer = { authorization: `Bearer ${r.data.token}` };
  const get = async (path) => {
    const res = await fetch(BASE + path, { headers: bearer });
    return { status: res.status, data: await res.json() };
  };
  const today = await get('/api/today');
  assert.equal(today.status, 200, JSON.stringify(today.data));
  assert.equal(today.data.week.length, 7);
  const day = new Date().toISOString().slice(0, 10);
  const cal = await get(`/api/calendar?from=${day}&to=${day}`);
  assert.equal(cal.status, 200);
  assert.ok(cal.data.days[0].items.some((it) => it.id === draftId), '今天成稿的稿子应当在日历上');
  const pkg = await get(`/api/drafts/${draftId}/package`);
  assert.equal(pkg.status, 200);
  assert.ok(pkg.data.platforms[0].body);
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
