/* 路由 · frameworks：框架库（内置 + 我的）、推荐、增删改、复制内置到我的。 */
import { Frameworks, Sections } from '../db.js';
import { HttpError } from '../auth.js';
import { PLATFORMS } from '../prompts.js';
import {
  BUILTIN_FRAMEWORKS, FRAMEWORK_LIMITS, builtinOf, normalizeFramework, recommendFrameworks,
} from '../frameworks.js';
import { json, requireUser } from './common.js';

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
  const picks = recommendFrameworks(list, {
    platform,
    subject: String(q?.get('subject') || '').slice(0, 200),
    section: section ? `${section.name} ${section.purpose || ''}` : '',
  });
  json(res, 200, { frameworks: picks });
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
