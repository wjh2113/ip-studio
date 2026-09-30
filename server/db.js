/* 数据层：node:sqlite（Node 22 内置），零外部依赖 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fromRoot } from './paths.js';
import { rebindCues, rebindIllus } from './keep.js';
import { runMigrations } from './migrations.js';
import { editRatio } from './quality.js';

const DB_PATH = process.env.DB_PATH ? resolve(process.env.DB_PATH) : fromRoot('data/app.db');
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

/* 音频等附属文件跟数据库放一起，DB_PATH 换到哪它们就跟到哪 */
export const DATA_DIR = dirname(DB_PATH);

db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

/* 表结构全部在 migrations.js：按编号迁移，改表请去那里加一项 */
runMigrations(db);

const now = () => new Date().toISOString();

/* ---------- admins（独立于业务用户的管理员） ---------- */

export const Admins = {
  count() {
    return db.prepare('SELECT COUNT(*) AS n FROM admins').get().n;
  },
  create(username, passHash) {
    const info = db.prepare('INSERT INTO admins (username, pass_hash, created_at) VALUES (?, ?, ?)')
      .run(username, passHash, now());
    return this.byId(Number(info.lastInsertRowid));
  },
  byName(username) {
    return db.prepare('SELECT * FROM admins WHERE username = ?').get(username) || null;
  },
  byId(id) {
    return db.prepare('SELECT * FROM admins WHERE id = ?').get(id) || null;
  },
  setPassword(id, passHash) {
    db.prepare('UPDATE admins SET pass_hash = ? WHERE id = ?').run(passHash, id);
    return this.byId(id);
  },
  touch(id) {
    db.prepare('UPDATE admins SET last_login = ? WHERE id = ?').run(now(), id);
  },
  list() {
    return db.prepare('SELECT id, username, created_at, last_login FROM admins ORDER BY id')
      .all().map((r) => ({ ...r }));
  },
};

export const AdminSessions = {
  create(token, adminId, ttlMs) {
    db.prepare('INSERT INTO admin_sessions (token, admin_id, expires_at) VALUES (?, ?, ?)')
      .run(token, adminId, Date.now() + ttlMs);
  },
  admin(token) {
    if (!token) return null;
    const row = db.prepare('SELECT * FROM admin_sessions WHERE token = ?').get(token);
    if (!row) return null;
    if (Number(row.expires_at) < Date.now()) { this.destroy(token); return null; }
    return Admins.byId(row.admin_id);
  },
  destroy(token) {
    db.prepare('DELETE FROM admin_sessions WHERE token = ?').run(token);
  },
  sweep() {
    db.prepare('DELETE FROM admin_sessions WHERE expires_at < ?').run(Date.now());
  },
};

/* ---------- usage_events（用量埋点） ---------- */

