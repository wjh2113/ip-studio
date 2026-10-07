/* 路由 · personas：账号设定、内容栏目、语气样本与语气档案。从原 routes.js 原样拆出。 */
import { Drafts, Personas, SAMPLE_MAX, Samples, Sections } from '../db.js';
import { HttpError } from '../auth.js';
import { generateJSON } from '../llm.js';
import { addSampleAndLearn, enqueueLearn, updateDigest } from '../learning.js';
import { presentJob } from '../jobs.js';
import {
  DEFAULT_PLATFORM, DEFAULT_TONE, GENDERS, PLATFORMS, QUICKSTART_SCHEMA, QUICKSTART_SYSTEM,
  quickstartUser, SECTION_PRESETS, TONES,
} from '../prompts.js';
import { json, requireUser, sys, withRetry } from './common.js';

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
  const user = await requireUser(req);
  json(res, 200, { personas: await Personas.list(user.id) });
}

export async function handlePersonaCreate(req, res, body) {
  const user = await requireUser(req);
  if ((await Personas.list(user.id)).length >= 20) throw new HttpError(400, '账号数量已达上限（20 个）');
  json(res, 200, { persona: await Personas.create(user.id, normalizePersona(body)) });
}

export async function handlePersonaUpdate(req, res, body, params) {
  const user = await requireUser(req);
  const persona = await Personas.update(Number(params.id), user.id, normalizePersona(body));
  if (!persona) throw new HttpError(404, '账号不存在');
  json(res, 200, { persona });
}

export async function handlePersonaDelete(req, res, body, params) {
  const user = await requireUser(req);
  if (!await Personas.remove(Number(params.id), user.id)) throw new HttpError(404, '账号不存在');
  json(res, 200, { ok: true });
}

/* ---------------- 快速建号 ----------------
   新手贴一段自我介绍（可以再贴几篇旧文章，用单独一行 --- 隔开），模型把账号设定填出来。
   **不直接保存**：结果填进设定表单给他改；保存之后旧文章再批量存成语气样本（见 handleSampleBatch）。 */

export const QUICK_LIMITS = { intro: 3000, posts: 5, post: 20000, sampleMin: 100 };

