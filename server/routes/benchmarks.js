/* 路由 · benchmarks：对标速存。刷到一篇好内容，丢个链接（或粘贴正文）进来，存下标题、提纲和开头摘要；
 * 之后可以一键转成素材（案例）或写法框架。
 *
 * 只存结构不存全文：对标是学「人家怎么组织」，不是攒一堆别人的原文——存全文迟早会被原样写进成稿。
 * 抓取不调模型、不扣额度，但走按用户的限流，免得被当成免费爬虫。SSRF 防护在 server/webpage.js。 */
import { Benchmarks, Frameworks, Materials, Personas } from '../db.js';
import { HttpError } from '../auth.js';
import { userLimit } from '../limit.js';
import { FRAMEWORK_LIMITS, normalizeFramework } from '../frameworks.js';
import { PLATFORMS } from '../prompts.js';
import { extractHtml, extractText, fetchPage, FetchError } from '../webpage.js';
import { json, requireUser } from './common.js';

const PASTE_MAX = 20000;
const PASTE_HINT = '可以把正文复制下来，用「粘贴文本」存';

const present = (b) => ({ id: b.id, url: b.url, title: b.title, outline: b.outline, excerpt: b.excerpt, created_at: b.created_at });

async function minePersona(req, params) {
  const user = await requireUser(req);
  const persona = await Personas.byId(Number(params.id), user.id);
  if (!persona) throw new HttpError(404, '账号不存在');
  return { user, persona };
}

async function mineBenchmark(req, params) {
  const user = await requireUser(req);
  const b = await Benchmarks.byId(Number(params.bid), user.id);
  if (!b) throw new HttpError(404, '这条对标不存在');
  return { user, b };
}

export async function handleBenchmarkList(req, res, body, params) {
  const { user, persona } = await minePersona(req, params);
  json(res, 200, { list: (await Benchmarks.list(user.id, persona.id)).map(present) });
}

/* 两种存法：{ url } 服务端去抓；{ text, title } 用户自己粘贴（抓不到的、要登录才能看的都走这条） */
export async function handleBenchmarkCreate(req, res, body, params) {
  const { user, persona } = await minePersona(req, params);
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  let url = '';
  let parsed;

  if (text) {
    if (text.length < 20) throw new HttpError(400, '粘贴的内容太短了，至少 20 字');
    if (text.length > PASTE_MAX) throw new HttpError(400, `粘贴的内容请控制在 ${PASTE_MAX} 字以内`);
    parsed = extractText(text, String(body?.title || ''));
  } else {
    url = String(body?.url || '').trim();
    if (!url) throw new HttpError(400, '给一个链接，或者粘贴正文');
    if (url.length > 2000) throw new HttpError(400, '链接太长了');
    userLimit(user.id, 'benchmark', 30, 10 * 60_000);
    let page;
    try {
      page = await fetchPage(url);
    } catch (err) {
      if (!(err instanceof FetchError)) throw err;
      if (err.code === 'url') throw new HttpError(400, err.message);
      throw new HttpError(422, `${err.message}。${PASTE_HINT}`);
    }
    url = page.url;
    parsed = page.type === 'html' ? extractHtml(page.body) : extractText(page.body, '');
    if (!parsed.title && !parsed.excerpt) throw new HttpError(422, `没从这个网页里读出正文（可能要登录或是动态加载的）。${PASTE_HINT}`);
  }
  if (!parsed.outline.length && !parsed.excerpt) throw new HttpError(422, `没拆出结构。${PASTE_HINT}`);

  const saved = await Benchmarks.create(user.id, persona.id, {
    url,
    title: parsed.title || parsed.outline[0] || '未命名对标',
    outline: parsed.outline,
    excerpt: parsed.excerpt,
  });
  json(res, 200, { benchmark: present(saved) });
}

export async function handleBenchmarkDelete(req, res, body, params) {
  const user = await requireUser(req);
  if (!await Benchmarks.remove(Number(params.bid), user.id)) throw new HttpError(404, '这条对标不存在');
  json(res, 200, { ok: true });
}

/* 转存：素材（案例，正文是提纲 + 来源）或写法框架（提纲每条一段，篇幅平均）。
   框架里写明「只学结构，不抄内容」，摘要放进 source_text，成稿时照样查和它的重合（防洗稿）。 */
export async function handleBenchmarkSave(req, res, body, params) {
  const { user, b } = await mineBenchmark(req, params);
  const to = String(body?.to || '');

  if (to === 'material') {
    const source = `来源：${b.url || '粘贴的文本'}`;
    const outline = b.outline.join('\n').slice(0, 4000 - source.length - 1);
    const material = await Materials.create(user.id, {
      kind: '对标账号',
      title: `对标：${b.title}`.slice(0, 80),
      body: outline ? `${outline}\n${source}` : source,
      tags: '对标',
    });
    json(res, 200, { material });
    return;
  }

  if (to === 'framework') {
    const [min, max] = FRAMEWORK_LIMITS.slots;
    const slots = b.outline.map((x) => String(x).trim()).filter(Boolean).slice(0, max)
      .map((role) => ({ role: role.slice(0, FRAMEWORK_LIMITS.role), guide: '', ratio: 1 }));
    if (slots.length < min) throw new HttpError(422, `提纲不到 ${min} 条，拆不成框架；可以先转成素材`);
    if (await Frameworks.count(user.id) >= FRAMEWORK_LIMITS.perUser) {
      throw new HttpError(400, `框架数量已达上限（${FRAMEWORK_LIMITS.perUser} 个）`);
    }
    let f;
    try {
      f = normalizeFramework({
        name: `对标：${b.title}`.slice(0, FRAMEWORK_LIMITS.name),
        summary: `从对标内容「${b.title}」拆出的结构参考：只学结构，不抄内容。`,
        scenes: ['对标'],
        slots,
        source_text: b.excerpt,
      }, Object.keys(PLATFORMS));
    } catch (err) {
      throw new HttpError(err.status || 400, err.message);
    }
    json(res, 200, { framework: await Frameworks.create(user.id, f) });
    return;
  }

  throw new HttpError(400, '只能存成素材（material）或框架（framework）');
}
