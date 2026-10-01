/* 路由 · mobile：手机 App 专用的几块——「今天」首页、内容日历与标记发布、离线收件箱、发布包。
 *
 * App 是「随身」用的：打开看今天该干嘛、路上记一条灵感、到点了把成稿复制出去发。
 * 写作、改稿这些重活仍在网页上做，这里只做聚合和搬运，不调模型、不扣额度。
 * 鉴权和网页一样走会话表，只是 App 用 Authorization: Bearer <token>（见 auth.js 的 currentUser）。
 *
 * 「今天」一律按 UTC 日期算：回填快照的 captured_on、发布日期默认值都是 toISOString().slice(0, 10)，
 * 这里要和它们对得上，否则跨时区的那几个小时里「该回填了」会忽隐忽现。 */
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA_DIR, Drafts, Inbox, Jobs, MATERIAL_KINDS, Materials, Personas, Pool } from '../db.js';
import { withTx } from '../client.js';
import { HttpError } from '../auth.js';
import { snapshot } from '../quota.js';
import { PLATFORMS, TITLE_LIMITS } from '../prompts.js';
import { IMAGE_MARK } from '../../shared/place.js';
import { json, requireUser } from './common.js';

/* ---------------- 日期 ---------------- */

const DAY_MS = 86400000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const todayUtc = () => new Date().toISOString().slice(0, 10);
const validDay = (s) => {
  if (!DAY.test(String(s || ''))) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
};
export const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const pubDay = (row) => {
  const d = String(row.published_at || '').slice(0, 10);
  return validDay(d) ? d : '';
};

/* persona 参数：不传或空 = 全部账号；none = 未绑定账号的；数字 = 该账号。和 /api/drafts 一个口径 */
function personaScope(url) {
  const raw = url?.searchParams.get('persona');
  if (raw === null || raw === undefined || raw === '') return undefined;
  if (raw === 'none') return null;
  if (!/^\d+$/.test(raw)) throw new HttpError(400, '账号参数不对');
  return Number(raw);
}

/* ---------------- 「该回填了」与日历状态 ---------------- */

/* 发布后第 1 天、第 7 天各该有一次回填：到了那天、却没有那天及以后的快照，就算欠着。
   两个都欠时只提第 7 天（补一次第 7 天的数就够了）；发布超过 30 天的不再催。返回 7 / 1 / 0 */
export function metricsDueDay(row, today) {
  const p = pubDay(row);
  if (!p || p < addDays(today, -30)) return 0;
  for (const d of [7, 1]) {
    const target = addDays(p, d);
    if (today >= target && !(row.last_metric && row.last_metric >= target)) return d;
  }
  return 0;
}

const titleOf = (row) => row.title || row.subject || '未命名';
const needsSpeak = (row) => row.has_cues && !row.spoken;

/* 一篇稿子落在日历哪天：发了按发布日；没发按关联选题的排期；成稿了按最后修改那天；都没有就不上日历 */
export function calendarDay(row) {
  const p = pubDay(row);
  if (p) return p;
  if (validDay(row.plan_date)) return row.plan_date;
  if (row.status === 'done') return String(row.updated_at || '').slice(0, 10);
  return '';
}

export function calendarStates(row, today) {
  const published = Boolean(pubDay(row));
  const states = [];
  if (row.status === 'done' && !published) states.push('done');
  if (needsSpeak(row)) states.push('cue');
  if (published) states.push('published');
  if (published && metricsDueDay(row, today)) states.push('metrics');
  return states;
}

/* [from, to] 每天一格（没有内容的也给空格子），withPlatform 决定条目里带不带平台 */
function buildDays(rows, from, to, today, withPlatform) {
  const days = [];
  const byDay = new Map();
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const cell = { day: d, items: [] };
    days.push(cell);
    byDay.set(d, cell);
  }
  // agenda 按修改时间倒序，日历格子里改为按 id 正序，同一天的顺序稳定
  for (const row of [...rows].sort((a, b) => a.id - b.id)) {
    const cell = byDay.get(calendarDay(row));
    if (!cell) continue;
    const item = { id: row.id, title: titleOf(row) };
    if (withPlatform) item.platform = row.platform;
    item.states = calendarStates(row, today);
    cell.items.push(item);
  }
  return days;
}

/* ---------------- 今天 ---------------- */

