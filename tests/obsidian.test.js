/* Obsidian 插件（obsidian-plugin/main.js）：起真服务，用内存里假的知识库和 obsidian 模块把插件跑一遍。
 * 覆盖：首次同步（按账号分文件夹、属性、配图下载并嵌入、其他平台版本降级标题、笔记区）、
 * 标题改了就改名且保留「我的笔记」、没变化不重写、接口地址可配成完整网址、密钥错误不前进、
 * 配图下载失败停在这一篇下次重试、Windows 文件名清洗、设置页能画出来。 */
import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire, Module } from 'node:module';
import { join } from 'node:path';
import { fromRoot } from '../server/paths.js';

const PORT = 41000 + (process.pid % 20000);
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

/* ---------------- 假的 obsidian 模块和知识库 ---------------- */
const notices = [];
const normalizePath = (p) => String(p).replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');

function makeVault() {
  const files = new Map();   // path → { path, extension, content | data }
  const folders = new Set();
  const file = (path, extra) => ({ path, name: path.split('/').pop(), extension: path.split('.').pop(), ...extra });
  const parentOk = (path) => {
    const dir = path.split('/').slice(0, -1).join('/');
    if (dir && !folders.has(dir)) throw new Error(`文件夹不存在：${dir}`);
  };
  const vault = {
    files, folders,
    getAbstractFileByPath: (p) => files.get(p) || (folders.has(p) ? { path: p, children: [] } : null),
    async createFolder(p) { if (folders.has(p)) throw new Error('Folder already exists.'); folders.add(p); },
    async create(p, content) { if (files.has(p)) throw new Error('File already exists.'); parentOk(p); const f = file(p, { content }); files.set(p, f); return f; },
    async createBinary(p, data) { if (files.has(p)) throw new Error('File already exists.'); parentOk(p); const f = file(p, { data }); files.set(p, f); return f; },
    async modify(f, content) { files.get(f.path).content = content; },
    async read(f) { return files.get(f.path).content; },
    getMarkdownFiles: () => [...files.values()].filter((f) => f.extension === 'md'),
  };
  const app = {
    vault,
    fileManager: {
      async renameFile(f, to) {
        if (files.has(to)) throw new Error('Destination file already exists!');
        parentOk(to);
        files.delete(f.path);
        Object.assign(f, file(to, { content: f.content }));
        files.set(to, f);
      },
    },
    metadataCache: {
      getFileCache: (f) => {
        const m = String(files.get(f.path)?.content || '').match(/^---\n[\s\S]*?ips_id: (\d+)/);
        return m ? { frontmatter: { ips_id: Number(m[1]) } } : null;
      },
    },
    workspace: { onLayoutReady: (cb) => { app.ready = cb; } },
  };
  return app;
}

const el = () => ({ setText(t) { this.text = t; }, addClass() {}, setAttr() {}, onClickEvent() {}, empty() {}, createEl: () => el() });
/* 设置页：Setting 的链式调用全部吞掉。addText / addToggle 这类「给你一个组件」的回调要调一下，
 * 才能走到里面的 setValue；onChange / onClick 这类事件回调不调（点按钮会重画设置页，会死循环） */
