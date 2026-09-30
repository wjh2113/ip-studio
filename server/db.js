/* 数据层：PostgreSQL + Drizzle。图片和录音仍在 DATA_DIR，不进库。 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { and, asc, count, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { getDatabase, inTransaction, orm, withTx } from './client.js';
import { runMigrations } from './migrations.js';
import { fromRoot } from './paths.js';
import { rebindCues, rebindIllus } from './keep.js';
import { editRatio } from './quality.js';
import {
  adminSessions, admins, draftMetrics, draftRevisions, drafts, evalCases, evalRuns, evalVotes,
  frameworks, jobs, materials, orders, personas, promptVariants, sections, sessions, settings,
  speakTakes, styleSamples, topicPool, usageEvents, users,
} from './schema.js';

const fileRoot = process.env.DATA_DIR
  ? resolve(process.env.DATA_DIR)
  : (process.env.DB_PATH ? dirname(resolve(process.env.DB_PATH)) : fromRoot('data'));
export const DATA_DIR = fileRoot;
mkdirSync(DATA_DIR, { recursive: true });

const opened = await getDatabase();
export const db = opened.db;
await runMigrations();

const now = () => new Date().toISOString();
const one = async (q) => (await q)[0] ?? null;
const nums = (row, keys) => {
  if (!row) return row;
  const out = { ...row };
  for (const k of keys) if (out[k] != null) out[k] = Number(out[k]);
  return out;
};
async function read(statement) {
  const result = await orm().execute(statement);
  return result.rows ?? result;
}
const same = (col, val) => sql`${col} IS NOT DISTINCT FROM ${val}`;

export const Admins = {
  async count() {
    return Number((await one(orm().select({ n: count() }).from(admins))).n);
  },
  async create(username, passHash) {
    const row = await one(orm().insert(admins).values({ username, pass_hash: passHash, created_at: now() }).returning());
    return row;
  },
  async byName(username) {
    return one(orm().select().from(admins).where(eq(admins.username, username)));
  },
  async byId(id) {
    return one(orm().select().from(admins).where(eq(admins.id, id)));
  },
  async setPassword(id, passHash) {
    await orm().update(admins).set({ pass_hash: passHash }).where(eq(admins.id, id));
    return this.byId(id);
  },
  async touch(id) {
    await orm().update(admins).set({ last_login: now() }).where(eq(admins.id, id));
  },
  async list() {
    return orm().select({
      id: admins.id, username: admins.username, created_at: admins.created_at, last_login: admins.last_login,
    }).from(admins).orderBy(asc(admins.id));
  },
};

export const AdminSessions = {
  async create(token, adminId, ttlMs) {
    await orm().insert(adminSessions).values({ token, admin_id: adminId, expires_at: Date.now() + ttlMs });
  },
  async admin(token) {
    if (!token) return null;
    const row = await one(orm().select().from(adminSessions).where(eq(adminSessions.token, token)));
    if (!row) return null;
    if (Number(row.expires_at) < Date.now()) { await this.destroy(token); return null; }
    return Admins.byId(row.admin_id);
  },
  async destroy(token) {
    await orm().delete(adminSessions).where(eq(adminSessions.token, token));
  },
  async sweep() {
    await orm().delete(adminSessions).where(sql`${adminSessions.expires_at} < ${Date.now()}`);
  },
};

export const Usage = {
  async record(e) {
    await orm().insert(usageEvents).values({
      user_id: e.userId ?? null,
      feature: e.feature,
      provider: e.provider || '',
      model: e.model || '',
      ok: e.ok ? 1 : 0,
      ms: Math.round(e.ms || 0),
      input_tokens: e.inputTokens || 0,
      output_tokens: e.outputTokens || 0,
      units: Number(e.units) || 0,
      unit: e.unit || '',
      variant: e.variant || '',
      error: String(e.error || '').slice(0, 200),
      created_at: now(),
    });
  },
  async totals(sinceIso) {
    const [row] = await read(sql`
      SELECT COUNT(*)::int AS calls, COALESCE(SUM(ok), 0)::int AS ok_calls,
             COALESCE(SUM(input_tokens), 0)::int AS input_tokens,
             COALESCE(SUM(output_tokens), 0)::int AS output_tokens,
             AVG(ms) AS avg_ms
      FROM usage_events WHERE created_at >= ${sinceIso}`);
    return nums(row, ['calls', 'ok_calls', 'input_tokens', 'output_tokens', 'avg_ms']);
  },
  async myUsage(userId, periodPrefix) {
    const list = await read(sql`
      SELECT feature, COUNT(*)::int AS calls, COALESCE(SUM(units), 0) AS units, MAX(unit) AS unit,
             COALESCE(SUM(input_tokens + output_tokens), 0)::int AS tokens
      FROM usage_events
      WHERE user_id = ${userId} AND ok = 1 AND created_at LIKE ${`${periodPrefix}%`}
      GROUP BY feature ORDER BY calls DESC`);
    return list.map((r) => nums(r, ['calls', 'units', 'tokens']));
  },
  async byModel(sinceIso) {
    const list = await read(sql`
      SELECT feature, model, provider, COUNT(*)::int AS calls,
             COALESCE(SUM(units), 0) AS units, MAX(unit) AS unit,
             COALESCE(SUM(input_tokens), 0)::int AS input_tokens,
             COALESCE(SUM(output_tokens), 0)::int AS output_tokens
      FROM usage_events WHERE created_at >= ${sinceIso} AND ok = 1
      GROUP BY feature, model, provider ORDER BY calls DESC`);
    return list.map((r) => nums(r, ['calls', 'units', 'input_tokens', 'output_tokens']));
  },
  async byFeature(sinceIso) {
    const list = await read(sql`
      SELECT feature, COUNT(*)::int AS calls, COALESCE(SUM(ok), 0)::int AS ok_calls,
             COALESCE(SUM(input_tokens), 0)::int AS input_tokens,
             COALESCE(SUM(output_tokens), 0)::int AS output_tokens,
             CAST(AVG(ms) AS integer) AS avg_ms
      FROM usage_events WHERE created_at >= ${sinceIso}
      GROUP BY feature ORDER BY calls DESC`);
    return list.map((r) => nums(r, ['calls', 'ok_calls', 'input_tokens', 'output_tokens', 'avg_ms']));
  },
  async byDay(sinceIso) {
    const list = await read(sql`
      SELECT substr(created_at, 1, 10) AS day, COUNT(*)::int AS calls,
             COALESCE(SUM(input_tokens + output_tokens), 0)::int AS tokens
      FROM usage_events WHERE created_at >= ${sinceIso}
      GROUP BY day ORDER BY day ASC`);
    return list.map((r) => nums(r, ['calls', 'tokens']));
  },
  async byUser(sinceIso) {
    const list = await read(sql`
      SELECT user_id, COUNT(*)::int AS calls,
             COALESCE(SUM(input_tokens + output_tokens), 0)::int AS tokens,
             MAX(created_at) AS last_at
      FROM usage_events WHERE created_at >= ${sinceIso} AND user_id IS NOT NULL
      GROUP BY user_id`);
    return list.map((r) => nums(r, ['calls', 'tokens', 'user_id']));
  },
  async recentErrors(limit = 20) {
    return orm().select({
      feature: usageEvents.feature, model: usageEvents.model,
      error: usageEvents.error, created_at: usageEvents.created_at,
    }).from(usageEvents).where(eq(usageEvents.ok, 0)).orderBy(desc(usageEvents.id)).limit(limit);
  },
};

export const Users = {
  async create(username, passHash) {
    return one(orm().insert(users).values({ username, pass_hash: passHash, created_at: now() }).returning());
  },
  async byName(username) {
    return one(orm().select().from(users).where(eq(users.username, username)));
  },
  async byId(id) {
    return one(orm().select().from(users).where(eq(users.id, id)));
  },
  async setPassword(id, passHash) {
    await orm().update(users).set({ pass_hash: passHash }).where(eq(users.id, id));
    return this.byId(id);
  },
  async overview() {
    const list = await read(sql`
      SELECT u.id, u.username, u.created_at,
             (SELECT COUNT(*) FROM personas p WHERE p.user_id = u.id)::int AS personas,
             (SELECT COUNT(*) FROM sections s WHERE s.user_id = u.id)::int AS sections,
             (SELECT COUNT(*) FROM drafts d WHERE d.user_id = u.id)::int AS drafts,
             (SELECT COUNT(*) FROM drafts d WHERE d.user_id = u.id AND d.status = 'done')::int AS done_drafts,
             (SELECT COUNT(*) FROM style_samples ss WHERE ss.user_id = u.id)::int AS samples,
             (SELECT MAX(d.updated_at) FROM drafts d WHERE d.user_id = u.id) AS last_draft_at
      FROM users u ORDER BY u.id ASC`);
    return list.map((r) => nums(r, ['id', 'personas', 'sections', 'drafts', 'done_drafts', 'samples']));
  },
};

export const Sessions = {
  async create(token, userId, ttlMs) {
    await orm().insert(sessions).values({ token, user_id: userId, expires_at: Date.now() + ttlMs });
  },
  async user(token) {
    if (!token) return null;
    const row = await one(orm().select().from(sessions).where(eq(sessions.token, token)));
    if (!row) return null;
    if (Number(row.expires_at) < Date.now()) { await this.destroy(token); return null; }
    return Users.byId(row.user_id);
  },
  async destroy(token) {
    await orm().delete(sessions).where(eq(sessions.token, token));
  },
  async sweep() {
    await orm().delete(sessions).where(sql`${sessions.expires_at} < ${Date.now()}`);
  },
};

export const PERSONA_FIELDS = [
  'name', 'platform', 'tone', 'content_focus', 'audience', 'problem', 'notes',
  'creator_age', 'creator_gender', 'creator_industry', 'creator_role', 'creator_traits',
];

const personaValues = (f) => Object.fromEntries(PERSONA_FIELDS.map((k) => [k, f[k] ?? '']));

export const Personas = {
  async create(userId, f) {
    const t = now();
    const row = await one(orm().insert(personas).values({
      user_id: userId, ...personaValues(f), created_at: t, updated_at: t,
    }).returning());
    return row;
  },
  async update(id, userId, f) {
    const rows = await orm().update(personas).set({ ...personaValues(f), updated_at: now() })
      .where(and(eq(personas.id, id), eq(personas.user_id, userId))).returning({ id: personas.id });
    return rows.length ? this.byId(id, userId) : null;
  },
  async byId(id, userId) {
    return one(orm().select().from(personas).where(and(eq(personas.id, id), eq(personas.user_id, userId))));
  },
  async list(userId) {
    const list = await read(sql`
      SELECT p.*,
             (SELECT COUNT(*) FROM drafts d WHERE d.persona_id = p.id)::int AS draft_count,
             (SELECT COUNT(*) FROM style_samples s WHERE s.persona_id = p.id)::int AS sample_count
      FROM personas p WHERE p.user_id = ${userId} ORDER BY p.id ASC`);
    return list.map((r) => nums(r, ['id', 'user_id', 'draft_count', 'sample_count']));
  },
  async setIdeas(id, userId, ideas) {
    await orm().update(personas).set({ subject_ideas: JSON.stringify(ideas) })
      .where(and(eq(personas.id, id), eq(personas.user_id, userId)));
  },
  async ideas(id, userId) {
    const row = await one(orm().select({ subject_ideas: personas.subject_ideas }).from(personas)
      .where(and(eq(personas.id, id), eq(personas.user_id, userId))));
    if (!row) return null;
    try { const v = JSON.parse(row.subject_ideas); return Array.isArray(v) ? v : []; } catch { return []; }
  },
  async setHotspots(id, userId, payload) {
    await orm().update(personas).set({ hotspot_json: JSON.stringify(payload) })
      .where(and(eq(personas.id, id), eq(personas.user_id, userId)));
  },
  async hotspots(id, userId) {
    const row = await one(orm().select({ hotspot_json: personas.hotspot_json }).from(personas)
      .where(and(eq(personas.id, id), eq(personas.user_id, userId))));
    if (!row) return undefined;
    try { return JSON.parse(row.hotspot_json); } catch { return null; }
  },
  async setDigest(id, userId, digest) {
    await orm().update(personas).set({ style_digest: digest, style_updated_at: now() })
      .where(and(eq(personas.id, id), eq(personas.user_id, userId)));
  },
  async remove(id, userId) {
    const rows = await orm().delete(personas).where(and(eq(personas.id, id), eq(personas.user_id, userId))).returning({ id: personas.id });
    return rows.length > 0;
  },
};

export const Sections = {
  async create(userId, personaId, f) {
    const t = now();
    // 锁住账号那一行再取「下一个序号」，同时加两个栏目不会拿到同一个 sort
    return withTx(async () => {
      await orm().select({ id: personas.id }).from(personas).where(eq(personas.id, personaId)).for('update');
      const next = await one(orm().select({ n: sql`COALESCE(MAX(${sections.sort}), 0) + 1` }).from(sections).where(eq(sections.persona_id, personaId)));
      const row = await one(orm().insert(sections).values({
        user_id: userId, persona_id: personaId, name: f.name, purpose: f.purpose, guide: f.guide,
        fields_json: JSON.stringify(f.fields || []), default_framework: f.default_framework || '',
        sort: Number(next.n), created_at: t, updated_at: t,
      }).returning());
      return hydrateSection(row);
    });
  },
  async update(id, userId, f) {
    const rows = await orm().update(sections).set({
      name: f.name, purpose: f.purpose, guide: f.guide,
      fields_json: JSON.stringify(f.fields || []), default_framework: f.default_framework || '', updated_at: now(),
    }).where(and(eq(sections.id, id), eq(sections.user_id, userId))).returning({ id: sections.id });
    return rows.length ? this.byId(id, userId) : null;
  },
  async byId(id, userId) {
    const row = await one(orm().select().from(sections).where(and(eq(sections.id, id), eq(sections.user_id, userId))));
    return row ? hydrateSection(row) : null;
  },
  async list(personaId, userId) {
    const list = await read(sql`
      SELECT s.*, (SELECT COUNT(*) FROM drafts d WHERE d.section_id = s.id)::int AS draft_count
      FROM sections s WHERE s.persona_id = ${personaId} AND s.user_id = ${userId}
      ORDER BY s.sort ASC, s.id ASC`);
    return list.map((r) => hydrateSection(nums(r, ['id', 'user_id', 'persona_id', 'sort', 'draft_count'])));
  },
  async remove(id, userId) {
    const rows = await orm().delete(sections).where(and(eq(sections.id, id), eq(sections.user_id, userId))).returning({ id: sections.id });
    return rows.length > 0;
  },
};

function hydrateSection(row) {
  let fields = [];
  try { const v = JSON.parse(row.fields_json); if (Array.isArray(v)) fields = v; } catch { /* 脏数据当空 */ }
  const { fields_json, ...rest } = row;
  return { ...rest, fields };
}

