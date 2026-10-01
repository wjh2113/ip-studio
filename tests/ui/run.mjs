/* 浏览器回归测试：npm run test:ui
 *
 * 起一个演示模式的服务（独立 schema、不读 .env），用 Playwright 把主要流程点一遍：
 * 顶栏、用量与支付、热点、创作记录、成稿与标题、框架库与栏目、任务中心（配图 / 口播）、发布数据、快速建号、后台内容质量。
 * 每个流程是本目录下一个脚本，输出 ok / FAIL 行和页面上的报错。
 *
 * 需要：
 *   - 本机 PostgreSQL 和 Redis（和 npm test 一样，DATABASE_URL / REDIS_URL）；
 *   - 先构建前端：npm run build:web（测的是 dist/ 里的真实构建产物）；
 *   - Playwright：npm i -D playwright && npx playwright install chromium（不在默认依赖里，按需装）。
 * 只跑某几个：npm run test:ui -- history jobs
 * 截图：UI_SHOTS=/tmp/shots npm run test:ui */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { Queue } from 'bullmq';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

if (!existsSync(join(root, 'dist', 'index.html'))) {
  console.error('还没有前端构建产物：先运行 npm run build:web');
  process.exit(1);
}
try {
  await import('playwright');
} catch {
  console.error('没装 Playwright：npm i -D playwright && npx playwright install chromium');
  process.exit(1);
}

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://127.0.0.1:5432/postgres';
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const REDIS_PREFIX = `ipstudio-ui-${process.pid}`;
const SCHEMA = `ui_${process.pid}`;
// 配图、录音写到临时目录，跑完删掉，不留在项目的 data/ 里
const DATA_DIR = mkdtempSync(join(tmpdir(), 'ip-studio-ui-'));
const PORT = 21000 + (process.pid % 20000);
const BASE = `http://127.0.0.1:${PORT}`;

const wanted = process.argv.slice(2);
const scripts = readdirSync(here)
  .filter((f) => f.endsWith('.mjs') && f !== 'run.mjs')
  .filter((f) => !wanted.length || wanted.includes(basename(f, '.mjs')))
  .sort();

let log = '';
const server = spawn(process.execPath, [join(root, 'server', 'index.js')], {
  env: {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    USER: process.env.USER,
    LOGNAME: process.env.LOGNAME,
    ENV_FILE: 'none',
    NODE_ENV: 'development',
    PORT: String(PORT),
    HOST: '127.0.0.1',
    DATABASE_URL,
    DB_SCHEMA: SCHEMA,
    REDIS_URL,
    REDIS_PREFIX,
    DATA_DIR,
    LLM_PROVIDER: 'mock',
    IMAGE_PROVIDER: 'mock',
    PAY_PROVIDER: 'mock',
    ALLOW_SELF_UPGRADE: '1',
    RATE_LIMIT: 'off',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', (d) => { log += d; });
server.stderr.on('data', (d) => { log += d; });

async function waitUp() {
  for (let i = 0; i < 100; i += 1) {
    try { if ((await fetch(`${BASE}/health`)).ok) return; } catch { /* 还没起来 */ }
    if (server.exitCode != null) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`服务没起来：\n${log.slice(-2000)}`);
}

function runScript(file) {
  return new Promise((resolve) => {
    const shot = process.env.UI_SHOTS ? join(process.env.UI_SHOTS, basename(file, '.mjs')) : '';
    const p = spawn(process.execPath, [join(here, file), BASE, ...(shot ? [shot] : [])], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => p.kill('SIGKILL'), 180_000);
    p.on('exit', (code) => { clearTimeout(timer); resolve({ code, out }); });
  });
}

/* 页面报错里，接口返回 4xx 的「Failed to load resource」是测试故意触发的（比如介绍太短被拦），不算失败 */
function problems(out, code) {
  const lines = out.split('\n');
  const fails = lines.filter((l) => l.startsWith('FAIL'));
  const errIdx = lines.findIndex((l) => l.startsWith('ERRORS'));
  const errs = errIdx < 0 ? [] : lines.slice(errIdx + 1).filter((l) => l.trim())
    .filter((l) => !/Failed to load resource: the server responded with a status of 4\d\d/.test(l));
  if (code !== 0 && !fails.length) fails.push(`脚本退出码 ${code}`);
  return [...fails, ...errs];
}

let failed = 0;
try {
  await waitUp();
  for (const f of scripts) {
    const { code, out } = await runScript(f);
    const bad = problems(out, code);
    console.log(`\n=== ${basename(f, '.mjs')}${bad.length ? '  ✗' : '  ✓'}`);
    console.log(out.trim());
    if (bad.length) failed += 1;
  }
} finally {
  if (server.exitCode == null) {
    server.kill('SIGTERM');
    await new Promise((r) => { server.once('exit', r); setTimeout(r, 35_000); });
  }
  const c = new pg.Client({ connectionString: DATABASE_URL });
  await c.connect().then(() => c.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`)).catch(() => {}).finally(() => c.end().catch(() => {}));
  rmSync(DATA_DIR, { recursive: true, force: true });
  // 这次跑出来的 Redis 键（按本次的前缀）清掉
  try {
    const u = new URL(REDIS_URL);
    const q = new Queue('ip-studio', {
      prefix: REDIS_PREFIX,
      connection: {
        host: u.hostname,
        port: Number(u.port || 6379),
        db: Number(u.pathname.slice(1) || 0),
        username: u.username ? decodeURIComponent(u.username) : undefined,
        password: u.password ? decodeURIComponent(u.password) : undefined,
        maxRetriesPerRequest: 1,
      },
    });
    await q.obliterate({ force: true });
    await q.close();
  } catch { /* 清不掉不影响结果 */ }
}

console.log(`\n${scripts.length - failed}/${scripts.length} 个流程通过`);
process.exit(failed ? 1 : 0);
