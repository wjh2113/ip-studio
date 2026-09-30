/* 一次性把旧的 SQLite（data/app.db）拷进 PostgreSQL。
 * 用法：node --env-file=.env scripts/import-sqlite.js data/app.db
 *
 * - 只在 PostgreSQL 里还没有业务数据（用户、账号、稿子都为空）时导入，可以重复执行。
 * - 新服务先启动过一次也没关系：启动时自动建的管理员、提示词版本、运行配置，旧库里有的就以旧库为准
 *   （先清掉新服务写的那份）；旧库里是空的就保留新服务写的。
 * - 整个导入在一个事务里：任何一行出错全部回滚，PostgreSQL 保持空库。
 * - 值按目标列的类型整理：SQLite 列类型不严格，数字列里混进文本、NOT NULL 列里出现 NULL 都会让导入失败，
 *   这里转成目标类型能接受的值（数字列转不了的记 NULL / 0，文本列的 NULL 记空串），并统计改了多少处。
 * - 导入成功后在旧库旁边写一个 <旧库>.imported 标记，部署脚本看到它就不再停服务来导入。
 * 不打印连接串和行内容。 */
import { existsSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { closeDb, getDatabase } from '../server/client.js';
import { runMigrations } from '../server/migrations.js';

const ORDER = [
  'users', 'admins', 'sessions', 'admin_sessions', 'personas', 'sections', 'frameworks',
  'style_samples', 'drafts', 'draft_revisions', 'draft_metrics', 'speak_takes', 'materials',
  'topic_pool', 'jobs', 'orders', 'settings', 'usage_events', 'prompt_variants',
  'prompt_revisions', 'eval_cases', 'eval_runs', 'eval_votes',
];
// 新服务启动时会自己写的表：导入前清空，以旧库为准
const BOOT_TABLES = ['admin_sessions', 'admins', 'prompt_revisions', 'settings'];
// 有任何一张有数据，就认为已经在用了，不导入。users 单独看（见下）
const USER_TABLES = ['personas', 'drafts'];
// 配了 ACCESS_PASSWORD 时，新服务启动会自动建一个访问用户（auth.js 的 ensureAccessUser），它不算「已经在用」
const ACCESS_USER = String(process.env.ACCESS_USER || 'ip').trim() || 'ip';
const BATCH = 500;

const file = process.argv[2] || 'data/app.db';
if (!existsSync(file)) {
  console.log('没有旧库，跳过导入');
  process.exit(0);
}
if (!process.env.DATABASE_URL) {
  console.error('缺少 DATABASE_URL');
  process.exit(1);
}

const INT = new Set(['integer', 'bigint', 'smallint']);
const FLOAT = new Set(['double precision', 'real', 'numeric']);

/* 按目标列整理一个值；改动了就记一笔 */
function coerce(v, col, fixes) {
  const note = () => { fixes.set(col.name, (fixes.get(col.name) || 0) + 1); };
  if (v === undefined) v = null;
  if (typeof v === 'bigint') v = Number(v);
  if (INT.has(col.type) || FLOAT.has(col.type)) {
    if (v === null || v === '') {
      if (v === null && col.nullable) return null;
      note();
      return col.nullable ? null : 0;
    }
    const n = Number(v);
    if (!Number.isFinite(n)) { note(); return col.nullable ? null : 0; }
    if (INT.has(col.type) && !Number.isInteger(n)) { note(); return Math.round(n); }
    return n;
  }
  // 文本列
  if (v === null) {
    if (col.nullable) return null;
    note();
    return '';
  }
  if (v instanceof Uint8Array) { note(); return Buffer.from(v).toString('utf8'); }
  return String(v);
}

const opened = await getDatabase();
await runMigrations(opened);
const client = await opened.pool.connect();
const sqlite = new DatabaseSync(file, { readOnly: true });

try {
  // 已经有真实数据：不导入，并写上标记，之后部署不用再停服务来检查
  const skip = (why) => {
    writeFileSync(`${file}.imported`, `skipped ${new Date().toISOString()}: ${why}\n`);
    console.log(`PostgreSQL 里已有数据（${why}），跳过导入`);
    process.exit(0);
  };
  for (const t of USER_TABLES) {
    const r = await client.query(`SELECT EXISTS (SELECT 1 FROM "${t}") AS has`);
    if (r.rows[0].has) skip(t);
  }
  const others = await client.query('SELECT COUNT(*)::int AS n FROM users WHERE username <> $1', [ACCESS_USER]);
  if (others.rows[0].n > 0) skip('users');

  const have = new Set(sqlite.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  ).all().map((r) => r.name));

  await client.query('BEGIN');
  // 新服务启动时自动建的访问用户：旧库里通常也有同名用户，以旧库为准
  await client.query('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE username = $1)', [ACCESS_USER]);
  await client.query('DELETE FROM users WHERE username = $1', [ACCESS_USER]);
  // 旧库里这张表有数据才清掉新服务写的那份；旧库是空的（比如从没改过提示词）就保留新服务刚写的
  for (const t of BOOT_TABLES) {
    if (have.has(t) && sqlite.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n > 0) {
      await client.query(`DELETE FROM "${t}"`);
    }
  }
  const allFixes = [];
  for (const table of ORDER) {
    if (!have.has(table)) continue;
    const cols = (await client.query(
      `SELECT column_name AS name, data_type AS type, is_nullable = 'YES' AS nullable, column_default IS NOT NULL AS "hasDefault"
       FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = $1 ORDER BY ordinal_position`,
      [table],
    )).rows;
    const srcCols = new Set(sqlite.prepare(`PRAGMA table_info("${table}")`).all().map((r) => r.name));
    const use = cols.filter((c) => srcCols.has(c.name));
    if (!use.length) continue;
    const rows = sqlite.prepare(`SELECT ${use.map((c) => `"${c.name}"`).join(', ')} FROM "${table}"`).all();
    const ident = use.map((c) => `"${c.name}"`).join(', ');
    const hasId = use.some((c) => c.name === 'id');
    const override = hasId ? 'OVERRIDING SYSTEM VALUE' : '';
    const fixes = new Map();

    // 分批多行插入：几万条用量记录一条条插要很久
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      const values = [];
      const tuples = chunk.map((row) => {
        const marks = use.map((c) => {
          values.push(coerce(row[c.name], c, fixes));
          return `$${values.length}`;
        });
        return `(${marks.join(', ')})`;
      });
      await client.query(`INSERT INTO "${table}" (${ident}) ${override} VALUES ${tuples.join(', ')}`, values);
    }
    if (hasId) {
      const seq = await client.query('SELECT pg_get_serial_sequence($1, \'id\') AS seq', [table]);
      if (seq.rows[0]?.seq) {
        // 下一个 id = 现有最大 id + 1；空表从 1 开始
        await client.query(`SELECT setval($1, (SELECT COALESCE(MAX(id), 0) + 1 FROM "${table}"), false)`, [seq.rows[0].seq]);
      }
    }
    const fixed = [...fixes].map(([c, n]) => `${c}×${n}`).join('，');
    if (fixed) allFixes.push(`${table}：${fixed}`);
    console.log(`imported ${table}: ${rows.length}${fixed ? `（整理了 ${fixed}）` : ''}`);
  }
  await client.query('COMMIT');
  writeFileSync(`${file}.imported`, `${new Date().toISOString()}\n`);
  if (allFixes.length) console.log(`有 ${allFixes.length} 张表的部分值按目标类型整理过，见上面各行`);
  console.log('导入完成');
} catch (err) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('导入失败，PostgreSQL 已回滚：', err.message);
  process.exitCode = 1;
} finally {
  sqlite.close();
  client.release();
  await closeDb();
}
