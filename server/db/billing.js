import { and, count, desc, eq, ne, sql } from 'drizzle-orm';
import { inTransaction, orm } from '../client.js';
import { orders, settings, usageEvents, users } from '../schema.js';
import { now, one, nums, read } from './_util.js';

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
