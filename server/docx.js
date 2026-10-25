/* 最小的 .docx：无压缩 zip + 一段 WordprocessingML。只嵌 png / jpeg。 */

import { crc32 } from 'node:zlib';
import { placeCuts } from '../shared/place.js';
import { normalizeTables, readTable } from '../shared/tables.js';

const xml = (s) => String(s ?? '')
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  .replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function zipStore(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name);
    const data = f.data;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc >>> 0, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, data);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0, 10);
    cen.writeUInt32LE(crc >>> 0, 16);
    cen.writeUInt32LE(data.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, name);
    offset += local.length + name.length + data.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, centralBuf, end]);
}

function imagePx(buf) {
  if (buf.length > 24 && buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 8) {
      if (buf[i] !== 0xff) { i += 1; continue; }
      const marker = buf[i + 1];
      if (marker === 0xd8 || marker === 0xd9) { i += 2; continue; }
      if (i + 4 > buf.length) break;
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xc3 && i + 9 < buf.length) {
        return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  }
  return { w: 1280, h: 720 };
}

function emuSize(px) {
  const maxW = 5400000;
  let cx = Math.max(1, px.w) * 9525;
  let cy = Math.max(1, px.h) * 9525;
  if (cx > maxW) {
    cy = Math.round(cy * (maxW / cx));
    cx = maxW;
  }
  return { cx, cy };
}

function wordColor(c) {
  let s = String(c || '').replace('#', '');
  if (/^[0-9A-Fa-f]{3}$/.test(s)) s = s.split('').map((ch) => ch + ch).join('');
  return /^[0-9A-Fa-f]{6}$/.test(s) ? s.toUpperCase() : '';
}

function runXml(text, { bold = false, italic = false, strike = false, size = 21, color = '' } = {}) {
  if (!text) return '';
  const rPr = `${bold ? '<w:b/>' : ''}${italic ? '<w:i/>' : ''}${strike ? '<w:strike/>' : ''}<w:sz w:val="${size}"/>${color ? `<w:color w:val="${color}"/>` : ''}`;
  return `<w:r><w:rPr>${rPr}</w:rPr><w:t xml:space="preserve">${xml(text)}</w:t></w:r>`;
}

/* 加粗、斜体、删除线、颜色可以套在一起。颜色 span 里的 ** 仍是加粗，不把标签写进 Word */
function runs(text, opt = {}) {
  const src = String(text || '');
  const bits = [];
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    const span = rest.match(/^<span\s+style="color:\s*(#[0-9A-Fa-f]{3,6})\s*"\s*>([\s\S]*?)<\/span>/i);
    if (span) {
      bits.push(runs(span[2], { ...opt, color: wordColor(span[1]) || opt.color || '' }));
      i += span[0].length;
      continue;
    }
    const bold = rest.match(/^\*\*([\s\S]+?)\*\*/);
    if (bold) {
      bits.push(runs(bold[1], { ...opt, bold: true }));
      i += bold[0].length;
      continue;
    }
    const strike = rest.match(/^~~([\s\S]+?)~~/);
    if (strike) {
      bits.push(runs(strike[1], { ...opt, strike: true }));
      i += strike[0].length;
      continue;
    }
    const italic = rest.match(/^\*([^*\n]+)\*/);
    if (italic) {
      bits.push(runs(italic[1], { ...opt, italic: true }));
      i += italic[0].length;
      continue;
    }
    const next = rest.slice(1).search(/<span\s+style="color:|\*\*|~~|\*/i);
    const take = next < 0 ? rest.length : next + 1;
    bits.push(runXml(rest.slice(0, take), opt));
    i += take;
  }
  return bits.join('');
}

