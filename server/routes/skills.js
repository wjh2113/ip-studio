/* 路由 · skills：我的技能（常用改稿要求做成一整页：名字、描述、标签、正文、参考资料）。
 * 增删改查、复制，只能动自己的。用的时候：划词改写传 action=skill + skillId，AI 对话传 skillId，
 * 服务端把整个技能（正文 + 参考资料）作为一块「技能说明」交给模型（loadSkill）。 */
import { Materials, SKILL_MAX, Skills } from '../db.js';
import { HttpError } from '../auth.js';
import { json, requireUser } from './common.js';

const REF_MAX = 5;
const REF_TEXT_MAX = 3000;

async function cleanRefs(raw, userId) {
  if (!Array.isArray(raw)) throw new HttpError(400, '参考资料格式不对');
  if (raw.length > REF_MAX) throw new HttpError(400, `参考资料最多 ${REF_MAX} 条`);
  const out = [];
  for (const r of raw) {
    if (r?.type === 'material') {
      const id = Number(r.id);
      if (!await Materials.byId(id, userId)) throw new HttpError(400, '有一条素材找不到了，删掉它再保存');
      out.push({ type: 'material', id });
    } else if (r?.type === 'text') {
      const text = String(r.text || '').trim().slice(0, REF_TEXT_MAX);
      if (!text) continue;
      out.push({ type: 'text', title: String(r.title || '').trim().slice(0, 30) || '范文', text });
    }
  }
  return out;
}

async function clean(body, userId, partial = false) {
  const out = {};
  if (!partial || body?.name != null) {
    const name = String(body?.name ?? '').trim().slice(0, 30);
    if (!name) throw new HttpError(400, '给技能起个名字（30 字以内）');
    out.name = name;
  }
  if (!partial || body?.instruction != null) {
    const instruction = String(body?.instruction ?? '').trim().slice(0, 8000);
    if (instruction.length < 4) throw new HttpError(400, '正文里写清楚要怎么改（至少 4 个字）');
    out.instruction = instruction;
  }
  if (body?.description != null) out.description = String(body.description).trim().slice(0, 120);
  if (body?.tags != null) {
    if (!Array.isArray(body.tags)) throw new HttpError(400, '标签格式不对');
    out.tags = [...new Set(body.tags.map((t) => String(t || '').trim().slice(0, 12)).filter(Boolean))].slice(0, 8);
  }
  if (body?.refs != null) out.refs = await cleanRefs(body.refs, userId);
  if (body?.inReview != null) out.inReview = body.inReview === true;
  return out;
}

/* 给页面：素材类参考资料补上标题，找不到的标 missing */
async function withRefTitles(skill, userId) {
  if (!skill) return skill;
  const refs = [];
  for (const r of skill.refs || []) {
    if (r.type === 'material') {
      const m = await Materials.byId(r.id, userId);
      refs.push(m ? { ...r, title: m.title, kind: m.kind } : { ...r, title: '（素材已删除）', missing: true });
    } else refs.push(r);
  }
  return { ...skill, refs };
}

export async function handleSkillsList(req, res) {
  const user = await requireUser(req);
  // 列表不带正文和参考资料全文，菜单和技能库够用
  const skills = (await Skills.list(user.id)).map((s) => ({
    id: s.id, name: s.name, description: s.description, tags: s.tags,
    refCount: s.refs.length, size: s.instruction.length, inReview: s.inReview, updated_at: s.updated_at,
  }));
  json(res, 200, { skills, max: SKILL_MAX, me: user.username });
}

export async function handleSkillGet(req, res, body, params) {
  const user = await requireUser(req);
  const skill = await withRefTitles(await Skills.byId(Number(params.sid), user.id), user.id);
  if (!skill) throw new HttpError(404, '没有这个技能');
  json(res, 200, { skill, me: user.username });
}

/* 「检查时也参考」最多开 REVIEW_SKILL_MAX 个：多了审稿要求比正文还长，检查会跑偏 */
async function checkReviewCap(data, userId, selfId = null) {
  if (data.inReview !== true) return;
  const on = (await Skills.list(userId)).filter((s) => s.inReview && s.id !== selfId).length;
  if (on >= REVIEW_SKILL_MAX) throw new HttpError(400, `「检查时也参考」最多开 ${REVIEW_SKILL_MAX} 个技能，先关掉一个`);
}

export async function handleSkillCreate(req, res, body) {
  const user = await requireUser(req);
  const data = await clean(body, user.id);
  await checkReviewCap(data, user.id);
  if (await Skills.count(user.id) >= SKILL_MAX) throw new HttpError(400, `技能最多存 ${SKILL_MAX} 个，删掉不用的再加`);
  json(res, 200, { skill: await withRefTitles(await Skills.create(user.id, data), user.id) });
}

export async function handleSkillUpdate(req, res, body, params) {
  const user = await requireUser(req);
  const data = await clean(body, user.id, true);
  await checkReviewCap(data, user.id, Number(params.sid));
  const skill = await Skills.update(Number(params.sid), user.id, data);
  if (!skill) throw new HttpError(404, '没有这个技能');
  json(res, 200, { skill: await withRefTitles(skill, user.id) });
}

export async function handleSkillCopy(req, res, body, params) {
  const user = await requireUser(req);
  const src = await Skills.byId(Number(params.sid), user.id);
  if (!src) throw new HttpError(404, '没有这个技能');
  if (await Skills.count(user.id) >= SKILL_MAX) throw new HttpError(400, `技能最多存 ${SKILL_MAX} 个，删掉不用的再加`);
  const skill = await Skills.create(user.id, {
    name: `${src.name}（副本）`.slice(0, 30), description: src.description, instruction: src.instruction, tags: src.tags, refs: src.refs,
  });
  json(res, 200, { skill: await withRefTitles(skill, user.id) });
}

export async function handleSkillDelete(req, res, body, params) {
  const user = await requireUser(req);
  if (!await Skills.remove(Number(params.sid), user.id)) throw new HttpError(404, '没有这个技能');
  json(res, 200, { ok: true });
}

/* 调用时加载：正文 + 参考资料全文（素材取正文，删了的跳过）。给划词改写和 AI 对话用 */
export async function loadSkill(skillId, userId) {
  const s = await Skills.byId(Number(skillId), userId);
  if (!s) throw new HttpError(404, '这个技能已经删了，换一个');
  const refs = [];
  for (const r of s.refs) {
    if (r.type === 'material') {
      const m = await Materials.byId(r.id, userId);
      if (m) refs.push({ title: m.title, text: String(m.body || m.title).slice(0, REF_TEXT_MAX) });
    } else refs.push({ title: r.title, text: r.text });
  }
  return { id: s.id, name: s.name, description: s.description, instruction: s.instruction, refs };
}

/* 成稿检查要参考的技能：作者在技能页打开了「检查时也参考」的那些。
   最多 REVIEW_SKILL_MAX 个（按技能库里的顺序），免得审稿要求比正文还长 */
export const REVIEW_SKILL_MAX = 3;
export async function reviewSkills(userId) {
  const on = (await Skills.list(userId)).filter((s) => s.inReview).slice(0, REVIEW_SKILL_MAX);
  const out = [];
  for (const s of on) out.push({ ...await loadSkill(s.id, userId), updated_at: s.updated_at });
  return out;
}
