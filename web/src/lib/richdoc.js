/* TipTap ↔ 正文存储串：Markdown 子集 + 白名单颜色 span + 同域图片 + IMAGE_MARK。
 * 存储仍是 draft.content 字符串，不是 TipTap JSON。 */
import { IMAGE_MARK } from '../../../shared/place.js';

const IMG_SRC_RE = /^\/image\/\d+\/[\w.-]+$/;
const SPAN_RE = /<span\s+style="color:\s*(#[0-9A-Fa-f]{3,6})\s*"\s*>([\s\S]*?)<\/span>/gi;
const MD_IMG_RE = /!\[([^\]]*)\]\((\/image\/\d+\/[\w.-]+)\)/g;

export function sanitizeColor(c) {
  const s = String(c || '').trim();
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`.toUpperCase();
  }
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toUpperCase();
  return '';
}

export function isSafeImageSrc(src) {
  return IMG_SRC_RE.test(String(src || ''));
}

/* 落库前清洗：去掉非法标签，颜色只留 #RRGGBB，图片只留同域 /image/…
 * IMAGE_MARK 字面量是「<此处放图片>」，必须先保护，否则会被当成标签剥掉。 */
export function sanitizeDoc(src) {
  let s = String(src || '').replace(/\r\n?/g, '\n');
  const kept = [];
  const keep = (html) => {
    kept.push(html);
    return `\uE000${kept.length - 1}\uE001`;
  };
  s = s.split(IMAGE_MARK).join(keep(IMAGE_MARK));
  s = s.replace(SPAN_RE, (_, color, inner) => {
    const c = sanitizeColor(color);
    if (!c) return String(inner || '');
    const body = String(inner || '').replace(/<[^>]+>/g, '');
    return keep(`<span style="color:${c}">${body}</span>`);
  });
  s = s.replace(MD_IMG_RE, (_, alt, url) => {
    if (!isSafeImageSrc(url)) return '';
    return keep(`![${String(alt || '').replace(/[\[\]]/g, '')}](${url})`);
  });
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/\uE000(\d+)\uE001/g, (_, i) => kept[Number(i)] || '');
  s = s.replace(/!\[[^\]]*\]\(\s*(?:data:|javascript:)[^)]*\)/gi, '');
  return s;
}

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inlineToHtml(raw) {
  let s = escHtml(raw);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  return s;
}

function lineToHtml(line) {
  const parts = [];
  let last = 0;
  const re = /<span style="color:(#[0-9A-F]{6})">([\s\S]*?)<\/span>/g;
  let m;
  while ((m = re.exec(line))) {
    if (m.index > last) parts.push(inlineToHtml(line.slice(last, m.index)));
    parts.push(`<span style="color:${m[1]}">${inlineToHtml(m[2])}</span>`);
    last = m.index + m[0].length;
  }
  if (last < line.length) parts.push(inlineToHtml(line.slice(last)));
  return parts.join('').replace(
    /!\[([^\]]*)\]\((\/image\/\d+\/[\w.-]+)\)/g,
    (_, alt, url) => `<img src="${escHtml(url)}" alt="${escHtml(alt)}">`,
  );
}

/* 存储串 → TipTap setContent 用的 HTML */
export function docToHtml(src) {
  const text = sanitizeDoc(src);
  const lines = text.split('\n');
  const out = [];
  let list = null;
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const openList = (tag) => { if (list !== tag) { closeList(); out.push(`<${tag}>`); list = tag; } };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { closeList(); continue; }
    if (line.trim() === IMAGE_MARK) {
      closeList();
      out.push(`<div data-image-mark="">${escHtml(IMAGE_MARK)}</div>`);
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { closeList(); out.push(`<h${h[1].length}>${lineToHtml(h[2])}</h${h[1].length}>`); continue; }
    if (/^(---|\*\*\*|___)\s*$/.test(line)) { closeList(); out.push('<hr>'); continue; }
    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    if (ul) { openList('ul'); out.push(`<li>${lineToHtml(ul[1])}</li>`); continue; }
    const ol = line.match(/^\s*\d+[.、)]\s+(.*)$/);
    if (ol) { openList('ol'); out.push(`<li>${lineToHtml(ol[1])}</li>`); continue; }
    const bq = line.match(/^>\s?(.*)$/);
    if (bq) { closeList(); out.push(`<blockquote><p>${lineToHtml(bq[1])}</p></blockquote>`); continue; }
    closeList();
    out.push(`<p>${lineToHtml(line)}</p>`);
  }
  closeList();
  return out.join('') || '<p></p>';
}

/* 把一段 inline 内容写成存储串，同时往 stream 里推 {ch, pm} */
function emitTextNode(node, basePos, stream) {
  const text = node.text || '';
  const marks = node.marks || [];
  const hasCode = marks.some((m) => m.type.name === 'code');
  const hasBold = marks.some((m) => m.type.name === 'bold');
  const hasItalic = marks.some((m) => m.type.name === 'italic');
  const colorMark = marks.find((m) => m.type.name === 'textStyle' && m.attrs?.color);
  const color = colorMark ? sanitizeColor(colorMark.attrs.color) : '';

  let prefix = '';
  let suffix = '';
  if (hasCode) { prefix = '`'; suffix = '`'; }
  else {
    if (hasBold) { prefix += '**'; suffix = `**${suffix}`; }
    if (hasItalic) { prefix += '*'; suffix = `*${suffix}`; }
  }
  if (color) { prefix = `<span style="color:${color}">${prefix}`; suffix = `${suffix}</span>`; }

  for (const ch of prefix) stream.push({ ch, pm: basePos });
  for (let i = 0; i < text.length; i++) stream.push({ ch: text[i], pm: basePos + i });
  for (const ch of suffix) stream.push({ ch, pm: basePos + text.length });
}

function emitInlineChildren(parent, parentPos, stream) {
  let p = parentPos + 1;
  parent.forEach((child) => {
    if (child.isText) emitTextNode(child, p, stream);
    else if (child.type.name === 'hardBreak') stream.push({ ch: '\n', pm: p });
    else if (child.type.name === 'image') {
      const src = String(child.attrs?.src || '');
      const alt = String(child.attrs?.alt || '').replace(/[\[\]]/g, '');
      if (isSafeImageSrc(src)) {
        const md = `![${alt}](${src})`;
        for (const ch of md) stream.push({ ch, pm: p });
      }
    }
    p += child.nodeSize;
  });
}

function pushStr(stream, str, pm) {
  for (const ch of str) stream.push({ ch, pm });
}

/* ProseMirror doc → 存储串 + 偏移映射 */
export function serializeEditor(editor) {
  const empty = {
    text: '',
    pmToDoc: () => 0,
    docToPm: () => 0,
    pmToDocEnd: () => 0,
    coords: () => null,
  };
  if (!editor) return empty;

  const doc = editor.state.doc;
  const stream = [];
  let first = true;
  const sep = (pm) => {
    if (!first) pushStr(stream, '\n\n', pm);
    first = false;
  };

  doc.forEach((node, offset) => {
    const pos = offset;
    const name = node.type.name;
    if (name === 'paragraph') {
      sep(pos);
      emitInlineChildren(node, pos, stream);
    } else if (name === 'heading') {
      sep(pos);
      const level = Math.min(4, Math.max(1, node.attrs?.level || 1));
      pushStr(stream, `${'#'.repeat(level)} `, pos);
      emitInlineChildren(node, pos, stream);
    } else if (name === 'blockquote') {
      sep(pos);
      let n = 0;
      node.forEach((child, childOff) => {
        if (child.type.name !== 'paragraph') return;
        if (n) pushStr(stream, '\n', pos);
        pushStr(stream, '> ', pos + 1 + childOff);
        emitInlineChildren(child, pos + 1 + childOff, stream);
        n += 1;
      });
    } else if (name === 'bulletList' || name === 'orderedList') {
      sep(pos);
      let i = 1;
      let n = 0;
      node.forEach((li, liOff) => {
        if (n) pushStr(stream, '\n', pos);
        pushStr(stream, name === 'bulletList' ? '- ' : `${i}. `, pos + 1 + liOff);
        li.forEach((child, cOff) => {
          if (child.type.name === 'paragraph') emitInlineChildren(child, pos + 1 + liOff + 1 + cOff, stream);
        });
        i += 1;
        n += 1;
      });
    } else if (name === 'horizontalRule') {
      sep(pos);
      pushStr(stream, '---', pos);
    } else if (name === 'imageMark') {
      sep(pos);
      pushStr(stream, IMAGE_MARK, pos);
    } else if (name === 'image') {
      sep(pos);
      const src = String(node.attrs?.src || '');
      const alt = String(node.attrs?.alt || '').replace(/[\[\]]/g, '');
      if (isSafeImageSrc(src)) pushStr(stream, `![${alt}](${src})`, pos);
    } else {
      sep(pos);
      emitInlineChildren(node, pos, stream);
    }
  });

  const text = stream.map((c) => c.ch).join('');
  const pmFirst = new Map();
  const pmLast = new Map();
  const docToPmArr = new Array(text.length);
  for (let i = 0; i < stream.length; i++) {
    const { pm } = stream[i];
    if (!pmFirst.has(pm)) pmFirst.set(pm, i);
    pmLast.set(pm, i);
    docToPmArr[i] = pm;
  }

  function pmToDoc(pm) {
    if (pmFirst.has(pm)) return pmFirst.get(pm);
    let best = 0;
    let bestDist = Infinity;
    for (const [p, off] of pmFirst) {
      const d = Math.abs(p - pm);
      if (d < bestDist) { bestDist = d; best = off; }
    }
    return best;
  }

  function pmToDocEnd(pm) {
    if (pmLast.has(pm)) return pmLast.get(pm) + 1;
    return pmToDoc(pm);
  }

  function docToPm(off) {
    if (!text.length) return 0;
    const i = Math.max(0, Math.min(off, docToPmArr.length - 1));
    return docToPmArr[i] ?? 0;
  }

  function coords(docOff) {
    try {
      const pm = docToPm(docOff);
      const c = editor.view.coordsAtPos(Math.min(Math.max(0, pm), editor.state.doc.content.size));
      return { top: c.top, left: c.left, bottom: c.bottom };
    } catch {
      return null;
    }
  }

  return { text, pmToDoc, docToPm, pmToDocEnd, coords };
}

export function selectionToDoc(editor) {
  const { text, pmToDoc, pmToDocEnd } = serializeEditor(editor);
  const { from, to } = editor.state.selection;
  const start = pmToDoc(from);
  const end = from === to ? start : Math.max(start, pmToDocEnd(Math.max(from, to - 1)));
  return { start, end, text: text.slice(start, end), doc: text };
}

export { IMAGE_MARK };