export const Settings = {
  async all() {
    return orm().select().from(settings);
  },
  async get(k) {
    return one(orm().select({ v: settings.v, secret: settings.secret }).from(settings).where(eq(settings.k, k)));
  },
  async set(k, v, secret, by) {
    await orm().insert(settings).values({ k, v, secret: secret ? 1 : 0, updated_at: now(), updated_by: by || '' })
      .onConflictDoUpdate({
        target: settings.k,
        set: { v, secret: secret ? 1 : 0, updated_at: now(), updated_by: by || '' },
      });
  },
  async remove(k) {
    const rows = await orm().delete(settings).where(eq(settings.k, k)).returning({ k: settings.k });
    return rows.length > 0;
  },
};

export const Orders = {
  async create(o) {
    await orm().insert(orders).values({
      out_trade_no: o.no, user_id: o.userId, kind: o.kind, sku: o.sku,
      amount: o.amount, channel: o.channel, created_at: now(),
    });
    return this.byNo(o.no);
  },
  async byNo(no) {
    return one(orm().select().from(orders).where(eq(orders.out_trade_no, no)));
  },
  async listByUser(userId, limit = 20) {
    return orm().select().from(orders).where(eq(orders.user_id, userId)).orderBy(desc(orders.id)).limit(limit);
  },
  async markPaid(no, tradeNo, raw) {
    const rows = await orm().update(orders).set({
      status: 'paid', trade_no: tradeNo || '', paid_at: now(), raw: String(raw || '').slice(0, 4000),
    }).where(and(eq(orders.out_trade_no, no), eq(orders.status, 'pending'))).returning({ id: orders.id });
    return rows.length > 0;
  },
  async markGranted(no) {
    await orm().update(orders).set({ status: 'granted', granted_at: now() }).where(eq(orders.out_trade_no, no));
  },
  async close(no) {
    const rows = await orm().update(orders).set({ status: 'closed' })
      .where(and(eq(orders.out_trade_no, no), eq(orders.status, 'pending'))).returning({ id: orders.id });
    return rows.length > 0;
  },
};

