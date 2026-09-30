/* 测试环境：每个测试文件是独立进程，先 import 这个文件再 import 被测模块。
   用临时数据库、演示模式，不读 .env（被测模块不会调 loadEnv），不碰真实密钥和数据。 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'ip-studio-test-'));
const defaults = {
  DB_PATH: join(dir, 'test.db'),
  NODE_ENV: 'test',
  LLM_PROVIDER: 'mock',
  IMAGE_PROVIDER: 'mock',
  PAY_PROVIDER: 'mock',
};
for (const [k, v] of Object.entries(defaults)) process.env[k] ??= v;
for (const k of ['LLM_GATEWAY_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'ACCESS_PASSWORD', 'ADMIN_PASSWORD']) {
  if (!(k in process.env)) process.env[k] = '';
}
export const TEST_DIR = dir;
