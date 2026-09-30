/* 路由 · frameworks：框架库（内置 + 我的）、推荐、增删改、复制内置到我的。 */
import { Frameworks, Sections } from '../db.js';
import { generateJSON } from '../llm.js';
import { HttpError } from '../auth.js';
import { EXTRACT_SCHEMA, EXTRACT_SYSTEM, extractUser, PLATFORMS, platformSpec } from '../prompts.js';
import {
  BUILTIN_FRAMEWORKS, FRAMEWORK_LIMITS, builtinOf, normalizeFramework, recommendFrameworks,
} from '../frameworks.js';
import { frameworkBonus, performanceOf } from '../performance.js';
import { json, requireUser, sys, withRetry } from './common.js';

const builtinFor = (userId) => {
  const usage = Frameworks.builtinUsage(userId);
  return BUILTIN_FRAMEWORKS.map((f) => ({ ...f, builtin: true, used_count: usage[f.key] || 0 }));
};

/* 按 key 取框架（b:xxx 内置 / u:123 我的）；取不到返回 null */
export function resolveFramework(userId, key) {
  const k = String(key || '');
  if (!k || k === 'none') return null;
  if (k.startsWith('b:')) {
    const f = builtinOf(k);
    if (!f) throw new HttpError(404, '框架不存在');
    return { ...f, builtin: true };
  }
  const m = k.match(/^u:(\d+)$/);
  const f = m ? Frameworks.byId(Number(m[1]), userId) : null;
  if (!f) throw new HttpError(404, '框架不存在');
  return f;
}

const clean = (body) => {
  try {
    return normalizeFramework(body, Object.keys(PLATFORMS));
  } catch (err) {
    throw new HttpError(err.status || 400, err.message);
  }
};

export async function handleFrameworkList(req, res) {
  const user = requireUser(req);
  json(res, 200, {
    builtin: builtinFor(user.id),
    mine: Frameworks.list(user.id),
    platforms: Object.entries(PLATFORMS).map(([key, v]) => ({ key, label: v.label })),
    limits: FRAMEWORK_LIMITS,
  });
}

export async function handleFrameworkRecommend(req, res, body, params, url) {
  const user = requireUser(req);
  const q = url?.searchParams;
  const platform = String(q?.get('platform') || '');
  const sectionId = Number(q?.get('section_id')) || null;
  const section = sectionId ? Sections.byId(sectionId, user.id) : null;
  const list = [...Frameworks.list(user.id), ...builtinFor(user.id)];
  const personaId = Number(q?.get('persona_id')) || null;
  const perf = performanceOf(user.id, personaId);
  const picks = recommendFrameworks(list, {
    platform,
    subject: String(q?.get('subject') || '').slice(0, 200),
    section: section ? `${section.name} ${section.purpose || ''}` : '',
    bonus: (key) => frameworkBonus(perf, key),
  });
  // 带上数据依据，前端在推荐卡上说明「为什么推它」
  json(res, 200, {
    frameworks: picks.map((f) => (perf.byFramework[f.key] ? { ...f, perf: { ...perf.byFramework[f.key], overall: perf.overall } } : f)),
  });
}

export async function handleFrameworkCreate(req, res, body) {
  const user = requireUser(req);
  if (Frameworks.count(user.id) >= FRAMEWORK_LIMITS.perUser) {
    throw new HttpError(400, `框架数量已达上限（${FRAMEWORK_LIMITS.perUser} 个）`);
  }
  // 复制内置框架：带上它的全部内容，名字加「（我的）」方便区分
  if (body?.from) {
    const src = builtinOf(String(body.from));
    if (!src) throw new HttpError(404, '要复制的框架不存在');
    const f = clean({ ...src, name: `${src.name}（我的）`.slice(0, FRAMEWORK_LIMITS.name) });
    json(res, 200, { framework: Frameworks.create(user.id, { ...f, from_key: src.key }) });
    return;
  }
  json(res, 200, { framework: Frameworks.create(user.id, clean(body)) });
}

export async function handleFrameworkUpdate(req, res, body, params) {
  const user = requireUser(req);
  const f = Frameworks.update(Number(params.fid), user.id, clean(body));
  if (!f) throw new HttpError(404, '框架不存在');
  json(res, 200, { framework: f });
}

export async function handleFrameworkDelete(req, res, body, params) {
  const user = requireUser(req);
  if (!Frameworks.remove(Number(params.fid), user.id)) throw new HttpError(404, '框架不存在');
  json(res, 200, { ok: true });
}

/* 范文拆解：把一篇优秀文案拆成框架草稿，不直接保存——作者在编辑器里改过再存。
   原文一并返回，保存时带上，之后用来查成稿和范文的重合（防洗稿）。 */
export async function handleFrameworkExtract(req, res, body) {
  const user = requireUser(req);
  const text = String(body?.text || '').trim();
  if (text.length < 150) throw new HttpError(400, '范文太短了，至少 150 字才拆得出结构');
  if (text.length > FRAMEWORK_LIMITS.source) throw new HttpError(400, `范文请控制在 ${FRAMEWORK_LIMITS.source} 字以内`);
  const platform = PLATFORMS[body?.platform] ? body.platform : '';

  const data = await withRetry(async () => {
    const out = await generateJSON({
      meta: { feature: '范文拆解', userId: user.id },
      system: sys('extract', EXTRACT_SYSTEM),
      user: extractUser(text, platform ? platformSpec(platform).label : ''),
      schema: EXTRACT_SCHEMA,
      mock: () => ({
        name: '演示：范文框架', summary: '演示模式：配置模型密钥后这里是拆出来的结构', scenes: ['演示'],
        slots: [{ role: '开头', guide: '演示', ratio: 0.2 }, { role: '主体', guide: '演示', ratio: 0.6 }, { role: '结尾', guide: '演示', ratio: 0.2 }],
        why: '演示模式',
      }),
    });
    if (!Array.isArray(out?.slots) || out.slots.length < 2) throw new HttpError(502, '没拆出完整结构');
    return out;
  }, '拆解失败，请再试一次');

  const draft = clean({ ...data, platforms: platform ? [platform] : [], source_text: text });
  json(res, 200, { framework: { ...draft, why: String(data.why || '').trim() } });
}