const chain = () => new Proxy(function () {}, {
  get: (t, k) => (k === 'inputEl' ? {} : (...args) => {
    if (/^add/.test(String(k))) for (const a of args) if (typeof a === 'function') a(chain());
    return chain();
  }),
});
const fake = {
  normalizePath,
  Notice: class { constructor(msg) { notices.push(msg); } },
  Plugin: class {
    constructor(app, manifest) { this.app = app; this.manifest = manifest; this.data = null; }
    async loadData() { return this.data; }
    async saveData(d) { this.data = JSON.parse(JSON.stringify(d)); }
    addStatusBarItem() { return el(); }
    addRibbonIcon() {}
    addCommand() {}
    addSettingTab(tab) { this.tab = tab; }
    registerInterval(id) { return id; }
  },
  PluginSettingTab: class { constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = el(); } },
  Setting: class { constructor() { return chain(); } },
  async requestUrl({ url, method, headers }) {
    const res = await fetch(url, { method, headers });
    const buf = Buffer.from(await res.arrayBuffer());
    const text = buf.toString('utf8');
    let json;
    try { json = JSON.parse(text); } catch { /* 图片 */ }
    return { status: res.status, text, json, arrayBuffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) };
  },
};
const origLoad = Module._load;
Module._load = function load(req, ...rest) { return req === 'obsidian' ? fake : origLoad.call(this, req, ...rest); };
globalThis.window ??= globalThis;
const Sync = createRequire(import.meta.url)('../obsidian-plugin/main.js');
const H = Sync.helpers;

/* ---------------- 数据 ---------------- */
let D;
let uid;
let key;
let personaId;
const ids = {};

