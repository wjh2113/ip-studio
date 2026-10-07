/* 越写越懂：个人档案、语气样本学习、改稿偏好、发布即学、写作时用上。真的起服务走 HTTP（演示模式），
 * 模型输出是 server/learning.js 里的演示数据——测的是校验、落库、触发和拼进提示词这些代码路径。 */
import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fromRoot } from '../server/paths.js';
import { contentUser, prefsBlock, profileBlock } from '../server/prompts.js';

const PORT = 42000 + (process.pid % 20000);
const BASE = `http://127.0.0.1:${PORT}`;
let child;
let log = '';
let token = '';
let pid;
let D;
let uid;

function startServer() {
  const env = {
    PATH: process.env.PATH, HOME: process.env.HOME, USER: process.env.USER, LOGNAME: process.env.LOGNAME,
    ENV_FILE: 'none', NODE_ENV: 'test', PORT: String(PORT), HOST: '127.0.0.1',
    DATABASE_URL: process.env.DATABASE_URL, DB_SCHEMA: process.env.DB_SCHEMA,
    REDIS_URL: process.env.REDIS_URL || 'redis://127.0.0.1:6379', REDIS_PREFIX: `learn-${process.pid}`,
    DATA_DIR: process.env.DATA_DIR, DB_PATH: process.env.DB_PATH,
    LLM_PROVIDER: 'mock', IMAGE_PROVIDER: 'mock', PAY_PROVIDER: 'mock',
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

async function api(method, path, body, tk = token) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(tk ? { authorization: `Bearer ${tk}` } : {}) },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let data = text;
  try { data = JSON.parse(text); } catch { /* 流式 */ }
  return { status: r.status, data, text };
}

