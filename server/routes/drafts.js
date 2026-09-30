/* 路由 · drafts：创作主流程：三个方向、流式成稿、保存与历史版本、列表、归档、删除。从原 routes.js 原样拆出。 */
import { Drafts, Frameworks, Materials, Personas, Revisions, Sections } from '../db.js';
import { HttpError } from '../auth.js';
import { generateJSON, streamText } from '../llm.js';
import { pickVariant } from '../abtest.js';
import { mockContent, mockTopics } from '../mock.js';
import { CONTENT_SYSTEM, contentUser, DEFAULT_PLATFORM, DEFAULT_TONE, PLATFORMS, platformSpec, TONES, TOPICS_SCHEMA, TOPICS_SYSTEM, topicsUser } from '../prompts.js';
import { describe, json, requireUser, styleSamples, sys, withRetry } from './common.js';
import { recallMaterials } from './materials.js';
import { resolveFramework } from './frameworks.js';
import { frameworkSnapshot } from '../frameworks.js';

/* 本篇未填的字段，继承所选账号设定 */
function normalizeForm(body = {}, persona = null) {
  const subject = String(body.subject ?? '').trim();
  if (!subject) throw new HttpError(400, '请填写题材');
  if (subject.length > 200) throw new HttpError(400, '题材请控制在 200 字以内');

  const fallbackPlatform = PLATFORMS[persona?.platform] ? persona.platform : DEFAULT_PLATFORM;
  const fallbackTone = TONES[persona?.tone] ? persona.tone : DEFAULT_TONE;
  const platform = PLATFORMS[body.platform] ? body.platform : fallbackPlatform;
  const tone = TONES[body.tone] ? body.tone : fallbackTone;
  const length = Math.min(4000, Math.max(150, Number(body.length) || platformSpec(platform).length));

  return {
    subject,
    platform,
    tone,
    audience: String(body.audience ?? '').trim().slice(0, 120),
    keywords: String(body.keywords ?? '').trim().slice(0, 300),
    length,
  };
}

/* 取出当前用户的账号；personaId 为空表示不绑定账号 */
function resolvePersona(userId, personaId) {
  if (personaId === undefined || personaId === null || personaId === '') return null;
  const persona = Personas.byId(Number(personaId), userId);
  if (!persona) throw new HttpError(404, '账号不存在');
  return persona;
}

/* 只收这个栏目声明过的字段，必填的不能空 */
function normalizeInputs(section, raw) {
  const fields = Array.isArray(section?.fields) ? section.fields : [];
  if (!fields.length) return null;
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const f of fields) {
    const value = String(src[f.label] ?? '').trim().slice(0, 1500);
    if (f.required && !value) throw new HttpError(400, `「${section.name}」需要先填写：${f.label}`);
    if (value) out[f.label] = value;
  }
  return Object.keys(out).length ? out : null;
}

/* 栏目必须属于这个账号，否则不认 */
function resolveSection(userId, personaId, sectionId) {
  if (!sectionId) return null;
  const section = Sections.byId(Number(sectionId), userId);
  if (!section || section.persona_id !== personaId) throw new HttpError(404, '栏目不存在');
  return {
    id: section.id, name: section.name, purpose: section.purpose,
    guide: section.guide, fields: section.fields,
  };
}

/* 用掉的推荐从缓存里划掉，下次不会再出现 */
function consumeIdea(persona, userId, subject) {
  const ideas = Personas.ideas(persona.id, userId) || [];
  const left = ideas.filter((i) => i.subject.trim() !== subject.trim());
  if (left.length !== ideas.length) Personas.setIdeas(persona.id, userId, left);
}

/* 前端传回来的热点原样信任不得，逐字段收一遍 */
function normalizeHotspot(h) {
  if (!h || typeof h !== 'object') return null;
  const text = (v, n) => String(v ?? '').trim().slice(0, n);
  const title = text(h.title, 200);
  if (!title) return null;
  const url = text(h.url, 500);
  return {
    title,
    url: /^https?:\/\//.test(url) ? url : '',
    platform: text(h.platform, 40),
    summary: text(h.summary, 400),
    summarySource: ['board', 'article', 'none'].includes(h.summarySource) ? h.summarySource : 'none',
    angle: text(h.angle, 300),
  };
}

/* ---------------- 第一步：三个话题方向 ---------------- */

