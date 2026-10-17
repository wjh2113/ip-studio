import { frameworkBlock } from '../frameworks.js';
import { creatorBlock, personaBlock, hotspotRefBlock, sectionBlock } from './topics.js';
import { platformSpec } from './_shared.js';
import { styleBlock } from './learning.js';

/* ==================================================================
 * 成稿检查：模型自己回头看一遍错字和通顺性
 * ================================================================== */

export const REVIEW_DIMENSIONS = ['账号调性', '平台调性', '公序良俗', '法律风险', '热点使用', '事实存疑', '框架符合'];

export const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    verdict: {
      type: 'string', enum: ['ok', 'minor', 'bad'],
      description: '语言层面：ok=可以直接发；minor=有个别毛病，改掉就行；bad=大面积语无伦次，建议重新生成',
    },
    summary: { type: 'string', description: '一句话总体判断，把语言和风险两方面都带上' },
    issues: {
      type: 'array', minItems: 0, maxItems: 20,
      description: '语言错误，每条都要能逐字替换',
      items: {
        type: 'object',
        properties: {
          quote: { type: 'string', description: '有问题的原文片段，逐字照抄，必须能在原文里一字不差地找到；只截出问题所在的最小片段' },
          type: { type: 'string', enum: ['错字', '语句不通', '重复啰嗦', '前后矛盾', '标点格式'], description: '问题类型' },
          fix: { type: 'string', description: '改好之后的片段，直接替换 quote 用' },
          why: { type: 'string', description: '一句话说明问题在哪，20 字以内' },
        },
        required: ['quote', 'type', 'fix', 'why'],
        additionalProperties: false,
      },
    },
    flags: {
      type: 'array', minItems: 0, maxItems: 12,
      description: '调性与风险层面的提示，不做自动替换，交给作者判断',
      items: {
        type: 'object',
        properties: {
          dimension: {
            type: 'string',
            enum: ['账号调性', '平台调性', '公序良俗', '法律风险', '热点使用', '事实存疑', '框架符合'],
          },
          level: { type: 'string', enum: ['高', '中', '低'], description: '高=不改可能出事；中=建议改；低=提一句' },
          quote: { type: 'string', description: '触发这条的原文片段，逐字照抄；整篇性的问题留空字符串' },
          what: { type: 'string', description: '问题是什么，一到两句说清' },
          suggestion: { type: 'string', description: '具体怎么改，一句话' },
        },
        required: ['dimension', 'level', 'quote', 'what', 'suggestion'],
        additionalProperties: false,
      },
    },
  },
  required: ['verdict', 'summary', 'issues', 'flags'],
  additionalProperties: false,
};

export const REVIEW_SYSTEM =
`你是一位中文自媒体的终审编辑。一篇成稿交到你手上，你要分两层过一遍。

════ 第一层：语言错误（写进 issues）════
只挑客观错误：
1. **错字**——别字、同音字用错、多字漏字。
2. **语句不通**——成分残缺、搭配不当、语序混乱、读起来不知所云。
3. **重复啰嗦**——同一个意思连着说两遍、车轱辘话。
4. **前后矛盾**——同一篇里互相打架的说法。
5. **标点格式**——中英文标点混用、括号引号不成对、Markdown 标记写坏。

quote 必须从原文**逐字照抄**（含标点），且只截**最小片段**；原文里找不到的 quote 等于无效。
fix 只修错，不做任何风格改动。整篇大面积语无伦次时 verdict 给 bad，并在 summary 里直说建议重新生成。

════ 第二层：调性与风险（写进 flags）════
按这六个维度查，每条给出 level：高=不改可能出事，中=建议改，低=提一句。

**账号调性**——对照上面给的账号设定、个人人设和（如果有）所属栏目：这篇是不是这个号该发的？
  指定了栏目却写成了别的栏目的样子（比如「来时路」写成了干货教程），也算。
  跑到定位之外、面向的不是它的目标用户、没有回应它要解决的问题、违反它写明的禁忌、
  或者语气明显不像这个人（有语气档案时对照档案）——才报。

**平台调性**——对照给出的平台写作规范：结构、篇幅、开头方式、排版、结尾习惯是否明显不合。
  比如小红书写成了长篇论述、口播脚本没有分栏、公众号通篇短句没有小标题。

**公序良俗**——地域/性别/年龄/职业/学历歧视，贬低特定人群，煽动对立，
  贩卖焦虑到极端，低俗擦边，美化违法或危险行为。

**法律风险**——中国自媒体最常踩的这几条：
  · 广告法绝对化用语：国家级、最高级、最佳、第一、唯一、永久、根治、100%、无副作用……
  · 医疗保健的疗效/治愈承诺，药品器械功效宣称
  · 投资理财的收益承诺、荐股、"稳赚"
  · 像推广但没标明是广告
  · 点名贬损具体企业或个人（商誉）、泄露他人隐私
  · 未授权使用他人作品、肖像、商标

**热点使用**——只有在给了「借势的热点」时才查：
  正文里关于这条热点的事实陈述，有没有超出所给概要的范围？
  概要为空却写了具体细节、数字、当事人说法的，一律报高。
  另外看有没有对当事人不当消费、或把不该蹭的事件当流量素材。

**事实存疑**——具体数字、比例、机构名、研究结论、他人引语，被当成事实写出来但没有可核查的出处的。
  「据报道」「有数据显示」「研究表明」后面跟着无从查证的内容，都算。
  这类只指出来让作者去核实，不要替他判断真假。

**框架符合**——只有给了「本篇写法框架」时才查：
  框架里的某一段整个没写、段落顺序明显颠倒、或某段篇幅严重失衡（比规定多一倍以上或不到一半）才报，
  并在 what 里点名是哪一段。照框架写了但写法灵活、没用小标题，都不算问题。

════ 绝对不要报的 ════
- 口语、短句、省略句、网络用语、语气词、emoji、话题标签——自媒体的正常写法。
- 观点尖锐、有立场、吐槽、自嘲——这是风格不是问题。
- 你个人觉得"可以写得更好"的地方。详略、观点、结构偏好都不归你管。
- 为了显得认真而硬凑。两层都没问题就返回两个空列表，那是好结果。

quote 在 flags 里同样要逐字照抄；整篇性的问题（比如篇幅明显不合平台）quote 留空字符串。
全部使用简体中文。`;

export const reviewUser = (draft, text, persona, samples = []) => {
  const context = [
    personaBlock(persona),
    creatorBlock(persona),
    styleBlock(persona, samples),
    sectionBlock(draft.section, draft.inputs),
    frameworkBlock(draft.framework, draft.length),
    hotspotRefBlock(draft.hotspot),
    `—— 平台写作规范（${platformSpec(draft.platform).label}）——\n${platformSpec(draft.platform).spec}\n目标篇幅：约 ${draft.length} 字`,
  ].filter(Boolean).join('\n\n');

  return `${context}

—— 待审成稿 ——
===== 正文开始 =====
${text}
===== 正文结束 =====

请按两层过一遍：语言错误写进 issues，调性与风险写进 flags。`;
};