/* 旧文章按单独一行的 --- 切开；没有分隔就当一篇。标题取第一行 */
export function splitPosts(raw) {
  return String(raw || '').split(/\n\s*-{3,}\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.replace(/\s/g, '').length >= QUICK_LIMITS.sampleMin)
    .slice(0, QUICK_LIMITS.posts)
    .map((p) => ({
      title: p.split('\n')[0].replace(/^#+\s*/, '').trim().slice(0, 40),
      content: p.slice(0, QUICK_LIMITS.post),
    }));
}

/* 模型填的设定再过一遍：选项类只收选项里的，年龄里的数字必须在介绍原文里出现过 */
export function cleanQuickFields(out, intro) {
  const text = (v, max) => String(v ?? '').trim().slice(0, max);
  const age = text(out?.creator_age, 20);
  const digits = age.match(/\d+/g) || [];
  return {
    name: text(out?.name, 40) || '我的账号',
    platform: PLATFORMS[out?.platform] ? out.platform : '',
    tone: TONES[out?.tone] ? out.tone : '',
    content_focus: text(out?.content_focus, 500),
    audience: text(out?.audience, 500),
    problem: text(out?.problem, 500),
    notes: text(out?.notes, 800),
    creator_age: digits.length && digits.every((d) => intro.includes(d)) ? age : '',
    creator_gender: GENDERS.includes(out?.creator_gender) ? out.creator_gender : '',
    creator_industry: text(out?.creator_industry, 60),
    creator_role: text(out?.creator_role, 60),
    creator_traits: text(out?.creator_traits, 300),
  };
}

export async function handleQuickstart(req, res, body) {
  const user = await requireUser(req);
  const intro = String(body?.intro || '').trim();
  if (intro.replace(/\s/g, '').length < 20) throw new HttpError(400, '自我介绍再多写几句吧，至少 20 字：你是谁、写什么、写给谁');
  if (intro.length > QUICK_LIMITS.intro) throw new HttpError(400, `自我介绍请控制在 ${QUICK_LIMITS.intro} 字以内`);
  const posts = splitPosts(body?.posts);

  const out = await withRetry(() => generateJSON({
    meta: { feature: '快速建号', userId: user.id },
    system: sys('quickstart', QUICKSTART_SYSTEM),
    user: quickstartUser(intro, posts.map((p) => p.content)),
    schema: QUICKSTART_SCHEMA,
    mock: () => ({
      name: '', platform: PLATFORMS[body?.platform] ? body.platform : '', tone: '',
      content_focus: `演示模式：这里会从介绍里归纳「写什么」——${intro.slice(0, 30)}`,
      audience: '演示模式：这里会归纳「写给谁」', problem: '演示模式：这里会归纳「解决什么问题」', notes: '',
      creator_age: '', creator_gender: '', creator_industry: '', creator_role: '', creator_traits: '',
    }),
  }), '没能从介绍里整理出设定，请再试一次');

  const fields = cleanQuickFields(out, intro);
  // 用户在引导里选了平台就以他选的为准
  if (PLATFORMS[body?.platform]) fields.platform = body.platform;
  const empty = Object.entries(fields).filter(([, v]) => !v).map(([k]) => k);
  json(res, 200, { fields, samples: posts, empty });
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

  // 栏目默认框架：选这个栏目时自动带上（作者还能在简报里换掉）
  const fw = String(body.default_framework || '');
  const default_framework = /^(b:[\w-]+|u:\d+)$/.test(fw) ? fw : '';
  return { name, purpose: text(body.purpose, 300), guide: text(body.guide, 600), fields, default_framework };
}

export async function handleSectionList(req, res, body, params) {
  const user = await requireUser(req);
  const persona = await Personas.byId(Number(params.id), user.id);
  if (!persona) throw new HttpError(404, '账号不存在');
  json(res, 200, { sections: await Sections.list(persona.id, user.id), presets: SECTION_PRESETS });
}

export async function handleSectionCreate(req, res, body, params) {
  const user = await requireUser(req);
  const persona = await Personas.byId(Number(params.id), user.id);
  if (!persona) throw new HttpError(404, '账号不存在');
  if ((await Sections.list(persona.id, user.id)).length >= SECTION_MAX) {
    throw new HttpError(400, `栏目数量已达上限（${SECTION_MAX} 个）`);
  }
  await Sections.create(user.id, persona.id, normalizeSection(body));
  json(res, 200, { sections: await Sections.list(persona.id, user.id) });
}

export async function handleSectionUpdate(req, res, body, params) {
  const user = await requireUser(req);
  const persona = await Personas.byId(Number(params.id), user.id);
  if (!persona) throw new HttpError(404, '账号不存在');
  if (!await Sections.update(Number(params.sectionId), user.id, normalizeSection(body))) {
    throw new HttpError(404, '栏目不存在');
  }
  json(res, 200, { sections: await Sections.list(persona.id, user.id) });
}

export async function handleSectionDelete(req, res, body, params) {
  const user = await requireUser(req);
  const persona = await Personas.byId(Number(params.id), user.id);
  if (!persona) throw new HttpError(404, '账号不存在');
  if (!await Sections.remove(Number(params.sectionId), user.id)) throw new HttpError(404, '栏目不存在');
  json(res, 200, { sections: await Sections.list(persona.id, user.id) });
}

/* ---------------- 语气学习 ----------------
 * 学习本身在 server/learning.js：每篇先提炼要点，档案由要点合并；改稿偏好、文章里的经历候选也在那里。 */

const SAMPLE_CHARS_MAX = 20000;
const IMPORT_MAX = 20;           // 一次批量导入最多几篇

const sampleOk = (content) => content.replace(/\s/g, '').length >= 100 && content.length <= SAMPLE_CHARS_MAX;

export async function handleSampleList(req, res, body, params) {
  const user = await requireUser(req);
  const persona = await Personas.byId(Number(params.id), user.id);
  if (!persona) throw new HttpError(404, '账号不存在');
  json(res, 200, {
    samples: await Samples.list(persona.id, user.id),
    digest: persona.style_digest,
    updated_at: persona.style_updated_at,
    max: SAMPLE_MAX,
  });
}

export async function handleSampleCreate(req, res, body, params) {
  const user = await requireUser(req);
  const persona = await Personas.byId(Number(params.id), user.id);
  if (!persona) throw new HttpError(404, '账号不存在');

  let title = String(body?.title ?? '').trim().slice(0, 120);
  let content = String(body?.content ?? '').trim();
  let draftId = null;

  // 直接喂一篇创作记录
  if (body?.draft_id) {
    const draft = await Drafts.byId(Number(body.draft_id), user.id);
    if (!draft) throw new HttpError(404, '记录不存在');
    if (!draft.content.trim()) throw new HttpError(400, '这篇还没有正文');
    if (await Samples.byDraft(persona.id, user.id, draft.id)) throw new HttpError(409, '这篇已经在语气样本里了');
    draftId = draft.id;
    title = title || draft.title || draft.subject;
    content = draft.content;
  }

  if (content.replace(/\s/g, '').length < 100) throw new HttpError(400, '样本太短了，至少 100 字才学得出语气');
  if (content.length > SAMPLE_CHARS_MAX) throw new HttpError(400, '样本过长，请截取代表性的一篇');

  const out = await addSampleAndLearn(user.id, persona.id, { title, content, draftId, source: 'manual' });
  // 喂的是一篇 AI 写过初稿的创作记录：顺手在后台从改稿里学偏好（不让这个请求多等一次调用）
  if (draftId) await enqueueLearn(user.id, persona.id, { type: 'prefs', draftId }, `从《${title.slice(0, 20)}》的改稿里学习`).catch(() => {});
  json(res, 200, {
    persona: await Personas.byId(persona.id, user.id),
    samples: await Samples.list(persona.id, user.id),
    digest: out.digest,
    candidates: out.candidates,
    candidatesLogId: out.candidatesLogId,
  });
}

/* 批量导入以前写的文章：先存，学习（每篇提炼要点、找经历、合并档案）放到后台任务里，任务中心看得到进度 */
export async function handleSampleImport(req, res, body, params) {
  const user = await requireUser(req);
  const persona = await Personas.byId(Number(params.id), user.id);
  if (!persona) throw new HttpError(404, '账号不存在');
  const list = Array.isArray(body?.articles) ? body.articles : [];
  if (!list.length) throw new HttpError(400, '没有要导入的文章');
  if (list.length > IMPORT_MAX) throw new HttpError(400, `一次最多导入 ${IMPORT_MAX} 篇`);
  let room = SAMPLE_MAX - await Samples.count(persona.id, user.id);
  const ids = [];
  const skipped = [];
  for (const a of list) {
    const title = String(a?.title ?? '').trim().slice(0, 120);
    const content = String(a?.content ?? '').trim();
    if (!sampleOk(content)) { skipped.push({ title, reason: content.length > SAMPLE_CHARS_MAX ? '太长（超过 2 万字）' : '太短（不到 100 字）' }); continue; }
    if (room <= 0) { skipped.push({ title, reason: `样本已满 ${SAMPLE_MAX} 篇` }); continue; }
    ids.push((await Samples.create(user.id, persona.id, { title, content, source: 'import' })).id);
    room -= 1;
  }
  const job = ids.length
    ? await enqueueLearn(user.id, persona.id, { type: 'import', sampleIds: ids }, `学习导入的 ${ids.length} 篇文章`)
    : null;
  json(res, 200, { added: ids.length, skipped, job: presentJob(job), samples: await Samples.list(persona.id, user.id) });
}

/* 批量加样本（快速建号时的几篇旧文章）：同步用原文梳理一次档案，每篇的要点和经历候选放到后台补 */
export async function handleSampleBatch(req, res, body, params) {
  const user = await requireUser(req);
  const persona = await Personas.byId(Number(params.id), user.id);
  if (!persona) throw new HttpError(404, '账号不存在');
  const list = (Array.isArray(body?.samples) ? body.samples : []).slice(0, QUICK_LIMITS.posts);
  const room = SAMPLE_MAX - await Samples.count(persona.id, user.id);
  const ids = [];
  let skipped = 0;
  for (const s of list) {
    const content = String(s?.content ?? '').trim();
    if (ids.length >= room || content.replace(/\s/g, '').length < QUICK_LIMITS.sampleMin || content.length > QUICK_LIMITS.post) {
      skipped += 1;
      continue;
    }
    ids.push((await Samples.create(user.id, persona.id, { draftId: null, title: String(s?.title ?? '').trim().slice(0, 120), content, source: 'quickstart' })).id);
  }
  const digest = ids.length
    ? await updateDigest(user.id, persona.id, { full: true, backfill: false, reason: '快速建号时的旧文章' })
    : persona.style_digest;
  if (ids.length) await enqueueLearn(user.id, persona.id, { type: 'import', sampleIds: ids, noDigest: true }, '整理旧文章里的经历').catch(() => {});
  json(res, 200, { added: ids.length, skipped, samples: await Samples.list(persona.id, user.id), digest });
}

export async function handleSampleDelete(req, res, body, params) {
  const user = await requireUser(req);
  const persona = await Personas.byId(Number(params.id), user.id);
  if (!persona) throw new HttpError(404, '账号不存在');
  if (!await Samples.remove(Number(params.sampleId), user.id)) throw new HttpError(404, '样本不存在');
  // 删掉的样本可能已经影响过档案：用剩下的从头梳理（不补提炼老样本，免得一次删除等太久）
  const digest = await updateDigest(user.id, persona.id, { full: true, backfill: false, reason: '删了一篇样本' });
  json(res, 200, { samples: await Samples.list(persona.id, user.id), digest });
}

/* 「从头梳理」：用最近 60 篇的要点重写档案，还没提炼过的老样本补几篇 */
export async function handleDigestRebuild(req, res, body, params) {
  const user = await requireUser(req);
  const persona = await Personas.byId(Number(params.id), user.id);
  if (!persona) throw new HttpError(404, '账号不存在');
  if (!(await Samples.count(persona.id, user.id))) throw new HttpError(400, '还没有样本可学');
  json(res, 200, { digest: await updateDigest(user.id, persona.id, { full: true, reason: '手动从头梳理' }) });
}
