/* 路由 · common：各业务路由共用的小工具：JSON 响应、登录校验、错误文案、重试、账号与语气样本解析。从原 routes.js 原样拆出。 */
import { readdir, rm } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { DATA_DIR, Prefs, Profile, Samples, bigrams, overlapScore } from '../db.js';
import { currentAdmin, currentUser, HttpError } from '../auth.js';
import { PROVIDER } from '../llm.js';
import { loadPricing } from '../pricing.js';
import { liveSystem } from '../promptrev.js';
import { waitFor } from '../jobs.js';

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

export const requireUser = async (req) => {
  const user = await currentUser(req);
  if (!user) throw new HttpError(401, '请先登录');
  return user;
};

export const sys = (key, builtin) => liveSystem(key, builtin);

/* 语气锚点：档案已经蒸馏过，这里只取两篇原文做语感参考——和这次题材最像的两篇，都不像就取最近的 */
export const styleSamples = async (persona, userId, hint = '') =>
  (persona?.id && persona.style_digest)
    ? await Samples.pickSimilar(persona.id, userId, hint, 2)
    : [];

/* 个人档案召回：按题材的字面重合挑最相关的几条（同素材召回的办法），太低的分不给 */
export async function recallProfile(userId, hint, limit = 5) {
  const all = await Profile.list(userId);
  if (!all.length) return [];
  const grams = bigrams(hint);
  if (!grams.size) return [];
  return all
    .map((e) => ({ e, score: overlapScore(grams, `${e.title} ${e.tags} ${e.tags} ${e.org} ${e.role} ${e.body.slice(0, 300)} ${e.result}`) }))
    .filter((x) => x.score >= 3)
    .sort((a, b) => b.score - a.score || (b.e.used_count || 0) - (a.e.used_count || 0))
    .slice(0, limit)
    .map((x) => x.e);
}

/* 写作时「懂作者」的那部分上下文：个人档案里相关的几条 + 这个号的改稿偏好。
   mode：topics 只给档案的标题和结果；content 完整档案 + 偏好；assist 精简档案 + 偏好 */
export async function writerMe(userId, persona, hint, mode = 'content') {
  const profile = await recallProfile(userId, hint, mode === 'content' ? 5 : 3);
  const prefs = persona?.id && mode !== 'topics' ? await Prefs.active(persona.id, userId, 12) : [];
  return { profile, prefs, compact: mode !== 'content' };
}

/* ---------------- 管理后台 ---------------- */

export async function requireAdmin(req) {
  const admin = await currentAdmin(req);
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

/* ---------------- 长任务的两种回法 ----------------
   请求带 async: true（或 ?async=1）：立刻回 202 和任务，前端轮询 /api/jobs/:id。
   不带的（老前端、脚本、测试）：在这里等它做完，回和以前一样的结果。
   两种都走队列，所以请求断了活也照样做完、结果照样落库。 */
export const JOB_WAIT_MS = 10 * 60 * 1000;

export const wantsAsync = (body, url) => body?.async === true || url?.searchParams?.get('async') === '1';

export async function awaitJob(job) {
  const done = await waitFor(job.id, JOB_WAIT_MS);
  if (done?.status === 'done') return done.result;
  if (done?.status === 'failed') throw new HttpError(done.result?.code || 502, done.error);
  if (done?.status === 'cancelled') throw new HttpError(409, '任务已取消');
  throw new HttpError(504, '任务还没做完，稍后在任务中心看结果');
}
