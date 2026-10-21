import { and, asc, count, desc, eq, sql } from 'drizzle-orm';
import { withTx, orm } from '../client.js';
import { adminSessions, admins, invites, sessions, users } from '../schema.js';
import { now, one, nums, read } from './_util.js';

export const Admins = {
  async count() {
    return Number((await one(orm().select({ n: count() }).from(admins))).n);
  },
  async create(username, passHash) {
    const row = await one(orm().insert(admins).values({ username, pass_hash: passHash, created_at: now() }).returning());
    return row;
  },
  async byName(username) {
    return one(orm().select().from(admins).where(eq(admins.username, username)));
  },
  async byId(id) {
    return one(orm().select().from(admins).where(eq(admins.id, id)));
  },
  async setPassword(id, passHash) {
    await orm().update(admins).set({ pass_hash: passHash }).where(eq(admins.id, id));
    return this.byId(id);
  },
  async touch(id) {
    await orm().update(admins).set({ last_login: now() }).where(eq(admins.id, id));
  },
  async list() {
    return orm().select({
      id: admins.id, username: admins.username, created_at: admins.created_at, last_login: admins.last_login,
    }).from(admins).orderBy(asc(admins.id));
  },
};

export const AdminSessions = {
  async create(token, adminId, ttlMs) {
    await orm().insert(adminSessions).values({ token, admin_id: adminId, expires_at: Date.now() + ttlMs });
  },
  async admin(token) {
    if (!token) return null;
    const row = await one(orm().select().from(adminSessions).where(eq(adminSessions.token, token)));
    if (!row) return null;
    if (Number(row.expires_at) < Date.now()) { await this.destroy(token); return null; }
    return Admins.byId(row.admin_id);
  },
  async destroy(token) {
    await orm().delete(adminSessions).where(eq(adminSessions.token, token));
  },
  async sweep() {
    await orm().delete(adminSessions).where(sql`${adminSessions.expires_at} < ${Date.now()}`);
  },
};

/* 个人设置 · 模型能力：auto = 按功能分档（默认）；quality = 尽量高质量；fast = 尽量快速省点 */
export const LLM_PREF_CHOICES = ['auto', 'quality', 'fast'];

export const Users = {
  async create(username, passHash) {
    return one(orm().insert(users).values({ username, pass_hash: passHash, created_at: now() }).returning());
  },
  async byName(username) {
    return one(orm().select().from(users).where(eq(users.username, username)));
  },
  async byId(id) {
    return one(orm().select().from(users).where(eq(users.id, id)));
  },
  async rename(id, username) {
    const rows = await orm().update(users).set({ username }).where(eq(users.id, id)).returning();
    return rows[0] || null;
  },
  async setPassword(id, passHash) {
    await orm().update(users).set({ pass_hash: passHash }).where(eq(users.id, id));
    return this.byId(id);
  },
  /* 个人设置：模型能力 + 对话保存天数 */
  async settings(id) {
    const row = await one(orm().select({
      llm_pref: users.llm_pref,
      chat_keep_days: users.chat_keep_days,
    }).from(users).where(eq(users.id, id)));
    return {
      llmPref: LLM_PREF_CHOICES.includes(row?.llm_pref) ? row.llm_pref : 'auto',
      chatKeepDays: row ? Number(row.chat_keep_days) : 100,
    };
  },
  async setSettings(id, { llmPref, chatKeepDays }) {
    const patch = {};
    if (llmPref != null) patch.llm_pref = llmPref;
    if (chatKeepDays != null) patch.chat_keep_days = chatKeepDays;
    if (Object.keys(patch).length) await orm().update(users).set(patch).where(eq(users.id, id));
    return this.settings(id);
  },
  async overview() {
    const list = await read(sql`
      SELECT u.id, u.username, u.created_at,
             (SELECT COUNT(*) FROM personas p WHERE p.user_id = u.id)::int AS personas,
             (SELECT COUNT(*) FROM sections s WHERE s.user_id = u.id)::int AS sections,
             (SELECT COUNT(*) FROM drafts d WHERE d.user_id = u.id)::int AS drafts,
             (SELECT COUNT(*) FROM drafts d WHERE d.user_id = u.id AND d.status = 'done')::int AS done_drafts,
             (SELECT COUNT(*) FROM style_samples ss WHERE ss.user_id = u.id)::int AS samples,
             (SELECT MAX(d.updated_at) FROM drafts d WHERE d.user_id = u.id) AS last_draft_at
      FROM users u ORDER BY u.id ASC`);
    return list.map((r) => nums(r, ['id', 'personas', 'sections', 'drafts', 'done_drafts', 'samples']));
  },
};

/* 邀请码：后台生成，一码注册一个人 */
export const Invites = {
  async list() {
    return orm().select().from(invites).orderBy(desc(invites.id)).limit(500);
  },
  async create(code, note, by) {
    return one(orm().insert(invites).values({ code, note, created_by: by, created_at: now() }).returning());
  },
  /* 只能作废还没用过的 */
  async revoke(id) {
    const rows = await orm().update(invites).set({ revoked_at: now() })
      .where(and(eq(invites.id, id), eq(invites.used_at, ''), eq(invites.revoked_at, ''))).returning({ id: invites.id });
    return rows.length > 0;
  },
  /* 用邀请码注册：占码和建用户在一个事务里。占码是一条带条件的 UPDATE——两个人同时用同一个码，只有一个能占到；
     用户名撞了（409）整个回滚，码还能再用 */
  async registerWith(code, username, passHash) {
    return withTx(async () => {
      const at = now();
      const hit = await one(orm().update(invites).set({ used_at: at })
        .where(and(eq(invites.code, code), eq(invites.used_at, ''), eq(invites.revoked_at, ''))).returning({ id: invites.id }));
      if (!hit) return null;
      const user = await one(orm().insert(users).values({ username, pass_hash: passHash, created_at: at }).returning());
      await orm().update(invites).set({ used_by: user.id, used_name: username }).where(eq(invites.id, hit.id));
      return user;
    });
  },
};

export const Sessions = {
  async create(token, userId, ttlMs) {
    await orm().insert(sessions).values({ token, user_id: userId, expires_at: Date.now() + ttlMs });
  },
  async user(token) {
    if (!token) return null;
    const row = await one(orm().select().from(sessions).where(eq(sessions.token, token)));
    if (!row) return null;
    if (Number(row.expires_at) < Date.now()) { await this.destroy(token); return null; }
    return Users.byId(row.user_id);
  },
  async destroy(token) {
    await orm().delete(sessions).where(eq(sessions.token, token));
  },
  async sweep() {
    await orm().delete(sessions).where(sql`${sessions.expires_at} < ${Date.now()}`);
  },
};
