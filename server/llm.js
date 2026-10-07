import { reserve, settle } from './quota.js';
/* 大模型接入层
 *   anthropic —— 官方 SDK（默认 claude-opus-5），结构化输出 + 流式正文
 *   openai    —— 任意 OpenAI 兼容接口（DeepSeek / Kimi / 通义 / vLLM / Ollama）
 *   gateway   —— 站内 AIapiMgr（/api/ai/chat），生产默认走这条，不直连上游密钥
 *   mock      —— 无密钥时的本地模板，保证系统开箱可跑通全流程
 */
import Anthropic from '@anthropic-ai/sdk';

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'deepseek-chat';
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/$/, '');
const OPENAI_KEY = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY || '';
const GATEWAY_URL = (process.env.LLM_GATEWAY_URL || 'https://aiapimgrapi.aidigitcloud.cn').replace(/\/$/, '');
const GATEWAY_KEY = process.env.LLM_GATEWAY_API_KEY || '';
const GATEWAY_TENANT = process.env.LLM_TENANT_ID || 'IP';
const GATEWAY_CAPABILITY = process.env.LLM_CAPABILITY || 'quality-chat';
const GATEWAY_CAPABILITY_JSON = process.env.LLM_CAPABILITY_JSON || 'fast-chat';
// 快档模型：不配就和主模型一样（行为不变）。想省钱时给 fast 档配一个便宜模型即可
const ANTHROPIC_MODEL_FAST = process.env.ANTHROPIC_MODEL_FAST || ANTHROPIC_MODEL;
const OPENAI_MODEL_FAST = process.env.OPENAI_MODEL_FAST || OPENAI_MODEL;

/* 按功能分档：quality = 读者会直接看到的长文、需要判断力的评估；fast = 结构化短输出。
 * 这是调成本和质量的唯一入口——换档只改这张表，不用去各调用点找。
 * 当前取值和拆表前的实际行为完全一致（JSON 默认 fast、文本和流式默认 quality）。 */
export const FEATURE_TIER = {
  成稿: 'quality',
  划词改写: 'quality',
  编辑器续写: 'quality',
  多平台适配: 'quality',
  语气档案: 'quality',
  原文概要: 'quality',
  语音改稿: 'quality',
  口播总评: 'quality',
  选题方向: 'fast',
  '选题方向·换一批': 'fast',
  题材推荐: 'fast',
  热点比对: 'fast',
  成稿检查: 'fast',
  口播提示: 'fast',
  图文配图方案: 'fast',
  标题候选: 'fast',
  范文拆解: 'quality',
  快速建号: 'quality',
  经历拆解: 'fast',
  文章要点: 'fast',
  改稿偏好: 'fast',
};
// 表里没有的功能：按调用方式给默认档；meta.channel === 'quality' 仍可单次指定
const tierOf = (meta, fallback) => (meta.channel === 'quality' ? 'quality'
  : FEATURE_TIER[String(meta.feature || '').replace(/^eval·/, '')] || fallback);
const modelFor = (tier) => (PROVIDER === 'anthropic' ? (tier === 'fast' ? ANTHROPIC_MODEL_FAST : ANTHROPIC_MODEL)
  : PROVIDER === 'openai' ? (tier === 'fast' ? OPENAI_MODEL_FAST : OPENAI_MODEL)
  : PROVIDER === 'gateway' ? (tier === 'fast' ? GATEWAY_CAPABILITY_JSON : GATEWAY_CAPABILITY)
  : 'mock');

/* 每个用户同时最多几个生成请求。额度是先预扣的，但不设上限的话一个人可以
   一口气开几十个流，把上游并发占满。 */
const MAX_INFLIGHT = Number(process.env.LLM_MAX_INFLIGHT_PER_USER) || 3;
const inflight = new Map();

/* 采样参数：1.3 实测在中文长文里会跑出语无伦次的句子，降到 1.0（DeepSeek 的默认值）稳很多。
 * 语气由账号设定和语气档案负责，不靠高温度堆"创意"。可用环境变量微调。 */
const TEMP_PROSE = Number(process.env.LLM_TEMPERATURE) || 1.0;
const TEMP_JSON = Number(process.env.LLM_TEMPERATURE_JSON) || 0.6;
const TOP_P = Number(process.env.LLM_TOP_P) || 0.95;