async function api(path, { method = 'GET', body, token } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', 'x-client': 'app', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

async function makePlugin(settings = {}) {
  const app = makeVault();
  const p = new Sync(app, { id: 'ip-studio-sync' });
  p.data = { settings: { serverUrl: BASE, apiKey: key, intervalMinutes: 0, ...settings } };
  await p.onload();
  return { p, app };
}

test('起服务、造数据', { timeout: 30_000 }, async () => {
  await startServer();
  D = await import('../server/db.js');
  const r = await api('/api/auth/register', { method: 'POST', body: { username: `ob${process.pid}`, password: 'secret123' } });
  uid = r.data.user.id;
  const token = r.data.token;
  personaId = (await api('/api/personas', { method: 'POST', token, body: { name: '小鹿旅行记', platform: 'douyin' } })).data.persona.id;
  key = (await api('/api/sync-keys', { method: 'POST', token, body: { name: '测试' } })).data.key;
  assert.match(key, /^ips_/);

  const persona = await D.Personas.byId(personaId, uid);
  const a = await D.Drafts.create(uid, { subject: '大理', platform: 'xiaohongshu', tone: '实用干货', audience: '', keywords: '', length: 600 }, persona);
  await D.Drafts.saveContent(a.id, uid, '# 云南大理3天2夜攻略\n\n第一天 <此处放图片>\n\n## 第二天\n\n环洱海 #旅行攻略 #云南');
  await D.Drafts.setTitle(a.id, uid, '云南大理3天2夜攻略');
  await D.Drafts.setVariants(a.id, uid, { weibo: { content: '# 微博版\n\n大理真好 #大理#', chars: 4 } });
  const pic = `${a.id}-__main__-0.png`;
  await mkdir(join(process.env.DATA_DIR, 'images', String(uid)), { recursive: true });
  await writeFile(join(process.env.DATA_DIR, 'images', String(uid), pic), Buffer.from(PNG, 'base64'));
  await D.Drafts.setIllus(a.id, uid, { __main__: { items: [{ i: 0, alt: '洱海', image: { file: `${uid}/${pic}`, at: '1' } }] } });
  await D.Drafts.setPublished(a.id, uid, '2026-10-01');
  ids.a = a.id;

  const b = await D.Drafts.create(uid, { subject: '周末备菜: 清单?', platform: 'gongzhonghao', tone: '实用干货', audience: '', keywords: '', length: 600 });
  await D.Drafts.saveContent(b.id, uid, '正文');
  ids.b = b.id;
  const c = await D.Drafts.create(uid, { subject: '还在选方向', platform: 'xiaohongshu', tone: '实用干货', audience: '', keywords: '', length: 600 });
  ids.c = c.id;
});

test('文件名：Windows 不允许的字符、保留名、结尾的点都处理掉', () => {
  assert.equal(H.safeName('周末备菜: 清单? <a|b>*"x"/\\'), '周末备菜 清单 a b x');
  assert.equal(H.safeName('结尾有点...'), '结尾有点');
  assert.equal(H.safeName('CON'), 'CON_');
  assert.equal(H.safeName(''), '未命名');
  assert.equal(H.demote('# 标题\n```\n# 代码\n```\n###### 六级', 2), '### 标题\n```\n# 代码\n```\n###### 六级');
});

let first;
test('首次同步：按账号分文件夹、属性、配图下载嵌入、其他平台版本、笔记区', async () => {
  const { p, app } = await makePlugin();
  const stat = await p.syncNow();
  assert.ok(stat, notices.join('\n'));
  assert.equal(stat.created, 2);
  assert.equal(stat.images, 1);
  const files = [...app.vault.files.keys()].sort();
  const noteA = `自媒体助手/小鹿旅行记/2026-10-01 云南大理3天2夜攻略.md`;
  const today = new Date().toISOString().slice(0, 10);
  assert.ok(files.includes(noteA), files.join('\n'));
  assert.ok(files.includes(`自媒体助手/未关联账号/${today} 周末备菜 清单.md`), files.join('\n'));
  assert.ok(files.includes(`自媒体助手/附件/ips-${ids.a}-${ids.a}-__main__-0.png`));
  assert.ok(!files.some((f) => f.includes('还在选方向')), '没成稿的不同步');
  const img = app.vault.files.get(`自媒体助手/附件/ips-${ids.a}-${ids.a}-__main__-0.png`);
  assert.equal(Buffer.from(img.data).toString('base64'), PNG);

  const text = app.vault.files.get(noteA).content;
  assert.match(text, new RegExp(`^---\\nips_id: ${ids.a}\\ntitle: "云南大理3天2夜攻略"\\naccount: "小鹿旅行记"\\nplatform: "小红书"\\npublished: 2026-10-01\\n`));
  assert.match(text, /tags:\n {2}- "旅行攻略"\n {2}- "云南"\nsource: 自媒体助手\n---/);
  assert.ok(text.includes(`第一天\n\n![[自媒体助手/附件/ips-${ids.a}-${ids.a}-__main__-0.png]]\n\n## 第二天`), text);
  assert.ok(text.includes('## 其他平台版本\n\n### 微博\n\n### 微博版\n\n大理真好 #大理#'), text);
  assert.ok(text.endsWith(`## 我的笔记\n${H.NOTES_MARK}\n\n`), text);
  assert.ok(p.state.cursor.endsWith(`|${ids.b}`) || p.state.cursor.endsWith(`|${ids.a}`));
  assert.equal(p.state.lastResult, '新增 2 篇，下载配图 1 张');
  first = { p, app, noteA };
});

test('标题改了：改名、正文更新、我的笔记保留；没变化时什么都不写', async () => {
  const { p, app, noteA } = first;
  const f = app.vault.files.get(noteA);
  f.content += '自己写的心得：第二天别去太早。\n';
  await D.Drafts.setTitle(ids.a, uid, '大理3天2夜，这样玩不踩坑');
  await D.Drafts.saveContent(ids.a, uid, '# 大理3天2夜，这样玩不踩坑\n\n第一天 <此处放图片>\n\n改过的第二天');
  const stat = await p.syncNow();
  assert.deepEqual([stat.created, stat.updated, stat.renamed, stat.images], [0, 1, 1, 0]);
  assert.ok(!app.vault.files.has(noteA));
  const renamed = '自媒体助手/小鹿旅行记/2026-10-01 大理3天2夜，这样玩不踩坑.md';
  const text = app.vault.files.get(renamed).content;
  assert.ok(text.includes('改过的第二天'));
  assert.ok(text.includes(`${H.NOTES_MARK}\n\n自己写的心得：第二天别去太早。`), text);
  assert.equal(text.split(H.NOTES_MARK).length, 2, '笔记标记只有一个');

  const again = await p.syncNow();
  assert.deepEqual([again.created, again.updated], [0, 0]);
  assert.equal(p.state.lastResult, '没有新的成稿');

  // 全部重新同步：都拉一遍，但内容没变就不重写
  await p.resync();
  assert.equal(p.state.lastResult, '没有新的成稿');
  assert.equal(app.vault.getMarkdownFiles().length, 2);
});

test('接口可以配成完整网址；密钥错了报服务端的话、cursor 不动', async () => {
  const { p, app } = await makePlugin({ serverUrl: '', exportPath: `${BASE}/api/export/drafts`, byAccount: false, includeVariants: false });
  assert.equal(await p.testConnection(), `ob${process.pid}`);
  const stat = await p.syncNow();
  assert.equal(stat.created, 2);
  const names = app.vault.getMarkdownFiles().map((f) => f.path);
  assert.ok(names.every((n) => /^自媒体助手\/[^/]+\.md$/.test(n)), names.join('\n'));
  assert.ok(!app.vault.getMarkdownFiles().some((f) => f.content.includes('其他平台版本')));

  const cursor = p.state.cursor;
  p.settings.apiKey = 'ips_' + '0'.repeat(40);
  assert.equal(await p.syncNow(), null);
  assert.match(p.state.lastResult, /同步失败：同步密钥无效或已作废/);
  assert.equal(p.state.cursor, cursor);

  const { p: empty } = await makePlugin({ serverUrl: '', apiKey: key });
  assert.equal(await empty.syncNow(), null);
  assert.match(notices.at(-1), /先在插件设置里填服务器地址/);
});

test('配图文件在服务器上已经没有了：跳过这张图，这篇照样同步（以前会卡在这一篇，每次都报「图片不存在」）', async () => {
  const { p, app } = await makePlugin();
  await p.syncNow();
  const d = await D.Drafts.create(uid, { subject: '缺图', platform: 'xiaohongshu', tone: '实用干货', audience: '', keywords: '', length: 600 });
  await D.Drafts.saveContent(d.id, uid, '有图 <此处放图片>\n\n后面的正文');
  const pic = `${d.id}-__main__-0.png`;
  await D.Drafts.setIllus(d.id, uid, { __main__: { items: [{ i: 0, alt: '图', image: { file: `${uid}/${pic}`, at: '1' } }] } });
  const listed = await api('/api/export/drafts?limit=50', { token: key });
  assert.deepEqual(listed.data.items.find((x) => x.id === d.id).images, []);

  const stat = await p.syncNow();
  assert.ok(stat, p.state.lastResult);
  assert.equal(stat.created, 1);
  assert.equal(stat.images, 0);
  const note = app.vault.getMarkdownFiles().find((f) => f.content.includes('后面的正文'));
  assert.ok(note);
  assert.ok(!note.content.includes('ips-image:'), '没下载到的图要去掉，不能留占位');

  // 插件这边也兜底：列出来了但下载时 404（比如刚好被删），跳过不报错
  const missing = await p.downloadImages({ id: d.id, images: [{ name: pic, url: `/api/export/images/${pic}` }] }, BASE, {});
  assert.deepEqual(missing, {});
});

test('设置页能画出来；网页能下载插件文件', async () => {
  const { p } = await makePlugin();
  p.tab.display();
  for (const f of ['main.js', 'manifest.json', 'styles.css']) {
    const r = await fetch(`${BASE}/api/export/plugin/${f}`);
    assert.equal(r.status, 200, f);
  }
  const manifest = await (await fetch(`${BASE}/api/export/plugin/manifest.json`)).json();
  assert.equal(manifest.id, 'ip-studio-sync');
  assert.equal((await fetch(`${BASE}/api/export/plugin/..%2Fpackage.json`)).status, 404);
});

test('停服务', { timeout: 40_000 }, async () => {
  Module._load = origLoad;
  const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
  child.kill('SIGTERM');
  assert.equal(await exited, 0, log.slice(-2000));
});
