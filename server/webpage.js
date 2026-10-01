/* 服务端替用户抓一个网页（对标速存用），以及从网页 / 粘贴文本里拆出标题、提纲、摘要。
 *
 * 抓取是 SSRF 的高发地：用户给的链接可能指向内网（127.0.0.1、10.x、云厂商的 169.254.169.254 元数据），
 * 也可能先指公网、再 302 跳进内网，或者域名解析出内网地址。所以：
 *   - 只认 http / https；
 *   - 每一跳都自己解析 DNS、逐个检查地址，并且**连接就用检查过的那个地址**（http.request 的 lookup 钩子），
 *     不给「检查时解析一次、连接时再解析一次」的 DNS 重绑定留空子；
 *   - 重定向自己跟，最多 3 跳，每跳重新检查；
 *   - 总时长 8 秒，正文最多 2MB，只收 text/html 和 text/plain。
 * 测试要用本机起的小服务器：NODE_ENV=test 且 BENCHMARK_ALLOW_PRIVATE=1 时才放过内网地址，生产环境设了也不认。 */
import { lookup as dnsLookup } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { isIP, isIPv4, isIPv6 } from 'node:net';

export const FETCH_LIMITS = { timeoutMs: 8000, maxBytes: 2 * 1024 * 1024, redirects: 3 };
export const OUTLINE_MAX = 12;
const EXCERPT_CHARS = 300;
const ITEM_CHARS = 60;

const allowPrivate = () => process.env.NODE_ENV === 'test' && process.env.BENCHMARK_ALLOW_PRIVATE === '1';

export class FetchError extends Error {
  constructor(message, code = 'fetch') { super(message); this.code = code; }
}

/* ---------------- 地址黑名单 ---------------- */

function v4Num(ip) {
  return ip.split('.').reduce((n, x) => n * 256 + Number(x), 0);
}

const V4_BLOCKS = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
].map(([base, bits]) => ({ base: v4Num(base), size: 2 ** (32 - bits) }));

function blockedV4(ip) {
  const n = v4Num(ip);
  return V4_BLOCKS.some((b) => n >= b.base && n < b.base + b.size);
}