export async function handleTopics(req, res, body) {
  const user = requireUser(req);
  const persona = resolvePersona(user.id, body?.persona_id);
  const section = persona ? resolveSection(user.id, persona.id, body?.section_id) : null;
  const inputs = normalizeInputs(section, body?.inputs);
  const form = normalizeForm(body, persona);
  // 写法框架：不传或 'none' = 不套框架（和以前一样）；传 key 就把框架快照存进草稿
  const fw = resolveFramework(user.id, body?.framework);
  const framework = frameworkSnapshot(fw);
  const draft = Drafts.create(user.id, form, persona, normalizeHotspot(body?.hotspot), section, inputs, framework);

  let topics;
  try {
    const ctx = { ...form, hotspot: normalizeHotspot(body?.hotspot), section, inputs, framework };
    topics = await generateTopics(ctx, persona, [], styleSamples(persona, user.id),
      { feature: '选题方向', userId: user.id });
  } catch (err) {
    Drafts.remove(draft.id, user.id);   // 失败就别在历史里留一条空记录
    throw err;
  }

  if (persona) consumeIdea(persona, user.id, form.subject);
  if (fw && !fw.builtin) Frameworks.markUsed(fw.id, user.id);
  Drafts.setTopics(draft.id, user.id, topics, persona);
  json(res, 200, { draft: Drafts.byId(draft.id, user.id) });
}

export async function handleRetopics(req, res, body, params) {
  const user = requireUser(req);
  const draft = Drafts.byId(Number(params.id), user.id);
  if (!draft) throw new HttpError(404, '记录不存在');

  // 换一批 = 重新开始：若账号还在，用它最新的设定；账号已删则沿用创作时的快照
  const persona = (draft.persona_id && Personas.byId(draft.persona_id, user.id)) || draft.persona;
  const topics = await generateTopics(draft, persona, draft.topics, styleSamples(persona, user.id),
    { feature: '选题方向·换一批', userId: user.id });
  Drafts.setTopics(draft.id, user.id, topics, persona);
  json(res, 200, { draft: Drafts.byId(draft.id, user.id) });
}

async function generateTopics(form, persona = null, avoid = [], samples = [], meta = {}) {
  const extra = avoid.length
    ? `\n\n以下方向已经出过，请给出与它们明显不同的新角度：\n${avoid.map((t) => `- ${t.title}（${t.angle}）`).join('\n')}`
    : '';

  // 偶发的格式跑偏重试一次就能好，不必让用户自己点重来
  const topics = await withRetry(async (attempt) => {
    const v = pickVariant('topics', sys('topics', TOPICS_SYSTEM));
    const data = await generateJSON({
      meta: { ...meta, variant: v.name },
      system: v.system,
      user: topicsUser(form, persona, samples) + extra
        + (attempt ? '\n\n上一次的返回不完整。请严格按 schema 输出恰好 3 个方向，每个方向的字段都要填满。' : ''),
      schema: TOPICS_SCHEMA,
      mock: () => mockTopics(form),
    });

    const list = (Array.isArray(data) ? data : data?.topics || data?.方向 || [])
      .slice(0, 3)
      .map((t) => ({
        label: String(t?.label || t?.标签 || '').trim().slice(0, 8),
        title: String(t?.title || t?.标题 || '').trim(),
        angle: String(t?.angle || t?.切入角度 || '').trim(),
        hook: String(t?.hook || t?.开篇钩子 || '').trim(),
        outline: (Array.isArray(t?.outline) ? t.outline : Array.isArray(t?.内容骨架) ? t.内容骨架 : [])
          .map((x) => String(x).trim()).filter(Boolean),
        audience_fit: String(t?.audience_fit || t?.适配读者 || '').trim(),
      }))
      .filter((t) => t.title && t.outline.length);

    if (list.length < 3) throw new HttpError(502, `模型只给出了 ${list.length} 个完整方向`);

    // 标签重了就等于没分类——这是读者一眼看差异的抓手，重复的宁可留空回落到「方向 N」
    const used = new Set();
    for (const t of list) {
      if (!t.label || used.has(t.label)) { t.label = ''; continue; }
      used.add(t.label);
    }
    return list;
  }, '生成话题方向失败，请再试一次');

  return topics;
}

/* ---------------- 第二步：流式生成完整文案 ---------------- */

