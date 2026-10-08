/* 账号与会话：scrypt 存密码，随机 token 存 httpOnly cookie */
import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import { Users, Sessions, Admins, AdminSessions, Invites } from './db.js';
import { cookieAttrs } from './security.js';

const SESSION_TTL = 1000 * 60 * 60 * 24 * 14; // 14 天
export const COOKIE_NAME = 'cw_session';

function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const key = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${key}`;
}

function verifyPassword(password, stored) {
  const [salt, key] = String(stored).split(':');
  if (!salt || !key) return false;
  const a = Buffer.from(key, 'hex');
  const b = scryptSync(password, salt, 64);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function validateCredentials(username, password) {
  if (typeof username !== 'string' || typeof password !== 'string') return '用户名和密码不能为空';
  if (!/^[\w一-龥.-]{2,24}$/.test(username)) return '用户名 2-24 位，支持中英文、数字、_ . -';
  if (password.length < 6 || password.length > 128) return '密码至少 6 位';
  return null;
}

/* 唯一约束冲突（PostgreSQL 23505）。drizzle 会把驱动的错误包一层放进 cause */
export const isUniqueViolation = (err) => err?.code === '23505' || err?.cause?.code === '23505';

export async function register(username, password) {
  if (await Users.byName(username)) throw new HttpError(409, '该用户名已被注册');
  try {
    return await Users.create(username, hashPassword(password));
  } catch (err) {
    // 两个人同时注册同一个名字：先查时都没有，插入时后到的撞唯一索引。这是 409，不是 500
    if (isUniqueViolation(err)) throw new HttpError(409, '该用户名已被注册');
    throw err;
  }
}

/* 注册方式：
 *   closed  配了 ACCESS_PASSWORD（一道门，所有人共用一个账号），不能注册
 *   invite  REGISTER_OPEN=0 或 =invite：凭后台生成的邀请码注册，一码一人
 *   open    其他：谁都能注册（配了 REGISTER_CODE 的话要填这个共用的码） */
export function registerMode() {
  if (accessGateOn()) return 'closed';
  const v = String(process.env.REGISTER_OPEN ?? '').trim().toLowerCase();
  if (v === '0' || v === 'invite') return 'invite';
  return 'open';
}

/* 邀请码：8 位，去掉 0 O 1 I L 这些容易看错的，显示成 ABCD-EFGH；输入时大小写、空格、横线都不讲究 */
const CODE_ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function newInviteCode() {
  let s = '';
  for (let i = 0; i < 8; i += 1) s += CODE_ABC[randomInt(CODE_ABC.length)];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}
export function normalizeInvite(raw) {
  const s = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4)}` : '';
}

export async function registerWithInvite(rawCode, username, password) {
  const code = normalizeInvite(rawCode);
  if (!code) throw new HttpError(400, '请填写邀请码');
  if (await Users.byName(username)) throw new HttpError(409, '该用户名已被注册');
  let user;
  try {
    user = await Invites.registerWith(code, username, hashPassword(password));
  } catch (err) {
    if (isUniqueViolation(err)) throw new HttpError(409, '该用户名已被注册');
    throw err;
  }
  if (!user) throw new HttpError(403, '邀请码不对，或者已经用过 / 作废了');
  return user;
}

export async function login(username, password) {
  const user = await Users.byName(username);
  if (!user || !verifyPassword(password, user.pass_hash)) {
    throw new HttpError(401, '用户名或密码错误');
  }
  return user;
}

/* 与 API 网关一样：一个访问密码。配了 ACCESS_PASSWORD 就关注册，只认这道门。 */
export const accessPassword = () => String(process.env.ACCESS_PASSWORD || '').trim();
export const accessGateOn = () => Boolean(accessPassword());
export const accessUsername = () => String(process.env.ACCESS_USER || 'ip').trim() || 'ip';

