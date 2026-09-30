/* 路由 · hotspots：热点榜单、按账号比对热点、题材推荐。从原 routes.js 原样拆出。 */
import { Drafts, Personas } from '../db.js';
import { HttpError } from '../auth.js';
import { generateJSON, generateText } from '../llm.js';
import { enrichSummaries, fetchBoards, parseManual, riskOf, screenItems } from '../hotspots.js';
import { ARTICLE_SUMMARY_SYSTEM, articleSummaryUser, HOTSPOT_SCHEMA, HOTSPOT_SYSTEM, hotspotUser, SUBJECTS_SCHEMA, SUBJECTS_SYSTEM, performanceBlock, subjectsUser } from '../prompts.js';
import { performanceOf } from '../performance.js';
import { json, requireUser, sys, withRetry } from './common.js';

/* ---------------- 热点板块 ---------------- */

/* 只拿榜单，不做分析——用于展示原始榜单和源状态 */
export async function handleBoards(req, res, body, params, url) {
  requireUser(req);
  const boards = await fetchBoards({ force: url?.searchParams.get('force') === '1' });
  json(res, 200, boards);
}

export async function handleHotspotRead(req, res, body, params) {
  const user = requireUser(req);
  const saved = Personas.hotspots(Number(params.id), user.id);
  if (saved === undefined) throw new HttpError(404, '账号不存在');
  json(res, 200, { hotspots: saved });
}

export async function handleHotspotAnalyze(req, res, body, params) {
  const user = requireUser(req);
  const persona = Personas.byId(Number(params.id), user.id);
  if (!persona) throw new HttpError(404, '账号不存在');

  // 手动粘贴的榜单优先，其次抓全网
  const manual = String(body?.manual || '').trim();
  let items;
  let sources;
  if (manual) {
    items = parseManual(manual);
    if (items.length < 3) throw new HttpError(400, '至少粘 3 条热点，一行一条');
    sources = [{ key: 'manual', label: '手动粘贴', ok: true, count: items.length }];
  } else {
    const boards = await fetchBoards({ force: body?.force === true });
    items = boards.items;
    sources = boards.sources;
  }

  // 不适合蹭的先在代码层挡掉，模型根本看不到，不指望它自觉
  const { kept, blocked } = screenItems(items);
  if (kept.length < 3) throw new HttpError(502, '过滤完剩下的热点太少了，换个时间再试');

  const matches = await analyzeHotspots(persona, kept, { feature: '热点比对', userId: user.id });
  matches.matches = await attachSummaries(matches.matches, user.id);
  const payload = {
    at: new Date().toISOString(),
    sources,
    total: items.length,
    screened: blocked.length,
    screenedSample: blocked.slice(0, 6).map((b) => ({ title: b.title, risk: b.risk })),
    ...matches,
  };
  Personas.setHotspots(persona.id, user.id, payload);
  json(res, 200, { hotspots: payload });
}

async function analyzeHotspots(persona, items, meta = {}) {
  const result = await withRetry(async () => {
    const data = await generateJSON({
      meta,
      system: sys('hotspot', HOTSPOT_SYSTEM),
      user: hotspotUser(persona, items),
      schema: HOTSPOT_SCHEMA,
      mock: () => mockHotspots(persona, items),
    });
    if (!data || !Array.isArray(data.matches)) throw new HttpError(502, '返回结构不对');
    return data;
  }, '热点比对失败，请再试一次');

  const matches = result.matches.slice(0, 5).map((m) => {
    const origin = resolveItem(items, m);
    return {
      angle: String(m.angle || '').trim(),
      subject: String(m.subject || '').trim(),
      strength: ['强', '中', '弱'].includes(m.strength) ? m.strength : '中',
      caution: String(m.caution || '').trim(),
      origin,
    };
  }).filter((m) => (
    m.origin && m.angle && m.subject
    && m.strength !== '弱'            // 模型自己都说弱的，多半是凑数
    && !riskOf(m.origin.title)        // 漏网的再挡一次
  ));

  return { matches, note: String(result.note || '').trim() };
}

/* 给命中的几条补原文概要：榜单自带的直接用，否则best-effort 抓原文，抓不到就如实说没有 */
async function attachSummaries(matches, userId) {
  const enriched = await enrichSummaries(
    matches.map((m) => m.origin),
    async (title, body) => {
      const out = await generateText({
        meta: { feature: '原文概要', userId },
        system: sys('summary', ARTICLE_SUMMARY_SYSTEM),
        user: articleSummaryUser(title, body),
        mock: () => `演示模式：这里会是《${title.slice(0, 14)}》的原文概要`,
      });
      const text = String(out || '').trim();
      return text === '无' || text.length < 12 ? '' : text;
    },
  );
  return matches.map((m, i) => ({ ...m, origin: enriched[i] || m.origin }));
}

/* 模型给的编号可能偏一位，标题是逐字抄的更可靠——两者互相校验 */
function resolveItem(items, m) {
  const byIndex = items[Number(m.index) - 1];
  const title = String(m.source_title || '').trim();
  if (byIndex && (!title || byIndex.title === title)) return byIndex;
  const exact = items.find((it) => it.title === title);
  if (exact) return exact;
  const loose = title && items.find((it) => it.title.includes(title) || title.includes(it.title));
  return loose || byIndex || null;
}

