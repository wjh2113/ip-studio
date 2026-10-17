import { and, asc, count, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { orm, withTx } from '../client.js';
import { draftMetrics, draftRevisions, draftVariants, drafts } from '../schema.js';
import { rebindCues, rebindIllus } from '../keep.js';
import { editRatio } from '../quality.js';
import { now, one, nums, parseJson, read, same } from './_util.js';

const gapMin = Number(process.env.REVISION_GAP_MIN);
const REVISION_GAP = (process.env.REVISION_GAP_MIN && Number.isFinite(gapMin) && gapMin >= 0 ? gapMin : 10) * 60 * 1000;
const REVISION_MAX = Math.max(5, Math.floor(Number(process.env.REVISION_MAX) || 50));

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

function variantFromRow(r) {
  if (!r) return null;
  let cues = null;
  try { cues = JSON.parse(r.cues_json); } catch { /* 脏数据当没有 */ }
  const out = {
    content: r.content || '',
    chars: Number(r.chars) || 0,
    from: r.from_platform || '',
    at: r.at || '',
    editedAt: r.edited_at || '',
  };
  if (r.from_chars != null) out.fromChars = Number(r.from_chars);
  if (cues != null) out.cues = cues;
  return out;
}

async function insertVariantRow(draftId, userId, platform, v, t) {
  const content = String(v.content || '');
  const chars = Number.isFinite(Number(v.chars)) ? Math.round(Number(v.chars)) : content.length;
  await orm().insert(draftVariants).values({
    draft_id: draftId,
    user_id: userId,
    platform: String(platform),
    content,
    chars,
    from_chars: Number.isFinite(Number(v.fromChars)) ? Math.round(Number(v.fromChars)) : null,
    from_platform: String(v.from || ''),
    cues_json: v.cues === undefined ? 'null' : JSON.stringify(v.cues),
    at: String(v.at || ''),
    edited_at: String(v.editedAt || ''),
    created_at: t,
    updated_at: t,
  });
}

export function hydrate(row) {
  let topics = [];
  let persona = null;
  let hotspot = null;
  let section = null;
  let inputs = null;
  let cues = null;
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
  try { metrics = JSON.parse(row.metrics_json); } catch { /* 同上 */ }
  try { illus = JSON.parse(row.illus_json); } catch { /* 同上 */ }
  const context = parseJson(row.context_json ?? 'null', null);
  const {
    topics_json, persona_json, hotspot_json, section_json,
    inputs_json, cues_json, variants_json, illus_json,
    metrics_json, framework_json, user_id, generated, review_json, context_json, ...rest
  } = row;
  // variants 由 Drafts.byId / exportDrafts 从 draft_variants 表装；这里给空对象占位
  return {
    ...rest, topics, persona, hotspot, section, inputs, cues, variants: {}, illus, metrics, framework, context,
  };
}

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
  async setReview(id, userId, issues, { hash = '', full = null } = {}) {
    const keep = (issues || []).filter((it) => it?.quote).slice(0, 40)
      .map((it) => ({ dimension: it.dimension || '', quote: it.quote, fix: it.fix || '' }));
    await orm().update(drafts).set({
      review_json: JSON.stringify({ at: now(), issues: keep, hash: hash || '', full: full || null }),
    }).where(and(eq(drafts.id, id), eq(drafts.user_id, userId)));
  },
  /* 成稿检查缓存：正文没变就复用上次结果，避免反复花额度 */
  async reviewCache(id, userId) {
    const row = await one(orm().select({ review_json: drafts.review_json }).from(drafts)
      .where(and(eq(drafts.id, id), eq(drafts.user_id, userId))));
    return parseJson(row?.review_json, null);
  },
  async qualityRows(since) {
    return orm().select({
      id: drafts.id, gen_variant: drafts.gen_variant, edit_ratio: drafts.edit_ratio,
      review_json: drafts.review_json, content: drafts.content,
    }).from(drafts).where(and(sql`${drafts.generated} != ''`, sql`${drafts.updated_at} >= ${since}`));
  },
  /* 成稿时参考了什么：经历、范文、素材、偏好条数。只记标题和 id，给作者看「这次用了哪些」 */
  async setContext(id, userId, context) {
    return withTx(async () => {
      const row = await one(orm().select({ id: drafts.id }).from(drafts)
        .where(and(eq(drafts.id, id), eq(drafts.user_id, userId))).for('update'));
      if (!row) return false;
      await orm().update(drafts).set({ context_json: JSON.stringify(context), updated_at: now() })
        .where(and(eq(drafts.id, id), eq(drafts.user_id, userId)));
      return true;
    });
  },
  /* 从改稿里学偏好要用到的：AI 初稿（generated 不随 hydrate 出去）和现在的正文 */
  async learnSource(id, userId) {
    return one(orm().select({
      id: drafts.id, title: drafts.title, subject: drafts.subject, persona_id: drafts.persona_id,
      generated: drafts.generated, content: drafts.content, edit_ratio: drafts.edit_ratio, learned_at: drafts.learned_at,
      published_at: drafts.published_at,
    }).from(drafts).where(and(eq(drafts.id, id), eq(drafts.user_id, userId))));
  },
  async setLearned(id, userId) {
    await orm().update(drafts).set({ learned_at: now() }).where(and(eq(drafts.id, id), eq(drafts.user_id, userId)));
  },
  async setTitle(id, userId, title) {
    await orm().update(drafts).set({ title, updated_at: now() }).where(and(eq(drafts.id, id), eq(drafts.user_id, userId)));
  },
  async setCues(id, userId, cues) {
    return withTx(async () => {
      const row = await one(orm().select({ id: drafts.id }).from(drafts)
        .where(and(eq(drafts.id, id), eq(drafts.user_id, userId))).for('update'));
      if (!row) return false;
      await orm().update(drafts).set({ cues_json: JSON.stringify(cues), updated_at: now() })
        .where(and(eq(drafts.id, id), eq(drafts.user_id, userId)));
      return true;
    });
  },
  /* 整块替换配图（调用方已拼好）。写之前锁行，避免和出图任务互相盖。 */
  async setIllus(id, userId, illus) {
    return withTx(async () => {
      const row = await one(orm().select({ id: drafts.id }).from(drafts)
        .where(and(eq(drafts.id, id), eq(drafts.user_id, userId))).for('update'));
      if (!row) return false;
      await orm().update(drafts).set({ illus_json: JSON.stringify(illus), updated_at: now() })
        .where(and(eq(drafts.id, id), eq(drafts.user_id, userId)));
      return true;
    });
  },
  /* 在锁里改配图：fn(旧对象) → 新对象。出图任务、排版位都走这里，读改写同一事务。 */
  async patchIllus(id, userId, fn) {
    return withTx(async () => {
      const row = await one(orm().select({ illus_json: drafts.illus_json }).from(drafts)
        .where(and(eq(drafts.id, id), eq(drafts.user_id, userId))).for('update'));
      if (!row) return null;
      const prev = parseJson(row.illus_json, null) || {};
      const next = fn(prev);
      await orm().update(drafts).set({ illus_json: JSON.stringify(next), updated_at: now() })
        .where(and(eq(drafts.id, id), eq(drafts.user_id, userId)));
      return next;
    });
  },
  async setMetrics(id, userId, metrics, publishedAt) {
    await orm().update(drafts).set({ metrics_json: JSON.stringify(metrics), published_at: publishedAt || '', updated_at: now() })
      .where(and(eq(drafts.id, id), eq(drafts.user_id, userId)));
  },
  async withMetrics(userId, personaId) {
    const byPersona = personaId !== undefined && personaId !== null;
    return read(sql`
      SELECT id, subject, title, platform, section_id, chosen, topics_json, metrics_json, framework_json, published_at, created_at,
             left(content, 600) AS head
      FROM drafts
      WHERE user_id = ${userId} AND metrics_json != 'null' ${byPersona ? sql`AND persona_id = ${personaId}` : sql`AND TRUE`}
      ORDER BY published_at DESC, id DESC LIMIT 200`);
  },
  /* 平台版本：整表替换（测试 / 兼容旧调用）。正式路径用 upsertVariant / setVariant*。 */
  async setVariants(id, userId, variants) {
    return withTx(async () => {
      const row = await one(orm().select({ id: drafts.id }).from(drafts)
        .where(and(eq(drafts.id, id), eq(drafts.user_id, userId))).for('update'));
      if (!row) return false;
      await orm().delete(draftVariants).where(and(eq(draftVariants.draft_id, id), eq(draftVariants.user_id, userId)));
      const t = now();
      for (const [platform, v] of Object.entries(variants || {})) {
        if (!platform || !v || typeof v !== 'object') continue;
        await insertVariantRow(id, userId, platform, v, t);
      }
      await orm().update(drafts).set({ updated_at: t }).where(and(eq(drafts.id, id), eq(drafts.user_id, userId)));
      return true;
    });
  },
  /* 写入或合并一个平台版本。patch 里有的字段才改；content 和 cues 分列，互不覆盖。 */
  async upsertVariant(id, userId, platform, patch = {}) {
    return withTx(async () => {
      const row = await one(orm().select({ id: drafts.id }).from(drafts)
        .where(and(eq(drafts.id, id), eq(drafts.user_id, userId))).for('update'));
      if (!row) return null;
      const key = String(platform || '');
      if (!key) return null;
      const t = now();
      const existing = await one(orm().select().from(draftVariants)
        .where(and(eq(draftVariants.draft_id, id), eq(draftVariants.platform, key))).for('update'));
      if (!existing) {
        await insertVariantRow(id, userId, key, patch, t);
      } else {
        const next = {
          content: patch.content !== undefined ? String(patch.content) : existing.content,
          chars: patch.chars !== undefined ? Number(patch.chars) : existing.chars,
          from_chars: patch.fromChars !== undefined ? patch.fromChars : existing.from_chars,
          from_platform: patch.from !== undefined ? String(patch.from || '') : existing.from_platform,
          cues_json: patch.cues !== undefined ? JSON.stringify(patch.cues) : existing.cues_json,
          at: patch.at !== undefined ? String(patch.at || '') : existing.at,
          edited_at: patch.editedAt !== undefined ? String(patch.editedAt || '') : existing.edited_at,
          updated_at: t,
        };
        if (patch.content !== undefined && patch.chars === undefined) next.chars = next.content.length;
        await orm().update(draftVariants).set(next)
          .where(and(eq(draftVariants.draft_id, id), eq(draftVariants.platform, key)));
      }
      await orm().update(drafts).set({ updated_at: t }).where(and(eq(drafts.id, id), eq(drafts.user_id, userId)));
      return variantFromRow(await one(orm().select().from(draftVariants)
        .where(and(eq(draftVariants.draft_id, id), eq(draftVariants.platform, key)))));
    });
  },
  async deleteVariant(id, userId, platform) {
    return withTx(async () => {
      const row = await one(orm().select({ id: drafts.id }).from(drafts)
        .where(and(eq(drafts.id, id), eq(drafts.user_id, userId))).for('update'));
      if (!row) return false;
      const deleted = await orm().delete(draftVariants)
        .where(and(eq(draftVariants.draft_id, id), eq(draftVariants.user_id, userId), eq(draftVariants.platform, String(platform))))
        .returning({ id: draftVariants.id });
      await orm().update(drafts).set({ updated_at: now() }).where(and(eq(drafts.id, id), eq(drafts.user_id, userId)));
      return deleted.length > 0;
    });
  },
  async loadVariants(draftId) {
    const rows = await orm().select().from(draftVariants)
      .where(eq(draftVariants.draft_id, draftId)).orderBy(asc(draftVariants.platform));
    const out = {};
    for (const r of rows) out[r.platform] = variantFromRow(r);
    return out;
  },
  async byId(id, userId) {
    const row = await one(orm().select().from(drafts).where(and(eq(drafts.id, id), eq(drafts.user_id, userId))));
    if (!row) return null;
    const draft = hydrate(row);
    draft.variants = await this.loadVariants(id);
    return draft;
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
  async setPublished(id, userId, day) {
    const rows = await orm().update(drafts).set({ published_at: day, updated_at: now() })
      .where(and(eq(drafts.id, id), eq(drafts.user_id, userId)))
      .returning({ id: drafts.id, published_at: drafts.published_at });
    return rows[0] || null;
  },
  /* App「今天」和日历用的一张表：每篇没归档的稿子一行，带上排期、口播、回填这几样判断要用的东西。
     口播「练过」= 有一条评分 ≥ 60 的录音；排期取关联选题里最早的那个日期；回填只要最后一次的日期。
     personaId：undefined = 全部账号，null = 未绑定账号的，数字 = 该账号 */
  async agenda(userId, personaId) {
    const byPersona = personaId !== undefined ? sql`AND d.persona_id IS NOT DISTINCT FROM ${personaId}` : sql`AND TRUE`;
    const list = await read(sql`
      SELECT d.id, d.title, d.subject, d.platform, d.status, d.published_at, d.updated_at,
             COALESCE(json_array_length(CASE WHEN json_typeof(d.cues_json::json->'cues') = 'array'
               THEN d.cues_json::json->'cues' END), 0) > 0 AS has_cues,
             EXISTS (
               SELECT 1 FROM speak_takes s
               WHERE s.user_id = d.user_id AND s.draft_id = d.id
                 AND json_typeof(s.review_json::json->'score') = 'number'
                 AND (s.review_json::json->>'score')::numeric >= 60
             ) AS spoken,
             (SELECT MIN(p.plan_date) FROM topic_pool p
              WHERE p.user_id = d.user_id AND p.draft_id = d.id AND p.plan_date <> '') AS plan_date,
             (SELECT MAX(m.captured_on) FROM draft_metrics m
              WHERE m.user_id = d.user_id AND m.draft_id = d.id) AS last_metric
      FROM drafts d
      WHERE d.user_id = ${userId} AND d.archived_at = '' ${byPersona}
      ORDER BY d.updated_at DESC, d.id DESC`);
    return list.map((r) => ({ ...nums(r, ['id']), has_cues: Boolean(r.has_cues), spoken: Boolean(r.spoken) }));
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
