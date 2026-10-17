import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { orm, withTx } from '../client.js';
import {
  embeddings, learnLog, personas, profileEntries, sections, stylePrefs, styleSamples,
} from '../schema.js';
import { changed, now, one, nums, parseJson, read, same } from './_util.js';

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
  /* 成稿参考（refs.js）：每个账号一份 */
  async refs(id, userId) {
    const row = await one(orm().select({ refs_json: personas.refs_json }).from(personas)
      .where(and(eq(personas.id, id), eq(personas.user_id, userId))));
    return row ? row.refs_json || '{}' : null;
  },
  async setRefs(id, userId, refs) {
    const rows = await orm().update(personas).set({ refs_json: JSON.stringify(refs) })
      .where(and(eq(personas.id, id), eq(personas.user_id, userId))).returning({ id: personas.id });
    return rows.length > 0;
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
  async setDigest(id, userId, digest, { fullCount } = {}) {
    const set = { style_digest: digest, style_updated_at: now() };
    if (fullCount !== undefined) { set.digest_full_count = fullCount; set.digest_full_at = now(); }
    await orm().update(personas).set(set).where(and(eq(personas.id, id), eq(personas.user_id, userId)));
  },
  /* 该定期梳理的账号：开着自动学习、有档案、上次从头梳理（没有就看建档时间）早于 before、之后又加过样本 */
  async dueForRefresh(before, limit = 50) {
    return read(sql`
      SELECT p.id, p.user_id FROM personas p
      WHERE p.auto_learn = 1 AND p.style_digest <> ''
        AND COALESCE(NULLIF(p.digest_full_at, ''), p.style_updated_at) < ${before}
        AND (SELECT COUNT(*) FROM style_samples s WHERE s.persona_id = p.id) > p.digest_full_count
      ORDER BY p.id LIMIT ${limit}`);
  },
  async setAutoLearn(id, userId, on) {
    const rows = await orm().update(personas).set({ auto_learn: on ? 1 : 0 })
      .where(and(eq(personas.id, id), eq(personas.user_id, userId))).returning({ id: personas.id });
    return rows.length > 0;
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

/* 语气样本。上限 SAMPLE_MAX 篇；notes 是这一篇单独提炼的写作习惯（档案由各篇 notes 合并而来）。
 * source：manual 手动喂 · published 发布后自动 · import 批量导入 · quickstart 快速建号 */
export const SAMPLE_MAX = 200;
const bigrams = (text) => {
  const src = String(text || '');
  const out = new Set();
  for (let i = 0; i < src.length - 1; i += 1) {
    const g = src.slice(i, i + 2);
    if (/[一-龥A-Za-z0-9]{2}/.test(g)) out.add(g);
  }
  return out;
};
/* 按 2 字滑窗算重合度（和素材召回同一套办法，量级小、结果可解释）。hay 里命中多少个 hint 的词 */
export function overlapScore(hintGrams, hay) {
  let hit = 0;
  for (const g of hintGrams) if (hay.includes(g)) hit += 1;
  return hit;
}
export { bigrams };

export const Samples = {
  async create(userId, personaId, { draftId = null, title = '', content, source = 'manual', weight = 1, notes = '' }) {
    const row = await one(orm().insert(styleSamples).values({
      user_id: userId, persona_id: personaId, draft_id: draftId, title, content, created_at: now(),
      source, weight, notes,
    }).returning());
    changed(userId);
    return row;
  },
  /* 这个用户全部样本的开头一段（向量化用） */
  async heads(userId) {
    return orm().select({ id: styleSamples.id, title: styleSamples.title, head: sql`left(${styleSamples.content}, 1200)` })
      .from(styleSamples).where(eq(styleSamples.user_id, userId)).orderBy(desc(styleSamples.id));
  },
  async list(personaId, userId, { withContent = false, limit = SAMPLE_MAX } = {}) {
    const where = and(eq(styleSamples.persona_id, personaId), eq(styleSamples.user_id, userId));
    if (withContent) {
      return orm().select().from(styleSamples).where(where).orderBy(desc(styleSamples.id)).limit(limit);
    }
    const list = await orm().select({
      id: styleSamples.id, draft_id: styleSamples.draft_id, title: styleSamples.title,
      created_at: styleSamples.created_at, length: sql`length(${styleSamples.content})`,
      source: styleSamples.source, weight: styleSamples.weight, learned: sql`(${styleSamples.notes} <> '')`,
    }).from(styleSamples).where(where).orderBy(desc(styleSamples.id)).limit(limit);
    return list.map((r) => nums(r, ['length', 'weight']));
  },
  async count(personaId, userId) {
    const row = await one(orm().select({ n: count() }).from(styleSamples)
      .where(and(eq(styleSamples.persona_id, personaId), eq(styleSamples.user_id, userId))));
    return Number(row?.n || 0);
  },
  async byIds(ids, userId) {
    if (!ids.length) return [];
    return orm().select().from(styleSamples).where(and(inArray(styleSamples.id, ids), eq(styleSamples.user_id, userId)));
  },
  async byDraft(personaId, userId, draftId) {
    return one(orm().select({ id: styleSamples.id }).from(styleSamples).where(and(
      eq(styleSamples.persona_id, personaId), eq(styleSamples.user_id, userId), eq(styleSamples.draft_id, draftId))));
  },
  /* 合并档案用：每篇的 notes，没提炼过的给开头一段原文 */
  async forDigest(personaId, userId, limit = 60) {
    return orm().select({
      id: styleSamples.id, title: styleSamples.title, notes: styleSamples.notes, weight: styleSamples.weight,
      source: styleSamples.source, created_at: styleSamples.created_at,
      excerpt: sql`left(${styleSamples.content}, 1500)`,
    }).from(styleSamples).where(and(eq(styleSamples.persona_id, personaId), eq(styleSamples.user_id, userId)))
      .orderBy(desc(styleSamples.id)).limit(limit);
  },
  async setNotes(id, userId, notes) {
    await orm().update(styleSamples).set({ notes }).where(and(eq(styleSamples.id, id), eq(styleSamples.user_id, userId)));
  },
  /* 写作时的语感锚点：和这次题材最像的 n 篇（看标题和开头），都不像就取最近的 */
  /* rank：可选的排序函数（semantic.js 的语义 + 字面混合），拿候选和字面分函数，回入选的 id 顺序；不给就只看字面 */
  async pickSimilar(personaId, userId, hint, n = 2, rank = null) {
    const rows = await orm().select({
      id: styleSamples.id, title: styleSamples.title, head: sql`left(${styleSamples.content}, 1200)`, weight: styleSamples.weight,
    }).from(styleSamples).where(and(eq(styleSamples.persona_id, personaId), eq(styleSamples.user_id, userId)))
      .orderBy(desc(styleSamples.id)).limit(SAMPLE_MAX);
    if (!rows.length) return [];
    const grams = bigrams(hint);
    const lexOf = (r) => (grams.size ? overlapScore(grams, `${r.title} ${r.head.slice(0, 800)}`) * (Number(r.weight) || 1) : 0);
    let pick;
    if (rank) {
      pick = (await rank(rows, lexOf)).slice(0, n);
    } else {
      pick = rows.map((r, i) => ({ id: r.id, score: lexOf(r), i }))
        .filter((x) => x.score >= 3).sort((a, b) => b.score - a.score || a.i - b.i).slice(0, n).map((x) => x.id);
    }
    for (const r of rows) { if (pick.length >= n) break; if (!pick.includes(r.id)) pick.push(r.id); }
    const full = await this.byIds(pick, userId);
    return pick.map((id) => full.find((r) => r.id === id)).filter(Boolean);
  },
  async remove(id, userId) {
    const rows = await orm().delete(styleSamples).where(and(eq(styleSamples.id, id), eq(styleSamples.user_id, userId))).returning({ id: styleSamples.id });
    if (rows.length) await Embeddings.drop('sample', id);
    return rows.length > 0;
  },
};

/* 个人档案（跟着用户走，所有账号共用） */
/* data = 数据成果：粉丝数、业绩、增长这类可核查的数字（以前有人放在素材库里，现在统一归个人档案） */
export const PROFILE_KINDS = ['work', 'project', 'data', 'opinion', 'other'];
export const PROFILE_MAX = 300;
const profileValues = (e) => ({
  kind: PROFILE_KINDS.includes(e.kind) ? e.kind : 'work',
  title: e.title, period: e.period || '', org: e.org || '', role: e.role || '',
  body: e.body || '', result: e.result || '', tags: e.tags || '',
  visibility: e.visibility === 'background' ? 'background' : 'public',
});
export const Profile = {
  async list(userId) {
    return orm().select().from(profileEntries).where(eq(profileEntries.user_id, userId)).orderBy(desc(profileEntries.id));
  },
  async count(userId) {
    const row = await one(orm().select({ n: count() }).from(profileEntries).where(eq(profileEntries.user_id, userId)));
    return Number(row?.n || 0);
  },
  async byId(id, userId) {
    return one(orm().select().from(profileEntries).where(and(eq(profileEntries.id, id), eq(profileEntries.user_id, userId))));
  },
  async create(userId, e, source = 'manual') {
    const t = now();
    const row = await one(orm().insert(profileEntries).values({
      user_id: userId, ...profileValues(e), source, created_at: t, updated_at: t,
    }).returning());
    changed(userId);
    return row;
  },
  async update(id, userId, e) {
    const rows = await orm().update(profileEntries).set({ ...profileValues(e), updated_at: now() })
      .where(and(eq(profileEntries.id, id), eq(profileEntries.user_id, userId))).returning();
    if (rows.length) changed(userId);
    return rows[0] || null;
  },
  async remove(id, userId) {
    const rows = await orm().delete(profileEntries).where(and(eq(profileEntries.id, id), eq(profileEntries.user_id, userId))).returning({ id: profileEntries.id });
    if (rows.length) await Embeddings.drop('profile', id);
    return rows.length > 0;
  },
  async markUsed(ids, userId) {
    if (!ids.length) return;
    await orm().update(profileEntries).set({ used_count: sql`${profileEntries.used_count} + 1` })
      .where(and(inArray(profileEntries.id, ids), eq(profileEntries.user_id, userId)));
  },
};

/* 向量（迁移 9）。召回时按「这个用户的这一类」取，装了 pgvector 就让库算余弦相似度，没装就取回来在 Node 里算。
 * 向量都归一化过，余弦相似度 = 点积 = 1 - 余弦距离。 */
let vectorSchema;           // undefined = 还没查；null = 没装 pgvector；字符串 = 扩展所在的 schema
export async function pgvectorSchema() {
  if (vectorSchema !== undefined) return vectorSchema;
  if (process.env.PGVECTOR === 'off') return (vectorSchema = null);   // 强制在 Node 里算（测试两条路都要走到）
  try {
    const [row] = await read(sql`SELECT n.nspname AS s FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'vector'`);
    vectorSchema = row?.s && /^[a-z_][a-z0-9_]*$/i.test(row.s) ? row.s : null;
  } catch { vectorSchema = null; }
  return vectorSchema;
}
const dot = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length && i < b.length; i += 1) s += a[i] * b[i];
  return s;
};
export const Embeddings = {
  async hashes(userId, kind, refIds) {
    if (!refIds.length) return new Map();
    const rows = await orm().select({ ref_id: embeddings.ref_id, hash: embeddings.hash }).from(embeddings)
      .where(and(eq(embeddings.user_id, userId), eq(embeddings.kind, kind), inArray(embeddings.ref_id, refIds)));
    return new Map(rows.map((r) => [r.ref_id, r.hash]));
  },
  async put(userId, kind, refId, hash, vec) {
    const t = now();
    await orm().insert(embeddings).values({ user_id: userId, kind, ref_id: refId, hash, vec, updated_at: t })
      .onConflictDoUpdate({ target: [embeddings.kind, embeddings.ref_id], set: { user_id: userId, hash, vec, updated_at: t } });
  },
  async drop(kind, refId) {
    await orm().delete(embeddings).where(and(eq(embeddings.kind, kind), eq(embeddings.ref_id, refId)));
  },
  /* 和 query 的相似度：ref_id → [-1, 1]。只算 refIds 里的（调用方已经按账号、按归属筛过） */
  async similarity(userId, kind, refIds, query) {
    if (!refIds.length) return new Map();
    const schema = await pgvectorSchema();
    if (schema) {
      const q = `[${query.join(',')}]`;
      const vt = sql.raw(`${schema}.vector`);
      const op = sql.raw(`OPERATOR(${schema}.<=>)`);
      const rows = await read(sql`
        SELECT ref_id, 1 - ((vec::${vt}) ${op} (${q}::${vt})) AS sim
        FROM embeddings WHERE user_id = ${userId} AND kind = ${kind} AND ref_id = ANY(string_to_array(${refIds.join(',')}, ',')::int[])`);
      return new Map(rows.map((r) => [Number(r.ref_id), Number(r.sim)]));
    }
    const rows = await orm().select({ ref_id: embeddings.ref_id, vec: embeddings.vec }).from(embeddings)
      .where(and(eq(embeddings.user_id, userId), eq(embeddings.kind, kind), inArray(embeddings.ref_id, refIds)));
    return new Map(rows.map((r) => [r.ref_id, dot(r.vec, query)]));
  },
  async stats(userId) {
    const rows = await read(sql`SELECT kind, COUNT(*)::int AS n FROM embeddings WHERE user_id = ${userId} GROUP BY kind`);
    return Object.fromEntries(rows.map((r) => [r.kind, Number(r.n)]));
  },
};

