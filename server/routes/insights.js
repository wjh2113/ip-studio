/* 路由 · insights：发布数据回填与复盘。从原 routes.js 原样拆出。 */
import { Drafts, METRIC_FIELDS, Metrics, Sections } from '../db.js';
import { chosenTopic } from '../performance.js';
import { openingType, titleType } from '../shapes.js';
import { HttpError } from '../auth.js';
import { json, requireUser } from './common.js';
import { onPublished } from '../learning.js';

/* ==================================================================
 * 发布数据回填与复盘
 *
 * 整条链路原来到"导出"就断了——哪篇火了、哪个方向表现好、
 * 哪种开头留存高，一概不知。语气档案只学了"你怎么写"，没学"什么有效"。
 *
 * 回填刻意做得很轻：发完手填几个数字就行。指望自动抓平台数据不现实
 * （没有开放接口，爬取违反条款），而几个数字的手工成本远低于它带来的信息。
 * ================================================================== */

const METRIC_LABELS = { views: '阅读/播放', likes: '点赞', comments: '评论', shares: '转发/收藏', follows: '涨粉' };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const today = () => new Date().toISOString().slice(0, 10);

/* 发布后第几天：发布当天算第 0 天 */
export function dayOf(publishedAt, capturedOn) {
  if (!DAY.test(String(publishedAt || '').slice(0, 10)) || !DAY.test(capturedOn || '')) return null;
  const d = (Date.parse(capturedOn) - Date.parse(String(publishedAt).slice(0, 10))) / 86400000;
  return Number.isFinite(d) ? Math.round(d) : null;
}

/* 这篇能回填哪些平台：主稿的平台 + 已生成的平台版本 */
const platformsOf = (draft) => [...new Set([draft.platform, ...Object.keys(draft.variants || {})].filter(Boolean))];

async function mineDraft(req, params) {
  const user = await requireUser(req);
  const draft = await Drafts.byId(Number(params.id), user.id);
  if (!draft) throw new HttpError(404, '记录不存在');
  return { user, draft };
}

/* drafts.metrics_json 是「最新一次」的缓存：列表和复盘筛选靠它，不用每次去翻快照表 */
async function syncLatest(draft, userId, publishedAt) {
  const history = await Metrics.list(draft.id, userId);
  const last = history[0];
  const cache = last
    ? { ...Object.fromEntries(METRIC_FIELDS.filter((k) => last[k] != null).map((k) => [k, last[k]])), ...(last.note ? { note: last.note } : {}) }
    : null;
  await Drafts.setMetrics(draft.id, userId, cache, cache ? publishedAt : '');
  return { metrics: cache, published_at: cache ? publishedAt : '', history };
}

/* 回填一次：存一行快照。同一天同一平台再填就改那一行；这一天这个平台全部留空保存 = 删掉这一行 */
export async function handleMetricsSave(req, res, body, params) {
  const { user, draft } = await mineDraft(req, params);

  const values = {};
  for (const k of METRIC_FIELDS) {
    if (body?.[k] === '' || body?.[k] == null) continue;
    const v = Number(body[k]);
    if (Number.isFinite(v) && v >= 0) values[k] = Math.round(v);
  }
  const note = String(body?.note || '').trim().slice(0, 300);

  const platform = String(body?.platform || draft.platform || '');
  if (platform && !platformsOf(draft).includes(platform)) throw new HttpError(400, '这篇没有这个平台的版本');
  const capturedOn = DAY.test(String(body?.captured_on || '')) ? String(body.captured_on) : today();
  const published = DAY.test(String(body?.published_at || ''))
    ? String(body.published_at) : (draft.published_at || capturedOn);
  if (capturedOn < published) throw new HttpError(400, '记录日期早于发布日期');

  const empty = !Object.keys(values).length && !note;
  if (empty) {
    const hit = (await Metrics.list(draft.id, user.id)).find((m) => m.platform === platform && m.capturedOn === capturedOn);
    if (hit) await Metrics.remove(hit.id, draft.id, user.id);
  } else {
    await Metrics.put(draft.id, user.id, { platform, capturedOn, values, note });
  }
  const out = await syncLatest(draft, user.id, published);
  // 第一次填发布数据 = 这篇发出去了：账号开着自动学习就从它学（加样本、学改稿偏好），后台跑
  if (out.published_at && !draft.published_at) await onPublished(user.id, draft.id);
  json(res, 200, { ...out, removed: empty });
}

export async function handleMetricsHistory(req, res, body, params) {
  const { user, draft } = await mineDraft(req, params);
  json(res, 200, {
    history: await Metrics.list(draft.id, user.id),
    platforms: platformsOf(draft),
    published_at: draft.published_at || '',
  });
}

