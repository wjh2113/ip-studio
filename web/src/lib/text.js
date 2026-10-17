/* 文本小工具：计字、转义、极简 Markdown、日期格式。
 *
 * 模板里的 {{ }} 会自动转义，平时用不着 esc。只有要拼成 HTML 再交给 v-html 的地方
 * （Markdown 正文、带高亮的口播句子）才先 esc 再加标签——v-html 只能接这里产出的字符串。 */

export const countChars = (s) => String(s || '').replace(/\s/g, '').length;

export const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/* 极简 Markdown：先转义再套标签，够用且安全。
 * 额外认：同域图片 ![](/image/uid/file)、白名单颜色 <span style="color:#RRGGBB"> */
function sanitizeColor(c) {
  const s = String(c || '').trim();
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`.toUpperCase();
  }
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toUpperCase();
  return '';
}

export function markdown(src) {
  const tokens = [];
  const keep = (html) => {
    tokens.push(html);
    return `\u0000${tokens.length - 1}\u0000`;
  };
  let prepared = String(src || '');
  prepared = prepared.replace(/!\[([^\]]*)\]\((\/image\/\d+\/[\w.-]+)\)/g, (_, alt, url) => keep(
    `<img src="${esc(url)}" alt="${esc(alt)}" class="doc-img" loading="lazy" />`,
  ));
  prepared = prepared.replace(
    /<span\s+style="color:\s*(#[0-9A-Fa-f]{3,6})\s*"\s*>([\s\S]*?)<\/span>/gi,
    (_, color, inner) => {
      const c = sanitizeColor(color);
      const body = String(inner || '').replace(/<[^>]+>/g, '');
      if (!c) return body;
      return `\u0001COLOR:${c}:${body}\u0001`;
    },
  );

  const lines = esc(prepared).split('\n');
  const out = [];
  let list = null;

  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const openList = (tag) => { if (list !== tag) { closeList(); out.push(`<${tag}>`); list = tag; } };

  /* esc 之后颜色占位里的正文已转义，只需套 inline，不要再 esc */
  const restore = (s) => s
    .replace(/\u0000(\d+)\u0000/g, (_, i) => tokens[Number(i)] || '')
    .replace(/\u0001COLOR:(#[0-9A-F]{6}):([\s\S]*?)\u0001/g, (_, c, inner) => (
      `<span style="color:${c}">${inline(inner)}</span>`
    ));

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { closeList(); continue; }

    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { closeList(); const n = h[1].length; out.push(`<h${n}>${restore(inline(h[2]))}</h${n}>`); continue; }

    if (/^(---|\*\*\*|___)\s*$/.test(line)) { closeList(); out.push('<hr />'); continue; }

    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    if (ul) { openList('ul'); out.push(`<li>${restore(inline(ul[1]))}</li>`); continue; }

    const ol = line.match(/^\s*\d+[.、)]\s+(.*)$/);
    if (ol) { openList('ol'); out.push(`<li>${restore(inline(ol[1]))}</li>`); continue; }

    const bq = line.match(/^&gt;\s?(.*)$/);
    if (bq) { closeList(); out.push(`<blockquote>${restore(inline(bq[1]))}</blockquote>`); continue; }

    closeList();
    out.push(`<p>${restore(inline(line))}</p>`);
  }
  closeList();
  return out.join('');
}

const inline = (s) => s
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');

/* 把要重读的词标出来（先转义再替换，避免把标签打散） */
export function highlightStress(quote, stress = []) {
  let html = esc(quote);
  for (const word of stress || []) {
    const safe = esc(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (safe) html = html.replace(new RegExp(safe, 'g'), (m) => `<mark>${m}</mark>`);
  }
  return html;
}

const pad = (n) => String(n).padStart(2, '0');

/* 2026-10-01 08:30 */
export function stamp(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* 08:30 */
export function clock(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* 本地日期（不是 UTC）：晚上 11 点填的数不该记到明天 */
export function localDay(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/* 文件名里不能有的字符去掉，截到 40 字 */
export const safeName = (s) => String(s || '').slice(0, 40).replace(/[\\/:*?"<>|]/g, '');