/* IPv6 展开成 8 个 16 位整数；末尾是点分 IPv4 的（::ffff:1.2.3.4）也认 */
function v6Words(ip) {
  let s = ip.split('%')[0].toLowerCase();
  const tail = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    const n = v4Num(tail[1]);
    s = `${s.slice(0, -tail[1].length)}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [head, rest] = s.split('::');
  const a = head ? head.split(':') : [];
  const b = rest !== undefined && rest !== '' ? rest.split(':') : [];
  const fill = rest !== undefined ? 8 - a.length - b.length : 0;
  return [...a, ...Array(fill).fill('0'), ...b].map((x) => parseInt(x || '0', 16));
}

const wordsToV4 = (w6, w7) => [w6 >> 8, w6 & 255, w7 >> 8, w7 & 255].join('.');

/* 不能访问的地址：私有、回环、链路本地、CGNAT、组播、保留、文档用段，IPv4 和 IPv6 都算。
   IPv6 只放行全球单播 2000::/3 里的地址，再去掉其中的 Teredo、6to4、文档段；
   ::ffff: 映射和 64:ff9b:: NAT64 里嵌的 IPv4 按 IPv4 的规则判。 */
export function isBlockedIp(ip) {
  const raw = String(ip || '').replace(/^\[|\]$/g, '');
  if (isIPv4(raw)) return blockedV4(raw);
  if (!isIPv6(raw.split('%')[0])) return true;               // 认不出的一律不放
  const w = v6Words(raw);
  if (w.length !== 8 || w.some((x) => !Number.isFinite(x))) return true;
  // ::ffff:a.b.c.d（IPv4 映射）
  if (w.slice(0, 5).every((x) => x === 0) && w[5] === 0xffff) return blockedV4(wordsToV4(w[6], w[7]));
  // 64:ff9b::a.b.c.d（NAT64 公共前缀）
  if (w[0] === 0x64 && w[1] === 0xff9b && w.slice(2, 6).every((x) => x === 0)) return blockedV4(wordsToV4(w[6], w[7]));
  if ((w[0] & 0xe000) !== 0x2000) return true;               // 不在 2000::/3：::、::1、fc00::/7、fe80::/10、ff00::/8 等
  if (w[0] === 0x2001 && w[1] === 0) return true;            // Teredo 2001::/32
  if (w[0] === 0x2001 && w[1] === 0x0db8) return true;       // 文档 2001:db8::/32
  if (w[0] === 0x2001 && (w[1] & 0xfff0) === 0x0010) return true;   // ORCHID 2001:10::/28
  if (w[0] === 0x2001 && (w[1] & 0xfff0) === 0x0020) return true;   // ORCHIDv2 2001:20::/28
  if (w[0] === 0x2002) return true;                          // 6to4，里面可能嵌内网 IPv4
  if ((w[0] & 0xfff0) === 0x3ff0) return true;               // 文档 3fff::/20
  return false;
}

/* 连接用的 DNS 查询：解析出的地址里有一个不能访问就整体拒绝，放行的话就用检查过的地址去连 */
function guardedLookup(hostname, options, cb) {
  const opts = typeof options === 'object' && options ? options : {};
  dnsLookup(hostname, { all: true, verbatim: true }, (err, addrs) => {
    if (err) return cb(err);
    if (!addrs.length) return cb(new FetchError('域名解析不到地址'));
    if (!allowPrivate() && addrs.some((a) => isBlockedIp(a.address))) {
      return cb(new FetchError('这个地址指向内网或保留地址，不能抓取', 'blocked'));
    }
    if (opts.all) return cb(null, addrs);
    return cb(null, addrs[0].address, addrs[0].family);
  });
}

function checkUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { throw new FetchError('链接格式不对', 'url'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new FetchError('只支持 http 和 https 链接', 'url');
  if (u.username || u.password) throw new FetchError('链接里不能带账号密码', 'url');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  // 直接写 IP 的链接不会走 DNS 查询，要在这里先拦
  if (isIP(host) && !allowPrivate() && isBlockedIp(host)) throw new FetchError('这个地址指向内网或保留地址，不能抓取', 'blocked');
  if (!isIP(host) && /^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host) && !allowPrivate()) {
    throw new FetchError('这个地址指向内网，不能抓取', 'blocked');
  }
  return u;
}

function requestOnce(u, signal) {
  return new Promise((resolve, reject) => {
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(u, {
      method: 'GET',
      lookup: guardedLookup,
      signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; zimeiti-benchmark/1.0)',
        Accept: 'text/html,text/plain;q=0.9',
        'Accept-Encoding': 'identity',
      },
    }, (res) => resolve(res));
    req.on('error', reject);
    req.end();
  });
}

function readCapped(res, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let ended = false;
    // 超时中断时请求被销毁，响应可能只有 close 没有 end：不接住的话这里会一直挂着
    res.on('close', () => { if (!ended) reject(new FetchError('网页没传完就断了', 'network')); });
    res.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) {
        res.destroy();
        reject(new FetchError('网页太大了（超过 2MB）', 'too-big'));
        return;
      }
      chunks.push(c);
    });
    res.on('end', () => { ended = true; resolve(Buffer.concat(chunks)); });
    res.on('error', reject);
  });
}

function decode(buf, contentType) {
  let cs = (String(contentType).match(/charset=["']?([\w-]+)/i) || [])[1];
  if (!cs) {
    const head = buf.subarray(0, 4096).toString('latin1');
    cs = (head.match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1];
  }
  try { return new TextDecoder(cs || 'utf-8').decode(buf); } catch { return new TextDecoder('utf-8').decode(buf); }
}

/* 抓一页：返回 { url（最后一跳）, type: 'html' | 'text', body }。失败抛 FetchError */
export async function fetchPage(rawUrl, limits = FETCH_LIMITS) {
  let u = checkUrl(rawUrl);
  const signal = AbortSignal.timeout(limits.timeoutMs);
  try {
    for (let hop = 0; ; hop += 1) {
      const res = await requestOnce(u, signal);
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (hop >= limits.redirects) throw new FetchError('跳转次数太多', 'redirects');
        u = checkUrl(new URL(res.headers.location, u).toString());
        continue;
      }
      if (status < 200 || status >= 300) { res.resume(); throw new FetchError(`网页返回 ${status}`, 'status'); }
      const type = String(res.headers['content-type'] || '').toLowerCase();
      const kind = type.startsWith('text/html') ? 'html' : (type.startsWith('text/plain') ? 'text' : '');
      if (!kind) { res.resume(); throw new FetchError('这不是网页（只收 HTML 和纯文本）', 'type'); }
      const buf = await readCapped(res, limits.maxBytes);
      return { url: u.toString(), type: kind, body: decode(buf, type) };
    }
  } catch (err) {
    if (signal.aborted || err?.name === 'AbortError' || err?.name === 'TimeoutError') throw new FetchError('网页 8 秒没响应', 'timeout');
    if (err instanceof FetchError) throw err;
    if (err?.code === 'blocked' || err?.cause?.code === 'blocked') throw new FetchError(err.message, 'blocked');
    throw new FetchError(`连不上这个网站（${err?.code || err?.message || '未知错误'}）`, 'network');
  }
}

/* ---------------- 拆结构 ---------------- */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
export function decodeEntities(s) {
  return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e) => {
    const k = e.toLowerCase();
    if (k.startsWith('#x')) { const n = parseInt(k.slice(2), 16); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
    if (k.startsWith('#')) { const n = Number(k.slice(1)); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
    return ENTITIES[k] ?? m;
  });
}

const squash = (s) => String(s || '').replace(/[\s 　]+/g, ' ').trim();
const stripTags = (s) => squash(decodeEntities(String(s || '').replace(/<[^>]*>/g, ' ')));
const clip = (s, n) => [...s].slice(0, n).join('');

/* 一段话的第一句（中文句号、问号、叹号或英文句点为界） */
function firstSentence(p) {
  const m = squash(p).match(/^.+?[。！？!?]|^.+?\.(\s|$)|^.+$/);
  return m ? m[0].trim() : '';
}

function uniqueItems(list) {
  const seen = new Set();
  return list.map((x) => clip(squash(x), ITEM_CHARS)).filter((x) => x.length >= 2 && !seen.has(x) && seen.add(x)).slice(0, OUTLINE_MAX);
}

function metaContent(html, prop) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const t of tags) {
    if (new RegExp(`(property|name)\\s*=\\s*["']${prop}["']`, 'i').test(t)) {
      const c = t.match(/content\s*=\s*"([^"]*)"|content\s*=\s*'([^']*)'/i);
      if (c) return stripTags(c[1] ?? c[2]);
    }
  }
  return '';
}

