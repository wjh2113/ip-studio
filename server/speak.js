/* 口播总评
 * 录音先落盘，再转写，再走网关发音评测，最后用 quality-chat 出分数卡。
 * 发音分只认网关评测，quality-chat 不打这项。任何一步失败都留下记录。
 */

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { DATA_DIR, Speaks } from './db.js';
import { generateJSON, PROVIDER } from './llm.js';
import { liveSystem } from './promptrev.js';
import { SPEAK_REVIEW_SCHEMA, SPEAK_REVIEW_SYSTEM, speakReviewUser } from './prompts.js';

const GATEWAY_URL = (process.env.LLM_GATEWAY_URL || 'https://aiapimgrapi.aidigitcloud.cn').replace(/\/$/, '');
const GATEWAY_KEY = process.env.LLM_GATEWAY_API_KEY || '';
const WEIGHT = { 完整: 25, 发音: 25, 节奏: 20, 表达: 20, 出镜: 10 };

function gatewayError(data, fallback) {
  const msg = data?.detail?.message || data?.detail || data?.error?.message || data?.message;
  return `${fallback}${msg ? `：${typeof msg === 'string' ? msg : JSON.stringify(msg).slice(0, 240)}` : ''}`;
}

async function postAudio(path, buffer, { filename, mime, userId, fields }) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mime || 'application/octet-stream' }), filename);
  form.append('fallback', 'true');
  form.append('dataClass', 'internal');
  if (userId) form.append('userId', String(userId));
  for (const [k, v] of Object.entries(fields || {})) form.append(k, v);
  const res = await fetch(`${GATEWAY_URL}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${GATEWAY_KEY}` },
    body: form,
    signal: AbortSignal.timeout(120000),
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

export async function saveTakeFile(userId, id, ext, buffer) {
  const dir = resolvePath(DATA_DIR, 'speaks', String(userId));
  await mkdir(dir, { recursive: true });
  const file = `${id}.${ext}`;
  await writeFile(resolvePath(dir, file), buffer);
  return file;
}

export async function removeTakeFile(userId, file) {
  if (!file || !/^[\w.-]+$/.test(file)) return;
  await rm(resolvePath(DATA_DIR, 'speaks', String(userId), file), { force: true });
}

export async function transcribeAudio(buffer, { filename, mime, userId }) {
  if (!GATEWAY_KEY || PROVIDER === 'mock') {
    return { text: '演示模式：这里会是这一遍录音的转写。' };
  }
  const { res, data } = await postAudio('/api/ai/transcribe', buffer, {
    filename, mime, userId,
    fields: { capability: 'speech', language: 'zh' },
  });
  if (!res.ok) throw new Error(gatewayError(data, `转写失败 ${res.status}`));
  const text = String(data?.text || '').trim();
  if (!text) throw new Error('转写结果是空的');
  return { text };
}

export async function pronounceAudio(buffer, { filename, mime, userId, script }) {
  const text = String(script || '').trim();
  if (!text) return null;
  if (!GATEWAY_KEY || PROVIDER === 'mock') {
    return { score: 78, note: '演示模式发音评测', issues: [], transcript: '演示模式转写' };
  }
  const { res, data } = await postAudio('/api/ai/pronounce', buffer, {
    filename, mime, userId,
    fields: { capability: 'pronunciation', language: 'zh', text },
  });
  if (!res.ok) throw new Error(gatewayError(data, `发音评测失败 ${res.status}`));
  const score = Number(data?.score);
  if (!Number.isFinite(score)) throw new Error('发音评测没有返回分数');
  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    note: String(data?.note || '').trim(),
    issues: Array.isArray(data?.issues) ? data.issues : [],
    transcript: String(data?.transcript || '').trim(),
  };
}

