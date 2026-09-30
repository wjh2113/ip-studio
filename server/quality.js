/* 线上质量指标：不靠打分模型，只看作者实际做了什么。
 *
 *   editRatio  模型写的初稿，作者改掉了多少（0 = 原样发，1 = 全部重写）。
 *              按句子比：句子原样留下算保留，改了一个字也算改了。逐字编辑距离对几千字的稿子太慢，
 *              也不符合直觉——换个标点不该算「改」，但这里宁可略高估，趋势比绝对值有用。
 *   adoption   成稿检查提的替换建议，作者后来有没有动那句：原句不在了算「改了」，建议的写法出现了算「照着改」。
 *
 * 两个都是纯函数，数据由 db.js 在保存和检查时落库，管理后台按提示词变体汇总。
 */

const MAX_SENTENCES = 400;

/* 按中英文句末标点和换行切句，去掉 Markdown 标题符号和首尾空白，空句丢掉 */
export function sentences(text) {
  return String(text || '')
    .split(/(?<=[。！？!?；;…])|\n+/)
    .map((s) => s.replace(/^#+\s*/, '').trim())
    .filter(Boolean)
    .slice(0, MAX_SENTENCES);
}

/* 句子级最长公共子序列：保留下来的句子（按字数算） */
function keptChars(a, b) {
  const n = a.length;
  const m = b.length;
  let prev = new Array(m + 1).fill(0);
  for (let i = 1; i <= n; i += 1) {
    const cur = new Array(m + 1).fill(0);
    for (let j = 1; j <= m; j += 1) {
      cur[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1] + a[i - 1].length
        : Math.max(prev[j], cur[j - 1]);
    }
    prev = cur;
  }
  return prev[m];
}

/* 初稿被改掉的比例，保留两位小数；没有初稿返回 null */
export function editRatio(generated, current) {
  const a = sentences(generated);
  if (!a.length) return null;
  const total = a.reduce((n, s) => n + s.length, 0);
  const kept = keptChars(a, sentences(current));
  return Math.round((1 - kept / total) * 100) / 100;
}

/* 检查建议的采纳：issues 是检查时存下的 [{ quote, fix }] */
export function adoption(issues, content) {
  const text = String(content || '');
  let changed = 0;
  let applied = 0;
  const list = (issues || []).filter((it) => it?.quote);
  for (const it of list) {
    if (!text.includes(it.quote)) changed += 1;
    if (it.fix && text.includes(it.fix)) applied += 1;
  }
  return { total: list.length, changed, applied };
}

/* 中位数：自媒体数据和改稿比例都长尾，平均数没有参考价值 */
export function median(nums) {
  const a = nums.filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return null;
  const i = Math.floor(a.length / 2);
  return a.length % 2 ? a[i] : (a[i - 1] + a[i]) / 2;
}
