/* 路由 · admin：管理后台：登录与首次设置、用量概览、提示词目录、运行时配置、A/B 变体与 eval。从原 routes.js 原样拆出。 */
import { Admins, Drafts, Evals, Usage, Users, Variants } from '../db.js';
import { adoption, median } from '../quality.js';
import { accessGateOn, accessUsername, isUniqueViolation, adminCookie, adminLogin, adminSetupNeeded, clearAdminCookie, createAdmin, currentAdmin, HttpError, publicAdmin, setupHttpEnabled, startAdminSession, validateCredentials } from '../auth.js';
import { generateJSON, generateText, providerInfo } from '../llm.js';
import { costOf, priceOf } from '../pricing.js';
import { scoreText, scoreTopics, summarize } from '../abtest.js';
import { payInfo } from '../pay.js';
import { conf, save as saveSetting, status as settingsStatus } from '../settings.js';
import { hasKey } from '../secrets.js';
import { mockContent, mockTopics } from '../mock.js';
import {
  ADAPT_SYSTEM, ARTICLE_SUMMARY_SYSTEM, ASSIST_ACTIONS, ASSIST_SYSTEM, COMPOSE_ACTIONS, CONTENT_SYSTEM, CUES_SCHEMA, CUES_SYSTEM, DEFAULT_PLATFORM, DEFAULT_TONE, DIGEST_SYSTEM, HOTSPOT_SCHEMA, HOTSPOT_SYSTEM, ILLUS_SCHEMA, ILLUS_SYSTEM, PLATFORMS, REVIEW_SCHEMA, REVIEW_SYSTEM, SPEAK_REVIEW_SCHEMA, SPEAK_REVIEW_SYSTEM, SUBJECTS_SCHEMA, SUBJECTS_SYSTEM, TITLES_SCHEMA, TITLES_SYSTEM, TOPICS_SCHEMA, TOPICS_SYSTEM, VOICE_EDIT_SCHEMA, VOICE_EDIT_SYSTEM, contentUser, topicsUser,
} from '../prompts.js';
import { json, requireAdmin, sys } from './common.js';

/* ---- 管理员登录 ---- */

export async function handleAdminSession(req, res) {
  const admin = await currentAdmin(req);
  const needs = await adminSetupNeeded();
  json(res, 200, {
    admin: admin ? publicAdmin(admin) : null,
    needsSetup: needs && setupHttpEnabled(),
    setupLocked: needs && !setupHttpEnabled(),
    gate: accessGateOn(),
  });
}

/* 首次设置：只在一个管理员都没有的时候开放 */
export async function handleAdminSetup(req, res, body) {
  if (!await adminSetupNeeded()) throw new HttpError(403, '管理员已存在，无法再次初始化');
  if (!setupHttpEnabled()) {
    throw new HttpError(403, '公网已关闭首次设置，请用服务器环境变量初始化管理员');
  }
  const expected = String(process.env.ADMIN_SETUP_TOKEN || '');
  if (expected && String(body?.setup_token || '') !== expected) {
    throw new HttpError(403, '初始化口令不正确');
  }
  const { username, password } = body || {};
  // 先查长度，免得报出前台那套「至少 6 位」和后台表单写的 8 位对不上
  if (String(password || '').length < 8) throw new HttpError(400, '管理员密码至少 8 位');
  const bad = validateCredentials(username, password);
  if (bad) throw new HttpError(400, bad);

  const admin = await createAdmin(String(username).trim(), String(password));
  json(res, 200, { admin: publicAdmin(admin) },
    { 'Set-Cookie': adminCookie(await startAdminSession(admin)) });
}