export const Quota = {
  async state(userId, period) {
    let q = orm().select({
      plan: users.plan, period: users.period, used: users.used, avatar_credits: users.avatar_credits,
    }).from(users).where(eq(users.id, userId));
    if (inTransaction()) q = q.for('update');
    const u = await one(q);
    if (!u) return null;
    if (u.period !== period) {
      /* 跨月重置只做一次：带上「还是旧周期」的条件。不带条件的话，一个读到旧周期的请求
         会在别人已经按新周期预扣之后再把 used 清零，等于白送额度（并发实测过）。 */
      const reset = await orm().update(users).set({ period, used: 0 })
        .where(and(eq(users.id, userId), ne(users.period, period)))
        .returning({ plan: users.plan, period: users.period, used: users.used, avatar_credits: users.avatar_credits });
      if (reset.length) return reset[0];
      return one(orm().select({
        plan: users.plan, period: users.period, used: users.used, avatar_credits: users.avatar_credits,
      }).from(users).where(eq(users.id, userId)));
    }
    return u;
  },
  async consume(userId, credits, fromPack = 0) {
    if (fromPack) {
      await orm().update(users).set({ avatar_credits: sql`GREATEST(0, ${users.avatar_credits} - ${fromPack})` }).where(eq(users.id, userId));
    }
    if (credits) {
      await orm().update(users).set({ used: sql`${users.used} + ${credits}` }).where(eq(users.id, userId));
    }
  },
  async refund(userId, credits) {
    if (credits > 0) {
      await orm().update(users).set({ used: sql`GREATEST(0, ${users.used} - ${credits})` }).where(eq(users.id, userId));
    }
  },
  async setPlan(userId, plan) {
    await orm().update(users).set({ plan }).where(eq(users.id, userId));
  },
  async addPack(userId, credits) {
    await orm().update(users).set({ avatar_credits: sql`${users.avatar_credits} + ${credits}` }).where(eq(users.id, userId));
  },
};

