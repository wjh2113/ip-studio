/* 越写越懂：从作者的文章、改稿和发布里持续学习。
 *
 * 三条线：
 *   1. 语气档案：每篇样本先单独提炼「这一篇的写作习惯」（notes），档案由各篇 notes 合并而来。
 *      新加一篇只合并这一篇（增量）；样本每多 FULL_EVERY 篇、或作者点「从头梳理」，就用最近 60 篇的 notes 重写一遍，
 *      以近期为准。原来是每次拿最近 6 篇原文整篇重算，样本一多就学不到。
 *   2. 改稿偏好：AI 初稿和作者定稿的差别里，反复出现、可推广的修改动作 → 一条条规则，写作时必须遵守。
 *   3. 个人档案候选：从作者文章里找到的亲身经历和观点，不直接入库，记成待确认，作者点一下才存。
 *
 * 触发：
 *   - 手动喂一篇（handleSampleCreate）：同步做 1，顺手排一个任务做 2；
 *   - 批量导入文章：排任务做 1 和 3；
 *   - 成稿标记为已发布：自动排任务（账号开着「自动学习」时），加样本、做 1、2、3。
 * 所有模型输出都在这里校验：引用原文的字段要逐字找得到，找不到的整条丢掉。 */
import {
  Drafts, LearnLog, PREF_MAX, Personas, Prefs, Samples, SAMPLE_MAX,
} from './db.js';
import { HttpError } from './auth.js';
import { generateJSON, generateText } from './llm.js';
import { defineJob, enqueue } from './jobs.js';
import { liveSystem } from './promptrev.js';
import { editRatio } from './quality.js';
import {
  DIGEST_MERGE_SYSTEM, digestMergeUser, PREF_LEARN_SCHEMA, PREF_LEARN_SYSTEM, prefLearnUser,
  PROFILE_PARSE_SCHEMA, PROFILE_PARSE_SYSTEM, profileParseUser,
  SAMPLE_NOTES_SCHEMA, SAMPLE_NOTES_SYSTEM, sampleNotesUser,
} from './prompts.js';

export const FULL_EVERY = 10;          // 样本每多这么多篇，档案从头梳理一次
const FULL_WINDOW = 60;                // 从头梳理看最近多少篇
const MIN_EDIT_RATIO = 0.03;           // 改得比这还少，不学偏好（几乎没改）
const NOTES_BACKFILL = 6;              // 从头梳理前，最多补提炼几篇还没提炼过的老样本

const squash = (s) => String(s || '').replace(/\s+/g, '');
const contains = (hay, needle) => {
  const n = squash(needle);
  return n.length >= 4 && squash(hay).includes(n);
};
const clip = (v, n) => String(v ?? '').trim().slice(0, n);

/* ---------------- 单篇要点 ---------------- */

/* 一篇样本 → { notes, candidates }。notes 存回样本；candidates 是文中写到的经历和观点，待作者确认 */
export async function sampleNotes(userId, sample) {
  const data = await generateJSON({
    meta: { feature: '文章要点', userId },
    system: liveSystem('sample-notes', SAMPLE_NOTES_SYSTEM),
    user: sampleNotesUser(sample),
    schema: SAMPLE_NOTES_SCHEMA,
    mock: () => mockNotes(sample),
  });
  const style = (Array.isArray(data?.style) ? data.style : [])
    .map((x) => clip(x, 120).replace(/^[-•\s]+/, '')).filter(Boolean).slice(0, 6);
  const notes = style.map((x) => `- ${x}`).join('\n');
  const keep = (x) => x && clip(x.title, 60) && contains(sample.content, x.quote);
  const experiences = (Array.isArray(data?.experiences) ? data.experiences : []).filter(keep).slice(0, 5).map((x) => ({
    kind: ['work', 'project', 'other'].includes(x.kind) ? x.kind : 'other',
    title: clip(x.title, 60), period: clip(x.period, 40), org: clip(x.org, 60), role: clip(x.role, 60),
    body: clip(x.body, 400), result: clip(x.result, 200), quote: clip(x.quote, 120),
  }));
  const opinions = (Array.isArray(data?.opinions) ? data.opinions : []).filter(keep).slice(0, 3).map((x) => ({
    kind: 'opinion', title: clip(x.title, 60), period: '', org: '', role: '',
    body: clip(x.body, 300), result: '', quote: clip(x.quote, 120),
  }));
  if (notes) await Samples.setNotes(sample.id, userId, notes);
  return { notes, candidates: [...experiences, ...opinions] };
}