export async function handleAdminLogin(req, res, body) {
  const password = String(body?.password || '');
  /* 有访问门时后台页只填密码：用户名取 ADMIN_USERNAME，但密码校验的是管理员自己的密码，
     不再接受访问密码——知道访问密码不等于是管理员。 */
  if (accessGateOn() && !String(body?.username || '').trim()) {
    if (!password) throw new HttpError(400, '请输入管理员密码');
    const name = String(process.env.ADMIN_USERNAME || 'admin').trim() || 'admin';
    const admin = await adminLogin(name, password);
    json(res, 200, { admin: publicAdmin(admin) },
      { 'Set-Cookie': adminCookie(await startAdminSession(admin)) });
    return;
  }
  const { username } = body || {};
  if (!username || !password) throw new HttpError(400, '请输入用户名和密码');
  const admin = await adminLogin(String(username).trim(), password);
  json(res, 200, { admin: publicAdmin(admin) },
    { 'Set-Cookie': adminCookie(await startAdminSession(admin)) });
}

export async function handleAdminLogout(req, res) {
  json(res, 200, { ok: true }, { 'Set-Cookie': clearAdminCookie() });
}

export async function handleAdminOverview(req, res, body, params, url) {
  await requireAdmin(req);
  const days = Math.min(90, Math.max(1, Number(url?.searchParams.get('days')) || 7));
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const usageByUser = new Map((await Usage.byUser(since)).map((u) => [u.user_id, u]));
  const users = (await Users.overview()).map((u) => ({
    ...u,
    calls: usageByUser.get(u.id)?.calls || 0,
    tokens: usageByUser.get(u.id)?.tokens || 0,
    last_call_at: usageByUser.get(u.id)?.last_at || null,
  }));

  const totals = await Usage.totals(since);
  json(res, 200, {
    days,
    llm: providerInfo(),
    admins: await Admins.list(),
    users,
    totals: {
      calls: totals.calls || 0,
      okCalls: totals.ok_calls || 0,
      inputTokens: totals.input_tokens || 0,
      outputTokens: totals.output_tokens || 0,
      avgMs: Math.round(totals.avg_ms || 0),
    },
    byFeature: await Usage.byFeature(since),
    byDay: await Usage.byDay(since),
    errors: await Usage.recentErrors(15),
    cost: await costReport(since),
    quality: await qualityReport(since),
  });
}

/* 线上质量指标：作者把初稿改掉了多少、检查提的建议改了多少。按成稿提示词的 A/B 变体分开看——
   变体 B 的稿子作者改得少、建议照着改得多，比 eval 里人打的分更接近真实效果。 */
export async function qualityReport(since) {
  const groups = new Map();
  const bucket = (key) => {
    if (!groups.has(key)) groups.set(key, { variant: key, drafts: 0, ratios: [], issues: 0, changed: 0, applied: 0 });
    return groups.get(key);
  };
  for (const r of await Drafts.qualityRows(since)) {
    let review = null;
    try { review = JSON.parse(r.review_json); } catch { /* 脏数据当没检查过 */ }
    const a = adoption(review?.issues, r.content);
    for (const g of [bucket('全部'), bucket(r.gen_variant || '默认')]) {
      g.drafts += 1;
      if (r.edit_ratio != null) g.ratios.push(r.edit_ratio);
      g.issues += a.total;
      g.changed += a.changed;
      g.applied += a.applied;
    }
  }
  const rows = [...groups.values()].map((g) => ({
    variant: g.variant,
    drafts: g.drafts,
    editMedian: g.ratios.length ? Math.round(median(g.ratios) * 100) / 100 : null,
    heavy: g.ratios.length ? Math.round((g.ratios.filter((x) => x > 0.3).length / g.ratios.length) * 100) / 100 : null,
    untouched: g.ratios.length ? Math.round((g.ratios.filter((x) => x === 0).length / g.ratios.length) * 100) / 100 : null,
    issues: g.issues,
    changed: g.changed,
    applied: g.applied,
    adoptRate: g.issues ? Math.round((g.changed / g.issues) * 100) / 100 : null,
  }));
  // 「全部」放第一行，其余按篇数
  rows.sort((a, b) => (a.variant === '全部' ? -1 : b.variant === '全部' ? 1 : b.drafts - a.drafts));
  return {
    rows,
    note: '改动比例按句子算：初稿里原样留下的句子占多少字。检查建议「改了」= 被点名的原句已不在正文里，「照着改」= 建议的写法出现在正文里。只统计这段时间里有更新、且有模型初稿的稿子。',
  };
}

