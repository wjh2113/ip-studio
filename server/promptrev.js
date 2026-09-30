/* 提示词版本。发给模型的是当前启用的那一版；每次手改或代码更新都追加一行，不覆盖旧的。 */

import './db.js';
import { and, desc, eq } from 'drizzle-orm';
import { orm } from './client.js';
import { promptRevisions } from './schema.js';
import { HttpError } from './auth.js';
import {
  ADAPT_SYSTEM, ARTICLE_SUMMARY_SYSTEM, ASSIST_SYSTEM, CONTENT_SYSTEM,
  CUES_SYSTEM, DIGEST_SYSTEM, HOTSPOT_SYSTEM, ILLUS_SYSTEM, REVIEW_SYSTEM,
  EXTRACT_SYSTEM, QUICKSTART_SYSTEM, SPEAK_REVIEW_SYSTEM, SUBJECTS_SYSTEM, TITLES_SYSTEM, TOPICS_SYSTEM, VOICE_EDIT_SYSTEM,
} from './prompts.js';

const now = () => new Date().toISOString();
const activePrompt = new Map();

function remember(key, system, source) {
  activePrompt.set(key, { system, source });
}

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
  titles: () => TITLES_SYSTEM,
  extract: () => EXTRACT_SYSTEM,
  quickstart: () => QUICKSTART_SYSTEM,
};

export function liveSystem(key, builtin) {
  const text = String(activePrompt.get(key)?.system || '').trim();
  return text || builtin;
}

export function revisionSource(key) {
  return activePrompt.get(key)?.source || 'code';
}

export async function listRevisions(key) {
  const rows = await orm().select().from(promptRevisions)
    .where(eq(promptRevisions.feature, key)).orderBy(desc(promptRevisions.id));
  return rows.map((r) => ({
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
export async function syncPromptBuiltins() {
  for (const [key, builtin] of Object.entries(PROMPT_KEYS)) {
    const system = builtin();
    const prev = await orm().select({ system: promptRevisions.system }).from(promptRevisions)
      .where(and(eq(promptRevisions.feature, key), eq(promptRevisions.source, 'code')))
      .orderBy(desc(promptRevisions.id)).limit(1);
    const on = await orm().select({ id: promptRevisions.id, source: promptRevisions.source, system: promptRevisions.system })
      .from(promptRevisions).where(and(eq(promptRevisions.feature, key), eq(promptRevisions.active, 1))).limit(1);
    if (prev[0]?.system !== system) {
      const turnOn = !on[0] || on[0].source === 'code';
      if (turnOn) await orm().update(promptRevisions).set({ active: 0 }).where(eq(promptRevisions.feature, key));
      await orm().insert(promptRevisions).values({
        feature: key, system, source: 'code', note: '代码里的这一版', active: turnOn ? 1 : 0, user_id: 0, created_at: now(),
      });
    }
    const current = await orm().select().from(promptRevisions)
      .where(and(eq(promptRevisions.feature, key), eq(promptRevisions.active, 1))).limit(1);
    if (current[0]) remember(key, current[0].system, current[0].source);
  }
}

export async function savePromptEdit(key, system, userId) {
  if (!PROMPT_KEYS[key]) throw new HttpError(400, '没有这条提示词');
  const text = String(system || '').replace(/\r\n/g, '\n').trim();
  if (text.length < 20) throw new HttpError(400, '提示词太短');
  if (text.length > 20000) throw new HttpError(400, '提示词请控制在 2 万字以内');
  const cur = activePrompt.get(key);
  if (cur?.system === text) return listRevisions(key);
  await orm().update(promptRevisions).set({ active: 0 }).where(eq(promptRevisions.feature, key));
  await orm().insert(promptRevisions).values({
    feature: key, system: text, source: 'edit', note: '手工修改', active: 1, user_id: userId || 0, created_at: now(),
  });
  remember(key, text, 'edit');
  return listRevisions(key);
}

export async function activateRevision(key, id) {
  if (!PROMPT_KEYS[key]) throw new HttpError(400, '没有这条提示词');
  const row = await orm().select().from(promptRevisions)
    .where(and(eq(promptRevisions.id, Number(id)), eq(promptRevisions.feature, key))).limit(1);
  if (!row[0]) throw new HttpError(404, '这一版不存在');
  await orm().update(promptRevisions).set({ active: 0 }).where(eq(promptRevisions.feature, key));
  await orm().update(promptRevisions).set({ active: 1 }).where(eq(promptRevisions.id, row[0].id));
  remember(key, row[0].system, row[0].source);
  return listRevisions(key);
}
