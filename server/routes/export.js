/* 路由 · export：同步密钥与成稿导出（给 Obsidian 插件这类只读客户端）。
 *
 * 为什么不直接用登录令牌：App 的 Bearer 令牌 14 天过期，挂在电脑上定时同步的插件过两周就断。
 * 同步密钥长期有效、随时可作废，**只能调 /api/export/***（currentUser 不认它），
 * 所以密钥泄露了也只能读到成稿，改不了东西、扣不了额度。服务端只存 sha256。
 *
 * 导出按 (updated_at, id) 增量翻页：客户端记住上一页最后一条的 cursor，下次只拿之后改过的。
 * 正文直接给 Obsidian 能用的 Markdown：插图放回原位，写成 ![说明](ips-image:文件名)，
 * 客户端把图下载到自己的附件目录后替换成本地路径。 */
import { createHash, randomBytes } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA_DIR, Personas, SyncKeys, exportDrafts } from '../db.js';
import { fromRoot } from '../paths.js';
import { HttpError, currentUser } from '../auth.js';
import { PLATFORMS } from '../prompts.js';
import { placeCuts } from '../../shared/place.js';
import { extractTags } from './mobile.js';
import { json, requireUser } from './common.js';

const KEY_PREFIX = 'ips_';
const KEY_MAX = 5;
const PAGE_MAX = 100;
const FILE_RE = /^[\w.-]+\.(png|jpe?g|webp|svg)$/i;   // svg 是演示模式的占位图
const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml' };

export const hashKey = (key) => createHash('sha256').update(String(key)).digest('hex');

/* ---------------- 密钥管理（网页里登录后操作） ---------------- */

export async function handleSyncKeyList(req, res) {
  const user = await requireUser(req);
  json(res, 200, { keys: await SyncKeys.list(user.id) });
}

export async function handleSyncKeyCreate(req, res, body) {
  const user = await requireUser(req);
  if (await SyncKeys.count(user.id) >= KEY_MAX) throw new HttpError(400, `最多 ${KEY_MAX} 把同步密钥，先作废不用的`);
  const name = String(body?.name || '').trim().slice(0, 40) || 'Obsidian';
  const key = `${KEY_PREFIX}${randomBytes(20).toString('hex')}`;
  const item = await SyncKeys.create(user.id, { name, hash: hashKey(key), prefix: key.slice(0, KEY_PREFIX.length + 6) });
  // 明文只在这一次回给前端，之后谁也看不到
  json(res, 200, { key, item });
}

export async function handleSyncKeyDelete(req, res, body, params) {
  const user = await requireUser(req);
  if (!await SyncKeys.remove(Number(params.kid), user.id)) throw new HttpError(404, '这把密钥不存在');
  json(res, 200, { ok: true });
}

/* ---------------- 导出（同步密钥或登录态） ---------------- */

async function requireExportUser(req) {
  const m = String(req.headers.authorization || '').match(/^Bearer\s+(\S+)$/i);
  if (m && m[1].startsWith(KEY_PREFIX)) {
    const user = await SyncKeys.userByHash(hashKey(m[1]));
    if (!user) throw new HttpError(401, '同步密钥无效或已作废，请在网页「同步到 Obsidian」里重新生成');
    return user;
  }
  const user = await currentUser(req);
  if (!user) throw new HttpError(401, '缺少同步密钥');
  return user;
}

/* cursor = "<updated_at>|<id>"；也收 since=<ISO 时间>（从那个时间之后） */
export function parseCursor(url) {
  const raw = url?.searchParams.get('cursor') || '';
  if (raw) {
    const i = raw.lastIndexOf('|');
    const at = i > 0 ? raw.slice(0, i) : '';
    const id = Number(raw.slice(i + 1));
    if (!at || Number.isNaN(Date.parse(at)) || !Number.isInteger(id) || id < 0) throw new HttpError(400, 'cursor 格式不对');
    return { afterAt: at, afterId: id };
  }
  const since = url?.searchParams.get('since') || '';
  if (since && Number.isNaN(Date.parse(since))) throw new HttpError(400, 'since 要是时间');
  return { afterAt: since ? new Date(since).toISOString() : '', afterId: 0 };
}

const fileName = (img) => String(img?.file || '').split('/').pop();

/* 正文 + 这一版的插图 → Obsidian 用的 Markdown 和要下载的图。
 * 有「此处放图片」标记的图占标记的位置；模型挑位置的图插在锚点那一段之后；没出图的位置直接去掉 */
export function exportMarkdown(text, illus) {
  const src = String(text || '').replace(/\r\n?/g, '\n');
  const cuts = placeCuts(src, illus?.items || []);
  const images = [];
  let out = '';
  let from = 0;
  for (const c of cuts) {
    if (c.at < from) continue;
    out += src.slice(from, c.at);
    from = c.at + c.skip;
    const name = fileName(c.item?.image);
    if (!name || !FILE_RE.test(name)) continue;
    const alt = String(c.item.alt || c.item.prompt || '配图').replace(/[[\]\n]/g, ' ').trim().slice(0, 60) || '配图';
    if (!images.some((x) => x.name === name)) images.push({ name, alt, url: `/api/export/images/${encodeURIComponent(name)}` });
    out += `\n\n![${alt}](ips-image:${name})\n\n`;
  }
  out += src.slice(from);
  return { markdown: out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(), images };
}

