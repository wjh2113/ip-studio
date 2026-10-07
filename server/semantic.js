/* 语义召回：素材、个人档案、语气样本按「意思像」而不只是「字面像」挑。
 *
 * 原来的召回是 2 字滑窗的字面重合：写「带团队」时，标签是「管理」的那条经历找不到。
 * 现在每条素材 / 档案 / 样本存一个向量（网关 embedding 能力，1024 维），写稿时把题材也向量化，
 * 两边算余弦相似度，再和字面分混在一起排：
 *
 *     综合分 = 0.7 × 语义分 + 0.3 × 字面分          （两项都先归一到 0～1）
 *
 * 入选条件是「字面分够」或「语义分够」任一项——字面能命中的照旧能命中，语义只会多找回东西，
 * 不会把原来找得到的弄丢。语义分还要离第一名不太远，免得题材和谁都不像时硬凑几条。
 *
 * 什么时候算向量：
 *   - 新增、修改后在后台补（indexLater，按人防抖，同一个人同时只跑一个）；
 *   - 写稿召回时发现还缺的，现算最多 INLINE_MAX 条，剩下的交给后台；
 *   - 向量化那段文字没变（指纹相同）就不重算。
 * 向量接口没配、调用失败：这一次只用字面分，写稿不受影响。
 */
import { createHash } from 'node:crypto';
import { Embeddings, Materials, Profile, Samples } from './db.js';
import { embedProvider, embedTexts } from './llm.js';

export const SEM_WEIGHT = 0.7;
const LEX_FULL = 12;             // 字面分到这个数算满分
const INLINE_MAX = 24;           // 召回时最多现算几条缺的向量
const NEAR_TOP = 0.12;           // 只靠语义入选的，相似度要离第一名在这个范围内

export const semanticOn = () => embedProvider() !== 'off';

/* 只靠语义入选的最低相似度。bge-m3 上同题材的中文段落一般在 0.55 以上，不相干的多在 0.45 以下；
   演示模式的「向量」只是字面散列，分数整体低得多 */
export const minSim = () => Number(process.env.EMBEDDING_MIN_SIM) || (embedProvider() === 'mock' ? 0.2 : 0.5);

const clip = (s, n) => String(s || '').slice(0, n);
const TEXT = {
  material: (m) => [m.title, m.tags, clip(m.body, 1200)],
  profile: (e) => [e.title, [e.org, e.role, e.period].filter(Boolean).join(' · '), e.tags, clip(e.body, 800), e.result],
  sample: (s) => [s.title, clip(s.head ?? s.content, 1200)],
};
export const embedText = (kind, item) => TEXT[kind](item).filter(Boolean).join('\n').trim().slice(0, 2000);
const hashOf = (text) => createHash('sha1').update(text).digest('hex').slice(0, 16);

/* 补齐缺的或过期的向量。max 限制这次最多算几条，返回 { done, left } */
export async function ensureVectors(userId, kind, items, { max = Infinity } = {}) {
  if (!semanticOn() || !items.length) return { done: 0, left: 0 };
  const have = await Embeddings.hashes(userId, kind, items.map((it) => it.id));
  const todo = [];
  for (const it of items) {
    const text = embedText(kind, it);
    if (text.length < 4) continue;
    const hash = hashOf(text);
    if (have.get(it.id) !== hash) todo.push({ id: it.id, text, hash });
  }
  const batch = todo.slice(0, max);
  if (batch.length) {
    const vecs = await embedTexts(batch.map((t) => t.text), { userId });
    for (let i = 0; i < batch.length; i += 1) await Embeddings.put(userId, kind, batch[i].id, batch[i].hash, vecs[i]);
  }
  return { done: batch.length, left: todo.length - batch.length };
}