/* 找到的经历和观点记成一条待确认的学习记录 */
async function logCandidates(userId, personaId, title, candidates) {
  if (!candidates.length) return null;
  const exp = candidates.filter((c) => c.kind !== 'opinion').length;
  const op = candidates.length - exp;
  return LearnLog.add(userId, personaId, {
    kind: 'candidates',
    summary: `从${title ? `《${title}》` : '文章'}里找到${exp ? ` ${exp} 段经历` : ''}${exp && op ? '、' : ''}${op ? ` ${op} 个观点` : ''}，可以存进个人档案`,
    detail: { title, candidates },
  });
}

/* ---------------- 语气档案 ---------------- */

/* 更新档案。newIds = 这次新加、已提炼过的样本（增量合并）；full = 从头梳理。
   没有档案、或者自上次梳理以来又多了 FULL_EVERY 篇，增量也会升级成从头梳理 */
export async function updateDigest(userId, personaId, { newIds = [], full = false, reason = '', backfill = true } = {}) {
  const persona = await Personas.byId(personaId, userId);
  if (!persona) throw new HttpError(404, '账号不存在');
  const total = await Samples.count(personaId, userId);
  if (!total) {
    await Personas.setDigest(personaId, userId, '', { fullCount: 0 });
    return '';
  }
  const doFull = full || !persona.style_digest || total - (persona.digest_full_count || 0) >= FULL_EVERY;

  let items = await Samples.forDigest(personaId, userId, FULL_WINDOW);
  if (doFull) {
    // 还没提炼过的老样本（迁移前存的）先补几篇；剩下的用开头一段原文，最多带 6 篇
    const missing = backfill ? items.filter((x) => !x.notes).slice(0, NOTES_BACKFILL) : [];
    if (missing.length) {
      const rows = await Samples.byIds(missing.map((x) => x.id), userId);
      for (const smp of rows) {
        try {
          const { notes } = await sampleNotes(userId, smp);
          const it = items.find((x) => x.id === smp.id);
          if (it) it.notes = notes;
        } catch (err) { console.warn('[learn] 补提炼失败', err?.message); }
      }
    }
    let raw = 0;
    items = items.filter((x) => x.notes || (raw += 1) <= 6);
  } else {
    items = items.filter((x) => newIds.includes(x.id));
    if (!items.length) return persona.style_digest;
  }

  const before = persona.style_digest || '';
  const text = await generateText({
    meta: { feature: '语气档案', userId },
    system: liveSystem('digest-merge', DIGEST_MERGE_SYSTEM),
    user: digestMergeUser(doFull ? '' : before, items),
    mock: () => mockDigest(items.length, doFull),
  });
  const digest = String(text).trim().slice(0, 4000);
  await Personas.setDigest(personaId, userId, digest, doFull ? { fullCount: total } : {});
  await LearnLog.add(userId, personaId, {
    kind: 'digest',
    summary: doFull
      ? `语气档案从头梳理了一遍（看了最近 ${items.length} 篇）${reason ? `：${reason}` : ''}`
      : `语气档案合并了 ${items.length} 篇新样本${reason ? `：${reason}` : ''}`,
    detail: { before, after: digest, full: doFull },
  });
  return digest;
}

/* ---------------- 加样本 ---------------- */