export async function handleContent(req, res, body, params) {
  const user = requireUser(req);
  const draft = Drafts.byId(Number(params.id), user.id);
  if (!draft) throw new HttpError(404, '记录不存在');

  const index = Number(body?.index);
  const topic = draft.topics[index];
  if (!topic) throw new HttpError(400, '请选择一个话题方向');

  // 按题材召回素材库里相关的几条——素材是"唯一可信的事实来源"那条规则的弹药
  const recalled = recallMaterials(user.id, draft.persona_id,
    `${draft.subject} ${topic.title} ${topic.angle} ${(topic.outline || []).join(' ')}`);
  if (recalled.length) Materials.markUsed(recalled.map((m) => m.id), user.id);
  const contentVariant = pickVariant('content', sys('content', CONTENT_SYSTEM));

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const controller = new AbortController();
  // 用 res 的 close 判断前端断开：req 的 close 在请求体读完时就已触发，监听它等于永远收不到
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });

  send('start', { title: topic.title });
  Drafts.setContent(draft.id, user.id, {
    chosen: index, title: topic.title, content: '', status: 'writing',
  });

  try {
    const content = await streamText({
      meta: { feature: '成稿', userId: user.id, variant: contentVariant.name },
      system: contentVariant.system,
      user: contentUser(draft, topic, draft.persona, styleSamples(draft.persona, user.id), recalled),
      onDelta: (text) => send('delta', { text }),
      mock: () => mockContent(draft, topic),
      signal: controller.signal,
    });
    Drafts.setContent(draft.id, user.id, {
      chosen: index, title: topic.title, content, status: 'done',
    });
    send('done', { draft: Drafts.byId(draft.id, user.id) });
  } catch (err) {
    // 失败或中途关页面：别让草稿停在 writing + 空正文，退回到选方向这一步（上一版正文在历史里）
    Drafts.setContent(draft.id, user.id, { chosen: null, title: '', content: '', status: 'topics' });
    if (!controller.signal.aborted) send('error', { message: describe(err) });
  } finally {
    res.end();
  }
}

/* ---------------- 编辑器：手工保存 ---------------- */

export async function handleSaveContent(req, res, body, params) {
  const user = requireUser(req);
  const content = String(body?.content ?? '');
  if (content.length > 60000) throw new HttpError(400, '正文过长');
  // snapshot = 手动保存或离开编辑；自动保存不带，历史版本按时间间隔留
  const saved = Drafts.saveContent(Number(params.id), user.id, content, { snapshot: Boolean(body?.snapshot) });
  if (!saved) throw new HttpError(404, '记录不存在');
  json(res, 200, {
    draft: Drafts.byId(Number(params.id), user.id),
    kept: { cuesDropped: saved.cuesDropped, illusDropped: saved.illusDropped },
  });
}

/* 正文历史：打开列表时把当前正文补成第一版（已有则不重复），之后每次保存再追加。 */
export async function handleRevisionList(req, res, _body, params) {
  const user = requireUser(req);
  const draft = Drafts.byId(Number(params.id), user.id);
  if (!draft) throw new HttpError(404, '记录不存在');
  if (draft.content) Revisions.keep(draft.id, user.id, draft.content);
  json(res, 200, { revisions: Revisions.list(draft.id, user.id) });
}

export async function handleRevisionGet(req, res, _body, params) {
  const user = requireUser(req);
  const revision = Revisions.byId(Number(params.rid), Number(params.id), user.id);
  if (!revision) throw new HttpError(404, '这一版不存在');
  json(res, 200, { revision });
}

/* ---------------- 历史 ---------------- */

export async function handleList(req, res, body, params, url) {
  const user = requireUser(req);
  // persona_id 不传 = 全部；'none' = 未绑定账号的；数字 = 该账号下的
  const raw = url?.searchParams.get('persona_id');
  const scope = raw === null || raw === '' ? {}
    : { personaId: raw === 'none' ? null : Number(raw) };
  const archived = url?.searchParams.get('archived') === '1';

  json(res, 200, {
    drafts: Drafts.list(user.id, { ...scope, archived }),
    counts: Drafts.counts(user.id, scope.personaId),
  });
}

/* ---------------- 归档 ---------------- */

export async function handleArchive(req, res, body, params) {
  const user = requireUser(req);
  const archived = body?.archived !== false;
  if (!Drafts.setArchived(Number(params.id), user.id, archived)) throw new HttpError(404, '记录不存在');
  json(res, 200, { draft: Drafts.byId(Number(params.id), user.id) });
}

/* 把当前范围内所有「已完成」的一次性收起来 */
export async function handleArchiveDone(req, res, body) {
  const user = requireUser(req);
  const raw = body?.persona_id;
  const personaId = raw === undefined || raw === '' || raw === null
    ? undefined
    : (raw === 'none' ? null : Number(raw));
  const n = Drafts.archiveDone(user.id, personaId);
  json(res, 200, { archived: n, counts: Drafts.counts(user.id, personaId) });
}

export async function handleGet(req, res, body, params) {
  const user = requireUser(req);
  const draft = Drafts.byId(Number(params.id), user.id);
  if (!draft) throw new HttpError(404, '记录不存在');
  json(res, 200, { draft });
}

export async function handleDelete(req, res, body, params) {
  const user = requireUser(req);
  if (!Drafts.remove(Number(params.id), user.id)) throw new HttpError(404, '记录不存在');
  json(res, 200, { ok: true });
}