/* 超时：上游卡住时不能让请求一直挂着（原来要等 nginx 600 秒才断）。
   非流式（选题、检查、口播提示等 JSON）默认 120 秒；流式成稿默认 360 秒。 */
const CALL_TIMEOUT = Number(process.env.LLM_TIMEOUT_MS) || 120_000;
const STREAM_TIMEOUT = Number(process.env.LLM_STREAM_TIMEOUT_MS) || 360_000;
const withTimeout = (signal, ms) => (signal
  ? AbortSignal.any([signal, AbortSignal.timeout(ms)])
  : AbortSignal.timeout(ms));

/* 中途失败或被用户中断时，按已经收到的字数估算用量扣点——
   否则「边生成边关页面」可以白嫖大半篇。估算偏保守：输入每字 0.6 token、输出每字 1 token。 */
const estimateTokens = (inputChars, outputChars) =>
  Math.ceil((inputChars || 0) * 0.6 + (outputChars || 0) * 1.0);

function detectProvider() {
  const forced = (process.env.LLM_PROVIDER || '').toLowerCase();
  if (forced) return forced;
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) return 'anthropic';
  if (GATEWAY_KEY) return 'gateway';
  if (OPENAI_KEY) return 'openai';
  return 'mock';
}

export const PROVIDER = detectProvider();

export function providerInfo() {
  const model = PROVIDER === 'anthropic' ? ANTHROPIC_MODEL
    : PROVIDER === 'openai' ? OPENAI_MODEL
    : PROVIDER === 'gateway' ? GATEWAY_CAPABILITY
    : '本地模板';
  const label = {
    anthropic: 'Claude',
    openai: 'OpenAI 兼容接口',
    gateway: 'AIapiMgr 网关',
    mock: '演示模式（未配置密钥）',
  }[PROVIDER] || PROVIDER;
  return { provider: PROVIDER, model, label, live: PROVIDER !== 'mock' };
}

let _anthropic;
const anthropic = () => (_anthropic ||= new Anthropic());

/* ------------------------------------------------------------------ *
 * 用量埋点：由 index.js 注入落库函数，这一层不直接依赖 db
 * ------------------------------------------------------------------ */
let usageSink = null;
export const setUsageSink = (fn) => { usageSink = fn; };

/* 配额在这里统一拦，不在十几个调用点各写一遍——那样一定会漏一个。
   eval 跑批不占用户额度（它是后台行为，成本记在管理员头上）。

   额度是「预扣 → 结算」：调用前锁住该用户的额度行，检查并先扣一笔预估，
   调完按真实用量多退少补。并发上限先占名额再去等数据库，避免两个请求一起挤进来。 */
async function tracked(meta, run) {
  const started = Date.now();
  const model = modelFor(meta.tier);
  const metered = meta.userId && !String(meta.feature || '').startsWith('eval');
  let hold = 0;
  if (metered) {
    const n = inflight.get(meta.userId) || 0;
    if (n >= MAX_INFLIGHT) {
      const err = new Error(`同时进行的生成太多了（最多 ${MAX_INFLIGHT} 个），等前面的完成再试`);
      err.status = 429;
      throw err;
    }
    inflight.set(meta.userId, n + 1);
    try {
      hold = (await reserve(meta.userId, '文案')).held;   // 额度不够在这里抛 402
    } catch (err) {
      if (n > 0) inflight.set(meta.userId, n);
      else inflight.delete(meta.userId);
      throw err;
    }
  }
  try {
    const { value, usage } = await run();
    const tokens = (usage?.input || 0) + (usage?.output || 0);
    usageSink?.({
      ...meta, provider: PROVIDER, model, ok: true, ms: Date.now() - started,
      inputTokens: usage?.input || 0, outputTokens: usage?.output || 0,
      units: tokens, unit: 'token',
    });
    if (metered) await settle(meta.userId, '文案', hold, tokens);
    return value;
  } catch (err) {
    const partial = Number(err?.partialChars) || 0;
    // 演示模式本来就不计费，中断也不估
    const est = partial > 0 && PROVIDER !== 'mock' ? estimateTokens(meta.inputChars, partial) : 0;
    usageSink?.({
      ...meta, provider: PROVIDER, model, ok: false, ms: Date.now() - started,
      error: String(err?.message || err),
      ...(est ? { units: est, unit: 'token' } : {}),
    });
    if (metered) await settle(meta.userId, '文案', hold, est);   // 失败退回预扣，中断按估算收
    throw err;
  } finally {
    if (metered) {
      const n = (inflight.get(meta.userId) || 1) - 1;
      if (n > 0) inflight.set(meta.userId, n); else inflight.delete(meta.userId);
    }
  }
}

