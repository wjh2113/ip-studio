/* 用发布数据给推荐加权：这个号上哪些写法框架、哪类方向、哪几篇数据好。
 *
 * 只在样本够的时候说话：
 *   - 回填过数据的稿子少于 MIN_TOTAL 篇，什么都不给（两三篇的「规律」是噪声）；
 *   - 某个框架 / 方向类型少于 MIN_GROUP 篇，不给它下结论。
 * 比的是中位数，不是平均数：一条爆款能把平均值拉到没有参考价值。
 * 每篇取主稿平台最近一次回填的阅读数（drafts.metrics_json 缓存），够粗，但推荐只需要方向对。
 */
import { Drafts } from './db.js';
import { median } from './quality.js';

export const MIN_TOTAL = 6;
export const MIN_GROUP = 3;

const parse = (raw, fallback) => { try { return JSON.parse(raw) ?? fallback; } catch { return fallback; } };

function groupBy(items, key, overall) {
  const buckets = new Map();
  for (const it of items) {
    const k = it[key];
    if (!k) continue;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(it.views);
  }
  const out = {};
  for (const [k, list] of buckets) {
    if (list.length < MIN_GROUP) continue;
    const m = median(list);
    out[k] = { median: Math.round(m), n: list.length, lift: overall ? Math.round((m / overall) * 100) / 100 : 1 };
  }
  return out;
}

export function performanceOf(userId, personaId) {
  const items = Drafts.withMetrics(userId, personaId ?? undefined).map((r) => {
    const topics = parse(r.topics_json, []);
    const chosen = topics.find?.((t) => t?.chosen) || topics[0] || null;
    return {
      title: r.title || r.subject,
      subject: r.subject,
      label: chosen?.label || '',
      framework: parse(r.framework_json, null)?.key || '',
      views: Number(parse(r.metrics_json, null)?.views),
    };
  }).filter((x) => Number.isFinite(x.views));

  const overall = median(items.map((x) => x.views));
  if (items.length < MIN_TOTAL || !overall) {
    return { enough: false, n: items.length, overall: overall ?? null, byFramework: {}, byLabel: {}, top: [] };
  }
  return {
    enough: true,
    n: items.length,
    overall: Math.round(overall),
    byFramework: groupBy(items, 'framework', overall),
    byLabel: groupBy(items, 'label', overall),
    top: [...items].sort((a, b) => b.views - a.views).slice(0, 3)
      .map(({ title, subject, views }) => ({ title, subject, views })),
  };
}

/* 框架推荐的加分：数据好的往前排，差的往后。lift 2 倍 ≈ +2 分，和「平台专用」+3 同一量级 */
export function frameworkBonus(perf, key) {
  const g = perf?.byFramework?.[key];
  if (!g) return 0;
  return Math.max(-2, Math.min(3, Math.log2(g.lift) * 2));
}
