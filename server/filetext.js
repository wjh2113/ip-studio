/* 从 Word（.docx）和 PDF 里取出正文文字。不加依赖：.docx 是 zip + XML，用 Node 自带的 zlib 解；
 * PDF 自己解析对象、解压内容流、按字体的 ToUnicode 表把字形编码翻回文字。
 *
 *   extractText(buffer, filename) → { kind, title, text, pages?, warnings[] }
 *
 * 能读的：Word 2007 以后的 .docx（WPS 存的也是）；Word / WPS / 浏览器「另存为 PDF」、排版软件导出的文字型 PDF，
 *         包括中文常见的 Identity-H + ToUnicode、UniGB-UCS2、GBK 编码。
 * 读不了的（直接告诉用户怎么办，不猜）：老的 .doc、加密的 PDF、扫描件 / 图片 PDF（没有文字层）。
 *
 * 文件是用户上传的，解析时处处设上限：解压后大小、对象数、递归深度，坏文件只会报错，不会把进程拖死。
 */
import { createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { inflateRawSync, inflateSync, constants as zc } from 'node:zlib';

/* 不引 auth.js（那会连上数据库）：自带一个带状态码的错误，路由层按 err.status 回给前端 */
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export const MAX_FILE = 15 * 1024 * 1024;
const MAX_INFLATE = 60 * 1024 * 1024;
const MAX_TEXT = 200_000;

export function extractText(buffer, filename = '') {
  const name = String(filename || '').toLowerCase();
  if (!buffer?.length) throw new HttpError(400, '文件是空的');
  if (buffer.length > MAX_FILE) throw new HttpError(413, '文件请小于 15MB');
  const head = buffer.subarray(0, 8);
  if (head.subarray(0, 4).toString('latin1') === '%PDF' || (name.endsWith('.pdf') && buffer.includes('%PDF'))) return pdfText(buffer);
  if (head[0] === 0x50 && head[1] === 0x4b) return docxText(buffer);
  if (head.readUInt32BE(0) === 0xd0cf11e0) throw new HttpError(400, '这是老版 Word（.doc），请在 Word 或 WPS 里另存为 .docx 再上传');
  if (/\.(md|markdown|txt)$/.test(name)) {
    const text = buffer.toString('utf8').replace(/\r\n?/g, '\n');
    return { kind: 'text', title: '', text: text.slice(0, MAX_TEXT), warnings: [] };
  }
  throw new HttpError(400, '只支持 .docx、.pdf、.md、.txt');
}

/* ================================================================
 * ZIP
 * ================================================================ */
export function unzip(buf, want = () => true) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new HttpError(400, '文件不是有效的 .docx（压缩包损坏）');
  const total = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  let used = 0;
  for (let n = 0; n < total && p + 46 <= buf.length; n += 1) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString('utf8');
    p += 46 + nlen + elen + clen;
    if (!want(name) || lho + 30 > buf.length || buf.readUInt32LE(lho) !== 0x04034b50) continue;
    const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    const raw = buf.subarray(start, start + csize);
    let data;
    if (method === 0) data = raw;
    else if (method === 8) data = inflateRawSync(raw, { maxOutputLength: MAX_INFLATE - used });
    else continue;
    used += data.length;
    out.set(name, data);
  }
  return out;
}

/* ================================================================
 * DOCX
 * ================================================================ */
const decodeXml = (s) => s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, e) => {
  const k = e.toLowerCase();
  if (k === 'lt') return '<';
  if (k === 'gt') return '>';
  if (k === 'amp') return '&';
  if (k === 'quot') return '"';
  if (k === 'apos') return "'";
  const code = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
  return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
});