/* 网页 → { title, outline, excerpt }。提纲优先取 h1–h3，不够两条就取各段第一句 */
export function extractHtml(html) {
  const src = String(html || '');
  const title = clip(metaContent(src, 'og:title') || stripTags((src.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]), 120);

  // 去掉不是正文的部分；有 <article> 就只看它
  let body = src.replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|head|nav|footer|aside|form|iframe)\b[\s\S]*?<\/\1>/gi, ' ');
  const article = body.match(/<article\b[\s\S]*?<\/article>/i);
  if (article) body = article[0];
  else body = (body.match(/<body\b[\s\S]*<\/body>/i) || [body])[0];

  const headings = [...body.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].map((m) => stripTags(m[2]));
  let outline = uniqueItems(headings.filter((h) => h !== title));
  const paragraphs = [...body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => stripTags(m[1])).filter((p) => p.length >= 4);
  if (outline.length < 2) {
    const from = paragraphs.length ? paragraphs : plainParagraphs(blockText(body));
    outline = uniqueItems(from.map(firstSentence));
  }
  const text = squash(blockText(body));
  return { title, outline, excerpt: clip(text, EXCERPT_CHARS) };
}

/* 块级标签换成换行再去标签，段落边界留下来 */
function blockText(html) {
  return decodeEntities(String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|li|h[1-6]|blockquote|tr|article)>/gi, '\n')
    .replace(/<[^>]*>/g, ' '));
}

const plainParagraphs = (text) => String(text || '').split(/\n+/).map(squash).filter((p) => p.length >= 4);

/* 粘贴的文本 → { title, outline, excerpt }。提纲优先认 Markdown 标题和「一、」「1.」这类编号小标题，
   不够两条就取各段第一句。标题没给就用第一行 */
export function extractText(text, title = '') {
  const src = String(text || '').replace(/\r\n?/g, '\n');
  const lines = src.split('\n').map((l) => l.trim()).filter(Boolean);
  const first = lines[0] || '';
  const name = clip(squash(title) || squash(first.replace(/^#+\s*/, '')), 120);
  const heads = lines
    .map((l) => {
      const md = l.match(/^#{1,3}\s+(.+)$/);
      if (md) return md[1];
      const num = l.match(/^([一二三四五六七八九十]+[、.．]|\d{1,2}[、.．)）]|[（(][一二三四五六七八九十\d]+[)）])\s*(.{2,30})$/);
      return num && !/[。！？!?]$/.test(num[2]) ? num[2] : null;
    })
    .filter(Boolean);
  let outline = uniqueItems(heads.filter((h) => h !== name));
  if (outline.length < 2) {
    const paras = lines.filter((l) => title || l !== first).map((l) => l.replace(/^#+\s*/, '')).filter((p) => p.length >= 4);
    outline = uniqueItems(paras.map(firstSentence).filter((p) => p !== name));
  }
  return { title: name, outline, excerpt: clip(squash(src.replace(/^#+\s*/gm, '')), EXCERPT_CHARS) };
}
