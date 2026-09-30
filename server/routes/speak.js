/* 路由 · speak：口播提示、口播录音留档与评测。从原 routes.js 原样拆出。 */
import { readFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { DATA_DIR, Drafts, Personas, Speaks } from '../db.js';
import { HttpError } from '../auth.js';
import { generateJSON } from '../llm.js';
import { assertQuota } from '../quota.js';
import { defineJob, enqueue, presentJob, waitFor } from '../jobs.js';
import { applyDim, isAudioOnly, pronounceAudio, removeTakeFile, runSpeakPipeline, saveTakeFile, scoreAppearance } from '../speak.js';
import { CUES_SCHEMA, CUES_SYSTEM, cuesUser, TONE_TAGS } from '../prompts.js';
import { JOB_WAIT_MS, json, requireUser, sys, wantsAsync, withRetry } from './common.js';

/* ---------------- 口播提示 ---------------- */

export async function handleCues(req, res, body, params) {
  const user = await requireUser(req);
  const draft = await Drafts.byId(Number(params.id), user.id);
  if (!draft) throw new HttpError(404, '记录不存在');
  const text = String(draft.content || '').trim();
  if (!text) throw new HttpError(400, '还没有正文');
  if (text.length > 12000) throw new HttpError(400, '正文过长，请分段生成');

  const persona = (draft.persona_id && await Personas.byId(draft.persona_id, user.id)) || draft.persona;

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
  await Drafts.setCues(draft.id, user.id, payload);
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
  const user = await requireUser(req);
  const draftId = params?.id ? Number(params.id) : 0;
  const rows = draftId ? await Speaks.listByDraft(draftId, user.id) : await Speaks.list(user.id);
  json(res, 200, { speaks: rows.map((r) => presentSpeak(r, user.id, Boolean(draftId))) });
}

export async function handleSpeakGet(req, res, body, params) {
  const user = await requireUser(req);
  const row = await Speaks.byId(Number(params.sid), user.id);
  if (!row) throw new HttpError(404, '这条口播记录不存在');
  json(res, 200, { speak: presentSpeak(row, user.id, true) });
}

/* 上传一遍录音：文件当场落盘、建记录，转写和文字总评进任务队列 */
export async function handleSpeakCreate(req, res, file, params, url) {
  const user = await requireUser(req);
  const draft = await Drafts.byId(Number(params.id), user.id);
  if (!draft) throw new HttpError(404, '记录不存在');
  if (!draft.cues?.cues?.length) throw new HttpError(400, '先生成口播提示，再上传录音');
  const text = String(draft.content || '').trim();
  if (!text) throw new HttpError(400, '还没有正文');

  const row = await Speaks.create({
    userId: user.id,
    draftId: draft.id,
    title: draft.title || draft.subject || '未命名',
    script: text,
    cues: draft.cues,
    mime: file.mime,
    bytes: file.buffer.length,
  });
  const filename = await saveTakeFile(user.id, row.id, file.ext, file.buffer);
  await Speaks.setFile(row.id, user.id, filename, file.buffer.length);
  await replySpeakJob(req, res, user.id, enqueueTake(user.id, row.id, row.title), row.id, url);
}

export async function handleSpeakRetry(req, res, body, params, url) {
  const user = await requireUser(req);
  const row = await Speaks.byId(Number(params.sid), user.id);
  if (!row) throw new HttpError(404, '这条口播记录不存在');
  if (!row.file) throw new HttpError(400, '这条记录没有录音文件');
  await replySpeakJob(req, res, user.id, enqueueTake(user.id, row.id, row.title), row.id, url, body);
}

const enqueueTake = async (userId, speakId, title) => await enqueue(userId, 'speak', {
  ref: `speak:${speakId}`,
  label: `口播转写与总评 · ${title || '未命名'}`,
  payload: { speakId },
});

/* 口播的几种任务回的都是这条口播记录：异步时带上任务，同步时等做完（失败也照常回记录，和以前一样） */
async function replySpeakJob(req, res, userId, job, speakId, url, body = null) {
  if (wantsAsync(body, url)) {
    json(res, 202, { job: presentJob(job), speak: presentSpeak(await Speaks.byId(speakId, userId), userId, true) });
    return;
  }
  const done = await waitFor(job.id, JOB_WAIT_MS);
  if (done?.status === 'failed' && done.kind !== 'speak') throw new HttpError(done.result?.code || 502, done.error);
  json(res, 200, { speak: presentSpeak(await Speaks.byId(speakId, userId), userId, true) });
}

const takeBuffer = (userId, row) => readFile(resolvePath(DATA_DIR, 'speaks', String(userId), row.file));

/* 转写 + 文字总评。失败时记录标成 failed（录音留着，可重试），任务也记失败 */
defineJob('speak', {
  label: '口播转写与总评',
  onEnqueue: async ({ userId, payload }) => await Speaks.setStatus(payload.speakId, userId, 'running'),
  onFail: async ({ userId, payload }, message) => {
    const row = await Speaks.byId(payload.speakId, userId);
    if (row?.status === 'running') await Speaks.setStatus(row.id, userId, 'failed', message);
  },
  async run({ userId, payload }) {
    const row = await Speaks.byId(payload.speakId, userId);
    if (!row) throw new HttpError(404, '这条口播记录已经删了');
    if (!row.file) throw new HttpError(400, '这条记录没有录音文件');
    const done = await runSpeakPipeline(row, userId, await takeBuffer(userId, row));
    if (done.status === 'failed') throw new HttpError(502, done.error || '评估失败');
    return { speakId: row.id, score: done.review?.score ?? null };
  },
});

function readyTake(row) {
  if (!row) throw new HttpError(404, '这条口播记录不存在');
  if (!row.file) throw new HttpError(400, '这条记录没有文件');
  if (row.status !== 'ready' || !row.review) throw new HttpError(400, '文字总评还没好，稍后再测');
  return row;
}

/* 网关评测的用量：先预扣，调完按网关报的 token（或点数）结算；失败由队列整笔退回 */
function usageUnits(usage) {
  const tokens = (Number(usage?.input) || 0) + (Number(usage?.output) || 0);
  return tokens || Number(usage?.credits) || 0;
}

/* 语音测评：上传时不做，点这个才走网关发音评测，并写回「发音」分。 */
export async function handleSpeakPronounce(req, res, body, params, url) {
  const user = await requireUser(req);
  const row = readyTake(await Speaks.byId(Number(params.sid), user.id));
  await assertQuota(user.id, '文案');
  const job = await enqueue(user.id, 'pronounce', {
    ref: `pronounce:${row.id}`,
    label: `语音测评 · ${row.title || '未命名'}`,
    payload: { speakId: row.id },
  });
  await replySpeakJob(req, res, user.id, job, row.id, url, body);
}

defineJob('pronounce', {
  label: '语音测评',
  async run({ userId, payload }, ctx) {
    const row = readyTake(await Speaks.byId(payload.speakId, userId));
    await ctx.hold('文案');
    const pronunciation = await pronounceAudio(await takeBuffer(userId, row), {
      filename: row.file,
      mime: row.mime,
      userId,
      script: row.script,
    });
    if (!pronunciation) throw new HttpError(400, '没有稿子，评不了发音');
    await ctx.settle(usageUnits(pronunciation.usage));
    // 评测期间文字总评可能被重跑过：以库里最新的为准再写分
    const now = readyTake(await Speaks.byId(row.id, userId));
    const review = {
      ...applyDim(now.review, '发音', pronunciation.score, pronunciation.note || '按网关发音评测'),
      checks: { ...(now.review.checks || {}), voice: true },
    };
    await Speaks.finish(row.id, userId, { transcript: now.transcript, review, status: 'ready', error: '' });
    return { speakId: row.id, score: pronunciation.score };
  },
});

/* 视频测评：整段视频交给网关 appearance，由网关抽帧。 */
export async function handleSpeakAppearance(req, res, body, params, url) {
  const user = await requireUser(req);
  const row = readyTake(await Speaks.byId(Number(params.sid), user.id));
  if (isAudioOnly(row.mime, row.file)) throw new HttpError(400, '这一遍只有声音、没有画面，做不了出镜评测');
  await assertQuota(user.id, '文案');
  const job = await enqueue(user.id, 'appearance', {
    ref: `appearance:${row.id}`,
    label: `视频测评 · ${row.title || '未命名'}`,
    payload: { speakId: row.id },
  });
  await replySpeakJob(req, res, user.id, job, row.id, url, body);
}

defineJob('appearance', {
  label: '视频测评',
  async run({ userId, payload }, ctx) {
    const row = readyTake(await Speaks.byId(payload.speakId, userId));
    await ctx.hold('文案');
    const look = await scoreAppearance({
      userId,
      cues: row.cues,
      buffer: await takeBuffer(userId, row),
      filename: row.file,
      mime: row.mime,
      script: row.script,
    });
    await ctx.settle(usageUnits(look?.usage));
    const now = readyTake(await Speaks.byId(row.id, userId));
    const review = {
      ...applyDim(now.review, '出镜', look.score, look.note),
      checks: { ...(now.review.checks || {}), video: true },
    };
    await Speaks.finish(row.id, userId, { transcript: now.transcript, review, status: 'ready', error: '' });
    return { speakId: row.id, score: look.score };
  },
});

export async function handleSpeakDelete(req, res, body, params) {
  const user = await requireUser(req);
  const row = await Speaks.remove(Number(params.sid), user.id);
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
