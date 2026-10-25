/* 路由 · editor：编辑器：划词改写、/ 续写、语音改稿、右栏 AI 对话。 */
import { CHAT_KEEP_CHOICES, Chats, Drafts, Personas } from '../db.js';
import { HttpError } from '../auth.js';
import { generateJSON, listModels, parseJSON, streamText } from '../llm.js';
import { transcribeAudio } from '../speak.js';
import { userLimit } from '../limit.js';
import { applyVoiceEdits, ASSIST_ACTIONS, ASSIST_SYSTEM, assistUser, CHAT_EDIT_MAX, CHAT_EDITS_SCHEMA, CHAT_EDITS_SYSTEM, CHAT_MARK, CHAT_SYSTEM, chatEditsUser, chatUser, COMPOSE_ACTIONS, skillBlock, composeUser, VOICE_EDIT_SCHEMA, VOICE_EDIT_SYSTEM, voiceEditUser } from '../prompts.js';
import { chatModelOf, describe, json, requireUser, styleSamples, sys, withRetry, writerMe } from './common.js';
import { openProgressStream, runTextStream } from './stream.js';
import { loadSkill } from './skills.js';

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
    if (body?.action === 'skill') {
      // 作者存的技能：整个技能（正文 + 参考资料）作为一块交给模型
      const k = await loadSkill(body?.skillId, user.id);
      instruction = `按作者的技能「${k.name}」改写选中这段。只改选中这段；技能没要求的地方保持原样，事实和数字不要动。\n\n${skillBlock(k)}`;
    } else if (body?.action === 'custom') {
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

/* ---------------- 编辑器：右栏 AI 对话 ----------------
 * 对话按「稿子 + 版本」存在 chat_messages，保存天数每人自己定（默认 100 天，0 = 一直留）。
 * 模型要局部改稿时回 find / replace：这里只校验、不改正文，作者在对话里点「应用」才写进去（网页端，能撤销）。
 * 要整篇重写时只回整理好的修改意见（rewrite）：作者点「开始重写」后，网页调 /revise（mode=full）流式重写。 */
const CHAT_TURNS = 12;

async function chatDraft(user, params, version) {
  const draft = await Drafts.byId(Number(params.id), user.id);
  if (!draft) throw new HttpError(404, '记录不存在');
  if (version && !draft.variants?.[version]) throw new HttpError(404, '还没有这个平台的版本');
  return draft;
}

const versionOf = (req, body) => String(body?.version ?? new URL(req.url, 'http://x').searchParams.get('version') ?? '');

/* 给网页：只回界面要的字段 */
const chatView = (m) => ({
  id: m.id, role: m.role, content: m.content, quote: m.quote, created_at: m.created_at,
  edits: m.edits || [], rewrite: m.rewrite || '', skipped: m.skipped || [],
  done: m.done || {}, started: Boolean(m.started), model: m.model || null, skill: m.skill || null,
});

export async function handleChatList(req, res, body, params) {
  const user = await requireUser(req);
  const version = versionOf(req);
  await chatDraft(user, params, version);
  const messages = (await Chats.list(Number(params.id), user.id, version)).map(chatView);
  json(res, 200, { messages, keepDays: await Chats.keepDays(user.id) });
}

export async function handleChatClear(req, res, body, params) {
  const user = await requireUser(req);
  const version = versionOf(req);
  await chatDraft(user, params, version);
  await Chats.clear(Number(params.id), user.id, version);
  json(res, 200, { ok: true });
}

/* 记下作者应用了哪几处、整篇重写开没开始；只认这两项 */
export async function handleChatMark(req, res, body, params) {
  const user = await requireUser(req);
  const m = await Chats.byId(Number(params.mid), user.id);
  if (!m || m.role !== 'assistant') throw new HttpError(404, '没有这条对话');
  const n = (m.data.edits || []).length;
  const done = {};
  for (const [k, v] of Object.entries(body?.done || {})) {
    const i = Number(k);
    if (v && Number.isInteger(i) && i >= 0 && i < n) done[i] = true;
  }
  const data = { ...m.data, done };
  if (typeof body?.started === 'boolean' && m.data.rewrite) data.started = body.started;
  await Chats.setData(m.id, user.id, data);
  json(res, 200, { message: chatView({ ...m, ...data }) });
}

/* 兼容旧入口：改对话保存天数请走 PUT /api/settings */
export async function handleChatKeep(req, res, body) {
  const user = await requireUser(req);
  const days = Number(body?.days);
  if (!CHAT_KEEP_CHOICES.includes(days)) throw new HttpError(400, `保存天数只能是 ${CHAT_KEEP_CHOICES.join(' / ')}（0 = 一直留）`);
  await Chats.setKeepDays(user.id, days);
  json(res, 200, { keepDays: days });
}

/* 带回给模型的历史：助手那句后面标上作者有没有应用 */
const historyLine = (m) => {
  if (m.role === 'user') return { role: 'user', content: m.quote ? `（引用：${m.quote.slice(0, 200)}）${m.content}` : m.content };
  const applied = Object.keys(m.done || {}).length;
  const mark = m.rewrite ? (m.started ? '（已整篇重写）' : '（作者还没开始整篇重写）')
    : (m.edits?.length ? (applied ? '（作者已应用）' : '（作者还没应用）') : '');
  return { role: 'assistant', content: `${m.content}${mark}` };
};

export async function handleChat(req, res, body, params) {
  const user = await requireUser(req);
  userLimit(user.id, 'chat', 120, 10 * 60_000);
  const version = versionOf(req, body);
  const draft = await chatDraft(user, params, version);
  if (draft.status === 'writing') throw new HttpError(409, '这篇正在生成，等它写完再聊');

  // 正文以网页上正在看的为准（可能还没存完），没传就用库里的
  const stored = String((version ? draft.variants[version].content : draft.content) || '');
  const text = typeof body?.text === 'string' ? body.text : stored;
  if (!text.trim()) throw new HttpError(400, '还没有正文');
  if (text.length > 20000) throw new HttpError(400, '正文太长，对话改稿先控制在 2 万字以内');

  const quote = String(body?.quote || '').slice(0, 2000).trim();
  // 用技能：整个技能（正文 + 参考资料）交给模型；对话里这一句显示成「用技能「某某」」
  const skill = body?.skillId ? await loadSkill(body.skillId, user.id) : null;
  const message = (String(body?.message ?? '').slice(0, 2000).trim()
    || (skill ? `用技能「${skill.name}」改${quote ? '引用的这段' : '这篇'}` : ''));
  if (!message) throw new HttpError(400, '说点什么吧');

  const past = (await Chats.list(draft.id, user.id, version, CHAT_TURNS)).map((m) => {
    const line = historyLine(m);
    return { ...line, content: line.content.slice(0, line.role === 'user' ? 2000 : 1200) };
  });
  const messages = [...past, { role: 'user', content: message }];

  const persona = (draft.persona_id && await Personas.byId(draft.persona_id, user.id)) || draft.persona;
  const hint = `${draft.subject} ${draft.title || ''} ${quote.slice(0, 200)} ${message.slice(0, 300)}`;
  const samples = await styleSamples(persona, user.id, hint);
  const me = await writerMe(user.id, persona, hint, 'assist');
  const target = { ...draft, platform: version || draft.platform };
  const pick = await chatModelOf(user.id);

  // 校验都在开流之前：坏请求照常回 4xx JSON。
  // 两段式：① 流式只推回话，见到 @@改动@@ 就停上游，避免浏览器空等超长 JSON；② 另开结构化调用出 edits。
  const ps = openProgressStream(res);       // ps.aborted 是 getter：别解构
  const { send, end } = ps;
  try {
    send('start', { version });
    const stopStream = new AbortController();
    let needEdits = false;
    const cut = replyCutter((t) => send('delta', { text: t }), {
      onMark: () => {
        needEdits = true;
        send('status', { phase: 'edits' });
        stopStream.abort();
      },
    });
    let served = '';
    try {
      await streamText({
        meta: { feature: '编辑器对话', userId: user.id, ...(pick ? { model: pick.id } : {}) },
        onServed: (m) => { served = m; },
        system: sys('chat', CHAT_SYSTEM),
        user: chatUser(target, persona, samples, me, { text, messages, quote, skill }),
        mock: () => mockChat(text, message, quote),
        onDelta: cut.push,
        signal: AbortSignal.any([ps.signal, stopStream.signal]),
      });
    } catch (err) {
      if (ps.aborted) return;
      // 见到标记后主动停流：算正常，用已推的回话继续第二段
      if (!(needEdits && (err?.name === 'AbortError' || /中断|aborted/i.test(String(err?.message || ''))))) throw err;
    }
    if (ps.aborted) return;
    cut.flush();
    const said = cut.spoken();
    // 兼容旧模型仍在标记后塞 JSON：有完整清单就直接用，否则走第二段
    const inline = splitChatReply(cut.raw());
    let changes = { edits: [], rewrite: '' };
    const skipped = [];
    if (needEdits || cut.marked) {
      if (!inline.broken && (inline.changes.edits.length || inline.changes.rewrite)) {
        changes = inline.changes;
      } else {
        const out = await generateJSON({
          meta: { feature: '编辑器对话', userId: user.id, ...(pick ? { model: pick.id } : {}) },
          system: sys('chat-edits', CHAT_EDITS_SYSTEM),
          user: chatEditsUser(target, persona, samples, me, { text, messages, quote, skill, said }),
          schema: CHAT_EDITS_SCHEMA,
          mock: () => mockChatEdits(text, message, quote),
          signal: ps.signal,
        });
        if (ps.aborted) return;
        changes = { edits: Array.isArray(out?.edits) ? out.edits : [], rewrite: String(out?.rewrite || '') };
      }
    }

    // 只留能在正文里原样找到的改动；一次最多 CHAT_EDIT_MAX 处
    const capped = takeEdits(changes.edits, skipped);
    const { applied, skipped: miss } = applyVoiceEdits(text, capped);
    skipped.push(...miss);
    const kept = new Set(applied.map((x) => x.find));
    const rewrite = String(changes.rewrite || '').trim().slice(0, 1000);
    const edits = rewrite ? [] : capped
      .map((e) => ({ find: String(e?.find || ''), replace: String(e?.replace ?? ''), all: Boolean(e?.all) }))
      .filter((e) => kept.has(e.find.slice(0, 80)) && e.find !== e.replace);
    const reply = said || (rewrite ? '这要整篇重写，开始吗？' : edits.length ? '改好了，看看下面的改动。' : '');
    if (!reply) throw new HttpError(502, '没有拿到回复，请再试一次');

    // 模型回来了才一起存：失败或中途关掉时这一问不留在记录里，网页上点「重试」再发
    const userMsg = await Chats.add(draft.id, user.id, version, {
      role: 'user', content: message, quote, data: skill ? { skill: { id: skill.id, name: skill.name } } : {},
    });
    const aiMsg = await Chats.add(draft.id, user.id, version, {
      role: 'assistant', content: reply,
      data: { edits, rewrite, skipped: rewrite ? [] : skipped, model: await modelTag(pick, served) },
    });
    send('done', { user: chatView(userMsg), reply: chatView(aiMsg), version });
  } catch (err) {
    // 指定模型调不通就报出来，不偷偷换成自动选路
    const why = pick && err?.upstream
      ? `「${pick.name}」这次没调通（网关 ${err.upstream}），换一个模型或选「自动」再试`
      : describe(err);
    if (!ps.aborted) send('error', { message: why });
  } finally {
    end();
  }
}

/* 这条回话是哪个模型写的：网关给了实际模型就用实际的，查不到展示名就显示 id */
async function modelTag(pick, served) {
  const id = served || pick?.id || '';
  if (!id) return { auto: !pick, id: '', name: '' };
  let name = pick && pick.id.toLowerCase() === id.toLowerCase() ? pick.name : '';
  if (!name) {
    try { name = (await listModels()).find((m) => m.id.toLowerCase() === id.toLowerCase())?.name || id; } catch { name = id; }
  }
  return { auto: !pick, id, name };
}

/* 流式时只把标记之前的回话推出去。标记可能被拆在两段 delta 里：末尾留够标记长度的字先不推。
 * onMark：见到标记时回调（业务侧停上游、开第二段出改动）。 */
export function replyCutter(emit, { onMark } = {}) {
  let buf = '';
  let sent = 0;
  let stopped = false;
  let marked = false;
  const hold = CHAT_MARK.length - 1;
  return {
    push(t) {
      if (stopped) return;
      buf += t;
      const at = buf.indexOf(CHAT_MARK);
      const upto = at >= 0 ? at : Math.max(sent, buf.length - hold);
      if (upto > sent) { emit(buf.slice(sent, upto)); sent = upto; }
      if (at >= 0) {
        stopped = true;
        marked = true;
        onMark?.();
      }
    },
    flush() {
      if (stopped) return;
      if (buf.length > sent) emit(buf.slice(sent));
      sent = buf.length;
    },
    get marked() { return marked; },
    spoken() {
      const at = buf.indexOf(CHAT_MARK);
      return (at >= 0 ? buf.slice(0, at) : buf).trim();
    },
    raw() { return buf; },
  };
}

/* 拆成回话和改动：标记前是回话，后面若有 JSON 则解析（兼容旧模型一次吐完）。
 * 没有标记 = 只是回答；标记后空/坏 JSON = broken，交给第二段结构化调用。 */
export function splitChatReply(raw) {
  const textAll = String(raw || '');
  const at = textAll.indexOf(CHAT_MARK);
  if (at < 0) return { reply: textAll.trim(), changes: { edits: [], rewrite: '' }, broken: false };
  const reply = textAll.slice(0, at).trim();
  const tail = textAll.slice(at + CHAT_MARK.length).trim();
  if (!tail) return { reply, changes: { edits: [], rewrite: '' }, broken: false };
  try {
    const obj = parseJSON(tail);
    return { reply, changes: { edits: Array.isArray(obj?.edits) ? obj.edits : [], rewrite: String(obj?.rewrite || '') }, broken: false };
  } catch {
    return { reply, changes: { edits: [], rewrite: '' }, broken: true };
  }
}

export function takeEdits(edits, skipped = []) {
  const list = Array.isArray(edits) ? edits : [];
  if (list.length > CHAT_EDIT_MAX) {
    skipped.push(`一次最多改 ${CHAT_EDIT_MAX} 处，其余 ${list.length - CHAT_EDIT_MAX} 处下次再说`);
    return list.slice(0, CHAT_EDIT_MAX);
  }
  return list;
}

/* 演示模式第一段：问号结尾只回话；要改则回话 + 标记（不带 JSON，改动走 mockChatEdits） */
function mockChat(text, last, quote) {
  if (/[？?]\s*$/.test(last)) return `（演示模式）这里会回答你的问题：「${last.slice(0, 30)}」。配置模型密钥后生效。`;
  if (/整篇|全文|通篇/.test(last)) return `（演示模式）这要整篇重写：按你的要求从头改一遍。开始吗？\n${CHAT_MARK}`;
  return `（演示模式）按「${last.slice(0, 20)}」改了一处，配置模型密钥后会真的按你的意思改。\n${CHAT_MARK}`;
}

function mockChatEdits(text, last, quote) {
  if (/整篇|全文|通篇/.test(last)) return { edits: [], rewrite: last };
  const para = (quote && text.includes(quote) ? quote : text.split(/\n{2,}/).find((p) => p.trim() && text.split(p).length === 2)) || text;
  return { edits: [{ find: para, replace: `${para}（演示：按你的意思改过）`, all: false }], rewrite: '' };
}

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