/* 成本估算。**只是估算**——单价会调、有阶梯、有免费额度，
   所以每一行都标出用了哪个单价、是不是精确匹配到型号，算不出来的如实写"未计价"。 */
async function costReport(since) {
  const rows = (await Usage.byModel(since)).map((r) => {
    const c = costOf(r);
    const p = priceOf(r.model);
    return {
      ...r,
      yuan: c ? +c.yuan.toFixed(2) : null,
      demo: String(r.provider || '').toLowerCase() === 'mock',
      price: p ? `${p.price} 元 / ${p.per === 1 ? '' : p.per}${p.unit}` : '',
      free: p?.free || '',
      exact: p?.exact ?? false,
      note: p?.note || '',
    };
  });
  const total = rows.reduce((n, r) => n + (r.yuan || 0), 0);
  return {
    rows,
    total: +total.toFixed(2),
    unpriced: rows.filter((r) => r.yuan === null).length,
    note: '按各家官网公示单价估算，未扣免费额度；真实账单以服务商控制台为准。',
  };
}

/* 每个功能实际发给模型的 system 提示词，只读展示 */
const PROMPT_CATALOG = () => [
  { key: 'topics', label: '选题方向', where: '创作第一步：题材 → 三个方向',
    system: sys('topics', TOPICS_SYSTEM), schema: TOPICS_SCHEMA },
  { key: 'content', label: '成稿', where: '创作第二步：选定方向 → 完整文案（流式）',
    system: sys('content', CONTENT_SYSTEM) },
  { key: 'assist', label: '划词改写 / 续写', where: '编辑器里选中文字或按 /',
    system: sys('assist', ASSIST_SYSTEM),
    extra: {
      改写动作: Object.fromEntries(Object.entries(ASSIST_ACTIONS).map(([k, v]) => [v.label, v.instruction])),
      续写动作: Object.fromEntries(Object.entries(COMPOSE_ACTIONS).map(([k, v]) => [v.label, v.instruction])),
    } },
  { key: 'voice-edit', label: '语音改稿', where: '修改模式里按住话筒说改哪里、怎么改。转写走 speech，理解走 quality-chat',
    system: sys('voice-edit', VOICE_EDIT_SYSTEM), schema: VOICE_EDIT_SCHEMA },
  { key: 'review', label: '成稿检查', where: '出稿后自动跑 + 工具栏「检查」',
    system: sys('review', REVIEW_SYSTEM), schema: REVIEW_SCHEMA },
  { key: 'subjects', label: '题材推荐', where: '创作简报里的三条推荐题材',
    system: sys('subjects', SUBJECTS_SYSTEM), schema: SUBJECTS_SCHEMA },
  { key: 'hotspot', label: '热点比对', where: '热点板块：榜单 × 账号定位',
    system: sys('hotspot', HOTSPOT_SYSTEM), schema: HOTSPOT_SCHEMA },
  { key: 'summary', label: '原文概要', where: '热点命中后压缩抓到的原文',
    system: sys('summary', ARTICLE_SUMMARY_SYSTEM) },
  { key: 'digest', label: '语气档案', where: '「喂给账号学习」后蒸馏写作习惯',
    system: sys('digest', DIGEST_SYSTEM) },
  { key: 'cues', label: '口播提示', where: '成稿后切段并标语气/重读/停顿/表情/动作',
    system: sys('cues', CUES_SYSTEM), schema: CUES_SCHEMA },
  { key: 'titles', label: '标题候选', where: '成稿「确认 → 起标题」：按不同写法出 6 个',
    system: sys('titles', TITLES_SYSTEM), schema: TITLES_SCHEMA },
  { key: 'speak-review', label: '口播总评', where: '口播页上传录音后。走 quality-chat，不走 fast-chat',
    system: sys('speak-review', SPEAK_REVIEW_SYSTEM), schema: SPEAK_REVIEW_SCHEMA },
  { key: 'adapt', label: '多平台适配', where: '成稿后出其他平台版本',
    system: sys('adapt', ADAPT_SYSTEM) },
  { key: 'illus', label: '图文配图', where: '正文里的 <此处放图片>，或自动排插图位',
    system: sys('illus', ILLUS_SYSTEM), schema: ILLUS_SCHEMA },
];