/* 存一篇样本并学：提炼要点 → 增量合并档案 → 记下文中找到的经历和观点。返回 { sample, digest, candidates } */
export async function addSampleAndLearn(userId, personaId, { title = '', content, draftId = null, source = 'manual', weight = 1 }) {
  if (await Samples.count(personaId, userId) >= SAMPLE_MAX) {
    throw new HttpError(400, `样本数量已达上限（${SAMPLE_MAX} 篇），请先删掉一些`);
  }
  const sample = await Samples.create(userId, personaId, { draftId, title, content, source, weight });
  let candidates = [];
  try {
    ({ candidates } = await sampleNotes(userId, sample));
  } catch (err) {
    console.warn('[learn] 单篇提炼失败，档案用原文合并', err?.message);
  }
  const digest = await updateDigest(userId, personaId, { newIds: [sample.id], reason: title ? `《${title}》` : '' });
  const log = await logCandidates(userId, personaId, title, candidates);
  return { sample, digest, candidates, candidatesLogId: log?.id ?? null };
}

/* ---------------- 改稿偏好 ---------------- */

/* 从一篇稿子的「AI 初稿 → 定稿」里学改稿习惯。没有初稿、学过了、几乎没改的跳过。返回新规则数 */
export async function learnPrefs(userId, personaId, draftId) {
  const src = await Drafts.learnSource(draftId, userId);
  if (!src || !src.generated || !src.content || src.learned_at) return { added: 0, skipped: 'nothing' };
  const ratio = src.edit_ratio ?? editRatio(src.generated, src.content);
  if (ratio < MIN_EDIT_RATIO) {
    await Drafts.setLearned(draftId, userId);
    return { added: 0, skipped: 'few-edits' };
  }
  const existing = await Prefs.list(personaId, userId);
  const data = await generateJSON({
    meta: { feature: '改稿偏好', userId },
    system: liveSystem('pref-learn', PREF_LEARN_SYSTEM),
    user: prefLearnUser(src.generated, src.content, existing),
    schema: PREF_LEARN_SCHEMA,
    mock: () => mockPrefs(src.generated, src.content),
  });
  const seen = new Set(existing.map((p) => squash(p.rule)));
  const rules = (Array.isArray(data?.rules) ? data.rules : [])
    .map((r) => ({ rule: clip(r?.rule, 80), before: clip(r?.before, 80), after: clip(r?.after, 80) }))
    .filter((r) => r.rule.length >= 4 && contains(src.generated, r.before) && contains(src.content, r.after))
    .filter((r) => { const k = squash(r.rule); if (seen.has(k)) return false; seen.add(k); return true; });
  const room = Math.max(0, PREF_MAX - existing.length);
  const added = [];
  for (const r of rules.slice(0, room)) {
    added.push(await Prefs.create(userId, personaId, { rule: r.rule, evidence: `「${r.before}」→「${r.after}」`, draftId }));
  }
  const reinforce = [...new Set((Array.isArray(data?.reinforce) ? data.reinforce : [])
    .map(Number).filter((i) => Number.isInteger(i) && i >= 1 && i <= existing.length))]
    .map((i) => existing[i - 1].id);
  await Prefs.bump(reinforce, userId);
  await Drafts.setLearned(draftId, userId);
  const title = src.title || src.subject;
  if (added.length || reinforce.length) {
    await LearnLog.add(userId, personaId, {
      kind: 'prefs',
      summary: `从《${title}》的改稿里${added.length ? `学到 ${added.length} 条新习惯` : ''}${added.length && reinforce.length ? '，' : ''}${reinforce.length ? `又印证了 ${reinforce.length} 条` : ''}`,
      detail: { draftId, added: added.map((p) => ({ id: p.id, rule: p.rule, evidence: p.evidence })), reinforced: reinforce },
    });
  }
  return { added: added.length, reinforced: reinforce.length };
}

/* ---------------- 个人档案：拆简历 ---------------- */

