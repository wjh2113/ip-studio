/* 测试环境：每个测试文件是独立进程，先 import 这个文件再 import 被测模块。
   用临时 schema、演示模式，不读 .env（被测模块不会调 loadEnv），不碰真实密钥和数据。 */
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'ip-studio-test-'));
const defaults = {
  DB_PATH: join(dir, 'test.db'),
  DATA_DIR: dir,
  NODE_ENV: 'test',
  LLM_PROVIDER: 'mock',
  IMAGE_PROVIDER: 'mock',
  PAY_PROVIDER: 'mock',
  // 本机 Homebrew / 套接字登录常用当前系统用户；没写用户名时 pg 也会退回 USER
  DATABASE_URL: `postgres://${encodeURIComponent(process.env.USER || 'postgres')}@127.0.0.1:5432/postgres`,
  DB_SCHEMA: `t${process.pid}_${Math.random().toString(36).slice(2, 8)}`,
};
for (const [k, v] of Object.entries(defaults)) process.env[k] ??= v;
// 每个测试进程独占一个 schema。父进程里如果已经有 DB_SCHEMA，不能沿用，否则并行测试会写进同一张表。
process.env.DB_SCHEMA = defaults.DB_SCHEMA;
process.env.NODE_ENV = 'test';
for (const k of ['LLM_GATEWAY_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'ACCESS_PASSWORD', 'ADMIN_PASSWORD']) {
  if (!(k in process.env)) process.env[k] = '';
}
export const TEST_DIR = dir;

test.after(async () => {
  // 先停队列（测试的 Redis 前缀按进程号分开，停的时候顺手清掉，不在 db 15 里越积越多），再关数据库
  const { stopQueue } = await import('../server/jobs.js');
  await stopQueue({ drainMs: 2000 });
  const { closeDb } = await import('../server/client.js');
  await closeDb();
});
