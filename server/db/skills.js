/* 我的技能：每人最多 SKILL_MAX 条，按 sort、id 排。只能动自己的。
 * 一个技能 = 名字 + 描述 + 标签 + 正文（怎么改）+ 参考资料（素材库条目或贴的范文）。 */
import { and, asc, count, eq } from 'drizzle-orm';
import { orm } from '../client.js';
import { skills } from '../schema.js';
import { now, one, parseJson } from './_util.js';

export const SKILL_MAX = 30;

const view = (r) => r && ({
  id: r.id, name: r.name, description: r.description || '', instruction: r.instruction,
  tags: parseJson(r.tags_json, []), refs: parseJson(r.refs_json, []), inReview: Boolean(r.in_review),
  sort: r.sort, created_at: r.created_at, updated_at: r.updated_at,
});

const toRow = (d) => {
  const row = {};
  for (const k of ['name', 'description', 'instruction']) if (d[k] != null) row[k] = d[k];
  if (d.tags != null) row.tags_json = JSON.stringify(d.tags);
  if (d.refs != null) row.refs_json = JSON.stringify(d.refs);
  if (d.inReview != null) row.in_review = Boolean(d.inReview);
  return row;
};

export const Skills = {
  async list(userId) {
    return (await orm().select().from(skills).where(eq(skills.user_id, userId))
      .orderBy(asc(skills.sort), asc(skills.id))).map(view);
  },
  async byId(id, userId) {
    return view(await one(orm().select().from(skills).where(and(eq(skills.id, id), eq(skills.user_id, userId)))));
  },
  async count(userId) {
    return Number((await one(orm().select({ n: count() }).from(skills).where(eq(skills.user_id, userId))))?.n || 0);
  },
  async create(userId, data) {
    const at = now();
    return view(await one(orm().insert(skills).values({
      user_id: userId, description: '', ...toRow(data), sort: await this.count(userId), created_at: at, updated_at: at,
    }).returning()));
  },
  async update(id, userId, patch) {
    return view(await one(orm().update(skills).set({ ...toRow(patch), updated_at: now() })
      .where(and(eq(skills.id, id), eq(skills.user_id, userId))).returning()));
  },
  async remove(id, userId) {
    return Boolean(await one(orm().delete(skills)
      .where(and(eq(skills.id, id), eq(skills.user_id, userId))).returning({ id: skills.id })));
  },
};
