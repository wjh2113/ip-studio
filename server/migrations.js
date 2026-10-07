/* 数据库迁移：按编号执行，已跑过的不再跑。
 *
 * 版本号在 schema_migrations 表里。每个迁移包在一个事务里：
 * 中途失败整体回滚，版本号不变，下次启动重试。
 *
 * 以后改表：在 MIGRATIONS 末尾加一项，版本号 +1，不要改已有的迁移。
 * 同时改 server/schema.js，让 Drizzle 的字段和表一致。
 *
 * 版本 1 是 PostgreSQL 基线，已经包含原先 SQLite 1 到 6 号迁移的最终结构。
 */

import { getDatabase } from './client.js';

export const MIGRATIONS = [
  { version: 1, name: '基线：PostgreSQL 全表', up: baseline },
  { version: 2, name: '同一件事只能有一个在排队或在跑的任务', up: async (db) => {
    // 并发连点时（SQLite 同步执行时碰不到）可能已经建出重复任务：每组留一条（优先留在跑的，其次最新的），
    // 其余记为取消，并把它们预扣的点数退回去（取消的任务启动恢复时不会再管它）
    await db.exec(`
      WITH ranked AS (
        SELECT id, user_id, held, row_number() OVER (
          PARTITION BY user_id, ref ORDER BY (status = 'running') DESC, id DESC
        ) AS rn
        FROM jobs WHERE ref <> '' AND status IN ('queued', 'running')
      ),
      dups AS (SELECT id, user_id, held FROM ranked WHERE rn > 1),
      refund AS (
        UPDATE users u SET used = GREATEST(0, u.used - ROUND(s.h)::integer)
        FROM (SELECT user_id, SUM(held) AS h FROM dups WHERE held > 0 GROUP BY user_id) s
        WHERE u.id = s.user_id
        RETURNING u.id
      )
      UPDATE jobs SET status = 'cancelled', held = 0, error = '重复任务，已合并',
        finished_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      WHERE id IN (SELECT id FROM dups);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_active_ref ON jobs(user_id, ref)
        WHERE ref <> '' AND status IN ('queued', 'running');
    `);
  } },
  { version: 3, name: '同一条提示词同时只能启用一版', up: async (db) => {
    // 以前「先停用再启用」不在一个事务里，可能已经有两版同时启用：每条只留最新那版
    await db.exec(`
      UPDATE prompt_revisions SET active = 0
      WHERE active = 1 AND id NOT IN (SELECT MAX(id) FROM prompt_revisions WHERE active = 1 GROUP BY feature);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_prompt_one_active ON prompt_revisions(feature) WHERE active = 1;
    `);
  } },
  { version: 4, name: '手机 App：离线收件箱去重表、对标速存', up: async (db) => {
    // inbox_keys：App 离线攒的条目会重发，按 (user_id, key) 记住处理过的，重发只回上次的结果
    // benchmarks：对标内容只存标题、提纲和开头摘要，不存全文
    await db.exec(`
      CREATE TABLE IF NOT EXISTS inbox_keys (
        user_id    integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        key        text NOT NULL,
        kind       text NOT NULL,
        ref_id     integer,
        created_at text NOT NULL,
        PRIMARY KEY (user_id, key)
      );

      CREATE TABLE IF NOT EXISTS benchmarks (
        id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        user_id      integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        persona_id   integer NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
        url          text NOT NULL DEFAULT '',
        title        text NOT NULL DEFAULT '',
        outline_json text NOT NULL DEFAULT '[]',
        excerpt      text NOT NULL DEFAULT '',
        created_at   text NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_benchmarks_persona ON benchmarks(user_id, persona_id, id DESC);
    `);
  } },
  { version: 5, name: '素材库：设计稿分类、与账号解绑', up: async (db) => {
    // 旧种类对到设计稿：经历/数据/金句/观察 → 文章；案例 → 对标账号。之后素材不再挂账号。
    await db.run(`UPDATE materials SET kind = CASE kind
      WHEN '经历' THEN '文章'
      WHEN '数据' THEN '文章'
      WHEN '金句' THEN '文章'
      WHEN '观察' THEN '文章'
      WHEN '案例' THEN '对标账号'
      ELSE kind
    END`);
    await db.run(`UPDATE materials SET persona_id = NULL WHERE persona_id IS NOT NULL`);
    await db.run(`ALTER TABLE materials ALTER COLUMN kind SET DEFAULT '文章'`);
  } },
  { version: 6, name: '框架库：详细解释与示例', up: async (db) => {
    // 给每个框架补两段：detail 讲清「为什么这么写、什么时候用、容易翻车在哪」；
    // example 给一段能照着学的范文。内置框架的内容在代码里回填，用户框架留空，作者自己补。
    await db.exec(`
      ALTER TABLE frameworks ADD COLUMN IF NOT EXISTS detail  text NOT NULL DEFAULT '';
      ALTER TABLE frameworks ADD COLUMN IF NOT EXISTS example text NOT NULL DEFAULT '';
    `);
  } },
  { version: 7, name: '同步密钥：Obsidian 插件只读导出成稿', up: async (db) => {
    // 密钥只存 sha256；prefix 是明文的前几位，列表里给人认是哪一把
    await db.exec(`
      CREATE TABLE IF NOT EXISTS sync_keys (
        id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        user_id      integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name         text NOT NULL DEFAULT '',
        key_hash     text NOT NULL,
        prefix       text NOT NULL,
        created_at   text NOT NULL,
        last_used_at text NOT NULL DEFAULT ''
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_keys_hash ON sync_keys(key_hash);
      CREATE INDEX IF NOT EXISTS idx_sync_keys_user ON sync_keys(user_id);
      CREATE INDEX IF NOT EXISTS idx_drafts_user_updated ON drafts(user_id, updated_at, id);
    `);
  } },
];

