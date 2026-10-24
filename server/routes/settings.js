/* 路由 · settings：个人设置（模型能力、对话记录保存天数、AI 对话用的模型）。登录用户可改，所有账号共用。 */
import { CHAT_KEEP_CHOICES, LLM_PREF_CHOICES, Users } from '../db.js';
import { HttpError } from '../auth.js';
import { invalidateLlmPref, listModels, PROVIDER } from '../llm.js';
import { json, requireUser } from './common.js';

export async function handleSettingsGet(req, res) {
  const user = await requireUser(req);
  const s = await Users.settings(user.id);
  json(res, 200, {
    llmPref: s.llmPref,
    chatKeepDays: s.chatKeepDays,
    chatModel: s.chatModel,
    llmPrefChoices: LLM_PREF_CHOICES,
    chatKeepChoices: CHAT_KEEP_CHOICES,
  });
}

export async function handleSettingsPut(req, res, body) {
  const user = await requireUser(req);
  const patch = {};
  if (body?.llmPref != null) {
    const pref = String(body.llmPref);
    if (!LLM_PREF_CHOICES.includes(pref)) {
      throw new HttpError(400, `模型能力只能是 ${LLM_PREF_CHOICES.join(' / ')}`);
    }
    patch.llmPref = pref;
  }
  if (body?.chatKeepDays != null) {
    const days = Number(body.chatKeepDays);
    if (!CHAT_KEEP_CHOICES.includes(days)) {
      throw new HttpError(400, `保存天数只能是 ${CHAT_KEEP_CHOICES.join(' / ')}（0 = 一直留）`);
    }
    patch.chatKeepDays = days;
  }
  if (body?.chatModel != null) {
    // 空 = 自动；指定的必须在网关给这个租户的列表里（不可用的也不让选）
    const id = String(body.chatModel).trim();
    if (id) {
      const hit = (await modelsOrFail()).find((m) => m.id.toLowerCase() === id.toLowerCase());
      if (!hit) throw new HttpError(400, '没有这个模型，刷新列表后重新选');
      if (!hit.available) throw new HttpError(400, `「${hit.name}」现在不可用，换一个或选「自动」`);
      patch.chatModel = hit.id;
    } else {
      patch.chatModel = '';
    }
  }
  if (!Object.keys(patch).length) throw new HttpError(400, '没有要改的设置');
  const s = await Users.setSettings(user.id, patch);
  if (patch.llmPref != null) invalidateLlmPref(user.id);
  json(res, 200, {
    llmPref: s.llmPref,
    chatKeepDays: s.chatKeepDays,
    chatModel: s.chatModel,
  });
}

async function modelsOrFail(fresh = false) {
  try {
    return await listModels({ fresh });
  } catch (err) {
    throw new HttpError(502, String(err?.message || err));
  }
}

/* AI 对话能选的模型：显示 name，存 id。已存的那个不在列表里了（停用）就标出来，让用户自己换，不替他换 */
export async function handleModelsGet(req, res, body, params, url) {
  const user = await requireUser(req);
  const fresh = new URL(req.url, 'http://x').searchParams.get('fresh') === '1';
  const models = await modelsOrFail(fresh);
  const { chatModel } = await Users.settings(user.id);
  const saved = chatModel ? models.find((m) => m.id.toLowerCase() === chatModel.toLowerCase()) : null;
  json(res, 200, {
    models,
    chatModel,
    gone: Boolean(chatModel && !saved),
    canPick: PROVIDER === 'gateway' || PROVIDER === 'mock',
  });
}
