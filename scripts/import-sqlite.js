/* 一次性把旧的 SQLite（data/app.db）拷进 PostgreSQL。
 * 只在目标库还没有用户时导入；已经有用户就退出，可以重复执行。
 * 用法：node --env-file=.env scripts/import-sqlite.js data/app.db
 * 不打印连接串和行内容。 */
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { closeDb, getDatabase } from '../server/client.js';
import { runMigrations } from '../server/migrations.js';

const ORDER = [
  'users', 'admins', 'sessions', 'admin_sessions', 'personas', 'sections', 'frameworks',
  'style_samples', 'drafts', 'draft_revisions', 'draft_metrics', 'speak_takes', 'materials',
  'topic_pool', 'jobs', 'orders', 'settings', 'usage_events', 'prompt_variants',
  'prompt_revisions', 'eval_cases', 'eval_runs', 'eval_votes',
];

const file = process.argv[2] || 'data/app.db';
if (!existsSync(file)) {
  console.log('没有旧库，跳过导入');
  process.exit(0);
}
if (!process.env.DATABASE_URL) {
  console.error('缺少 DATABASE_URL');
  process.exit(1);
}

const opened = await getDatabase();
await runMigrations(opened);
const client = await opened.pool.connect();
const sqlite = new DatabaseSync(file, { readOnly: true });

try {
  const users = await client.query('SELECT COUNT(*)::int AS n FROM users');
  if (users.rows[0].n > 0) {
    console.log('PostgreSQL 里已有用户，跳过导入');
    process.exit(0);
  }

  const have = new Set(sqlite.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  ).all().map((r) => r.name));

  await client.query('BEGIN');
  for (const table of ORDER) {
    if (!have.has(table)) continue;
    const cols = (await client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = $1 ORDER BY ordinal_position`,
      [table],
    )).rows.map((r) => r.column_name);
    const srcCols = sqlite.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name);
    const use = cols.filter((c) => srcCols.includes(c));
    if (!use.length) continue;
    const rows = sqlite.prepare(`SELECT ${use.map((c) => `"${c}"`).join(', ')} FROM "${table}"`).all();
    const ident = use.map((c) => `"${c}"`).join(', ');
    const hasId = use.includes('id');
    for (const row of rows) {
      const values = use.map((c) => row[c] ?? null);
      const marks = values.map((_, i) => `$${i + 1}`).join(', ');
      const override = hasId ? 'OVERRIDING SYSTEM VALUE' : '';
      await client.query(
        `INSERT INTO "${table}" (${ident}) ${override} VALUES (${marks})`,
        values,
      );
    }
    if (hasId) {
      const seq = await client.query('SELECT pg_get_serial_sequence($1, \'id\') AS seq', [table]);
      if (seq.rows[0]?.seq) {
        await client.query(`SELECT setval($1, GREATEST((SELECT COALESCE(MAX(id), 1) FROM "${table}"), 1), true)`, [seq.rows[0].seq]);
      }
    }
    console.log(`imported ${table}: ${rows.length}`);
  }
  await client.query('COMMIT');
} catch (err) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('导入失败', err.message);
  process.exitCode = 1;
} finally {
  sqlite.close();
  client.release();
  await closeDb();
}