function docxText(buf) {
  let files;
  try {
    files = unzip(buf, (n) => ['word/document.xml', 'word/styles.xml', 'docProps/core.xml'].includes(n));
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, `.docx 解不开：${err.message}`);
  }
  const doc = files.get('word/document.xml')?.toString('utf8');
  if (!doc) throw new HttpError(400, '这个压缩包里没有 Word 正文（不是 .docx？）');

  // 样式 id → 标题级别。中文 Word 的「标题 1」样式 id 常常就是 "1"，只能看样式名
  const levels = new Map();
  const styles = files.get('word/styles.xml')?.toString('utf8') || '';
  for (const m of styles.matchAll(/<w:style\b[^>]*w:styleId="([^"]+)"[^>]*>([\s\S]*?)<\/w:style>/g)) {
    const nm = m[2].match(/<w:name w:val="([^"]+)"/)?.[1] || '';
    const h = nm.match(/^heading\s*(\d)$/i) || nm.match(/^标题\s*(\d)$/);
    if (h) levels.set(m[1], Math.min(6, Number(h[1])));
    else if (/^(title|标题)$/i.test(nm)) levels.set(m[1], 1);
  }

  const body = doc.slice(doc.indexOf('<w:body'));
  const paras = [];
  let cur = null;
  const re = /<w:p(?=[\s>/])([^>]*?)(\/?)>|<\/w:p>|<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\b[^>]*\/>|<w:cr\/>|<w:pStyle w:val="([^"]+)"|<w:numPr>/g;
  for (const m of body.matchAll(re)) {
    const tag = m[0];
    if (tag.startsWith('<w:p') && !tag.startsWith('<w:pStyle')) {
      if (m[2] === '/') { paras.push({ text: '', level: 0, list: false }); continue; }
      cur = { text: '', level: 0, list: false };
    } else if (tag === '</w:p>') {
      if (cur) paras.push(cur);
      cur = null;
    } else if (!cur) {
      continue;
    } else if (m[3] !== undefined) {
      cur.text += decodeXml(m[3]);
    } else if (tag === '<w:tab/>') {
      cur.text += '\t';
    } else if (tag.startsWith('<w:br') || tag === '<w:cr/>') {
      if (!/w:type="page"/.test(tag)) cur.text += '\n';
    } else if (m[4]) {
      cur.level = levels.get(m[4]) || (/^(heading|标题)\s*(\d)$/i.test(m[4]) ? Number(m[4].match(/\d/)[0]) : 0);
    } else if (tag === '<w:numPr>') {
      cur.list = true;
    }
  }

  const core = files.get('docProps/core.xml')?.toString('utf8') || '';
  let title = decodeXml(core.match(/<dc:title>([^<]*)<\/dc:title>/)?.[1] || '').trim();
  const lines = [];
  for (const p of paras) {
    const t = p.text.replace(/[ \t　]+$/g, '').replace(/^\s+$/, '');
    if (!t) { if (lines.length && lines.at(-1) !== '') lines.push(''); continue; }
    if (p.level) {
      if (!title && p.level === 1 && !lines.some(Boolean)) { title = t.trim(); continue; }
      lines.push(`${'#'.repeat(Math.max(2, p.level))} ${t.trim()}`, '');
    } else if (p.list) {
      lines.push(`- ${t.trim()}`, null);
    } else {
      if (lines.length && lines.at(-1) === null) lines.push('');      // 列表后面接正文，空一行
      lines.push(t, '');
    }
  }
  let text = lines.filter((l) => l !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!title) {
    const first = text.split('\n')[0] || '';
    if (first && first.length <= 40 && !/[。！？.!?]$/.test(first)) { title = first.replace(/^#+\s*/, ''); text = text.slice(first.length).trim(); }
  }
  if (!text) throw new HttpError(400, '这个 Word 里没有读到文字');
  return { kind: 'docx', title: title.slice(0, 120), text: text.slice(0, MAX_TEXT), warnings: [] };
}

/* ================================================================
 * PDF：词法 → 对象 → 页面 → 内容流 → 文字
 * ================================================================ */
const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set('()<>[]{}/%'.split('').map((c) => c.charCodeAt(0)));

class Lexer {
  constructor(buf, pos = 0) { this.b = buf; this.p = pos; }

  skip() {
    const b = this.b;
    while (this.p < b.length) {
      const c = b[this.p];
      if (WS.has(c)) { this.p += 1; continue; }
      if (c === 37) { while (this.p < b.length && b[this.p] !== 10 && b[this.p] !== 13) this.p += 1; continue; }
      break;
    }
  }

  /* 下一个记号：{t:'num'|'name'|'str'|'kw'|'['|']'|'<<'|'>>', v} 或 null */
  next() {
    this.skip();
    const b = this.b;
    if (this.p >= b.length) return null;
    const c = b[this.p];
    if (c === 91) { this.p += 1; return { t: '[' }; }
    if (c === 93) { this.p += 1; return { t: ']' }; }
    if (c === 60 && b[this.p + 1] === 60) { this.p += 2; return { t: '<<' }; }
    if (c === 62 && b[this.p + 1] === 62) { this.p += 2; return { t: '>>' }; }
    if (c === 40) return { t: 'str', v: this.literal() };
    if (c === 60) return { t: 'str', v: this.hex() };
    if (c === 47) {
      this.p += 1;
      const s = this.p;
      while (this.p < b.length && !WS.has(b[this.p]) && !DELIM.has(b[this.p])) this.p += 1;
      const raw = b.subarray(s, this.p).toString('latin1').replace(/#([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
      return { t: 'name', v: raw };
    }
    if (c === 123 || c === 125) { this.p += 1; return { t: 'kw', v: String.fromCharCode(c) }; }
    const s = this.p;
    while (this.p < b.length && !WS.has(b[this.p]) && !DELIM.has(b[this.p])) this.p += 1;
    if (this.p === s) { this.p += 1; return { t: 'kw', v: String.fromCharCode(c) }; }
    const word = b.subarray(s, this.p).toString('latin1');
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) return { t: 'num', v: Number(word) };
    return { t: 'kw', v: word };
  }

  literal() {
    const b = this.b;
    this.p += 1;
    const out = [];
    let depth = 1;
    while (this.p < b.length) {
      const c = b[this.p++];
      if (c === 92) {
        const n = b[this.p++];
        const map = { 110: 10, 114: 13, 116: 9, 98: 8, 102: 12 };
        if (map[n] !== undefined) out.push(map[n]);
        else if (n >= 48 && n <= 55) {
          let v = n - 48;
          for (let k = 0; k < 2 && b[this.p] >= 48 && b[this.p] <= 55; k += 1) v = v * 8 + (b[this.p++] - 48);
          out.push(v & 255);
        } else if (n === 13) { if (b[this.p] === 10) this.p += 1; } else if (n !== 10) out.push(n);
        continue;
      }
      if (c === 40) depth += 1;
      if (c === 41 && --depth === 0) break;
      out.push(c);
    }
    return Buffer.from(out);
  }

  hex() {
    const b = this.b;
    this.p += 1;
    let s = '';
    while (this.p < b.length && b[this.p] !== 62) {
      const ch = String.fromCharCode(b[this.p++]);
      if (/[0-9a-f]/i.test(ch)) s += ch;
    }
    this.p += 1;
    if (s.length % 2) s += '0';
    return Buffer.from(s, 'hex');
  }

  /* 读一个完整的值（字典、数组、间接引用都拼好） */
  value(tok = this.next()) {
    if (!tok) return null;
    if (tok.t === 'num') {
      // 「n g R」：往前看两个记号
      const save = this.p;
      const t2 = this.next();
      if (t2?.t === 'num' && Number.isInteger(tok.v)) {
        const t3 = this.next();
        if (t3?.t === 'kw' && t3.v === 'R') return { ref: tok.v };
      }
      this.p = save;
      return tok.v;
    }
    if (tok.t === '[') {
      const arr = [];
      for (let t = this.next(); t && t.t !== ']'; t = this.next()) arr.push(this.value(t));
      return arr;
    }
    if (tok.t === '<<') {
      const dict = new Map();
      for (let t = this.next(); t && t.t !== '>>'; t = this.next()) {
        if (t.t !== 'name') continue;
        dict.set(t.v, this.value());
      }
      return dict;
    }
    if (tok.t === 'name') return { name: tok.v };
    if (tok.t === 'str') return tok.v;
    if (tok.t === 'kw') return tok.v === 'true' ? true : tok.v === 'false' ? false : tok.v === 'null' ? null : { kw: tok.v };
    return null;
  }
}

const nameOf = (v) => (v && typeof v === 'object' && 'name' in v ? v.name : null);

/* ---------------- 加密：只处理「没设打开密码、只限制了权限」的（空用户密码），这类在 WPS / 公司模板里很常见 ----------------
 * 标准安全处理程序：R2～R4（RC4 / AES-128）、R5～R6（AES-256）。设了打开密码的解不开，直接告诉用户。 */
const PAD = Buffer.from('28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a', 'hex');
const md5 = (...parts) => createHash('md5').update(Buffer.concat(parts)).digest();
function rc4(key, data) {
  const S = new Uint8Array(256).map((_, i) => i);
  for (let i = 0, j = 0; i < 256; i += 1) { j = (j + S[i] + key[i % key.length]) & 255; [S[i], S[j]] = [S[j], S[i]]; }
  const out = Buffer.alloc(data.length);
  for (let k = 0, i = 0, j = 0; k < data.length; k += 1) {
    i = (i + 1) & 255; j = (j + S[i]) & 255; [S[i], S[j]] = [S[j], S[i]];
    out[k] = data[k] ^ S[(S[i] + S[j]) & 255];
  }
  return out;
}
function aesCbc(key, data, padded = true) {
  if (data.length < 32) return Buffer.alloc(0);
  const d = createDecipheriv(key.length === 32 ? 'aes-256-cbc' : 'aes-128-cbc', key, data.subarray(0, 16));
  d.setAutoPadding(padded);
  return Buffer.concat([d.update(data.subarray(16)), d.final()]);
}
function hashR6(pwd, salt, udata) {
  let k = createHash('sha256').update(Buffer.concat([pwd, salt, udata])).digest();
  for (let i = 0; ; i += 1) {
    const k1 = Buffer.concat(Array(64).fill(Buffer.concat([pwd, k, udata])));
    const c = createCipheriv('aes-128-cbc', k.subarray(0, 16), k.subarray(16, 32));
    c.setAutoPadding(false);
    const e = Buffer.concat([c.update(k1), c.final()]);
    let sum = 0;
    for (let x = 0; x < 16; x += 1) sum += e[x];
    k = createHash(['sha256', 'sha384', 'sha512'][sum % 3]).update(e).digest();
    if (i >= 63 && e[e.length - 1] <= i - 31) break;
  }
  return k.subarray(0, 32);
}

function setupCrypt(pdf, s) {
  const m = [...s.matchAll(/\/Encrypt\s+(\d+)\s+\d+\s+R/g)].pop();
  if (!m && !/\/Encrypt\s*<</.test(s)) return null;
  const enc = m ? pdf.get({ ref: Number(m[1]) }) : null;
  const fail = () => { throw new HttpError(400, '这个 PDF 设了打开密码，读不了。请另存为不加密的 PDF，或者直接复制文字粘贴'); };
  if (!(enc instanceof Map) || nameOf(enc.get('Filter')) !== 'Standard') fail();
  const R = Number(pdf.get(enc.get('R')));
  const V = Number(pdf.get(enc.get('V')));
  const O = pdf.get(enc.get('O'));
  const U = pdf.get(enc.get('U'));
  if (!(O instanceof Buffer) || !(U instanceof Buffer)) fail();
  const cf = pdf.get(enc.get('CF'));
  const stdcf = cf instanceof Map ? pdf.get(cf.get(nameOf(enc.get('StmF')) || 'StdCF')) : null;
  const cfm = stdcf instanceof Map ? nameOf(stdcf.get('CFM')) : (V >= 4 ? 'V2' : 'V2');
  if (cfm === 'None') return null;

  if (R >= 5) {
    const empty = Buffer.alloc(0);
    const ok = R === 5
      ? createHash('sha256').update(Buffer.concat([U.subarray(32, 40)])).digest().equals(U.subarray(0, 32))
      : hashR6(empty, U.subarray(32, 40), empty).equals(U.subarray(0, 32));
    if (!ok) fail();
    const ik = R === 5 ? createHash('sha256').update(U.subarray(40, 48)).digest() : hashR6(empty, U.subarray(40, 48), empty);
    const ue = pdf.get(enc.get('UE'));
    if (!(ue instanceof Buffer)) fail();
    const d = createDecipheriv('aes-256-cbc', ik, Buffer.alloc(16));
    d.setAutoPadding(false);
    const key = Buffer.concat([d.update(ue.subarray(0, 32)), d.final()]);
    return (data) => aesCbc(key, data);
  }

  const idm = s.match(/\/ID\s*\[\s*<([0-9a-fA-F]*)>/);
  const id0 = idm ? Buffer.from(idm[1], 'hex') : Buffer.alloc(0);
  const n = R === 2 ? 5 : Math.max(5, Math.min(16, (Number(pdf.get(enc.get('Length'))) || 40) / 8));
  const P = Buffer.alloc(4);
  P.writeInt32LE(Number(pdf.get(enc.get('P'))) | 0);
  const meta = pdf.get(enc.get('EncryptMetadata')) === false && R >= 4 ? Buffer.from([255, 255, 255, 255]) : Buffer.alloc(0);
  let key = md5(PAD, O.subarray(0, 32), P, id0, meta);
  if (R >= 3) for (let i = 0; i < 50; i += 1) key = md5(key.subarray(0, n));
  key = key.subarray(0, n);
  // 验证空用户密码对不对
  let check;
  if (R === 2) check = rc4(key, PAD).equals(U.subarray(0, 32));
  else {
    let x = rc4(key, md5(PAD, id0));
    for (let i = 1; i <= 19; i += 1) x = rc4(Buffer.from(key.map((b) => b ^ i)), x);
    check = x.equals(U.subarray(0, 16));
  }
  if (!check) fail();
  const aes = cfm === 'AESV2';
  return (data, num, gen) => {
    const k = md5(key, Buffer.from([num & 255, (num >> 8) & 255, (num >> 16) & 255, gen & 255, (gen >> 8) & 255]),
      aes ? Buffer.from('sAlT') : Buffer.alloc(0)).subarray(0, Math.min(16, n + 5));
    return aes ? aesCbc(k, data) : rc4(k, data);
  };
}

class Pdf {
  constructor(buf) {
    this.b = buf;
    this.objs = new Map();      // 号 → { value, stream: Buffer|null }
    this.decoded = new Map();
    this.index();
  }

  index() {
    const s = this.b.toString('latin1');
    const re = /(\d+)\s+(\d+)\s+obj\b/g;
    let m;
    let guard = 0;
    while ((m = re.exec(s)) && guard++ < 500_000) {
      const num = Number(m[1]);
      const lx = new Lexer(this.b, m.index + m[0].length);
      let value;
      try { value = lx.value(); } catch { continue; }
      let stream = null;
      const save = lx.p;
      const t = lx.next();
      if (value instanceof Map && t?.t === 'kw' && t.v === 'stream') {
        let start = lx.p;
        if (this.b[start] === 13) start += 1;
        if (this.b[start] === 10) start += 1;
        let len = value.get('Length');
        if (len && typeof len === 'object' && 'ref' in len) len = this.directNumber(s, len.ref);
        let end = Number.isInteger(len) && len >= 0 ? start + len : -1;
        if (end < 0 || end > this.b.length || !/^\s*endstream/.test(s.slice(end, end + 30))) {
          end = s.indexOf('endstream', start);
          if (end < 0) end = this.b.length;
          while (end > start && (this.b[end - 1] === 10 || this.b[end - 1] === 13)) end -= 1;
        }
        stream = this.b.subarray(start, end);
        re.lastIndex = end;
      } else {
        lx.p = save;
      }
      this.objs.set(num, { value, stream, num, gen: Number(m[2]) });
    }
    this.crypt = setupCrypt(this, s);
    // 对象流（PDF 1.5 以后常见，字体字典经常藏在里面）
    for (const [, o] of [...this.objs]) {
      if (!(o.value instanceof Map) || nameOf(o.value.get('Type')) !== 'ObjStm' || !o.stream) continue;
      let data;
      try { data = this.decode(o); } catch { continue; }
      if (!data) continue;
      const n = Number(this.get(o.value.get('N'))) || 0;
      const first = Number(this.get(o.value.get('First'))) || 0;
      const lx = new Lexer(data);
      const pairs = [];
      for (let i = 0; i < n; i += 1) {
        const a = lx.next(); const b = lx.next();
        if (a?.t !== 'num' || b?.t !== 'num') break;
        pairs.push([a.v, b.v]);
      }
      for (const [num, off] of pairs) {
        if (this.objs.has(num)) continue;
        try { this.objs.set(num, { value: new Lexer(data, first + off).value(), stream: null }); } catch { /* 坏的跳过 */ }
      }
    }
  }

  directNumber(s, num) {
    const m = new RegExp(`(?:^|[^\\d])${num}\\s+\\d+\\s+obj\\s*(\\d+)`).exec(s);
    return m ? Number(m[1]) : null;
  }

  get(v, depth = 0) {
    while (v && typeof v === 'object' && 'ref' in v && depth++ < 20) v = this.objs.get(v.ref)?.value ?? null;
    return v;
  }

  obj(v) {
    return v && typeof v === 'object' && 'ref' in v ? this.objs.get(v.ref) : null;
  }

  decode(o) {
    if (!o?.stream) return null;
    if (this.decoded.has(o)) return this.decoded.get(o);
    let data = o.stream;
    if (this.crypt && o.num != null && nameOf(o.value.get('Type')) !== 'XRef') {
      try { data = this.crypt(data, o.num, o.gen); } catch { data = null; }
      if (!data) { this.decoded.set(o, null); return null; }
    }
    let filters = this.get(o.value.get('Filter'));
    filters = Array.isArray(filters) ? filters.map((f) => nameOf(this.get(f))) : [nameOf(filters)].filter(Boolean);
    for (const f of filters) {
      if (f === 'FlateDecode' || f === 'Fl') {
        try { data = inflateSync(data, { maxOutputLength: MAX_INFLATE }); } catch {
          try { data = inflateSync(data, { finishFlush: zc.Z_SYNC_FLUSH, maxOutputLength: MAX_INFLATE }); } catch { data = null; }
        }
      } else if (f === 'ASCIIHexDecode' || f === 'AHx') {
        data = Buffer.from(data.toString('latin1').replace(/[^0-9a-f]/gi, '').replace(/^(.(..)*)$/, '$10'), 'hex');
      } else if (f === 'ASCII85Decode' || f === 'A85') {
        data = ascii85(data);
      } else {
        data = null;          // 图片编码（DCT、JBIG2…）和 LZW：和文字无关，或者太老
      }
      if (!data) break;
    }
    this.decoded.set(o, data);
    return data;
  }
}

function ascii85(buf) {
  const s = buf.toString('latin1').replace(/\s/g, '').replace(/^<~/, '').replace(/~>.*$/, '');
  const out = [];
  let tuple = [];
  for (const ch of s) {
    if (ch === 'z' && !tuple.length) { out.push(0, 0, 0, 0); continue; }
    tuple.push(ch.charCodeAt(0) - 33);
    if (tuple.length === 5) {
      let v = 0;
      for (const d of tuple) v = v * 85 + d;
      out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
      tuple = [];
    }
  }
  if (tuple.length) {
    const n = tuple.length;
    while (tuple.length < 5) tuple.push(84);
    let v = 0;
    for (const d of tuple) v = v * 85 + d;
    out.push(...[(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255].slice(0, n - 1));
  }
  return Buffer.from(out);
}

/* ---------------- 字体：字形编码 → 文字 ---------------- */
const utf16be = (buf) => {
  let s = '';
  for (let i = 0; i + 1 < buf.length; i += 2) s += String.fromCharCode((buf[i] << 8) | buf[i + 1]);
  return s;
};

function parseCMap(text) {
  const map = new Map();
  const spaces = [];
  const hexNum = (h) => parseInt(h, 16);
  for (const m of text.matchAll(/begincodespacerange([\s\S]*?)endcodespacerange/g)) {
    for (const r of m[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>/gi)) spaces.push({ len: r[1].length / 2, lo: hexNum(r[1]), hi: hexNum(r[2]) });
  }
  for (const m of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const r of m[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]*)>/gi)) map.set(`${r[1].length / 2}:${hexNum(r[1])}`, utf16be(Buffer.from(r[2], 'hex')));
  }
  for (const m of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const r of m[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*(<[0-9a-f]*>|\[[^\]]*\])/gi)) {
      const len = r[1].length / 2;
      const lo = hexNum(r[1]);
      const hi = Math.min(hexNum(r[2]), lo + 65535);
      if (r[3].startsWith('[')) {
        const items = [...r[3].matchAll(/<([0-9a-f]*)>/gi)].map((x) => utf16be(Buffer.from(x[1], 'hex')));
        for (let c = lo; c <= hi && c - lo < items.length; c += 1) map.set(`${len}:${c}`, items[c - lo]);
      } else {
        const base = Buffer.from(r[3].slice(1, -1), 'hex');
        for (let c = lo; c <= hi; c += 1) {
          const b = Buffer.from(base);
          let add = c - lo;
          for (let i = b.length - 1; i >= 0 && add; i -= 1) { const v = b[i] + add; b[i] = v & 255; add = v >> 8; }
          map.set(`${len}:${c}`, utf16be(b));
        }
      }
    }
  }
  return { map, spaces };
}

