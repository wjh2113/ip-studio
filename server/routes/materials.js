/* 路由 · materials：素材库与选题池。从原 routes.js 原样拆出。 */
import { bigrams, MATERIAL_KINDS, Materials, overlapScore, Personas, Pool, Profile, PROFILE_KINDS, PROFILE_MAX } from '../db.js';
import { withTx } from '../client.js';
import { rankHybrid } from '../semantic.js';
import { HttpError } from '../auth.js';
import { extractHtml, extractText, fetchPage, FetchError } from '../webpage.js';
import { json, requireUser } from './common.js';

/* ==================================================================
 * 素材库
 *
 * 产品里最硬的一条规则是"栏目素材是全篇唯一可信的事实来源，不许编造"。
 * 但素材原来每篇现填、填完就丢。存下来之后：写作时按题材召回相关的几条，
 * 拼进 user 消息——素材越厚，能写的真东西越多，编造的余地越小。
 * 素材归用户、不挂账号；写作召回看该用户全部素材。
 * ================================================================== */

const BODY_MAX = 15000;

/* 按题材召回素材。
 *
 * 字面重合（2 字滑窗）+ 语义相似（向量）混合排序，见 semantic.js。
 * 字面上命中够多的照样入选；语义只是把「意思相近、字面不同」的那几条也找回来。
 * 上限 6 条：再多会挤占正文该占的上下文，模型也开始硬塞。 */
export async function recallMaterials(userId, _personaId, text, limit = 6) {
  const all = await Materials.list(userId);
  if (!all.length) return [];
  const grams = bigrams(text);
  const lexOf = (m) => {
    const hay = `${m.title} ${m.tags} ${m.body.slice(0, 300)}`;
    // 标签命中权重高一些——标签是作者自己标的，比正文里的偶然重合可信
    const tagHit = m.tags ? [...grams].filter((g) => m.tags.includes(g)).length : 0;
    return overlapScore(grams, hay) + tagHit * 2;
  };
  return (await rankHybrid(userId, 'material', all, text, lexOf)).slice(0, limit).map((x) => x.item);
}

/* 账号范围（选题池仍按账号筛）：不传 = 全部；none = 未绑账号；数字 = 该账号 */
function personaScope(url) {
  const raw = url?.searchParams.get('persona');
  if (raw === null || raw === undefined || raw === '') return undefined;
  if (raw === 'none') return null;
  if (!/^\d+$/.test(raw)) throw new HttpError(400, '账号参数不对');
  return Number(raw);
}

/* 素材库一级页：GET /api/materials（全量，不按账号） */
export async function handleMaterialsIndex(req, res) {
  const user = await requireUser(req);
  json(res, 200, { materials: await Materials.list(user.id), kinds: MATERIAL_KINDS });
}

/* 兼容旧路径：仍按用户全量返回 */
export async function handleMaterialList(req, res, body, params) {
  const user = await requireUser(req);
  const personaId = Number(params.id);
  if (!await Personas.byId(personaId, user.id)) throw new HttpError(404, '账号不存在');
  json(res, 200, { materials: await Materials.list(user.id), kinds: MATERIAL_KINDS });
}

const cleanMaterial = (b) => ({
  kind: MATERIAL_KINDS.includes(b?.kind) ? b.kind : MATERIAL_KINDS[0],
  title: String(b?.title || '').trim().slice(0, 80),
  body: String(b?.body || '').trim().slice(0, BODY_MAX),
  tags: String(b?.tags || '').trim().slice(0, 200),
});

/* POST /api/materials —— 不挂账号 */
export async function handleMaterialCreateUser(req, res, body) {
  const user = await requireUser(req);
  const m = cleanMaterial(body);
  if (!m.title) throw new HttpError(400, '给这条素材起个标题');
  if (!m.body) throw new HttpError(400, '素材内容不能为空——空的素材帮不上写作');
  json(res, 200, { material: await Materials.create(user.id, m) });
}

/* 兼容：POST /api/personas/:id/materials —— 仍创建，但不绑 persona */
export async function handleMaterialCreate(req, res, body, params) {
  const user = await requireUser(req);
  const personaId = Number(params.id);
  if (!await Personas.byId(personaId, user.id)) throw new HttpError(404, '账号不存在');
  const m = cleanMaterial(body);
  if (!m.title) throw new HttpError(400, '给这条素材起个标题');
  if (!m.body) throw new HttpError(400, '素材内容不能为空——空的素材帮不上写作');
  json(res, 200, { material: await Materials.create(user.id, m) });
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

/* POST /api/materials/:mid/to-profile —— 以前素材库里也放了作者自己的经历和数据，现在这些归个人档案：
   挪过去（建一条档案，删掉这条素材），kind 由作者选：work / project / data / opinion / other */
export async function handleMaterialToProfile(req, res, body, params) {
  const user = await requireUser(req);
  const m = await Materials.byId(Number(params.mid), user.id);
  if (!m) throw new HttpError(404, '素材不存在');
  if (await Profile.count(user.id) >= PROFILE_MAX) throw new HttpError(400, `个人档案最多 ${PROFILE_MAX} 条`);
  const kind = PROFILE_KINDS.includes(body?.kind) ? body.kind : 'other';
  const entry = await withTx(async () => {
    const e = await Profile.create(user.id, {
      kind, title: m.title.slice(0, 60), body: m.body.slice(0, 1000), tags: m.tags.slice(0, 120),
    }, 'material');
    await Materials.remove(m.id, user.id);
    return e;
  });
  json(res, 200, { entry });
}

/* POST /api/materials/extract-url —— 抓链接正文，前端再确认存库 */
export async function handleMaterialExtractUrl(req, res, body) {
  await requireUser(req);
  const url = String(body?.url || '').trim();
  if (!url) throw new HttpError(400, '请贴一个链接');
  let page;
  try {
    page = await fetchPage(url);
  } catch (err) {
    if (err instanceof FetchError) throw new HttpError(422, err.message);
    throw err;
  }
  const parsed = page.type === 'html' ? extractHtml(page.body) : extractText(page.body, '');
  const title = (parsed.title || url).slice(0, 80);
  const text = String(parsed.text || parsed.excerpt || '').trim();
  if (!title && !text) throw new HttpError(422, '没从这个网页里读出正文（可能要登录或是动态加载的）');
  const source = `来源：${page.url || url}`;
  const bodyText = text ? `${text}\n\n${source}` : source;
  json(res, 200, {
    title,
    body: bodyText.slice(0, BODY_MAX),
    url: page.url || url,
    excerpt: parsed.excerpt || '',
  });
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
  const personaId = personaScope(url);
  if (typeof personaId === 'number' && !await Personas.byId(personaId, user.id)) {
    throw new HttpError(404, '账号不存在');
  }
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
