/* 路由 · auth：注册、登录、登出、当前用户与站点元信息。从原 routes.js 原样拆出。 */
import { Users } from '../db.js';
import { accessGateOn, accessUsername, checkAccessPassword, clearCookie, currentUser, HttpError, login, publicUser, register, sessionCookie, startSession, validateCredentials } from '../auth.js';
import { providerInfo } from '../llm.js';
import { PLATFORMS, TONES } from '../prompts.js';
import { json } from './common.js';

/* ---------------- 账号 ---------------- */

export async function handleRegister(req, res, body) {
  if (accessGateOn() || process.env.REGISTER_OPEN === '0') {
    throw new HttpError(403, '目前不开放注册');
  }
  const code = String(process.env.REGISTER_CODE || '').trim();
  if (code && String(body?.invite || '').trim() !== code) {
    throw new HttpError(403, '邀请码不正确');
  }
  const { username, password } = body || {};
  const bad = validateCredentials(username, password);
  if (bad) throw new HttpError(400, bad);
  const user = register(username.trim(), password);
  json(res, 200, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(startSession(user)) });
}

export async function handleLogin(req, res, body) {
  const password = String(body?.password || '');
  if (accessGateOn()) {
    if (!password) throw new HttpError(400, '请输入访问密码');
    if (!checkAccessPassword(password)) throw new HttpError(401, '密码错误');
    const user = Users.byName(accessUsername());
    if (!user) throw new HttpError(500, '访问账号未初始化');
    json(res, 200, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(startSession(user)) });
    return;
  }
  const { username } = body || {};
  if (!username || !password) throw new HttpError(400, '请输入用户名和密码');
  const user = login(String(username).trim(), password);
  json(res, 200, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(startSession(user)) });
}

export async function handleLogout(req, res) {
  json(res, 200, { ok: true }, { 'Set-Cookie': clearCookie() });
}

export async function handleMe(req, res) {
  const user = currentUser(req);
  json(res, 200, { user: user ? publicUser(user) : null });
}

export async function handleMeta(req, res) {
  json(res, 200, {
    platforms: Object.entries(PLATFORMS).map(([key, v]) => ({ key, label: v.label, length: v.length })),
    tones: Object.entries(TONES).map(([key, hint]) => ({ key, hint })),
    llm: providerInfo(),
    auth: {
      register: !accessGateOn() && process.env.REGISTER_OPEN !== '0',
      invite: Boolean(String(process.env.REGISTER_CODE || '').trim()),
      gate: accessGateOn(),
    },
  });
}