const GLYPHS = {
  space: ' ', exclam: '!', quotedbl: '"', numbersign: '#', dollar: '$', percent: '%', ampersand: '&', quotesingle: "'",
  parenleft: '(', parenright: ')', asterisk: '*', plus: '+', comma: ',', hyphen: '-', period: '.', slash: '/',
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9',
  colon: ':', semicolon: ';', less: '<', equal: '=', greater: '>', question: '?', at: '@', bracketleft: '[',
  backslash: '\\', bracketright: ']', underscore: '_', braceleft: '{', bar: '|', braceright: '}', quoteleft: '‘',
  quoteright: '’', quotedblleft: '“', quotedblright: '”', endash: '–', emdash: '—', bullet: '•', ellipsis: '…',
  fi: 'fi', fl: 'fl', ff: 'ff',
};
const glyphChar = (g) => {
  if (!g) return '';
  if (GLYPHS[g]) return GLYPHS[g];
  if (/^[A-Za-z]$/.test(g)) return g;
  const u = g.match(/^uni([0-9A-F]{4,})/i) || g.match(/^u([0-9A-F]{4,6})$/i);
  if (u) { try { return String.fromCodePoint(parseInt(u[1].slice(0, u[1].length >= 8 ? 8 : u[1].length), 16)); } catch { return ''; } }
  return '';
};

