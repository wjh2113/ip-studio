import { HUMAN_STYLE } from './_human.js';
import { platformSpec } from './_shared.js';
import { creatorBlock, personaBlock } from './topics.js';
import { profileBlock, styleBlock } from './learning.js';

/* ==================================================================
 * 编辑器里的 AI：划词改写 与 / 唤起续写
 * ================================================================== */

export const ASSIST_ACTIONS = {
  expand:       { label: '扩写',         mode: 'replace', instruction: '把选中这段扩写得更充实：补上具体细节、场景、步骤或数据支撑，长度约为原来的 2 倍。不要注水式重复，也不要改变原意。' },
  professional: { label: '专业点',       mode: 'replace', instruction: '把选中这段改得更专业：用词准确，给出机制、依据或行业惯例，去掉口水话和空泛形容词。长度不要明显增加。' },
  casual:       { label: '轻松点',       mode: 'replace', instruction: '把选中这段改得更轻松口语：拆成短句，有节奏，像跟朋友说话，可以带一点自嘲或网感，但不要油腻、不要硬凑梗。长度不要明显增加。' },
  shorten:      { label: '缩写',         mode: 'replace', instruction: '把选中这段压缩到原来的四到六成，只保留信息量最高的部分。要仍然是通顺的段落，不要变成提纲。' },
  example:      { label: '举个例子',     mode: 'append',  instruction: '为选中这段补一个具体的例子：有场景、有细节、能让人立刻对上号。只输出这个例子本身（一到两段），不要重复原文，不要写「例如」以外的引导语堆砌。不要编造具体数据、机构名或他人引语。' },
  humanize:     { label: '去 AI 味',     mode: 'replace', instruction: '把选中这段改得不像 AI 写的：去掉套话、空泛大词、模板连接词、排比堆叠和升华句；换成作者自己的说话方式（对照语气档案和改稿习惯），有具体的人、事、数字就写具体的；句子长短交错，可以口语。事实、数字、观点一个都不改，不加原文没有的经历和数据。长度和原来差不多。' },
  simplify:     { label: '更好懂',       mode: 'replace', instruction: '把选中这段改写得更容易理解：拆开长句，把抽象说法换成具体的，必要时打一个贴切的比方。信息不能丢，长度可以略增。' },
};

export const COMPOSE_ACTIONS = {
  continue: { label: '续写这一段', instruction: '顺着光标前面的内容往下写一到两段，自然衔接，不要重复已有内容。' },
  heading:  { label: '加个小标题', instruction: '为光标后面的内容写一个小标题。只输出标题本身（含 Markdown 的 ## 前缀），不要写正文。' },
  ending:   { label: '写个结尾',   instruction: '为这篇稿子写一个结尾段：收束全文，落到读者可执行的一步或一句有余味的话，并符合该平台的收尾习惯。' },
  opening:  { label: '写个开头',   instruction: '为这篇稿子写一个开篇：用具体场景、反常识结论或直击痛点的一句话抓住读者，两到四行。' },
};

export const ASSIST_SYSTEM =
`你是这位博主的文字助手，在他的编辑器里就地改写或续写。铁律：
1. **只输出正文本身**——不要解释、不要前言后语、不要加引号或代码块标记。
2. 你的输出会**逐字替换掉选中的那一段**，所以边界必须严格对齐：
   - 绝不能把上文或下文里已经存在的内容（尤其是小标题）抄进输出；
   - 选区是半句话就还它半句话，选区是一段就还它一段——**输出的粒度和体量跟着选区走**；
   - 不要顺手改写选区之外的内容，哪怕你觉得那里写得不好。
3. 输出要和上下文严丝合缝：承接上文的话题与人称，不与下文重复。
4. 保持这个账号和这位博主一贯的语气；给了语气档案就优先服从它。
5. 不编造具体数据、机构名、他人引语；不确定的事实改成经验性表达。
6. 除非另有要求，输出 Markdown 正文片段，使用简体中文。

${HUMAN_STYLE}`;

const contextBlock = (d, persona, samples, me = null) => [
  personaBlock(persona),
  creatorBlock(persona),
  profileBlock(me?.profile, { compact: true }),
  styleBlock(persona, samples, me?.prefs, me?.refs),
  `—— 这篇稿子 ——\n题材：${d.subject}\n发布平台：${platformSpec(d.platform).label}\n风格调性：${d.tone}${d.title ? `\n标题：${d.title}` : ''}`,
  `平台写作规范：\n${platformSpec(d.platform).spec}`,
].filter(Boolean).join('\n\n');

