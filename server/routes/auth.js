/* 路由 · auth：注册、登录、登出、当前用户与站点元信息。从原 routes.js 原样拆出。 */
import { Users } from '../db.js';
import { accessGateOn, accessUsername, checkAccessPassword, clearCookie, currentUser, endSession, HttpError, login, publicUser, register, registerMode, registerWithInvite, sessionCookie, startSession, validateCredentials } from '../auth.js';
import { providerInfo } from '../llm.js';
import { PLATFORMS, TONES } from '../prompts.js';
import { json } from './common.js';

/* ---------------- 账号 ---------------- */

/* 登录成功的回包。cookie 照旧下发（网页用）；请求头带 X-Client: app 的（手机 App）再把 token 放进 JSON，
   App 之后用 Authorization: Bearer <token> 调接口。网页拿不到 token，httpOnly 才有意义。 */
async function signedIn(req, res, user) {
  const token = await startSession(user);
  const app = String(req.headers['x-client'] || '').toLowerCase() === 'app';
  json(res, 200, { user: publicUser(user), ...(app ? { token } : {}) }, { 'Set-Cookie': sessionCookie(token) });
}

export async function handleRegister(req, res, body) {
  const mode = registerMode();
  if (mode === 'closed') throw new HttpError(403, '目前不开放注册');
  const { username, password } = body || {};
  const bad = validateCredentials(username, password);
  if (bad) throw new HttpError(400, bad);
  if (mode === 'invite') {
    // 凭后台生成的邀请码注册：一码一人
    const user = await registerWithInvite(body?.invite, username.trim(), password);
    await signedIn(req, res, user);
    return;
  }
  const code = String(process.env.REGISTER_CODE || '').trim();
  if (code && String(body?.invite || '').trim() !== code) {
    throw new HttpError(403, '邀请码不正确');
  }
  const user = await register(username.trim(), password);
  await signedIn(req, res, user);
}

export async function handleLogin(req, res, body) {
  const password = String(body?.password || '');
  if (accessGateOn()) {
    if (!password) throw new HttpError(400, '请输入访问密码');
    if (!checkAccessPassword(password)) throw new HttpError(401, '密码错误');
    const user = await Users.byName(accessUsername());
    if (!user) throw new HttpError(500, '访问账号未初始化');
    await signedIn(req, res, user);
    return;
  }
  const { username } = body || {};
  if (!username || !password) throw new HttpError(400, '请输入用户名和密码');
  const user = await login(String(username).trim(), password);
  await signedIn(req, res, user);
}

export async function handleLogout(req, res) {
  await endSession(req);
  json(res, 200, { ok: true }, { 'Set-Cookie': clearCookie() });
}

export async function handleMe(req, res) {
  const user = await currentUser(req);
  json(res, 200, { user: user ? publicUser(user) : null });
}

export async function handleMeta(req, res) {
  json(res, 200, {
    platforms: Object.entries(PLATFORMS).map(([key, v]) => ({ key, label: v.label, length: v.length })),
    tones: Object.entries(TONES).map(([key, hint]) => ({ key, hint })),
    llm: providerInfo(),
    auth: {
      register: registerMode() !== 'closed',
      invite: registerMode() === 'invite' || Boolean(String(process.env.REGISTER_CODE || '').trim()),
      gate: accessGateOn(),
    },
  });
}
