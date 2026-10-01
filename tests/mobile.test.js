/* 手机 App 接口：真的起服务走 HTTP（同 routes.test.js 的做法），数据用数据层直接造，省掉走模型的时间。
 * 覆盖：Bearer 登录与退出、今天（回填提醒的第 1 / 7 天规则、待发、选题池）、日历与标记发布、
 * 离线收件箱（去重、图片上传与只给本人看、路径穿越）、对标速存、发布包。 */
import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fromRoot } from '../server/paths.js';
import { addDays, extractTags, markdownToText, metricsDueDay, todayUtc } from '../server/routes/mobile.js';

const PORT = 40000 + (process.pid % 20000);
const BASE = `http://127.0.0.1:${PORT}`;
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
let child;
let log = '';

function startServer() {
  const env = {
    PATH: process.env.PATH, HOME: process.env.HOME, USER: process.env.USER, LOGNAME: process.env.LOGNAME,
    ENV_FILE: 'none', NODE_ENV: 'test', PORT: String(PORT), HOST: '127.0.0.1',
    DATABASE_URL: process.env.DATABASE_URL, DB_SCHEMA: process.env.DB_SCHEMA,
    REDIS_URL: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
    DATA_DIR: process.env.DATA_DIR, DB_PATH: process.env.DB_PATH,
    LLM_PROVIDER: 'mock', IMAGE_PROVIDER: 'mock', PAY_PROVIDER: 'mock',
    // 对标抓取要访问本机的测试网站
    BENCHMARK_ALLOW_PRIVATE: '1',
  };
  child = spawn(process.execPath, [fromRoot('server/index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = async () => {
      try { if ((await fetch(`${BASE}/health`)).ok) return resolve(); } catch { /* 还没起来 */ }
      if (child.exitCode != null) return reject(new Error(`服务没起来：\n${log}`));
      if (Date.now() - started > 20_000) return reject(new Error(`服务 20 秒没起来：\n${log}`));
      setTimeout(tick, 150);
    };
    tick();
  });
}

