/* 数据库迁移：按编号执行，已跑过的不再跑。
 *
 * 当前版本号存在 SQLite 自带的 PRAGMA user_version 里。
 * 启动时从「当前版本 + 1」开始依次执行，每个迁移包在一个事务里：
 * 中途失败整体回滚，版本号不变，下次启动重试。
 *
 * **以后改表结构：在 MIGRATIONS 末尾加一项，版本号 +1，不要改已有的迁移。**
 *   { version: 2, name: '给 xx 表加 yy 列', up: (db) => db.exec('ALTER TABLE xx ADD COLUMN yy TEXT NOT NULL DEFAULT \'\'') },
 * 新迁移只会在还没跑过它的库上执行，所以不需要再写「列存在就跳过」的判断。
 *
 * 版本 1 是基线：把原来散在 db.js 里的建表和增量迁移原样收进来。它本身是幂等的
 * （CREATE IF NOT EXISTS + 列不存在才 ALTER），所以新库、老库（user_version = 0）都能安全跑。
 */

export const MIGRATIONS = [
  { version: 1, name: '基线：全部建表与历史增量迁移', up: baseline },
  { version: 2, name: '框架库：frameworks 表 + 草稿上的框架快照', up: (db) => db.exec(`
    CREATE TABLE frameworks (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind        TEXT    NOT NULL DEFAULT 'structure',   -- structure；以后加 exemplar / hook / ending / title
      name        TEXT    NOT NULL,
      summary     TEXT    NOT NULL DEFAULT '',
      platforms   TEXT    NOT NULL DEFAULT '[]',          -- 空数组 = 通用
      scenes      TEXT    NOT NULL DEFAULT '[]',
      slots_json  TEXT    NOT NULL DEFAULT '[]',          -- [{role, guide, ratio}]
      source_text TEXT    NOT NULL DEFAULT '',            -- 范文原文（二期拆解用），只作语感参考
      from_key    TEXT    NOT NULL DEFAULT '',            -- 从哪个内置框架复制来的
      used_count  INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT    NOT NULL,
      updated_at  TEXT    NOT NULL
    );
    CREATE INDEX idx_frameworks_user ON frameworks(user_id, id DESC);
    ALTER TABLE drafts ADD COLUMN framework_json TEXT NOT NULL DEFAULT 'null';
  `) },
  { version: 3, name: '栏目默认框架', up: (db) => db.exec(`
    ALTER TABLE sections ADD COLUMN default_framework TEXT NOT NULL DEFAULT '';
  `) },
  { version: 4, name: '长任务队列：jobs 表', up: (db) => db.exec(`
    CREATE TABLE jobs (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL,
      kind         TEXT    NOT NULL,
      ref          TEXT    NOT NULL DEFAULT '',
      label        TEXT    NOT NULL DEFAULT '',
      payload_json TEXT    NOT NULL DEFAULT '{}',
      status       TEXT    NOT NULL DEFAULT 'queued',
      result_json  TEXT    NOT NULL DEFAULT 'null',
      error        TEXT    NOT NULL DEFAULT '',
      held         REAL    NOT NULL DEFAULT 0,
      hold_feature TEXT    NOT NULL DEFAULT '',
      attempts     INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT    NOT NULL,
      started_at   TEXT    NOT NULL DEFAULT '',
      finished_at  TEXT    NOT NULL DEFAULT ''
    );
    CREATE INDEX idx_jobs_user ON jobs(user_id, id DESC);
    CREATE INDEX idx_jobs_status ON jobs(status, id);
  `) },
  { version: 5, name: '发布数据多次回填：draft_metrics 表', up: migrateMetrics },
  { version: 6, name: '线上质量指标：初稿、改动比例、检查建议', up: (db) => db.exec(`
    ALTER TABLE drafts ADD COLUMN generated TEXT NOT NULL DEFAULT '';
    ALTER TABLE drafts ADD COLUMN gen_variant TEXT NOT NULL DEFAULT '';
    ALTER TABLE drafts ADD COLUMN edit_ratio REAL;
    ALTER TABLE drafts ADD COLUMN review_json TEXT NOT NULL DEFAULT 'null';
  `) },
];

/* 以前一篇稿子只存一份数字（drafts.metrics_json），再填就覆盖——看不出「发了三天后涨了多少」。
   现在每次回填存一行快照；同一天同一平台再填就改那一行。drafts.metrics_json 留作「最新一次」的缓存。
   老数据搬成一行快照：日期取发布日期（没有就取最后修改那天）。 */