export async function handleAdminPrompts(req, res) {
  await requireAdmin(req);
  json(res, 200, {
    prompts: PROMPT_CATALOG(),
    note: '这些是各功能发给模型的 system 提示词。账号设定、个人人设、语气档案、栏目、平台规范等是逐次拼进 user 消息的，不在这里。',
  });
}

/* ==================================================================
 * 提示词 A/B 与 eval（管理后台）
 *
 * A/B 的意义全在"记下每次用了哪个变体"上——没有这一列，
 * 换提示词就只是"感觉好像好点"。
 *
 * eval 的打分刻意分两层：确定性指标（客观、可复现、不花钱）+ 盲测人工对比。
 * **不用大模型当裁判**——这个项目一路的结论是模型在"给点评价"的压力下
 * 一定会顺着说，让它评自己的输出，得到的是和气不是信号。
 * ================================================================== */

/* 能做 A/B 的功能。只列真正值得试的那几个——
   每加一个都要在调用处接上分流，不是所有提示词都值得这个复杂度。 */
export const AB_FEATURES = [
  { key: 'topics', label: '选题方向', builtin: () => sys('topics', TOPICS_SYSTEM), kind: 'json' },
  { key: 'content', label: '成稿', builtin: () => sys('content', CONTENT_SYSTEM), kind: 'text' },
];

export async function handlePromptVariantList(req, res, body, params, url) {
  await requireAdmin(req);
  const feature = url?.searchParams.get('feature') || '';
  json(res, 200, {
    features: AB_FEATURES.map((f) => ({ key: f.key, label: f.label, builtin: f.builtin() })),
    variants: await Variants.list(feature),
  });
}

const cleanVariant = (b) => ({
  feature: AB_FEATURES.some((f) => f.key === b?.feature) ? b.feature : '',
  name: String(b?.name || '').trim().slice(0, 40),
  system: String(b?.system || '').trim(),
  weight: Math.max(0, Math.min(20, Math.round(Number(b?.weight) || 1))),
  active: Boolean(b?.active),
  note: String(b?.note || '').trim().slice(0, 300),
});

export async function handlePromptVariantSave(req, res, body, params) {
  await requireAdmin(req);
  const v = cleanVariant(body);
  if (!v.feature) throw new HttpError(400, '不认识这个功能');
  if (!v.name) throw new HttpError(400, '给变体起个名字');
  if (v.system.length < 40) throw new HttpError(400, '提示词太短了，确认粘完整了吗');
  json(res, 200, {
    variant: params.vid ? await Variants.update(Number(params.vid), v) : await Variants.create(v),
  });
}

export async function handlePromptVariantDelete(req, res, body, params) {
  await requireAdmin(req);
  if (!await Variants.remove(Number(params.vid))) throw new HttpError(404, '变体不存在');
  json(res, 200, { ok: true });
}

/* ---------------- eval 用例 ---------------- */

export async function handleEvalCases(req, res, body, params, url) {
  await requireAdmin(req);
  json(res, 200, { cases: await Evals.cases(url?.searchParams.get('feature') || '') });
}

export async function handleEvalCaseAdd(req, res, body) {
  await requireAdmin(req);
  const feature = AB_FEATURES.some((f) => f.key === body?.feature) ? body.feature : '';
  if (!feature) throw new HttpError(400, '不认识这个功能');
  const title = String(body?.title || '').trim().slice(0, 80);
  if (!title) throw new HttpError(400, '给用例起个名字');
  json(res, 200, { case: await Evals.addCase({ feature, title, input: body?.input || {} }) });
}

export async function handleEvalCaseDelete(req, res, body, params) {
  await requireAdmin(req);
  if (!await Evals.removeCase(Number(params.cid))) throw new HttpError(404, '用例不存在');
  json(res, 200, { ok: true });
}

/* ---------------- 跑一批 ---------------- */

/* 每个用例 × 每个变体（含内置）跑一次。
   串行跑——并发一上来，模型侧限流和本地日志都变难看，而 eval 本来就不赶时间。 */