export async function handleToday(req, res, body, params, url) {
  const user = await requireUser(req);
  const personaId = personaScope(url);
  const today = todayUtc();
  const rows = await Drafts.agenda(user.id, personaId);

  const q = await snapshot(user.id);
  const quota = q
    ? { label: q.label, left: q.left, total: q.total, low: q.total > 0 ? q.left / q.total < 0.15 : q.left <= 0 }
    : { label: '', left: 0, total: 0, low: true };

  const metricsDue = rows
    .map((r) => ({ r, day: metricsDueDay(r, today) }))
    .filter((x) => x.day)
    .sort((a, b) => pubDay(a.r).localeCompare(pubDay(b.r)) || a.r.id - b.r.id)
    .map(({ r, day }) => ({ draftId: r.id, title: titleOf(r), platform: r.platform, publishedAt: r.published_at, day }));

  const jobs = await Jobs.summary(user.id, new Date(Date.now() - 7 * DAY_MS).toISOString(), 5);

  const ready = rows
    .filter((r) => r.status === 'done' && !r.published_at)
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)) || b.id - a.id)
    .slice(0, 10)
    .map((r) => ({ id: r.id, title: titleOf(r), platform: r.platform, updatedAt: r.updated_at, hasCues: r.has_cues }));

  const speakTodo = rows.filter(needsSpeak).slice(0, 5).map((r) => ({ id: r.id, title: titleOf(r) }));

  const dow = new Date(`${today}T00:00:00Z`).getUTCDay();          // 0 = 周日
  const monday = addDays(today, -((dow + 6) % 7));
  const week = buildDays(rows, monday, addDays(monday, 6), today, false);

  json(res, 200, {
    quota,
    metricsDue,
    jobs,
    poolUnused: await Pool.countOpen(user.id, personaId),
    ready,
    speakTodo,
    week,
  });
}

/* ---------------- 日历 ---------------- */

const CALENDAR_MAX_DAYS = 62;

export async function handleCalendar(req, res, body, params, url) {
  const user = await requireUser(req);
  const from = String(url?.searchParams.get('from') || '');
  const to = String(url?.searchParams.get('to') || '');
  if (!validDay(from) || !validDay(to)) throw new HttpError(400, '起止日期要写成 YYYY-MM-DD');
  if (to < from) throw new HttpError(400, '结束日期早于开始日期');
  const span = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
  if (span > CALENDAR_MAX_DAYS) throw new HttpError(400, `一次最多查 ${CALENDAR_MAX_DAYS} 天`);
  const rows = await Drafts.agenda(user.id, personaScope(url));
  json(res, 200, { days: buildDays(rows, from, to, todayUtc(), true) });
}

/* 标记发布 / 取消发布。只改日期，不动回填数据 */
export async function handlePublishedSet(req, res, body, params) {
  const user = await requireUser(req);
  const date = String(body?.date ?? '');
  if (date && !validDay(date)) throw new HttpError(400, '发布日期要写成 YYYY-MM-DD，取消发布传空');
  const out = await Drafts.setPublished(Number(params.id), user.id, date);
  if (!out) throw new HttpError(404, '记录不存在');
  json(res, 200, { draft: { id: out.id, published_at: out.published_at } });
}

/* ---------------- 离线收件箱 ----------------
 * App 没网时把灵感、素材攒在本地，有网了一批发上来。网络抖动会让同一批重发，
 * 所以每条带一个客户端生成的 key：处理过的 key 只回上次的结果，不再建一遍。
 * 一条出错不影响别的条，整批总是 200，每条各自带 ok / error。 */

const INBOX_MAX_ITEMS = 50;
const KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;
const IMAGE_MAX = 3 * 1024 * 1024;
const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png' };
export const INBOX_DIR = () => join(DATA_DIR, 'inbox');
const FILE_RE = /^u(\d+)-[a-f0-9]{16,64}\.(jpg|png)$/;

class ItemError extends Error {}

/* data:image/jpeg;base64,... → { buffer, ext }。还要看文件头，扩展名对不上内容的不收 */
export function decodeImage(v) {
  if (v === undefined || v === null || v === '') return null;
  const m = String(v).match(/^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=\s]+)$/);
  if (!m) throw new ItemError('图片只收 JPEG 或 PNG（base64 data URL）');
  const b64 = m[2].replace(/\s/g, '');
  if (b64.length > Math.ceil(IMAGE_MAX / 3) * 4 + 4) throw new ItemError('图片不能超过 3MB');
  const buffer = Buffer.from(b64, 'base64');
  if (!buffer.length) throw new ItemError('图片是空的');
  if (buffer.length > IMAGE_MAX) throw new ItemError('图片不能超过 3MB');
  const ext = IMAGE_TYPES[m[1]];
  const ok = ext === 'png'
    ? buffer.length > 8 && buffer.readUInt32BE(0) === 0x89504e47
    : buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (!ok) throw new ItemError('图片内容和格式对不上');
  return { buffer, ext };
}

const text = (v, max) => String(v ?? '').trim().slice(0, max);
const tagsOf = (v) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).join(' ') : String(v ?? '')).trim().slice(0, 200);

