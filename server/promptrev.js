/* 提示词版本。发给模型的是当前启用的那一版；每次手改或代码更新都追加一行，不覆盖旧的。 */

import { db } from './db.js';
import { HttpError } from './auth.js';
import {
  ADAPT_SYSTEM, ARTICLE_SUMMARY_SYSTEM, ASSIST_SYSTEM, CONTENT_SYSTEM,
  CUES_SYSTEM, DIGEST_SYSTEM, HOTSPOT_SYSTEM, ILLUS_SYSTEM, REVIEW_SYSTEM,
  SPEAK_REVIEW_SYSTEM, SUBJECTS_SYSTEM, TOPICS_SYSTEM, VOICE_EDIT_SYSTEM,
} from './prompts.js';

const now = () => new Date().toISOString();

export const PROMPT_KEYS = {
  subjects: () => SUBJECTS_SYSTEM,
  topics: () => TOPICS_SYSTEM,
  content: () => CONTENT_SYSTEM,
  assist: () => ASSIST_SYSTEM,
  'voice-edit': () => VOICE_EDIT_SYSTEM,
  review: () => REVIEW_SYSTEM,
  digest: () => DIGEST_SYSTEM,
  hotspot: () => HOTSPOT_SYSTEM,
  summary: () => ARTICLE_SUMMARY_SYSTEM,
  cues: () => CUES_SYSTEM,
  'speak-review': () => SPEAK_REVIEW_SYSTEM,
  adapt: () => ADAPT_SYSTEM,
  illus: () => ILLUS_SYSTEM,
};

export function liveSystem(key, builtin) {
  const row = db.prepare(
    'SELECT system FROM prompt_revisions WHERE feature = ? AND active = 1',
  ).get(key);
  const text = String(row?.system || '').trim();
  return text || builtin;
}

export function revisionSource(key) {
  const row = db.prepare(
    'SELECT source FROM prompt_revisions WHERE feature = ? AND active = 1',
  ).get(key);
  return row?.source || 'code';
}

export function listRevisions(key) {
  return db.prepare(
    'SELECT id, feature, source, note, active, created_at, system FROM prompt_revisions WHERE feature = ? ORDER BY id DESC',
  ).all(key).map((r) => ({
    id: r.id,
    source: r.source,
    note: r.note,
    active: Boolean(r.active),
    created_at: r.created_at,
    chars: r.system.length,
    system: r.system,
  }));
}

/* 代码里的正文变了就追加一版。当前如果是手改，不把新手改覆盖掉，只把代码版放进历史。 */
export function syncPromptBuiltins() {
  const insert = db.prepare(`
    INSERT INTO prompt_revisions (feature, system, source, note, active, user_id, created_at)
    VALUES (?, ?, 'code', '代码里的这一版', ?, 0, ?)
  `);
  const lastCode = db.prepare(
    'SELECT system FROM prompt_revisions WHERE feature = ? AND source = ? ORDER BY id DESC LIMIT 1',
  );
  const active = db.prepare(
    'SELECT id, source FROM prompt_revisions WHERE feature = ? AND active = 1',
  );
  const clear = db.prepare('UPDATE prompt_revisions SET active = 0 WHERE feature = ?');

  for (const [key, builtin] of Object.entries(PROMPT_KEYS)) {
    const system = builtin();
    const prev = lastCode.get(key, 'code');
    if (prev?.system === system) continue;
    const on = active.get(key);
    const turnOn = !on || on.source === 'code';
    if (turnOn) clear.run(key);
    insert.run(key, system, turnOn ? 1 : 0, now());
  }
}

export function savePromptEdit(key, system, userId) {
  if (!PROMPT_KEYS[key]) throw new HttpError(400, '没有这条提示词');
  const text = String(system || '').replace(/\r\n/g, '\n').trim();
  if (text.length < 20) throw new HttpError(400, '提示词太短');
  if (text.length > 20000) throw new HttpError(400, '提示词请控制在 2 万字以内');
  const cur = db.prepare(
    'SELECT system FROM prompt_revisions WHERE feature = ? AND active = 1',
  ).get(key);
  if (cur?.system === text) return listRevisions(key);
  db.prepare('UPDATE prompt_revisions SET active = 0 WHERE feature = ?').run(key);
  db.prepare(`
    INSERT INTO prompt_revisions (feature, system, source, note, active, user_id, created_at)
    VALUES (?, ?, 'edit', '手工修改', 1, ?, ?)
  `).run(key, text, userId || 0, now());
  return listRevisions(key);
}

export function activateRevision(key, id) {
  if (!PROMPT_KEYS[key]) throw new HttpError(400, '没有这条提示词');
  const row = db.prepare(
    'SELECT id FROM prompt_revisions WHERE id = ? AND feature = ?',
  ).get(Number(id), key);
  if (!row) throw new HttpError(404, '这一版不存在');
  db.prepare('UPDATE prompt_revisions SET active = 0 WHERE feature = ?').run(key);
  db.prepare('UPDATE prompt_revisions SET active = 1 WHERE id = ?').run(row.id);
  return listRevisions(key);
}