export const Usage = {
  record(e) {
    db.prepare(`
      INSERT INTO usage_events
        (user_id, feature, provider, model, ok, ms, input_tokens, output_tokens,
         units, unit, variant, error, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      e.userId ?? null, e.feature, e.provider || '', e.model || '',
      e.ok ? 1 : 0, Math.round(e.ms || 0),
      e.inputTokens || 0, e.outputTokens || 0,
      // 计费量：配图按张、大模型按 token
      Number(e.units) || 0, e.unit || '',
      e.variant || '',
      String(e.error || '').slice(0, 200), now(),
    );
  },

  totals(sinceIso) {
    return db.prepare(`
      SELECT COUNT(*) AS calls,
             SUM(ok) AS ok_calls,
             SUM(input_tokens) AS input_tokens,
             SUM(output_tokens) AS output_tokens,
             AVG(ms) AS avg_ms
      FROM usage_events WHERE created_at >= ?
    `).get(sinceIso);
  },

  /* 某个用户本周期的消耗明细。用户看的是"我的钱花在哪了"，
     所以按功能分组，不按模型——他不关心是 deepseek 还是万相。 */
  myUsage(userId, periodPrefix) {
    return db.prepare(`
      SELECT feature, COUNT(*) AS calls, SUM(units) AS units, MAX(unit) AS unit,
             SUM(input_tokens + output_tokens) AS tokens
      FROM usage_events
      WHERE user_id = ? AND ok = 1 AND created_at LIKE ?
      GROUP BY feature ORDER BY calls DESC
    `).all(userId, `${periodPrefix}%`).map((r) => ({ ...r }));
  },

  /* 按模型汇总计费量——算钱要落到具体型号上，功能名不够 */
  byModel(sinceIso) {
    return db.prepare(`
      SELECT feature, model, provider,
             COUNT(*) AS calls,
             SUM(units) AS units,
             MAX(unit) AS unit,
             SUM(input_tokens) AS input_tokens,
             SUM(output_tokens) AS output_tokens
      FROM usage_events WHERE created_at >= ? AND ok = 1
      GROUP BY feature, model ORDER BY calls DESC
    `).all(sinceIso).map((r) => ({ ...r }));
  },

  byFeature(sinceIso) {
    return db.prepare(`
      SELECT feature,
             COUNT(*) AS calls,
             SUM(ok) AS ok_calls,
             SUM(input_tokens) AS input_tokens,
             SUM(output_tokens) AS output_tokens,
             CAST(AVG(ms) AS INTEGER) AS avg_ms
      FROM usage_events WHERE created_at >= ?
      GROUP BY feature ORDER BY calls DESC
    `).all(sinceIso).map((r) => ({ ...r }));
  },

  byDay(sinceIso) {
    return db.prepare(`
      SELECT substr(created_at, 1, 10) AS day,
             COUNT(*) AS calls,
             SUM(input_tokens + output_tokens) AS tokens
      FROM usage_events WHERE created_at >= ?
      GROUP BY day ORDER BY day ASC
    `).all(sinceIso).map((r) => ({ ...r }));
  },

  byUser(sinceIso) {
    return db.prepare(`
      SELECT user_id,
             COUNT(*) AS calls,
             SUM(input_tokens + output_tokens) AS tokens,
             MAX(created_at) AS last_at
      FROM usage_events WHERE created_at >= ? AND user_id IS NOT NULL
      GROUP BY user_id
    `).all(sinceIso).map((r) => ({ ...r }));
  },

  recentErrors(limit = 20) {
    return db.prepare(`
      SELECT feature, model, error, created_at FROM usage_events
      WHERE ok = 0 ORDER BY id DESC LIMIT ?
    `).all(limit).map((r) => ({ ...r }));
  },
};

/* ---------- users ---------- */
export const Users = {
  create(username, passHash) {
    const info = db.prepare(
      'INSERT INTO users (username, pass_hash, created_at) VALUES (?, ?, ?)'
    ).run(username, passHash, now());
    return this.byId(Number(info.lastInsertRowid));
  },
  byName(username) {
    return db.prepare('SELECT * FROM users WHERE username = ?').get(username) || null;
  },
  byId(id) {
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
  },
  setPassword(id, passHash) {
    db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(passHash, id);
    return this.byId(id);
  },
  /* 管理后台用：每个用户的资产盘点 */
  overview() {
    return db.prepare(`
      SELECT u.id, u.username, u.created_at,
             (SELECT COUNT(*) FROM personas p WHERE p.user_id = u.id) AS personas,
             (SELECT COUNT(*) FROM sections s WHERE s.user_id = u.id) AS sections,
             (SELECT COUNT(*) FROM drafts d WHERE d.user_id = u.id) AS drafts,
             (SELECT COUNT(*) FROM drafts d WHERE d.user_id = u.id AND d.status = 'done') AS done_drafts,
             (SELECT COUNT(*) FROM style_samples ss WHERE ss.user_id = u.id) AS samples,
             (SELECT MAX(d.updated_at) FROM drafts d WHERE d.user_id = u.id) AS last_draft_at
      FROM users u ORDER BY u.id ASC
    `).all().map((r) => ({ ...r }));
  },
};

/* ---------- sessions ---------- */
export const Sessions = {
  create(token, userId, ttlMs) {
    db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
      .run(token, userId, Date.now() + ttlMs);
  },
  user(token) {
    if (!token) return null;
    const row = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
    if (!row) return null;
    if (Number(row.expires_at) < Date.now()) { this.destroy(token); return null; }
    return Users.byId(row.user_id);
  },
  destroy(token) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  },
  sweep() {
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  },
};

/* ---------- personas（账号设定） ---------- */
export const PERSONA_FIELDS = [
  'name', 'platform', 'tone', 'content_focus', 'audience', 'problem', 'notes',
  'creator_age', 'creator_gender', 'creator_industry', 'creator_role', 'creator_traits',
];
const COLS = PERSONA_FIELDS.join(', ');
const PLACEHOLDERS = PERSONA_FIELDS.map(() => '?').join(', ');
const SETTERS = PERSONA_FIELDS.map((k) => `${k} = ?`).join(', ');

export const Personas = {
  create(userId, f) {
    const t = now();
    const info = db.prepare(`
      INSERT INTO personas (user_id, ${COLS}, created_at, updated_at)
      VALUES (?, ${PLACEHOLDERS}, ?, ?)
    `).run(userId, ...PERSONA_FIELDS.map((k) => f[k]), t, t);
    return this.byId(Number(info.lastInsertRowid), userId);
  },
  update(id, userId, f) {
    const changes = db.prepare(`
      UPDATE personas SET ${SETTERS}, updated_at = ? WHERE id = ? AND user_id = ?
    `).run(...PERSONA_FIELDS.map((k) => f[k]), now(), id, userId).changes;
    return changes ? this.byId(id, userId) : null;
  },
  byId(id, userId) {
    return db.prepare('SELECT * FROM personas WHERE id = ? AND user_id = ?').get(id, userId) || null;
  },
  list(userId) {
    return db.prepare(`
      SELECT p.*,
             (SELECT COUNT(*) FROM drafts d WHERE d.persona_id = p.id) AS draft_count,
             (SELECT COUNT(*) FROM style_samples s WHERE s.persona_id = p.id) AS sample_count
      FROM personas p WHERE p.user_id = ? ORDER BY p.id ASC
    `).all(userId).map((r) => ({ ...r }));
  },
  /* 题材推荐缓存：避免每次打开页面都去问一次模型 */
  setIdeas(id, userId, ideas) {
    db.prepare('UPDATE personas SET subject_ideas = ? WHERE id = ? AND user_id = ?')
      .run(JSON.stringify(ideas), id, userId);
  },
  ideas(id, userId) {
    const row = db.prepare('SELECT subject_ideas FROM personas WHERE id = ? AND user_id = ?').get(id, userId);
    if (!row) return null;
    try { const v = JSON.parse(row.subject_ideas); return Array.isArray(v) ? v : []; } catch { return []; }
  },
  setHotspots(id, userId, payload) {
    db.prepare('UPDATE personas SET hotspot_json = ? WHERE id = ? AND user_id = ?')
      .run(JSON.stringify(payload), id, userId);
  },
  hotspots(id, userId) {
    const row = db.prepare('SELECT hotspot_json FROM personas WHERE id = ? AND user_id = ?').get(id, userId);
    if (!row) return undefined;
    try { return JSON.parse(row.hotspot_json); } catch { return null; }
  },
  setDigest(id, userId, digest) {
    db.prepare('UPDATE personas SET style_digest = ?, style_updated_at = ? WHERE id = ? AND user_id = ?')
      .run(digest, now(), id, userId);
  },
  remove(id, userId) {
    return db.prepare('DELETE FROM personas WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
  },
};

/* ---------- sections（内容栏目） ---------- */
export const Sections = {
  create(userId, personaId, f) {
    const t = now();
    const next = db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM sections WHERE persona_id = ?')
      .get(personaId).n;
    const info = db.prepare(`
      INSERT INTO sections (user_id, persona_id, name, purpose, guide, fields_json, default_framework, sort, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, personaId, f.name, f.purpose, f.guide, JSON.stringify(f.fields || []), f.default_framework || '', next, t, t);
    return this.byId(Number(info.lastInsertRowid), userId);
  },
  update(id, userId, f) {
    const changed = db.prepare(`
      UPDATE sections SET name = ?, purpose = ?, guide = ?, fields_json = ?, default_framework = ?, updated_at = ?
      WHERE id = ? AND user_id = ?
    `).run(f.name, f.purpose, f.guide, JSON.stringify(f.fields || []), f.default_framework || '', now(), id, userId).changes;
    return changed ? this.byId(id, userId) : null;
  },
  byId(id, userId) {
    const row = db.prepare('SELECT * FROM sections WHERE id = ? AND user_id = ?').get(id, userId);
    return row ? hydrateSection(row) : null;
  },
  list(personaId, userId) {
    return db.prepare(`
      SELECT s.*, (SELECT COUNT(*) FROM drafts d WHERE d.section_id = s.id) AS draft_count
      FROM sections s WHERE s.persona_id = ? AND s.user_id = ?
      ORDER BY s.sort ASC, s.id ASC
    `).all(personaId, userId).map(hydrateSection);
  },
  remove(id, userId) {
    return db.prepare('DELETE FROM sections WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
  },
};

function hydrateSection(row) {
  let fields = [];
  try { const v = JSON.parse(row.fields_json); if (Array.isArray(v)) fields = v; } catch { /* 脏数据当空 */ }
  const { fields_json, ...rest } = row;
  return { ...rest, fields };
}

/* ---------- 运行时配置 ---------- */
export const Settings = {
  all() {
    return db.prepare('SELECT * FROM settings').all().map((r) => ({ ...r }));
  },
  get(k) {
    return db.prepare('SELECT v, secret FROM settings WHERE k = ?').get(k) || null;
  },
  set(k, v, secret, by) {
    db.prepare(`
      INSERT INTO settings (k, v, secret, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(k) DO UPDATE SET v = excluded.v, secret = excluded.secret,
        updated_at = excluded.updated_at, updated_by = excluded.updated_by
    `).run(k, v, secret ? 1 : 0, now(), by || '');
  },
  remove(k) {
    return db.prepare('DELETE FROM settings WHERE k = ?').run(k).changes > 0;
  },
};

/* ---------- 订单 ---------- */
export const Orders = {
  create(o) {
    db.prepare(`
      INSERT INTO orders (out_trade_no, user_id, kind, sku, amount, channel, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(o.no, o.userId, o.kind, o.sku, o.amount, o.channel, now());
    return this.byNo(o.no);
  },
  byNo(no) {
    return db.prepare('SELECT * FROM orders WHERE out_trade_no = ?').get(no) || null;
  },
  listByUser(userId, limit = 20) {
    return db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT ?')
      .all(userId, limit).map((r) => ({ ...r }));
  },
  /* 标记已支付。**只有 pending 能变 paid**——回调重复推送时第二次就不会命中，
     changes 为 0 说明已经处理过，调用方据此跳过发货。 */
  markPaid(no, tradeNo, raw) {
    return db.prepare(`
      UPDATE orders SET status = 'paid', trade_no = ?, paid_at = ?, raw = ?
      WHERE out_trade_no = ? AND status = 'pending'
    `).run(tradeNo || '', now(), String(raw || '').slice(0, 4000), no).changes > 0;
  },
  markGranted(no) {
    db.prepare("UPDATE orders SET status = 'granted', granted_at = ? WHERE out_trade_no = ?").run(now(), no);
  },
  close(no) {
    return db.prepare("UPDATE orders SET status = 'closed' WHERE out_trade_no = ? AND status = 'pending'")
      .run(no).changes > 0;
  },
};

/* ---------- 套餐与配额 ---------- */
export const Quota = {
  /* 读用户的配额状态，顺手处理跨月重置。
     用"读的时候比对周期"而不是定时任务——单机部署没有调度器，
     而且定时任务漏跑一次就会给用户多送一个月额度。 */
  state(userId, period) {
    const u = db.prepare('SELECT plan, period, used, avatar_credits FROM users WHERE id = ?').get(userId);
    if (!u) return null;
    if (u.period !== period) {
      db.prepare('UPDATE users SET period = ?, used = 0 WHERE id = ?').run(period, userId);
      return { ...u, period, used: 0 };
    }
    return u;
  },
  consume(userId, credits, fromPack = 0) {
    if (fromPack) db.prepare('UPDATE users SET avatar_credits = MAX(0, avatar_credits - ?) WHERE id = ?').run(fromPack, userId);
    if (credits) db.prepare('UPDATE users SET used = used + ? WHERE id = ?').run(credits, userId);
  },
  /* 退回预扣的点数（不会退成负数） */
  refund(userId, credits) {
    if (credits > 0) db.prepare('UPDATE users SET used = MAX(0, used - ?) WHERE id = ?').run(credits, userId);
  },
  setPlan(userId, plan) {
    db.prepare('UPDATE users SET plan = ? WHERE id = ?').run(plan, userId);
  },
  addPack(userId, credits) {
    db.prepare('UPDATE users SET avatar_credits = avatar_credits + ? WHERE id = ?').run(credits, userId);
  },
};

/* ---------- prompt_variants / eval ---------- */
export const Variants = {
  list(feature) {
    const where = feature ? 'WHERE feature = ?' : '';
    return db.prepare(`SELECT * FROM prompt_variants ${where} ORDER BY feature, id`)
      .all(...(feature ? [feature] : [])).map((r) => ({ ...r }));
  },
  byId(id) {
    return db.prepare('SELECT * FROM prompt_variants WHERE id = ?').get(id) || null;
  },
  /* 生效中的变体。权重为 0 的等于关掉，但记录还在 */
  active(feature) {
    return db.prepare('SELECT * FROM prompt_variants WHERE feature = ? AND active = 1 AND weight > 0 ORDER BY id')
      .all(feature).map((r) => ({ ...r }));
  },
  create(v) {
    const info = db.prepare(`
      INSERT INTO prompt_variants (feature, name, system, weight, active, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(v.feature, v.name, v.system, v.weight ?? 1, v.active ? 1 : 0, v.note || '', now());
    return this.byId(Number(info.lastInsertRowid));
  },
  update(id, v) {
    db.prepare('UPDATE prompt_variants SET name = ?, system = ?, weight = ?, active = ?, note = ? WHERE id = ?')
      .run(v.name, v.system, v.weight ?? 1, v.active ? 1 : 0, v.note || '', id);
    return this.byId(id);
  },
  remove(id) {
    return db.prepare('DELETE FROM prompt_variants WHERE id = ?').run(id).changes > 0;
  },
};

export const Evals = {
  cases(feature) {
    const where = feature ? 'WHERE feature = ?' : '';
    return db.prepare(`SELECT * FROM eval_cases ${where} ORDER BY id DESC`)
      .all(...(feature ? [feature] : [])).map((r) => ({ ...r }));
  },
  caseById(id) {
    return db.prepare('SELECT * FROM eval_cases WHERE id = ?').get(id) || null;
  },
  addCase(c) {
    const info = db.prepare('INSERT INTO eval_cases (feature, title, input_json, created_at) VALUES (?, ?, ?, ?)')
      .run(c.feature, c.title, JSON.stringify(c.input || {}), now());
    return this.caseById(Number(info.lastInsertRowid));
  },
  removeCase(id) {
    return db.prepare('DELETE FROM eval_cases WHERE id = ?').run(id).changes > 0;
  },
  addRun(r) {
    const info = db.prepare(`
      INSERT INTO eval_runs (batch, case_id, variant_id, variant_name, output, scores_json, ms, error, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(r.batch, r.caseId, r.variantId ?? null, r.variantName || '内置',
      r.output || '', JSON.stringify(r.scores || {}), Math.round(r.ms || 0), r.error || '', now());
    return Number(info.lastInsertRowid);
  },
  runs(batch) {
    return db.prepare(`
      SELECT r.*, c.title AS case_title, c.feature
      FROM eval_runs r JOIN eval_cases c ON c.id = r.case_id
      WHERE r.batch = ? ORDER BY r.case_id, r.id
    `).all(batch).map((r) => ({ ...r }));
  },
  batches(limit = 20) {
    return db.prepare(`
      SELECT batch, MIN(created_at) AS at, COUNT(*) AS runs,
             COUNT(DISTINCT case_id) AS cases, COUNT(DISTINCT variant_name) AS variants
      FROM eval_runs GROUP BY batch ORDER BY at DESC LIMIT ?
    `).all(limit).map((r) => ({ ...r }));
  },
  vote(v) {
    db.prepare('INSERT INTO eval_votes (batch, case_id, left_id, right_id, winner, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(v.batch, v.caseId, v.leftId, v.rightId, v.winner || 0, now());
  },
  votes(batch) {
    return db.prepare('SELECT * FROM eval_votes WHERE batch = ?').all(batch).map((r) => ({ ...r }));
  },
};

/* ---------- materials（素材库） ---------- */
export const MATERIAL_KINDS = ['经历', '数据', '案例', '金句', '观察'];

export const Materials = {
  create(userId, personaId, m) {
    const t = now();
    const info = db.prepare(`
      INSERT INTO materials (user_id, persona_id, kind, title, body, tags, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, personaId, m.kind, m.title, m.body || '', m.tags || '', t, t);
    return this.byId(Number(info.lastInsertRowid), userId);
  },
  update(id, userId, m) {
    const changes = db.prepare(`
      UPDATE materials SET kind = ?, title = ?, body = ?, tags = ?, updated_at = ?
      WHERE id = ? AND user_id = ?
    `).run(m.kind, m.title, m.body || '', m.tags || '', now(), id, userId).changes;
    return changes ? this.byId(id, userId) : null;
  },
  byId(id, userId) {
    return db.prepare('SELECT * FROM materials WHERE id = ? AND user_id = ?').get(id, userId) || null;
  },
  list(userId, personaId) {
    return db.prepare(`
      SELECT * FROM materials WHERE user_id = ? AND persona_id IS ? ORDER BY id DESC
    `).all(userId, personaId ?? null).map((r) => ({ ...r }));
  },
  remove(id, userId) {
    return db.prepare('DELETE FROM materials WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
  },
  /* 用过的记一笔——哪些素材真的被写进过稿子，界面上能看出来 */
  markUsed(ids, userId) {
    if (!ids.length) return;
    const stmt = db.prepare('UPDATE materials SET used_count = used_count + 1 WHERE id = ? AND user_id = ?');
    for (const id of ids) stmt.run(id, userId);
  },
};

/* ---------- frameworks（框架库：用户自己的；内置的在 frameworks.js） ---------- */
function hydrateFramework(r) {
  const arr = (v) => { try { const x = JSON.parse(v); return Array.isArray(x) ? x : []; } catch { return []; } };
  return {
    key: `u:${r.id}`, id: r.id, builtin: false, kind: r.kind, name: r.name, summary: r.summary,
    platforms: arr(r.platforms), scenes: arr(r.scenes), slots: arr(r.slots_json),
    from_key: r.from_key, used_count: r.used_count, created_at: r.created_at, updated_at: r.updated_at,
    source_chars: String(r.source_text || '').length,   // 原文本身只在需要时单独取，列表里不带
  };
}

export const Frameworks = {
  list(userId) {
    return db.prepare('SELECT * FROM frameworks WHERE user_id = ? ORDER BY id DESC').all(userId).map(hydrateFramework);
  },
  count(userId) {
    return db.prepare('SELECT COUNT(*) AS n FROM frameworks WHERE user_id = ?').get(userId).n;
  },
  byId(id, userId) {
    const r = db.prepare('SELECT * FROM frameworks WHERE id = ? AND user_id = ?').get(id, userId);
    return r ? hydrateFramework(r) : null;
  },
  create(userId, f) {
    const t = now();
    const info = db.prepare(`
      INSERT INTO frameworks (user_id, name, summary, platforms, scenes, slots_json, source_text, from_key, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, f.name, f.summary || '', JSON.stringify(f.platforms || []), JSON.stringify(f.scenes || []),
      JSON.stringify(f.slots), f.source_text || '', f.from_key || '', t, t);
    return this.byId(Number(info.lastInsertRowid), userId);
  },
  update(id, userId, f) {
    const n = db.prepare(`
      UPDATE frameworks SET name = ?, summary = ?, platforms = ?, scenes = ?, slots_json = ?, updated_at = ?
      WHERE id = ? AND user_id = ?
    `).run(f.name, f.summary || '', JSON.stringify(f.platforms || []), JSON.stringify(f.scenes || []),
      JSON.stringify(f.slots), now(), id, userId).changes;
    if (n && f.source_text !== undefined) {
      db.prepare('UPDATE frameworks SET source_text = ? WHERE id = ? AND user_id = ?').run(f.source_text, id, userId);
    }
    return n ? this.byId(id, userId) : null;
  },
  sourceOf(id, userId) {
    return db.prepare('SELECT source_text FROM frameworks WHERE id = ? AND user_id = ?').get(id, userId)?.source_text || '';
  },
  remove(id, userId) {
    return db.prepare('DELETE FROM frameworks WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
  },
  markUsed(id, userId) {
    db.prepare('UPDATE frameworks SET used_count = used_count + 1 WHERE id = ? AND user_id = ?').run(id, userId);
  },
  /* 内置框架的使用次数不存表，从草稿快照里数 */
  builtinUsage(userId) {
    return Object.fromEntries(db.prepare(`
      SELECT json_extract(framework_json, '$.key') AS k, COUNT(*) AS n FROM drafts
      WHERE user_id = ? AND framework_json != 'null' GROUP BY k
    `).all(userId).map((r) => [r.k, r.n]));
  },
};

/* ---------- topic_pool（选题池与排期） ---------- */
export const Pool = {
  create(userId, personaId, t) {
    const info = db.prepare(`
      INSERT INTO topic_pool (user_id, persona_id, subject, note, source, plan_date, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(userId, personaId, t.subject, t.note || '', t.source || '手动', t.plan_date || '', now());
    return this.byId(Number(info.lastInsertRowid), userId);
  },
  byId(id, userId) {
    return db.prepare('SELECT * FROM topic_pool WHERE id = ? AND user_id = ?').get(id, userId) || null;
  },
  list(userId, personaId) {
    return db.prepare(`
      SELECT * FROM topic_pool WHERE user_id = ? AND persona_id IS ?
      ORDER BY (plan_date = '') ASC, plan_date ASC, id DESC
    `).all(userId, personaId ?? null).map((r) => ({ ...r }));
  },
  update(id, userId, patch) {
    const cur = this.byId(id, userId);
    if (!cur) return null;
    db.prepare('UPDATE topic_pool SET subject = ?, note = ?, plan_date = ?, status = ?, draft_id = ? WHERE id = ? AND user_id = ?')
      .run(patch.subject ?? cur.subject, patch.note ?? cur.note,
        patch.plan_date ?? cur.plan_date, patch.status ?? cur.status,
        patch.draft_id ?? cur.draft_id, id, userId);
    return this.byId(id, userId);
  },
  remove(id, userId) {
    return db.prepare('DELETE FROM topic_pool WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
  },
};

/* ---------- style_samples（语气样本） ---------- */
export const Samples = {
  create(userId, personaId, { draftId = null, title = '', content }) {
    const info = db.prepare(`
      INSERT INTO style_samples (user_id, persona_id, draft_id, title, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, personaId, draftId, title, content, now());
    return db.prepare('SELECT * FROM style_samples WHERE id = ?').get(Number(info.lastInsertRowid));
  },
  /* 列表默认不带正文，避免把全文塞进接口响应 */
  list(personaId, userId, { withContent = false, limit = 50 } = {}) {
    const cols = withContent ? '*' : 'id, draft_id, title, created_at, LENGTH(content) AS length';
    return db.prepare(`
      SELECT ${cols} FROM style_samples WHERE persona_id = ? AND user_id = ?
      ORDER BY id DESC LIMIT ?
    `).all(personaId, userId, limit).map((r) => ({ ...r }));
  },
  remove(id, userId) {
    return db.prepare('DELETE FROM style_samples WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
  },
};

/* ---------- drafts ---------- */
export const Drafts = {
  create(userId, f, persona = null, hotspot = null, section = null, inputs = null, framework = null) {
    const t = now();
    const info = db.prepare(`
      INSERT INTO drafts (user_id, subject, platform, tone, audience, keywords, length,
                          topics_json, status, persona_id, persona_json, hotspot_json,
                          section_id, section_json, inputs_json, framework_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, '[]', 'topics', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, f.subject, f.platform, f.tone, f.audience, f.keywords, f.length,
           persona?.id ?? null, JSON.stringify(persona), JSON.stringify(hotspot),
           section?.id ?? null, JSON.stringify(section), JSON.stringify(inputs),
           JSON.stringify(framework), t, t);
    return this.byId(Number(info.lastInsertRowid), userId);
  },
  setTopics(id, userId, topics, persona) {
    withTx(() => {
      const row = db.prepare('SELECT content FROM drafts WHERE id = ? AND user_id = ?').get(id, userId);
      if (row?.content) Revisions.keep(id, userId, row.content);
      db.prepare(`UPDATE drafts SET topics_json = ?, chosen = NULL, title = '', content = '',
                  status = 'topics', persona_json = ?, updated_at = ? WHERE id = ? AND user_id = ?`)
        .run(JSON.stringify(topics), JSON.stringify(persona ?? null), now(), id, userId);
    });
  },
  setContent(id, userId, { chosen, title, content, status }) {
    const next = String(content ?? '');
    withTx(() => {
      const row = db.prepare('SELECT content FROM drafts WHERE id = ? AND user_id = ?').get(id, userId);
      if (row?.content && row.content !== next) Revisions.keep(id, userId, row.content);
      db.prepare(`UPDATE drafts SET chosen = ?, title = ?, content = ?, status = ?, updated_at = ?
                  WHERE id = ? AND user_id = ?`)
        .run(chosen, title, next, status, now(), id, userId);
      if (next) Revisions.keep(id, userId, next);
    });
  },
  /* 用户在编辑器里手工改写后的保存。写入前先把上一版正文留档。
     口播提示和原文配图按新正文留下还能对上的；多平台版本原样保留。 */
  saveContent(id, userId, content, { snapshot = false } = {}) {
    const next = String(content ?? '');
    return withTx(() => {
      const row = db.prepare(
        'SELECT content, cues_json, illus_json, generated FROM drafts WHERE id = ? AND user_id = ?',
      ).get(id, userId);
      if (!row) return null;
      // 自动保存（1.2 秒防抖）每次都留一整版会让库线性膨胀：只有手动保存/离开编辑，
      // 或距上一版超过 REVISION_GAP 才留一版
      const keepOpts = snapshot ? {} : { minGapMs: REVISION_GAP };
      if (snapshot && row.content && row.content !== next) Revisions.keep(id, userId, row.content);
      const cues = rebindCues(next, parseJson(row.cues_json, null));
      const illus = rebindIllus(next, parseJson(row.illus_json, null));
      // 线上指标：模型初稿被作者改掉了多少（没有初稿的老稿子不算）
      const ratio = row.generated ? editRatio(row.generated, next) : null;
      const ok = db.prepare(`UPDATE drafts SET content = ?, status = 'done',
                         cues_json = ?, illus_json = ?, edit_ratio = ?, updated_at = ?
                         WHERE id = ? AND user_id = ?`)
        .run(next, JSON.stringify(cues.cues), JSON.stringify(illus.illus), ratio, now(), id, userId).changes > 0;
      if (!ok) return null;
      Revisions.keep(id, userId, next, keepOpts);
      return { cuesDropped: cues.dropped, illusDropped: illus.dropped };
    });
  },

  /* 模型刚写完的初稿，和用的哪个提示词变体：之后每次保存拿它算改动比例 */
  setGenerated(id, userId, text, variant = '') {
    db.prepare(`UPDATE drafts SET generated = ?, gen_variant = ?, edit_ratio = 0
                WHERE id = ? AND user_id = ?`).run(String(text || ''), variant || '', id, userId);
  },

  /* 最近一次成稿检查的替换建议，只留原句和建议写法：之后看作者有没有改 */
  setReview(id, userId, issues) {
    const keep = (issues || []).filter((it) => it?.quote).slice(0, 40)
      .map((it) => ({ dimension: it.dimension || '', quote: it.quote, fix: it.fix || '' }));
    db.prepare('UPDATE drafts SET review_json = ? WHERE id = ? AND user_id = ?')
      .run(JSON.stringify({ at: now(), issues: keep }), id, userId);
  },

  /* 管理后台的质量指标：一段时间内有初稿的稿子 */
  qualityRows(since) {
    return db.prepare(`SELECT id, gen_variant, edit_ratio, review_json, content FROM drafts
      WHERE generated != '' AND updated_at >= ?`).all(since).map((r) => ({ ...r }));
  },

  setTitle(id, userId, title) {
    db.prepare('UPDATE drafts SET title = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(title, now(), id, userId);
  },

  setCues(id, userId, cues) {
    db.prepare('UPDATE drafts SET cues_json = ?, updated_at = ? WHERE id = ? AND user_id = ?')
      .run(JSON.stringify(cues), now(), id, userId);
  },

  setIllus(id, userId, illus) {
    db.prepare('UPDATE drafts SET illus_json = ?, updated_at = ? WHERE id = ? AND user_id = ?')
      .run(JSON.stringify(illus), now(), id, userId);
  },

  setMetrics(id, userId, metrics, publishedAt) {
    db.prepare('UPDATE drafts SET metrics_json = ?, published_at = ?, updated_at = ? WHERE id = ? AND user_id = ?')
      .run(JSON.stringify(metrics), publishedAt || '', now(), id, userId);
  },

  /* 复盘用：只取已回填数据的稿子，带上分类维度 */
  withMetrics(userId, personaId) {
    const byPersona = personaId !== undefined && personaId !== null;
    return db.prepare(`
      SELECT id, subject, title, platform, section_id, topics_json, metrics_json, framework_json, published_at, created_at
      FROM drafts
      WHERE user_id = ? AND metrics_json != 'null' ${byPersona ? 'AND persona_id = ?' : ''}
      ORDER BY published_at DESC, id DESC LIMIT 200
    `).all(...(byPersona ? [userId, personaId] : [userId])).map((r) => ({ ...r }));
  },

  setVariants(id, userId, variants) {
    db.prepare('UPDATE drafts SET variants_json = ?, updated_at = ? WHERE id = ? AND user_id = ?')
      .run(JSON.stringify(variants), now(), id, userId);
  },

  byId(id, userId) {
    const row = db.prepare('SELECT * FROM drafts WHERE id = ? AND user_id = ?').get(id, userId);
    return row ? hydrate(row) : null;
  },
  /* personaId: undefined = 全部；null = 未绑定账号的；数字 = 指定账号下的
     archived: false = 只看进行中（默认）；true = 只看已归档 */
  list(userId, { personaId, archived = false, limit = 200 } = {}) {
    const byPersona = personaId !== undefined;
    const sql = `
      SELECT id, subject, platform, tone, title, status, persona_id, section_id,
             archived_at, created_at, updated_at
      FROM drafts
      WHERE user_id = ?
        ${byPersona ? 'AND persona_id IS ?' : ''}
        AND archived_at ${archived ? '<> ' : '= '}''
      ORDER BY id DESC LIMIT ?
    `;
    const args = byPersona ? [userId, personaId, limit] : [userId, limit];
    return db.prepare(sql).all(...args).map((r) => ({ ...r }));
  },

  /* 两个视图各有多少条，用来在侧栏显示计数 */
  counts(userId, personaId) {
    const byPersona = personaId !== undefined;
    const sql = `
      SELECT
        SUM(CASE WHEN archived_at = '' THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN archived_at <> '' THEN 1 ELSE 0 END) AS archived,
        SUM(CASE WHEN archived_at = '' AND status = 'done' THEN 1 ELSE 0 END) AS active_done
      FROM drafts WHERE user_id = ? ${byPersona ? 'AND persona_id IS ?' : ''}
    `;
    const row = db.prepare(sql).get(...(byPersona ? [userId, personaId] : [userId]));
    return { active: row.active || 0, archived: row.archived || 0, activeDone: row.active_done || 0 };
  },

  setArchived(id, userId, archived) {
    return db.prepare('UPDATE drafts SET archived_at = ?, updated_at = ? WHERE id = ? AND user_id = ?')
      .run(archived ? now() : '', now(), id, userId).changes > 0;
  },

  /* 批量归档：把某个范围内已完成的一次性收起来 */
  archiveDone(userId, personaId) {
    const byPersona = personaId !== undefined;
    const sql = `
      UPDATE drafts SET archived_at = ?, updated_at = ?
      WHERE user_id = ? ${byPersona ? 'AND persona_id IS ?' : ''}
        AND archived_at = '' AND status = 'done'
    `;
    const t = now();
    const args = byPersona ? [t, t, userId, personaId] : [t, t, userId];
    return db.prepare(sql).run(...args).changes;
  },
  /* 这个账号写过什么：题材 + 标题，用来让推荐避开重复 */
  usedSubjects(userId, personaId, limit = 60) {
    return db.prepare(`
      SELECT subject, title FROM drafts
      WHERE user_id = ? AND persona_id IS ? ORDER BY id DESC LIMIT ?
    `).all(userId, personaId, limit).map((r) => ({ ...r }));
  },
  remove(id, userId) {
    return withTx(() => {
      Revisions.removeFor(id, userId);
      Metrics.removeFor(id, userId);
      return db.prepare('DELETE FROM drafts WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
    });
  },
};

/* 正文的历史版本。保存或换稿之前先留上一版，正文没变则不重复记。 */
function withTx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* 事务已经结束 */ }
    throw err;
  }
}

/* 历史版本的两道闸：自动保存按时间间隔留版；每篇最多留 REVISION_MAX 版，超出删最旧的 */
const REVISION_GAP = 10 * 60 * 1000;
const REVISION_MAX = 50;

export const Revisions = {
  keep(draftId, userId, content, { minGapMs = 0 } = {}) {
    const text = String(content ?? '');
    if (!text) return null;
    const last = db.prepare(
      'SELECT content, created_at FROM draft_revisions WHERE draft_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1',
    ).get(draftId, userId);
    if (last && last.content === text) return null;
    if (last && minGapMs && Date.now() - Date.parse(last.created_at) < minGapMs) return null;
    const info = db.prepare(
      'INSERT INTO draft_revisions (draft_id, user_id, content, created_at) VALUES (?, ?, ?, ?)',
    ).run(draftId, userId, text, now());
    db.prepare(`
      DELETE FROM draft_revisions WHERE draft_id = ? AND user_id = ? AND id NOT IN (
        SELECT id FROM draft_revisions WHERE draft_id = ? AND user_id = ? ORDER BY id DESC LIMIT ?
      )`).run(draftId, userId, draftId, userId, REVISION_MAX);
    return Number(info.lastInsertRowid);
  },
  list(draftId, userId) {
    return db.prepare(
      'SELECT id, created_at, content FROM draft_revisions WHERE draft_id = ? AND user_id = ? ORDER BY id DESC',
    ).all(draftId, userId).map((r) => ({
      id: r.id,
      created_at: r.created_at,
      chars: r.content.replace(/\s/g, '').length,
    }));
  },
  byId(id, draftId, userId) {
    const row = db.prepare(
      'SELECT id, created_at, content FROM draft_revisions WHERE id = ? AND draft_id = ? AND user_id = ?',
    ).get(id, draftId, userId);
    return row ? { id: row.id, created_at: row.created_at, content: row.content } : null;
  },
  removeFor(draftId, userId) {
    db.prepare('DELETE FROM draft_revisions WHERE draft_id = ? AND user_id = ?').run(draftId, userId);
  },
};

const parseJson = (raw, fallback) => {
  try { return JSON.parse(raw); } catch { return fallback; }
};

/* 口播留档。draft_id 只是当时的稿子，不设外键，删稿不会带走录音和总评。 */
/* ---------- draft_metrics：发布数据快照，一次回填一行 ---------- */
export const METRIC_FIELDS = ['views', 'likes', 'comments', 'shares', 'follows'];

const hydrateMetric = (r) => (r ? {
  id: r.id,
  draftId: r.draft_id,
  platform: r.platform,
  capturedOn: r.captured_on,
  ...Object.fromEntries(METRIC_FIELDS.map((k) => [k, r[k]])),
  note: r.note,
} : null);

export const Metrics = {
  /* 同一篇、同一平台、同一天再填，改那一行而不是再加一行 */
  put(draftId, userId, { platform = '', capturedOn, values = {}, note = '' }) {
    const at = now();
    const cols = METRIC_FIELDS.map((k) => (Number.isFinite(values[k]) ? values[k] : null));
    db.prepare(`INSERT INTO draft_metrics
      (draft_id, user_id, platform, captured_on, ${METRIC_FIELDS.join(', ')}, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ${METRIC_FIELDS.map(() => '?').join(', ')}, ?, ?, ?)
      ON CONFLICT(draft_id, platform, captured_on) DO UPDATE SET
        ${METRIC_FIELDS.map((k) => `${k} = excluded.${k}`).join(', ')}, note = excluded.note, updated_at = excluded.updated_at`)
      .run(draftId, userId, platform, capturedOn, ...cols, note, at, at);
  },
  list(draftId, userId) {
    return db.prepare(`SELECT * FROM draft_metrics WHERE draft_id = ? AND user_id = ?
      ORDER BY captured_on DESC, id DESC`).all(draftId, userId).map(hydrateMetric);
  },
  /* 复盘用：一批稿子的全部快照，按稿子分组，时间从早到晚 */
  forDrafts(userId, draftIds) {
    const out = new Map();
    if (!draftIds.length) return out;
    const rows = db.prepare(`SELECT * FROM draft_metrics WHERE user_id = ? AND draft_id IN (${draftIds.map(() => '?').join(',')})
      ORDER BY captured_on, id`).all(userId, ...draftIds);
    for (const r of rows) {
      if (!out.has(r.draft_id)) out.set(r.draft_id, []);
      out.get(r.draft_id).push(hydrateMetric(r));
    }
    return out;
  },
  remove(id, draftId, userId) {
    return db.prepare('DELETE FROM draft_metrics WHERE id = ? AND draft_id = ? AND user_id = ?').run(id, draftId, userId).changes > 0;
  },
  removeFor(draftId, userId) {
    db.prepare('DELETE FROM draft_metrics WHERE draft_id = ? AND user_id = ?').run(draftId, userId);
  },
};

/* ---------- jobs：长任务队列（出图、口播转写与评测） ---------- */
const hydrateJob = (r) => (r ? {
  id: r.id,
  userId: r.user_id,
  kind: r.kind,
  ref: r.ref,
  label: r.label,
  payload: parseJson(r.payload_json, {}),
  status: r.status,
  result: parseJson(r.result_json, null),
  error: r.error,
  held: r.held,
  holdFeature: r.hold_feature,
  attempts: r.attempts,
  createdAt: r.created_at,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
} : null);

export const Jobs = {
  create({ userId, kind, ref = '', label = '', payload = {} }) {
    const { lastInsertRowid } = db.prepare(`INSERT INTO jobs (user_id, kind, ref, label, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(userId, kind, ref, label, JSON.stringify(payload), now());
    return Jobs.byId(Number(lastInsertRowid));
  },
  byId(id, userId = null) {
    const r = userId == null
      ? db.prepare('SELECT * FROM jobs WHERE id = ?').get(id)
      : db.prepare('SELECT * FROM jobs WHERE id = ? AND user_id = ?').get(id, userId);
    return hydrateJob(r);
  },
  /* 同一件事（同一张图、同一遍口播）还在排队或在跑，就不再重复建 */
  activeByRef(userId, ref) {
    if (!ref) return null;
    return hydrateJob(db.prepare(`SELECT * FROM jobs WHERE user_id = ? AND ref = ?
      AND status IN ('queued', 'running') ORDER BY id DESC LIMIT 1`).get(userId, ref));
  },
  list(userId, limit = 30) {
    return db.prepare('SELECT * FROM jobs WHERE user_id = ? ORDER BY id DESC LIMIT ?').all(userId, limit).map(hydrateJob);
  },
  queued() {
    return db.prepare("SELECT * FROM jobs WHERE status = 'queued' ORDER BY id").all().map(hydrateJob);
  },
  running() {
    return db.prepare("SELECT * FROM jobs WHERE status = 'running'").all().map(hydrateJob);
  },
  /* 只有还在排队的才能被领走：UPDATE 带状态条件，领到返回 true */
  claim(id) {
    const r = db.prepare(`UPDATE jobs SET status = 'running', started_at = ?, attempts = attempts + 1
      WHERE id = ? AND status = 'queued'`).run(now(), id);
    return r.changes === 1;
  },
  setHeld(id, held, feature = '') {
    db.prepare('UPDATE jobs SET held = ?, hold_feature = ? WHERE id = ?').run(held || 0, feature, id);
  },
  finish(id, { status, result = null, error = '' }) {
    db.prepare(`UPDATE jobs SET status = ?, result_json = ?, error = ?, held = 0, finished_at = ?
      WHERE id = ?`).run(status, JSON.stringify(result ?? null), error, now(), id);
    return Jobs.byId(id);
  },
  requeue(id) {
    db.prepare("UPDATE jobs SET status = 'queued', held = 0, started_at = '' WHERE id = ?").run(id);
  },
  cancel(id, userId) {
    const r = db.prepare(`UPDATE jobs SET status = 'cancelled', finished_at = ?
      WHERE id = ? AND user_id = ? AND status = 'queued'`).run(now(), id, userId);
    return r.changes === 1;
  },
  /* 只留最近的：每人超过 limit 条的已结束任务删掉 */
  prune(userId, keep = 100) {
    db.prepare(`DELETE FROM jobs WHERE user_id = ? AND status NOT IN ('queued', 'running')
      AND id NOT IN (SELECT id FROM jobs WHERE user_id = ? ORDER BY id DESC LIMIT ?)`).run(userId, userId, keep);
  },
};

export const Speaks = {
  create({ userId, draftId, title, script, cues, file, mime, bytes }) {
    const info = db.prepare(`
      INSERT INTO speak_takes (user_id, draft_id, title, script, cues_json, file, mime, bytes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, draftId ?? null, title || '', script || '', JSON.stringify(cues ?? null),
      file || '', mime || '', bytes || 0, now());
    return this.byId(Number(info.lastInsertRowid), userId);
  },
  setFile(id, userId, file, bytes) {
    db.prepare('UPDATE speak_takes SET file = ?, bytes = ? WHERE id = ? AND user_id = ?')
      .run(file, bytes, id, userId);
  },
  setStatus(id, userId, status, error = '') {
    db.prepare('UPDATE speak_takes SET status = ?, error = ? WHERE id = ? AND user_id = ?').run(status, error, id, userId);
  },
  finish(id, userId, { transcript, review, status, error }) {
    db.prepare(`UPDATE speak_takes SET transcript = ?, review_json = ?, status = ?, error = ?
                WHERE id = ? AND user_id = ?`)
      .run(transcript || '', JSON.stringify(review ?? null), status, error || '', id, userId);
    return this.byId(id, userId);
  },
  byId(id, userId) {
    const row = db.prepare(`
      SELECT s.*, d.content AS live_content
      FROM speak_takes s
      LEFT JOIN drafts d ON d.id = s.draft_id AND d.user_id = s.user_id
      WHERE s.id = ? AND s.user_id = ?
    `).get(id, userId);
    return row ? hydrateSpeak(row) : null;
  },
  list(userId) {
    return db.prepare(`
      SELECT s.*, d.content AS live_content
      FROM speak_takes s
      LEFT JOIN drafts d ON d.id = s.draft_id AND d.user_id = s.user_id
      WHERE s.user_id = ?
      ORDER BY s.id DESC
    `).all(userId).map(hydrateSpeak);
  },
  listByDraft(draftId, userId) {
    return db.prepare(`
      SELECT s.*, d.content AS live_content
      FROM speak_takes s
      LEFT JOIN drafts d ON d.id = s.draft_id AND d.user_id = s.user_id
      WHERE s.user_id = ? AND s.draft_id = ?
      ORDER BY s.id DESC
    `).all(userId, draftId).map(hydrateSpeak);
  },
  remove(id, userId) {
    const row = this.byId(id, userId);
    if (!row) return null;
    db.prepare('DELETE FROM speak_takes WHERE id = ? AND user_id = ?').run(id, userId);
    return row;
  },
};

function hydrateSpeak(row) {
  const review = parseJson(row.review_json, null);
  const live = row.live_content;
  const draftGone = row.draft_id != null && live == null;
  // 上传时存的稿子去掉了首尾空白，比较时也要去掉，否则正文末尾多个换行就被当成「当时的稿子」
  const stale = live != null && live.trim() !== row.script.trim();
  return {
    id: row.id,
    draftId: row.draft_id,
    title: row.title,
    script: row.script,
    cues: parseJson(row.cues_json, null),
    file: row.file,
    mime: row.mime,
    bytes: row.bytes,
    transcript: row.transcript,
    review,
    status: row.status,
    error: row.error,
    createdAt: row.created_at,
    draftGone,
    stale,
    score: review?.score ?? null,
    next: review?.next || '',
  };
}

function hydrate(row) {
  let topics = [];
  let persona = null;
  let hotspot = null;
  let section = null;
  let inputs = null;
  let cues = null;
  let variants = null;
  let illus = null;
  let metrics = null;
  let framework = null;
  try { framework = JSON.parse(row.framework_json ?? 'null'); } catch { /* 同上 */ }
  try { topics = JSON.parse(row.topics_json); } catch { /* 容错：脏数据当作空 */ }
  try { persona = JSON.parse(row.persona_json); } catch { /* 同上 */ }
  try { hotspot = JSON.parse(row.hotspot_json); } catch { /* 同上 */ }
  try { section = JSON.parse(row.section_json); } catch { /* 同上 */ }
  try { inputs = JSON.parse(row.inputs_json); } catch { /* 同上 */ }
  try { cues = JSON.parse(row.cues_json); } catch { /* 同上 */ }
  try { variants = JSON.parse(row.variants_json); } catch { /* 同上 */ }
  try { metrics = JSON.parse(row.metrics_json); } catch { /* 同上 */ }
  try { illus = JSON.parse(row.illus_json); } catch { /* 同上 */ }
  const {
    topics_json, persona_json, hotspot_json, section_json,
    inputs_json, cues_json, variants_json, illus_json,
    metrics_json, framework_json, user_id, generated, review_json, ...rest
  } = row;
  return {
    ...rest, topics, persona, hotspot, section, inputs, cues, variants, illus, metrics, framework,
  };
}
