import { IMAGE_MARK } from '../../shared/place.js';
import { creatorBlock, personaBlock } from './topics.js';
import { platformSpec, fence, DATA_NOTE } from './_shared.js';
import { HUMAN_STYLE } from './_human.js';

export { IMAGE_MARK };

export const ADAPT_SYSTEM =
`你要把一篇已经写好的稿子，改成另一个平台的版本。

**最重要的一条：事实层不许动。**
原文里的经历、时间、地点、数字、人物、案例、结论——一个都不能改、不能加。
目标平台篇幅短就**整块删**，不要把每句话压缩成缩写体；篇幅长可以把原有的点展开讲透，
但展开只能用原文已有的信息，**不许补充原文没有的事实、案例或数据**。

**要改的是这三样**：
1. **结构**：按目标平台的阅读方式重排。公众号要小标题分节，小红书要短段和清单，
   微博要一句立住观点，口播要能顺口念出来。
2. **语气**：按目标平台的惯例调整书面/口语的程度。
3. **详略**：哪些点该展开、哪些该一笔带过，取决于这个平台的读者要什么。

**铁律**：
1. **不许把原平台的格式痕迹带过来**。原文是口播脚本就不要保留【口播】【画面】这类分栏标注；
   原文是小红书就不要把 #话题标签 带进公众号。目标平台不用的格式，一律去掉。
2. 目标平台的字数是硬约束，宁可少写一个点，也不要超。
3. 只输出改好的正文，**不要任何说明、前言、"以下是…"**，也不要用引号包起来。
4. 全部使用简体中文。

${HUMAN_STYLE}`;

export const adaptUser = (draft, persona, text, fromKey, toKey) => {
  const from = platformSpec(fromKey);
  const to = platformSpec(toKey);
  const context = [
    creatorBlock(persona),
    draft.tone ? `—— 账号调性 ——\n${draft.tone}` : null,
  ].filter(Boolean).join('\n\n');

  return `${context}

—— 原文是给「${from.label}」写的 ——
===== 原文开始 =====
${text}
===== 原文结束 =====

—— 要改成「${to.label}」 ——
${to.spec}
篇幅：${to.length} 字左右。

请给出「${to.label}」版本的正文。记住：结构、语气、详略可以改，**事实一个字都不能动**。`;
};

export const ILLUS_SCHEMA = {
  type: 'object',
  properties: {
    look: { type: 'string', description: '整篇统一的视觉风格，一句话，会拼进每张图的提示词' },
    items: {
      type: 'array', minItems: 1, maxItems: 8,
      items: {
        type: 'object',
        properties: {
          anchor: {
            type: 'string',
            description: `这张图插在哪。正文里有「${IMAGE_MARK}」时，anchor 必须逐字照抄这个标记。没有标记时，从正文里逐字照抄那一段的开头 10-20 个字`,
          },
          prompt: { type: 'string', description: '画面提示词。只写看得见的东西，不含风格词（风格由 look 统一给）' },
          alt: { type: 'string', description: '图注，12 字以内；不需要图注就给空字符串' },
        },
        required: ['anchor', 'prompt', 'alt'],
        additionalProperties: false,
      },
    },
  },
  required: ['look', 'items'],
  additionalProperties: false,
};

export const ILLUS_SYSTEM =
`你要给一篇文章挑几个插图位，并说清楚每张图画什么。

**插在哪、插几张**：
- 正文里如果出现「${IMAGE_MARK}」，那就是作者指定的位置。一处一张，按出现顺序，**不要自己另找位置，也不要多给或少给**。anchor 每一条都逐字照抄「${IMAGE_MARK}」。
- 没有这个标记时，才由你挑位置：按文章长度和结构定，2-5 张。**宁可少插**——每隔两段就来一张会打断阅读。插图位落在**章节之间**或**一个大段落讲完之后**，不要插在一句话中间。

**画面提示词怎么写**：
- 只写**看得见的东西**：主体、环境、光线、构图、色调。具体到能画出来。
- **不要画具体的人。** 需要表现"人"的时候，用手部特写、背影剪影、空的工位、
  两把对放的椅子这类**不指向某个具体面孔**的方式。
  （原因很实际：每张图独立生成，画了人就会是几个不同的人。）
- **不要写字**。画面里出现文字几乎必然是乱码。
- 不要写风格词（"电影感""高级感"），整篇风格由 look 统一给，写两处会打架。

**图和文的关系**：插图是**换气和烘托**，不是图解。
讲"三个月的煎熬"不要画日历；画一张深夜里只剩显示器亮着的桌面。

**铁律**：
1. anchor 必须从正文**逐字照抄**，取那一段开头的 10-20 个字，且必须真的能在正文里找到。
2. look 里把**色调、媒介、光线**三件事定死，让几张图看起来像一篇文章里的。
3. 涉及真人肖像、品牌标识、他人作品的，绕开。
4. 全部使用简体中文。`;

