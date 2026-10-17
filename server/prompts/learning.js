import { weigh, weightNote } from '../refs.js';
import { fence, DATA_NOTE } from './_shared.js';

export const styleBlock = (persona, samples = [], prefs = [], refs = null) => {
  // 「成稿参考」里关掉了语气档案：档案不进提示词（相似范文、改稿习惯各管各的）
  const digest = refs && !refs.digest?.on ? '' : String(persona?.style_digest || '').trim();
  const rules = weigh(prefsBlock(prefs), refs, 'prefs');

  const excerpts = samples.slice(0, 3)
    .map((s, i) => `${i + 1}. ${s.content.slice(0, 220).replace(/\n+/g, ' ')}……`)
    .join('\n');
  const pieces = excerpts
    ? weigh(`和这次题材最接近的历史片段（只模仿语感，不要复用其中的内容和例子）：\n${fence('历史片段', excerpts)}`, refs, 'samples')
    : '';
  if (!digest) return [pieces, rules].filter(Boolean).join('\n\n') || null;

  return `—— 这个号的语气档案（从博主确认过的历史稿件里学到的）——
${digest}
${weightNote(refs, 'digest')}${pieces ? `\n${pieces}` : ''}
写作时优先服从这份语气档案：它比通用的风格调性更能代表这个号真实的样子。${rules ? `\n\n${rules}` : ''}`;
};

export const prefsBlock = (prefs = []) => {
  const list = (prefs || []).filter((p) => p?.rule);
  if (!list.length) return null;
  return `—— 作者的改稿习惯（从他亲手改过的稿子里学到的，必须遵守）——
${list.map((p) => `- ${p.rule}`).join('\n')}`;
};

const KIND_LABEL = { work: '工作经历', project: '项目经历', data: '数据成果', opinion: '观点', other: '经历' };

/* 个人档案：作者本人的真实经历、数据成果和观点，是第一人称取材「唯一可信的事实来源」；标了只作背景的不点名机构。
   compact = 只给选题用：标题和结果一行，不展开
   成稿（非 compact）：最相关的 2 条放全文，其余只放标题和结果一行，避免「重点参考」带 8 条全文撑爆上下文 */
export const profileBlock = (entries = [], { compact = false, fullLimit = 2 } = {}) => {
  const list = (entries || []).filter((e) => e?.title);
  if (!list.length) return null;
  const oneLine = (e) => {
    const bg = e.visibility === 'background';
    const head = [
      `【${KIND_LABEL[e.kind] || '经历'}】${e.title}`,
      e.period || null,
      e.org ? (bg ? '（机构只作背景，不写出名字）' : e.org) : null,
      e.role || null,
    ].filter(Boolean).join(' · ');
    return `${head}${e.result ? `：${e.result}` : ''}`;
  };
  const fullLine = (e) => {
    const bg = e.visibility === 'background';
    const head = [
      `【${KIND_LABEL[e.kind] || '经历'}】${e.title}`,
      e.period || null,
      e.org ? (bg ? '（机构只作背景，不写出名字）' : e.org) : null,
      e.role || null,
    ].filter(Boolean).join(' · ');
    return [head, e.body ? `经过：${e.body}` : null, e.result ? `结果：${e.result}` : null].filter(Boolean).join('\n');
  };
  const body = compact
    ? list.map(oneLine).join('\n')
    : list.map((e, i) => (i < fullLimit ? fullLine(e) : oneLine(e))).join('\n\n');
  const how = compact
    ? '选题时优先挑作者凭这些经历写得出来、别人写不出来的角度；不要为了用经历跑出账号定位。'
    : `这些是作者本人的真实经历、数据成果和一贯观点，**是这篇里关于作者本人唯一可信的事实来源**：
- 前几条带「经过」的是重点展开的；其余只有标题和结果，需要细节时不要编造没写出来的经过。
- 第一人称取材优先从这里来，展开成有场景、有细节的段落；用不上的不要硬塞。
- **不许编造这里没有的个人经历**，也不许改动里面的时间、数字、职位；数字原样用，不要放大。
- 标了「只作背景」的，不写出机构名和能认出机构的细节，可以说「我之前在一家××公司」。
- 观点类条目代表作者的一贯立场，这篇的说法不要和它矛盾。`;
  return `—— 作者的个人档案（和这次题材相关的几条）——
${fence('个人档案', body)}
${how}`;
};

