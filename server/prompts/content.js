import { weigh } from '../refs.js';
import { fence } from './_shared.js';
import { brief } from './topics.js';
import { materialsBlock } from './publish.js';

export { HUMAN_STYLE } from './_human.js';
import { HUMAN_STYLE } from './_human.js';

/* 意见明显动结构 / 整体语气时才整篇重写；其余走「哪句换成哪句」的局部替换 */
const STRUCTURAL_RE =
  /重排|换顺序|调整顺序|整体|全文|从头|结构|换语气|换调性|大改|重写|改成.*风格|改成清单|改成故事|缩短一半|加长一倍|篇幅|整篇|通篇|全部重/;
export const isStructuralRevise = (notes) => STRUCTURAL_RE.test(String(notes || ''));

export const REVISE_PATCH_SCHEMA = {
  type: 'object',
  properties: {
    note: { type: 'string', description: '一句话说明怎么落实意见；落实不了就说原因' },
    edits: {
      type: 'array',
      maxItems: 12,
      items: {
        type: 'object',
        properties: {
          find: { type: 'string', description: '从正文逐字照抄要改的那一句或那一段' },
          replace: { type: 'string', description: '换成的文字；要删掉就给空字符串' },
          all: { type: 'boolean', description: '意见明确说每一处都改时为 true，否则 false' },
        },
        required: ['find', 'replace', 'all'],
        additionalProperties: false,
      },
    },
  },
  required: ['note', 'edits'],
  additionalProperties: false,
};

export const REVISE_PATCH_SYSTEM =
`你在按作者的修改意见改一篇已经写好的稿子。意见只涉及局部时，用 find / replace 列出改动，不要重写全文。

规则：
1. find 必须从正文**逐字照抄**（含标点），程序才能找到。
2. 意见没提到的句子一个字都不要动，也不要借机润色。
3. 事实、数字、作者经历不要改、不要新编；意见要求删的才删。
4. 意见说不清改哪、或改不动时，edits 给空数组，note 里说明。
5. 全部使用简体中文。`;

export const revisePatchUser = (text, notes) =>
`—— 作者的修改意见 ——
${fence('修改意见', notes)}

—— 当前正文 ——
===== 正文开始 =====
${text}
===== 正文结束 =====

只改意见里要求的地方。find 必须从上面的正文逐字照抄。`;

export const CONTENT_SYSTEM =
`你是一位一线自媒体写手，为指定平台产出可直接发布的成稿。
要求：
1. 严格遵守平台写作规范与风格调性，语感自然，像人写的，不像模板填空。
2. 内容要有具体信息：真实的场景、可执行的步骤、可感的细节。宁可写深一个点，也不要样样浅尝。
3. 不要出现「作为一个 AI」「以下是」这类元话语，不要写解释性前言，直接从成稿开始。
4. 不确定的事实用可核查的表述方式（如「据公开报道」）或改写成经验性表达，绝不编造具体数据、机构名或引语。
5. 若给出了账号设定，全文的立场、称呼、举例和知识密度都要贴合该账号的目标用户，并遵守其中列出的要求与禁忌。
   若还给出了博主本人的人设，第一人称就是这个人——他的年龄、行业、岗位和性格要落在具体的措辞与例子里，而不是被直白地写出来。
6. 输出 Markdown：第一行是 # 标题，正文分段；口播类脚本按规范分栏标注。
7. 若给出了写法框架，按框架的段落顺序和各段篇幅比例组织全文；框架只决定结构，事实仍然只能来自个人档案、素材和简报。
8. 全部使用简体中文。

${HUMAN_STYLE}`;

export const contentUser = (d, topic, persona, samples, materials = [], me = null, perf = '') =>
`按下面选定的方向写出完整成稿。

${brief(d, persona, samples, me)}
${materialsBlock(materials) ? `\n${weigh(materialsBlock(materials), me?.refs, 'materials')}\n` : ''}${perf ? `\n${perf}\n` : ''}

—— 选定方向 ——
标题：${topic.title}
切入角度：${topic.angle}
开篇钩子：${topic.hook}
适配读者：${topic.audience_fit || ''}
内容骨架：
${(topic.outline || []).map((s, i) => `${i + 1}. ${s}`).join('\n')}

请沿用这个方向和骨架展开，可以在骨架基础上补充细节和过渡，但不要改变核心角度。`;

/* 按作者的修改意见，在原稿上整篇重写。意见是作者自己写的，当资料放进栏里；
   原稿里的事实、数字、经历是作者确认过的，意见没要求就不要动 */
export const reviseUser = (d, persona, samples, me, text, notes) =>
`按作者的修改意见，在下面这篇原稿的基础上重写全文。

${brief(d, persona, samples, me)}

—— 原稿 ——
${fence('原稿', text)}

—— 作者的修改意见 ——
${fence('修改意见', notes)}

要求：
1. 意见里提到的每一条都要落实；意见没提到的部分尽量保持原样，不要为了改而改。
2. 原稿里的事实、数字、案例和作者本人的经历不要改动、不要新编；意见要求删掉的才删。
3. 保持这个号一贯的语气和平台写作规范，篇幅和原稿相近（意见要求加长或缩短的除外）。
4. 直接输出改好的完整正文（Markdown），不要说明改了哪里，不要加前言后语。`;