export async function handleEvalRun(req, res, body) {
  await requireAdmin(req);
  const feature = AB_FEATURES.find((f) => f.key === body?.feature);
  if (!feature) throw new HttpError(400, '不认识这个功能');

  const cases = await Evals.cases(feature.key);
  if (!cases.length) throw new HttpError(400, '这个功能还没有用例');

  const pool = [
    { id: null, name: '内置', system: feature.builtin() },
    ...(await Variants.list(feature.key)).map((v) => ({ id: v.id, name: v.name, system: v.system })),
  ];
  if (pool.length < 2) throw new HttpError(400, '只有内置一份提示词，没什么可比的——先加个变体');

  const batch = `${feature.key}-${Date.now().toString(36)}`;
  let done = 0;
  let failed = 0;

  for (const c of cases) {
    let input = {};
    try { input = JSON.parse(c.input_json); } catch { /* 脏数据当空 */ }

    for (const v of pool) {
      const started = Date.now();
      try {
        // eslint-disable-next-line no-await-in-loop
        const { output, scores } = await runOne(feature, v, input);
        await Evals.addRun({
          batch, caseId: c.id, variantId: v.id, variantName: v.name,
          output, scores, ms: Date.now() - started,
        });
        done += 1;
      } catch (err) {
        await Evals.addRun({
          batch, caseId: c.id, variantId: v.id, variantName: v.name,
          ms: Date.now() - started, error: String(err?.message || err).slice(0, 300),
        });
        failed += 1;
      }
    }
  }

  json(res, 200, { batch, done, failed, cases: cases.length, variants: pool.length });
}

/* 单次执行 + 确定性打分。
   eval 走的是和线上同一套 user 消息拼装——否则测的就不是线上那个东西了。 */
async function runOne(feature, variant, input) {
  const form = {
    subject: String(input.subject || '').slice(0, 200),
    platform: PLATFORMS[input.platform] ? input.platform : DEFAULT_PLATFORM,
    tone: input.tone || DEFAULT_TONE,
    audience: input.audience || '',
    keywords: input.keywords || '',
    length: input.length || 0,
  };
  const persona = input.persona || null;

  if (feature.key === 'topics') {
    const data = await generateJSON({
      meta: { feature: 'eval·选题方向', variant: variant.name },
      system: variant.system,
      user: topicsUser(form, persona, []),
      schema: TOPICS_SCHEMA,
      mock: () => mockTopics(form),
    });
    return { output: JSON.stringify(data, null, 2), scores: scoreTopics(data) };
  }

  // 成稿：用例里得带一个方向，没有就用一个最小的占位方向
  const topic = input.topic || {
    title: form.subject, angle: '直接展开', hook: '', outline: ['开场', '主体', '收尾'], audience_fit: '',
  };
  const text = await generateText({
    meta: { feature: 'eval·成稿', variant: variant.name },
    system: variant.system,
    user: contentUser(form, topic, persona, [], []),
    mock: () => mockContent(form, topic),
  });
  return { output: text, scores: scoreText(text, { platform: form.platform }) };
}

/* ---------------- 结果与盲测 ---------------- */

export async function handleEvalBatches(req, res) {
  await requireAdmin(req);
  json(res, 200, { batches: await Evals.batches() });
}

export async function handleEvalResult(req, res, body, params) {
  await requireAdmin(req);
  const runs = await Evals.runs(String(params.batch));
  if (!runs.length) throw new HttpError(404, '没有这一批');

  const votes = await Evals.votes(String(params.batch));
  const tally = new Map();
  for (const v of votes) {
    if (!v.winner) continue;
    const r = runs.find((x) => x.id === v.winner);
    if (r) tally.set(r.variant_name, (tally.get(r.variant_name) || 0) + 1);
  }

  json(res, 200, {
    batch: params.batch,
    summary: summarize(runs),
    votes: { total: votes.length, ties: votes.filter((v) => !v.winner).length, tally: [...tally] },
    // 盲测用：按用例分组，前端隐去变体名
    cases: [...new Map(runs.map((r) => [r.case_id, r.case_title])).entries()]
      .map(([id, title]) => ({ id, title, runs: runs.filter((r) => r.case_id === id) })),
  });
}

