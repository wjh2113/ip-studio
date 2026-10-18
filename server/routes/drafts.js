/* 路由 · drafts：创作主流程：三个方向、流式成稿、保存与历史版本、列表、归档、删除。从原 routes.js 原样拆出。 */
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { DATA_DIR, Drafts, Frameworks, Materials, Personas, Profile, Revisions, Sections } from '../db.js';
import { HttpError } from '../auth.js';
import { generateJSON } from '../llm.js';
import { pickVariant } from '../abtest.js';
import { mockContent, mockTopics } from '../mock.js';
import {
  CONTENT_SYSTEM, contentUser, reviseUser, revisePatchUser, REVISE_PATCH_SCHEMA, REVISE_PATCH_SYSTEM,
  applyVoiceEdits, isStructuralRevise,
  DEFAULT_PLATFORM, DEFAULT_TONE, PLATFORMS, platformSpec, TONES, TOPICS_SCHEMA, TOPICS_SYSTEM, performanceBlock, topicsUser,
} from '../prompts.js';
import { performanceOf } from '../performance.js';
import { describe, json, refsOf, requireUser, styleSamples, sys, withRetry, writerMe } from './common.js';
import { refCount, weigh } from '../refs.js';
import { recallMaterials } from './materials.js';
import { resolveFramework } from './frameworks.js';
import { frameworkSnapshot } from '../frameworks.js';
import { runTextStream, openProgressStream } from './stream.js';
import { packMaterial } from '../snippet.js';

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
async function resolvePersona(userId, personaId) {
  if (personaId === undefined || personaId === null || personaId === '') return null;
  const persona = await Personas.byId(Number(personaId), userId);
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
async function resolveSection(userId, personaId, sectionId) {
  if (!sectionId) return null;
  const section = await Sections.byId(Number(sectionId), userId);
  if (!section || section.persona_id !== personaId) throw new HttpError(404, '栏目不存在');
  return {
    id: section.id, name: section.name, purpose: section.purpose,
    guide: section.guide, fields: section.fields,
  };
}

/* 用掉的推荐从缓存里划掉，下次不会再出现 */
async function consumeIdea(persona, userId, subject) {
  const ideas = await Personas.ideas(persona.id, userId) || [];
  const left = ideas.filter((i) => i.subject.trim() !== subject.trim());
  if (left.length !== ideas.length) await Personas.setIdeas(persona.id, userId, left);
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
  const user = await requireUser(req);
  const persona = await resolvePersona(user.id, body?.persona_id);
  const section = persona ? await resolveSection(user.id, persona.id, body?.section_id) : null;
  const inputs = normalizeInputs(section, body?.inputs);
  const form = normalizeForm(body, persona);
  // 写法框架：不传或 'none' = 不套框架（和以前一样）；传 key 就把框架快照存进草稿
  const fw = await resolveFramework(user.id, body?.framework);
  const framework = frameworkSnapshot(fw);
  const draft = await Drafts.create(user.id, form, persona, normalizeHotspot(body?.hotspot), section, inputs, framework);

  let topics;
  try {
    const ctx = { ...form, hotspot: normalizeHotspot(body?.hotspot), section, inputs, framework };
    const hint = topicHint(form);
    topics = await generateTopics(ctx, persona, [], await styleSamples(persona, user.id, hint),
      { feature: '选题方向', userId: user.id }, await perfFor(user.id, persona), await writerMe(user.id, persona, hint, 'topics'));
  } catch (err) {
    await Drafts.remove(draft.id, user.id);   // 失败就别在历史里留一条空记录
    throw err;
  }

  if (persona) await consumeIdea(persona, user.id, form.subject);
  if (fw && !fw.builtin) await Frameworks.markUsed(fw.id, user.id);
  await Drafts.setTopics(draft.id, user.id, topics, persona);
  json(res, 200, { draft: await Drafts.byId(draft.id, user.id) });
}

export async function handleRetopics(req, res, body, params) {
  const user = await requireUser(req);
  const draft = await Drafts.byId(Number(params.id), user.id);
  if (!draft) throw new HttpError(404, '记录不存在');

  // 换一批 = 重新开始：若账号还在，用它最新的设定；账号已删则沿用创作时的快照
  const persona = (draft.persona_id && await Personas.byId(draft.persona_id, user.id)) || draft.persona;
  const hint = topicHint(draft);
  const topics = await generateTopics(draft, persona, draft.topics, await styleSamples(persona, user.id, hint),
    { feature: '选题方向·换一批', userId: user.id }, await perfFor(user.id, persona), await writerMe(user.id, persona, hint, 'topics'));
  await Drafts.setTopics(draft.id, user.id, topics, persona);
  json(res, 200, { draft: await Drafts.byId(draft.id, user.id) });
}

/* 召回个人档案、挑相似范文用的题材线索 */
const topicHint = (f) => `${f.subject || ''} ${f.keywords || ''} ${f.audience || ''}`;

/* 这个号过往的发布数据，拼进选题提示词；样本不够时是空串，提示词和以前一样 */
const perfFor = async (userId, persona) => {
  const refs = await refsOf(userId, persona?.id);
  return refs.perf.on ? weigh(performanceBlock(await performanceOf(userId, persona?.id ?? null), 'topics'), refs, 'perf') : '';
};

async function generateTopics(form, persona = null, avoid = [], samples = [], meta = {}, perf = '', me = null) {
  const extra = avoid.length
    ? `\n\n以下方向已经出过，请给出与它们明显不同的新角度：\n${avoid.map((t) => `- ${t.title}（${t.angle}）`).join('\n')}`
    : '';

  // 偶发的格式跑偏重试一次就能好，不必让用户自己点重来
  const topics = await withRetry(async (attempt) => {
    const v = await pickVariant('topics', sys('topics', TOPICS_SYSTEM));
    const data = await generateJSON({
      meta: { ...meta, variant: v.name },
      system: v.system,
      user: topicsUser(form, persona, samples, perf, me) + extra
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
  const user = await requireUser(req);
  const draft = await Drafts.byId(Number(params.id), user.id);
  if (!draft) throw new HttpError(404, '记录不存在');

  const index = Number(body?.index);
  const topic = draft.topics[index];
  if (!topic) throw new HttpError(400, '请选择一个话题方向');

  // 按题材召回素材库里相关的几条——素材是"唯一可信的事实来源"那条规则的弹药
  const hint = `${draft.subject} ${topic.title} ${topic.angle} ${(topic.outline || []).join(' ')}`;
  // 「懂作者」的部分：个人档案里相关的经历、这个号的改稿偏好、和题材最像的范文。带不带、带几条看「成稿参考」
  const me = await writerMe(user.id, draft.persona, hint, 'content');
  const { refs } = me;
  const nMaterials = refCount(refs, 'materials');
  const recalled = nMaterials ? await recallMaterials(user.id, draft.persona_id, hint, nMaterials) : [];
  if (recalled.length) await Materials.markUsed(recalled.map((m) => m.id), user.id);
  // 每条只带标题 + 最相关几百字（或已有摘要），不把整篇抓文塞进提示词
  const materialPack = recalled.map((m) => packMaterial(m, hint, 400));
  const samples = await styleSamples(draft.persona, user.id, hint);
  const context = {
    profile: me.profile.map((e) => ({ id: e.id, title: e.title })),
    samples: samples.map((x) => ({ id: x.id, title: x.title || '未命名样本' })),
    materials: recalled.map((m) => ({ id: m.id, title: m.title, kind: m.kind })),
    prefs: me.prefs.length,
    digest: Boolean(refs.digest.on && draft.persona?.style_digest),
    // 这篇生成时的参考设置：「这篇参考了」那里标出哪几项是关着的
    refs,
  };
  // 发布数据：这个号上哪种开头数据好（不够 6 篇回填数据时是空的）
  const contentPerf = refs.perf.on ? weigh(performanceBlock(await performanceOf(user.id, draft.persona_id ?? null), 'content'), refs, 'perf') : '';
  const contentVariant = await pickVariant('content', sys('content', CONTENT_SYSTEM));

  // 记下生成前的样子：失败或中途断开时恢复它，而不是把已有的稿子清空
  const before = {
    chosen: draft.chosen ?? null, title: draft.title || '', content: draft.content || '', status: draft.status,
  };
  await Drafts.setContent(draft.id, user.id, {
    chosen: index, title: topic.title, content: '', status: 'writing',
  });

  await runTextStream(res, {
    start: () => ({ title: topic.title }),
    before: (send) => send('progress', { step: 'writing', label: '正在成稿…' }),
    stream: {
      meta: { feature: '成稿', userId: user.id, variant: contentVariant.name },
      system: contentVariant.system,
      user: contentUser(draft, topic, draft.persona, samples, materialPack, me, contentPerf),
      mock: () => mockContent(draft, topic),
    },
    after: async (content) => {
      await Drafts.setContent(draft.id, user.id, {
        chosen: index, title: topic.title, content, status: 'done',
      });
      await Drafts.setGenerated(draft.id, user.id, content, contentVariant.name);
      await Drafts.setContext(draft.id, user.id, context);
      if (me.profile.length) await Profile.markUsed(me.profile.map((e) => e.id), user.id);
      return { draft: await Drafts.byId(draft.id, user.id) };
    },
    onError: async () => {
      /* 失败或中途关页面：别让草稿停在 writing + 空正文。
         原来有正文就原样恢复；第一次生成就失败的，退回到选方向。 */
      await restoreAfterFailure(draft.id, user.id, before, index)
        .catch((e) => console.error('[content] 恢复草稿失败', e?.message));
    },
  });
}

/* 只在草稿还是「这次请求写进去的样子」（writing、空正文、选的是这个方向）时才恢复：
   生成期间另一个标签页保存了正文、或者另一次生成已经成功，就别拿开始时的旧快照去覆盖它们。 */
export async function restoreAfterFailure(draftId, userId, before, index) {
  const next = before.content
    ? {
      chosen: before.chosen, title: before.title, content: before.content,
      status: before.status === 'writing' ? 'done' : (before.status || 'done'),
    }
    : { chosen: null, title: '', content: '', status: 'topics' };
  return Drafts.setContentIf(draftId, userId, { status: 'writing', content: '', chosen: index }, next);
}

/* ---------------- 贴已有稿：别处写好（或写了一半）的稿子直接进成稿页 ----------------
 * 不调模型、不花点数：建一篇状态是「已成稿」的稿子，之后划词改、按意见重写、检查、多平台、口播都能用。
 * 标题不填时取正文第一行的 # 标题，再不行取第一句。没有选方向，所以 topics 为空、context 记 imported。 */
export async function handleImport(req, res, body) {
  const user = await requireUser(req);
  const content = String(body?.content ?? '').replace(/\r\n?/g, '\n').trim();
  if (!content) throw new HttpError(400, '把稿子贴进来');
  if (content.length > 60000) throw new HttpError(400, '正文过长（最多 6 万字）');
  const persona = await resolvePersona(user.id, body?.persona_id);
  const head = content.match(/^#{1,3}\s+(.+)$/m)?.[1] || content.split(/[\n。！？!?]/)[0];
  const title = (String(body?.title ?? '').trim() || head || '未命名').slice(0, 80);
  const form = normalizeForm({ ...body, subject: title }, persona);
  const draft = await Drafts.create(user.id, form, persona);
  await Drafts.setContent(draft.id, user.id, { chosen: null, title, content, status: 'done' });
  await Drafts.setContext(draft.id, user.id, { imported: true });
  json(res, 200, { draft: await Drafts.byId(draft.id, user.id) });
}

/* ---------------- 按意见重写 ----------------
 * 意见只动局部 → find/replace 补丁（快档，输出短）；意见动结构/整体语气 → 整篇流式重写。
 * 写完才落盘（原稿留历史）。中途失败或断开，原稿不动。
 * version：改的是哪一版（'' 原文，否则是平台版本）。 */
export async function handleRevise(req, res, body, params) {
  const user = await requireUser(req);
  const draft = await Drafts.byId(Number(params.id), user.id);
  if (!draft) throw new HttpError(404, '记录不存在');
  const version = String(body?.version || '');
  if (version && !draft.variants?.[version]) throw new HttpError(404, '还没有这个平台的版本');
  const text = String((version ? draft.variants[version].content : draft.content) || '').trim();
  if (!text) throw new HttpError(400, '还没有正文');
  if (text.length > 20000) throw new HttpError(400, '正文过长，请分段修改');
  const notes = String(body?.notes || '').trim().slice(0, 1000);
  if (!notes) throw new HttpError(400, '写一下修改意见');
  if (draft.status === 'writing') throw new HttpError(409, '这篇正在生成，等它写完再改');

  const saveOut = async (out) => {
    if (version) {
      await Drafts.upsertVariant(draft.id, user.id, version, {
        content: out, chars: out.length, editedAt: new Date().toISOString(),
      });
    } else {
      await Drafts.saveContent(draft.id, user.id, out, { snapshot: true });
    }
    return { version, draft: await Drafts.byId(draft.id, user.id), before: text };
  };

  /* 局部：像语音改稿一样只回替换列表，代码负责改正文 */
  if (!isStructuralRevise(notes)) {
    const ps = openProgressStream(res);       // ps.aborted 是 getter：别解构，解构只拿到开流那一刻的 false
    const { send, end } = ps;
    try {
      send('start', { version, mode: 'patch' });
      send('progress', { step: 'revising', label: '正在按意见改局部…' });
      const data = await withRetry(async () => {
        const out = await generateJSON({
          meta: { feature: '按意见重写·局部', userId: user.id },
          system: sys('revise-patch', REVISE_PATCH_SYSTEM),
          user: revisePatchUser(text, notes),
          schema: REVISE_PATCH_SCHEMA,
          mock: () => ({
            note: `演示：落实「${notes.slice(0, 24)}」`,
            // 演示模式：在文末加一句，让测试和界面能看到意见已落实
            edits: text
              ? [{ find: text, replace: `${text}\n\n（演示模式：这里会按修改意见改——${notes.slice(0, 40)}）`, all: false }]
              : [],
          }),
        });
        if (!out || !Array.isArray(out.edits)) throw new HttpError(502, '没有拿到改写结果');
        return out;
      }, '按意见改写失败，请再试一次');
      if (ps.aborted) return;
      const { content: out, applied, skipped } = applyVoiceEdits(text, data.edits);
      if (!applied.length) {
        const why = skipped[0] || data.note || '意见没有对应到可改的句子';
        throw new HttpError(502, `没有落实改动：${why}。原稿没动`);
      }
      // 前端流式区期待 delta；局部改完把结果一次性推过去，体验和整篇一致
      send('delta', { text: out });
      send('done', await saveOut(out));
    } catch (err) {
      if (!ps.aborted) send('error', { message: describe(err) });
    } finally {
      end();
    }
    return;
  }

  // 账号还在就用最新设定（含成稿参考），否则退回创作时的快照
  const persona = (draft.persona_id && await Personas.byId(draft.persona_id, user.id)) || draft.persona;
  const hint = `${draft.subject} ${draft.title || ''} ${notes}`;
  const me = await writerMe(user.id, persona, hint, 'content');
  const samples = await styleSamples(persona, user.id, hint);
  const target = { ...draft, platform: version || draft.platform };

  await runTextStream(res, {
    start: () => ({ version, mode: 'full' }),
    before: (send) => send('progress', { step: 'revising', label: '正在按意见重写全文…' }),
    stream: {
      meta: { feature: '按意见重写', userId: user.id },
      system: sys('content', CONTENT_SYSTEM),
      user: reviseUser(target, persona, samples, me, text, notes),
      mock: () => `${text}\n\n（演示模式：这里会按修改意见重写全文——${notes.slice(0, 40)}）`,
    },
    after: async (raw) => {
      const out = String(raw || '').trim();
      if (out.length < Math.min(40, text.length / 4)) throw new HttpError(502, '没有拿到改写结果，原稿没动');
      return saveOut(out);
    },
  });
}

/* ---------------- 编辑器：手工保存 ---------------- */

export async function handleSaveContent(req, res, body, params) {
  const user = await requireUser(req);
  const content = String(body?.content ?? '');
  if (content.length > 60000) throw new HttpError(400, '正文过长');
  // snapshot = 手动保存或离开编辑；自动保存不带，历史版本按时间间隔留
  const saved = await Drafts.saveContent(Number(params.id), user.id, content, { snapshot: Boolean(body?.snapshot) });
  if (!saved) throw new HttpError(404, '记录不存在');
  json(res, 200, {
    draft: await Drafts.byId(Number(params.id), user.id),
    kept: { cuesDropped: saved.cuesDropped, illusDropped: saved.illusDropped },
  });
}

/* 编辑器粘贴/插入的配图：落到 data/images，URL 走已有的 /image/:uid/:name（v1 不计费） */
const ASSET_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

export async function handleDraftAsset(req, res, file, params) {
  const user = await requireUser(req);
  const draft = await Drafts.byId(Number(params.id), user.id);
  if (!draft) throw new HttpError(404, '记录不存在');
  const ext = ASSET_EXT[file.mime] || (file.ext && ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(file.ext) ? (file.ext === 'jpeg' ? 'jpg' : file.ext) : null);
  if (!ext) throw new HttpError(400, '请上传 png、jpg、webp 或 gif 图片');
  if (!file.buffer?.length) throw new HttpError(400, '图片是空的');
  const name = `${draft.id}-a-${randomBytes(8).toString('hex')}.${ext}`;
  const dir = resolvePath(DATA_DIR, 'images', String(user.id));
  await mkdir(dir, { recursive: true });
  await writeFile(resolvePath(dir, name), file.buffer);
  const url = `/image/${user.id}/${name}`;
  json(res, 200, { url, name, alt: '' });
}

/* 正文历史：打开列表时把当前正文补成第一版（已有则不重复），之后每次保存再追加。 */
export async function handleRevisionList(req, res, _body, params) {
  const user = await requireUser(req);
  const draft = await Drafts.byId(Number(params.id), user.id);
  if (!draft) throw new HttpError(404, '记录不存在');
  if (draft.content) await Revisions.keep(draft.id, user.id, draft.content);
  json(res, 200, { revisions: await Revisions.list(draft.id, user.id) });
}

export async function handleRevisionGet(req, res, _body, params) {
  const user = await requireUser(req);
  const revision = await Revisions.byId(Number(params.rid), Number(params.id), user.id);
  if (!revision) throw new HttpError(404, '这一版不存在');
  json(res, 200, { revision });
}

/* ---------------- 历史 ---------------- */

export async function handleList(req, res, body, params, url) {
  const user = await requireUser(req);
  // persona_id 不传 = 全部；'none' = 未绑定账号的；数字 = 该账号下的
  const raw = url?.searchParams.get('persona_id');
  const scope = raw === null || raw === '' ? {}
    : { personaId: raw === 'none' ? null : Number(raw) };
  const archived = url?.searchParams.get('archived') === '1';

  json(res, 200, {
    drafts: await Drafts.list(user.id, { ...scope, archived }),
    counts: await Drafts.counts(user.id, scope.personaId),
  });
}

/* ---------------- 归档 ---------------- */

export async function handleArchive(req, res, body, params) {
  const user = await requireUser(req);
  const archived = body?.archived !== false;
  if (!await Drafts.setArchived(Number(params.id), user.id, archived)) throw new HttpError(404, '记录不存在');
  json(res, 200, { draft: await Drafts.byId(Number(params.id), user.id) });
}

/* 把当前范围内所有「已成稿」的一次性收起来 */
export async function handleArchiveDone(req, res, body) {
  const user = await requireUser(req);
  const raw = body?.persona_id;
  const personaId = raw === undefined || raw === '' || raw === null
    ? undefined
    : (raw === 'none' ? null : Number(raw));
  const n = await Drafts.archiveDone(user.id, personaId);
  json(res, 200, { archived: n, counts: await Drafts.counts(user.id, personaId) });
}

export async function handleGet(req, res, body, params) {
  const user = await requireUser(req);
  const draft = await Drafts.byId(Number(params.id), user.id);
  if (!draft) throw new HttpError(404, '记录不存在');
  json(res, 200, { draft });
}

export async function handleDelete(req, res, body, params) {
  const user = await requireUser(req);
  if (!await Drafts.remove(Number(params.id), user.id)) throw new HttpError(404, '记录不存在');
  json(res, 200, { ok: true });
}