const mockHotspots = (persona, items) => ({
  matches: items.slice(0, 2).map((it, i) => ({
    index: i + 1,
    source_title: it.title,
    angle: `演示模式：这里会说清「${it.title.slice(0, 12)}…」和「${persona.name}」之间的那座桥`,
    subject: `从${it.title.slice(0, 10)}说起，聊聊${persona.content_focus || persona.name}`,
    strength: i === 0 ? '强' : '中',
    caution: i === 0 ? '' : '演示模式：这里会提示需要注意的分寸',
  })),
  note: '演示模式：配置模型密钥后，这里是对今天榜单的真实判断',
});

/* ---------------- 题材推荐 ---------------- */

/* 缓存里的先给出来，页面打开不必等模型 */
export async function handleSubjectList(req, res, body, params) {
  const user = requireUser(req);
  const id = Number(params.id);
  const ideas = Personas.ideas(id, user.id);
  if (ideas === null) throw new HttpError(404, '账号不存在');
  json(res, 200, { ideas: mergeHotIdeas(id, user.id, ideas) });
}

/* 匹配度高的热点直接顶进推荐题材前排——用户不必先去热点板块翻一遍 */
const HOT_IDEA_MAX = 2;

function mergeHotIdeas(personaId, userId, ideas) {
  const saved = Personas.hotspots(personaId, userId);
  const fresh = saved?.matches?.length
    && Date.now() - new Date(saved.at).getTime() < 24 * 3600 * 1000;
  if (!fresh) return ideas.map((i) => ({ ...i, kind: 'idea' }));

  const rank = { 强: 0, 中: 1 };
  const hot = [...saved.matches]
    .sort((a, b) => (rank[a.strength] ?? 9) - (rank[b.strength] ?? 9))
    .slice(0, HOT_IDEA_MAX)
    .map((m) => ({
      kind: 'hot',
      subject: m.subject,
      reason: m.angle,
      strength: m.strength,
      hotspot: {
        title: m.origin?.title || '',
        url: m.origin?.url || '',
        platform: m.origin?.platform || '',
        summary: m.origin?.summary || '',
        summarySource: m.origin?.summarySource || 'none',
        angle: m.angle,
      },
    }));

  const used = new Set(hot.map((h) => h.subject));
  const rest = ideas.filter((i) => !used.has(i.subject)).map((i) => ({ ...i, kind: 'idea' }));
  return [...hot, ...rest].slice(0, 3);
}

export async function handleSubjectGenerate(req, res, body, params) {
  const user = requireUser(req);
  const persona = Personas.byId(Number(params.id), user.id);
  if (!persona) throw new HttpError(404, '账号不存在');
  const ideas = await generateIdeas(persona, user.id);
  json(res, 200, { ideas: mergeHotIdeas(persona.id, user.id, ideas) });
}

async function generateIdeas(persona, userId) {
  const used = Drafts.usedSubjects(userId, persona.id);
  // 当前挂着的推荐也算"提过的"，换一批才不会换汤不换药
  const pending = (Personas.ideas(persona.id, userId) || []).map((i) => ({ subject: i.subject, title: '' }));

  const seen = new Set([...used, ...pending].map((u) => u.subject.trim()));

  const ideas = await withRetry(async () => {
    const data = await generateJSON({
      meta: { feature: '题材推荐', userId },
      system: sys('subjects', SUBJECTS_SYSTEM),
      user: subjectsUser(persona, [...used, ...pending], performanceBlock(performanceOf(userId, persona.id), 'subjects')),
      schema: SUBJECTS_SCHEMA,
      mock: () => mockIdeas(persona, used.length),
    });
    const list = (Array.isArray(data) ? data : data?.ideas || data?.题材 || [])
      .map((i) => ({
        subject: String(i?.subject || i?.题材 || '').trim(),
        reason: String(i?.reason || i?.理由 || '').trim(),
      }))
      .filter((i) => i.subject && !seen.has(i.subject))
      .slice(0, 3);
    if (!list.length) throw new HttpError(502, '没有拿到新题材');
    return list;
  }, '没能想出新题材，稍后再试试');

  Personas.setIdeas(persona.id, userId, ideas);
  return ideas;
}

/* 演示模式：按已写过的条数换一组措辞，保证「换一批」不会自己撞自己 */
const MOCK_IDEA_SHAPES = [
  ['里最容易被忽略的那一步', '新手最常卡在这里'],
  ['上我踩过的三个坑', '亲历型内容更可信'],
  ['被问得最多的一个问题', '直接回应读者疑问'],
  ['里那条被高估的建议', '反常识角度容易出彩'],
  ['第一个月最该做的事', '给刚入门的人一条路径'],
  ['里最省力的一套做法', '怕麻烦的人最需要'],
];

const mockIdeas = (persona, n) => {
  const topic = persona.content_focus || persona.name;
  return {
    ideas: [0, 1, 2].map((i) => {
      const [tail, why] = MOCK_IDEA_SHAPES[(n + i) % MOCK_IDEA_SHAPES.length];
      return { subject: `${topic}${tail}`, reason: `演示模式：${why}（已避开 ${n} 条写过的）` };
    }),
  };
};
