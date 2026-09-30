/* 路由 · review：成稿检查：语言错误 + 调性与风险两层。从原 routes.js 原样拆出。 */
import { Drafts, Personas } from '../db.js';
import { HttpError } from '../auth.js';
import { generateJSON } from '../llm.js';
import { platformSpec, REVIEW_DIMENSIONS, REVIEW_SCHEMA, REVIEW_SYSTEM, reviewUser } from '../prompts.js';
import { json, requireUser, styleSamples, sys, withRetry } from './common.js';

/* ---------------- 成稿检查：错字与通顺性 ---------------- */

export async function handleReview(req, res, body, params) {
  const user = requireUser(req);
  const draft = Drafts.byId(Number(params.id), user.id);
  if (!draft) throw new HttpError(404, '记录不存在');

  const text = String(body?.content ?? draft.content ?? '').trim();
  if (!text) throw new HttpError(400, '还没有正文可检查');
  if (text.length > 20000) throw new HttpError(400, '正文过长，请分段检查');

  // 检查要看到账号设定、平台规范、语气档案和借势的热点，才谈得上"符合度"
  const persona = (draft.persona_id && Personas.byId(draft.persona_id, user.id)) || draft.persona;
  json(res, 200, {
    review: await reviewText(draft, text, persona, styleSamples(persona, user.id),
      { feature: '成稿检查', userId: user.id }),
  });
}

async function reviewText(draft, text, persona, samples, meta = {}) {
  const data = await withRetry(async () => {
    const out = await generateJSON({
      meta,
      system: sys('review', REVIEW_SYSTEM),
      user: reviewUser(draft, text, persona, samples),
      schema: REVIEW_SCHEMA,
      mock: () => mockReview(text, draft),
    });
    if (!out || !Array.isArray(out.issues)) throw new HttpError(502, '返回结构不对');
    return out;
  }, '检查失败，请再试一次');
  return cleanReview(data, text);
}

/* 模型返回的检查结果 → 能安全展示和替换的结果。纯函数，单测覆盖。 */
export function cleanReview(data, text) {
  // quote 必须能在原文里一字不差地找到，否则没法安全替换——找不到的直接丢掉
  const seen = new Set();
  const issues = data.issues
    .map((it) => ({
      quote: String(it.quote || ''),
      type: String(it.type || '语句不通'),
      fix: String(it.fix || ''),
      why: String(it.why || '').trim(),
    }))
    .filter((it) => {
      if (!it.quote || !it.fix || it.quote === it.fix) return false;
      if (!text.includes(it.quote)) return false;
      if (seen.has(it.quote)) return false;
      seen.add(it.quote);
      return true;
    })
    .map((it) => ({ ...it, count: text.split(it.quote).length - 1 }));

  // flags 不做替换，所以 quote 对不上也留着（可能是整篇性的问题），只是标记一下
  const LEVELS = ['高', '中', '低'];

  // 实测模型会拿「低」这一档凑数，而且常写成「符合……但……」——先承认没问题再硬找茬。
  // 提示词里已经说过不要这样，但它还是会；所以在代码层把这两类丢掉。
  // 注意 (?<![不未没]) —— 「不符合平台规范，但…」是真问题，不能被当成凑数丢掉
  const PADDING = /((?<![不未没])符合|未涉及|不存在|没有明显|无明显|不涉及)[^，。；]{0,14}[，,、]?\s*(但|不过)/;

  const flags = (Array.isArray(data.flags) ? data.flags : [])
    .map((f) => ({
      dimension: REVIEW_DIMENSIONS.includes(f.dimension) ? f.dimension : '账号调性',
      level: LEVELS.includes(f.level) ? f.level : '中',
      quote: String(f.quote || '').trim(),
      what: String(f.what || '').trim(),
      suggestion: String(f.suggestion || '').trim(),
    }))
    .filter((f) => f.what && f.level !== '低' && !PADDING.test(f.what))
    .map((f) => ({ ...f, locatable: Boolean(f.quote) && text.includes(f.quote) }))
    .sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level))
    .slice(0, 12);

  const padded = (Array.isArray(data.flags) ? data.flags : []).length - flags.length;

  const verdict = ['ok', 'minor', 'bad'].includes(data.verdict) ? data.verdict : (issues.length ? 'minor' : 'ok');
  const risk = flags.find((f) => f.level === '高') ? '高'
    : flags.length ? '中' : '无';

  return {
    verdict,
    risk,
    summary: String(data.summary || '').trim(),
    issues,
    flags,
    padded,                                        // 被判定为凑数而丢掉的提示条数
    dropped: data.issues.length - issues.length,   // 原文里对不上的，如实告诉前端
    at: new Date().toISOString(),
  };
}

const mockReview = (text, draft) => ({
  verdict: 'minor',
  summary: '演示模式：配置模型密钥后，这里是语言与调性风险的真实检查结果',
  issues: text.length > 30
    ? [{ quote: text.slice(10, 24), type: '语句不通', fix: text.slice(10, 24), why: '演示模式占位' }]
    : [],
  flags: [
    { dimension: '平台调性', level: '中', quote: '',
      what: `演示模式：这里会对照${platformSpec(draft?.platform).label}的写作规范给出符合度判断`,
      suggestion: '配置模型密钥后生效' },
    { dimension: '法律风险', level: '低', quote: '',
      what: '演示模式：这里会查广告法绝对化用语、功效承诺等风险',
      suggestion: '配置模型密钥后生效' },
  ],
});