let gbkDecoder;
const gbk = () => (gbkDecoder ??= (() => { try { return new TextDecoder('gbk'); } catch { return null; } })());
const cp1252 = new TextDecoder('windows-1252');

function makeFont(pdf, fontRef) {
  const f = pdf.get(fontRef);
  if (!(f instanceof Map)) return null;
  const subtype = nameOf(f.get('Subtype'));
  const tu = pdf.obj(f.get('ToUnicode'));
  const cmap = tu ? parseCMap((pdf.decode(tu) || Buffer.alloc(0)).toString('latin1')) : null;
  const enc = pdf.get(f.get('Encoding'));
  const encName = nameOf(enc) || '';
  const font = { composite: subtype === 'Type0', cmap, encName, widths: new Map(), dw: 1000, missing: 0 };

  if (font.composite) {
    const desc = pdf.get((pdf.get(f.get('DescendantFonts')) || [])[0]);
    if (desc instanceof Map) {
      font.dw = Number(pdf.get(desc.get('DW'))) || 1000;
      const w = pdf.get(desc.get('W'));
      if (Array.isArray(w)) {
        for (let i = 0; i < w.length;) {
          const a = pdf.get(w[i]);
          const b = pdf.get(w[i + 1]);
          if (Array.isArray(b)) { b.forEach((x, k) => font.widths.set(a + k, Number(pdf.get(x)) || font.dw)); i += 2; } else {
            const v = Number(pdf.get(w[i + 2])) || font.dw;
            for (let c = a; c <= b && c - a < 65536; c += 1) font.widths.set(c, v);
            i += 3;
          }
        }
      }
    }
  } else {
    const first = Number(pdf.get(f.get('FirstChar'))) || 0;
    const ws = pdf.get(f.get('Widths'));
    if (Array.isArray(ws)) ws.forEach((x, k) => font.widths.set(first + k, Number(pdf.get(x)) || 0));
    font.dw = 500;
    font.diff = new Map();
    if (enc instanceof Map) {
      const d = pdf.get(enc.get('Differences'));
      let code = 0;
      if (Array.isArray(d)) for (const x of d) { const v = pdf.get(x); if (typeof v === 'number') code = v; else if (nameOf(v)) font.diff.set(code++, nameOf(v)); }
    }
  }
  return font;
}