export async function parseProfile(userId, text) {
  const src = String(text || '').trim();
  if (src.replace(/\s/g, '').length < 20) throw new HttpError(400, '内容太短了，贴一段简历或经历回顾');
  const data = await generateJSON({
    meta: { feature: '经历拆解', userId },
    system: liveSystem('profile-parse', PROFILE_PARSE_SYSTEM),
    user: profileParseUser(src),
    schema: PROFILE_PARSE_SCHEMA,
    mock: () => mockParse(src),
  });
  return (Array.isArray(data?.entries) ? data.entries : [])
    .filter((x) => x && clip(x.title, 60) && contains(src, x.quote))
    .slice(0, 30)
    .map((x) => ({
      kind: ['work', 'project', 'opinion', 'other'].includes(x.kind) ? x.kind : 'other',
      title: clip(x.title, 60), period: clip(x.period, 40), org: clip(x.org, 60), role: clip(x.role, 60),
      body: clip(x.body, 600), result: clip(x.result, 300), quote: clip(x.quote, 120),
      // 写了机构名的默认只作背景：要点名得作者自己打开
      visibility: clip(x.org, 60) ? 'background' : 'public',
    }));
}

/* ---------------- 后台任务 ---------------- */

/* 发布后自动学：账号开着「自动学习」才排任务。不阻塞标记发布本身，失败只打日志 */
export async function onPublished(userId, draftId) {
  try {
    const src = await Drafts.learnSource(draftId, userId);
    if (!src?.persona_id || !src.published_at) return null;
    const persona = await Personas.byId(src.persona_id, userId);
    if (!persona?.auto_learn) return null;
    return await enqueue(userId, 'learn', {
      ref: `learn:published:${draftId}`,
      label: `从发布的《${(src.title || src.subject || '').slice(0, 20)}》里学习`,
      payload: { type: 'published', draftId, personaId: persona.id },
    });
  } catch (err) {
    console.warn('[learn] 排发布学习任务失败', err?.message);
    return null;
  }
}

export function enqueueLearn(userId, personaId, payload, label) {
  const key = payload.type === 'prefs' ? `prefs:${payload.draftId}`
    : payload.type === 'import' ? `import:${payload.sampleIds.join(',')}` : payload.type;
  return enqueue(userId, 'learn', { ref: `learn:${personaId}:${key}`, label, payload: { ...payload, personaId } });
}

defineJob('learn', {
  label: '学习写作风格',
  async run({ userId, payload }) {
    const { type, personaId } = payload;
    const persona = await Personas.byId(personaId, userId);
    if (!persona) throw new HttpError(404, '账号已经不在了');

    if (type === 'published') {
      const src = await Drafts.learnSource(payload.draftId, userId);
      if (!src) throw new HttpError(404, '稿子已经不在了');
      const out = { sample: false, prefs: 0 };
      if (!await Samples.byDraft(personaId, userId, src.id) && squash(src.content).length >= 100
        && await Samples.count(personaId, userId) < SAMPLE_MAX) {
        // 改得越多越像作者本人，权重越高（1～2）
        const ratio = src.edit_ratio ?? (src.generated ? editRatio(src.generated, src.content) : 1);
        const weight = 1 + Math.min(1, Math.max(0, ratio) * 2);
        await addSampleAndLearn(userId, personaId, {
          title: src.title || src.subject, content: src.content, draftId: src.id, source: 'published', weight,
        });
        await LearnLog.add(userId, personaId, { kind: 'sample', summary: `《${src.title || src.subject}》发布后自动加入语气样本（权重 ${weight.toFixed(1)}）`, detail: { draftId: src.id } });
        out.sample = true;
      }
      out.prefs = (await learnPrefs(userId, personaId, src.id)).added || 0;
      return out;
    }
    if (type === 'prefs') return learnPrefs(userId, personaId, payload.draftId);
    if (type === 'import') {
      const samples = await Samples.byIds(payload.sampleIds || [], userId);
      const done = [];
      for (const smp of samples) {
        try {
          const { candidates } = await sampleNotes(userId, smp);
          await logCandidates(userId, personaId, smp.title, candidates);
          done.push(smp.id);
        } catch (err) { console.warn('[learn] 导入提炼失败', smp.id, err?.message); }
      }
      // 快速建号那条路已经同步用原文梳理过档案了，这里只补每篇的要点和经历候选
      if (!payload.noDigest) await updateDigest(userId, personaId, { newIds: done, reason: `批量导入 ${samples.length} 篇` });
      return { learned: done.length };
    }
    if (type === 'rebuild') {
      await updateDigest(userId, personaId, { full: true, reason: payload.reason || '手动从头梳理' });
      return { ok: true };
    }
    throw new HttpError(400, `不认识的学习任务：${type}`);
  },
});

