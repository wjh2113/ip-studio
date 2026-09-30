/* 极简 .env 读取：不覆盖已存在的环境变量 */
import { readFileSync } from 'node:fs';
import { fromRoot } from './paths.js';

export function loadEnv(file = process.env.ENV_FILE || fromRoot('.env')) {
  // ENV_FILE=none：一个 .env 都不读（接口测试起服务时用，保证不碰真实密钥和数据库）
  if (file === 'none') return;
  let raw;
  try { raw = readFileSync(file, 'utf8'); } catch { return; }
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 1) continue;
    const key = t.slice(0, eq).trim();
    let value = t.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