export const illusUser = (draft, persona, text, platformKey, marks = 0) => {
  const p = platformSpec(platformKey);
  const context = [creatorBlock(persona), `—— 发布平台 ——\n${p.label}`].filter(Boolean).join('\n\n');
  const rule = marks
    ? `正文里有 ${marks} 处「${IMAGE_MARK}」。请正好给出 ${marks} 张，按出现顺序。anchor 每一条都写「${IMAGE_MARK}」。不要多、不要少、不要换位置。画面贴着标记前后的段落。`
    : '请给出插图方案。记住：宁可少插，不要画具体的人，anchor 必须逐字照抄正文里的一段开头。';
  return `${context}

—— 文章正文 ——
===== 正文开始 =====
${text}
===== 正文结束 =====

${rule}`;
};

/* ==================================================================
 * 素材召回
 *
 * 素材库只放外部资料（文章、链接、图片、视频、对标账号、框架参考），不放作者本人的经历和数据——那些在个人档案里。
 * 所以措辞和个人档案、栏目素材分开：素材里的事实可以引用，但不能写成作者自己的事。
 * ================================================================== */

export const materialsBlock = (list) => {
  if (!list?.length) return null;
  // 调用方应已截成「标题 + 相关几百字」；这里再兜一层，避免整篇原文挤占上下文
  const lines = list.map((m) => {
    const body = String(m.body || '').trim();
    const clipped = body.length > 500 ? `${body.slice(0, 500)}…` : body;
    return `【${m.kind}】${m.title}\n${clipped}`;
  });
  return `—— 素材库里和这个题材相关的资料 ——
${fence('素材', lines.join('\n\n'))}

这些是作者收集的外部资料（文章、链接、图片说明、对标账号、框架参考），**不是作者本人的经历**：
- 每条只有标题和最相关的片段（或摘要），不是全文；里面的事实、数据、案例可以用，用的时候点明出处或说「有篇文章提到」，不要说成作者自己的事。
- 作者本人的经历和数据只来自「个人档案」；**不要编造个人档案之外的个人经历、时间、数字、职位或人物关系**。
- 用得上就用，展开成有分析的段落，不要原样罗列；**用不上的不要硬塞**——为了用素材而跑题，比不用素材更糟。
${DATA_NOTE}`;
};

/* ==================================================================
 * 标题候选：成稿后单独出一批标题，按类型分开，作者挑一个
 * 标题对打开率的影响常常大于正文；随方向一起出的那一个只是起点。
 * ================================================================== */

export const TITLE_TYPES = ['数字型', '悬念型', '身份型', '反常识型', '痛点型', '结果型'];

/* 各平台标题字数上限（按字符数算，emoji 算一个）。没有明确上限的平台不写 */
export const TITLE_LIMITS = { xiaohongshu: 20, gongzhonghao: 64, bilibili: 80 };

export const TITLES_SCHEMA = {
  type: 'object',
  properties: {
    titles: {
      type: 'array', minItems: 4, maxItems: 8,
      items: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '可以直接用的标题' },
          type: { type: 'string', enum: TITLE_TYPES, description: '这个标题用的是哪种写法' },
          why: { type: 'string', description: '一句话：它抓的是读者的哪个点' },
        },
        required: ['text', 'type', 'why'],
        additionalProperties: false,
      },
    },
  },
  required: ['titles'],
  additionalProperties: false,
};

export const TITLES_SYSTEM =
`你是一位擅长起标题的自媒体编辑。给一篇已经写好的正文起 6 个候选标题。
要求：
1. 6 个标题尽量覆盖不同写法：数字型、悬念型、身份型、反常识型、痛点型、结果型，同一种写法最多两个。
2. 只能用正文里已经有的信息：数字、经历、结论都要在正文里找得到，不许为了抓眼编一个正文没有的数字或承诺。
3. 符合目标平台的语感和字数上限；给了账号设定的，要像这个账号会发的标题。
4. 不用「震惊」「必看」「99% 的人不知道」这类标题党套话，也不用广告法禁止的绝对化用语（最、第一、唯一……）。
5. 全部使用简体中文。`;

export const titlesUser = (draft, persona, text) => {
  const p = platformSpec(draft.platform);
  const limit = TITLE_LIMITS[draft.platform];
  return [
    personaBlock(persona),
    `发布平台：${p.label}${limit ? `（标题不超过 ${limit} 字）` : ''}`,
    `现在的标题：${draft.title || '（无）'}`,
    '\n—— 正文 ——',
    text,
  ].filter(Boolean).join('\n');
};