/* 把一段字形编码拆成 [code, 字节数] */
function splitCodes(font, bytes) {
  const out = [];
  if (!font.composite) { for (const b of bytes) out.push([b, 1]); return out; }
  const spaces = font.cmap?.spaces || [];
  const enc = font.encName;
  for (let i = 0; i < bytes.length;) {
    let len = 2;
    if (/GBK|GB-EUC|GBpc|GBT/i.test(enc)) len = bytes[i] >= 0x81 ? 2 : 1;
    else if (!/Identity|UCS2|UTF16/i.test(enc) && spaces.length) {
      len = 0;
      for (const sp of [...spaces].sort((a, b) => a.len - b.len)) {
        if (i + sp.len > bytes.length) continue;
        let v = 0;
        for (let k = 0; k < sp.len; k += 1) v = (v << 8) | bytes[i + k];
        if (v >= sp.lo && v <= sp.hi) { len = sp.len; break; }
      }
      if (!len) len = spaces[0]?.len || 2;
    }
    let code = 0;
    for (let k = 0; k < len && i + k < bytes.length; k += 1) code = (code << 8) | bytes[i + k];
    out.push([code, len]);
    i += len;
  }
  return out;
}

function decodeCode(font, code, len) {
  const hit = font.cmap?.map.get(`${len}:${code}`);
  if (hit !== undefined) return hit.replace(/\u0000/g, '');
  if (font.composite) {
    if (/UCS2|UTF16/i.test(font.encName)) return String.fromCharCode(code);
    if (/GBK|GB-EUC|GBpc|GBT/i.test(font.encName) && gbk()) {
      return gbk().decode(len === 2 ? Buffer.from([code >> 8, code & 255]) : Buffer.from([code]));
    }
    font.missing += 1;
    return '';
  }
  if (font.diff?.has(code)) { const g = glyphChar(font.diff.get(code)); if (g) return g; }
  if (code < 32) return '';
  return cp1252.decode(Buffer.from([code]));
}