function toPg(text) {
  let n = 0;
  let out = '';
  let i = 0;
  let quote = null;
  while (i < text.length) {
    const c = text[i];
    if (quote) {
      out += c;
      if (c === quote && text[i + 1] === quote) { out += text[++i]; i++; continue; }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === "'" || c === '"') { quote = c; out += c; i++; continue; }
    if (c === '-' && text[i + 1] === '-') {
      const nl = text.indexOf('\n', i);
      const end = nl === -1 ? text.length : nl + 1;
      out += text.slice(i, end);
      i = end;
      continue;
    }
    if (c === '?') { out += `$${++n}`; i++; continue; }
    out += c;
    i++;
  }
  return out;
}

export function bind(client) {
  return {
    async exec(text) { await client.query(text); },
    async all(text, params = []) {
      const r = await client.query(toPg(text), params);
      return r.rows;
    },
    async get(text, params = []) {
      const rows = await this.all(text, params);
      return rows[0];
    },
    async run(text, params = []) {
      const r = await client.query(toPg(text), params);
      return { changes: r.rowCount, id: r.rows[0]?.id };
    },
  };
}

export async function runMigrations(handle) {
  const pool = handle?.pool || (await getDatabase()).pool;
  const client = await pool.connect();
  // 同时启动的两个进程（比如导入脚本和服务）别一起跑迁移：拿到锁的跑，另一个等它跑完再看版本号
  await client.query('SELECT pg_advisory_lock(hashtext($1))', [MIGRATION_LOCK]);
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version integer PRIMARY KEY,
      name text NOT NULL DEFAULT ''
    )`);
    const cur = await client.query('SELECT COALESCE(MAX(version), 0)::int AS v FROM schema_migrations');
    let version = cur.rows[0].v;
    for (const m of MIGRATIONS) {
      if (m.version <= version) continue;
      await client.query('BEGIN');
      try {
        await m.up(bind(client));
        await client.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [m.version, m.name]);
        await client.query('COMMIT');
        version = m.version;
      } catch (err) {
        try { await client.query('ROLLBACK'); } catch { /* 事务已经结束 */ }
        throw new Error(`数据库迁移 ${m.version}（${m.name}）失败：${err.message}`);
      }
    }
    return version;
  } finally {
    try { await client.query('SELECT pg_advisory_unlock(hashtext($1))', [MIGRATION_LOCK]); } catch { /* 连接断了锁也就没了 */ }
    client.release();
  }
}

const MIGRATION_LOCK = 'ip-studio:migrations';

async function baseline(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      username        text NOT NULL UNIQUE,
      pass_hash       text NOT NULL,
      created_at      text NOT NULL,
      plan            text NOT NULL DEFAULT 'free',
      period          text NOT NULL DEFAULT '',
      used            integer NOT NULL DEFAULT 0,
      avatar_credits  integer NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token       text PRIMARY KEY,
      user_id     integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at  bigint NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

    CREATE TABLE IF NOT EXISTS admins (
      id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      username    text NOT NULL UNIQUE,
      pass_hash   text NOT NULL,
      created_at  text NOT NULL,
      last_login  text NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS admin_sessions (
      token       text PRIMARY KEY,
      admin_id    integer NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
      expires_at  bigint NOT NULL
    );

    CREATE TABLE IF NOT EXISTS personas (
      id               integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id          integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name             text NOT NULL,
      platform         text NOT NULL,
      tone             text NOT NULL,
      content_focus    text NOT NULL DEFAULT '',
      audience         text NOT NULL DEFAULT '',
      problem          text NOT NULL DEFAULT '',
      notes            text NOT NULL DEFAULT '',
      creator_age      text NOT NULL DEFAULT '',
      creator_gender   text NOT NULL DEFAULT '',
      creator_industry text NOT NULL DEFAULT '',
      creator_role     text NOT NULL DEFAULT '',
      creator_traits   text NOT NULL DEFAULT '',
      style_digest     text NOT NULL DEFAULT '',
      style_updated_at text NOT NULL DEFAULT '',
      subject_ideas    text NOT NULL DEFAULT '[]',
      hotspot_json     text NOT NULL DEFAULT 'null',
      created_at       text NOT NULL,
      updated_at       text NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_personas_user ON personas(user_id, id DESC);

    CREATE TABLE IF NOT EXISTS sections (
      id                integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id           integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      persona_id        integer NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
      name              text NOT NULL,
      purpose           text NOT NULL DEFAULT '',
      guide             text NOT NULL DEFAULT '',
      fields_json       text NOT NULL DEFAULT '[]',
      default_framework text NOT NULL DEFAULT '',
      sort              integer NOT NULL DEFAULT 0,
      created_at        text NOT NULL,
      updated_at        text NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sections_persona ON sections(persona_id, sort, id);

    CREATE TABLE IF NOT EXISTS style_samples (
      id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id     integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      persona_id  integer NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
      draft_id    integer,
      title       text NOT NULL DEFAULT '',
      content     text NOT NULL,
      created_at  text NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_samples_persona ON style_samples(persona_id, id DESC);

    CREATE TABLE IF NOT EXISTS drafts (
      id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id        integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subject        text NOT NULL,
      platform       text NOT NULL,
      tone           text NOT NULL,
      audience       text NOT NULL DEFAULT '',
      keywords       text NOT NULL DEFAULT '',
      length         integer NOT NULL DEFAULT 800,
      topics_json    text NOT NULL DEFAULT '[]',
      chosen         integer,
      title          text NOT NULL DEFAULT '',
      content        text NOT NULL DEFAULT '',
      status         text NOT NULL DEFAULT 'topics',
      persona_id     integer REFERENCES personas(id) ON DELETE SET NULL,
      persona_json   text NOT NULL DEFAULT 'null',
      hotspot_json   text NOT NULL DEFAULT 'null',
      section_id     integer REFERENCES sections(id) ON DELETE SET NULL,
      section_json   text NOT NULL DEFAULT 'null',
      inputs_json    text NOT NULL DEFAULT 'null',
      archived_at    text NOT NULL DEFAULT '',
      cues_json      text NOT NULL DEFAULT 'null',
      variants_json  text NOT NULL DEFAULT 'null',
      illus_json     text NOT NULL DEFAULT 'null',
      framework_json text NOT NULL DEFAULT 'null',
      metrics_json   text NOT NULL DEFAULT 'null',
      published_at   text NOT NULL DEFAULT '',
      generated      text NOT NULL DEFAULT '',
      gen_variant    text NOT NULL DEFAULT '',
      edit_ratio     double precision,
      review_json    text NOT NULL DEFAULT 'null',
      created_at     text NOT NULL,
      updated_at     text NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_drafts_user ON drafts(user_id, id DESC);
    CREATE INDEX IF NOT EXISTS idx_drafts_persona ON drafts(user_id, persona_id, id DESC);

    CREATE TABLE IF NOT EXISTS speak_takes (
      id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id      integer NOT NULL,
      draft_id     integer,
      title        text NOT NULL DEFAULT '',
      script       text NOT NULL DEFAULT '',
      cues_json    text NOT NULL DEFAULT 'null',
      file         text NOT NULL DEFAULT '',
      mime         text NOT NULL DEFAULT '',
      bytes        integer NOT NULL DEFAULT 0,
      transcript   text NOT NULL DEFAULT '',
      review_json  text NOT NULL DEFAULT 'null',
      status       text NOT NULL DEFAULT 'running',
      error        text NOT NULL DEFAULT '',
      created_at   text NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_speaks_user ON speak_takes(user_id, id DESC);

    CREATE TABLE IF NOT EXISTS materials (
      id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id     integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      persona_id  integer REFERENCES personas(id) ON DELETE CASCADE,
      kind        text NOT NULL DEFAULT '经历',
      title       text NOT NULL,
      body        text NOT NULL DEFAULT '',
      tags        text NOT NULL DEFAULT '',
      used_count  integer NOT NULL DEFAULT 0,
      created_at  text NOT NULL,
      updated_at  text NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_materials_persona ON materials(user_id, persona_id, id DESC);

    CREATE TABLE IF NOT EXISTS topic_pool (
      id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id     integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      persona_id  integer REFERENCES personas(id) ON DELETE CASCADE,
      subject     text NOT NULL,
      note        text NOT NULL DEFAULT '',
      source      text NOT NULL DEFAULT '手动',
      plan_date   text NOT NULL DEFAULT '',
      draft_id    integer REFERENCES drafts(id) ON DELETE SET NULL,
      status      text NOT NULL DEFAULT 'idea',
      created_at  text NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pool_persona ON topic_pool(user_id, persona_id, id DESC);

    CREATE TABLE IF NOT EXISTS frameworks (
      id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id     integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind        text NOT NULL DEFAULT 'structure',
      name        text NOT NULL,
      summary     text NOT NULL DEFAULT '',
      platforms   text NOT NULL DEFAULT '[]',
      scenes      text NOT NULL DEFAULT '[]',
      slots_json  text NOT NULL DEFAULT '[]',
      source_text text NOT NULL DEFAULT '',
      from_key    text NOT NULL DEFAULT '',
      used_count  integer NOT NULL DEFAULT 0,
      created_at  text NOT NULL,
      updated_at  text NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_frameworks_user ON frameworks(user_id, id DESC);

    CREATE TABLE IF NOT EXISTS draft_revisions (
      id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      draft_id   integer NOT NULL,
      user_id    integer NOT NULL,
      content    text NOT NULL,
      created_at text NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_draft_rev ON draft_revisions(draft_id, user_id, id DESC);

    CREATE TABLE IF NOT EXISTS jobs (
      id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id      integer NOT NULL,
      kind         text NOT NULL,
      ref          text NOT NULL DEFAULT '',
      label        text NOT NULL DEFAULT '',
      payload_json text NOT NULL DEFAULT '{}',
      status       text NOT NULL DEFAULT 'queued',
      result_json  text NOT NULL DEFAULT 'null',
      error        text NOT NULL DEFAULT '',
      held         double precision NOT NULL DEFAULT 0,
      hold_feature text NOT NULL DEFAULT '',
      attempts     integer NOT NULL DEFAULT 0,
      created_at   text NOT NULL,
      started_at   text NOT NULL DEFAULT '',
      finished_at  text NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_user ON jobs(user_id, id DESC);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, id);

    CREATE TABLE IF NOT EXISTS orders (
      id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      out_trade_no  text NOT NULL UNIQUE,
      user_id       integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind          text NOT NULL,
      sku           text NOT NULL,
      amount        integer NOT NULL,
      channel       text NOT NULL,
      status        text NOT NULL DEFAULT 'pending',
      trade_no      text NOT NULL DEFAULT '',
      paid_at       text NOT NULL DEFAULT '',
      granted_at    text NOT NULL DEFAULT '',
      raw           text NOT NULL DEFAULT '',
      created_at    text NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, id DESC);

    CREATE TABLE IF NOT EXISTS settings (
      k          text PRIMARY KEY,
      v          text NOT NULL DEFAULT '',
      secret     integer NOT NULL DEFAULT 0,
      updated_at text NOT NULL,
      updated_by text NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS usage_events (
      id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id       integer,
      feature       text NOT NULL,
      provider      text NOT NULL DEFAULT '',
      model         text NOT NULL DEFAULT '',
      variant       text NOT NULL DEFAULT '',
      ok            integer NOT NULL DEFAULT 1,
      ms            integer NOT NULL DEFAULT 0,
      input_tokens  integer NOT NULL DEFAULT 0,
      output_tokens integer NOT NULL DEFAULT 0,
      units         double precision NOT NULL DEFAULT 0,
      unit          text NOT NULL DEFAULT '',
      error         text NOT NULL DEFAULT '',
      created_at    text NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_usage_time ON usage_events(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_usage_user ON usage_events(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS prompt_variants (
      id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      feature    text NOT NULL,
      name       text NOT NULL,
      system     text NOT NULL,
      weight     integer NOT NULL DEFAULT 1,
      active     integer NOT NULL DEFAULT 0,
      note       text NOT NULL DEFAULT '',
      created_at text NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_variants_feature ON prompt_variants(feature, active);

    CREATE TABLE IF NOT EXISTS prompt_revisions (
      id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      feature    text NOT NULL,
      system     text NOT NULL,
      source     text NOT NULL,
      note       text NOT NULL DEFAULT '',
      active     integer NOT NULL DEFAULT 0,
      user_id    integer NOT NULL DEFAULT 0,
      created_at text NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_prompt_rev ON prompt_revisions(feature, id DESC);

    CREATE TABLE IF NOT EXISTS eval_cases (
      id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      feature    text NOT NULL,
      title      text NOT NULL,
      input_json text NOT NULL DEFAULT '{}',
      created_at text NOT NULL
    );

    CREATE TABLE IF NOT EXISTS eval_runs (
      id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      batch        text NOT NULL,
      case_id      integer NOT NULL REFERENCES eval_cases(id) ON DELETE CASCADE,
      variant_id   integer,
      variant_name text NOT NULL DEFAULT '内置',
      output       text NOT NULL DEFAULT '',
      scores_json  text NOT NULL DEFAULT '{}',
      ms           integer NOT NULL DEFAULT 0,
      error        text NOT NULL DEFAULT '',
      created_at   text NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_runs_batch ON eval_runs(batch, case_id);

    CREATE TABLE IF NOT EXISTS eval_votes (
      id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      batch      text NOT NULL,
      case_id    integer NOT NULL,
      left_id    integer NOT NULL,
      right_id   integer NOT NULL,
      winner     integer NOT NULL DEFAULT 0,
      created_at text NOT NULL
    );
  `);
  await migrateMetrics(db);
}