/* 划词改写 */
export const assistUser = (d, persona, samples, { instruction, selection, before, after }, me = null) =>
`${contextBlock(d, persona, samples, me)}

—— 选中的这段 ——
${selection}

—— 它上文的结尾 ——
${before || '（这段就在文章开头）'}

—— 它下文的开头 ——
${after || '（这段就在文章结尾）'}

—— 你要做的 ——
${instruction}
${selection.length < 40 ? `\n注意：选区只有 ${selection.length} 个字，是一个片段而不是完整段落。输出也必须是同一量级的片段，不要扩展成整段或整节。` : ''}`;

/* / 唤起的就地续写 */
export const composeUser = (d, persona, samples, { instruction, before, after }, me = null) =>
`${contextBlock(d, persona, samples, me)}

—— 光标前面已经写好的内容 ——
${before || '（光标在文章最开头）'}

—— 光标后面已有的内容 ——
${after || '（光标在文章最末尾）'}

—— 你要做的 ——
${instruction}`;

/* ==================================================================
 * 语音改稿：话筒里说的是修改要求，不是要贴进正文的新稿
 * ================================================================== */

export const VOICE_EDIT_SCHEMA = {
  type: 'object',
  properties: {
    note: { type: 'string', description: '用一句话复述听懂的修改要求，不要复述整篇' },
    edits: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        properties: {
          find: { type: 'string', description: '从正文逐字照抄要改的那一句或那一段，必须能原样找到' },
          replace: { type: 'string', description: '换成的文字。用户要删掉时给空字符串' },
          all: { type: 'boolean', description: '用户明确说每一处都改时为 true，否则 false' },
        },
        required: ['find', 'replace', 'all'],
        additionalProperties: false,
      },
    },
  },
  required: ['note', 'edits'],
  additionalProperties: false,
};

export const VOICE_EDIT_SYSTEM =
`你在改一篇已经写好的稿子。用户用嘴说了想改哪里、怎么改。你会拿到转写和全文。

转写是**修改要求**，不是要贴进正文的新段落。听懂要求，只改他说到的地方。

**怎么改**：
- 每一处改动用 find / replace。find 必须从正文**逐字照抄**，包括标点，让程序能原样找到。
- replace 只放这一处换成的文字。删掉就给空字符串。
- 没说要改的句子一个字都不要动，也不要借机润色。
- 他说「所有」「每一处」时，all 为 true；否则 all 为 false，只改他点到的那一处。
- 他说不清改哪一句、或转写听不清时，edits 给空数组，note 里说明听不懂哪一点。
- 不要编造具体数据、机构名、他人引语。语气跟这篇原文一致。
- 全文使用简体中文。note 一句话。`;

export const voiceEditUser = (draft, transcript) =>
`—— 修改要求（语音转写） ——
${transcript}

—— 当前正文 ——
===== 正文开始 =====
${draft.content || ''}
===== 正文结束 =====

只改转写里要求的地方。find 必须从上面的正文逐字照抄。`;

/* find 对不上正文的改动丢掉，避免整篇被换掉。all 为真才替换每一处。 */
export function applyVoiceEdits(content, edits) {
  let text = String(content || '');
  const applied = [];
  const skipped = [];
  for (const raw of (Array.isArray(edits) ? edits : []).slice(0, 12)) {
    const find = String(raw?.find || '');
    const replace = String(raw?.replace ?? '');
    const all = Boolean(raw?.all);
    if (!find.trim()) {
      skipped.push('没有给出要改的原文');
      continue;
    }
    const count = text.split(find).length - 1;
    if (!count) {
      skipped.push(`找不到「${find.slice(0, 24)}」`);
      continue;
    }
    if (!all && count !== 1) {
      skipped.push(`「${find.slice(0, 24)}」有 ${count} 处，没有说明要全改`);
      continue;
    }
    text = all ? text.replaceAll(find, replace) : text.replace(find, replace);
    applied.push({ find: find.slice(0, 80), replace: replace.slice(0, 80), count: all ? count : 1 });
  }
  return { content: text, applied, skipped };
}