/* 模型给的总分不算数，按五项权重在这里重算。没有材料的项保持 null。发音分只认网关评测。 */
export function settleReview(raw, script, pronunciation) {
  const dimsIn = Array.isArray(raw?.dims) ? raw.dims : [];
  const byKey = Object.fromEntries(dimsIn.map((d) => [d.key, d]));
  const dims = Object.keys(WEIGHT).map((key) => {
    if (key === '发音') {
      const n = Number(pronunciation?.score);
      if (!Number.isFinite(n)) return { key, score: null, note: '没有发音评测，这项不打分' };
      const note = String(pronunciation?.note || byKey[key]?.note || '按网关发音评测').trim();
      return { key, score: Math.max(0, Math.min(100, Math.round(n))), note };
    }
    if (key === '出镜') return { key, score: null, note: '没有画面，这项不打分' };
    const n = Number(byKey[key]?.score);
    if (!Number.isFinite(n)) return { key, score: null, note: String(byKey[key]?.note || '').trim() };
    return {
      key,
      score: Math.max(0, Math.min(100, Math.round(n))),
      note: String(byKey[key]?.note || '').trim(),
    };
  });
  const used = dims.filter((d) => d.score != null);
  const wsum = used.reduce((n, d) => n + WEIGHT[d.key], 0);
  const score = wsum
    ? Math.round(used.reduce((n, d) => n + d.score * WEIGHT[d.key], 0) / wsum)
    : null;
  const lifts = (Array.isArray(raw?.lifts) ? raw.lifts : []).slice(0, 6).map((l) => ({
    quote: String(l?.quote || '').trim(),
    lose: Math.max(0, Math.round(Number(l?.lose) || 0)),
    do: String(l?.do || '').trim(),
  })).filter((l) => l.do && (!l.quote || script.includes(l.quote)));
  let next = String(raw?.next || '').trim();
  if (!next) next = lifts.length ? '按第一条再录一遍' : '这遍可以过';
  return { score, dims, lifts, next };
}

export async function reviewTake({ userId, script, cues, transcript, pronunciation }) {
  const out = await generateJSON({
    meta: { feature: '口播总评', userId, channel: 'quality' },
    system: liveSystem('speak-review', SPEAK_REVIEW_SYSTEM),
    user: speakReviewUser(script, cues, transcript, pronunciation),
    schema: SPEAK_REVIEW_SCHEMA,
    mock: () => ({
      score: 70,
      dims: [
        { key: '完整', score: 80, note: '演示模式：这里会对照稿子看有没有漏句' },
        { key: '发音', score: pronunciation?.score ?? null, note: pronunciation?.note || '没有发音评测' },
        { key: '节奏', score: 60, note: '演示模式：这里会看口头禅和断句' },
        { key: '表达', score: 70, note: '演示模式：这里会对照口播提示' },
        { key: '出镜', score: null, note: '没有画面' },
      ],
      lifts: [{ quote: String(script || '').split('\n').find((l) => l.trim()) || '', lose: 8, do: '演示模式：这里会写下一遍具体怎么改' }],
      next: '演示模式：这里会写下一次最该改的一件事',
    }),
  });
  return settleReview(out, script, pronunciation);
}

/* 转写和总评失败也不删记录。调用方已经把文件写好。 */
export async function runSpeakPipeline(row, userId, buffer) {
  let transcript = '';
  let pronunciation = null;
  try {
    const tr = await transcribeAudio(buffer, {
      filename: row.file || 'take.webm',
      mime: row.mime,
      userId,
    });
    transcript = tr.text;
    try {
      pronunciation = await pronounceAudio(buffer, {
        filename: row.file || 'take.webm',
        mime: row.mime,
        userId,
        script: row.script,
      });
    } catch {
      pronunciation = null;
    }
    const review = await reviewTake({ userId, script: row.script, cues: row.cues, transcript, pronunciation });
    return Speaks.finish(row.id, userId, { transcript, review, status: 'ready', error: '' });
  } catch (err) {
    return Speaks.finish(row.id, userId, {
      transcript,
      review: null,
      status: 'failed',
      error: String(err?.message || err),
    });
  }
}