/* 后台补向量：同一个人 2 秒内的多次改动合成一次，正在跑的时候再来的排在它后面 */
const LOADERS = {
  material: (userId) => Materials.list(userId),
  profile: (userId) => Profile.list(userId),
  sample: (userId) => Samples.heads(userId),
};
const timers = new Map();
const running = new Map();
export function indexLater(userId, delay = 2000) {
  if (!semanticOn() || !userId) return;
  clearTimeout(timers.get(userId));
  const t = setTimeout(() => {
    timers.delete(userId);
    const prev = running.get(userId) || Promise.resolve();
    const next = prev.then(() => indexUser(userId)).catch((err) => console.warn('[semantic] 补向量失败', err?.message))
      .finally(() => { if (running.get(userId) === next) running.delete(userId); });
    running.set(userId, next);
  }, delay);
  t.unref?.();
  timers.set(userId, t);
}

/* 把这个人三类东西的向量都补齐。返回每类补了几条 */
export async function indexUser(userId) {
  const out = {};
  for (const [kind, load] of Object.entries(LOADERS)) {
    out[kind] = (await ensureVectors(userId, kind, await load(userId))).done;
  }
  return out;
}

/* 测试和停机用：等所有后台补向量做完 */
export async function settleIndexing() {
  for (const [userId, t] of timers) { clearTimeout(t); timers.delete(userId); await indexUser(userId).catch(() => {}); }
  await Promise.all([...running.values()]);
}

/* 题材的向量：同一次写稿里素材、档案、样本三处召回用的是同一个题材，缓存一分钟 */
const queryCache = new Map();
async function queryVector(userId, hint) {
  const key = `${userId}:${hashOf(hint)}`;
  const hit = queryCache.get(key);
  if (hit && hit.at > Date.now() - 60_000) return hit.vec;
  const [vec] = await embedTexts([hint], { userId });
  queryCache.set(key, { vec, at: Date.now() });
  if (queryCache.size > 200) queryCache.delete(queryCache.keys().next().value);
  return vec;
}

/* 熔断：向量接口出错后 5 分钟内不再试，免得网关没配 embedding 路由时每次写稿都白等一次超时 */
const DOWN_MS = 5 * 60_000;
let downUntil = 0;
let warned = 0;
/* 排序。items 是候选（已按归属筛过），lexOf(item) 给字面分（原来的命中词数）。
 * 返回入选的条目和分数，按综合分从高到低；minLex 是只靠字面入选的门槛（和原来一样是 3）。 */
export async function rankHybrid(userId, kind, items, hint, lexOf, { minLex = 3 } = {}) {
  const query = String(hint || '').trim();
  const lex = new Map(items.map((it) => [it.id, query ? lexOf(it) : 0]));
  let sims = null;
  if (query && semanticOn() && items.length && Date.now() >= downUntil) {
    try {
      const vec = await queryVector(userId, query);
      const { left } = await ensureVectors(userId, kind, items, { max: INLINE_MAX });
      if (left > 0) indexLater(userId);
      sims = await Embeddings.similarity(userId, kind, items.map((it) => it.id), vec);
    } catch (err) {
      // 向量这一路坏了不影响写稿：这次只按字面排，5 分钟后再试。日志别刷屏
      downUntil = Date.now() + DOWN_MS;
      if (Date.now() - warned > 60_000) { warned = Date.now(); console.warn('[semantic] 语义召回不可用，退回字面：', err?.cause?.message || err?.message); }
      sims = null;
    }
  }
  const floor = minSim();
  const top = sims && sims.size ? Math.max(...sims.values()) : 0;
  const scored = items.map((it) => {
    const l = lex.get(it.id) || 0;
    const s = sims?.get(it.id);
    const lexNorm = Math.min(1, l / LEX_FULL);
    const semNorm = s == null ? null : Math.max(0, Math.min(1, (s - floor) / (1 - floor)));
    const byLex = l >= minLex;
    const bySem = s != null && s >= floor && s >= top - NEAR_TOP;
    return {
      item: it,
      lex: l,
      sim: s ?? null,
      ok: byLex || bySem,
      score: semNorm == null ? lexNorm : SEM_WEIGHT * semNorm + (1 - SEM_WEIGHT) * lexNorm,
    };
  });
  return scored.filter((x) => x.ok).sort((a, b) => b.score - a.score || b.lex - a.lex);
}
