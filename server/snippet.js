/* 把长文压成提示词里能用的短片段：标题旁只带最相关的几百字，不整篇塞。 */

import { bigrams, overlapScore } from './db/personas.js';

/** 在 body 里找和 hint 最重合的一段，最长 max 字；找不到就取开头。 */
export function relevantSnippet(body, hint = '', max = 400) {
  const text = String(body || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= max) return text;
  const grams = bigrams(String(hint || ''));
  if (!grams.size) return `${text.slice(0, max)}…`;

  let best = { score: -1, at: 0 };
  const step = Math.max(40, Math.floor(max / 4));
  for (let i = 0; i <= text.length - max; i += step) {
    const win = text.slice(i, i + max);
    const score = overlapScore(grams, win);
    if (score > best.score) best = { score, at: i };
  }
  // 尾巴也扫一下（步长可能跳过）
  const tailAt = Math.max(0, text.length - max);
  const tailScore = overlapScore(grams, text.slice(tailAt));
  if (tailScore > best.score) best = { score: tailScore, at: tailAt };

  const cut = text.slice(best.at, best.at + max);
  const prefix = best.at > 0 ? '…' : '';
  const suffix = best.at + max < text.length ? '…' : '';
  return `${prefix}${cut}${suffix}`;
}

/** 素材进提示词：标题 + 相关片段（或已有摘要字段）。 */
export function packMaterial(m, hint = '', max = 400) {
  const title = String(m?.title || '').trim();
  const summary = String(m?.summary || m?.excerpt || '').trim();
  const body = summary || relevantSnippet(m?.body, hint, max);
  return { ...m, title, body };
}