export async function handleMetricsDelete(req, res, body, params) {
  const { user, draft } = await mineDraft(req, params);
  if (!await Metrics.remove(Number(params.mid), draft.id, user.id)) throw new HttpError(404, '这条记录不存在');
  json(res, 200, await syncLatest(draft, user.id, draft.published_at || ''));
}

export async function handleMetricsMeta(req, res) {
  await requireUser(req);
  json(res, 200, { fields: METRIC_FIELDS.map((k) => ({ key: k, label: METRIC_LABELS[k] })) });
}

/* 发布后第 7 天前后（5～9 天）记下的阅读数，取最接近第 7 天的一次 */
export function near7(trend) {
  const hits = trend.filter((t) => t.day != null && t.day >= 5 && t.day <= 9 && t.views != null)
    .sort((a, b) => Math.abs(a.day - 7) - Math.abs(b.day - 7));
  return hits.length ? hits[0].views : null;
}

/* 复盘：按维度分组比中位数。
 *
 * 用**中位数不用平均数**——自媒体数据长尾极重，一条爆款能把平均值拉到毫无参考价值。
 * 样本少于 3 条的维度不给结论，只报数量：两三条数据得出的"规律"是噪声。 */
export async function handleReview2(req, res, body, params, url) {
  const user = await requireUser(req);
  const raw = url?.searchParams.get('persona');
  const personaId = raw ? Number(raw) : undefined;
  const rows = await Drafts.withMetrics(user.id, personaId);

  const sections = Object.fromEntries(
    (personaId ? await Sections.list(personaId, user.id) : []).map((s) => [s.id, s.name]),
  );

  // 每篇每个平台一条：数字取这个平台最近一次回填，另带整条走势和「发布后第 7 天」的数
  const snaps = await Metrics.forDrafts(user.id, rows.map((r) => r.id));
  const items = [];
  for (const r of rows) {
    const chosen = chosenTopic(r);
    const byPlatform = new Map();
    for (const m of snaps.get(r.id) || []) {
      const key = m.platform || r.platform;
      if (!byPlatform.has(key)) byPlatform.set(key, []);
      byPlatform.get(key).push(m);
    }
    for (const [platform, list] of byPlatform) {
      const last = list[list.length - 1];
      const trend = list.map((m) => ({ day: dayOf(r.published_at, m.capturedOn), on: m.capturedOn, views: m.views, likes: m.likes }));
      items.push({
        id: r.id,
        title: r.title || r.subject,
        platform,
        section: sections[r.section_id] || '',
        label: chosen?.label || '',
        titleType: titleType(r.title || chosen?.title || ''),
        opening: openingType(r.head || ''),
        published_at: r.published_at,
        metrics: Object.fromEntries([...METRIC_FIELDS, 'note'].map((k) => [k, last[k]])),
        views7: near7(trend),
        trend,
      });
    }
  }
  items.sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)) || b.id - a.id);

  const median = (nums) => {
    const a = nums.filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
    if (!a.length) return null;
    const i = Math.floor(a.length / 2);
    return a.length % 2 ? a[i] : Math.round((a[i - 1] + a[i]) / 2);
  };

  const group = (key) => {
    const buckets = new Map();
    for (const it of items) {
      const k = it[key];
      if (!k) continue;
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(it);
    }
    return [...buckets.entries()].map(([name, list]) => ({
      name,
      count: list.length,
      // 样本太少不给中位数——两三条数据得出的"规律"是噪声
      views: list.length >= 3 ? median(list.map((x) => x.metrics.views)) : null,
      likes: list.length >= 3 ? median(list.map((x) => x.metrics.likes)) : null,
      // 同口径：只比发布后第 5～9 天记下的数，早填晚填的不混在一起
      views7: list.filter((x) => x.views7 != null).length >= 3 ? median(list.map((x) => x.views7)) : null,
    })).sort((a, b) => (b.views ?? -1) - (a.views ?? -1));
  };

  json(res, 200, {
    total: items.length,
    items: items.slice(0, 40),
    byPlatform: group('platform'),
    bySection: group('section'),
    byLabel: group('label'),
    byTitle: group('titleType'),
    byOpening: group('opening'),
    note: items.length < 6
      ? `只回填了 ${items.length} 篇，还看不出规律——攒到十几篇再看。`
      : '用中位数不是平均数：自媒体数据长尾重，一条爆款会把平均值拉到没有参考价值。样本少于 3 篇的维度不给结论。',
  });
}
