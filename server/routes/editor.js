/* 路由 · editor：编辑器：划词改写、/ 续写、语音改稿。从原 routes.js 原样拆出。 */
import { Drafts, Personas } from '../db.js';
import { HttpError } from '../auth.js';
import { generateJSON, streamText } from '../llm.js';
import { transcribeAudio } from '../speak.js';
import { applyVoiceEdits, ASSIST_ACTIONS, ASSIST_SYSTEM, assistUser, COMPOSE_ACTIONS, composeUser, VOICE_EDIT_SCHEMA, VOICE_EDIT_SYSTEM, voiceEditUser } from '../prompts.js';
import { describe, json, requireUser, styleSamples, sys, withRetry } from './common.js';

/* ---------------- 编辑器：划词改写 / 唤起续写 ---------------- */

export async function handleAssist(req, res, body, params) {
  const user = requireUser(req);
  const draft = Drafts.byId(Number(params.id), user.id);
  if (!draft) throw new HttpError(404, '记录不存在');

  const clip = (v, n) => String(v ?? '').slice(0, n);
  const selection = clip(body?.selection, 4000);
  const before = clip(body?.before, 1500);
  const after = clip(body?.after, 1500);

  // 账号还在就用最新设定，否则退回创作时的快照
  const persona = (draft.persona_id && Personas.byId(draft.persona_id, user.id)) || draft.persona;
  const samples = styleSamples(persona, user.id);

  let instruction;
  let user_prompt;
  if (body?.kind === 'compose') {
    instruction = COMPOSE_ACTIONS[body.action]?.instruction
      || clip(body?.instruction, 500).trim();
    if (!instruction) throw new HttpError(400, '请说明要写什么');
    user_prompt = composeUser(draft, persona, samples, { instruction, before, after });
  } else {
    const action = ASSIST_ACTIONS[body?.action];
    if (!action) throw new HttpError(400, '不支持的操作');
    if (!selection.trim()) throw new HttpError(400, '请先选中一段文字');
    instruction = action.instruction;
    user_prompt = assistUser(draft, persona, samples, { instruction, selection, before, after });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const controller = new AbortController();
  // 用 res 的 close 判断前端断开：req 的 close 在请求体读完时就已触发，监听它等于永远收不到
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });

  try {
    const text = await streamText({
      meta: { feature: body?.kind === 'compose' ? '编辑器续写' : '划词改写', userId: user.id },
      system: sys('assist', ASSIST_SYSTEM),
      user: user_prompt,
      onDelta: (t) => send('delta', { text: t }),
      mock: () => mockAssist(body, selection),
      signal: controller.signal,
    });
    send('done', { text });
  } catch (err) {
    if (!controller.signal.aborted) send('error', { message: describe(err) });
  } finally {
    res.end();
  }
}

const mockAssist = (body, selection) => {
  const label = ASSIST_ACTIONS[body?.action]?.label || COMPOSE_ACTIONS[body?.action]?.label || '自定义指令';
  return body?.kind === 'compose'
    ? `（演示模式 · ${label}）这里会由大模型按账号语气就地续写一段。配置模型密钥后生效。`
    : `（演示模式 · ${label}）${selection}`;
};

/* 语音改稿：转写是修改要求。只套用能在正文里对上的 find，对不上的丢掉。 */
export async function handleVoiceEdit(req, res, file, params) {
  const user = requireUser(req);
  const draft = Drafts.byId(Number(params.id), user.id);
  if (!draft) throw new HttpError(404, '记录不存在');
  const content = String(draft.content || '');
  if (!content.trim()) throw new HttpError(400, '还没有正文');
  if (content.length > 20000) throw new HttpError(400, '正文太长，语音改稿先控制在 2 万字以内');

  let transcript = '';
  try {
    const tr = await transcribeAudio(file.buffer, {
      filename: `voice.${file.ext}`,
      mime: file.mime,
      userId: user.id,
      script: content,
    });
    transcript = String(tr.text || '').trim();
  } catch (err) {
    throw new HttpError(502, String(err?.message || err));
  }
  if (transcript.length < 2) throw new HttpError(400, '没有听清，请再说一次');

  const data = await withRetry(async () => {
    const out = await generateJSON({
      meta: { feature: '语音改稿', userId: user.id, channel: 'quality' },
      system: sys('voice-edit', VOICE_EDIT_SYSTEM),
      user: voiceEditUser(draft, transcript),
      schema: VOICE_EDIT_SCHEMA,
      mock: () => ({
        note: '演示模式：这里会复述听懂的修改要求',
        edits: [{ find: content.slice(0, Math.min(12, content.length)), replace: content.slice(0, Math.min(12, content.length)), all: false }],
      }),
    });
    if (!out || !Array.isArray(out.edits)) throw new HttpError(502, '没有拿到修改方案');
    return out;
  }, '语音改稿失败，请再试一次');

  const result = applyVoiceEdits(content, data.edits);
  json(res, 200, {
    transcript,
    note: String(data.note || '').trim(),
    applied: result.applied,
    skipped: result.skipped,
    content: result.content,
    changed: result.content !== content,
  });
}
