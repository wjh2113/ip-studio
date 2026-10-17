/* 路由 · editor：编辑器：划词改写、/ 续写、语音改稿。从原 routes.js 原样拆出。 */
import { Drafts, Personas } from '../db.js';
import { HttpError } from '../auth.js';
import { generateJSON } from '../llm.js';
import { transcribeAudio } from '../speak.js';
import { userLimit } from '../limit.js';
import { applyVoiceEdits, ASSIST_ACTIONS, ASSIST_SYSTEM, assistUser, COMPOSE_ACTIONS, composeUser, VOICE_EDIT_SCHEMA, VOICE_EDIT_SYSTEM, voiceEditUser } from '../prompts.js';
import { json, requireUser, styleSamples, sys, withRetry, writerMe } from './common.js';
import { openProgressStream, runTextStream } from './stream.js';

/* ---------------- 编辑器：划词改写 / 唤起续写 ---------------- */

export async function handleAssist(req, res, body, params) {
  const user = await requireUser(req);
  const draft = await Drafts.byId(Number(params.id), user.id);
  if (!draft) throw new HttpError(404, '记录不存在');

  const clip = (v, n) => String(v ?? '').slice(0, n);
  const selection = clip(body?.selection, 4000);
  const before = clip(body?.before, 1500);
  const after = clip(body?.after, 1500);

  // 账号还在就用最新设定，否则退回创作时的快照
  const persona = (draft.persona_id && await Personas.byId(draft.persona_id, user.id)) || draft.persona;
  const hint = `${draft.subject} ${draft.title || ''} ${selection.slice(0, 300)} ${before.slice(-300)}`;
  const samples = await styleSamples(persona, user.id, hint);
  const me = await writerMe(user.id, persona, hint, 'assist');

  let instruction;
  let user_prompt;
  if (body?.kind === 'compose') {
    instruction = COMPOSE_ACTIONS[body.action]?.instruction
      || clip(body?.instruction, 500).trim();
    if (!instruction) throw new HttpError(400, '请说明要写什么');
    user_prompt = composeUser(draft, persona, samples, { instruction, before, after }, me);
  } else {
    if (!selection.trim()) throw new HttpError(400, '请先选中一段文字');
    if (body?.action === 'custom') {
      // 按作者自己写的意见改这一段：意见当数据放进提示词，前后各加一句约束
      const want = clip(body?.instruction, 500).trim();
      if (!want) throw new HttpError(400, '写一下想怎么改');
      instruction = `按作者的修改意见改写选中这段。作者的意见：「${want}」。只改选中这段；意见没提到的地方保持原样，事实和数字不要动。`;
    } else {
      const action = ASSIST_ACTIONS[body?.action];
      if (!action) throw new HttpError(400, '不支持的操作');
      instruction = action.instruction;
    }
    user_prompt = assistUser(draft, persona, samples, { instruction, selection, before, after }, me);
  }

  await runTextStream(res, {
    start: () => ({ kind: body?.kind === 'compose' ? 'compose' : 'assist' }),
    stream: {
      meta: { feature: body?.kind === 'compose' ? '编辑器续写' : '划词改写', userId: user.id },
      system: sys('assist', ASSIST_SYSTEM),
      user: user_prompt,
      mock: () => mockAssist(body, selection),
    },
    after: (text) => ({ text }),
  });
}

const mockAssist = (body, selection) => {
  const label = ASSIST_ACTIONS[body?.action]?.label || COMPOSE_ACTIONS[body?.action]?.label || '自定义指令';
  return body?.kind === 'compose'
    ? `（演示模式 · ${label}）这里会由大模型按账号语气就地续写一段。配置模型密钥后生效。`
    : `（演示模式 · ${label}）${selection}`;
};

/* 语音改稿：转写是修改要求。只套用能在正文里对上的 find，对不上的丢掉。 */
/* 语音记灵感：一段录音转成文字，不落盘、不碰稿子。手机端「语音记」用，转出来的字用户还能改 */
export async function handleTranscribe(req, res, file) {
  const user = await requireUser(req);
  userLimit(user.id, 'transcribe', 60, 10 * 60_000);
  if (!file?.buffer?.length) throw new HttpError(400, '没有收到录音');
  let text = '';
  try {
    text = String((await transcribeAudio(file.buffer, { filename: `note.${file.ext}`, mime: file.mime, userId: user.id })).text || '').trim();
  } catch (err) {
    throw new HttpError(502, String(err?.message || err));
  }
  if (text.length < 2) throw new HttpError(400, '没有听清，请再说一次');
  json(res, 200, { text });
}

export async function handleVoiceEdit(req, res, file, params) {
  const user = await requireUser(req);
  const draft = await Drafts.byId(Number(params.id), user.id);
  if (!draft) throw new HttpError(404, '记录不存在');
  // ?version=xiaohongshu：改的是那个平台版本（编辑框正开着它）；不带就是原文
  const version = String(new URL(req.url, 'http://x').searchParams.get('version') || '');
  if (version && !draft.variants?.[version]) throw new HttpError(404, '还没有这个平台的版本');
  const content = String((version ? draft.variants[version].content : draft.content) || '');
  if (!content.trim()) throw new HttpError(400, '还没有正文');
  if (content.length > 20000) throw new HttpError(400, '正文太长，语音改稿先控制在 2 万字以内');

  // 网页带 Accept: text/event-stream 看进度；手机和单测仍收一整包 JSON
  const wantSSE = String(req.headers.accept || '').includes('text/event-stream');
  const stream = wantSSE ? openProgressStream(res) : null;
  const progress = (step, label) => { if (stream) stream.send('progress', { step, label }); };

  try {
    progress('transcribe', '转写中…');
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
    if (stream?.aborted) return;

    progress('understand', '理解中…');
    const data = await withRetry(async () => {
      const out = await generateJSON({
        // 改稿方案走快档：结构化短输出，转写已经花过时间
        meta: { feature: '语音改稿', userId: user.id },
        system: sys('voice-edit', VOICE_EDIT_SYSTEM),
        user: voiceEditUser({ ...draft, content, platform: version || draft.platform }, transcript),
        schema: VOICE_EDIT_SCHEMA,
        mock: () => ({
          note: '演示模式：这里会复述听懂的修改要求',
          edits: [{ find: content.slice(0, Math.min(12, content.length)), replace: content.slice(0, Math.min(12, content.length)), all: false }],
        }),
      });
      if (!out || !Array.isArray(out.edits)) throw new HttpError(502, '没有拿到修改方案');
      return out;
    }, '语音改稿失败，请再试一次');
    if (stream?.aborted) return;

    progress('apply', '改写中…');
    const result = applyVoiceEdits(content, data.edits);
    const payload = {
      transcript,
      note: String(data.note || '').trim(),
      applied: result.applied,
      skipped: result.skipped,
      content: result.content,
      changed: result.content !== content,
      version,
    };
    if (stream) stream.send('done', payload);
    else json(res, 200, payload);
  } catch (err) {
    if (stream) {
      if (!stream.aborted) stream.send('error', { message: String(err?.message || err) });
    } else {
      throw err;
    }
  } finally {
    stream?.end();
  }
}
