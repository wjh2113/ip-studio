import { and, asc, count, desc, eq, sql } from 'drizzle-orm';
import { orm } from '../client.js';
import { evalCases, evalRuns, evalVotes, promptVariants } from '../schema.js';
import { now, one, nums, read } from './_util.js';

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
