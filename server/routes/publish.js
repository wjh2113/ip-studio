/* 路由 · publish：多平台版本、图文配图、Word 导出、标题候选。从原 routes.js 原样拆出。 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { DATA_DIR, Drafts, Personas, Usage } from '../db.js';
import { HttpError } from '../auth.js';
import { generateJSON, generateText } from '../llm.js';
import { buildDocx } from '../docx.js';
import { IMAGE_MARK, markAts } from '../../public/place.js';
import { reserve, settle } from '../quota.js';
import { generate, imageInfo } from '../images.js';
import {
  ADAPT_SYSTEM, adaptUser, DEFAULT_PLATFORM, ILLUS_SCHEMA, ILLUS_SYSTEM, illusUser, PLATFORMS,
  TITLE_LIMITS, TITLE_TYPES, TITLES_SCHEMA, TITLES_SYSTEM, titlesUser,
} from '../prompts.js';
import { scanLexicon } from '../lexicon.js';
import { describe, json, requireUser, sys, withRetry } from './common.js';

/* ==================================================================
 * 配图文件：出图结果落盘与清理
 * ================================================================== */

async function saveImage(userId, draftId, index, out) {
  const dir = resolvePath(DATA_DIR, 'images', String(userId));
  await mkdir(dir, { recursive: true });
  const name = `${draftId}-${index}.${out.ext}`;
  await writeFile(resolvePath(dir, name), out.buffer);
  await Promise.all(['png', 'jpg', 'webp', 'svg'].filter((e) => e !== out.ext)
    .map((e) => rm(resolvePath(dir, `${draftId}-${index}.${e}`), { force: true }).catch(() => {})));
  return `${userId}/${name}`;
}

export async function handleImageInfo(req, res) {
  requireUser(req);
  json(res, 200, { image: imageInfo() });
}

