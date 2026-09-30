/* 路由 · speak：口播提示、口播录音留档与评测。从原 routes.js 原样拆出。 */
import { readFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { DATA_DIR, Drafts, Personas, Speaks } from '../db.js';
import { HttpError } from '../auth.js';
import { generateJSON } from '../llm.js';
import { reserve, settle } from '../quota.js';
import { applyDim, pronounceAudio, removeTakeFile, runSpeakPipeline, saveTakeFile, scoreAppearance } from '../speak.js';
import { CUES_SCHEMA, CUES_SYSTEM, cuesUser, TONE_TAGS } from '../prompts.js';
import { json, requireUser, sys, withRetry } from './common.js';

/* ---------------- 口播提示 ---------------- */

export async function handleCues(req, res, body, params) {
  const user = requireUser(req);
  const draft = Drafts.byId(Number(params.id), user.id);
  if (!draft) throw new HttpError(404, '记录不存在');
  const text = String(draft.content || '').trim();
  if (!text) throw new HttpError(400, '还没有正文');
  if (text.length > 12000) throw new HttpError(400, '正文过长，请分段生成');

  const persona = (draft.persona_id && Personas.byId(draft.persona_id, user.id)) || draft.persona;

  const data = await withRetry(async () => {
    const out = await generateJSON({
      meta: { feature: '口播提示', userId: user.id },
      system: sys('cues', CUES_SYSTEM),
      user: cuesUser(draft, persona, text),
      schema: CUES_SCHEMA,
      mock: () => mockCues(text),
    });
    if (!out || !Array.isArray(out.cues) || !out.cues.length) throw new HttpError(502, '没有拿到提示');
    return out;
  }, '生成口播提示失败，请再试一次');

  // quote 必须能在正文里找到，否则对不上位置；重读词也必须真的在这段里
  const cues = data.cues.map((c) => {
    const quote = String(c.quote || '');
    const stress = (Array.isArray(c.stress) ? c.stress : [])
      .map((w) => String(w).trim())
      .filter((w) => w && quote.includes(w))
      .slice(0, 4);
    return {
      quote,
      emotion: String(c.emotion || '').trim(),
      tone_tag: TONE_TAGS.includes(c.tone_tag) ? c.tone_tag : '日常',
      stress,
      pause: String(c.pause || '').trim(),
      expression: String(c.expression || '').trim(),
      gesture: String(c.gesture || '').trim(),
      locatable: Boolean(quote) && text.includes(quote),
    };
  }).filter((c) => c.quote && c.locatable);

  if (!cues.length) throw new HttpError(502, '提示和正文对不上，请再试一次');

  const covered = cues.reduce((n, c) => n + c.quote.length, 0);
  const payload = {
    overall: {
      tone: String(data.overall?.tone || '').trim(),
      pace: String(data.overall?.pace || '').trim(),
      note: String(data.overall?.note || '').trim(),
    },
    cues,
    coverage: Math.min(100, Math.round((covered / text.length) * 100)),
    dropped: data.cues.length - cues.length,
    at: new Date().toISOString(),
  };
  Drafts.setCues(draft.id, user.id, payload);
  json(res, 200, { cues: payload });
}

function presentSpeak(row, userId, detail = false) {
  const item = {
    id: row.id,
    draftId: row.draftId,
    title: row.title,
    status: row.status,
    error: row.error,
    createdAt: row.createdAt,
    stale: row.stale,
    draftGone: row.draftGone,
    score: row.score,
    next: row.next,
    bytes: row.bytes,
    mime: row.mime,
    audio: row.file ? `/speak/${userId}/${row.file}` : '',
  };
  if (!detail) return item;
  return { ...item, script: row.script, cues: row.cues, transcript: row.transcript, review: row.review };
}

export async function handleSpeakList(req, res, body, params) {
  const user = requireUser(req);
  const draftId = params?.id ? Number(params.id) : 0;
  const rows = draftId ? Speaks.listByDraft(draftId, user.id) : Speaks.list(user.id);
  json(res, 200, { speaks: rows.map((r) => presentSpeak(r, user.id, Boolean(draftId))) });
}

export async function handleSpeakGet(req, res, body, params) {
  const user = requireUser(req);
  const row = Speaks.byId(Number(params.sid), user.id);
  if (!row) throw new HttpError(404, '这条口播记录不存在');
  json(res, 200, { speak: presentSpeak(row, user.id, true) });
}

export async function handleSpeakCreate(req, res, file, params) {
  const user = requireUser(req);
  const draft = Drafts.byId(Number(params.id), user.id);
  if (!draft) throw new HttpError(404, '记录不存在');
  if (!draft.cues?.cues?.length) throw new HttpError(400, '先生成口播提示，再上传录音');
  const text = String(draft.content || '').trim();
  if (!text) throw new HttpError(400, '还没有正文');

  const row = Speaks.create({
    userId: user.id,
    draftId: draft.id,
    title: draft.title || draft.subject || '未命名',
    script: text,
    cues: draft.cues,
    mime: file.mime,
    bytes: file.buffer.length,
  });
  const filename = await saveTakeFile(user.id, row.id, file.ext, file.buffer);
  Speaks.setFile(row.id, user.id, filename, file.buffer.length);
  const saved = Speaks.byId(row.id, user.id);
  const done = await runSpeakPipeline(saved, user.id, file.buffer);
  json(res, 200, { speak: presentSpeak(done, user.id, true) });
}

export async function handleSpeakRetry(req, res, body, params) {
  const user = requireUser(req);
  const row = Speaks.byId(Number(params.sid), user.id);
  if (!row) throw new HttpError(404, '这条口播记录不存在');
  if (!row.file) throw new HttpError(400, '这条记录没有录音文件');
  const buf = await readFile(resolvePath(DATA_DIR, 'speaks', String(user.id), row.file));
  const done = await runSpeakPipeline(row, user.id, buf);
  json(res, 200, { speak: presentSpeak(done, user.id, true) });
}

function readyTake(row) {
  if (!row) throw new HttpError(404, '这条口播记录不存在');
  if (!row.file) throw new HttpError(400, '这条记录没有文件');
  if (row.status !== 'ready' || !row.review) throw new HttpError(400, '文字总评还没好，稍后再测');
  return row;
}

/* 网关评测的用量：先预扣，调完按网关报的 token（或点数）结算；失败整笔退回 */
function usageUnits(usage) {
  const tokens = (Number(usage?.input) || 0) + (Number(usage?.output) || 0);
  return tokens || Number(usage?.credits) || 0;
}

async function withHold(userId, run) {
  const { held } = reserve(userId, '文案');
  try {
    const out = await run();
    settle(userId, '文案', held, usageUnits(out?.usage));
    return out;
  } catch (err) {
    settle(userId, '文案', held, 0);
    throw err;
  }
}

/* 语音测评：上传时不做，点这个才走网关发音评测，并写回「发音」分。 */
export async function handleSpeakPronounce(req, res, body, params) {
  const user = requireUser(req);
  const row = readyTake(Speaks.byId(Number(params.sid), user.id));
  const buf = await readFile(resolvePath(DATA_DIR, 'speaks', String(user.id), row.file));
  const pronunciation = await withHold(user.id, () => pronounceAudio(buf, {
    filename: row.file,
    mime: row.mime,
    userId: user.id,
    script: row.script,
  }));
  if (!pronunciation) throw new HttpError(400, '没有稿子，评不了发音');
  const review = {
    ...applyDim(row.review, '发音', pronunciation.score, pronunciation.note || '按网关发音评测'),
    checks: { ...(row.review.checks || {}), voice: true },
  };
  const saved = Speaks.finish(row.id, user.id, {
    transcript: row.transcript, review, status: 'ready', error: '',
  });
  json(res, 200, { speak: presentSpeak(saved, user.id, true) });
}

/* 视频测评：整段视频交给网关 appearance，由网关抽帧。 */
export async function handleSpeakAppearance(req, res, body, params) {
  const user = requireUser(req);
  const row = readyTake(Speaks.byId(Number(params.sid), user.id));
  const buf = await readFile(resolvePath(DATA_DIR, 'speaks', String(user.id), row.file));
  const look = await withHold(user.id, () => scoreAppearance({
    userId: user.id,
    cues: row.cues,
    buffer: buf,
    filename: row.file,
    mime: row.mime,
    script: row.script,
  }));
  const review = {
    ...applyDim(row.review, '出镜', look.score, look.note),
    checks: { ...(row.review.checks || {}), video: true },
  };
  const saved = Speaks.finish(row.id, user.id, {
    transcript: row.transcript, review, status: 'ready', error: '',
  });
  json(res, 200, { speak: presentSpeak(saved, user.id, true) });
}

export async function handleSpeakDelete(req, res, body, params) {
  const user = requireUser(req);
  const row = Speaks.remove(Number(params.sid), user.id);
  if (!row) throw new HttpError(404, '这条口播记录不存在');
  await removeTakeFile(user.id, row.file);
  json(res, 200, { ok: true });
}

const mockCues = (text) => {
  const lines = text.split('\n').map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('---')).slice(0, 3);
  return {
    overall: { tone: '演示模式：这里会给整体情绪基调', pace: '演示模式：这里会给语速节奏建议', note: '' },
    cues: lines.map((l, i) => ({
      quote: l,
      emotion: i === 0 ? '演示模式：开场用什么情绪' : '平述',
      stress: [],
      pause: i === 0 ? '演示模式：这里会标停顿' : '',
      expression: i === 0 ? '演示模式：这里会标表情' : '',
      gesture: '',
    })),
  };
};
