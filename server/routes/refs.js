/* 路由 · refs：成稿参考——这个账号生成选题和成稿时带哪些资料（个人档案、语气档案、相似范文、改稿习惯、素材库、发布数据），
 * 每项能开关、能调权重。每个账号一份；不挂账号（全部创作）的稿子按默认（全开、适中）。规则在 server/refs.js。 */
import { Personas } from '../db.js';
import { HttpError } from '../auth.js';
import { REF_SOURCES, REF_WEIGHTS, WEIGHT_LABEL, normalizeRefs } from '../refs.js';
import { json, requireUser } from './common.js';

const sources = () => REF_SOURCES.map(({ key, label, hint, counts, unit }) => ({ key, label, hint, counts, unit }));

async function load(userId, id) {
  const raw = await Personas.refs(Number(id), userId);
  if (raw == null) throw new HttpError(404, '账号不存在');
  return normalizeRefs(raw);
}

export async function handleRefsGet(req, res, body, params) {
  const user = await requireUser(req);
  json(res, 200, { refs: await load(user.id, params.id), sources: sources(), weights: REF_WEIGHTS.map((k) => ({ key: k, label: WEIGHT_LABEL[k] })) });
}

export async function handleRefsSave(req, res, body, params) {
  const user = await requireUser(req);
  // 只认认得的项和取值，其余按原来的补齐
  const refs = normalizeRefs({ ...(await load(user.id, params.id)), ...(body?.refs || {}) });
  await Personas.setRefs(Number(params.id), user.id, refs);
  json(res, 200, { refs });
}