export async function handleExportDocx(req, res, body, params, url) {
  const user = requireUser(req);
  const draft = Drafts.byId(Number(params.id), user.id);
  if (!draft) throw new HttpError(404, '记录不存在');
  const v = String(url?.searchParams.get('version') || '');
  const { text } = versionText(draft, v);
  if (!String(text || '').trim()) throw new HttpError(400, '这一版还没有正文');
  const pack = draft.illus?.[verKey(v)];
  const title = String(draft.title || draft.subject || '文案').slice(0, 80);
  const buf = await buildDocx({
    title,
    text,
    items: pack?.items || [],
    readImage: async (file) => {
      const rel = String(file || '');
      if (!rel.startsWith(`${user.id}/`) || rel.includes('..')) return null;
      try { return await readFile(resolvePath(DATA_DIR, 'images', rel)); }
      catch { return null; }
    },
  });
  const filename = `${title.replace(/[\\/:*?"<>|]/g, '') || '文案'}.docx`;
  res.writeHead(200, {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'Content-Length': buf.length,
    'Content-Disposition': `attachment; filename="draft.docx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'Cache-Control': 'no-store',
  });
  res.end(buf);
}

/* ==================================================================
 * 多平台版本
 *
 * 一份账号设定、一篇成稿，出多个平台的版本。
 * 走的是**适配改写**而不是各平台各生成一遍——后者会让同一件事在不同平台
 * 变成不同的故事（事实、例子、数字各说各的），读者一对照就露馅，
 * 也和"栏目素材是唯一可信事实来源"那条直接冲突。
 * ================================================================== */

export async function handleVariant(req, res, body, params) {
  const user = requireUser(req);
  const draft = Drafts.byId(Number(params.id), user.id);
  if (!draft) throw new HttpError(404, '记录不存在');

  const text = String(draft.content || '').trim();
  if (!text) throw new HttpError(400, '还没有正文');
  if (text.length > 12000) throw new HttpError(400, '正文过长');

  const to = String(body?.platform || '');
  if (!PLATFORMS[to]) throw new HttpError(400, '不认识这个平台');
  const from = PLATFORMS[draft.platform] ? draft.platform : DEFAULT_PLATFORM;
  if (to === from) throw new HttpError(400, '这就是原文的平台，不用再改一遍');

  const persona = (draft.persona_id && Personas.byId(draft.persona_id, user.id)) || draft.persona;

  const out = await withRetry(async () => {
    const t = await generateText({
      meta: { feature: '多平台适配', userId: user.id },
      system: sys('adapt', ADAPT_SYSTEM),
      user: adaptUser(draft, persona, text, from, to),
      mock: () => `演示模式：这里会是「${PLATFORMS[to].label}」版本的正文。\n\n`
        + '真实模式下，事实层和原文完全一致，只重排结构、调语气、增删详略。',
    });
    const clean = String(t || '').trim();
    if (clean.length < 40) throw new HttpError(502, '没有拿到改写结果');
    return clean;
  }, '改写失败，请再试一次');

  const variants = { ...(draft.variants || {}) };
  variants[to] = {
    content: out,
    chars: out.length,
    // 记下改写时依据的原文长度：正文后来被编辑过的话，界面上要提示这版已经旧了
    fromChars: text.length,
    from,
    at: new Date().toISOString(),
  };
  Drafts.setVariants(draft.id, user.id, variants);
  json(res, 200, { platform: to, variant: variants[to] });
}

export async function handleVariantDelete(req, res, body, params) {
  const user = requireUser(req);
  const draft = Drafts.byId(Number(params.id), user.id);
  if (!draft) throw new HttpError(404, '记录不存在');
  const variants = { ...(draft.variants || {}) };
  delete variants[String(params.platform)];
  Drafts.setVariants(draft.id, user.id, variants);
  json(res, 200, { ok: true });
}

/* ==================================================================
 * 图文配图
 *
 * 一篇 2-5 张，且提示词里明确要求**不画具体的人**——
 * 公众号插图本来就该是概念图和场景图，绕开人物，一致性问题就不存在。
 *
 * 配图挂在**版本**上（原文 or 某个平台版本）：公众号要配图，微博通常不需要，
 * 两边该插几张、插在哪也不一样。
 * ================================================================== */

/* 版本 key：'' = 原文；否则是平台 key。存 JSON 时用 '__main__' 占位，
   因为空字符串当对象键读起来太容易看错 */
const verKey = (v) => (v ? String(v) : '__main__');

function versionText(draft, v) {
  if (!v) return { text: String(draft.content || ''), platform: draft.platform };
  const hit = draft.variants?.[v];
  return { text: String(hit?.content || ''), platform: v };
}

export async function handleIllus(req, res, body, params) {
  const user = requireUser(req);
  const draft = Drafts.byId(Number(params.id), user.id);
  if (!draft) throw new HttpError(404, '记录不存在');

  const v = String(body?.version || '');
  if (v && !draft.variants?.[v]) throw new HttpError(400, '这个平台版本还没生成');
  const { text, platform } = versionText(draft, v);
  if (!text.trim()) throw new HttpError(400, '这一版还没有正文');

  const persona = (draft.persona_id && Personas.byId(draft.persona_id, user.id)) || draft.persona;

  const marks = markAts(text).slice(0, 8);
  const data = await withRetry(async () => {
    const out = await generateJSON({
      // 排插图位是一次文案调用，功能名要和出图（按张计费）分开，否则用量面板会把 token 当成张数折算
      meta: { feature: '图文配图方案', userId: user.id },
      system: sys('illus', ILLUS_SYSTEM),
      user: illusUser(draft, persona, text, platform, marks.length),
      schema: ILLUS_SCHEMA,
      mock: () => ({
        look: '演示模式：这里会给整篇统一的视觉风格',
        items: (marks.length ? marks : [0]).map(() => ({
          anchor: marks.length ? IMAGE_MARK : text.slice(0, 14),
          prompt: '演示模式：这里会是画面提示词',
          alt: '演示配图',
        })),
      }),
    });
    if (!out || !Array.isArray(out.items) || !out.items.length) throw new HttpError(502, '没有拿到配图方案');
    return out;
  }, '生成配图方案失败，请再试一次');

  const store = { ...(draft.illus || {}) };
  const before = store[verKey(v)];
  const keepImage = (it) => {
    const old = before?.placed === 'mark'
      ? before.items?.find((o) => o.i === it.i && o.prompt === it.prompt)
      : before?.items?.find((o) => o.prompt === it.prompt);
    return old?.image ? { ...it, image: old.image } : it;
  };

  let kept;
  let capped = null;
  let dropped = 0;
  let placed = 'auto';

  if (marks.length) {
    // 位置以标记为准，不信模型自己写的 anchor，也不按字数砍掉作者指定的张
    placed = 'mark';
    const all = markAts(text);
    capped = all.length > marks.length ? { asked: all.length, cap: marks.length } : null;
    kept = marks.map((at, i) => {
      const src = data.items[i] || {};
      const prompt = String(src.prompt || '').trim() || '与前后段落相配的场景，不画具体的人，画面里不要写字';
      return keepImage({
        anchor: IMAGE_MARK, at, prompt,
        alt: String(src.alt || '').trim().slice(0, 20),
        i, image: null,
      });
    });
  } else {
    const seen = new Set();
    const items = data.items.map((it) => {
      const anchor = String(it.anchor || '').trim();
      const at = anchor && anchor !== IMAGE_MARK ? text.indexOf(anchor) : -1;
      return { anchor, at, prompt: String(it.prompt || '').trim(), alt: String(it.alt || '').trim().slice(0, 20) };
    }).filter((it) => {
      if (it.at < 0 || !it.prompt || seen.has(it.at)) return false;
      seen.add(it.at);
      return true;
    }).sort((a, b) => a.at - b.at)
      .map((it, i) => ({ ...it, i, image: null }));

    if (!items.length) throw new HttpError(502, '配图位置和正文对不上，请再试一次');

    const cap = Math.max(1, Math.min(5, Math.round(text.length / 450)));
    kept = items.slice(0, cap).map((it, i) => keepImage({ ...it, i }));
    dropped = data.items.length - kept.length;
    capped = items.length > cap ? { asked: items.length, cap } : null;
  }

  store[verKey(v)] = {
    look: String(data.look || '').trim(),
    version: v,
    placed,
    dropped,
    capped,
    items: kept,
    at: new Date().toISOString(),
  };
  Drafts.setIllus(draft.id, user.id, store);
  json(res, 200, { version: v, illus: store[verKey(v)], image: imageInfo() });
}

export async function handleIllusImage(req, res, body, params) {
  const user = requireUser(req);
  const draft = Drafts.byId(Number(params.id), user.id);
  if (!draft) throw new HttpError(404, '记录不存在');

  const v = String(body?.version || '');
  const store = draft.illus?.[verKey(v)];
  const idx = Number(params.i);
  const item = store?.items?.[idx];
  if (!item) throw new HttpError(400, '这个配图位不存在');
  if (!item.prompt) throw new HttpError(400, '这一张还没有画面提示词');

  const info = imageInfo();
  // 出图按张计费：先预扣一张，失败退回
  const { held } = reserve(user.id, '图文配图', 1);
  const prompt = store.look ? `${item.prompt}。整体风格：${store.look}` : item.prompt;
  const started = Date.now();
  let out;
  try {
    // 文章插图用横图，竖图在正文里会把一屏占满
    out = await generate({ prompt, ratio: 'landscape' });
    Usage.record({
      userId: user.id, feature: '图文配图', provider: info.provider, model: info.model,
      ok: true, ms: Date.now() - started, units: 1, unit: '张',
    });
  } catch (err) {
    settle(user.id, '图文配图', held, 0);
    Usage.record({
      userId: user.id, feature: '图文配图', provider: info.provider, model: info.model,
      ok: false, ms: Date.now() - started, error: String(err?.message || err),
    });
    throw new HttpError(502, `出图失败：${describe(err)}`);
  }

  const file = await saveImage(user.id, draft.id, `${verKey(v)}-${idx}`, out);
  const image = { file, mime: out.mime, bytes: out.buffer.length, at: new Date().toISOString() };
  const next = { ...store, items: store.items.map((it, i) => (i === idx ? { ...it, image } : it)) };
  Drafts.setIllus(draft.id, user.id, { ...(draft.illus || {}), [verKey(v)]: next });
  json(res, 200, { version: v, index: idx, image });
}

/* ==================================================================
 * 标题候选：定稿后按不同写法出一批，作者挑一个替换
 * ================================================================== */

const titleLen = (t) => [...String(t)].length;   // 按字符算，emoji 算一个

export function cleanTitles(data, { current = '', limit = null } = {}) {
  const seen = new Set([String(current).trim()]);
  return (Array.isArray(data?.titles) ? data.titles : [])
    .map((t) => ({
      text: String(t?.text || '').replace(/^#+\s*/, '').trim(),
      type: TITLE_TYPES.includes(t?.type) ? t.type : '',
      why: String(t?.why || '').trim(),
    }))
    .filter((t) => t.text && !seen.has(t.text) && seen.add(t.text))
    .map((t) => {
      const chars = titleLen(t.text);
      const risk = scanLexicon(t.text).map((h) => h.quote);
      return { ...t, chars, over: Boolean(limit && chars > limit), risk };
    })
    .slice(0, 8);
}

export async function handleTitles(req, res, body, params) {
  const user = requireUser(req);
  const draft = Drafts.byId(Number(params.id), user.id);
  if (!draft) throw new HttpError(404, '记录不存在');
  const text = String(draft.content || '').trim();
  if (!text) throw new HttpError(400, '还没有正文');
  if (text.length > 12000) throw new HttpError(400, '正文过长');
  const persona = (draft.persona_id && Personas.byId(draft.persona_id, user.id)) || draft.persona;
  const limit = TITLE_LIMITS[draft.platform] || null;

  const titles = await withRetry(async () => {
    const out = await generateJSON({
      meta: { feature: '标题候选', userId: user.id },
      system: sys('titles', TITLES_SYSTEM),
      user: titlesUser(draft, persona, text),
      schema: TITLES_SCHEMA,
      mock: () => ({ titles: TITLE_TYPES.map((type, i) => ({ text: `演示模式：${type}标题 ${i + 1}`, type, why: '配置模型密钥后生效' })) }),
    });
    const list = cleanTitles(out, { current: draft.title, limit });
    if (list.length < 3) throw new HttpError(502, '没拿到足够的标题');
    return list;
  }, '起标题失败，请再试一次');

  json(res, 200, { titles, limit });
}

/* 采用一个标题：草稿标题 + 正文第一行的 # 标题一起换，按手动保存留一版历史 */
export async function handleTitleApply(req, res, body, params) {
  const user = requireUser(req);
  const draft = Drafts.byId(Number(params.id), user.id);
  if (!draft) throw new HttpError(404, '记录不存在');
  const title = String(body?.title || '').replace(/[\r\n]+/g, ' ').replace(/^#+\s*/, '').trim().slice(0, 100);
  if (!title) throw new HttpError(400, '标题不能为空');
  const content = String(draft.content || '');
  const lines = content.split('\n');
  const first = lines.findIndex((l) => l.trim());
  if (first >= 0 && /^#\s/.test(lines[first])) lines[first] = `# ${title}`;
  else lines.unshift(`# ${title}`, '');
  Drafts.saveContent(draft.id, user.id, lines.join('\n'), { snapshot: true });
  Drafts.setTitle(draft.id, user.id, title);
  json(res, 200, { draft: Drafts.byId(draft.id, user.id) });
}
