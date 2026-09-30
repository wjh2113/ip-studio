/* 路由 · prompts：提示词说明书：读取、编辑（仅管理员）、切换版本。从原 routes.js 原样拆出。 */
import { currentAdmin } from '../auth.js';
import { ASSEMBLY, PRINCIPLE, PROMPT_DOCS, STAGES } from '../promptdocs.js';
import { activateRevision, listRevisions, liveSystem, revisionSource, savePromptEdit } from '../promptrev.js';
import { json, requireAdmin } from './common.js';

export async function handlePromptDocs(req, res) {
  json(res, 200, {
    stages: STAGES,
    principle: PRINCIPLE,
    assembly: ASSEMBLY,
    // 提示词是全站共用的，只有管理员能改；普通用户只读
    canEdit: Boolean(await currentAdmin(req)),
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
