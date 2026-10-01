/* 插图位置。浏览器和导出共用这一份，避免阅读区和 Word 各算各的。 */

export const IMAGE_MARK = '<此处放图片>';

export function markAts(text) {
  const src = String(text || '');
  const out = [];
  let from = 0;
  while (from <= src.length) {
    const at = src.indexOf(IMAGE_MARK, from);
    if (at < 0) break;
    out.push(at);
    from = at + IMAGE_MARK.length;
  }
  return out;
}

/* cuts: { at, skip, item }
   skip > 0 时，[at, at+skip) 是标记本身，渲染时丢掉，图占它的位置。
   skip = 0 时，at 是段末，图插在这一段之后（模型自己挑的位置）。 */
export function placeCuts(text, items) {
  const src = String(text || '');
  const list = Array.isArray(items) ? items : [];
  const marks = markAts(src);
  if (marks.length) {
    return marks.map((at, i) => ({
      at,
      skip: IMAGE_MARK.length,
      item: list[i] || { i, anchor: IMAGE_MARK, prompt: '', alt: '', image: null },
    }));
  }
  return list
    .filter((it) => Number.isFinite(it?.at) && it.at >= 0)
    .map((it) => {
      const anchor = String(it.anchor || '');
      const end = src.indexOf('\n', it.at + anchor.length);
      return { at: end < 0 ? src.length : end, skip: 0, item: it };
    })
    .sort((a, b) => a.at - b.at);
}
