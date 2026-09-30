/* 路由 · materials：素材库与选题池。从原 routes.js 原样拆出。 */
import { MATERIAL_KINDS, Materials, Personas, Pool } from '../db.js';
import { HttpError } from '../auth.js';
import { json, requireUser } from './common.js';

/* ==================================================================
 * 素材库
 *
 * 产品里最硬的一条规则是"栏目素材是全篇唯一可信的事实来源，不许编造"。
 * 但素材原来每篇现填、填完就丢。存下来之后：写作时按题材召回相关的几条，
 * 拼进 user 消息——素材越厚，能写的真东西越多，编造的余地越小。
 * ================================================================== */


/* 按题材召回素材。
 *
 * 刻意**不做向量检索**：素材是几十到几百条的量级，标题/标签/正文的字面重合
 * 已经够用，而且结果可解释——用户能看懂"为什么是这几条"。
 * 上限 6 条：再多会挤占正文该占的上下文，模型也开始硬塞。 */
export async function recallMaterials(userId, personaId, text, limit = 6) {
  if (!personaId) return [];
  const all = await Materials.list(userId, personaId);
  if (!all.length) return [];

  // 中文没有空格分词，按 2 字滑窗取词——够粗但对"AI组织变革"这类词组够用
  const src = String(text || '');
  const grams = new Set();
  for (let i = 0; i < src.length - 1; i += 1) {
    const g = src.slice(i, i + 2);
    if (/[\u4e00-\u9fa5A-Za-z0-9]{2}/.test(g)) grams.add(g);
  }
  if (!grams.size) return [];

  const scored = all.map((m) => {
    const hay = `${m.title} ${m.tags} ${m.body.slice(0, 300)}`;
    let hit = 0;
    for (const g of grams) if (hay.includes(g)) hit += 1;
    // 标签命中权重高一些——标签是作者自己标的，比正文里的偶然重合可信
    const tagHit = m.tags ? [...grams].filter((g) => m.tags.includes(g)).length : 0;
    return { m, score: hit + tagHit * 2 };
  }).filter((x) => x.score >= 3);          // 太低的分是噪声，宁可不给

  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.m);
}

export async function handleMaterialList(req, res, body, params) {
  const user = await requireUser(req);
  const personaId = params.id ? Number(params.id) : null;
  if (personaId && !await Personas.byId(personaId, user.id)) throw new HttpError(404, '账号不存在');
  json(res, 200, { materials: await Materials.list(user.id, personaId), kinds: MATERIAL_KINDS });
}

const cleanMaterial = (b) => ({
  kind: MATERIAL_KINDS.includes(b?.kind) ? b.kind : MATERIAL_KINDS[0],
  title: String(b?.title || '').trim().slice(0, 80),
  body: String(b?.body || '').trim().slice(0, 4000),
  tags: String(b?.tags || '').trim().slice(0, 200),
});

export async function handleMaterialCreate(req, res, body, params) {
  const user = await requireUser(req);
  const personaId = Number(params.id);
  if (!await Personas.byId(personaId, user.id)) throw new HttpError(404, '账号不存在');
  const m = cleanMaterial(body);
  if (!m.title) throw new HttpError(400, '给这条素材起个标题');
  if (!m.body) throw new HttpError(400, '素材内容不能为空——空的素材帮不上写作');
  json(res, 200, { material: await Materials.create(user.id, personaId, m) });
}

export async function handleMaterialUpdate(req, res, body, params) {
  const user = await requireUser(req);
  const m = cleanMaterial(body);
  if (!m.title || !m.body) throw new HttpError(400, '标题和内容都不能为空');
  const out = await Materials.update(Number(params.mid), user.id, m);
  if (!out) throw new HttpError(404, '素材不存在');
  json(res, 200, { material: out });
}

export async function handleMaterialDelete(req, res, body, params) {
  const user = await requireUser(req);
  if (!await Materials.remove(Number(params.mid), user.id)) throw new HttpError(404, '素材不存在');
  json(res, 200, { ok: true });
}

/* ==================================================================
 * 选题池与排期
 *
 * 热点里看到的机会、推荐里想留的题材，不当场写就丢了。
 * 池子负责"攒"，plan_date 负责"排到哪天"——空 = 只在池子里。
 * 刻意不做完整日历：自媒体的排期粒度就是"这周写哪几条"。
 * ================================================================== */

export async function handlePoolList(req, res, body, params, url) {
  const user = await requireUser(req);
  const raw = url?.searchParams.get('persona');
  const personaId = raw ? Number(raw) : null;
  json(res, 200, { pool: await Pool.list(user.id, personaId) });
}

export async function handlePoolCreate(req, res, body) {
  const user = await requireUser(req);
  const subject = String(body?.subject || '').trim().slice(0, 200);
  if (!subject) throw new HttpError(400, '题材不能为空');
  const personaId = body?.persona_id ? Number(body.persona_id) : null;
  if (personaId && !await Personas.byId(personaId, user.id)) throw new HttpError(404, '账号不存在');
  json(res, 200, {
    item: await Pool.create(user.id, personaId, {
      subject,
      note: String(body?.note || '').trim().slice(0, 500),
      source: String(body?.source || '手动').slice(0, 20),
      plan_date: cleanDate(body?.plan_date),
    }),
  });
}

/* 日期只收 YYYY-MM-DD，别的一律当空——排期字段被塞进奇怪的值，后面排序就乱了 */
const cleanDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '');

export async function handlePoolUpdate(req, res, body, params) {
  const user = await requireUser(req);
  const patch = {};
  if (body?.subject !== undefined) patch.subject = String(body.subject).trim().slice(0, 200);
  if (body?.note !== undefined) patch.note = String(body.note).trim().slice(0, 500);
  if (body?.plan_date !== undefined) patch.plan_date = cleanDate(body.plan_date);
  if (body?.status !== undefined) patch.status = ['idea', 'planned', 'done'].includes(body.status) ? body.status : 'idea';
  const out = await Pool.update(Number(params.pid), user.id, patch);
  if (!out) throw new HttpError(404, '这条不存在');
  json(res, 200, { item: out });
}

export async function handlePoolDelete(req, res, body, params) {
  const user = await requireUser(req);
  if (!await Pool.remove(Number(params.pid), user.id)) throw new HttpError(404, '这条不存在');
  json(res, 200, { ok: true });
}