/* ---------------- 内容流 → 文字 ---------------- */
const LATIN = /[A-Za-z0-9]/;

function runContent(pdf, data, resources, st, depth = 0) {
  if (!data || depth > 4) return;
  const res = pdf.get(resources);
  const fonts = res instanceof Map ? pdf.get(res.get('Font')) : null;
  const xobjs = res instanceof Map ? pdf.get(res.get('XObject')) : null;
  const lx = new Lexer(data);
  const stack = [];
  let font = null;
  let size = 10;
  let tm = [1, 0, 0, 1, 0, 0];
  let lm = [1, 0, 0, 1, 0, 0];
  let leading = 0;
  let charSp = 0;
  let wordSp = 0;
  let hScale = 1;

  const fontFor = (name) => {
    const ref = fonts instanceof Map ? fonts.get(name) : null;
    const key = ref && typeof ref === 'object' && 'ref' in ref ? ref.ref : `${name}@${depth}`;
    if (!st.fonts.has(key)) st.fonts.set(key, makeFont(pdf, ref));
    return st.fonts.get(key);
  };
  const moveLine = (tx, ty) => { lm = [lm[0], lm[1], lm[2], lm[3], lm[4] + tx * lm[0] + ty * lm[2], lm[5] + tx * lm[1] + ty * lm[3]]; tm = [...lm]; };

  const show = (bytes) => {
    if (!font || !(bytes instanceof Buffer)) return;
    const scale = Math.hypot(tm[2], tm[3]) || 1;
    const x = tm[4];
    const y = tm[5];
    const fs = size * scale;
    if (st.y !== null && Math.abs(y - st.y) > Math.max(1, fs * 0.5)) st.newline(Math.abs(y - st.y) / (fs || 1));
    else if (st.x !== null && x - st.x > fs * 0.25) st.pendingSpace = true;
    let adv = 0;
    let text = '';
    for (const [code, len] of splitCodes(font, bytes)) {
      text += decodeCode(font, code, len);
      const w = font.widths.get(code) ?? font.dw;
      adv += (w / 1000) * size + charSp + (len === 1 && code === 32 ? wordSp : 0);
    }
    adv *= hScale;
    st.put(text);
    tm = [tm[0], tm[1], tm[2], tm[3], tm[4] + adv * tm[0], tm[5] + adv * tm[1]];
    st.x = tm[4];
    st.y = tm[5];
  };

  for (let t = lx.next(); t; t = lx.next()) {
    if (t.t !== 'kw') { stack.push(lx.value(t)); if (stack.length > 64) stack.shift(); continue; }
    const op = t.v;
    const num = (i) => Number(stack[stack.length - i]) || 0;
    switch (op) {
      case 'BT': tm = [1, 0, 0, 1, 0, 0]; lm = [1, 0, 0, 1, 0, 0]; break;
      case 'Tf': font = fontFor(nameOf(stack[stack.length - 2])); size = num(1) || size; break;
      case 'Tc': charSp = num(1); break;
      case 'Tw': wordSp = num(1); break;
      case 'Tz': hScale = num(1) / 100 || 1; break;
      case 'TL': leading = num(1); break;
      case 'Td': moveLine(num(2), num(1)); break;
      case 'TD': leading = -num(1); moveLine(num(2), num(1)); break;
      case 'Tm': lm = [num(6), num(5), num(4), num(3), num(2), num(1)]; tm = [...lm]; break;
      case 'T*': moveLine(0, -leading); break;
      case 'Tj': show(stack[stack.length - 1]); break;
      case "'": moveLine(0, -leading); show(stack[stack.length - 1]); break;
      case '"': wordSp = num(3); charSp = num(2); moveLine(0, -leading); show(stack[stack.length - 1]); break;
      case 'TJ': {
        const arr = stack[stack.length - 1];
        if (Array.isArray(arr)) {
          for (const item of arr) {
            if (item instanceof Buffer) show(item);
            else if (typeof item === 'number') {
              const dx = (-item / 1000) * size * hScale;
              tm = [tm[0], tm[1], tm[2], tm[3], tm[4] + dx * tm[0], tm[5] + dx * tm[1]];
              if (item < -200) st.pendingSpace = true;
              st.x = tm[4];
            }
          }
        }
        break;
      }
      case 'Do': {
        const name = nameOf(stack[stack.length - 1]);
        const xo = xobjs instanceof Map ? pdf.obj(xobjs.get(name)) : null;
        if (xo?.value instanceof Map && nameOf(xo.value.get('Subtype')) === 'Form' && !st.seen.has(xo)) {
          st.seen.add(xo);
          runContent(pdf, pdf.decode(xo), xo.value.get('Resources') || resources, st, depth + 1);
          st.seen.delete(xo);
        }
        break;
      }
      case 'BI': {
        // 内嵌图片：跳过 ID 到 EI 之间的二进制
        const b = data;
        let i = lx.p;
        while (i < b.length - 1 && !(b[i] === 73 && b[i + 1] === 68 && WS.has(b[i + 2] ?? 32))) i += 1;
        i += 3;
        while (i < b.length - 2 && !(WS.has(b[i - 1]) && b[i] === 69 && b[i + 1] === 73 && (i + 2 >= b.length || WS.has(b[i + 2])))) i += 1;
        lx.p = i + 2;
        break;
      }
      default: break;
    }
    stack.length = 0;
    if (st.out.length > MAX_TEXT * 2) return;
  }
}