/* 等后台任务都跑完 */
async function settle(ms = 20_000) {
  const t0 = Date.now();
  for (;;) {
    const { data } = await api('GET', '/api/jobs');
    if (!data.active) return data.jobs;
    if (Date.now() - t0 > ms) throw new Error(`任务没跑完：${JSON.stringify(data.jobs.slice(0, 3))}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

const ARTICLE = (n) => `第 ${n} 篇。我在一家电商公司做了三年运营主管，带过一个 5 个人的小组。那年双十一我们把转化率从 2% 拉到了 3.5%。
后来我发现，带团队最难的不是定目标，而是让每个人知道自己为什么做这件事。我认为管理就是翻译。
这篇想把这几年踩过的坑都写下来，给刚开始带人的朋友一点参考。段落短一点，读起来不累。`;

test('起服务、注册、建号', { timeout: 30_000 }, async () => {
  await startServer();
  D = await import('../server/db.js');
  const r = await api('POST', '/api/auth/register', { username: `lr${process.pid}`, password: 'secret123' }, null);
  assert.equal(r.status, 200, r.text);
  const login = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-client': 'app' }, body: JSON.stringify({ username: `lr${process.pid}`, password: 'secret123' }) });
  token = (await login.json()).token;
  uid = r.data.user.id;
  pid = (await api('POST', '/api/personas', { name: '带团队的那些事', platform: 'gongzhonghao' })).data.persona.id;
});

test('提示词块：个人档案「只作背景」不写机构名，偏好规则单列，选题只给标题', () => {
  const entries = [
    { kind: 'work', title: '电商运营主管', period: '2019-2022', org: '某某电商', role: '运营主管', body: '带 5 人小组', result: '转化率 2%→3.5%', visibility: 'background' },
    { kind: 'opinion', title: '管理就是翻译', body: '把目标翻译成每个人听得懂的话', visibility: 'public' },
  ];
  const full = profileBlock(entries);
  assert.ok(!full.includes('某某电商'));
  assert.match(full, /机构只作背景/);
  assert.match(full, /结果：转化率 2%→3\.5%/);
  assert.match(full, /不许编造这里没有的个人经历/);
  const compact = profileBlock(entries, { compact: true });
  assert.ok(!compact.includes('经过：'));
  assert.equal(profileBlock([]), null);
  assert.match(prefsBlock([{ rule: '不用「赋能」' }]), /必须遵守[\s\S]*- 不用「赋能」/);
  const prompt = contentUser({ subject: '带团队', platform: 'gongzhonghao', tone: '实用干货', length: 1000 },
    { title: 't', angle: 'a', hook: 'h', outline: ['x'] }, { name: '号', style_digest: '- 短句' }, [], [],
    { profile: entries, prefs: [{ rule: '开头不用反问句' }] });
  assert.match(prompt, /作者的个人档案/);
  assert.match(prompt, /开头不用反问句/);
});

let parsed;
test('个人档案：贴简历拆成条目（引用原文核对）、勾选存进去、增删改、只能动自己的', async () => {
  const resume = '2019 年入职某某电商公司，担任运营主管，负责 5 个人的小组\n那年双十一把转化率从 2% 拉到 3.5%\n我认为管理就是翻译\n短';
  let r = await api('POST', '/api/profile/parse', { text: resume });
  assert.equal(r.status, 200, r.text);
  parsed = r.data.entries;
  assert.equal(parsed.length, 3, '太短的那行不算');
  assert.ok(parsed.every((e) => resume.replace(/\s/g, '').includes(e.quote.replace(/\s/g, ''))));
  assert.deepEqual(parsed.map((e) => e.kind), ['work', 'project', 'opinion']);
  assert.equal((await api('POST', '/api/profile/parse', { text: '太短' })).status, 400);

  r = await api('POST', '/api/profile/batch', { entries: parsed, source: 'resume' });
  assert.equal(r.data.saved, 3);
  const id = r.data.entries.find((e) => e.kind === 'work').id;
  r = await api('PUT', `/api/profile/${id}`, { ...parsed[0], org: '某某电商', visibility: 'background', title: '电商运营主管' });
  assert.equal(r.data.entry.visibility, 'background');
  assert.equal(r.data.entry.org, '某某电商');
  r = await api('POST', '/api/profile', { kind: 'project', title: '双十一大促复盘', body: '复盘了三个渠道', tags: '团队,大促' });
  assert.equal(r.status, 200);
  assert.equal((await api('POST', '/api/profile', { title: '' })).status, 400);
  r = await api('GET', '/api/profile');
  assert.equal(r.data.entries.length, 4);

  const other = await api('POST', '/api/auth/register', { username: `lo${process.pid}`, password: 'secret123' }, null);
  const login = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-client': 'app' }, body: JSON.stringify({ username: `lo${process.pid}`, password: 'secret123' }) });
  const tk = (await login.json()).token;
  assert.equal(other.status, 200);
  assert.equal((await api('DELETE', `/api/profile/${id}`, null, tk)).status, 404);
  assert.equal((await api('GET', '/api/profile', null, tk)).data.entries.length, 0);
});

test('喂一篇样本：单篇提炼要点、增量合并档案、文中的经历记成待确认，确认后进个人档案', async () => {
  let r = await api('POST', `/api/personas/${pid}/samples`, { title: '带团队第一年', content: ARTICLE(1) });
  assert.equal(r.status, 200, r.text);
  assert.ok(r.data.digest);
  assert.equal(r.data.candidates.length, 1);
  assert.ok(ARTICLE(1).includes(r.data.candidates[0].quote));
  assert.equal(r.data.samples[0].source, 'manual');
  assert.equal(r.data.samples[0].learned, true);

  r = await api('GET', `/api/personas/${pid}/learning`);
  assert.equal(r.status, 200);
  const kinds = r.data.log.map((x) => x.kind);
  assert.ok(kinds.includes('digest') && kinds.includes('candidates'), kinds.join());
  const cand = r.data.log.find((x) => x.kind === 'candidates');
  assert.equal(cand.status, '');
  assert.equal(r.data.samples.count, 1);
  assert.equal(r.data.autoLearn, true);

  const before = (await api('GET', '/api/profile')).data.entries.length;
  r = await api('POST', '/api/profile/batch', { entries: cand.detail.candidates, source: 'article', logId: cand.id });
  assert.equal(r.data.entries.length, before + 1);
  r = await api('GET', `/api/personas/${pid}/learning`);
  assert.equal(r.data.log.find((x) => x.id === cand.id).status, 'done');
});

test('批量导入文章：太短的跳过，后台逐篇提炼；满 10 篇自动从头梳理档案', { timeout: 60_000 }, async () => {
  const articles = Array.from({ length: 10 }, (_, i) => ({ title: `旧文 ${i + 2}`, content: ARTICLE(i + 2) }));
  articles.push({ title: '太短', content: '没几个字' });
  let r = await api('POST', `/api/personas/${pid}/samples/import`, { articles });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.added, 10);
  assert.deepEqual(r.data.skipped.map((x) => x.title), ['太短']);
  assert.ok(r.data.job?.id);
  const jobs = await settle(50_000);
  assert.equal(jobs.find((j) => j.id === r.data.job.id)?.status, 'done', JSON.stringify(jobs[0]));

  r = await api('GET', `/api/personas/${pid}/samples`);
  assert.equal(r.data.samples.length, 11);
  assert.ok(r.data.samples.every((x) => x.learned), '每篇都提炼过要点');
  r = await api('GET', `/api/personas/${pid}/learning`);
  const digestLogs = r.data.log.filter((x) => x.kind === 'digest');
  assert.ok(digestLogs[0].detail.full, '第 11 篇时距上次梳理已多了 10 篇，升级成从头梳理');
  assert.equal(r.data.samples.untilFull, 10);
  assert.equal((await api('POST', `/api/personas/${pid}/samples/import`, { articles: [] })).status, 400);
});

let draftId;
test('写作时用上：成稿记下参考了哪些经历、范文、偏好，经历的使用次数加一', { timeout: 30_000 }, async () => {
  await api('POST', `/api/personas/${pid}/prefs`, { rule: '开头不要用反问句' });
  let r = await api('POST', '/api/drafts/topics', { subject: '带团队的运营主管怎么做双十一复盘', platform: 'gongzhonghao', tone: '实用干货', length: 1000, persona_id: pid });
  assert.equal(r.status, 200, r.text);
  draftId = r.data.draft.id;
  r = await api('POST', `/api/drafts/${draftId}/content`, { index: 0 });
  assert.equal(r.status, 200);
  const draft = (await api('GET', `/api/drafts/${draftId}`)).data.draft;
  assert.equal(draft.status, 'done');
  assert.ok(draft.context.profile.length >= 1, JSON.stringify(draft.context));
  assert.equal(draft.context.samples.length, 2);
  assert.equal(draft.context.prefs, 1);
  const used = (await api('GET', '/api/profile')).data.entries.filter((e) => e.used_count > 0);
  assert.ok(used.length >= 1);
});

test('发布即学：标记发布 → 后台加进语气样本（按改稿幅度加权）、从改稿里学偏好，只学一次', { timeout: 60_000 }, async () => {
  const gen = (await D.Drafts.learnSource(draftId, uid)).generated;
  assert.ok(gen);
  await api('PUT', `/api/drafts/${draftId}/content`, { content: `我自己重写的开头，删掉了套话。\n\n${gen.slice(40)}` });
  let r = await api('PUT', `/api/drafts/${draftId}/published`, { date: '2026-10-01' });
  assert.equal(r.status, 200);
  await settle(50_000);
  r = await api('GET', `/api/personas/${pid}/learning`);
  const prefs = r.data.prefs;
  assert.ok(prefs.some((p) => /演示模式/.test(p.rule) && p.source_draft_id === draftId), JSON.stringify(prefs));
  assert.ok(r.data.log.some((x) => x.kind === 'sample'));
  assert.ok(r.data.log.some((x) => x.kind === 'prefs'));
  const samples = (await api('GET', `/api/personas/${pid}/samples`)).data.samples;
  const pub = samples.find((x) => x.draft_id === draftId);
  assert.equal(pub.source, 'published');
  assert.ok(pub.weight > 1, `改过的稿子权重高：${pub.weight}`);

  // 再标一次：不重复加样本、不重复学
  await api('PUT', `/api/drafts/${draftId}/published`, { date: '2026-10-02' });
  await settle();
  const again = await api('GET', `/api/personas/${pid}/learning`);
  assert.equal(again.data.prefs.length, prefs.length);
  assert.equal((await api('GET', `/api/personas/${pid}/samples`)).data.samples.filter((x) => x.draft_id === draftId).length, 1);
});

test('自动学习可以关；偏好规则能关、改、删；手动喂同一篇会提示已在样本里', { timeout: 30_000 }, async () => {
  let r = await api('PUT', `/api/personas/${pid}/auto-learn`, { on: false });
  assert.equal(r.data.autoLearn, false);
  r = await api('POST', '/api/drafts/topics', { subject: '第二篇', platform: 'gongzhonghao', tone: '实用干货', length: 800, persona_id: pid });
  const id2 = r.data.draft.id;
  await api('POST', `/api/drafts/${id2}/content`, { index: 0 });
  const nSamples = (await api('GET', `/api/personas/${pid}/samples`)).data.samples.length;
  await api('PUT', `/api/drafts/${id2}/published`, { date: '2026-10-03' });
  await settle();
  assert.equal((await api('GET', `/api/personas/${pid}/samples`)).data.samples.length, nSamples, '关了自动学习就不加样本');

  const prefs = (await api('GET', `/api/personas/${pid}/learning`)).data.prefs;
  const one = prefs[0];
  r = await api('PUT', `/api/personas/${pid}/prefs/${one.id}`, { status: 'off' });
  assert.equal(r.data.pref.status, 'off');
  r = await api('PUT', `/api/personas/${pid}/prefs/${one.id}`, { rule: '改过的规则写法' });
  assert.equal(r.data.pref.rule, '改过的规则写法');
  assert.equal((await api('PUT', `/api/personas/${pid}/prefs/${one.id}`, { rule: 'ab' })).status, 400);
  assert.equal((await api('DELETE', `/api/personas/${pid}/prefs/${one.id}`)).status, 200);
  assert.equal((await api('DELETE', `/api/personas/${pid}/prefs/${one.id}`)).status, 404);

  assert.equal((await api('POST', `/api/personas/${pid}/samples`, { draft_id: draftId })).status, 409);
  r = await api('POST', `/api/personas/${pid}/digest/rebuild`, {});
  assert.ok(r.data.job?.id);
  await settle();
});

test('删样本后用剩下的重新梳理；删光了档案清空', { timeout: 30_000 }, async () => {
  const p2 = (await api('POST', '/api/personas', { name: '小号', platform: 'xiaohongshu' })).data.persona.id;
  const r = await api('POST', `/api/personas/${p2}/samples`, { title: '唯一一篇', content: ARTICLE(99) });
  const sid = r.data.samples[0].id;
  const del = await api('DELETE', `/api/personas/${p2}/samples/${sid}`);
  assert.equal(del.data.digest, '');
  assert.equal((await api('GET', `/api/personas/${p2}/learning`)).data.digest, '');
});

test('停服务', { timeout: 40_000 }, async () => {
  const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
  child.kill('SIGTERM');
  assert.equal(await exited, 0, log.slice(-2000));
});
