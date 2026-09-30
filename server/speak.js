/* 口播总评
 * 上传先转写，再用 quality-chat 给文字总评（完整、节奏、表达）。
 * 语音测评、视频测评不在这一步做，等用户单独点按钮。
 * 发音分只认网关 /api/ai/pronounce。出镜分只认网关 /api/ai/appearance。
 */

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { DATA_DIR, Speaks } from './db.js';
import { generateJSON, PROVIDER } from './llm.js';
import { liveSystem } from './promptrev.js';
import { SPEAK_REVIEW_SCHEMA, SPEAK_REVIEW_SYSTEM, speakReviewUser } from './prompts.js';

const GATEWAY_URL = (process.env.LLM_GATEWAY_URL || 'https://aiapimgrapi.aidigitcloud.cn').replace(/\/$/, '');
const GATEWAY_KEY = process.env.LLM_GATEWAY_API_KEY || '';
const GATEWAY_TENANT = process.env.LLM_TENANT_ID || 'IP';
const WEIGHT = { 完整: 25, 发音: 25, 节奏: 20, 表达: 20, 出镜: 10 };

/* 口播评测按稿子语种传给网关。假名走 ja，拉丁字母明显多于汉字走 en，其余默认 zh。 */
export function scriptLanguage(script) {
  const s = String(script || '');
  const kana = (s.match(/[\u3040-\u30ff]/g) || []).length;
  const han = (s.match(/[\u4e00-\u9fff]/g) || []).length;
  const latin = (s.match(/[A-Za-z]/g) || []).length;
  if (kana >= 2) return 'ja';
  if (latin >= 12 && latin > han * 2) return 'en';
  return 'zh';
}

function gatewayError(data, fallback) {
  const msg = data?.detail?.message || data?.detail || data?.error?.message || data?.message;
  return `${fallback}${msg ? `：${typeof msg === 'string' ? msg : JSON.stringify(msg).slice(0, 240)}` : ''}`;
}

/* 网关说「这份材料不行」（如纯音频做出镜评测）时原样按 400 回给前端，
   不当成服务故障（500），用户也就不会反复点重试。其余一律 502。 */
