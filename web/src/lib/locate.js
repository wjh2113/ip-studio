/* 在正文里定位一句话：检查结果、AI 味提示点一下，左边原文滚到那里并高亮。
 *
 * 阅读态的正文是 Markdown 渲染出来的 HTML，提示里引用的是 Markdown 原文（可能带 ** # 这些符号、换行），
 * 所以两边都去掉空白和 Markdown 符号再比，比中了再映射回 DOM 里的文字节点。
 * 高亮用 CSS Custom Highlight API（不改 DOM，v-html 重渲染也不会被弄乱）；浏览器不支持就退回成选中。 */

const SKIP = /[\s*_`#>~|]/;

/* 去掉空白和 Markdown 符号后的文字 */
export const squash = (t) => [...String(t || '')].filter((ch) => !SKIP.test(ch)).join('');

const HL = 'locate';
let clearTimer = 0;

function highlight(range) {
  clearTimeout(clearTimer);
  const hl = typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight === 'function';
  if (hl) {
    CSS.highlights.set(HL, new Highlight(range));
    clearTimer = setTimeout(() => CSS.highlights.delete(HL), 6000);
  } else {
    const sel = window.getSelection?.();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }
}

export function clearLocate() {
  clearTimeout(clearTimer);
  if (typeof CSS !== 'undefined' && CSS.highlights) CSS.highlights.delete(HL);
}

/* 阅读态：在 root 里找 quote，找到就滚过去高亮，返回 true */
export function locateInArticle(root, quote) {
  const want = squash(quote);
  if (!root || !want) return false;
  const map = [];      // 第 i 个有效字符在哪个文字节点的第几位
  let flat = '';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.nodeValue;
    for (let i = 0; i < t.length; i += 1) {
      if (SKIP.test(t[i])) continue;
      flat += t[i];
      map.push([n, i]);
    }
  }
  const at = flat.indexOf(want);
  if (at < 0) return false;
  const [sn, so] = map[at];
  const [en, eo] = map[at + want.length - 1];
  const range = document.createRange();
  range.setStart(sn, so);
  range.setEnd(en, eo + 1);
  const el = sn.parentElement;
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  highlight(range);
  return true;
}

/* 编辑态：textarea 里选中这一句并滚过去（先精确找，找不到再按去掉符号的方式找） */
export function locateInTextarea(ta, quote, caretRect) {
  if (!ta || !quote) return false;
  const text = ta.value;
  let start = text.indexOf(quote);
  let end = start + quote.length;
  if (start < 0) {
    const want = squash(quote);
    const idx = [];
    let flat = '';
    for (let i = 0; i < text.length; i += 1) {
      if (SKIP.test(text[i])) continue;
      flat += text[i];
      idx.push(i);
    }
    const at = want ? flat.indexOf(want) : -1;
    if (at < 0) return false;
    start = idx[at];
    end = idx[at + want.length - 1] + 1;
  }
  ta.focus({ preventScroll: true });
  ta.setSelectionRange(start, end);
  if (caretRect) {
    // 框里滚到这一句，再把页面滚到能看见它
    const box = ta.getBoundingClientRect();
    const off = caretRect(ta, start).top - box.top + ta.scrollTop;
    ta.scrollTop = Math.max(0, off - ta.clientHeight / 3);
    const top = caretRect(ta, start).top;
    if (top < 80 || top > window.innerHeight - 80) window.scrollBy({ top: top - window.innerHeight / 3, behavior: 'smooth' });
  }
  return true;
}