/* 小客户端：可以带 cookie，也可以带 Bearer token */
function client({ token = null } = {}) {
  const jar = new Map();
  const c = {
    token,
    async call(method, path, body, headers = {}) {
      const res = await fetch(BASE + path, {
        method,
        headers: {
          ...(jar.size ? { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
          ...(c.token ? { authorization: `Bearer ${c.token}` } : {}),
          ...(body ? { 'content-type': 'application/json' } : {}),
          ...headers,
        },
        body: body == null ? undefined : JSON.stringify(body),
      });
      for (const ck of res.headers.getSetCookie?.() || []) {
        const [pair] = ck.split(';');
        const i = pair.indexOf('=');
        if (pair.slice(i + 1)) jar.set(pair.slice(0, i), pair.slice(i + 1)); else jar.delete(pair.slice(0, i));
      }
      const buf = Buffer.from(await res.arrayBuffer());
      let data = buf.toString('utf8');
      try { data = JSON.parse(data); } catch { /* 不是 JSON */ }
      return { status: res.status, data, buf, headers: res.headers, text: buf.toString('utf8') };
    },
    jar,
  };
  return c;
}

let D;                 // 数据层（服务起来、迁移跑完之后再 import）
let app;               // Bearer 客户端
let uid;
let site;              // 本机测试网站
const today = todayUtc();

test('起服务', { timeout: 30_000 }, async () => {
  await startServer();
  D = await import('../server/db.js');
  site = http.createServer((req, res) => {
    if (req.url === '/article') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<html><head><title>备用</title><meta property="og:title" content="三步搞定周末备菜"></head><body>
        <article><h2>先列清单</h2><p>周末先把一周的菜列出来。</p><h2>集中处理</h2><p>洗切一次做完。</p>
        <h3>分装冷藏</h3><p>按天分好。</p></article></body></html>`);
    } else if (req.url === '/go') {
      res.writeHead(301, { location: '/article' });
      res.end();
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
});

test('App 登录：带 X-Client: app 才回 token；Bearer 能调接口；退出会删掉服务端会话', async () => {
  const name = `m${process.pid}`;
  let r = await client().call('POST', '/api/auth/register', { username: name, password: 'secret123' }, { 'x-client': 'app' });
  assert.equal(r.status, 200, r.text);
  assert.match(r.data.token, /^[0-9a-f]{64}$/);
  assert.ok(r.headers.get('set-cookie'), '注册仍要下发 cookie');
  uid = r.data.user.id;

  const web = client();
  r = await web.call('POST', '/api/auth/login', { username: name, password: 'secret123' });
  assert.equal(r.status, 200);
  assert.equal(r.data.token, undefined, '网页登录不该拿到 token');

  r = await client().call('POST', '/api/auth/login', { username: name, password: 'secret123' }, { 'x-client': 'app' });
  app = client({ token: r.data.token });
  r = await app.call('GET', '/api/me');
  assert.equal(r.data.user?.id, uid);
  assert.equal((await client({ token: 'f'.repeat(64) }).call('GET', '/api/me')).data.user, null);

  // Bearer 退出：token 失效
  const other = client({ token: (await client().call('POST', '/api/auth/login', { username: name, password: 'secret123' }, { 'x-client': 'app' })).data.token });
  assert.equal((await other.call('POST', '/api/auth/logout')).status, 200);
  assert.equal((await other.call('GET', '/api/me')).data.user, null);
  assert.equal((await other.call('GET', '/api/today')).status, 401);
  // cookie 退出：留着旧 cookie 再来也进不去
  const saved = new Map(web.jar);
  assert.equal((await web.call('GET', '/api/me')).data.user?.id, uid);
  await web.call('POST', '/api/auth/logout');
  for (const [k, v] of saved) web.jar.set(k, v);
  assert.equal((await web.call('GET', '/api/me')).data.user, null);
  // 另一个会话不受影响
  assert.equal((await app.call('GET', '/api/me')).data.user?.id, uid);
});

test('回填提醒规则：到第 1 / 7 天且没有那天以后的快照才提醒，7 天优先，超过 30 天不提', () => {
  const T = '2026-05-20';
  const row = (pub, last = null) => ({ published_at: pub, last_metric: last });
  assert.equal(metricsDueDay(row(''), T), 0);
  assert.equal(metricsDueDay(row(T), T), 0);
  assert.equal(metricsDueDay(row(addDays(T, -1)), T), 1);
  assert.equal(metricsDueDay(row(addDays(T, -1), T), T), 0);
  assert.equal(metricsDueDay(row(addDays(T, -6)), T), 1);
  assert.equal(metricsDueDay(row(addDays(T, -7)), T), 7);
  assert.equal(metricsDueDay(row(addDays(T, -8), addDays(T, -7)), T), 7);
  assert.equal(metricsDueDay(row(addDays(T, -8), addDays(T, -1)), T), 0);
  assert.equal(metricsDueDay(row(addDays(T, -30)), T), 7);
  assert.equal(metricsDueDay(row(addDays(T, -31)), T), 0);
  assert.equal(metricsDueDay(row(`${addDays(T, -3)}T10:00:00.000Z`), T), 1);
});

const ids = {};
async function draft(name, { done = true, published = '', cues = false, score = null, archived = false, persona = null } = {}) {
  const d = await D.Drafts.create(uid, { subject: name, platform: 'xiaohongshu', tone: '实用干货', audience: '', keywords: '', length: 600 }, persona);
  if (done) await D.Drafts.saveContent(d.id, uid, `# ${name}\n\n正文`);
  if (published) await D.Drafts.setPublished(d.id, uid, published);
  if (cues) await D.Drafts.setCues(d.id, uid, { cues: [{ quote: '正文' }] });
  if (score != null) {
    const s = await D.Speaks.create({ userId: uid, draftId: d.id, title: name, script: '正文' });
    await D.Speaks.finish(s.id, uid, { transcript: '', review: { score }, status: 'ready' });
  }
  if (archived) await D.Drafts.setArchived(d.id, uid, true);
  ids[name] = d.id;
  return d.id;
}

test('今天：额度、回填提醒、任务、选题池、待发、待练口播、本周', async () => {
  await draft('七天', { published: addDays(today, -8) });
  await draft('一天', { published: addDays(today, -3) });
  const c = await draft('补七天', { published: addDays(today, -8) });
  await D.Metrics.put(c, uid, { capturedOn: addDays(today, -7), values: { views: 10 } });
  const d = await draft('已回填', { published: addDays(today, -8) });
  await D.Metrics.put(d, uid, { capturedOn: today, values: { views: 99 } });
  await draft('今天发', { published: today });
  await draft('很久以前', { published: addDays(today, -40) });
  await draft('待发有口播', { cues: true });
  await draft('练过了', { cues: true, score: 80 });
  await draft('练得不好', { cues: true, score: 40 });
  await draft('已归档', { published: addDays(today, -8), archived: true });
  await draft('只有方向', { done: false });
  await D.Pool.create(uid, null, { subject: '池子一' });
  const p2 = await D.Pool.create(uid, null, { subject: '池子二' });
  await D.Pool.update(p2.id, uid, { status: 'done' });
  const job = await D.Jobs.create({ userId: uid, kind: 'image', label: '配图第 1 张' });
  await D.Jobs.finish(job.id, { status: 'failed', error: '出图失败' });

  const r = await app.call('GET', '/api/today');
  assert.equal(r.status, 200, r.text);
  const t = r.data;
  assert.deepEqual(Object.keys(t).sort(), ['jobs', 'metricsDue', 'poolUnused', 'quota', 'ready', 'speakTodo', 'week']);
  assert.equal(typeof t.quota.left, 'number');
  assert.equal(typeof t.quota.low, 'boolean');
  assert.ok(t.quota.label);

  const due = Object.fromEntries(t.metricsDue.map((m) => [m.title, m.day]));
  assert.deepEqual(due, { 七天: 7, 补七天: 7, 一天: 1 });
  const m7 = t.metricsDue.find((m) => m.title === '七天');
  assert.deepEqual(Object.keys(m7).sort(), ['day', 'draftId', 'platform', 'publishedAt', 'title']);
  assert.equal(m7.publishedAt, addDays(today, -8));

  assert.equal(t.jobs.active, 0);
  assert.equal(t.jobs.failed.length, 1);
  assert.deepEqual(Object.keys(t.jobs.failed[0]).sort(), ['error', 'finishedAt', 'id', 'kind', 'label']);
  assert.equal(t.poolUnused, 1);

  const ready = t.ready.map((x) => x.title);
  assert.deepEqual(ready.sort(), ['待发有口播', '练得不好', '练过了'].sort());
  assert.equal(t.ready[0].title, '练得不好', '待发按最近修改排');
  assert.equal(t.ready.find((x) => x.title === '待发有口播').hasCues, true);
  assert.deepEqual(t.speakTodo.map((x) => x.title).sort(), ['待发有口播', '练得不好'].sort());

  assert.equal(t.week.length, 7);
  assert.equal(new Date(`${t.week[0].day}T00:00:00Z`).getUTCDay(), 1, '本周从周一开始');
  assert.ok(t.week.some((w) => w.day === today));
  const todayCell = t.week.find((w) => w.day === today);
  const sent = todayCell.items.find((x) => x.title === '今天发');
  assert.deepEqual(sent.states, ['published']);
  assert.equal(sent.platform, undefined, '本周条目不带平台');
  assert.ok(todayCell.items.some((x) => x.title === '待发有口播' && x.states.includes('done') && x.states.includes('cue')));
});

test('今天按账号筛：persona=<id> 只看该账号的稿子和选题', async () => {
  const p = (await app.call('POST', '/api/personas', { name: '移动端测试号' })).data.persona;
  ids.persona = p.id;
  await draft('账号下的稿', { persona: p });
  await D.Pool.create(uid, p.id, { subject: '账号下的选题' });
  const r = await app.call('GET', `/api/today?persona=${p.id}`);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.data.ready.map((x) => x.title), ['账号下的稿']);
  assert.equal(r.data.poolUnused, 1);
  assert.equal(r.data.metricsDue.length, 0);
  assert.equal((await app.call('GET', '/api/today?persona=abc')).status, 400);
});

test('日历：每天一格，发布日 / 排期 / 成稿日落位，状态可叠加；标记发布与取消', async () => {
  const planned = await draft('排了期', { done: false });
  const pool = await D.Pool.create(uid, null, { subject: '排了期' });
  await D.Pool.update(pool.id, uid, { plan_date: addDays(today, 2), draft_id: planned });

  const from = addDays(today, -10);
  const to = addDays(today, 5);
  let r = await app.call('GET', `/api/calendar?from=${from}&to=${to}`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.days.length, 16);
  assert.equal(r.data.days[0].day, from);
  const all = r.data.days.flatMap((d) => d.items.map((it) => ({ ...it, day: d.day })));
  const find = (title) => all.find((x) => x.title === title);
  assert.deepEqual(find('七天'), { id: ids['七天'], title: '七天', platform: 'xiaohongshu', states: ['published', 'metrics'], day: addDays(today, -8) });
  assert.deepEqual(find('已回填').states, ['published']);
  assert.deepEqual(find('排了期').states, []);
  assert.equal(find('排了期').day, addDays(today, 2));
  assert.deepEqual(find('待发有口播').states, ['done', 'cue']);
  assert.equal(find('待发有口播').day, today);
  assert.deepEqual(find('练过了').states, ['done']);
  assert.equal(find('只有方向'), undefined, '没成稿也没排期的不上日历');
  assert.equal(find('已归档'), undefined);
  assert.equal(find('很久以前'), undefined, '不在范围内');

  assert.equal((await app.call('GET', `/api/calendar?from=${today}&to=${addDays(today, 62)}`)).status, 400);
  assert.equal((await app.call('GET', `/api/calendar?from=${today}&to=${addDays(today, 61)}`)).status, 200);
  assert.equal((await app.call('GET', `/api/calendar?from=2026-02-30&to=2026-03-02`)).status, 400);
  assert.equal((await app.call('GET', `/api/calendar?from=${today}&to=${addDays(today, -1)}`)).status, 400);

  const id = ids['待发有口播'];
  r = await app.call('PUT', `/api/drafts/${id}/published`, { date: addDays(today, -1) });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.data, { draft: { id, published_at: addDays(today, -1) } });
  r = await app.call('GET', `/api/calendar?from=${addDays(today, -1)}&to=${addDays(today, -1)}`);
  assert.deepEqual(r.data.days[0].items.find((x) => x.id === id).states, ['cue', 'published', 'metrics']);
  r = await app.call('PUT', `/api/drafts/${id}/published`, { date: '' });
  assert.deepEqual(r.data.draft, { id, published_at: '' });
  assert.equal((await app.call('PUT', `/api/drafts/${id}/published`, { date: '2026-13-01' })).status, 400);

  const stranger = client({ token: (await client().call('POST', '/api/auth/register', { username: `x${process.pid}`, password: 'secret123' }, { 'x-client': 'app' })).data.token });
  assert.equal((await stranger.call('PUT', `/api/drafts/${id}/published`, { date: today })).status, 404);
});

test('收件箱：按 key 去重、单条出错不影响整批、图片只给本人看、拒绝路径穿越', async () => {
  const items = [
    { key: 'pool-key-0001', kind: 'pool', personaId: null, subject: '地铁上想到的题', note: '记一下' },
    { key: 'mat-key-0001', kind: 'material', personaId: ids.persona, title: '楼下早餐店', body: '老板五点开门', materialKind: '经历', tags: '观察', image: `data:image/png;base64,${PNG}` },
    { key: 'mat-key-0002', kind: 'material', personaId: null, title: '没选账号' },
    { key: 'short', kind: 'pool', subject: 'key 太短' },
    { key: 'pool-key-0002', kind: 'pool', subject: '坏图片', image: 'data:image/gif;base64,R0lGODlh' },
    { key: 'pool-key-0003', kind: 'pool', subject: '假 PNG', image: `data:image/png;base64,${Buffer.from('not png').toString('base64')}` },
    { key: 'pool-key-0004', kind: 'note', subject: '不认识的类型' },
  ];
  let r = await app.call('POST', '/api/inbox', { items });
  assert.equal(r.status, 200, r.text);
  const [pool, mat, noPersona, short, gif, fake, kind] = r.data.results;
  assert.deepEqual({ ...pool, id: 0 }, { key: 'pool-key-0001', ok: true, kind: 'pool', id: 0 });
  assert.equal(mat.ok, true, JSON.stringify(mat));
  for (const bad of [noPersona, short, gif, fake, kind]) {
    assert.equal(bad.ok, false);
    assert.ok(bad.error, JSON.stringify(bad));
  }
  assert.equal(short.key, 'short');

  // 重发：不再建，回上次的结果
  r = await app.call('POST', '/api/inbox', { items: items.slice(0, 2) });
  assert.deepEqual(r.data.results[0], { key: 'pool-key-0001', ok: true, kind: 'pool', id: pool.id, duplicate: true });
  assert.deepEqual(r.data.results[1], { key: 'mat-key-0001', ok: true, kind: 'material', id: mat.id, duplicate: true });
  const pooled = (await app.call('GET', '/api/pool')).data.pool.filter((p) => p.subject === '地铁上想到的题');
  assert.equal(pooled.length, 1);
  assert.equal(pooled[0].source, '灵感');
  // 同一批里重复的 key 也只建一次
  r = await app.call('POST', '/api/inbox', { items: [{ key: 'same-key-0001', kind: 'pool', subject: '重复' }, { key: 'same-key-0001', kind: 'pool', subject: '重复' }] });
  assert.equal(r.data.results[1].duplicate, true);
  assert.equal(r.data.results[1].id, r.data.results[0].id);

  const material = (await app.call('GET', `/api/personas/${ids.persona}/materials`)).data.materials.find((m) => m.id === mat.id);
  assert.equal(material.kind, '经历');
  const url = material.body.match(/图片：(\S+)/)?.[1];
  assert.match(url, /^\/api\/inbox\/files\/u\d+-[0-9a-f]+\.png$/);
  r = await app.call('GET', url);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/png');
  assert.deepEqual(r.buf, Buffer.from(PNG, 'base64'));

  const stranger = client({ token: (await client().call('POST', '/api/auth/login', { username: `x${process.pid}`, password: 'secret123' }, { 'x-client': 'app' })).data.token });
  assert.equal((await stranger.call('GET', url)).status, 403);
  assert.equal((await client().call('GET', url)).status, 401);
  for (const bad of ['..%2F..%2Fetc%2Fpasswd', `u${uid}-..%2F..%2Fx.png`, `u${uid}-abc.png%00.txt`, `..%5Cu${uid}-0123456789abcdef.png`]) {
    assert.equal((await app.call('GET', `/api/inbox/files/${bad}`)).status, 400, bad);
  }
  assert.equal((await app.call('GET', `/api/inbox/files/u${uid}-0123456789abcdef0123.png`)).status, 404);
  assert.equal((await app.call('POST', '/api/inbox', { items: Array.from({ length: 51 }, (_, i) => ({ key: `k${i}xxxxxxxx`, kind: 'pool', subject: 'x' })) })).status, 400);
});

test('对标速存：粘贴文本、抓链接（跟跳转）、拒绝 http 以外的链接、转素材和框架、列表与删除', async () => {
  const pid = ids.persona;
  let r = await app.call('POST', `/api/personas/${pid}/benchmarks`, { text: '## 开头钩子\n一句话抓人。\n## 三个方法\n分别是……\n## 结尾互动\n留言聊聊。', title: '粘贴的范文' });
  assert.equal(r.status, 200, r.text);
  const pasted = r.data.benchmark;
  assert.deepEqual(Object.keys(pasted).sort(), ['created_at', 'excerpt', 'id', 'outline', 'title', 'url']);
  assert.equal(pasted.title, '粘贴的范文');
  assert.deepEqual(pasted.outline, ['开头钩子', '三个方法', '结尾互动']);
  assert.equal(pasted.url, '');

  const page = `http://127.0.0.1:${site.address().port}`;
  r = await app.call('POST', `/api/personas/${pid}/benchmarks`, { url: `${page}/go` });
  assert.equal(r.status, 200, r.text);
  const fetched = r.data.benchmark;
  assert.equal(fetched.title, '三步搞定周末备菜');
  assert.deepEqual(fetched.outline, ['先列清单', '集中处理', '分装冷藏']);
  assert.equal(fetched.url, `${page}/article`);
  assert.ok(fetched.excerpt.includes('周末先把一周的菜列出来'));

  r = await app.call('POST', `/api/personas/${pid}/benchmarks`, { url: `${page}/missing` });
  assert.equal(r.status, 422);
  assert.match(r.data.error, /粘贴/);
  assert.equal((await app.call('POST', `/api/personas/${pid}/benchmarks`, { url: 'file:///etc/passwd' })).status, 400);
  assert.equal((await app.call('POST', `/api/personas/${pid}/benchmarks`, {})).status, 400);
  assert.equal((await app.call('POST', '/api/personas/999999/benchmarks', { text: '一'.repeat(30) })).status, 404);

  r = await app.call('POST', `/api/benchmarks/${fetched.id}/save`, { to: 'material' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.material.kind, '案例');
  assert.equal(r.data.material.title, '对标：三步搞定周末备菜');
  assert.equal(r.data.material.body, `先列清单\n集中处理\n分装冷藏\n来源：${page}/article`);

  r = await app.call('POST', `/api/benchmarks/${fetched.id}/save`, { to: 'framework' });
  assert.equal(r.status, 200, r.text);
  const fw = r.data.framework;
  assert.equal(fw.name, '对标：三步搞定周末备菜');
  assert.match(fw.summary, /只学结构，不抄内容/);
  assert.deepEqual(fw.slots.map((s) => s.role), ['先列清单', '集中处理', '分装冷藏']);
  assert.ok(fw.slots.every((s) => Math.abs(s.ratio - 1 / 3) < 1e-9 && s.guide === ''));

  r = await app.call('POST', `/api/personas/${pid}/benchmarks`, { text: '只有一句话的内容，用来测试拆不出结构的情况。' });
  assert.equal(r.status, 200, r.text);
  const thin = r.data.benchmark;
  assert.equal((await app.call('POST', `/api/benchmarks/${thin.id}/save`, { to: 'framework' })).status, 422);
  assert.equal((await app.call('POST', `/api/benchmarks/${thin.id}/save`, { to: 'xx' })).status, 400);

  r = await app.call('GET', `/api/personas/${pid}/benchmarks`);
  assert.deepEqual(r.data.list.map((b) => b.id), [thin.id, fetched.id, pasted.id]);
  assert.equal((await app.call('DELETE', `/api/benchmarks/${thin.id}`)).status, 200);
  assert.equal((await app.call('DELETE', `/api/benchmarks/${thin.id}`)).status, 404);
  assert.equal((await app.call('GET', `/api/personas/${pid}/benchmarks`)).data.list.length, 2);
});

test('发布包：Markdown 转纯文本、话题标签、标题上限、配图地址', async () => {
  assert.equal(markdownToText('# 标题\n\n**粗** *斜* [链接](http://x) ![图](a.png) <此处放图片>\n\n\n\n- 一条\n> 引用\n---\n`code`'),
    '标题\n\n粗 斜 链接\n\n• 一条\n引用\n\ncode');
  assert.deepEqual(extractTags('正文 #好物推荐 #周末 \n#微博话题# 再来#好物推荐 网址 http://a.com/#anchor 和 ## 标题'), ['好物推荐', '周末', '微博话题']);
  assert.deepEqual(extractTags('没有标签'), []);
  assert.equal(extractTags(Array.from({ length: 12 }, (_, i) => `#t${i}`).join(' ')).length, 10);

  const id = await draft('发布包', { done: false });
  const title = '这是一个超过二十个字的小红书标题用来测试超限提醒';
  await D.Drafts.saveContent(id, uid, `# ${title}\n\n**重点**来了 <此处放图片>\n\n#周末备菜 #省时`);
  await D.Drafts.setVariants(id, uid, { weibo: { content: '微博版正文 #周末备菜#', chars: 10 }, zhihu: { content: '' } });
  await D.Drafts.setIllus(id, uid, {
    __main__: { items: [{ i: 0, alt: '备菜', image: { file: `${uid}/${id}-__main__-0.png`, at: '2026-01-01T00:00:00.000Z' } }, { i: 1, alt: '没出图', image: null }] },
  });
  const r = await app.call('GET', `/api/drafts/${id}/package`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.draftId, id);
  assert.deepEqual(r.data.platforms.map((p) => p.key), ['xiaohongshu', 'weibo']);
  const [xhs, wb] = r.data.platforms;
  assert.equal(xhs.label, '小红书');
  assert.equal(xhs.title, title);
  assert.equal(xhs.body, '重点来了\n\n#周末备菜 #省时');
  assert.deepEqual(xhs.tags, ['周末备菜', '省时']);
  assert.deepEqual(xhs.limits, { title: 20, body: null });
  assert.deepEqual(xhs.checks, { titleChars: [...title].length, bodyChars: '重点来了#周末备菜#省时'.length, titleOver: true, bodyOver: false });
  assert.deepEqual(xhs.images, [{ url: `/image/${uid}/${id}-__main__-0.png?v=${encodeURIComponent('2026-01-01T00:00:00.000Z')}`, alt: '备菜' }]);
  assert.equal(wb.title, '发布包', '平台版本没有 # 标题时用稿子标题');
  assert.deepEqual(wb.tags, ['周末备菜']);
  assert.deepEqual(wb.limits, { title: null, body: null });
  assert.deepEqual(wb.images, []);

  const stranger = client({ token: (await client().call('POST', '/api/auth/login', { username: `x${process.pid}`, password: 'secret123' }, { 'x-client': 'app' })).data.token });
  assert.equal((await stranger.call('GET', `/api/drafts/${id}/package`)).status, 404);
});

test('停服务', { timeout: 40_000 }, async () => {
  site?.close();
  const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
  child.kill('SIGTERM');
  assert.equal(await exited, 0, log.slice(-2000));
});