export const Variants = {
  async list(feature) {
    const q = orm().select().from(promptVariants);
    return (feature ? q.where(eq(promptVariants.feature, feature)) : q).orderBy(asc(promptVariants.feature), asc(promptVariants.id));
  },
  async byId(id) {
    return one(orm().select().from(promptVariants).where(eq(promptVariants.id, id)));
  },
  async active(feature) {
    return orm().select().from(promptVariants).where(and(
      eq(promptVariants.feature, feature), eq(promptVariants.active, 1), sql`${promptVariants.weight} > 0`,
    )).orderBy(asc(promptVariants.id));
  },
  async create(v) {
    return one(orm().insert(promptVariants).values({
      feature: v.feature, name: v.name, system: v.system, weight: v.weight ?? 1,
      active: v.active ? 1 : 0, note: v.note || '', created_at: now(),
    }).returning());
  },
  async update(id, v) {
    await orm().update(promptVariants).set({
      name: v.name, system: v.system, weight: v.weight ?? 1, active: v.active ? 1 : 0, note: v.note || '',
    }).where(eq(promptVariants.id, id));
    return this.byId(id);
  },
  async remove(id) {
    const rows = await orm().delete(promptVariants).where(eq(promptVariants.id, id)).returning({ id: promptVariants.id });
    return rows.length > 0;
  },
};

export const Evals = {
  async cases(feature) {
    const q = orm().select().from(evalCases);
    return (feature ? q.where(eq(evalCases.feature, feature)) : q).orderBy(desc(evalCases.id));
  },
  async caseById(id) {
    return one(orm().select().from(evalCases).where(eq(evalCases.id, id)));
  },
  async addCase(c) {
    return one(orm().insert(evalCases).values({
      feature: c.feature, title: c.title, input_json: JSON.stringify(c.input || {}), created_at: now(),
    }).returning());
  },
  async removeCase(id) {
    const rows = await orm().delete(evalCases).where(eq(evalCases.id, id)).returning({ id: evalCases.id });
    return rows.length > 0;
  },
  async addRun(r) {
    const row = await one(orm().insert(evalRuns).values({
      batch: r.batch, case_id: r.caseId, variant_id: r.variantId ?? null, variant_name: r.variantName || '内置',
      output: r.output || '', scores_json: JSON.stringify(r.scores || {}), ms: Math.round(r.ms || 0),
      error: r.error || '', created_at: now(),
    }).returning({ id: evalRuns.id }));
    return row.id;
  },
  async runs(batch) {
    return read(sql`
      SELECT r.*, c.title AS case_title, c.feature
      FROM eval_runs r JOIN eval_cases c ON c.id = r.case_id
      WHERE r.batch = ${batch} ORDER BY r.case_id, r.id`);
  },
  async batches(limit = 20) {
    const list = await read(sql`
      SELECT batch, MIN(created_at) AS at, COUNT(*)::int AS runs,
             COUNT(DISTINCT case_id)::int AS cases, COUNT(DISTINCT variant_name)::int AS variants
      FROM eval_runs GROUP BY batch ORDER BY at DESC LIMIT ${limit}`);
    return list.map((r) => nums(r, ['runs', 'cases', 'variants']));
  },
  async vote(v) {
    await orm().insert(evalVotes).values({
      batch: v.batch, case_id: v.caseId, left_id: v.leftId, right_id: v.rightId, winner: v.winner || 0, created_at: now(),
    });
  },
  async votes(batch) {
    return orm().select().from(evalVotes).where(eq(evalVotes.batch, batch));
  },
};

export const MATERIAL_KINDS = ['经历', '数据', '案例', '金句', '观察'];

export const Materials = {
  async create(userId, personaId, m) {
    const t = now();
    return one(orm().insert(materials).values({
      user_id: userId, persona_id: personaId, kind: m.kind, title: m.title,
      body: m.body || '', tags: m.tags || '', created_at: t, updated_at: t,
    }).returning());
  },
  async update(id, userId, m) {
    const rows = await orm().update(materials).set({
      kind: m.kind, title: m.title, body: m.body || '', tags: m.tags || '', updated_at: now(),
    }).where(and(eq(materials.id, id), eq(materials.user_id, userId))).returning({ id: materials.id });
    return rows.length ? this.byId(id, userId) : null;
  },
  async byId(id, userId) {
    return one(orm().select().from(materials).where(and(eq(materials.id, id), eq(materials.user_id, userId))));
  },
  async list(userId, personaId) {
    return orm().select().from(materials)
      .where(and(eq(materials.user_id, userId), same(materials.persona_id, personaId ?? null)))
      .orderBy(desc(materials.id));
  },
  async remove(id, userId) {
    const rows = await orm().delete(materials).where(and(eq(materials.id, id), eq(materials.user_id, userId))).returning({ id: materials.id });
    return rows.length > 0;
  },
  async markUsed(ids, userId) {
    for (const id of ids) {
      await orm().update(materials).set({ used_count: sql`${materials.used_count} + 1` })
        .where(and(eq(materials.id, id), eq(materials.user_id, userId)));
    }
  },
};

function hydrateFramework(r) {
  const arr = (v) => { try { const x = JSON.parse(v); return Array.isArray(x) ? x : []; } catch { return []; } };
  return {
    key: `u:${r.id}`, id: r.id, builtin: false, kind: r.kind, name: r.name, summary: r.summary,
    platforms: arr(r.platforms), scenes: arr(r.scenes), slots: arr(r.slots_json),
    from_key: r.from_key, used_count: r.used_count, created_at: r.created_at, updated_at: r.updated_at,
    source_chars: String(r.source_text || '').length,
  };
}

export const Frameworks = {
  async list(userId) {
    return (await orm().select().from(frameworks).where(eq(frameworks.user_id, userId)).orderBy(desc(frameworks.id))).map(hydrateFramework);
  },
  async count(userId) {
    return Number((await one(orm().select({ n: count() }).from(frameworks).where(eq(frameworks.user_id, userId)))).n);
  },
  async byId(id, userId) {
    const r = await one(orm().select().from(frameworks).where(and(eq(frameworks.id, id), eq(frameworks.user_id, userId))));
    return r ? hydrateFramework(r) : null;
  },
  async create(userId, f) {
    const t = now();
    const row = await one(orm().insert(frameworks).values({
      user_id: userId, name: f.name, summary: f.summary || '',
      platforms: JSON.stringify(f.platforms || []), scenes: JSON.stringify(f.scenes || []),
      slots_json: JSON.stringify(f.slots), source_text: f.source_text || '', from_key: f.from_key || '',
      created_at: t, updated_at: t,
    }).returning());
    return hydrateFramework(row);
  },
  async update(id, userId, f) {
    const rows = await orm().update(frameworks).set({
      name: f.name, summary: f.summary || '', platforms: JSON.stringify(f.platforms || []),
      scenes: JSON.stringify(f.scenes || []), slots_json: JSON.stringify(f.slots), updated_at: now(),
    }).where(and(eq(frameworks.id, id), eq(frameworks.user_id, userId))).returning({ id: frameworks.id });
    if (rows.length && f.source_text !== undefined) {
      await orm().update(frameworks).set({ source_text: f.source_text }).where(and(eq(frameworks.id, id), eq(frameworks.user_id, userId)));
    }
    return rows.length ? this.byId(id, userId) : null;
  },
  async sourceOf(id, userId) {
    const row = await one(orm().select({ source_text: frameworks.source_text }).from(frameworks)
      .where(and(eq(frameworks.id, id), eq(frameworks.user_id, userId))));
    return row?.source_text || '';
  },
  async remove(id, userId) {
    const rows = await orm().delete(frameworks).where(and(eq(frameworks.id, id), eq(frameworks.user_id, userId))).returning({ id: frameworks.id });
    return rows.length > 0;
  },
  async markUsed(id, userId) {
    await orm().update(frameworks).set({ used_count: sql`${frameworks.used_count} + 1` })
      .where(and(eq(frameworks.id, id), eq(frameworks.user_id, userId)));
  },
  async builtinUsage(userId) {
    const list = await read(sql`
      SELECT framework_json::json->>'key' AS k, COUNT(*)::int AS n FROM drafts
      WHERE user_id = ${userId} AND framework_json != 'null' GROUP BY 1`);
    return Object.fromEntries(list.filter((r) => r.k).map((r) => [r.k, Number(r.n)]));
  },
};