function gatewayFail(res, data, fallback) {
  const err = new Error(gatewayError(data, `${fallback} ${res.status}`));
  err.status = [400, 413, 415, 422].includes(res.status) ? 400 : 502;
  return err;
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

export async function transcribeAudio(buffer, { filename, mime, userId, language, script } = {}) {
  if (!GATEWAY_KEY || PROVIDER === 'mock') {
    return { text: '演示模式：这里会是这一遍录音的转写。' };
  }
  const lang = language || scriptLanguage(script);
  const { res, data } = await postAudio('/api/ai/transcribe', buffer, {
    filename, mime, userId,
    fields: { capability: 'speech', language: lang },
  });
  if (!res.ok) throw gatewayFail(res, data, '转写失败');
  const text = String(data?.text || '').trim();
  if (!text) throw new Error('转写结果是空的');
  return { text };
}

export async function pronounceAudio(buffer, { filename, mime, userId, script, language } = {}) {
  const text = String(script || '').trim();
  if (!text) return null;
  if (!GATEWAY_KEY || PROVIDER === 'mock') {
    return { score: 78, note: '演示模式发音评测', issues: [], transcript: '演示模式转写' };
  }
  const lang = language || scriptLanguage(text);
  const { res, data } = await postAudio('/api/ai/pronounce', buffer, {
    filename, mime, userId,
    fields: {
      capability: 'pronunciation',
      language: lang,
      text,
      tenantId: GATEWAY_TENANT,
    },
  });
  if (!res.ok) throw gatewayFail(res, data, '发音评测失败');
  const parsed = readPronounce(data);
  if (!parsed) throw new Error('发音评测没有返回分数');
  return parsed;
}

/* 网关 /api/ai/pronounce 的实际字段：score、note、issues、usage.prompt_tokens。 */
export function readPronounce(data) {
  const score = Number(data?.score);
  if (!Number.isFinite(score)) return null;
  const issues = (Array.isArray(data?.issues) ? data.issues : []).slice(0, 4).map((item) => ({
    quote: String(item?.quote || '').trim(),
    note: String(item?.note || '').trim(),
  })).filter((item) => item.quote || item.note);
  const issueText = issues.map((item) => (
    item.quote && item.note ? `${item.quote}：${item.note}` : (item.note || item.quote)
  )).join('；');
  const head = String(data?.note || '').trim();
  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    note: [head, issueText].filter(Boolean).join('。'),
    issues,
    transcript: String(data?.transcript || '').trim(),
    usage: {
      input: Number(data?.usage?.prompt_tokens ?? data?.usage?.input) || 0,
      output: Number(data?.usage?.completion_tokens ?? data?.usage?.output) || 0,
    },
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
  return { score, dims, lifts, next, checks: { ...(raw?.checks || {}) } };
}

function asScore(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/* 单独补一项分数，并按权重重算总分。null 的权重摊到其余项。 */
export function applyDim(review, key, score, note) {
  const prev = Array.isArray(review?.dims) ? review.dims : [];
  const dims = Object.keys(WEIGHT).map((k) => {
    const old = prev.find((d) => d.key === k) || { key: k, score: null, note: '' };
    const next = k === key ? asScore(score) : asScore(old.score);
    const text = k === key ? note : old.note;
    return { key: k, score: next, note: String(text || '').trim() };
  });
  const used = dims.filter((d) => d.score != null);
  const wsum = used.reduce((n, d) => n + WEIGHT[d.key], 0);
  const total = wsum
    ? Math.round(used.reduce((n, d) => n + d.score * WEIGHT[d.key], 0) / wsum)
    : null;
  return { ...(review || {}), score: total, dims };
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

/* 出镜评测的 text：只取口播提示里和出镜有关的句子（出镜提醒、表情、动作、看镜头），
   原样传给网关。不带稿子正文，也不让模型改写。 */
const LOOK_LABEL = {
  zh: { note: '出镜提醒：', exp: '表情：', ges: '动作：', sep: '；', none: '无' },
  en: { note: 'On camera: ', exp: 'Expression: ', ges: 'Gesture: ', sep: '; ', none: 'none' },
  ja: { note: '出鏡：', exp: '表情：', ges: '動作：', sep: '；', none: 'なし' },
};

export function cueLook(cues, language = 'zh') {
  const L = LOOK_LABEL[language] || LOOK_LABEL.zh;
  const lines = [];
  const note = String(cues?.overall?.note || '').trim();
  if (note) lines.push(`${L.note}${note}`);
  for (const c of cues?.cues || []) {
    const bits = [
      String(c?.expression || '').trim() ? `${L.exp}${String(c.expression).trim()}` : '',
      String(c?.gesture || '').trim() ? `${L.ges}${String(c.gesture).trim()}` : '',
    ].filter(Boolean);
    if (bits.length) lines.push(bits.join(L.sep));
  }
  return [...new Set(lines)].join('\n') || L.none;
}

/* 纯音频没有画面：不送网关，也不编出镜分 */
const AUDIO_EXT = /\.(mp3|wav|m4a|ogg|aac)$/i;
export const isAudioOnly = (mime, filename) =>
  /^audio\//i.test(String(mime || '')) || (!mime && AUDIO_EXT.test(String(filename || '')));

const APPEAR_FALLBACK = {
  zh: { scored: '按画面评的出镜', empty: '没有看到出镜的人', mock: '演示模式：这里会看出镜、表情和手势', audio: '这一遍只有声音、没有画面，不做出镜评测' },
  en: { scored: 'Scored from the picture', empty: 'Nobody is on camera', mock: 'Demo: on-camera presence, expression, and gesture', audio: 'This take is audio only, so there is no on-camera score' },
  ja: { scored: '画面から評価した出鏡です', empty: '出鏡している人が見えません', mock: 'デモ：出鏡・表情・ジェスチャーを見ます', audio: '音声のみで映像がないため、出鏡は評価しません' },
};

/* 整段视频（mp4 / webm）交给网关 appearance，网关内部抽帧，浏览器和业务侧都不抽帧。
   纯音频直接 400；画面没人时 score 为 null，这是合法结果，不补分。language 与稿子一致：zh / en / ja。 */
export async function scoreAppearance({ userId, cues, buffer, filename, mime, language, script } = {}) {
  const lang = language || scriptLanguage(script);
  const copy = APPEAR_FALLBACK[lang] || APPEAR_FALLBACK.zh;
  const text = cueLook(cues, lang);
  if (!buffer?.length) throw new Error(copy.empty);
  // 和网关对纯音频回 400 一致：先在这里挡掉，演示模式也不编分
  if (isAudioOnly(mime, filename)) {
    const err = new Error(copy.audio);
    err.status = 400;
    throw err;
  }
  if (!GATEWAY_KEY || PROVIDER === 'mock') {
    return { score: 74, note: copy.mock, usage: null };
  }
  const { res, data } = await postAudio('/api/ai/appearance', buffer, {
    filename: filename || 'take.webm',
    mime,
    userId,
    fields: {
      capability: 'appearance',
      language: lang,
      text,
      tenantId: GATEWAY_TENANT,
    },
  });
  if (!res.ok) throw gatewayFail(res, data, '视频测评失败');
  const n = data?.score == null || data.score === '' ? null : Number(data.score);
  return {
    score: Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null,
    note: String(data?.note || '').trim() || (Number.isFinite(n) ? copy.scored : copy.empty),
    usage: {
      input: data.usage?.prompt_tokens || 0,
      output: data.usage?.completion_tokens || 0,
    },
  };
}

function keepChecked(review, previous) {
  let next = review;
  const checks = previous?.checks || {};
  if (checks.voice) {
    const dim = (previous.dims || []).find((d) => d.key === '发音');
    next = applyDim(next, '发音', dim?.score, dim?.note);
  }
  if (checks.video) {
    const dim = (previous.dims || []).find((d) => d.key === '出镜');
    next = applyDim(next, '出镜', dim?.score, dim?.note);
  }
  if (checks.voice || checks.video) next = { ...next, checks: { ...checks } };
  return next;
}

/* 转写和文字总评失败也不删记录。语音测评和视频测评不在这里做。 */
export async function runSpeakPipeline(row, userId, buffer) {
  let transcript = '';
  try {
    const tr = await transcribeAudio(buffer, {
      filename: row.file || 'take.webm',
      mime: row.mime,
      userId,
      script: row.script,
    });
    transcript = tr.text;
    let review = await reviewTake({
      userId, script: row.script, cues: row.cues, transcript, pronunciation: null,
    });
    review = keepChecked(review, row.review);
    return await Speaks.finish(row.id, userId, { transcript, review, status: 'ready', error: '' });
  } catch (err) {
    return await Speaks.finish(row.id, userId, {
      transcript,
      review: null,
      status: 'failed',
      error: String(err?.message || err),
    });
  }
}