/* 校验一条，返回要写库的东西；不合格抛 ItemError（只影响这一条） */
async function cleanItem(user, it) {
  const kind = String(it?.kind || '');
  const personaId = it?.personaId === null || it?.personaId === undefined || it?.personaId === '' ? null : Number(it.personaId);
  if (personaId !== null && !(Number.isInteger(personaId) && personaId > 0)) throw new ItemError('账号参数不对');
  if (personaId !== null && !await Personas.byId(personaId, user.id)) throw new ItemError('账号不存在');
  const image = decodeImage(it?.image);

  if (kind === 'pool') {
    const subject = text(it.subject, 200);
    if (!subject) throw new ItemError('题材不能为空');
    return { kind, personaId, image, subject, note: text(it.note, 500), source: text(it.source || '灵感', 20) || '灵感' };
  }
  if (kind === 'material') {
    if (personaId === null) throw new ItemError('素材要选一个账号');
    const title = text(it.title, 80);
    if (!title) throw new ItemError('给这条素材起个标题');
    return {
      kind, personaId, image, title,
      body: text(it.body, 4000),
      materialKind: MATERIAL_KINDS.includes(it.materialKind) ? it.materialKind : '观察',
      tags: tagsOf(it.tags),
    };
  }
  throw new ItemError('kind 只能是 pool 或 material');
}

const withImageLine = (s, url) => (url ? `${s ? `${s}\n` : ''}图片：${url}` : s);

async function inboxOne(user, it) {
  const key = String(it?.key ?? '');
  if (!KEY_RE.test(key)) return { key, ok: false, kind: String(it?.kind || ''), error: 'key 要 8–64 位字母、数字、_ 或 -' };
  const dup = (row) => ({ key, ok: true, kind: row.kind, id: row.ref_id, duplicate: true });
  // 处理过的 key 先回上次的结果，不再校验——比如账号后来删了，重发也不该变成报错
  const before = await Inbox.byKey(user.id, key);
  if (before) return dup(before);

  let c;
  try {
    c = await cleanItem(user, it);
  } catch (err) {
    if (err instanceof ItemError) return { key, ok: false, kind: String(it?.kind || ''), error: err.message };
    throw err;
  }
  let file = null;
  try {
    return await withTx(async () => {
      // 先占 key 再建：同一个 key 并发进来，后到的会在唯一键上等前一个提交，然后拿到它的结果
      const seen = await Inbox.claim(user.id, key, c.kind);
      if (seen) return dup(seen);
      let url = '';
      if (c.image) {
        await mkdir(INBOX_DIR(), { recursive: true });
        const name = `u${user.id}-${randomBytes(12).toString('hex')}.${c.image.ext}`;
        file = join(INBOX_DIR(), name);
        await writeFile(file, c.image.buffer);
        url = `/api/inbox/files/${name}`;
      }
      const row = c.kind === 'pool'
        ? await Pool.create(user.id, c.personaId, { subject: c.subject, note: withImageLine(c.note, url), source: c.source })
        : await Materials.create(user.id, c.personaId, { kind: c.materialKind, title: c.title, body: withImageLine(c.body, url), tags: c.tags });
      await Inbox.setRef(user.id, key, row.id);
      return { key, ok: true, kind: c.kind, id: row.id };
    });
  } catch (err) {
    // 事务回滚了（key 也没占上，可以重发），图片文件也别留下
    if (file) await rm(file, { force: true }).catch(() => {});
    console.error('[inbox]', err);
    return { key, ok: false, kind: c.kind, error: '保存失败，请稍后重发' };
  }
}

export async function handleInbox(req, res, body) {
  const user = await requireUser(req);
  const items = body?.items;
  if (!Array.isArray(items)) throw new HttpError(400, 'items 要是数组');
  if (items.length > INBOX_MAX_ITEMS) throw new HttpError(400, `一次最多 ${INBOX_MAX_ITEMS} 条`);
  const results = [];
  // 一条一条来：同一批里重复的 key，第二条能看到第一条的结果
  for (const it of items) results.push(await inboxOne(user, it));
  json(res, 200, { results });
}

/* 收件箱里的图片：文件名带 u<用户号>- 前缀，只给本人看 */
export async function handleInboxFile(req, res, body, params) {
  const user = await requireUser(req);
  const name = String(params.name || '');
  const m = name.match(FILE_RE);
  if (!m) throw new HttpError(400, '文件名不对');
  if (Number(m[1]) !== user.id) throw new HttpError(403, '不能看别人的图片');
  let data;
  try { data = await readFile(join(INBOX_DIR(), name)); } catch { throw new HttpError(404, '图片不存在'); }
  res.writeHead(200, {
    'Content-Type': m[2] === 'png' ? 'image/png' : 'image/jpeg',
    'Content-Length': data.length,
    'Cache-Control': 'private, max-age=3600',
  });
  res.end(data);
}

