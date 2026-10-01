/* 文本小工具：计字、极简 Markdown（给 rich-text 用）、纯文本、日期。和网页端 lib/text.js 同一套规则 */

export const countChars = (s) => String(s || '').replace(/\s/g, '').length;

export const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const IMAGE_MARK = '<此处放图片>';

const inline = (s) => s
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');

/* 先转义再套标签：rich-text 只接这里产出的字符串。class 名给阅读页样式用 */
export function markdown(src, { highlight = -1 } = {}) {
  const lines = String(src || '').split('\n').filter((l) => l.trim() !== IMAGE_MARK);
  const out = [];
  let list = null;
  let para = -1;
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const openList = (tag) => { if (list !== tag) { closeList(); out.push(`<${tag} class="md-${tag}">`); list = tag; } };
  for (const raw of lines) {
    const line = esc(raw.trimEnd());
    if (!line.trim()) { closeList(); continue; }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { closeList(); const n = Math.min(h[1].length + 1, 4); out.push(`<h${n} class="md-h${n}">${inline(h[2])}</h${n}>`); continue; }
    if (/^(---|\*\*\*|___)\s*$/.test(line)) { closeList(); out.push('<hr class="md-hr"/>'); continue; }
    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    if (ul) { openList('ul'); out.push(`<li class="md-li">${inline(ul[1])}</li>`); continue; }
    const ol = line.match(/^\s*\d+[.、)]\s+(.*)$/);
    if (ol) { openList('ol'); out.push(`<li class="md-li">${inline(ol[1])}</li>`); continue; }
    closeList();
    para += 1;
    out.push(`<p class="md-p${para === highlight ? ' md-on' : ''}">${inline(line.replace(/^&gt;\s?/, ''))}</p>`);
  }
  closeList();
  return out.join('');
}

/* 正文按段切开（阅读页点段落改写、语音改稿选段用）。和 markdown() 里的段落计数一致：标题、列表不算段 */
export function paragraphs(src) {
  return String(src || '').split('\n').map((l) => l.trim())
    .filter((l) => l && l !== IMAGE_MARK && !/^#{1,4}\s/.test(l) && !/^(---|\*\*\*|___)$/.test(l) && !/^[-*+]\s/.test(l) && !/^\d+[.、)]\s/.test(l));
}

/* 把要重读的词标出来 */
export function highlightStress(quote, stress = []) {
  let html = esc(quote);
  for (const word of stress || []) {
    const safe = esc(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (safe) html = html.replace(new RegExp(safe, 'g'), (m) => `<span class="stress">${m}</span>`);
  }
  return html;
}

const pad = (n) => String(n).padStart(2, '0');

export function stamp(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function clock(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* 本地日期（不是 UTC）：晚上 11 点填的数不该记到明天 */
export function localDay(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(day, n) {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + n);
  return localDay(d);
}

/* 这一周的周一 */
export function mondayOf(day = localDay()) {
  const d = new Date(`${day}T12:00:00`);
  const w = (d.getDay() + 6) % 7;
  return addDays(day, -w);
}

export const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

/* 「今天 10:21」「昨天」「9-28」 */
export function ago(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = localDay(d);
  if (day === localDay()) return `今天 ${clock(iso)}`;
  if (day === addDays(localDay(), -1)) return '昨天';
  return `${d.getMonth() + 1}-${pad(d.getDate())}`;
}

/* 随机 key（离线队列的幂等键） */
export function rid(n = 16) {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < n; i += 1) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}

/* 正文切成块，带在原文里的位置：阅读页一块一块渲染，点哪块改哪块，改完按位置写回原文 */
export function blocks(src) {
  const raw = String(src || '');
  const out = [];
  let pos = 0;
  for (const line of raw.split('\n')) {
    const start = pos;
    pos += line.length + 1;
    const t = line.trim();
    if (!t || t === IMAGE_MARK) continue;
    let type = 'p';
    let text = t;
    let m;
    if ((m = t.match(/^(#{1,4})\s+(.*)$/))) { type = `h${Math.min(m[1].length + 1, 4)}`; text = m[2]; }
    else if (/^(---|\*\*\*|___)$/.test(t)) { type = 'hr'; text = ''; }
    else if ((m = t.match(/^[-*+]\s+(.*)$/))) { type = 'li'; text = m[1]; }
    else if ((m = t.match(/^(\d+)[.、)]\s+(.*)$/))) { type = 'oli'; text = `${m[1]}. ${m[2]}`; }
    else if ((m = t.match(/^>\s?(.*)$/))) { type = 'quote'; text = m[1]; }
    text = text.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1');
    out.push({ type, text, start, end: start + line.length, raw: line });
  }
  return out;
}

/* 文首的 # 标题（成稿第一行通常是标题，阅读页单独显示，正文里不再重复） */
export function splitTitle(src) {
  const raw = String(src || '');
  const m = raw.match(/^\s*#\s+(.+)\n?/);
  return m ? { title: m[1].trim(), offset: m[0].length } : { title: '', offset: 0 };
}
