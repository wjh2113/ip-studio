/* PostgreSQL 连接和 Drizzle。事务进行中时，查询走同一条连接。 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

const { Pool, Client, types } = pg;

types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
types.setTypeParser(700, (v) => (v === null ? null : Number(v)));
types.setTypeParser(701, (v) => (v === null ? null : Number(v)));

const txStore = new AsyncLocalStorage();

export const databaseUrl = () => process.env.DATABASE_URL
  || 'postgres://127.0.0.1:5432/ip_studio';

const schemaName = () => {
  const name = process.env.DB_SCHEMA || 'public';
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error(`非法的 DB_SCHEMA：${name}`);
  return name;
};

function withSearchPath(url, schema) {
  if (schema === 'public') return url;
  const u = new URL(url);
  u.searchParams.set('options', `-c search_path=${schema}`);
  return u.toString();
}

async function adminQuery(text) {
  const client = new Client({ connectionString: databaseUrl() });
  await client.connect();
  try { return await client.query(text); }
  finally { await client.end(); }
}

export async function ensureSchema(name = schemaName()) {
  await adminQuery(`CREATE SCHEMA IF NOT EXISTS "${name}"`);
}

const pools = new Set();

export async function openDatabase(name = schemaName()) {
  await ensureSchema(name);
  const pool = new Pool({ connectionString: withSearchPath(databaseUrl(), name), max: 8 });
  pools.add(pool);
  const db = drizzle(pool, { schema });
  return { name, pool, db };
}

let main;
let opening;
export async function getDatabase() {
  if (main) return main;
  if (!opening) {
    opening = openDatabase().then((opened) => { main = opened; return opened; });
  }
  return opening;
}

export function orm() {
  const tx = txStore.getStore();
  if (tx) return tx;
  if (!main) throw new Error('数据库还没连上');
  return main.db;
}

export const inTransaction = () => Boolean(txStore.getStore());

export async function withTx(fn) {
  if (txStore.getStore()) return fn();
  const { db } = await getDatabase();
  return db.transaction(async (tx) => txStore.run(tx, fn));
}

export async function closeDb() {
  const name = schemaName();
  if (main) {
    await main.pool.end();
    pools.delete(main.pool);
    main = null;
    opening = null;
  }
  if (process.env.NODE_ENV === 'test' && name !== 'public') {
    await adminQuery(`DROP SCHEMA IF EXISTS "${name}" CASCADE`);
  }
}

export async function createIsolated(name) {
  const safe = String(name).replace(/[^a-z0-9_]/gi, '').slice(0, 40) || `iso_${process.pid}`;
  const opened = await openDatabase(safe);
  return {
    ...opened,
    async close() {
      await opened.pool.end();
      pools.delete(opened.pool);
      await adminQuery(`DROP SCHEMA IF EXISTS "${safe}" CASCADE`);
    },
  };
}
