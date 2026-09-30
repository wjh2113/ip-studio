/* 路由 · personas：账号设定、内容栏目、语气样本与语气档案。从原 routes.js 原样拆出。 */
import { Drafts, Personas, Samples, Sections } from '../db.js';
import { HttpError } from '../auth.js';
import { generateText } from '../llm.js';
import { DEFAULT_PLATFORM, DEFAULT_TONE, DIGEST_SYSTEM, digestUser, GENDERS, PLATFORMS, SECTION_PRESETS, TONES } from '../prompts.js';
import { json, requireUser, sys } from './common.js';

/* ---------------- 账号设定 ---------------- */

function normalizePersona(body = {}) {
  const name = String(body.name ?? '').trim();
  if (!name) throw new HttpError(400, '请填写账号名称');
  if (name.length > 40) throw new HttpError(400, '账号名称请控制在 40 字以内');

  const text = (v, max) => String(v ?? '').trim().slice(0, max);
  return {
    name,
    platform: PLATFORMS[body.platform] ? body.platform : DEFAULT_PLATFORM,
    tone: TONES[body.tone] ? body.tone : DEFAULT_TONE,
    content_focus: text(body.content_focus, 500),
    audience: text(body.audience, 500),
    problem: text(body.problem, 500),
    notes: text(body.notes, 800),
    // 个人人设：全部选填，留空即不写进提示词
    creator_age: text(body.creator_age, 20),
    creator_gender: GENDERS.includes(body.creator_gender) ? body.creator_gender : '',
    creator_industry: text(body.creator_industry, 60),
    creator_role: text(body.creator_role, 60),
    creator_traits: text(body.creator_traits, 300),
  };
}

export async function handlePersonaList(req, res) {
  const user = requireUser(req);
  json(res, 200, { personas: Personas.list(user.id) });
}

export async function handlePersonaCreate(req, res, body) {
  const user = requireUser(req);
  if (Personas.list(user.id).length >= 20) throw new HttpError(400, '账号数量已达上限（20 个）');
  json(res, 200, { persona: Personas.create(user.id, normalizePersona(body)) });
}

export async function handlePersonaUpdate(req, res, body, params) {
  const user = requireUser(req);
  const persona = Personas.update(Number(params.id), user.id, normalizePersona(body));
  if (!persona) throw new HttpError(404, '账号不存在');
  json(res, 200, { persona });
}

export async function handlePersonaDelete(req, res, body, params) {
  const user = requireUser(req);
  if (!Personas.remove(Number(params.id), user.id)) throw new HttpError(404, '账号不存在');
  json(res, 200, { ok: true });
}

/* ---------------- 内容栏目 ---------------- */

const SECTION_MAX = 12;

const SECTION_FIELD_MAX = 8;

function normalizeSection(body = {}) {
  const name = String(body.name ?? '').trim();
  if (!name) throw new HttpError(400, '请填写栏目名');
  if (name.length > 20) throw new HttpError(400, '栏目名请控制在 20 字以内');
  const text = (v, n) => String(v ?? '').trim().slice(0, n);

  // 每个栏目自己声明要作者提供哪些素材
  const seen = new Set();
  const fields = (Array.isArray(body.fields) ? body.fields : [])
    .map((f) => ({
      label: text(f?.label, 30),
      hint: text(f?.hint, 80),
      required: Boolean(f?.required),
    }))
    .filter((f) => {
      if (!f.label || seen.has(f.label)) return false;
      seen.add(f.label);
      return true;
    })
    .slice(0, SECTION_FIELD_MAX);

  return { name, purpose: text(body.purpose, 300), guide: text(body.guide, 600), fields };
}

export async function handleSectionList(req, res, body, params) {
  const user = requireUser(req);
  const persona = Personas.byId(Number(params.id), user.id);
  if (!persona) throw new HttpError(404, '账号不存在');
  json(res, 200, { sections: Sections.list(persona.id, user.id), presets: SECTION_PRESETS });
}

export async function handleSectionCreate(req, res, body, params) {
  const user = requireUser(req);
  const persona = Personas.byId(Number(params.id), user.id);
  if (!persona) throw new HttpError(404, '账号不存在');
  if (Sections.list(persona.id, user.id).length >= SECTION_MAX) {
    throw new HttpError(400, `栏目数量已达上限（${SECTION_MAX} 个）`);
  }
  Sections.create(user.id, persona.id, normalizeSection(body));
  json(res, 200, { sections: Sections.list(persona.id, user.id) });
}

export async function handleSectionUpdate(req, res, body, params) {
  const user = requireUser(req);
  const persona = Personas.byId(Number(params.id), user.id);
  if (!persona) throw new HttpError(404, '账号不存在');
  if (!Sections.update(Number(params.sectionId), user.id, normalizeSection(body))) {
    throw new HttpError(404, '栏目不存在');
  }
  json(res, 200, { sections: Sections.list(persona.id, user.id) });
}