export const DIGEST_SYSTEM =
`你是一位文字风格分析师。给你同一个博主的几篇成稿，你要总结出他**可复制的写作习惯**，
让另一个人照着写也能像他。要求：
1. 只写观察得到的、可执行的特征，不要评价好坏，不要复述文章内容。
2. 覆盖这几方面：句子长度与句式、段落节奏与排版、开头习惯、结尾习惯、
   高频词与口头禅、比喻和举例的取材偏好、标点与emoji用法、明显回避的表达。
3. 每条一行，用「- 」开头，具体到可以照做（例：「- 段落多为 1-3 行，几乎不写超过 5 行的长段」
   优于「- 段落简洁」）。总共 8-14 条。
4. 若某方面样本里看不出稳定规律，就不要写，不要硬凑。
5. 全部使用简体中文，直接输出条目，不要标题和前言。`;

export const digestUser = (samples) =>
`以下是同一个博主的 ${samples.length} 篇成稿，请总结他的写作习惯。

${samples.map((s, i) => `===== 样本 ${i + 1}${s.title ? `：${s.title}` : ''} =====\n${s.content}`).join('\n\n')}`;


/* ==================================================================
 * 越写越懂：单篇要点、档案合并、改稿偏好、经历拆解
 * ================================================================== */

/* 一篇文章 → 写作习惯要点 + 文中明确写到的作者经历和观点（给作者确认后存进个人档案） */
export const SAMPLE_NOTES_SYSTEM =
`你是一位文字风格分析师，同时帮作者整理他的个人档案。给你作者本人写的一篇文章，做两件事：
1. style：总结这一篇里能看出的**可复制的写作习惯**，3-6 条，每条具体到可以照做
   （句子长短与句式、段落节奏、开头和结尾的做法、口头禅与高频词、举例取材、标点与 emoji、明显回避的表达）。
   只写这篇里确实看得到的，不评价好坏，不复述内容。
2. experiences / opinions：**作者在文中以第一人称明确写到的**亲身经历、项目，和他明确表达的观点。
   - 没写到就给空数组，不要推测、不要补全；别人的经历、泛泛的道理不算。
   - 每条的 quote 必须是文章里**逐字存在**的一句原文（10-60 字），用来核对。
   - 经历的 period / org / role 文中没写就留空字符串。
全部使用简体中文。`;

export const SAMPLE_NOTES_SCHEMA = {
  type: 'object',
  properties: {
    style: { type: 'array', maxItems: 6, items: { type: 'string' } },
    experiences: {
      type: 'array', maxItems: 5,
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['work', 'project', 'other'] },
          title: { type: 'string', description: '一句话说清这段经历，20 字内' },
          period: { type: 'string' }, org: { type: 'string' }, role: { type: 'string' },
          body: { type: 'string', description: '经过，100 字内' },
          result: { type: 'string', description: '结果，尽量带文中的数字；没写就留空' },
          quote: { type: 'string', description: '文中逐字存在的一句原文' },
        },
        required: ['kind', 'title', 'period', 'org', 'role', 'body', 'result', 'quote'],
        additionalProperties: false,
      },
    },
    opinions: {
      type: 'array', maxItems: 3,
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '观点本身，一句话' },
          body: { type: 'string', description: '他给的理由，80 字内' },
          quote: { type: 'string', description: '文中逐字存在的一句原文' },
        },
        required: ['title', 'body', 'quote'],
        additionalProperties: false,
      },
    },
  },
  required: ['style', 'experiences', 'opinions'],
  additionalProperties: false,
};

export const sampleNotesUser = (sample) =>
`下面是作者本人写的一篇文章${sample.title ? `《${sample.title}》` : ''}。
${fence('文章', String(sample.content || '').slice(0, 6000))}
${DATA_NOTE}`;

/* 语气档案的合并与梳理：输入是各篇单独提炼的要点（加上旧档案），不再把原文整篇塞进去 */
export const DIGEST_MERGE_SYSTEM =
`你是一位文字风格分析师，负责维护一个博主的「语气档案」——一份让别人照着写也能像他的写作习惯清单。
给你的是：旧档案（可能为空）和若干篇文章各自提炼的写作习惯要点（每篇标了时间和权重）。
要求：
1. 输出新的完整档案：保留仍然成立的条目；被新样本反复推翻的改掉或删掉；在多篇里稳定出现的新习惯加进来。
2. **以近期为准**：新旧冲突时，按时间更近、权重更高的样本来；只出现过一次的特征不要写进档案。
3. 覆盖这几方面（看不出稳定规律的方面就不写）：句子长度与句式、段落节奏与排版、开头习惯、结尾习惯、
   高频词与口头禅、比喻和举例的取材偏好、标点与 emoji 用法、明显回避的表达。
4. 每条一行，用「- 」开头，具体到可以照做。总共 8-16 条。
5. 全部使用简体中文，直接输出条目，不要标题和前言。`;

