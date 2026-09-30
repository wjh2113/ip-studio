/* 改稿保存时，按新正文留下还能对上的口播提示和配图。
   多平台版本不在这里动：正文长度变了，版本页自己标「需重做」。 */

import { IMAGE_MARK, markAts } from '../public/place.js';

export function rebindCues(text, cues) {
  const src = String(text ?? '');
  if (!cues?.cues?.length) return { cues: cues || null, dropped: 0 };
  const kept = cues.cues.filter((c) => {
    const quote = String(c?.quote || '');
    return quote.trim() && src.includes(quote);
  });
  const dropped = cues.cues.length - kept.length;
  if (!kept.length) return { cues: null, dropped };
  const covered = kept.reduce((n, c) => n + String(c.quote || '').length, 0);
  const next = {
    ...cues,
    cues: kept,
    coverage: src.length ? Math.min(100, Math.round((covered / src.length) * 100)) : 0,
  };
  if (dropped) next.trimmed = dropped;
  else delete next.trimmed;
  return { cues: next, dropped };
}

/* 原文配图在 __main__。有 <此处放图片> 就按标记顺序对位；没有就只留锚点还在的自动位置。 */
export function rebindIllus(text, illus) {
  if (!illus || typeof illus !== 'object') return { illus: null, dropped: 0 };
  const main = illus.__main__;
  if (!main?.items?.length) return { illus, dropped: 0 };

  const src = String(text ?? '');
  const marks = markAts(src).slice(0, 8);
  let items;
  let placed;
  if (marks.length) {
    placed = 'mark';
    const n = Math.min(marks.length, main.items.length);
    items = [];
    for (let i = 0; i < n; i++) {
      items.push({ ...main.items[i], anchor: IMAGE_MARK, at: marks[i], i });
    }
  } else {
    placed = 'auto';
    items = [];
    for (const it of main.items) {
      const anchor = String(it?.anchor || '').trim();
      if (!anchor || anchor === IMAGE_MARK) continue;
      const at = src.indexOf(anchor);
      if (at < 0) continue;
      items.push({ ...it, anchor, at, i: items.length });
    }
  }

  const dropped = main.items.length - items.length;
  const next = { ...illus };
  if (!items.length) delete next.__main__;
  else next.__main__ = { ...main, placed, items, dropped };
  return { illus: Object.keys(next).length ? next : null, dropped };
}
