/* 路由 · prompts：提示词说明书：读取（APP_ADMINS 或后台管理员）、编辑与切版本（仅后台管理员）。 */
import { currentAdmin, currentUser, HttpError, isAppAdmin } from '../auth.js';
import { ASSEMBLY, PRINCIPLE, PROMPT_DOCS, STAGES } from '../promptdocs.js';
import { activateRevision, listRevisions, liveSystem, revisionSource, savePromptEdit } from '../promptrev.js';
import { json, requireAdmin } from './common.js';

export async function handlePromptDocs(req, res) {
  const user = await currentUser(req);
  const admin = await currentAdmin(req);
  // 顶栏「提示词」只给 APP_ADMINS；后台管理员会话仍可读以便改提示词
  if (!isAppAdmin(user) && !admin) throw new HttpError(403, '只有应用管理员可以查看提示词');
  json(res, 200, {
    stages: STAGES,
    principle: PRINCIPLE,
    assembly: ASSEMBLY,
    // 提示词是全站共用的，只有管理后台登录后才能改
    canEdit: Boolean(admin),
    prompts: await Promise.all(PROMPT_DOCS().map(async (p) => ({
      ...p,
      system: liveSystem(p.key, p.system),
      customized: revisionSource(p.key) === 'edit',
      history: await listRevisions(p.key),
    }))),
  });
}

export async function handlePromptSave(req, res, body, params) {
  const admin = await requireAdmin(req);
  const history = await savePromptEdit(params.key, body?.system, admin.id);
  json(res, 200, { history, system: history.find((h) => h.active)?.system || '' });
}

export async function handlePromptActivate(req, res, body, params) {
  await requireAdmin(req);
  const history = await activateRevision(params.key, params.rid);
  json(res, 200, { history, system: history.find((h) => h.active)?.system || '' });
}
