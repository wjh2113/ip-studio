/* textarea 里的光标坐标。textarea 不给字符级的位置，只能用一个同款式的镜像元素量出来。 */

const MIRROR_PROPS = ['boxSizing', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'wordSpacing',
  'textIndent', 'tabSize', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'];

function mirrorOf(ta) {
  const cs = getComputedStyle(ta);
  const m = document.createElement('div');
  MIRROR_PROPS.forEach((k) => { m.style[k] = cs[k]; });
  Object.assign(m.style, {
    position: 'absolute', top: '0', left: '0', visibility: 'hidden', overflow: 'hidden',
    whiteSpace: 'pre-wrap', overflowWrap: 'break-word', width: `${ta.clientWidth}px`,
  });
  document.body.appendChild(m);
  return { m, cs };
}

/* 第 index 个字符在屏幕上的位置：{ top, left, bottom } */
export function caretRect(ta, index) {
  const { m, cs } = mirrorOf(ta);
  m.textContent = ta.value.slice(0, index);
  const marker = document.createElement('span');
  marker.textContent = ta.value.slice(index) || '.';
  m.appendChild(marker);
  const box = ta.getBoundingClientRect();
  const top = box.top + marker.offsetTop - ta.scrollTop;
  const left = box.left + marker.offsetLeft - ta.scrollLeft;
  m.remove();
  return { top, left, bottom: top + (parseFloat(cs.lineHeight) || 22) };
}

/* 屏幕上某一点落在 textarea 的第几个字符（拖标签进正文时用）。点在框外返回 null */
export function caretFromPoint(ta, x, y) {
  const direct = document.caretPositionFromPoint?.(x, y);
  if (direct && direct.offsetNode === ta) return direct.offset;
  const range = document.caretRangeFromPoint?.(x, y);
  if (range && range.startContainer === ta) return range.startOffset;

  const rect = ta.getBoundingClientRect();
  if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return null;
  const { m, cs } = mirrorOf(ta);
  const localX = x - rect.left - parseFloat(cs.borderLeftWidth) + ta.scrollLeft;
  const localY = y - rect.top - parseFloat(cs.borderTopWidth) + ta.scrollTop;
  const text = ta.value;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    m.textContent = text.slice(0, mid);
    const span = document.createElement('span');
    span.textContent = text[mid] || ' ';
    m.appendChild(span);
    const top = span.offsetTop;
    const left = span.offsetLeft;
    const w = span.offsetWidth || 8;
    const h = span.offsetHeight || parseFloat(cs.lineHeight) || 20;
    span.remove();
    if (top + h < localY || (top <= localY && top + h >= localY && left + w <= localX)) lo = mid + 1;
    else hi = mid;
  }
  m.remove();
  return lo;
}

/* 浮动菜单放在锚点下面；下面放不下就放上面，左右不出屏 */
export function placeNear(node, point) {
  const box = node.getBoundingClientRect();
  const left = Math.min(Math.max(8, point.left), window.innerWidth - box.width - 8);
  const below = window.innerHeight - point.bottom;
  const top = below > box.height + 12 ? point.bottom + 6 : point.top - box.height - 6;
  // 锚点在视口外（长文没跟着滚）也要让菜单露在屏幕里
  return { left: `${left}px`, top: `${Math.max(8, Math.min(top, window.innerHeight - box.height - 8))}px` };
}
