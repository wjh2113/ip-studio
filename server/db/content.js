import { and, asc, count, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { orm, withTx } from '../client.js';
import {
  benchmarks, drafts, frameworks, inboxKeys, jobs, materials, speakTakes, syncKeys, topicPool, users,
} from '../schema.js';
import { Drafts, hydrate } from './drafts.js';
import { Embeddings } from './personas.js';
import { changed, now, one, nums, parseJson, read, same } from './_util.js';

/* 设计稿分类：文章/图片/视频/链接/语音/框架参考/对标账号。旧「经历/数据/金句/观察」已迁到文章，「案例」迁到对标账号。 */
export const MATERIAL_KINDS = ['文章', '图片', '视频', '链接', '语音', '框架参考', '对标账号'];

export const Materials = {
  /* 素材归用户，不挂账号；persona_id 一律写 null（列保留兼容旧数据与召回）。 */
  async create(userId, m) {
    const t = now();
    const row = await one(orm().insert(materials).values({
      user_id: userId, persona_id: null, kind: m.kind, title: m.title,
      body: m.body || '', tags: m.tags || '', created_at: t, updated_at: t,
    }).returning());
    changed(userId);
    return row;
  },
  async update(id, userId, m) {
    const rows = await orm().update(materials).set({
      kind: m.kind, title: m.title, body: m.body || '', tags: m.tags || '', updated_at: now(),
    }).where(and(eq(materials.id, id), eq(materials.user_id, userId))).returning({ id: materials.id });
    if (rows.length) changed(userId);
    return rows.length ? this.byId(id, userId) : null;
  },
  async byId(id, userId) {
    return one(orm().select().from(materials).where(and(eq(materials.id, id), eq(materials.user_id, userId))));
  },
  async list(userId) {
    return orm().select().from(materials).where(eq(materials.user_id, userId)).orderBy(desc(materials.id));
  },
  async remove(id, userId) {
    const rows = await orm().delete(materials).where(and(eq(materials.id, id), eq(materials.user_id, userId))).returning({ id: materials.id });
    if (rows.length) await Embeddings.drop('material', id);
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
    detail: r.detail || '', example: r.example || '',
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
      slots_json: JSON.stringify(f.slots), detail: f.detail || '', example: f.example || '',
      source_text: f.source_text || '', from_key: f.from_key || '',
      created_at: t, updated_at: t,
    }).returning());
    return hydrateFramework(row);
  },
  async update(id, userId, f) {
    const rows = await orm().update(frameworks).set({
      name: f.name, summary: f.summary || '', platforms: JSON.stringify(f.platforms || []),
      scenes: JSON.stringify(f.scenes || []), slots_json: JSON.stringify(f.slots),
      detail: f.detail || '', example: f.example || '', updated_at: now(),
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
  /* personaId 省略 = 该用户全部；传 null = 未绑账号的；传数字 = 指定账号 */
  async list(userId, personaId) {
    const where = [eq(topicPool.user_id, userId)];
    if (personaId !== undefined) where.push(same(topicPool.persona_id, personaId));
    return orm().select().from(topicPool).where(and(...where))
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
  /* 还没写完的选题数。personaId：undefined = 全部账号，null = 未绑定账号的，数字 = 该账号 */
  async countOpen(userId, personaId) {
    const where = [eq(topicPool.user_id, userId), ne(topicPool.status, 'done')];
    if (personaId !== undefined) where.push(same(topicPool.persona_id, personaId));
    return Number((await one(orm().select({ n: count() }).from(topicPool).where(and(...where)))).n);
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
  /* App 首页：在排队 / 在跑的个数，和 sinceIso 之后失败的最近几条 */
  async summary(userId, sinceIso, limit = 5) {
    const active = await one(orm().select({ n: count() }).from(jobs)
      .where(and(eq(jobs.user_id, userId), inArray(jobs.status, ['queued', 'running']))));
    const failed = await orm().select({
      id: jobs.id, kind: jobs.kind, label: jobs.label, error: jobs.error, finishedAt: jobs.finished_at,
    }).from(jobs).where(and(eq(jobs.user_id, userId), eq(jobs.status, 'failed'), sql`${jobs.finished_at} >= ${sinceIso}`))
      .orderBy(desc(jobs.finished_at), desc(jobs.id)).limit(limit);
    return { active: Number(active.n), failed };
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

/* App 离线收件箱的去重记录 */
export const Inbox = {
  /* 先占 key：插进去了返回 null（这是第一次）；已经有了返回那一行（重发）。
     并发的两次重发会在唯一键上排队，后到的等前一个事务提交后读到它的结果 */
  async claim(userId, key, kind) {
    const row = await one(orm().insert(inboxKeys).values({ user_id: userId, key, kind, created_at: now() })
      .onConflictDoNothing().returning());
    if (row) return null;
    return this.byKey(userId, key);
  },
  async byKey(userId, key) {
    return one(orm().select().from(inboxKeys).where(and(eq(inboxKeys.user_id, userId), eq(inboxKeys.key, key))));
  },
  async setRef(userId, key, refId) {
    await orm().update(inboxKeys).set({ ref_id: refId }).where(and(eq(inboxKeys.user_id, userId), eq(inboxKeys.key, key)));
  },
};

const hydrateBenchmark = (r) => (r ? {
  id: r.id, persona_id: r.persona_id, url: r.url, title: r.title,
  outline: parseJson(r.outline_json, []), excerpt: r.excerpt, created_at: r.created_at,
} : null);

export const Benchmarks = {
  async create(userId, personaId, b) {
    return hydrateBenchmark(await one(orm().insert(benchmarks).values({
      user_id: userId, persona_id: personaId, url: b.url || '', title: b.title || '',
      outline_json: JSON.stringify(b.outline || []), excerpt: b.excerpt || '', created_at: now(),
    }).returning()));
  },
  async byId(id, userId) {
    return hydrateBenchmark(await one(orm().select().from(benchmarks).where(and(eq(benchmarks.id, id), eq(benchmarks.user_id, userId)))));
  },
  async list(userId, personaId, limit = 100) {
    return (await orm().select().from(benchmarks)
      .where(and(eq(benchmarks.user_id, userId), eq(benchmarks.persona_id, personaId)))
      .orderBy(desc(benchmarks.id)).limit(limit)).map(hydrateBenchmark);
  },
  async remove(id, userId) {
    const rows = await orm().delete(benchmarks).where(and(eq(benchmarks.id, id), eq(benchmarks.user_id, userId))).returning({ id: benchmarks.id });
    return rows.length > 0;
  },
};

/* 同步密钥（Obsidian 插件）：只存哈希。byHash 顺手记一下最后使用时间（最多一分钟写一次） */
export const SyncKeys = {
  async create(userId, { name, hash, prefix }) {
    return one(orm().insert(syncKeys).values({
      user_id: userId, name, key_hash: hash, prefix, created_at: now(),
    }).returning({ id: syncKeys.id, name: syncKeys.name, prefix: syncKeys.prefix, created_at: syncKeys.created_at, last_used_at: syncKeys.last_used_at }));
  },
  async list(userId) {
    return orm().select({
      id: syncKeys.id, name: syncKeys.name, prefix: syncKeys.prefix,
      created_at: syncKeys.created_at, last_used_at: syncKeys.last_used_at,
    }).from(syncKeys).where(eq(syncKeys.user_id, userId)).orderBy(desc(syncKeys.id));
  },
  async count(userId) {
    const row = await one(orm().select({ n: count() }).from(syncKeys).where(eq(syncKeys.user_id, userId)));
    return Number(row?.n || 0);
  },
  async remove(id, userId) {
    const rows = await orm().delete(syncKeys).where(and(eq(syncKeys.id, id), eq(syncKeys.user_id, userId))).returning({ id: syncKeys.id });
    return rows.length > 0;
  },
  async userByHash(hash) {
    const row = await one(orm().select().from(syncKeys).where(eq(syncKeys.key_hash, hash)));
    if (!row) return null;
    const t = now();
    if (!row.last_used_at || Date.parse(t) - Date.parse(row.last_used_at) > 60_000) {
      await orm().update(syncKeys).set({ last_used_at: t }).where(eq(syncKeys.id, row.id));
    }
    return one(orm().select().from(users).where(eq(users.id, row.user_id)));
  },
};

/* 导出：已成稿的稿子，按 (updated_at, id) 增量翻页。cursor 是上一页最后一条的 updated_at 和 id */
export async function exportDrafts(userId, { afterAt = '', afterId = 0, limit = 50 } = {}) {
  const rows = await orm().select().from(drafts).where(and(
    eq(drafts.user_id, userId),
    eq(drafts.status, 'done'),
    sql`${drafts.content} <> ''`,
    sql`(${drafts.updated_at}, ${drafts.id}) > (${afterAt}, ${afterId})`,
  )).orderBy(asc(drafts.updated_at), asc(drafts.id)).limit(limit);
  const list = [];
  for (const row of rows) {
    const d = hydrate(row);
    d.variants = await Drafts.loadVariants(row.id);
    list.push(d);
  }
  return list;
}