function migrateMetrics(db) {
  db.exec(`
    CREATE TABLE draft_metrics (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      draft_id    INTEGER NOT NULL,
      user_id     INTEGER NOT NULL,
      platform    TEXT    NOT NULL DEFAULT '',
      captured_on TEXT    NOT NULL,
      views       INTEGER,
      likes       INTEGER,
      comments    INTEGER,
      shares      INTEGER,
      follows     INTEGER,
      note        TEXT    NOT NULL DEFAULT '',
      created_at  TEXT    NOT NULL,
      updated_at  TEXT    NOT NULL
    );
    CREATE UNIQUE INDEX idx_metrics_day ON draft_metrics(draft_id, platform, captured_on);
    CREATE INDEX idx_metrics_user ON draft_metrics(user_id, draft_id);
  `);
  const rows = db.prepare("SELECT id, user_id, platform, metrics_json, published_at, updated_at FROM drafts WHERE metrics_json != 'null'").all();
  const put = db.prepare(`INSERT OR IGNORE INTO draft_metrics
    (draft_id, user_id, platform, captured_on, views, likes, comments, shares, follows, note, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.round(Number(v)) : null);
  for (const r of rows) {
    let m;
    try { m = JSON.parse(r.metrics_json); } catch { continue; }
    if (!m || typeof m !== 'object') continue;
    const day = /^\d{4}-\d{2}-\d{2}/.test(r.published_at || '') ? r.published_at.slice(0, 10) : String(r.updated_at || '').slice(0, 10);
    if (!day) continue;
    const at = new Date().toISOString();
    put.run(r.id, r.user_id, r.platform || '', day, num(m.views), num(m.likes), num(m.comments), num(m.shares), num(m.follows),
      String(m.note || ''), at, at);
  }
}

export function runMigrations(db) {
  const current = db.prepare('PRAGMA user_version').get().user_version;
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      m.up(db);
      db.exec(`PRAGMA user_version = ${Number(m.version)}`);
      db.exec('COMMIT');
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch { /* 事务已经结束 */ }
      throw new Error(`数据库迁移 ${m.version}（${m.name}）失败：${err.message}`);
    }
  }
  return db.prepare('PRAGMA user_version').get().user_version;
}

function baseline(db) {
  db.exec(`

    CREATE TABLE IF NOT EXISTS users (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      username    TEXT    NOT NULL UNIQUE,
      pass_hash   TEXT    NOT NULL,
      created_at  TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token       TEXT    PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at  INTEGER NOT NULL
    );

    /* 账号设定：一个账号 = 一套稳定的定位，其下的创作都继承它 */
    CREATE TABLE IF NOT EXISTS personas (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name           TEXT    NOT NULL,
      platform       TEXT    NOT NULL,
      tone           TEXT    NOT NULL,
      content_focus  TEXT    NOT NULL DEFAULT '',
      audience       TEXT    NOT NULL DEFAULT '',
      problem        TEXT    NOT NULL DEFAULT '',
      notes          TEXT    NOT NULL DEFAULT '',
      /* 个人人设：博主本人的情况，决定第一人称的口吻与取材 */
      creator_age      TEXT  NOT NULL DEFAULT '',
      creator_gender   TEXT  NOT NULL DEFAULT '',
      creator_industry TEXT  NOT NULL DEFAULT '',
      creator_role     TEXT  NOT NULL DEFAULT '',
      creator_traits   TEXT  NOT NULL DEFAULT '',
      /* 语气学习与题材推荐的缓存 */
      style_digest     TEXT  NOT NULL DEFAULT '',
      style_updated_at TEXT  NOT NULL DEFAULT '',
      subject_ideas    TEXT  NOT NULL DEFAULT '[]',
      hotspot_json     TEXT  NOT NULL DEFAULT 'null',
      created_at     TEXT    NOT NULL,
      updated_at     TEXT    NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_personas_user ON personas(user_id, id DESC);

    /* 内容栏目：一个账号下的几条内容线，比如「来时路」「生活日常」
       单独建表而不是塞进 personas 的 JSON 字段，是为了后面能给栏目挂自己的样本、推荐、配额 */
    CREATE TABLE IF NOT EXISTS sections (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      persona_id  INTEGER NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
      name        TEXT    NOT NULL,
      purpose     TEXT    NOT NULL DEFAULT '',
      guide       TEXT    NOT NULL DEFAULT '',
      fields_json TEXT    NOT NULL DEFAULT '[]',
      sort        INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT    NOT NULL,
      updated_at  TEXT    NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sections_persona ON sections(persona_id, sort, id);

    /* 语气样本：用户确认后喂给账号学习的成稿，蒸馏成 personas.style_digest */
    CREATE TABLE IF NOT EXISTS style_samples (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      persona_id  INTEGER NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
      draft_id    INTEGER,
      title       TEXT    NOT NULL DEFAULT '',
      content     TEXT    NOT NULL,
      created_at  TEXT    NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_samples_persona ON style_samples(persona_id, id DESC);

    /* 一次创作 = 一条 draft：题材 -> 三个方向 -> 选定方向 -> 完整文案 */
    CREATE TABLE IF NOT EXISTS drafts (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subject      TEXT    NOT NULL,
      platform     TEXT    NOT NULL,
      tone         TEXT    NOT NULL,
      audience     TEXT    NOT NULL DEFAULT '',
      keywords     TEXT    NOT NULL DEFAULT '',
      length       INTEGER NOT NULL DEFAULT 800,
      topics_json  TEXT    NOT NULL DEFAULT '[]',
      chosen       INTEGER,
      title        TEXT    NOT NULL DEFAULT '',
      content      TEXT    NOT NULL DEFAULT '',
      status       TEXT    NOT NULL DEFAULT 'topics',  -- topics | writing | done
      persona_id   INTEGER REFERENCES personas(id) ON DELETE SET NULL,
      persona_json TEXT    NOT NULL DEFAULT 'null',     -- 创作当时的账号设定快照
      hotspot_json TEXT    NOT NULL DEFAULT 'null',     -- 借势的热点（标题/链接/概要/蹭点）
      section_id   INTEGER REFERENCES sections(id) ON DELETE SET NULL,
      section_json TEXT    NOT NULL DEFAULT 'null',     -- 创作当时的栏目快照
      inputs_json  TEXT    NOT NULL DEFAULT 'null',     -- 作者为该栏目填的素材
      archived_at  TEXT    NOT NULL DEFAULT '',          -- 非空即已归档
      cues_json    TEXT    NOT NULL DEFAULT 'null',       -- 口播提示（语气/重读/停顿/表情/动作）
      variants_json TEXT   NOT NULL DEFAULT 'null',       -- 多平台版本：{平台key: {content, at}}
      illus_json   TEXT    NOT NULL DEFAULT 'null',       -- 图文配图：{版本key: {look, items[]}}
      created_at   TEXT    NOT NULL,
      updated_at   TEXT    NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_drafts_user ON drafts(user_id, id DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

    /* 口播记录独立成表：改稿、重做提示、删稿都不级联删。只有用户点删除才去掉。 */
    CREATE TABLE IF NOT EXISTS speak_takes (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL,
      draft_id     INTEGER,
      title        TEXT    NOT NULL DEFAULT '',
      script       TEXT    NOT NULL DEFAULT '',
      cues_json    TEXT    NOT NULL DEFAULT 'null',
      file         TEXT    NOT NULL DEFAULT '',
      mime         TEXT    NOT NULL DEFAULT '',
      bytes        INTEGER NOT NULL DEFAULT 0,
      transcript   TEXT    NOT NULL DEFAULT '',
      review_json  TEXT    NOT NULL DEFAULT 'null',
      status       TEXT    NOT NULL DEFAULT 'running',
      error        TEXT    NOT NULL DEFAULT '',
      created_at   TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_speaks_user ON speak_takes(user_id, id DESC);
  `);

  /* 已有数据库的增量迁移 */
  {
    const sectionCols = new Set(db.prepare('PRAGMA table_info(sections)').all().map((c) => c.name));
    if (sectionCols.size && !sectionCols.has('fields_json')) {
      db.exec("ALTER TABLE sections ADD COLUMN fields_json TEXT NOT NULL DEFAULT '[]'");
    }

    const personaCols = new Set(db.prepare('PRAGMA table_info(personas)').all().map((c) => c.name));
    for (const col of ['creator_age', 'creator_gender', 'creator_industry', 'creator_role', 'creator_traits',
                       'style_digest', 'style_updated_at']) {
      if (!personaCols.has(col)) db.exec(`ALTER TABLE personas ADD COLUMN ${col} TEXT NOT NULL DEFAULT ''`);
    }
    if (!personaCols.has('subject_ideas')) {
      db.exec("ALTER TABLE personas ADD COLUMN subject_ideas TEXT NOT NULL DEFAULT '[]'");
    }
    if (!personaCols.has('hotspot_json')) {
      db.exec("ALTER TABLE personas ADD COLUMN hotspot_json TEXT NOT NULL DEFAULT 'null'");
    }

    const cols = new Set(db.prepare('PRAGMA table_info(drafts)').all().map((c) => c.name));
    if (!cols.has('persona_id')) db.exec('ALTER TABLE drafts ADD COLUMN persona_id INTEGER REFERENCES personas(id) ON DELETE SET NULL');
    if (!cols.has('persona_json')) db.exec("ALTER TABLE drafts ADD COLUMN persona_json TEXT NOT NULL DEFAULT 'null'");
    if (!cols.has('hotspot_json')) db.exec("ALTER TABLE drafts ADD COLUMN hotspot_json TEXT NOT NULL DEFAULT 'null'");
    if (!cols.has('section_id')) db.exec('ALTER TABLE drafts ADD COLUMN section_id INTEGER REFERENCES sections(id) ON DELETE SET NULL');
    if (!cols.has('section_json')) db.exec("ALTER TABLE drafts ADD COLUMN section_json TEXT NOT NULL DEFAULT 'null'");
    if (!cols.has('inputs_json')) db.exec("ALTER TABLE drafts ADD COLUMN inputs_json TEXT NOT NULL DEFAULT 'null'");
    if (!cols.has('archived_at')) db.exec("ALTER TABLE drafts ADD COLUMN archived_at TEXT NOT NULL DEFAULT ''");
    if (!cols.has('cues_json')) db.exec("ALTER TABLE drafts ADD COLUMN cues_json TEXT NOT NULL DEFAULT 'null'");
    if (!cols.has('variants_json')) db.exec("ALTER TABLE drafts ADD COLUMN variants_json TEXT NOT NULL DEFAULT 'null'");
    if (!cols.has('illus_json')) db.exec("ALTER TABLE drafts ADD COLUMN illus_json TEXT NOT NULL DEFAULT 'null'");
  }

  db.exec(`
    /* 素材库：作者自己的真实经历、数据、案例、金句。
       产品里最硬的一条规则是"素材是全篇唯一可信的事实来源"，
       但素材原来每篇现填、填完就丢——存下来才能复利。 */
    CREATE TABLE IF NOT EXISTS materials (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      persona_id  INTEGER REFERENCES personas(id) ON DELETE CASCADE,
      kind        TEXT    NOT NULL DEFAULT '经历',
      title       TEXT    NOT NULL,
      body        TEXT    NOT NULL DEFAULT '',
      tags        TEXT    NOT NULL DEFAULT '',
      used_count  INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT    NOT NULL,
      updated_at  TEXT    NOT NULL
    );

    /* 选题池：热点里看到的机会、推荐里想留的题材，不当场写也不丢。
       plan_date 空 = 只在池子里；有值 = 排到那天。 */
    CREATE TABLE IF NOT EXISTS topic_pool (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      persona_id  INTEGER REFERENCES personas(id) ON DELETE CASCADE,
      subject     TEXT    NOT NULL,
      note        TEXT    NOT NULL DEFAULT '',
      source      TEXT    NOT NULL DEFAULT '手动',
      plan_date   TEXT    NOT NULL DEFAULT '',
      draft_id    INTEGER REFERENCES drafts(id) ON DELETE SET NULL,
      status      TEXT    NOT NULL DEFAULT 'idea',
      created_at  TEXT    NOT NULL
    );
  `);

  db.exec(`
    /* 提示词变体：同一个功能可以挂多份 system，按权重分流。
       不改代码就能试新提示词，而且每次调用都记下用的哪一份——
       没有这个记录，A/B 就只是"换了个提示词然后感觉好像好点"。 */
    CREATE TABLE IF NOT EXISTS prompt_variants (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      feature    TEXT    NOT NULL,
      name       TEXT    NOT NULL,
      system     TEXT    NOT NULL,
      weight     INTEGER NOT NULL DEFAULT 1,
      active     INTEGER NOT NULL DEFAULT 0,
      note       TEXT    NOT NULL DEFAULT '',
      created_at TEXT    NOT NULL
    );

    /* eval 用例：固定的输入，用来横向比不同变体。
       input_json 存这个功能需要的全部输入（题材、账号设定快照…）。 */
    CREATE TABLE IF NOT EXISTS eval_cases (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      feature    TEXT    NOT NULL,
      title      TEXT    NOT NULL,
      input_json TEXT    NOT NULL DEFAULT '{}',
      created_at TEXT    NOT NULL
    );

    /* eval 结果：一个用例 × 一个变体 = 一条。
       scores_json 是确定性指标（字数、格式痕迹、护栏命中…），
       verdict 是盲测里人工选的胜者，两者分开存——一个是客观量，一个是主观判断。 */
    CREATE TABLE IF NOT EXISTS eval_runs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      batch       TEXT    NOT NULL,
      case_id     INTEGER NOT NULL REFERENCES eval_cases(id) ON DELETE CASCADE,
      variant_id  INTEGER,
      variant_name TEXT   NOT NULL DEFAULT '内置',
      output      TEXT    NOT NULL DEFAULT '',
      scores_json TEXT    NOT NULL DEFAULT '{}',
      ms          INTEGER NOT NULL DEFAULT 0,
      error       TEXT    NOT NULL DEFAULT '',
      created_at  TEXT    NOT NULL
    );

    /* 盲测：一个用例下两个变体两两对比，人工选一个。
       winner 存 variant_id，平局存 0。 */
    CREATE TABLE IF NOT EXISTS eval_votes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      batch      TEXT    NOT NULL,
      case_id    INTEGER NOT NULL,
      left_id    INTEGER NOT NULL,
      right_id   INTEGER NOT NULL,
      winner     INTEGER NOT NULL DEFAULT 0,
      created_at TEXT    NOT NULL
    );
  `);

  /* 套餐与配额。
     托管密钥的 SaaS 里这不是商业功能，是安全底线——没有它，一个用户能把平台的 key 跑爆。 */
  {
    const cols = new Set(db.prepare('PRAGMA table_info(users)').all().map((c) => c.name));
    if (!cols.has('plan')) db.exec("ALTER TABLE users ADD COLUMN plan TEXT NOT NULL DEFAULT 'free'");
    // 当前计费周期（YYYY-MM）与本周期已用点数。跨月自动重置，不需要定时任务
    if (!cols.has('period')) db.exec("ALTER TABLE users ADD COLUMN period TEXT NOT NULL DEFAULT ''");
    if (!cols.has('used')) db.exec('ALTER TABLE users ADD COLUMN used INTEGER NOT NULL DEFAULT 0');
    // 加购包点数池：单独一个池子，不跟月度额度一起清零——买了就是买了（历史列名沿用 avatar_credits）
    if (!cols.has('avatar_credits')) db.exec('ALTER TABLE users ADD COLUMN avatar_credits INTEGER NOT NULL DEFAULT 0');
  }

  db.exec(`
    /* 订单。支付里唯一不能马虎的地方，几条硬规则都体现在字段上：
       - 订单是唯一真相：用户套餐由订单驱动，不由回调直接改
       - out_trade_no 是幂等键：回调会重复推送，靠它去重
       - amount 落库：回调里的金额必须和这里比对，不能信任回调带来的数字
       - raw 存回调原文：对账和纠纷时唯一的凭据 */
    CREATE TABLE IF NOT EXISTS orders (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      out_trade_no  TEXT    NOT NULL UNIQUE,
      user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind          TEXT    NOT NULL,              -- plan | pack
      sku           TEXT    NOT NULL,              -- pro / max / 加购包 key …
      amount        INTEGER NOT NULL,              -- 分。用整数，浮点算钱迟早出事
      channel       TEXT    NOT NULL,              -- wechat | alipay | mock
      status        TEXT    NOT NULL DEFAULT 'pending',  -- pending | paid | granted | closed
      trade_no      TEXT    NOT NULL DEFAULT '',   -- 渠道侧交易号
      paid_at       TEXT    NOT NULL DEFAULT '',
      granted_at    TEXT    NOT NULL DEFAULT '',
      raw           TEXT    NOT NULL DEFAULT '',
      created_at    TEXT    NOT NULL
    );
  `);

  db.exec('CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, id DESC)');

  db.exec(`
    /* 运行时配置。敏感项加密存（见 secrets.js），非敏感项明文。
       env 里配了的一律以 env 为准——生产可以完全锁死在环境变量里，后台只填空缺。 */
    CREATE TABLE IF NOT EXISTS settings (
      k          TEXT PRIMARY KEY,
      v          TEXT NOT NULL DEFAULT '',
      secret     INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL DEFAULT ''
    );
  `);

  db.exec('CREATE INDEX IF NOT EXISTS idx_variants_feature ON prompt_variants(feature, active)');

  db.exec('CREATE INDEX IF NOT EXISTS idx_runs_batch ON eval_runs(batch, case_id)');

  /* 调用时用了哪个变体——A/B 的全部意义都在这一列上 */
  {
    const cols = new Set(db.prepare('PRAGMA table_info(usage_events)').all().map((c) => c.name));
    if (cols.size && !cols.has('variant')) db.exec("ALTER TABLE usage_events ADD COLUMN variant TEXT NOT NULL DEFAULT ''");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS prompt_revisions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      feature    TEXT    NOT NULL,
      system     TEXT    NOT NULL,
      source     TEXT    NOT NULL,
      note       TEXT    NOT NULL DEFAULT '',
      active     INTEGER NOT NULL DEFAULT 0,
      user_id    INTEGER NOT NULL DEFAULT 0,
      created_at TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_prompt_rev ON prompt_revisions(feature, id DESC);

    CREATE TABLE IF NOT EXISTS draft_revisions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      draft_id   INTEGER NOT NULL,
      user_id    INTEGER NOT NULL,
      content    TEXT    NOT NULL,
      created_at TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_draft_rev ON draft_revisions(draft_id, user_id, id DESC);
  `);

  db.exec('CREATE INDEX IF NOT EXISTS idx_materials_persona ON materials(user_id, persona_id, id DESC)');

  db.exec('CREATE INDEX IF NOT EXISTS idx_pool_persona ON topic_pool(user_id, persona_id, id DESC)');

  /* 发布数据：回填之后才能知道"什么有效"，语气档案只学了"你怎么写" */
  {
    const cols = new Set(db.prepare('PRAGMA table_info(drafts)').all().map((c) => c.name));
    if (!cols.has('metrics_json')) db.exec("ALTER TABLE drafts ADD COLUMN metrics_json TEXT NOT NULL DEFAULT 'null'");
    if (!cols.has('published_at')) db.exec("ALTER TABLE drafts ADD COLUMN published_at TEXT NOT NULL DEFAULT ''");
  }

  /* 计费量。原来只记了 tokens，配图的张数等非 token 单位全传 0，
     于是"花了多少钱"根本算不出来——先把量存下来。 */
  {
    const cols = new Set(db.prepare('PRAGMA table_info(usage_events)').all().map((c) => c.name));
    if (cols.size && !cols.has('units')) db.exec('ALTER TABLE usage_events ADD COLUMN units REAL NOT NULL DEFAULT 0');
    if (cols.size && !cols.has('unit')) db.exec("ALTER TABLE usage_events ADD COLUMN unit TEXT NOT NULL DEFAULT ''");
  }

  db.exec('CREATE INDEX IF NOT EXISTS idx_drafts_persona ON drafts(user_id, persona_id, id DESC)');

  db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      username    TEXT    NOT NULL UNIQUE,
      pass_hash   TEXT    NOT NULL,
      created_at  TEXT    NOT NULL,
      last_login  TEXT    NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS admin_sessions (
      token       TEXT    PRIMARY KEY,
      admin_id    INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
      expires_at  INTEGER NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS usage_events (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       INTEGER,
      feature       TEXT    NOT NULL,
      provider      TEXT    NOT NULL DEFAULT '',
      model         TEXT    NOT NULL DEFAULT '',
      variant       TEXT    NOT NULL DEFAULT '',
      ok            INTEGER NOT NULL DEFAULT 1,
      ms            INTEGER NOT NULL DEFAULT 0,
      input_tokens  INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      units         REAL    NOT NULL DEFAULT 0,
      unit          TEXT    NOT NULL DEFAULT '',
      error         TEXT    NOT NULL DEFAULT '',
      created_at    TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_usage_time ON usage_events(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_usage_user ON usage_events(user_id, created_at DESC);
  `);
}
