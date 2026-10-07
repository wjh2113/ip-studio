/* 路由 · learning：个人档案（跟着用户走）与「AI 眼中的我」（每个账号学到的语气、改稿偏好、学习记录）。
 * 学习逻辑在 server/learning.js，这里只管读写和校验。 */
import { Embeddings, LearnLog, PREF_MAX, PROFILE_KINDS, PROFILE_MAX, Personas, Prefs, Profile, SAMPLE_MAX, Samples } from '../db.js';
import { HttpError } from '../auth.js';
import { userLimit } from '../limit.js';
import { FULL_EVERY, enqueueLearn, parseProfile } from '../learning.js';
import { presentJob } from '../jobs.js';
import { dataFindings, performanceOf } from '../performance.js';
import { semanticOn } from '../semantic.js';
import { Worker } from 'node:worker_threads';
import { json, requireUser } from './common.js';

const text = (v, max) => String(v ?? '').trim().slice(0, max);

function cleanEntry(b) {
  const e = {
    kind: PROFILE_KINDS.includes(b?.kind) ? b.kind : 'work',
    title: text(b?.title, 60),
    period: text(b?.period, 40),
    org: text(b?.org, 60),
    role: text(b?.role, 60),
    body: text(b?.body, 1000),
    result: text(b?.result, 400),
    tags: text(b?.tags, 120),
    visibility: b?.visibility === 'background' ? 'background' : 'public',
  };
  if (!e.title) throw new HttpError(400, '给这条经历写个标题');
  return e;
}

/* ---------------- 个人档案 ---------------- */

export async function handleProfileList(req, res) {
  const user = await requireUser(req);
  json(res, 200, { entries: await Profile.list(user.id), max: PROFILE_MAX, log: await LearnLog.list(user.id, null, 20) });
}

export async function handleProfileCreate(req, res, body) {
  const user = await requireUser(req);
  if (await Profile.count(user.id) >= PROFILE_MAX) throw new HttpError(400, `个人档案最多 ${PROFILE_MAX} 条`);
  json(res, 200, { entry: await Profile.create(user.id, cleanEntry(body), 'manual') });
}

export async function handleProfileUpdate(req, res, body, params) {
  const user = await requireUser(req);
  const entry = await Profile.update(Number(params.pid), user.id, cleanEntry(body));
  if (!entry) throw new HttpError(404, '这条经历不存在');
  json(res, 200, { entry });
}

export async function handleProfileDelete(req, res, body, params) {
  const user = await requireUser(req);
  if (!await Profile.remove(Number(params.pid), user.id)) throw new HttpError(404, '这条经历不存在');
  json(res, 200, { ok: true });
}

/* 贴简历 / 经历回顾 → 拆成一条条，不保存，给作者勾选 */
export async function handleProfileParse(req, res, body) {
  const user = await requireUser(req);
  userLimit(user.id, 'profile-parse', 20, 60 * 60_000);
  const src = String(body?.text ?? '');
  if (src.length > 12000) throw new HttpError(400, '太长了，一次贴 1.2 万字以内，可以分几次');
  json(res, 200, { entries: await parseProfile(user.id, src) });
}

/* 存一批（拆简历的结果、文章里找到的候选）。logId：处理的是哪条待确认记录，存完标成已处理 */
export async function handleProfileBatch(req, res, body) {
  const user = await requireUser(req);
  const list = Array.isArray(body?.entries) ? body.entries.slice(0, 50) : [];
  if (!list.length && !body?.logId) throw new HttpError(400, '没有要存的经历');
  const room = PROFILE_MAX - await Profile.count(user.id);
  if (list.length > room) throw new HttpError(400, `个人档案最多 ${PROFILE_MAX} 条，还能存 ${Math.max(0, room)} 条`);
  const source = ['resume', 'article', 'voice'].includes(body?.source) ? body.source : 'manual';
  const saved = [];
  for (const e of list) saved.push(await Profile.create(user.id, cleanEntry(e), source));
  if (body?.logId) await LearnLog.setStatus(Number(body.logId), user.id, 'done');
  json(res, 200, { saved: saved.length, entries: await Profile.list(user.id) });
}

/* ---------------- AI 眼中的我（按账号） ---------------- */

async function personaOf(req, params) {
  const user = await requireUser(req);
  const persona = await Personas.byId(Number(params.id), user.id);
  if (!persona) throw new HttpError(404, '账号不存在');
  return { user, persona };
}