function textState() {
  const st = {
    out: '', x: null, y: null, pendingSpace: false, fonts: new Map(), seen: new Set(),
    /* 换行时记下行距（相对字号），拼段落时行距明显大于这一页常见行距的，就是段落之间 */
    newline(gap) {
      st.out = st.out.replace(/[ \t]+$/, '');
      if (st.out && !st.out.endsWith('\n')) st.out += `\n\u0002${Math.round(gap * 100)}\u0003`;
      st.pendingSpace = false;
    },
    put(text) {
      if (!text) return;
      if (st.pendingSpace && LATIN.test(st.out.slice(-1)) && LATIN.test(text[0])) st.out += ' ';
      st.pendingSpace = false;
      st.out += text;
    },
  };
  return st;
}

function pagesOf(pdf) {
  const s = pdf.b.toString('latin1');
  const roots = [...s.matchAll(/\/Root\s+(\d+)\s+\d+\s+R/g)];
  const pages = [];
  const walk = (node, inherited, depth) => {
    const n = pdf.get(node);
    if (!(n instanceof Map) || depth > 30 || pages.length > 2000) return;
    const resources = n.get('Resources') ?? inherited;
    const type = nameOf(n.get('Type'));
    const kids = pdf.get(n.get('Kids'));
    if (type === 'Page' || (!kids && n.has('Contents'))) { pages.push({ node: n, resources }); return; }
    if (Array.isArray(kids)) for (const k of kids) walk(k, resources, depth + 1);
  };
  for (const r of roots.reverse()) {
    const cat = pdf.get({ ref: Number(r[1]) });
    if (cat instanceof Map && cat.get('Pages')) { walk(cat.get('Pages'), null, 0); if (pages.length) break; }
  }
  if (!pages.length) {
    for (const [, o] of [...pdf.objs].sort((a, b) => a[0] - b[0])) {
      if (o.value instanceof Map && nameOf(o.value.get('Type')) === 'Page') pages.push({ node: o.value, resources: o.value.get('Resources') });
    }
  }
  return pages;
}

function infoTitle(pdf) {
  const s = pdf.b.toString('latin1');
  const m = [...s.matchAll(/\/Info\s+(\d+)\s+\d+\s+R/g)].pop();
  const info = m ? pdf.get({ ref: Number(m[1]) }) : null;
  let raw = info instanceof Map ? pdf.get(info.get('Title')) : null;
  if (!(raw instanceof Buffer) || !raw.length) return '';
  if (pdf.crypt) { try { raw = pdf.crypt(raw, Number(m[1]), 0); } catch { return ''; } }
  const t = raw[0] === 0xfe && raw[1] === 0xff ? utf16be(raw.subarray(2)) : raw.toString('latin1');
  // Word 打印成 PDF 常见的「Microsoft Word - 文件名.docx」不算标题
  return t.replace(/\u0000/g, '').replace(/^Microsoft (Word|PowerPoint) - /, '').replace(/\.(docx?|wps|pptx?)$/i, '').trim();
}

