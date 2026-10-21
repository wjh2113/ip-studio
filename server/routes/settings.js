/* 路由 · settings：个人设置（模型能力、对话记录保存天数）。登录用户可改，所有账号共用。 */
import { CHAT_KEEP_CHOICES, LLM_PREF_CHOICES, Users } from '../db.js';
import { HttpError } from '../auth.js';
import { invalidateLlmPref } from '../llm.js';
import { json, requireUser } from './common.js';

export async function handleSettingsGet(req, res) {
  const user = await requireUser(req);
  const s = await Users.settings(user.id);
  json(res, 200, {
    llmPref: s.llmPref,
    chatKeepDays: s.chatKeepDays,
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
  if (!Object.keys(patch).length) throw new HttpError(400, '没有要改的设置');
  const s = await Users.setSettings(user.id, patch);
  if (patch.llmPref != null) invalidateLlmPref(user.id);
  json(res, 200, {
    llmPref: s.llmPref,
    chatKeepDays: s.chatKeepDays,
  });
}