const platformOf = (key) => ({ key, label: PLATFORMS[key]?.label || key });

export function exportItem(draft, personaName) {
  const main = exportMarkdown(draft.content, draft.illus?.__main__);
  const variants = [];
  for (const [key, v] of Object.entries(draft.variants || {})) {
    if (key === draft.platform || !String(v?.content || '').trim()) continue;
    variants.push({ ...platformOf(key), ...exportMarkdown(v.content, draft.illus?.[key]) });
  }
  return {
    id: draft.id,
    title: String(draft.title || draft.subject || '').trim() || `成稿 ${draft.id}`,
    subject: draft.subject,
    account: draft.persona_id ? { id: draft.persona_id, name: personaName || draft.persona?.name || '' } : null,
    platform: platformOf(draft.platform),
    archived: Boolean(draft.archived_at),
    publishedAt: draft.published_at || '',
    createdAt: draft.created_at,
    updatedAt: draft.updated_at,
    section: draft.section?.name || '',
    framework: draft.framework?.name || '',
    tags: extractTags(draft.content),
    markdown: main.markdown,
    images: main.images,
    variants,
  };
}

export async function handleExportDrafts(req, res, body, params, url) {
  const user = await requireExportUser(req);
  const { afterAt, afterId } = parseCursor(url);
  const limit = Math.min(PAGE_MAX, Math.max(1, Number(url?.searchParams.get('limit')) || 50));
  const rows = await exportDrafts(user.id, { afterAt, afterId, limit: limit + 1 });
  const page = rows.slice(0, limit);
  const names = new Map((await Personas.list(user.id)).map((p) => [p.id, p.name]));
  const items = page.map((d) => exportItem(d, names.get(d.persona_id)));
  await dropMissingImages(user.id, items);
  const last = page[page.length - 1];
  json(res, 200, {
    user: user.username,
    items,
    // 还有下一页时给 next；这一页就是最后一页时也给 cursor，客户端存下来下次从这里接着拿
    cursor: last ? `${last.updated_at}|${last.id}` : (afterAt ? `${afterAt}|${afterId}` : ''),
    more: rows.length > limit,
  });
}

/* 稿子里记着、但服务器上已经没有文件的图（重新出图后旧文件被清掉、换过服务器、手动删过）：不列给插件。
 * 以前照样列出来，插件下载拿到 404 就停在这一篇，之后每次同步都卡在同一个地方。
 * 去掉的图在 Markdown 里的占位，插件按「没下载到的图」处理（直接去掉那一行）。 */
async function dropMissingImages(userId, items) {
  const dir = join(DATA_DIR, 'images', String(userId));
  const seen = new Map();
  const exists = (name) => {
    if (!seen.has(name)) seen.set(name, access(join(dir, name)).then(() => true, () => false));
    return seen.get(name);
  };
  const keep = async (list) => (await Promise.all((list || []).map(async (img) => ((await exists(img.name)) ? img : null)))).filter(Boolean);
  for (const it of items) {
    it.images = await keep(it.images);
    for (const v of it.variants) v.images = await keep(v.images);
  }
}

/* 插图：只给密钥主人自己的图 */
export async function handleExportImage(req, res, body, params) {
  const user = await requireExportUser(req);
  const name = decodeURIComponent(params.name || '');
  if (!FILE_RE.test(name)) throw new HttpError(400, '文件名不对');
  let data;
  try {
    data = await readFile(join(DATA_DIR, 'images', String(user.id), name));
  } catch {
    throw new HttpError(404, '图片不存在');
  }
  res.writeHead(200, {
    'Content-Type': IMAGE_TYPES[name.split('.').pop().toLowerCase()] || 'application/octet-stream',
    'Content-Length': data.length,
    'Cache-Control': 'private, max-age=86400',
  });
  res.end(data);
}

/* 插件文件（公开）：网页「同步」里直接下载，装到 .obsidian/plugins/ip-studio-sync/ */
const PLUGIN_FILES = {
  'main.js': 'text/javascript; charset=utf-8',
  'manifest.json': 'application/json; charset=utf-8',
  'styles.css': 'text/css; charset=utf-8',
};
export async function handlePluginFile(req, res, body, params) {
  const type = PLUGIN_FILES[params.file];
  if (!type) throw new HttpError(404, '没有这个文件');
  const data = await readFile(fromRoot('obsidian-plugin', params.file));
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': data.length,
    'Content-Disposition': `attachment; filename="${params.file}"`,
    'Cache-Control': 'no-cache',
  });
  res.end(data);
}

