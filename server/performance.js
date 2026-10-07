/* 用发布数据给推荐加权：这个号上哪些写法框架、哪类方向、哪种标题和开头、哪几篇数据好。
 * 标题类型、开头类型是按规则从标题和正文开头判的（shapes.js），不存库，每次现算。
 *
 * 只在样本够的时候说话：
 *   - 回填过数据的稿子少于 MIN_TOTAL 篇，什么都不给（两三篇的「规律」是噪声）；
 *   - 某个框架 / 方向类型少于 MIN_GROUP 篇，不给它下结论。
 * 比的是中位数，不是平均数：一条爆款能把平均值拉到没有参考价值。
 * 每篇取主稿平台最近一次回填的阅读数（drafts.metrics_json 缓存），够粗，但推荐只需要方向对。
 */
import { Drafts } from './db.js';
import { median } from './quality.js';
import { openingType, titleType } from './shapes.js';

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

/* 这篇最后用的是哪个方向。drafts.chosen 存的是方向的下标（第几个），方向对象上没有 chosen 字段；
   没选过或下标对不上时返回 null（这篇不参与按方向类型分组），不要退回第一个方向——那会把数据算到别的类型头上。 */
export function chosenTopic(row) {
  const topics = parse(row.topics_json, []);
  const i = Number(row.chosen);
  return Array.isArray(topics) && Number.isInteger(i) && row.chosen !== null && topics[i] ? topics[i] : null;
}

export async function performanceOf(userId, personaId) {
  const items = (await Drafts.withMetrics(userId, personaId ?? undefined)).map((r) => {
    const chosen = chosenTopic(r);
    return {
      title: r.title || r.subject,
      subject: r.subject,
      label: chosen?.label || '',
      framework: parse(r.framework_json, null)?.key || '',
      titleType: titleType(r.title || chosen?.title || ''),
      opening: openingType(r.head || ''),
      views: Number(parse(r.metrics_json, null)?.views),
    };
  }).filter((x) => Number.isFinite(x.views));

  const overall = median(items.map((x) => x.views));
  if (items.length < MIN_TOTAL || !overall) {
    return { enough: false, n: items.length, overall: overall ?? null, byFramework: {}, byLabel: {}, byTitle: {}, byOpening: {}, top: [] };
  }
  return {
    enough: true,
    n: items.length,
    overall: Math.round(overall),
    byFramework: groupBy(items, 'framework', overall),
    byLabel: groupBy(items, 'label', overall),
    byTitle: groupBy(items, 'titleType', overall),
    byOpening: groupBy(items, 'opening', overall),
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

/* 给「AI 眼中的我」的「数据告诉我们」：说人话的几条，样本不够就说还差几篇 */
export function dataFindings(perf) {
  if (!perf?.enough) return { enough: false, n: perf?.n || 0, need: MIN_TOTAL, lines: [] };
  const lines = [];
  const say = (group, what) => {
    const list = Object.entries(group || {}).sort((a, b) => b[1].lift - a[1].lift);
    const best = list[0];
    const worst = list.at(-1);
    if (best && best[1].lift >= 1.2) lines.push({ kind: what, text: `${what}「${best[0]}」的阅读中位数是整体的 ${best[1].lift} 倍（${best[1].n} 篇）` });
    if (worst && worst !== best && worst[1].lift <= 0.8) lines.push({ kind: what, text: `${what}「${worst[0]}」偏弱，只有整体的 ${worst[1].lift} 倍（${worst[1].n} 篇）` });
  };
  say(perf.byTitle, '标题用');
  say(perf.byOpening, '开头用');
  say(perf.byLabel, '方向');
  return { enough: true, n: perf.n, overall: perf.overall, lines, top: perf.top };
}