/* ---------------- 发布包 ----------------
 * 每个版本（原文 + 各平台版本）一份「复制即发」的东西：标题、纯文本正文、话题标签、配图。
 * 平台发布框不认 Markdown，**号、# 标题贴进去就是乱码，所以正文转成纯文本。 */

/* Markdown → 纯文本：去标题井号、强调、引用、代码标记，链接留文字，图片和插图占位删掉，列表换成 • */
export function markdownToText(src) {
  const inline = (s) => s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/(^|[^\w*])\*([^*\n]+)\*(?!\*)/g, '$1$2');
  const out = [];
  let fenced = false;
  for (const raw of String(src || '').replace(/\r\n?/g, '\n').split(IMAGE_MARK).join('').split('\n')) {
    if (/^\s*(```|~~~)/.test(raw)) { fenced = !fenced; continue; }
    if (fenced) { out.push(raw.trimEnd()); continue; }
    let line = raw.trimEnd();
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push(''); continue; }
    const h = line.match(/^\s{0,3}#{1,6}\s+(.*?)(\s+#+)?$/);
    if (h) line = h[1];
    line = line.replace(/^\s{0,3}>\s?/, '').replace(/^(\s*)[-*+]\s+/, '$1• ');
    out.push(inline(line).trimEnd());   // 删掉图片、占位后行尾会剩空格
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/* 话题标签：#话题#（微博）和 #话题 后面跟空白或结尾（小红书）。去重，最多 10 个，不带 # 号。
   前面紧挨着字母数字或 / & 的不算（网址锚点、HTML 实体） */
export function extractTags(src) {
  const out = [];
  for (const m of String(src || '').matchAll(/(?<![\w/&])#([^#\s]{1,30})#|(?<![\w/&])#([^#\s]{1,30})(?=\s|$)/g)) {
    const t = (m[1] || m[2]).trim();
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= 10) break;
  }
  return out;
}

const charsOf = (s) => [...String(s || '')].length;                    // 标题：按字符算，emoji 算一个（同 cleanTitles）
const bodyCharsOf = (s) => String(s || '').replace(/\s/g, '').length;   // 正文：不算空白（同正文历史、编辑器字数）
const imageUrl = (img) => `/image/${img.file}?v=${encodeURIComponent(img.at || '')}`;   // 和网页 versions.js 一致

/* 正文第一行是 # 标题的，拿它当这一版的标题，并从正文里去掉，免得标题贴两遍 */
function splitTitle(raw, fallback) {
  const lines = String(raw || '').replace(/\r\n?/g, '\n').split('\n');
  const first = lines.findIndex((l) => l.trim());
  const h = first >= 0 ? lines[first].match(/^\s{0,3}#\s+(.+?)\s*#*\s*$/) : null;
  if (!h) return { title: fallback, text: raw };
  lines.splice(first, 1);
  return { title: h[1].trim(), text: lines.join('\n') };
}

function packageOf(draft, key, raw, illus, original) {
  const { title, text: rest } = splitTitle(raw, String(draft.title || draft.subject || '').trim());
  const body = markdownToText(rest);
  // 标题上限只有 TITLE_LIMITS 里写了的平台才有；正文没有哪个平台在代码里定过硬上限（PLATFORMS.length 是目标字数），不编
  const limits = { title: TITLE_LIMITS[key] ?? null, body: null };
  const titleChars = charsOf(title);
  const bodyChars = bodyCharsOf(body);
  return {
    key,
    label: PLATFORMS[key]?.label || key,
    original,
    title,
    body,
    tags: extractTags(raw),
    images: (illus?.items || []).filter((it) => it?.image?.file).map((it) => ({ url: imageUrl(it.image), alt: it.alt || '' })),
    limits,
    checks: {
      titleChars,
      bodyChars,
      titleOver: limits.title != null && titleChars > limits.title,
      bodyOver: limits.body != null && bodyChars > limits.body,
    },
  };
}

export async function handlePackage(req, res, body, params) {
  const user = await requireUser(req);
  const draft = await Drafts.byId(Number(params.id), user.id);
  if (!draft) throw new HttpError(404, '记录不存在');
  const platforms = [packageOf(draft, draft.platform, draft.content, draft.illus?.__main__, true)];
  for (const [key, v] of Object.entries(draft.variants || {})) {
    if (!String(v?.content || '').trim() || key === draft.platform) continue;
    platforms.push(packageOf(draft, key, v.content, draft.illus?.[key], false));
  }
  json(res, 200, { draftId: draft.id, platforms });
}
