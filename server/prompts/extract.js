import { fence, DATA_NOTE, PLATFORMS, TONES, GENDERS } from './_shared.js';

/* ==================================================================
 * 范文拆解：把一篇优秀文案拆成框架（只拆结构，不拆内容）
 * ================================================================== */

export const EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: '给这个框架起个名字，6-12 字，说清它是什么写法，不要用范文的标题' },
    summary: { type: 'string', description: '一句话：适合写什么内容' },
    scenes: { type: 'array', maxItems: 4, items: { type: 'string' }, description: '适用场景标签，2-4 字一个，如「种草」「避坑」「来时路」' },
    slots: {
      type: 'array', minItems: 2, maxItems: 8,
      items: {
        type: 'object',
        properties: {
          role: { type: 'string', description: '这一段的作用，2-8 字，如「痛点开头」「三个亮点」' },
          guide: { type: 'string', description: '这一段怎么写：写法和要点，用通用的话说，不出现范文里的具体事物、人名、数字' },
          ratio: { type: 'number', description: '这一段在范文里大约占全文的比例，0-1' },
        },
        required: ['role', 'guide', 'ratio'],
        additionalProperties: false,
      },
    },
    why: { type: 'string', description: '一两句：这篇为什么有效（结构上的原因）' },
  },
  required: ['name', 'summary', 'scenes', 'slots', 'why'],
  additionalProperties: false,
};

export const EXTRACT_SYSTEM =
`你是一位拆解爆款文案的编辑。给你一篇范文，把它的**写作结构**拆成一个可复用的框架。
要求：
1. 按范文实际的段落推进，把它切成 2-8 段，每段写清「作用」和「怎么写」。
2. **只拆结构，不拆内容**：guide 里不许出现范文的具体事物、品牌、人名、数字、原句，要写成换一个题材也能照着用的通用说法。
3. ratio 按每段在范文里实际占的篇幅估，合计约为 1。
4. why 从结构角度说为什么有效（比如「前三行就给结果」「每个要点都配一个亲历细节」），不评价内容好坏。
5. 全部使用简体中文。`;

export const extractUser = (text, platformLabel = '') =>
`${platformLabel ? `范文所在平台：${platformLabel}\n\n` : ''}${fence('范文', text)}
${DATA_NOTE}`;

/* ==================================================================
 * 快速建号：新手贴一段自我介绍（和几篇旧文章），先把账号设定填出来给他改
 * ================================================================== */

export const QUICKSTART_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: '账号名称：介绍里写了账号名就照抄；没写就起一个 2-8 字的建议名' },
    platform: { type: 'string', enum: [...Object.keys(PLATFORMS), ''], description: '主要发布平台；介绍里没提就留空' },
    tone: { type: 'string', enum: [...Object.keys(TONES), ''], description: '最接近的风格调性；判断不了就留空' },
    content_focus: { type: 'string', description: '主要写什么内容，一两句' },
    audience: { type: 'string', description: '写给谁看：目标读者是什么人、处在什么处境' },
    problem: { type: 'string', description: '帮读者解决什么问题' },
    notes: { type: 'string', description: '介绍里明确提到的要求或禁忌；没有就留空' },
    creator_age: { type: 'string', description: '博主本人的年龄或年龄段，介绍里写了才填' },
    creator_gender: { type: 'string', enum: [...GENDERS, ''], description: '介绍里明确写了才填' },
    creator_industry: { type: 'string', description: '博主所在行业，介绍里写了才填' },
    creator_role: { type: 'string', description: '博主的岗位或身份，介绍里写了才填' },
    creator_traits: { type: 'string', description: '性格、经历里和写作有关的特点，一两句，介绍里有依据才填' },
  },
  required: ['name', 'platform', 'tone', 'content_focus', 'audience', 'problem', 'notes',
    'creator_age', 'creator_gender', 'creator_industry', 'creator_role', 'creator_traits'],
  additionalProperties: false,
};

export const QUICKSTART_SYSTEM =
`你帮刚来的自媒体作者建账号设定。给你一段他的自我介绍，可能还有几篇他以前写的文章，把账号设定的各项填出来，给他检查修改。
要求：
1. **只填有依据的**：介绍或文章里看得出来的才填，看不出来的留空字符串。宁可留空，也不要替他编年龄、性别、行业、经历。
2. 「写什么、写给谁、解决什么问题」可以从文章内容归纳，但要说具体：「职场新人的第一年」好过「职场成长」。
3. 平台和调性只能从给定选项里选；判断不了就留空。
4. 用他自己的说法：介绍里有现成的词就用他的词，不要改成营销腔。
5. 全部使用简体中文。`;

export const quickstartUser = (intro, posts = []) =>
`${fence('自我介绍', intro)}
${posts.length ? `\n${posts.map((p, i) => fence(`旧文章${i + 1}`, p.slice(0, 3000))).join('\n')}\n` : ''}
${DATA_NOTE}`;