export const Pool = {
  async create(userId, personaId, t) {
    return one(orm().insert(topicPool).values({
      user_id: userId, persona_id: personaId, subject: t.subject, note: t.note || '',
      source: t.source || '手动', plan_date: t.plan_date || '', created_at: now(),
    }).returning());
  },
  async byId(id, userId) {
    return one(orm().select().from(topicPool).where(and(eq(topicPool.id, id), eq(topicPool.user_id, userId))));
  },
  async list(userId, personaId) {
    return orm().select().from(topicPool)
      .where(and(eq(topicPool.user_id, userId), same(topicPool.persona_id, personaId ?? null)))
      .orderBy(sql`(${topicPool.plan_date} = '')`, asc(topicPool.plan_date), desc(topicPool.id));
  },
  /* 只改传进来的字段，一条 UPDATE 完成：不先读再写，两个人同时改不同字段不会互相覆盖 */
  async update(id, userId, patch) {
    const set = {};
    for (const k of ['subject', 'note', 'plan_date', 'status']) if (patch[k] != null) set[k] = patch[k];
    if (patch.draft_id !== undefined) set.draft_id = patch.draft_id;
    if (!Object.keys(set).length) return this.byId(id, userId);
    const rows = await orm().update(topicPool).set(set)
      .where(and(eq(topicPool.id, id), eq(topicPool.user_id, userId))).returning();
    return rows[0] || null;
  },
  async remove(id, userId) {
    const rows = await orm().delete(topicPool).where(and(eq(topicPool.id, id), eq(topicPool.user_id, userId))).returning({ id: topicPool.id });
    return rows.length > 0;
  },
};

export const Samples = {
  async create(userId, personaId, { draftId = null, title = '', content }) {
    return one(orm().insert(styleSamples).values({
      user_id: userId, persona_id: personaId, draft_id: draftId, title, content, created_at: now(),
    }).returning());
  },
  async list(personaId, userId, { withContent = false, limit = 50 } = {}) {
    const where = and(eq(styleSamples.persona_id, personaId), eq(styleSamples.user_id, userId));
    if (withContent) {
      return orm().select().from(styleSamples).where(where).orderBy(desc(styleSamples.id)).limit(limit);
    }
    const list = await orm().select({
      id: styleSamples.id, draft_id: styleSamples.draft_id, title: styleSamples.title,
      created_at: styleSamples.created_at, length: sql`length(${styleSamples.content})`,
    }).from(styleSamples).where(where).orderBy(desc(styleSamples.id)).limit(limit);
    return list.map((r) => nums(r, ['length']));
  },
  async remove(id, userId) {
    const rows = await orm().delete(styleSamples).where(and(eq(styleSamples.id, id), eq(styleSamples.user_id, userId))).returning({ id: styleSamples.id });
    return rows.length > 0;
  },
};

/* 正文历史的密度：自动保存时距上一版超过 REVISION_GAP_MIN 分钟才另存一版（手动保存、离开编辑总会存），
   每篇最多留 REVISION_MAX 版。要更密的历史就调小间隔、调大上限（多占一些库空间）。 */
const gapMin = Number(process.env.REVISION_GAP_MIN);
// 没配、配空、配错（不是非负数）都按默认 10 分钟，别让一个笔误变成「每次自动保存都存一版」
const REVISION_GAP = (process.env.REVISION_GAP_MIN && Number.isFinite(gapMin) && gapMin >= 0 ? gapMin : 10) * 60 * 1000;
const REVISION_MAX = Math.max(5, Math.floor(Number(process.env.REVISION_MAX) || 50));
const parseJson = (raw, fallback) => { try { return JSON.parse(raw); } catch { return fallback; } };

export const Revisions = {
  async keep(draftId, userId, content, { minGapMs = 0 } = {}) {
    const text = String(content ?? '');
    if (!text) return null;
    const last = await one(orm().select({ content: draftRevisions.content, created_at: draftRevisions.created_at })
      .from(draftRevisions).where(and(eq(draftRevisions.draft_id, draftId), eq(draftRevisions.user_id, userId)))
      .orderBy(desc(draftRevisions.id)).limit(1));
    if (last && last.content === text) return null;
    if (last && minGapMs && Date.now() - Date.parse(last.created_at) < minGapMs) return null;
    const row = await one(orm().insert(draftRevisions).values({
      draft_id: draftId, user_id: userId, content: text, created_at: now(),
    }).returning({ id: draftRevisions.id }));
    await orm().execute(sql`
      DELETE FROM draft_revisions WHERE draft_id = ${draftId} AND user_id = ${userId} AND id NOT IN (
        SELECT id FROM draft_revisions WHERE draft_id = ${draftId} AND user_id = ${userId} ORDER BY id DESC LIMIT ${REVISION_MAX}
      )`);
    return row.id;
  },
  async list(draftId, userId) {
    const list = await orm().select({
      id: draftRevisions.id, created_at: draftRevisions.created_at, content: draftRevisions.content,
    }).from(draftRevisions).where(and(eq(draftRevisions.draft_id, draftId), eq(draftRevisions.user_id, userId)))
      .orderBy(desc(draftRevisions.id));
    return list.map((r) => ({ id: r.id, created_at: r.created_at, chars: r.content.replace(/\s/g, '').length }));
  },
  async byId(id, draftId, userId) {
    const row = await one(orm().select({
      id: draftRevisions.id, created_at: draftRevisions.created_at, content: draftRevisions.content,
    }).from(draftRevisions).where(and(
      eq(draftRevisions.id, id), eq(draftRevisions.draft_id, draftId), eq(draftRevisions.user_id, userId),
    )));
    return row ? { id: row.id, created_at: row.created_at, content: row.content } : null;
  },
  async removeFor(draftId, userId) {
    await orm().delete(draftRevisions).where(and(eq(draftRevisions.draft_id, draftId), eq(draftRevisions.user_id, userId)));
  },
};