/* 以前一篇稿子只存一份数字（drafts.metrics_json）。搬成一行快照：日期取发布日期，没有就取最后修改那天。 */
export async function migrateMetrics(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS draft_metrics (
      id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      draft_id    integer NOT NULL,
      user_id     integer NOT NULL,
      platform    text NOT NULL DEFAULT '',
      captured_on text NOT NULL,
      views       integer,
      likes       integer,
      comments    integer,
      shares      integer,
      follows     integer,
      note        text NOT NULL DEFAULT '',
      created_at  text NOT NULL,
      updated_at  text NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_metrics_day ON draft_metrics(draft_id, platform, captured_on);
    CREATE INDEX IF NOT EXISTS idx_metrics_user ON draft_metrics(user_id, draft_id);
  `);
  const rows = await db.all("SELECT id, user_id, platform, metrics_json, published_at, updated_at FROM drafts WHERE metrics_json != 'null'");
  const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.round(Number(v)) : null);
  for (const r of rows) {
    let m;
    try { m = JSON.parse(r.metrics_json); } catch { continue; }
    if (!m || typeof m !== 'object') continue;
    const day = /^\d{4}-\d{2}-\d{2}/.test(r.published_at || '') ? r.published_at.slice(0, 10) : String(r.updated_at || '').slice(0, 10);
    if (!day) continue;
    const at = new Date().toISOString();
    await db.run(`INSERT INTO draft_metrics
      (draft_id, user_id, platform, captured_on, views, likes, comments, shares, follows, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (draft_id, platform, captured_on) DO NOTHING`,
      [r.id, r.user_id, r.platform || '', day, num(m.views), num(m.likes), num(m.comments), num(m.shares), num(m.follows),
        String(m.note || ''), at, at]);
  }
}