export async function handleSectionDelete(req, res, body, params) {
  const user = requireUser(req);
  const persona = Personas.byId(Number(params.id), user.id);
  if (!persona) throw new HttpError(404, '账号不存在');
  if (!Sections.remove(Number(params.sectionId), user.id)) throw new HttpError(404, '栏目不存在');
  json(res, 200, { sections: Sections.list(persona.id, user.id) });
}

/* ---------------- 语气学习 ---------------- */

const DIGEST_MAX_SAMPLES = 6;

const DIGEST_MAX_CHARS = 3000;

export async function handleSampleList(req, res, body, params) {
  const user = requireUser(req);
  const persona = Personas.byId(Number(params.id), user.id);
  if (!persona) throw new HttpError(404, '账号不存在');
  json(res, 200, {
    samples: Samples.list(persona.id, user.id),
    digest: persona.style_digest,
    updated_at: persona.style_updated_at,
  });
}

export async function handleSampleCreate(req, res, body, params) {
  const user = requireUser(req);
  const persona = Personas.byId(Number(params.id), user.id);
  if (!persona) throw new HttpError(404, '账号不存在');

  let title = String(body?.title ?? '').trim().slice(0, 120);
  let content = String(body?.content ?? '').trim();
  let draftId = null;

  // 直接喂一篇创作记录
  if (body?.draft_id) {
    const draft = Drafts.byId(Number(body.draft_id), user.id);
    if (!draft) throw new HttpError(404, '记录不存在');
    if (!draft.content.trim()) throw new HttpError(400, '这篇还没有正文');
    draftId = draft.id;
    title = title || draft.title || draft.subject;
    content = draft.content;
  }

  if (content.replace(/\s/g, '').length < 100) throw new HttpError(400, '样本太短了，至少 100 字才学得出语气');
  if (content.length > 20000) throw new HttpError(400, '样本过长，请截取代表性的一篇');
  if (Samples.list(persona.id, user.id, { limit: 100 }).length >= 30) {
    throw new HttpError(400, '样本数量已达上限（30 篇），请先删掉一些');
  }

  Samples.create(user.id, persona.id, { draftId, title, content });
  const digest = await rebuildDigest(persona, user.id);
  json(res, 200, {
    persona: Personas.byId(persona.id, user.id),
    samples: Samples.list(persona.id, user.id),
    digest,
  });
}

export async function handleSampleDelete(req, res, body, params) {
  const user = requireUser(req);
  const persona = Personas.byId(Number(params.id), user.id);
  if (!persona) throw new HttpError(404, '账号不存在');
  if (!Samples.remove(Number(params.sampleId), user.id)) throw new HttpError(404, '样本不存在');

  const left = Samples.list(persona.id, user.id, { limit: 1 });
  const digest = left.length ? await rebuildDigest(persona, user.id) : '';
  if (!left.length) Personas.setDigest(persona.id, user.id, '');
  json(res, 200, { samples: Samples.list(persona.id, user.id), digest });
}

export async function handleDigestRebuild(req, res, body, params) {
  const user = requireUser(req);
  const persona = Personas.byId(Number(params.id), user.id);
  if (!persona) throw new HttpError(404, '账号不存在');
  if (!Samples.list(persona.id, user.id, { limit: 1 }).length) {
    throw new HttpError(400, '还没有样本可学');
  }
  json(res, 200, { digest: await rebuildDigest(persona, user.id) });
}

/* 把样本重新蒸馏成语气档案 —— 每次增删样本后都重算，保证档案和样本一致 */
async function rebuildDigest(persona, userId) {
  const samples = Samples.list(persona.id, userId, { withContent: true, limit: DIGEST_MAX_SAMPLES })
    .map((s) => ({ title: s.title, content: s.content.slice(0, DIGEST_MAX_CHARS) }));
  if (!samples.length) return '';

  const digest = await generateText({
    meta: { feature: '语气档案', userId },
    system: sys('digest', DIGEST_SYSTEM),
    user: digestUser(samples),
    mock: () => mockDigest(samples.length),
  });

  const cleaned = String(digest).trim().slice(0, 4000);
  Personas.setDigest(persona.id, userId, cleaned);
  return cleaned;
}

const mockDigest = (n) => [
  `- 演示模式：这里会由大模型从 ${n} 篇样本里总结出可复制的写作习惯`,
  '- 例如：段落多为 1-3 行，几乎不写超过 5 行的长段',
  '- 例如：开头常用一个具体场景，而不是抛结论',
  '- 配置模型密钥后，这份档案会变成真实的语气总结',
].join('\n');
