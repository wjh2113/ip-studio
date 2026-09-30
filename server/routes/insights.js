/* 路由 · insights：发布数据回填与复盘。从原 routes.js 原样拆出。 */
import { Drafts, Sections } from '../db.js';
import { HttpError } from '../auth.js';
import { json, requireUser } from './common.js';

/* ==================================================================
 * 发布数据回填与复盘
 *
 * 整条链路原来到"导出"就断了——哪篇火了、哪个方向表现好、
 * 哪种开头留存高，一概不知。语气档案只学了"你怎么写"，没学"什么有效"。
 *
 * 回填刻意做得很轻：发完手填几个数字就行。指望自动抓平台数据不现实
 * （没有开放接口，爬取违反条款），而几个数字的手工成本远低于它带来的信息。
 * ================================================================== */

const METRIC_FIELDS = ['views', 'likes', 'comments', 'shares', 'follows'];

const METRIC_LABELS = { views: '阅读/播放', likes: '点赞', comments: '评论', shares: '转发/收藏', follows: '涨粉' };

export async function handleMetricsSave(req, res, body, params) {
  const user = requireUser(req);
  const draft = Drafts.byId(Number(params.id), user.id);
  if (!draft) throw new HttpError(404, '记录不存在');

  const metrics = {};
  for (const k of METRIC_FIELDS) {
    const v = Number(body?.[k]);
    if (Number.isFinite(v) && v >= 0) metrics[k] = Math.round(v);
  }
  const note = String(body?.note || '').trim().slice(0, 300);
  if (note) metrics.note = note;

  const published = /^\d{4}-\d{2}-\d{2}$/.test(String(body?.published_at || ''))
    ? String(body.published_at) : (draft.published_at || new Date().toISOString().slice(0, 10));

  // 全空就是撤销回填，存 null 而不是一个空对象——复盘时才好过滤
  const empty = !METRIC_FIELDS.some((k) => k in metrics) && !note;
  Drafts.setMetrics(draft.id, user.id, empty ? null : metrics, empty ? '' : published);
  json(res, 200, { metrics: empty ? null : metrics, published_at: empty ? '' : published });
}

export async function handleMetricsMeta(req, res) {
  requireUser(req);
  json(res, 200, { fields: METRIC_FIELDS.map((k) => ({ key: k, label: METRIC_LABELS[k] })) });
}

/* 复盘：按维度分组比中位数。
 *
 * 用**中位数不用平均数**——自媒体数据长尾极重，一条爆款能把平均值拉到毫无参考价值。
 * 样本少于 3 条的维度不给结论，只报数量：两三条数据得出的"规律"是噪声。 */
export async function handleReview2(req, res, body, params, url) {
  const user = requireUser(req);
  const raw = url?.searchParams.get('persona');
  const personaId = raw ? Number(raw) : undefined;
  const rows = Drafts.withMetrics(user.id, personaId);

  const sections = Object.fromEntries(
    (personaId ? Sections.list(personaId, user.id) : []).map((s) => [s.id, s.name]),
  );

  const items = rows.map((r) => {
    let m = null;
    let topics = [];
    try { m = JSON.parse(r.metrics_json); } catch { /* 脏数据跳过 */ }
    try { topics = JSON.parse(r.topics_json) || []; } catch { /* 同上 */ }
    const chosen = topics.find?.((t) => t?.chosen) || topics[0] || null;
    return {
      id: r.id,
      title: r.title || r.subject,
      platform: r.platform,
      section: sections[r.section_id] || '',
      label: chosen?.label || '',
      published_at: r.published_at,
      metrics: m,
    };
  }).filter((x) => x.metrics);

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
    })).sort((a, b) => (b.views ?? -1) - (a.views ?? -1));
  };

  json(res, 200, {
    total: items.length,
    items: items.slice(0, 40),
    byPlatform: group('platform'),
    bySection: group('section'),
    byLabel: group('label'),
    note: items.length < 6
      ? `只回填了 ${items.length} 篇，还看不出规律——攒到十几篇再看。`
      : '用中位数不是平均数：自媒体数据长尾重，一条爆款会把平均值拉到没有参考价值。样本少于 3 篇的维度不给结论。',
  });
}