export const Drafts = {
  async create(userId, f, persona = null, hotspot = null, section = null, inputs = null, framework = null) {
    const t = now();
    const row = await one(orm().insert(drafts).values({
      user_id: userId, subject: f.subject, platform: f.platform, tone: f.tone,
      audience: f.audience, keywords: f.keywords, length: f.length,
      persona_id: persona?.id ?? null, persona_json: JSON.stringify(persona), hotspot_json: JSON.stringify(hotspot),
      section_id: section?.id ?? null, section_json: JSON.stringify(section), inputs_json: JSON.stringify(inputs),
      framework_json: JSON.stringify(framework), created_at: t, updated_at: t,
    }).returning());
    return hydrate(row);
  },
  async setTopics(id, userId, topics, persona) {
    await withTx(async () => {
      // 锁住这篇稿子：同一篇的保存、换方向、成稿写回排队进行，历史版本不会记错「上一版」
      const row = await one(orm().select({ content: drafts.content }).from(drafts).where(and(eq(drafts.id, id), eq(drafts.user_id, userId))).for('update'));
      if (row?.content) await Revisions.keep(id, userId, row.content);
      await orm().update(drafts).set({
        topics_json: JSON.stringify(topics), chosen: null, title: '', content: '',
        status: 'topics', persona_json: JSON.stringify(persona ?? null), updated_at: now(),
      }).where(and(eq(drafts.id, id), eq(drafts.user_id, userId)));
    });
  },
  async setContent(id, userId, { chosen, title, content, status }) {
    const next = String(content ?? '');
    await withTx(async () => {
      const row = await one(orm().select({ content: drafts.content }).from(drafts).where(and(eq(drafts.id, id), eq(drafts.user_id, userId))).for('update'));
      if (row?.content && row.content !== next) await Revisions.keep(id, userId, row.content);
      await orm().update(drafts).set({ chosen, title, content: next, status, updated_at: now() })
        .where(and(eq(drafts.id, id), eq(drafts.user_id, userId)));
      if (next) await Revisions.keep(id, userId, next);
    });
  },
  /* 条件写入：锁住这一行，当前的 status / content / chosen 和 expect 一致才写 next，返回写没写 */
  async setContentIf(id, userId, expect, next) {
    return withTx(async () => {
      const row = await one(orm().select({ status: drafts.status, content: drafts.content, chosen: drafts.chosen })
        .from(drafts).where(and(eq(drafts.id, id), eq(drafts.user_id, userId))).for('update'));
      if (!row) return false;
      if (row.status !== expect.status || (row.content || '') !== expect.content || row.chosen !== expect.chosen) return false;
      await this.setContent(id, userId, next);
      return true;
    });
  },
  async saveContent(id, userId, content, { snapshot = false } = {}) {
    const next = String(content ?? '');
    return withTx(async () => {
      const row = await one(orm().select({
        content: drafts.content, cues_json: drafts.cues_json, illus_json: drafts.illus_json, generated: drafts.generated,
      }).from(drafts).where(and(eq(drafts.id, id), eq(drafts.user_id, userId))).for('update'));
      if (!row) return null;
      const keepOpts = snapshot ? {} : { minGapMs: REVISION_GAP };
      if (snapshot && row.content && row.content !== next) await Revisions.keep(id, userId, row.content);
      const cues = rebindCues(next, parseJson(row.cues_json, null));
      const illus = rebindIllus(next, parseJson(row.illus_json, null));
      const ratio = row.generated ? editRatio(row.generated, next) : null;
      const updated = await orm().update(drafts).set({
        content: next, status: 'done', cues_json: JSON.stringify(cues.cues),
        illus_json: JSON.stringify(illus.illus), edit_ratio: ratio, updated_at: now(),
      }).where(and(eq(drafts.id, id), eq(drafts.user_id, userId))).returning({ id: drafts.id });
      if (!updated.length) return null;
      await Revisions.keep(id, userId, next, keepOpts);
      return { cuesDropped: cues.dropped, illusDropped: illus.dropped };
    });
  },
  async setGenerated(id, userId, text, variant = '') {
    await orm().update(drafts).set({ generated: String(text || ''), gen_variant: variant || '', edit_ratio: 0 })
      .where(and(eq(drafts.id, id), eq(drafts.user_id, userId)));
  },
  async setReview(id, userId, issues) {
    const keep = (issues || []).filter((it) => it?.quote).slice(0, 40)
      .map((it) => ({ dimension: it.dimension || '', quote: it.quote, fix: it.fix || '' }));
    await orm().update(drafts).set({ review_json: JSON.stringify({ at: now(), issues: keep }) })
      .where(and(eq(drafts.id, id), eq(drafts.user_id, userId)));
  },
  async qualityRows(since) {
    return orm().select({
      id: drafts.id, gen_variant: drafts.gen_variant, edit_ratio: drafts.edit_ratio,
      review_json: drafts.review_json, content: drafts.content,
    }).from(drafts).where(and(sql`${drafts.generated} != ''`, sql`${drafts.updated_at} >= ${since}`));
  },
  async setTitle(id, userId, title) {
    await orm().update(drafts).set({ title, updated_at: now() }).where(and(eq(drafts.id, id), eq(drafts.user_id, userId)));
  },
  async setCues(id, userId, cues) {
    await orm().update(drafts).set({ cues_json: JSON.stringify(cues), updated_at: now() })
      .where(and(eq(drafts.id, id), eq(drafts.user_id, userId)));
  },
  async setIllus(id, userId, illus) {
    await orm().update(drafts).set({ illus_json: JSON.stringify(illus), updated_at: now() })
      .where(and(eq(drafts.id, id), eq(drafts.user_id, userId)));
  },
  async setMetrics(id, userId, metrics, publishedAt) {
    await orm().update(drafts).set({ metrics_json: JSON.stringify(metrics), published_at: publishedAt || '', updated_at: now() })
      .where(and(eq(drafts.id, id), eq(drafts.user_id, userId)));
  },
  async withMetrics(userId, personaId) {
    const byPersona = personaId !== undefined && personaId !== null;
    return read(sql`
      SELECT id, subject, title, platform, section_id, chosen, topics_json, metrics_json, framework_json, published_at, created_at
      FROM drafts
      WHERE user_id = ${userId} AND metrics_json != 'null' ${byPersona ? sql`AND persona_id = ${personaId}` : sql`AND TRUE`}
      ORDER BY published_at DESC, id DESC LIMIT 200`);
  },
  async setVariants(id, userId, variants) {
    await orm().update(drafts).set({ variants_json: JSON.stringify(variants), updated_at: now() })
      .where(and(eq(drafts.id, id), eq(drafts.user_id, userId)));
  },
  async byId(id, userId) {
    const row = await one(orm().select().from(drafts).where(and(eq(drafts.id, id), eq(drafts.user_id, userId))));
    return row ? hydrate(row) : null;
  },
  async list(userId, { personaId, archived = false, limit = 200 } = {}) {
    const where = [eq(drafts.user_id, userId), archived ? sql`${drafts.archived_at} <> ''` : eq(drafts.archived_at, '')];
    if (personaId !== undefined) where.push(same(drafts.persona_id, personaId));
    return orm().select({
      id: drafts.id, subject: drafts.subject, platform: drafts.platform, tone: drafts.tone,
      title: drafts.title, status: drafts.status, persona_id: drafts.persona_id, section_id: drafts.section_id,
      archived_at: drafts.archived_at, created_at: drafts.created_at, updated_at: drafts.updated_at,
    }).from(drafts).where(and(...where)).orderBy(desc(drafts.id)).limit(limit);
  },
  async counts(userId, personaId) {
    const personaSql = personaId !== undefined
      ? sql`AND persona_id IS NOT DISTINCT FROM ${personaId}`
      : sql`AND TRUE`;
    const [row] = await read(sql`
      SELECT
        COALESCE(SUM(CASE WHEN archived_at = '' THEN 1 ELSE 0 END), 0)::int AS active,
        COALESCE(SUM(CASE WHEN archived_at <> '' THEN 1 ELSE 0 END), 0)::int AS archived,
        COALESCE(SUM(CASE WHEN archived_at = '' AND status = 'done' THEN 1 ELSE 0 END), 0)::int AS active_done
      FROM drafts WHERE user_id = ${userId} ${personaSql}`);
    return { active: Number(row.active || 0), archived: Number(row.archived || 0), activeDone: Number(row.active_done || 0) };
  },
  async setArchived(id, userId, archived) {
    const rows = await orm().update(drafts).set({ archived_at: archived ? now() : '', updated_at: now() })
      .where(and(eq(drafts.id, id), eq(drafts.user_id, userId))).returning({ id: drafts.id });
    return rows.length > 0;
  },
  async archiveDone(userId, personaId) {
    const where = [eq(drafts.user_id, userId), eq(drafts.archived_at, ''), eq(drafts.status, 'done')];
    if (personaId !== undefined) where.push(same(drafts.persona_id, personaId));
    const t = now();
    const rows = await orm().update(drafts).set({ archived_at: t, updated_at: t }).where(and(...where)).returning({ id: drafts.id });
    return rows.length;
  },
  async usedSubjects(userId, personaId, limit = 60) {
    return orm().select({ subject: drafts.subject, title: drafts.title }).from(drafts)
      .where(and(eq(drafts.user_id, userId), same(drafts.persona_id, personaId)))
      .orderBy(desc(drafts.id)).limit(limit);
  },
  async remove(id, userId) {
    return withTx(async () => {
      // 先锁稿子这一行，和保存（也是先锁稿子、再动历史版本）按同一顺序拿锁，同时删和存不会互相死锁
      await orm().select({ id: drafts.id }).from(drafts).where(and(eq(drafts.id, id), eq(drafts.user_id, userId))).for('update');
      await Revisions.removeFor(id, userId);
      await Metrics.removeFor(id, userId);
      const rows = await orm().delete(drafts).where(and(eq(drafts.id, id), eq(drafts.user_id, userId))).returning({ id: drafts.id });
      return rows.length > 0;
    });
  },
};