/* 改稿偏好（按账号） */
export const PREF_MAX = 40;
export const Prefs = {
  async list(personaId, userId) {
    return orm().select().from(stylePrefs).where(and(eq(stylePrefs.persona_id, personaId), eq(stylePrefs.user_id, userId)))
      .orderBy(desc(stylePrefs.hits), desc(stylePrefs.id));
  },
  async active(personaId, userId, limit = 12) {
    return orm().select().from(stylePrefs).where(and(
      eq(stylePrefs.persona_id, personaId), eq(stylePrefs.user_id, userId), eq(stylePrefs.status, 'on'),
    )).orderBy(desc(stylePrefs.hits), desc(stylePrefs.id)).limit(limit);
  },
  async create(userId, personaId, { rule, evidence = '', draftId = null }) {
    const t = now();
    return one(orm().insert(stylePrefs).values({
      user_id: userId, persona_id: personaId, rule, evidence, source_draft_id: draftId, created_at: t, updated_at: t,
    }).returning());
  },
  async update(id, userId, patch) {
    const set = { updated_at: now() };
    if (patch.rule !== undefined) set.rule = patch.rule;
    if (patch.status !== undefined) set.status = patch.status === 'off' ? 'off' : 'on';
    const rows = await orm().update(stylePrefs).set(set).where(and(eq(stylePrefs.id, id), eq(stylePrefs.user_id, userId))).returning();
    return rows[0] || null;
  },
  async bump(ids, userId) {
    if (!ids.length) return;
    await orm().update(stylePrefs).set({ hits: sql`${stylePrefs.hits} + 1`, updated_at: now() })
      .where(and(inArray(stylePrefs.id, ids), eq(stylePrefs.user_id, userId)));
  },
  async remove(id, userId) {
    const rows = await orm().delete(stylePrefs).where(and(eq(stylePrefs.id, id), eq(stylePrefs.user_id, userId))).returning({ id: stylePrefs.id });
    return rows.length > 0;
  },
};

/* 学习记录 */
export const LearnLog = {
  async add(userId, personaId, { kind, summary, detail = null }) {
    return one(orm().insert(learnLog).values({
      user_id: userId, persona_id: personaId ?? null, kind, summary, detail_json: JSON.stringify(detail), created_at: now(),
    }).returning());
  },
  async list(userId, personaId, limit = 40) {
    const rows = await orm().select().from(learnLog).where(and(
      eq(learnLog.user_id, userId),
      personaId == null ? sql`${learnLog.persona_id} IS NULL` : eq(learnLog.persona_id, personaId),
    )).orderBy(desc(learnLog.id)).limit(limit);
    return rows.map(({ detail_json, user_id, ...r }) => ({ ...r, detail: parseJson(detail_json, null) }));
  },
  async setStatus(id, userId, status) {
    const rows = await orm().update(learnLog).set({ status }).where(and(eq(learnLog.id, id), eq(learnLog.user_id, userId))).returning({ id: learnLog.id });
    return rows.length > 0;
  },
};
