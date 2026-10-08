/* 路由 · invites：邀请码。REGISTER_OPEN=0 时凭码注册，一码一人。
 *
 * 谁能发码：前台里 APP_ADMINS 列出的用户（比如 APP_ADMINS=jonny），或者已登录管理后台的管理员。
 * 别的用户调这几个接口一律 403。 */
import { Invites } from '../db.js';
import { currentAdmin, currentUser, HttpError, isAppAdmin, isUniqueViolation, newInviteCode, registerMode } from '../auth.js';
import { json } from './common.js';

async function requireInviter(req) {
  const user = await currentUser(req);
  if (user && isAppAdmin(user)) return user.username;
  const admin = await currentAdmin(req);
  if (admin) return admin.username;
  if (!user) throw new HttpError(401, '请先登录');
  throw new HttpError(403, '只有管理员能发邀请码');
}

const row = (x) => ({
  id: x.id, code: x.code, note: x.note, created_by: x.created_by, created_at: x.created_at,
  used_name: x.used_name, used_at: x.used_at, revoked_at: x.revoked_at,
  status: x.revoked_at ? 'revoked' : x.used_at ? 'used' : 'open',
});

export async function handleInviteList(req, res) {
  await requireInviter(req);
  json(res, 200, { mode: registerMode(), invites: (await Invites.list()).map(row) });
}

export async function handleInviteCreate(req, res, body) {
  const by = await requireInviter(req);
  const n = Math.max(1, Math.min(20, Number(body?.count) || 1));
  const note = String(body?.note || '').trim().slice(0, 60);
  const made = [];
  for (let i = 0; i < n; i += 1) {
    // 撞了已有的码（概率极小）就换一个再试
    for (let t = 0; ; t += 1) {
      try {
        made.push(row(await Invites.create(newInviteCode(), note, by)));
        break;
      } catch (err) {
        if (!isUniqueViolation(err) || t >= 4) throw err;
      }
    }
  }
  json(res, 200, { mode: registerMode(), invites: made });
}

export async function handleInviteRevoke(req, res, body, params) {
  await requireInviter(req);
  if (!await Invites.revoke(Number(params.iid))) throw new HttpError(409, '这个码已经用过或作废了');
  json(res, 200, { ok: true });
}