/* 按行拼成段落：中文 PDF 每行到页宽就折，一句话会被拆成好几行 */
const BULLET = /^([•●▪■◆·\-–]\s*|\d{1,2}[.、)）]\s*|[（(]\d{1,2}[)）])/;
export function joinLines(raw) {
  const pages = raw.split('\f');
  const paras = [];
  for (const page of pages) {
    const gaps = [];
    const lines = page.split('\n').map((l) => {
      const m = l.match(/^\u0002(\d+)\u0003/);
      gaps.push(m ? Number(m[1]) : 0);
      return (m ? l.slice(m[0].length) : l).replace(/\s+$/, '');
    });
    const sorted = gaps.filter(Boolean).sort((a, b) => a - b);
    const lineGap = sorted[Math.floor(sorted.length / 4)] || 0;     // 段内行距比段间距多见，取偏小的分位
    const kept = lines.map((l, i) => [l, gaps[i]])
      .filter(([l]) => !/^\s*(第\s*\d+\s*页(\s*[/，,共]\s*\d+\s*页?)?|-?\s*\d{1,4}\s*-?|\d+\s*\/\s*\d+|page \d+( of \d+)?)\s*$/i.test(l));
    const lens = kept.map(([l]) => l).filter((l) => l.trim()).map((l) => l.length).sort((a, b) => a - b);
    const typical = lens[Math.floor(lens.length * 0.75)] || 0;
    let cur = '';
    for (const [line, gap] of kept) {
      const t = line.trim();
      if (!t) { if (cur) paras.push(cur); cur = ''; continue; }
      if (cur && ((lineGap && gap > lineGap * 1.3) || gap > 190)) { paras.push(cur); cur = ''; }
      // 列表项另起一段
      if (cur && BULLET.test(t)) { paras.push(cur); cur = ''; }
      if (!cur) { cur = t; } else {
        const prev = cur.slice(-1);
        const glue = LATIN.test(prev) && LATIN.test(t[0]) ? ' ' : (prev === '-' && /[a-z]/.test(t[0]) ? '\b' : '');
        cur = glue === '\b' ? cur.slice(0, -1) + t : cur + glue + t;
      }
      // 这一行没到常见行宽、或者以句末标点收尾：段落到这儿结束
      const short = typical && line.length < typical * 0.8;
      if (/[。！？!?：:；;…」』”"）).]$/.test(t) && (short || BULLET.test(cur))) { paras.push(cur); cur = ''; } else if (short && line.length < typical * 0.6) { paras.push(cur); cur = ''; }
    }
    if (cur) paras.push(cur);
  }
  return paras.map((p) => p.trim().replace(/^[•●▪■◆·]\s*/, '- ')).filter(Boolean).join('\n\n');
}

/* 有的 PDF 把「一」「长」映射成康熙部首（⼀ ⻓），看着一样、搜不到。只把部首区的字规范化，别的不动（全角标点要留着） */
const RADICALS = {
  '⺠': '民', '⺼': '月', '⻅': '见', '⻆': '角', '⻈': '讠', '⻋': '车', '⻓': '长', '⻔': '门', '⻛': '风', '⻜': '飞',
  '⻝': '食', '⻠': '饣', '⻢': '马', '⻥': '鱼', '⻦': '鸟', '⻧': '卤', '⻩': '黄', '⻬': '齐', '⻮': '齿', '⻰': '龙',
  '⻳': '龟', '⻏': '阝', '⻖': '阝', '⺭': '礻', '⻊': '足', '⻉': '贝', '⻚': '页', '⻘': '青', '⻨': '麦', '⻤': '鬼',
};
const fixRadicals = (s) => s.replace(/[\u2E80-\u2EFF\u2F00-\u2FDF]/g, (c) => RADICALS[c] || c.normalize('NFKC'));
const JUNK_TITLE = /^(untitled|about:blank|无标题|未命名|document\d*|microsoft word.*)$/i;

function pdfText(buf) {
  const head = buf.subarray(0, Math.min(buf.length, 2048)).toString('latin1');
  if (!head.includes('%PDF')) throw new HttpError(400, '不是有效的 PDF');
  let pdf;
  try { pdf = new Pdf(buf); } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, `PDF 解析失败：${err.message}`);
  }
  const pages = pagesOf(pdf);
  if (!pages.length) throw new HttpError(400, 'PDF 里没有找到页面，文件可能损坏了');
  const st = textState();
  for (const pg of pages) {
    let contents = pg.node.get('Contents');
    contents = Array.isArray(pdf.get(contents)) ? pdf.get(contents) : [contents];
    const parts = contents.map((c) => pdf.decode(pdf.obj(c))).filter(Boolean);
    // 一页的多段内容流在语义上是连在一起的
    st.x = null; st.y = null;
    runContent(pdf, Buffer.concat(parts.flatMap((p) => [p, Buffer.from('\n')])), pg.resources, st);
    st.out = `${st.out.replace(/\s+$/, '')}\f`;
    if (st.out.length > MAX_TEXT * 2) break;
  }
  const missing = [...st.fonts.values()].reduce((n, f) => n + (f?.missing || 0), 0);
  let text = joinLines(fixRadicals(st.out.replace(/�/g, '')));
  const visible = text.replace(/\s/g, '').length;
  if (visible < 30) {
    throw new HttpError(422, missing > 30
      ? '这个 PDF 的字体没有带文字对照表，读出来是乱码。请在原软件里复制文字粘贴，或另存为 Word 再上传'
      : '这个 PDF 里读不到文字，可能是扫描件或图片。请上传原始的 Word，或者复制文字粘贴');
  }
  const warnings = [];
  if (missing > visible * 0.1) warnings.push('部分文字的字体没有对照表，可能有缺字，导入前检查一下');
  let title = fixRadicals(infoTitle(pdf));
  if (JUNK_TITLE.test(title) || /^https?:/.test(title)) title = '';
  if (!title) {
    const first = text.split('\n')[0];
    if (first.length <= 40 && !/[。！？.!?]$/.test(first)) { title = first; text = text.slice(first.length).trim(); }
  } else if (text.startsWith(title)) {
    text = text.slice(title.length).trim();
  }
  return { kind: 'pdf', title: title.slice(0, 120), text: text.slice(0, MAX_TEXT), pages: pages.length, warnings };
}
