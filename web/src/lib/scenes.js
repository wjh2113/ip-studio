/* 脚本里的拍摄标注（【画面】【字幕】【转场】……）不念，所以不进口播提示；但拍的时候要看。
 * 按它在稿子里的位置挂到后面那一段口播上：before[i] 是第 i 段之前的标注，最后一段之后的放 tail。
 * 纯函数，口播区、提词器、复制口播稿共用。 */
const SCENE = /^[ \t]*【(画面提示|画面|字幕|转场|镜头|BGM|音效)】[ \t]*(.*)$/gim;

export function sceneNotes(text, cues) {
  const list = Array.isArray(cues) ? cues : [];
  const src = String(text || '');
  const out = { before: list.map(() => []), tail: [] };
  if (!list.length || !src.includes('【')) return out;
  const starts = [];
  let from = 0;
  for (const c of list) {
    const at = src.indexOf(c.quote, from);
    starts.push(at);
    if (at >= 0) from = at + c.quote.length;
  }
  for (const m of src.matchAll(SCENE)) {
    if (!m[2].trim()) continue;
    const item = { tag: m[1], text: m[2].trim() };
    const i = starts.findIndex((st) => st > m.index);
    (i >= 0 ? out.before[i] : out.tail).push(item);
  }
  return out;
}