export const digestMergeUser = (prev, items) =>
`${prev ? `旧档案：\n${fence('旧档案', prev)}\n\n` : '旧档案：（还没有）\n\n'}各篇要点（越往上越新）：
${fence('各篇要点', items.map((x) => `===== ${String(x.created_at || '').slice(0, 10)} · 权重 ${Number(x.weight || 1).toFixed(1)}${x.title ? ` · ${x.title}` : ''} =====\n${x.notes || `（这篇还没单独提炼，原文开头：）\n${x.excerpt || ''}`}`).join('\n\n'))}
${DATA_NOTE}`;

/* 改稿偏好：AI 初稿 vs 作者定稿 → 可推广的改稿习惯 */
export const PREF_LEARN_SYSTEM =
`你在帮一位博主总结他的「改稿习惯」。给你同一篇稿子的两个版本：AI 写的初稿，和他亲手改过之后的定稿；
还有之前已经学到的习惯清单。找出他**反复会做、下次写别的稿子也适用**的修改动作，写成规则。
要求：
1. 只要可推广的写法习惯（删掉某类套话、换掉某种说法、开头怎么改、段落怎么拆、语气往哪边调、标点和 emoji 怎么用……）。
   **不要**把这篇特有的事实、内容增删当成规则（比如「把 3 年改成 5 年」不是习惯）。
2. 每条规则一句话，祈使句，具体到可以照做（例：「不用『赋能』『抓手』『闭环』这类词」「开头不要用反问句」）。
3. 每条给 before 和 after：分别是初稿和定稿里**逐字存在**的一小段（各 4-60 字），证明这个改动确实发生了。
4. 和已有习惯说的是同一件事的，不要再写成新规则，把那条的序号放进 reinforce。
5. 最多 5 条新规则；看不出可推广的习惯就给空数组。全部使用简体中文。`;

export const PREF_LEARN_SCHEMA = {
  type: 'object',
  properties: {
    rules: {
      type: 'array', maxItems: 5,
      items: {
        type: 'object',
        properties: {
          rule: { type: 'string' },
          before: { type: 'string', description: '初稿里逐字存在的一小段' },
          after: { type: 'string', description: '定稿里逐字存在的一小段' },
        },
        required: ['rule', 'before', 'after'],
        additionalProperties: false,
      },
    },
    reinforce: { type: 'array', items: { type: 'integer' }, description: '被这次修改再次印证的已有习惯序号（从 1 开始）' },
  },
  required: ['rules', 'reinforce'],
  additionalProperties: false,
};

export const prefLearnUser = (generated, final, existing = []) =>
`已有的改稿习惯：
${existing.length ? existing.map((p, i) => `${i + 1}. ${p.rule}`).join('\n') : '（还没有）'}

AI 初稿：
${fence('初稿', String(generated || '').slice(0, 6000))}

作者定稿：
${fence('定稿', String(final || '').slice(0, 6000))}
${DATA_NOTE}`;

/* 简历 / 自我介绍 → 一条条经历（不直接存，给作者核对） */
export const PROFILE_PARSE_SYSTEM =
`你在帮一位博主整理他的个人档案。给你一段他自己写的简历、自我介绍或经历回顾，拆成一条条经历和观点。
要求：
1. 只拆文中**明确写到**的内容，不推测、不补全、不美化；时间、数字、职位照原文。
2. kind：work 工作经历（一段任职）、project 项目经历（一件具体做成或做砸的事）、data 数据成果（粉丝数、业绩、增长这类可核查的数字）、opinion 观点、other 其他。
   一段任职里有几件具体的事，拆成一条 work 加几条 project。
3. title 一句话说清（20 字内）；body 写经过（150 字内）；result 写结果，尽量带原文里的数字，没写就留空。
4. 每条的 quote 必须是原文里**逐字存在**的一句（10-60 字），用来核对。
5. 最多 30 条。全部使用简体中文。`;

export const PROFILE_PARSE_SCHEMA = {
  type: 'object',
  properties: {
    entries: {
      type: 'array', maxItems: 30,
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['work', 'project', 'data', 'opinion', 'other'] },
          title: { type: 'string' }, period: { type: 'string' }, org: { type: 'string' }, role: { type: 'string' },
          body: { type: 'string' }, result: { type: 'string' }, quote: { type: 'string' },
        },
        required: ['kind', 'title', 'period', 'org', 'role', 'body', 'result', 'quote'],
        additionalProperties: false,
      },
    },
  },
  required: ['entries'],
  additionalProperties: false,
};

export const profileParseUser = (text) =>
`下面是作者自己写的经历材料：
${fence('经历材料', String(text || '').slice(0, 12000))}
${DATA_NOTE}`;