/* ------------------------------------------------------------------ *
 * 结构化生成：返回符合 schema 的对象
 * ------------------------------------------------------------------ */
export async function generateJSON({ system, user, schema, mock, meta = {} }) {
  const tier = tierOf(meta, 'fast');
  return tracked({ feature: 'unknown', ...meta, tier }, async () => {
    if (PROVIDER === 'mock') return { value: mock(), usage: null };

    if (PROVIDER === 'anthropic') {
      const res = await anthropic().messages.create({
        model: modelFor(tier),
        max_tokens: 16000,
        system,
        messages: [{ role: 'user', content: user }],
        output_config: { format: { type: 'json_schema', schema }, effort: 'medium' },
      }, { timeout: CALL_TIMEOUT });
      const text = res.content.find((b) => b.type === 'text')?.text || '';
      return {
        value: parseJSON(text),
        usage: { input: res.usage?.input_tokens, output: res.usage?.output_tokens },
      };
    }

    const res = await chat({
      system,
      user: `${user}\n\n只输出一个 JSON 对象，不要任何解释或代码块标记。JSON Schema：\n${JSON.stringify(schema)}`,
      stream: false,
      temperature: TEMP_JSON,    // 结构化输出用低温度，减少格式跑偏
      responseFormat: { type: 'json_object' },
      json: true,
      capability: tier,     // 档位见 FEATURE_TIER
      userId: meta.userId,
    });
    return { value: parseJSON(res.text), usage: res.usage };
  });
}

/* ------------------------------------------------------------------ *
 * 一次性文本生成（不流式）：用于语气档案这类短输出
 * ------------------------------------------------------------------ */
export async function generateText({ system, user, mock, meta = {} }) {
  const tier = tierOf(meta, 'quality');
  return tracked({ feature: 'unknown', ...meta, tier }, async () => {
    if (PROVIDER === 'mock') return { value: mock(), usage: null };

    if (PROVIDER === 'anthropic') {
      const res = await anthropic().messages.create({
        model: modelFor(tier),
        max_tokens: 4000,
        system,
        messages: [{ role: 'user', content: user }],
        output_config: { effort: 'medium' },
      }, { timeout: CALL_TIMEOUT });
      return {
        value: res.content.filter((b) => b.type === 'text').map((b) => b.text).join(''),
        usage: { input: res.usage?.input_tokens, output: res.usage?.output_tokens },
      };
    }

    const res = await chat({ system, user, stream: false, userId: meta.userId, capability: tier });
    return { value: res.text, usage: res.usage };
  });
}

/* ------------------------------------------------------------------ *
 * 流式正文：逐段回调 onDelta，返回完整文本
 * ------------------------------------------------------------------ */
export async function streamText({ system, user, onDelta, mock, signal, meta = {} }) {
  let sent = 0;
  const count = (text) => { sent += text.length; onDelta(text); };
  const inputChars = String(system || '').length + String(user || '').length;
  const tier = tierOf(meta, 'quality');
  return tracked({ feature: 'unknown', ...meta, inputChars, tier }, async () => {
    try {
      return await streamOnce({ system, user, onDelta: count, mock, signal, userId: meta.userId, tier });
    } catch (err) {
      // 带上已收到的字数，tracked() 据此估算扣点
      if (err && typeof err === 'object') err.partialChars = sent;
      throw err;
    }
  });
}

async function streamOnce({ system, user, onDelta, mock, signal, userId, tier = 'quality' }) {
  if (PROVIDER === 'mock') return { value: await streamMock(mock(), onDelta, signal), usage: null };

  if (PROVIDER === 'anthropic') {
    const stream = anthropic().messages.stream(
      {
        model: modelFor(tier),
        max_tokens: 16000,
        system,
        messages: [{ role: 'user', content: user }],
        output_config: { effort: 'medium' },
      },
      { signal, timeout: STREAM_TIMEOUT },
    );
    let full = '';
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        full += event.delta.text;
        onDelta(event.delta.text);
      }
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal') {
      throw new Error(`模型拒绝了该请求（${final.stop_details?.category || '未说明原因'}）`);
    }
    return {
      value: full,
      usage: { input: final.usage?.input_tokens, output: final.usage?.output_tokens },
    };
  }

  const res = await chat({ system, user, stream: true, onDelta, signal, userId, capability: tier });
  return { value: res.text, usage: res.usage };
}

