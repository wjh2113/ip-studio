/* 数据层：PostgreSQL + Drizzle。图片和录音仍在 DATA_DIR，不进库。 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { getDatabase, orm } from '../client.js';
import { runMigrations } from '../migrations.js';
import { fromRoot } from '../paths.js';

const fileRoot = process.env.DATA_DIR
  ? resolve(process.env.DATA_DIR)
  : (process.env.DB_PATH ? dirname(resolve(process.env.DB_PATH)) : fromRoot('data'));
export const DATA_DIR = fileRoot;
mkdirSync(DATA_DIR, { recursive: true });

const opened = await getDatabase();
export const db = opened.db;
await runMigrations();

export const now = () => new Date().toISOString();
export const one = async (q) => (await q)[0] ?? null;
export const nums = (row, keys) => {
  if (!row) return row;
  const out = { ...row };
  for (const k of keys) if (out[k] != null) out[k] = Number(out[k]);
  return out;
};
export async function read(statement) {
  const result = await orm().execute(statement);
  return result.rows ?? result;
}
export const same = (col, val) => sql`${col} IS NOT DISTINCT FROM ${val}`;

export const parseJson = (raw, fallback) => { try { return JSON.parse(raw); } catch { return fallback; } };

let changeHook = null;
export const onContentChanged = (fn) => { changeHook = fn; };
export const changed = (userId) => { try { changeHook?.(userId); } catch { /* 通知失败不影响写库 */ } };