export async function handleLearning(req, res, body, params) {
  const { user, persona } = await personaOf(req, params);
  const count = await Samples.count(persona.id, user.id);
  json(res, 200, {
    digest: persona.style_digest,
    digestUpdatedAt: persona.style_updated_at,
    autoLearn: Boolean(persona.auto_learn),
    samples: { count, max: SAMPLE_MAX, untilFull: Math.max(0, FULL_EVERY - (count - (persona.digest_full_count || 0))) },
    prefs: await Prefs.list(persona.id, user.id),
    prefMax: PREF_MAX,
    profileCount: await Profile.count(user.id),
    log: await LearnLog.list(user.id, persona.id, 40),
    // 数据告诉我们：这个号上哪种标题、开头、方向数据好（回填够 6 篇才说）
    data: dataFindings(await performanceOf(user.id, persona.id)),
    // 写作时按意思找经历和素材：建了多少条索引
    semantic: { on: semanticOn(), indexed: await Embeddings.stats(user.id) },
  });
}

export async function handleAutoLearn(req, res, body, params) {
  const { user, persona } = await personaOf(req, params);
  await Personas.setAutoLearn(persona.id, user.id, Boolean(body?.on));
  json(res, 200, { autoLearn: Boolean(body?.on) });
}

/* 从头梳理放后台：会补提炼老样本，可能要等一会儿 */
export async function handleDigestRebuildJob(req, res, body, params) {
  const { user, persona } = await personaOf(req, params);
  if (!await Samples.count(persona.id, user.id)) throw new HttpError(400, '还没有样本可学');
  json(res, 200, { job: presentJob(await enqueueLearn(user.id, persona.id, { type: 'rebuild' }, '语气档案从头梳理')) });
}

export async function handlePrefCreate(req, res, body, params) {
  const { user, persona } = await personaOf(req, params);
  const rule = text(body?.rule, 80);
  if (rule.length < 4) throw new HttpError(400, '规则写具体一点，至少 4 个字');
  if ((await Prefs.list(persona.id, user.id)).length >= PREF_MAX) throw new HttpError(400, `每个号最多 ${PREF_MAX} 条，先删掉不要的`);
  json(res, 200, { pref: await Prefs.create(user.id, persona.id, { rule, evidence: '手动添加' }) });
}

export async function handlePrefUpdate(req, res, body, params) {
  const { user } = await personaOf(req, params);
  const patch = {};
  if (body?.rule !== undefined) {
    patch.rule = text(body.rule, 80);
    if (patch.rule.length < 4) throw new HttpError(400, '规则写具体一点，至少 4 个字');
  }
  if (body?.status !== undefined) patch.status = body.status;
  const pref = await Prefs.update(Number(params.rid), user.id, patch);
  if (!pref) throw new HttpError(404, '这条规则不存在');
  json(res, 200, { pref });
}

export async function handlePrefDelete(req, res, body, params) {
  const { user } = await personaOf(req, params);
  if (!await Prefs.remove(Number(params.rid), user.id)) throw new HttpError(404, '这条规则不存在');
  json(res, 200, { ok: true });
}

/* 待确认的经历候选：忽略 = 标成已处理，不存 */
export async function handleLogDismiss(req, res, body, params) {
  const user = await requireUser(req);
  if (!await LearnLog.setStatus(Number(params.lid), user.id, 'done')) throw new HttpError(404, '这条记录不存在');
  json(res, 200, { ok: true });
}

/* ---------------- Word / PDF 导入：只取文字，不存文件 ----------------
   语气样本、个人档案（简历）都用它：前端拿到文字后照旧走原来的导入 / 拆解接口，用户能先看一眼再存。 */
const EXTRACT_TIMEOUT = 20_000;

export function extractInWorker(buffer, name) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../filetext-worker.js', import.meta.url), {
      workerData: { buffer, name },
      resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
    const timer = setTimeout(() => { void worker.terminate(); reject(new HttpError(422, '这个文件太复杂了，20 秒没读完。可以复制文字粘贴')); }, EXTRACT_TIMEOUT);
    worker.once('message', (m) => {
      clearTimeout(timer);
      void worker.terminate();
      if (m.ok) resolve(m.result); else reject(new HttpError(m.status, m.message));
    });
    worker.once('error', (err) => { clearTimeout(timer); reject(new HttpError(422, `文件读不了：${err.message}`)); });
  });
}

export async function handleFileExtract(req, res, file) {
  const user = await requireUser(req);
  userLimit(user.id, 'file-extract', 60, 60 * 60_000);
  if (!file?.buffer?.length) throw new HttpError(400, '文件是空的');
  const out = await extractInWorker(file.buffer, file.name);
  json(res, 200, { ...out, name: file.name, chars: out.text.length });
}