export const METRIC_FIELDS = ['views', 'likes', 'comments', 'shares', 'follows'];

const hydrateMetric = (r) => (r ? {
  id: r.id, draftId: r.draft_id, platform: r.platform, capturedOn: r.captured_on,
  ...Object.fromEntries(METRIC_FIELDS.map((k) => [k, r[k]])),
  note: r.note,
} : null);

export const Metrics = {
  async put(draftId, userId, { platform = '', capturedOn, values = {}, note = '' }) {
    const at = now();
    const cols = Object.fromEntries(METRIC_FIELDS.map((k) => [k, Number.isFinite(values[k]) ? values[k] : null]));
    await orm().insert(draftMetrics).values({
      draft_id: draftId, user_id: userId, platform, captured_on: capturedOn, ...cols, note, created_at: at, updated_at: at,
    }).onConflictDoUpdate({
      target: [draftMetrics.draft_id, draftMetrics.platform, draftMetrics.captured_on],
      set: { ...cols, note, updated_at: at },
    });
  },
  async list(draftId, userId) {
    const list = await orm().select().from(draftMetrics)
      .where(and(eq(draftMetrics.draft_id, draftId), eq(draftMetrics.user_id, userId)))
      .orderBy(desc(draftMetrics.captured_on), desc(draftMetrics.id));
    return list.map(hydrateMetric);
  },
  async forDrafts(userId, draftIds) {
    const out = new Map();
    if (!draftIds.length) return out;
    const list = await orm().select().from(draftMetrics)
      .where(and(eq(draftMetrics.user_id, userId), inArray(draftMetrics.draft_id, draftIds)))
      .orderBy(asc(draftMetrics.captured_on), asc(draftMetrics.id));
    for (const r of list) {
      if (!out.has(r.draft_id)) out.set(r.draft_id, []);
      out.get(r.draft_id).push(hydrateMetric(r));
    }
    return out;
  },
  async remove(id, draftId, userId) {
    const rows = await orm().delete(draftMetrics).where(and(
      eq(draftMetrics.id, id), eq(draftMetrics.draft_id, draftId), eq(draftMetrics.user_id, userId),
    )).returning({ id: draftMetrics.id });
    return rows.length > 0;
  },
  async removeFor(draftId, userId) {
    await orm().delete(draftMetrics).where(and(eq(draftMetrics.draft_id, draftId), eq(draftMetrics.user_id, userId)));
  },
};

