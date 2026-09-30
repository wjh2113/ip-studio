/* 路由 · common：各业务路由共用的小工具：JSON 响应、登录校验、错误文案、重试、账号与语气样本解析。从原 routes.js 原样拆出。 */
import { readdir, rm } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { DATA_DIR, Samples } from '../db.js';
import { currentAdmin, currentUser, HttpError } from '../auth.js';
import { PROVIDER } from '../llm.js';
import { loadPricing } from '../pricing.js';
import { liveSystem } from '../promptrev.js';

loadPricing();

export const json = (res, status, body, headers = {}) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(payload);
};

export const requireUser = (req) => {
  const user = currentUser(req);
  if (!user) throw new HttpError(401, '请先登录');
  return user;
};

export const sys = (key, builtin) => liveSystem(key, builtin);

/* 语气锚点：档案已经蒸馏过，这里只取最近两篇原文做语感参考 */
export const styleSamples = (persona, userId) =>
  (persona?.id && persona.style_digest)
    ? Samples.list(persona.id, userId, { withContent: true, limit: 2 })
    : [];

/* ---------------- 管理后台 ---------------- */

export function requireAdmin(req) {
  const admin = currentAdmin(req);
  if (!admin) throw new HttpError(401, '请先用管理员账号登录');
  return admin;
}

/* 结构化生成偶发失败时重试一次；两次都不行才把错误抛给用户 */
/* 结构化生成偶发失败时重试一次；两次都不行才把错误抛给用户。
 *
 * 但**客户端错误不重试也不包装**：额度不够重试一百次也不会好，
 * 而包成 502「生成失败」会让人以为是服务出问题，跑去反复点重试——
 * 每点一次都是一次真实调用。这类错误要原样透出去。 */
const isClientError = (e) => {
  const s = e?.status ?? (e instanceof HttpError ? e.status : 0);
  return s >= 400 && s < 500;
};

export async function withRetry(fn, message) {
  try {
    return await fn(0);
  } catch (first) {
    if (isClientError(first)) throw first;
    console.warn('[retry]', describe(first));
    try {
      return await fn(1);
    } catch (second) {
      if (isClientError(second)) throw second;
      throw new HttpError(502, `${message}（${describe(second)}）`);
    }
  }
}

export function describe(err) {
  if (err instanceof HttpError) return err.message;
  const raw = String(err?.message || err);
  if (/401|authentication|api key/i.test(raw)) return '模型密钥无效或未配置，请检查 .env';
  if (/429|rate/i.test(raw)) return '触发上游限流，请稍后再试';
  if (err?.name === 'TimeoutError' || /timed? ?out|timeout/i.test(raw)) return '模型响应超时，请稍后再试';
  if (/ENOTFOUND|ECONNREFUSED|fetch failed/i.test(raw)) return `无法连接模型服务（${PROVIDER}），请检查网络或 BASE_URL`;
  return raw.slice(0, 300);
}

export async function dropImageFiles(userId, draftId) {
  const dir = resolvePath(DATA_DIR, 'images', String(userId));
  try {
    const names = await readdir(dir);
    await Promise.all(names.filter((n) => n.startsWith(`${draftId}-`))
      .map((n) => rm(resolvePath(dir, n), { force: true })));
  } catch { /* 目录不存在就没什么可删的 */ }
}