function sameSecret(a, b) {
  const ha = createHash('sha256').update(String(a)).digest();
  const hb = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

export function checkAccessPassword(password) {
  const expected = accessPassword();
  if (!expected) return false;
  return sameSecret(String(password || ''), expected);
}

export async function ensureAccessUser() {
  const pw = accessPassword();
  if (!pw) return false;
  const name = accessUsername();
  const hash = hashPassword(pw);
  const existing = await Users.byName(name);
  if (!existing) await Users.create(name, hash);
  else await Users.setPassword(existing.id, hash);
  return true;
}

export async function syncAdminPassword() {
  // 只认 ADMIN_PASSWORD；不再拿访问密码兜底，两者可以（也应该）不同
  const pw = String(process.env.ADMIN_PASSWORD || '');
  if (!pw) return false;
  const name = String(process.env.ADMIN_USERNAME || 'admin').trim() || 'admin';
  const hash = hashPassword(pw);
  const existing = await Admins.byName(name);
  if (!existing) {
    if (pw.length < 8) {
      console.warn('[admin] 访问密码少于 8 位，后台账号未同步');
      return false;
    }
    await createAdmin(name, pw);
    return true;
  }
  await Admins.setPassword(existing.id, hash);
  return true;
}

export async function startSession(user) {
  const token = randomBytes(32).toString('hex');
  await Sessions.create(token, user.id, SESSION_TTL);
  return token;
}

export function sessionCookie(token) {
  const maxAge = Math.floor(SESSION_TTL / 1000);
  return `${COOKIE_NAME}=${token}; ${cookieAttrs()}; Max-Age=${maxAge}`;
}

export const clearCookie = () => `${COOKIE_NAME}=; ${cookieAttrs()}; Max-Age=0`;

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  const hit = raw.split(';').map((s) => s.trim()).find((s) => s.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : null;
}

/* 手机 App 不走 cookie：登录时拿到同一张会话表里的 token，之后每次请求带 Authorization: Bearer <token>。
   token 是 startSession 生成的 64 位十六进制串，格式不对的直接当没带，不去查库。 */
function readBearer(req) {
  const m = String(req.headers.authorization || '').match(/^Bearer\s+([A-Za-z0-9_-]{16,256})\s*$/i);
  return m ? m[1] : null;
}

/* 这次请求用的会话 token：有 cookie 认 cookie（网页），没有才认 Bearer（App） */
export const sessionToken = (req) => readCookie(req, COOKIE_NAME) || readBearer(req);

export async function currentUser(req) {
  return Sessions.user(sessionToken(req));
}

/* 退出：把服务端那条会话删掉。只清 cookie 的话 token 还活着，App 存过的 token 照样能用 14 天 */
export async function endSession(req) {
  const token = sessionToken(req);
  if (token) await Sessions.destroy(token);
}

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/* 前台里的管理员（能发邀请码）：APP_ADMINS=jonny,另一个人 */
export const appAdmins = () => String(process.env.APP_ADMINS || '').split(/[,，\s]+/).map((x) => x.trim()).filter(Boolean);
export const isAppAdmin = (u) => Boolean(u?.username) && appAdmins().includes(u.username);

export const publicUser = (u) => ({ id: u.id, username: u.username, created_at: u.created_at, admin: isAppAdmin(u) });

/* ------------------------------------------------------------------ *
 * 管理员：完全独立的账号体系和会话
 * 业务用户的 cookie 进不了后台，管理员的 cookie 也进不了业务接口
 * ------------------------------------------------------------------ */
const ADMIN_COOKIE = 'cw_admin';
const ADMIN_TTL = 1000 * 60 * 60 * 12;   // 后台会话短一些，12 小时

export const adminSetupNeeded = async () => (await Admins.count()) === 0;

export async function createAdmin(username, password) {
  if (await Admins.byName(username)) throw new HttpError(409, '该管理员用户名已存在');
  return Admins.create(username, hashPassword(password));
}

export async function adminLogin(username, password) {
  const admin = await Admins.byName(username);
  if (!admin || !verifyPassword(password, admin.pass_hash)) {
    throw new HttpError(401, '管理员用户名或密码错误');
  }
  await Admins.touch(admin.id);
  return admin;
}

export async function startAdminSession(admin) {
  const token = randomBytes(32).toString('hex');
  await AdminSessions.create(token, admin.id, ADMIN_TTL);
  return token;
}

export const adminCookie = (token) =>
  `${ADMIN_COOKIE}=${token}; ${cookieAttrs()}; Max-Age=${Math.floor(ADMIN_TTL / 1000)}`;

export const clearAdminCookie = () => `${ADMIN_COOKIE}=; ${cookieAttrs()}; Max-Age=0`;

/* 公网不要把「第一个访问 /admin 的人」变成超管。
   生产默认关掉 HTTP 初始化；用 ADMIN_USERNAME + ADMIN_PASSWORD 在启动时写入。
   若必须走页面，再配 ADMIN_SETUP_TOKEN，请求里带上才放行。 */
export function setupHttpEnabled() {
  if (process.env.ADMIN_SETUP_TOKEN) return true;
  return process.env.NODE_ENV !== 'production';
}

export async function ensureBootstrapAdmin() {
  const username = String(process.env.ADMIN_USERNAME || '').trim();
  const password = String(process.env.ADMIN_PASSWORD || '');
  if (!username || !password) return false;
  if (password.length < 8) {
    console.warn('[admin] ADMIN_PASSWORD 少于 8 位，跳过自动初始化');
    return false;
  }
  const bad = validateCredentials(username, password);
  if (bad) {
    console.warn('[admin] 环境变量里的管理员账号不合规：', bad);
    return false;
  }
  if (await adminSetupNeeded()) {
    await createAdmin(username, password);
    console.log(`[admin] 已从环境变量创建管理员「${username}」`);
    return true;
  }
  /* 已有管理员时仍以 .env 为准同步密码——否则改了 ADMIN_PASSWORD 却登不进，说明书页也就改不了提示词 */
  const existing = await Admins.byName(username);
  if (existing && !verifyPassword(password, existing.pass_hash)) {
    await Admins.setPassword(existing.id, hashPassword(password));
    console.log(`[admin] 已按环境变量更新管理员「${username}」的密码`);
  }
  return false;
}

export async function currentAdmin(req) {
  return AdminSessions.admin(readCookie(req, ADMIN_COOKIE));
}

export const publicAdmin = (a) => ({ id: a.id, username: a.username, last_login: a.last_login });

setInterval(() => { void Sessions.sweep(); void AdminSessions.sweep(); }, 1000 * 60 * 60).unref();
