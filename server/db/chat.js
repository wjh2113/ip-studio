/* 成稿右栏 AI 对话的记录：按「稿子 + 版本」一串。每人自己定保存几天（users.chat_keep_days，0 = 一直留），
 * 过期的由 sweep 定期删。稿子删了，对话跟着删（外键级联）。 */
import { and, desc, eq, sql } from 'drizzle-orm';
import { orm } from '../client.js';
import { chatMessages, users } from '../schema.js';
import { now, one, parseJson } from './_util.js';

export const CHAT_KEEP_CHOICES = [30, 100, 365, 0];

const fromRow = (r) => ({
  id: r.id,
  role: r.role,
  content: r.content,
  quote: r.quote,
  version: r.version,
  created_at: r.created_at,
  ...parseJson(r.data_json, {}),
});

export const Chats = {
  /* 一串对话，最早的在前。limit 取最近的若干条 */
  async list(draftId, userId, version = '', limit = 200) {
    const rows = await orm().select().from(chatMessages)
      .where(and(eq(chatMessages.draft_id, draftId), eq(chatMessages.user_id, userId), eq(chatMessages.version, version)))
      .orderBy(desc(chatMessages.id)).limit(limit);
    return rows.reverse().map(fromRow);
  },

  async add(draftId, userId, version, { role, content, quote = '', data = {} }) {
    const row = await one(orm().insert(chatMessages).values({
      draft_id: draftId, user_id: userId, version, role,
      content: String(content || ''), quote: String(quote || ''),
      data_json: JSON.stringify(data || {}), created_at: now(),
    }).returning());
    return fromRow(row);
  },

  async byId(id, userId) {
    const row = await one(orm().select().from(chatMessages)
      .where(and(eq(chatMessages.id, id), eq(chatMessages.user_id, userId))));
    return row ? { ...fromRow(row), draft_id: row.draft_id, data: parseJson(row.data_json, {}) } : null;
  },

  async setData(id, userId, data) {
    await orm().update(chatMessages).set({ data_json: JSON.stringify(data || {}) })
      .where(and(eq(chatMessages.id, id), eq(chatMessages.user_id, userId)));
  },

  async clear(draftId, userId, version = '') {
    await orm().delete(chatMessages)
      .where(and(eq(chatMessages.draft_id, draftId), eq(chatMessages.user_id, userId), eq(chatMessages.version, version)));
  },

  async keepDays(userId) {
    const row = await one(orm().select({ d: users.chat_keep_days }).from(users).where(eq(users.id, userId)));
    return row ? Number(row.d) : 100;
  },

  async setKeepDays(userId, days) {
    await orm().update(users).set({ chat_keep_days: days }).where(eq(users.id, userId));
  },

  /* 删掉超过各自保存天数的对话。created_at 是 ISO 字符串，按字典序比就是按时间比 */
  async sweep() {
    await orm().delete(chatMessages).where(sql`${chatMessages.id} IN (
      SELECT c.id FROM ${chatMessages} c JOIN ${users} u ON u.id = c.user_id
      WHERE u.chat_keep_days > 0
        AND c.created_at < to_char((now() AT TIME ZONE 'utc') - make_interval(days => u.chat_keep_days), 'YYYY-MM-DD"T"HH24:MI:SS')
    )`);
  },

  /* 测试用：把一条的时间往前拨 */
  async backdate(id, iso) {
    await orm().update(chatMessages).set({ created_at: iso }).where(eq(chatMessages.id, id));
  },
};