export async function handleEvalVote(req, res, body, params) {
  await requireAdmin(req);
  await Evals.vote({
    batch: String(params.batch),
    caseId: Number(body?.case_id) || 0,
    leftId: Number(body?.left) || 0,
    rightId: Number(body?.right) || 0,
    winner: Number(body?.winner) || 0,
  });
  json(res, 200, { ok: true });
}

/* ==================================================================
 * 支付配置管理（管理后台）
 *
 * 商户私钥能以你的名义签名收款，所以这一块比别的配置管得严：
 *   - 加密入库，密钥留在环境变量（只拿到 DB 文件解不开）
 *   - **接口永远不返回原文**，只回"已配置 · ****1234"
 *   - env 里配了的，后台不给改——生产可以完全锁死在环境变量里
 * ================================================================== */

export async function handleSettingsList(req, res) {
  const admin = await requireAdmin(req);
  json(res, 200, {
    fields: await settingsStatus(),
    encrypted: hasKey(),
    warn: hasKey() ? '' : '没有设置 SECRET_KEY，敏感项的加密形同虚设。'
      + '生产环境务必设一个随机的长字符串，并且不要和数据库放在一起备份。',
    admin: admin.username,
  });
}

export async function handleSettingsSave(req, res, body) {
  const admin = await requireAdmin(req);
  const key = String(body?.key || '');
  try {
    await saveSetting(key, body?.value, admin.username);
  } catch (err) {
    throw new HttpError(400, String(err?.message || err));
  }
  json(res, 200, { fields: await settingsStatus() });
}

/* 连通性自检。填完不试一下，第一次真实支付才发现配错，那时候是用户在等着付钱。 */
export async function handleSettingsCheck(req, res) {
  await requireAdmin(req);
  const info = payInfo();
  const checks = [];

  const notify = conf('PAY_NOTIFY_BASE');
  checks.push({
    name: '回调地址',
    ok: /^https:\/\/[^/]+/.test(notify),
    detail: notify ? `${notify}/api/pay/notify/…` : '没填',
    hint: '必须是公网可达的 https 域名——回调打不进来就永远收不到"已支付"',
  });

  for (const ch of info.channels) {
    checks.push({
      name: ch.label,
      ok: ch.ready,
      detail: ch.ready ? '凭据齐全' : '缺少必填项',
      hint: ch.ready ? '还需要真实下单一次才能确认签名正确' : '',
    });
  }

  checks.push({
    name: '加密密钥',
    ok: hasKey(),
    detail: hasKey() ? '已设置 SECRET_KEY' : '未设置',
    hint: '没有它，数据库里的私钥等于明文',
  });

  json(res, 200, { provider: info.provider, live: info.live, checks });
}

/* 改用户名：内容都挂在用户 id 上，改名不影响任何数据；对方下次用新名字登录 */
export async function handleUserRename(req, res, body, params) {
  await requireAdmin(req);
  const username = String(body?.username || '').trim();
  const bad = validateCredentials(username, 'xxxxxx');
  if (bad) throw new HttpError(400, bad);
  const user = await Users.byId(Number(params.uid));
  if (!user) throw new HttpError(404, '没有这个用户');
  // 一道门模式下这个账号由 ACCESS_USER 指定：改了名下次启动会按旧名字再建一个空账号
  if (accessGateOn() && user.username === accessUsername()) {
    throw new HttpError(409, `这个账号现在是访问密码的共用账号（ACCESS_USER=${accessUsername()}）。先在服务器上去掉 ACCESS_PASSWORD 再改名`);
  }
  if (username === user.username) { json(res, 200, { user: { id: user.id, username } }); return; }
  if (await Users.byName(username)) throw new HttpError(409, '这个用户名已经有人用了');
  try {
    await Users.rename(user.id, username);
  } catch (err) {
    if (isUniqueViolation(err)) throw new HttpError(409, '这个用户名已经有人用了');
    throw err;
  }
  json(res, 200, { user: { id: user.id, username } });
}