const hydrateJob = (r) => (r ? {
  id: r.id, userId: r.user_id, kind: r.kind, ref: r.ref, label: r.label,
  payload: parseJson(r.payload_json, {}), status: r.status, result: parseJson(r.result_json, null),
  error: r.error, held: r.held, holdFeature: r.hold_feature, attempts: r.attempts,
  createdAt: r.created_at, startedAt: r.started_at, finishedAt: r.finished_at,
} : null);

export const Jobs = {
  /* 同一个 ref 已经有在排队 / 在跑的，唯一索引会挡住，这里返回 null，调用方去取已有那条 */
  async create({ userId, kind, ref = '', label = '', payload = {} }) {
    const row = await one(orm().insert(jobs).values({
      user_id: userId, kind, ref, label, payload_json: JSON.stringify(payload), created_at: now(),
    }).onConflictDoNothing().returning());
    return hydrateJob(row);
  },
  async byId(id, userId = null) {
    const row = await one(userId == null
      ? orm().select().from(jobs).where(eq(jobs.id, id))
      : orm().select().from(jobs).where(and(eq(jobs.id, id), eq(jobs.user_id, userId))));
    return hydrateJob(row);
  },
  async activeByRef(userId, ref) {
    if (!ref) return null;
    const row = await one(orm().select().from(jobs).where(and(
      eq(jobs.user_id, userId), eq(jobs.ref, ref), inArray(jobs.status, ['queued', 'running']),
    )).orderBy(desc(jobs.id)).limit(1));
    return hydrateJob(row);
  },
  async list(userId, limit = 30) {
    return (await orm().select().from(jobs).where(eq(jobs.user_id, userId)).orderBy(desc(jobs.id)).limit(limit)).map(hydrateJob);
  },
  async queued() {
    return (await orm().select().from(jobs).where(eq(jobs.status, 'queued')).orderBy(asc(jobs.id))).map(hydrateJob);
  },
  async running() {
    return (await orm().select().from(jobs).where(eq(jobs.status, 'running'))).map(hydrateJob);
  },
  async claim(id) {
    const rows = await orm().update(jobs).set({
      status: 'running', started_at: now(), attempts: sql`${jobs.attempts} + 1`,
    }).where(and(eq(jobs.id, id), eq(jobs.status, 'queued'))).returning({ id: jobs.id });
    return rows.length === 1;
  },
  async setHeld(id, held, feature = '') {
    await orm().update(jobs).set({ held: held || 0, hold_feature: feature }).where(eq(jobs.id, id));
  },
  async finish(id, { status, result = null, error = '' }) {
    await orm().update(jobs).set({
      status, result_json: JSON.stringify(result ?? null), error, held: 0, finished_at: now(),
    }).where(eq(jobs.id, id));
    return this.byId(id);
  },
  async requeue(id) {
    await orm().update(jobs).set({ status: 'queued', held: 0, started_at: '' }).where(eq(jobs.id, id));
  },
  async cancel(id, userId) {
    const rows = await orm().update(jobs).set({ status: 'cancelled', finished_at: now() })
      .where(and(eq(jobs.id, id), eq(jobs.user_id, userId), eq(jobs.status, 'queued'))).returning({ id: jobs.id });
    return rows.length === 1;
  },
  async prune(userId, keep = 100) {
    await orm().execute(sql`
      DELETE FROM jobs WHERE user_id = ${userId} AND status NOT IN ('queued', 'running')
      AND id NOT IN (SELECT id FROM jobs WHERE user_id = ${userId} ORDER BY id DESC LIMIT ${keep})`);
  },
};

function hydrateSpeak(row) {
  const review = parseJson(row.review_json, null);
  const live = row.live_content;
  const draftGone = row.draft_id != null && live == null;
  const stale = live != null && live.trim() !== row.script.trim();
  return {
    id: row.id, draftId: row.draft_id, title: row.title, script: row.script,
    cues: parseJson(row.cues_json, null), file: row.file, mime: row.mime, bytes: row.bytes,
    transcript: row.transcript, review, status: row.status, error: row.error, createdAt: row.created_at,
    draftGone, stale, score: review?.score ?? null, next: review?.next || '',
  };
}

const speakSelect = sql`
  SELECT s.*, d.content AS live_content
  FROM speak_takes s
  LEFT JOIN drafts d ON d.id = s.draft_id AND d.user_id = s.user_id`;

export const Speaks = {
  async create({ userId, draftId, title, script, cues, file, mime, bytes }) {
    const row = await one(orm().insert(speakTakes).values({
      user_id: userId, draft_id: draftId ?? null, title: title || '', script: script || '',
      cues_json: JSON.stringify(cues ?? null), file: file || '', mime: mime || '', bytes: bytes || 0, created_at: now(),
    }).returning());
    return this.byId(row.id, userId);
  },
  async setFile(id, userId, file, bytes) {
    await orm().update(speakTakes).set({ file, bytes }).where(and(eq(speakTakes.id, id), eq(speakTakes.user_id, userId)));
  },
  async setStatus(id, userId, status, error = '') {
    await orm().update(speakTakes).set({ status, error }).where(and(eq(speakTakes.id, id), eq(speakTakes.user_id, userId)));
  },
  async finish(id, userId, { transcript, review, status, error }) {
    await orm().update(speakTakes).set({
      transcript: transcript || '', review_json: JSON.stringify(review ?? null), status, error: error || '',
    }).where(and(eq(speakTakes.id, id), eq(speakTakes.user_id, userId)));
    return this.byId(id, userId);
  },
  async byId(id, userId) {
    const [row] = await read(sql`${speakSelect} WHERE s.id = ${id} AND s.user_id = ${userId}`);
    return row ? hydrateSpeak(row) : null;
  },
  async list(userId) {
    return (await read(sql`${speakSelect} WHERE s.user_id = ${userId} ORDER BY s.id DESC`)).map(hydrateSpeak);
  },
  async listByDraft(draftId, userId) {
    return (await read(sql`${speakSelect} WHERE s.user_id = ${userId} AND s.draft_id = ${draftId} ORDER BY s.id DESC`)).map(hydrateSpeak);
  },
  async remove(id, userId) {
    const row = await this.byId(id, userId);
    if (!row) return null;
    await orm().delete(speakTakes).where(and(eq(speakTakes.id, id), eq(speakTakes.user_id, userId)));
    return row;
  },
};

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