function paragraph(text, opt = {}) {
  const heading = /^#{1,4}\s+/.test(text);
  const body = heading ? text.replace(/^#{1,4}\s+/, '') : text;
  const align = opt.center ? '<w:jc w:val="center"/>' : '';
  const inner = runs(body, {
    bold: heading || opt.bold,
    size: heading ? 32 : (opt.size || 21),
    color: opt.color || '',
  });
  return `<w:p><w:pPr>${align}</w:pPr>${inner || '<w:r><w:t></w:t></w:r>'}</w:p>`;
}

/* Markdown 表格 → Word 表格：细灰边框、表头加粗带底色，列宽按页面可用宽度平分 */
const PAGE_W = 11906 - 1134 * 2;
function tableXml(t) {
  const n = Math.max(1, t.header.length);
  const w = Math.floor(PAGE_W / n);
  const border = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((k) => `<w:${k} w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>`).join('');
  const jc = (a) => (a === 'center' ? '<w:jc w:val="center"/>' : a === 'right' ? '<w:jc w:val="right"/>' : '');
  const tc = (text, k, head) => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${head ? '<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>' : ''}</w:tcPr>`
    + `<w:p><w:pPr><w:spacing w:before="40" w:after="40"/>${jc(t.align[k])}</w:pPr>${runs(text, { bold: head, size: 20 }) || '<w:r><w:t></w:t></w:r>'}</w:p></w:tc>`;
  const tr = (cells, head) => `<w:tr>${head ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${Array.from({ length: n }, (_, k) => tc(cells[k] || '', k, head)).join('')}</w:tr>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="${w * n}" w:type="dxa"/><w:tblBorders>${border}</w:tblBorders>`
    + '<w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr>'
    + `<w:tblGrid>${'<w:gridCol w:w="' + w + '"/>'.repeat(n)}</w:tblGrid>${tr(t.header, true)}${t.rows.map((r) => tr(r, false)).join('')}</w:tbl>`;
}

function blocks(text) {
  return String(text || '').replace(/\r\n/g, '\n').split(/\n{2,}/)
    .map((s) => s.trim()).filter(Boolean);
}

function drawing(id, rel, name, px) {
  const { cx, cy } = emuSize(px);
  return `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">
    <wp:extent cx="${cx}" cy="${cy}"/>
    <wp:effectExtent l="0" t="0" r="0" b="0"/>
    <wp:docPr id="${id}" name="${xml(name)}"/>
    <wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>
    <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
        <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
          <pic:nvPicPr><pic:cNvPr id="${id}" name="${xml(name)}"/><pic:cNvPicPr/></pic:nvPicPr>
          <pic:blipFill><a:blip r:embed="${rel}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
          <pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>
            <a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>
        </pic:pic>
      </a:graphicData>
    </a:graphic>
  </wp:inline></w:drawing></w:r></w:p>`;
}

function extOf(file) {
  const m = String(file || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}

export async function buildDocx({ title, text, items, readImage }) {
  const cuts = placeCuts(text, items);
  const media = [];
  const rels = [];
  let n = 0;
  const parts = [];
  if (title) parts.push(paragraph(title, { bold: true, size: 36 }));

  const embedFile = async (file, alt) => {
    const ext = extOf(file);
    const buf = file && (ext === 'png' || ext === 'jpg' || ext === 'jpeg') ? await readImage(file) : null;
    if (buf?.length) {
      n += 1;
      const use = ext === 'png' ? 'png' : 'jpeg';
      const name = `image${n}.${use === 'png' ? 'png' : 'jpg'}`;
      media.push({ name, data: buf, use });
      rels.push({ id: `rId${n}`, name });
      parts.push(drawing(n, `rId${n}`, name, imagePx(buf)));
      if (alt) parts.push(paragraph(alt, { center: true, size: 18, color: '888888' }));
      return;
    }
    parts.push(paragraph(file ? '（这张图的格式写不进 Word）' : '（此处配图还没出）', { center: true, size: 18, color: '888888' }));
  };

  const emitLine = async (line) => {
    const imgRe = /!\[([^\]]*)\]\((\/image\/(\d+)\/([\w.-]+))\)/g;
    let last = 0;
    let m = imgRe.exec(line);
    while (m) {
      if (m.index > last) parts.push(paragraph(line.slice(last, m.index)));
      await embedFile(`${m[3]}/${m[4]}`, m[1]);
      last = m.index + m[0].length;
      m = imgRe.exec(line);
    }
    const rest = line.slice(last);
    if (!rest.trim() && last) return;
    if (!rest.trim()) return;
    let body = rest.trim();
    const ul = body.match(/^[-*+]\s+(.*)$/);
    const ol = body.match(/^(\d+)[.、)]\s+(.*)$/);
    const bq = body.match(/^>\s?(.*)$/);
    if (ul) body = ul[1];
    else if (ol) body = `${ol[1]}. ${ol[2]}`;
    else if (bq) body = bq[1];
    parts.push(paragraph(body));
  };

  const emitText = async (chunk) => {
    // 以前粘坏的表格（行间有空行）先合回去，再按块输出；块里认到表格就输出成 Word 表格
    for (const block of blocks(normalizeTables(chunk))) {
      const lines = block.split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        const t = readTable(lines, i);
        if (t) {
          parts.push(tableXml(t));
          parts.push(paragraph(''));          // 表后留一个空段，Word 才不会把下一段贴在表格上
          i = t.end - 1;
          continue;
        }
        await emitLine(lines[i]);
      }
    }
  };

  let from = 0;
  const src = String(text || '');
  for (const c of cuts) {
    await emitText(src.slice(from, c.at));
    from = c.at + (c.skip || 0);
    const file = c.item?.image?.file;
    if (file) await embedFile(file, c.item.alt || '');
    else if (c.item) parts.push(paragraph('（此处配图还没出）', { center: true, size: 18, color: '888888' }));
  }
  await emitText(src.slice(from));
  if (!parts.length) parts.push(paragraph(''));

  const body = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
 xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
 xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
 xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
<w:body>${parts.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`;

  const used = new Set(media.map((m) => (m.use === 'png' ? 'png' : 'jpg')));
  const defaults = [...used].map((e) => (
    e === 'png'
      ? '<Default Extension="png" ContentType="image/png"/>'
      : '<Default Extension="jpg" ContentType="image/jpeg"/>'
  )).join('');

  const files = [
    { name: '[Content_Types].xml', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
${defaults}
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`) },
    { name: '_rels/.rels', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdDoc" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`) },
    { name: 'word/document.xml', data: Buffer.from(body) },
    { name: 'word/_rels/document.xml.rels', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${rels.map((r) => `<Relationship Id="${r.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${r.name}"/>`).join('')}
</Relationships>`) },
    ...media.map((m) => ({ name: `word/media/${m.name}`, data: m.data })),
  ];
  return zipStore(files);
}