/* ---------------- 每月定期梳理 ----------------
   每 10 篇新样本会从头梳理一次；写得慢的号可能几个月攒不到 10 篇，档案一直是「合并」出来的，越合并越走样。
   所以再加一条：上次从头梳理过了一个月、之后又有新样本的，后台从头梳理一遍（最近的文章分量更重）。
   每 6 小时看一次，一次最多排 50 个号；任务按账号去重，同一个号不会排两条。 */
export const REFRESH_DAYS = 30;
export async function refreshDue(nowMs = Date.now()) {
  const before = new Date(nowMs - REFRESH_DAYS * 86400_000).toISOString();
  const due = await Personas.dueForRefresh(before);
  for (const p of due) {
    await enqueueLearn(p.user_id, p.id, { type: 'rebuild', reason: '每月定期梳理' }, '语气档案每月梳理')
      .catch((err) => console.warn('[learn] 排每月梳理失败', err?.message));
  }
  return due.length;
}

let refreshTimer = null;
export function startMonthlyRefresh() {
  if (refreshTimer || process.env.LEARN_REFRESH === 'off') return;
  const tick = () => void refreshDue().catch((err) => console.warn('[learn] 每月梳理检查失败', err?.message));
  setTimeout(tick, 5 * 60_000).unref();
  refreshTimer = setInterval(tick, 6 * 3600_000);
  refreshTimer.unref();
}

/* ---------------- 演示模式 ---------------- */

const firstSentenceWith = (text, re) => String(text || '').split(/[。！？\n]/).map((x) => x.trim()).find((x) => x.length >= 6 && re.test(x)) || '';

function mockNotes(sample) {
  const said = firstSentenceWith(sample.content, /我/);
  return {
    style: ['演示模式：这里会是这一篇里看得出的写作习惯', '例如：段落多为 1-3 行，开头先抛一个具体场景'],
    experiences: said ? [{ kind: 'other', title: said.slice(0, 20), period: '', org: '', role: '', body: said.slice(0, 100), result: '', quote: said.slice(0, 40) }] : [],
    opinions: [],
  };
}
const mockDigest = (n, full) => [
  `- 演示模式：这里会由大模型${full ? '从头梳理' : '合并'} ${n} 篇样本的写作习惯`,
  '- 例如：段落多为 1-3 行，几乎不写超过 5 行的长段',
  '- 例如：开头常用一个具体场景，而不是抛结论',
  '- 配置模型密钥后，这份档案会变成真实的语气总结',
].join('\n');
function mockPrefs(generated, final) {
  const a = String(generated).replace(/\s+/g, '').slice(0, 12);
  const b = String(final).replace(/\s+/g, '').slice(0, 12);
  if (!a || !b || a === b) return { rules: [], reinforce: [] };
  return { rules: [{ rule: '演示模式：这里会是从你的改稿里学到的习惯，比如「开头不用反问句」', before: a, after: b }], reinforce: [] };
}
function mockParse(text) {
  const lines = String(text).split(/[\n。；;]/).map((x) => x.trim()).filter((x) => x.length >= 8).slice(0, 12);
  return {
    entries: lines.map((l) => ({
      kind: /公司|任职|入职|就职|担任/.test(l) ? 'work' : /认为|觉得|相信/.test(l) ? 'opinion' : 'project',
      title: l.slice(0, 20), period: (l.match(/\d{4}(?:\s*[-—~至到]\s*\d{4}|年)?/) || [''])[0], org: '', role: '',
      body: l.slice(0, 150), result: (l.match(/[^，,]*\d+[%％万千倍个人]?[^，,]*/) || [''])[0].slice(0, 60), quote: l.slice(0, 40),
    })),
  };
}