/* ------------------------------------------------------------------ *
 * OpenAI 兼容协议 + 站内网关
 * ------------------------------------------------------------------ */
async function chat(opts) {
  if (PROVIDER === 'gateway') return gatewayChat(opts);
  return openaiChat(opts);
}

async function gatewayChat({
  system, user, stream, onDelta, signal, temperature = TEMP_PROSE, json = false, capability, userId,
}) {
  const res = await fetch(`${GATEWAY_URL}/api/ai/chat`, {
    method: 'POST',
    signal: withTimeout(signal, stream ? STREAM_TIMEOUT : CALL_TIMEOUT),
    headers: {
      'Content-Type': 'application/json',
      ...(GATEWAY_KEY ? { Authorization: `Bearer ${GATEWAY_KEY}` } : {}),
    },
    body: JSON.stringify({
      tenantId: GATEWAY_TENANT,
      capability: capability === 'quality' ? GATEWAY_CAPABILITY
        : capability === 'fast' ? GATEWAY_CAPABILITY_JSON
          : (json ? GATEWAY_CAPABILITY_JSON : GATEWAY_CAPABILITY),
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      dataClass: 'internal',
      fallback: true,
      stream: Boolean(stream),
      temperature,
      ...(userId ? { userId: String(userId) } : {}),
    }),
  });
  return readChatResponse(res, stream, onDelta);
}

async function openaiChat({
  system, user, stream, onDelta, responseFormat, signal, temperature = TEMP_PROSE, capability,
}) {
  const res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: 'POST',
    signal: withTimeout(signal, stream ? STREAM_TIMEOUT : CALL_TIMEOUT),
    headers: {
      'Content-Type': 'application/json',
      ...(OPENAI_KEY ? { Authorization: `Bearer ${OPENAI_KEY}` } : {}),
    },
    body: JSON.stringify({
      model: capability === 'fast' ? OPENAI_MODEL_FAST : OPENAI_MODEL,
      stream: Boolean(stream),
      temperature,
      top_p: TOP_P,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      ...(stream ? { stream_options: { include_usage: true } } : {}),
      ...(responseFormat ? { response_format: responseFormat } : {}),
    }),
  });
  return readChatResponse(res, stream, onDelta);
}

async function readChatResponse(res, stream, onDelta) {
  if (!res.ok) {
    throw new Error(`上游接口返回 ${res.status}：${(await res.text()).slice(0, 300)}`);
  }

  if (!stream) {
    const data = await res.json();
    return {
      text: data.choices?.[0]?.message?.content || '',
      usage: { input: data.usage?.prompt_tokens, output: data.usage?.completion_tokens },
    };
  }

  let full = '';
  let buf = '';
  let usage = null;
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const chunk = JSON.parse(payload);
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) { full += delta; onDelta?.(delta); }
        // 开了 include_usage 之后，用量在最后一个 chunk 里
        if (chunk.usage) usage = { input: chunk.usage.prompt_tokens, output: chunk.usage.completion_tokens };
      } catch { /* 忽略心跳等非 JSON 行 */ }
    }
  }
  return { text: full, usage };
}

/* ------------------------------------------------------------------ *
 * 工具
 * ------------------------------------------------------------------ */
export function parseJSON(text) {
  const cleaned = String(text).replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(cleaned); } catch { /* 继续尝试截取 */ }
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { /* fallthrough */ }
  }
  throw new Error('模型没有返回可解析的 JSON');
}

async function streamMock(text, onDelta, signal) {
  for (let i = 0; i < text.length; i += 12) {
    // 和真实通道一致：被中断就抛错，而不是假装写完了
    if (signal?.aborted) throw Object.assign(new Error('已中断'), { name: 'AbortError' });
    onDelta(text.slice(i, i + 12));
    await new Promise((r) => setTimeout(r, 18));
  }
  return text;
}
