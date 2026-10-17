import { DATA_NOTE, fence, platformSpec } from './_shared.js';
import { creatorBlock } from './topics.js';

/* ==================================================================
 * 口播提示：语气 / 重读 / 停顿 / 表情 / 动作
 * 单独一层，不往成稿正文里塞标记——正文该保持干净可直接发
 * 定位用首尾锚点（head/tail），代码在正文里截出整段，避免模型把全文再输出一遍
 * ================================================================== */

/* 情绪的固定分类——模型给的 emotion 是自由发挥的文字，
   关键词匹配基本命中不了，所以让它顺手归到这五类里的一类 */
export const TONE_TAGS = ['日常', '激动', '沉稳', '吐槽', '温柔'];

export const CUES_SCHEMA = {
  type: 'object',
  properties: {
    overall: {
      type: 'object',
      properties: {
        tone: { type: 'string', description: '整体情绪基调，一句话' },
        pace: { type: 'string', description: '整体语速与节奏建议，一句话' },
        note: { type: 'string', description: '出镜时最该注意的一件事，一句话；没有就留空字符串' },
      },
      required: ['tone', 'pace', 'note'],
      additionalProperties: false,
    },
    cues: {
      type: 'array', minItems: 1, maxItems: 24,
      items: {
        type: 'object',
        properties: {
          head: { type: 'string', description: '这段开头 8～20 个字，从正文逐字照抄（含标点）' },
          tail: { type: 'string', description: '这段结尾 8～20 个字，从正文逐字照抄；很短的一段可以和 head 相同' },
          emotion: { type: 'string', description: '这段用什么情绪念，具体些，如「压着火」「带点自嘲」；平铺直叙就写「平述」' },
          tone_tag: {
            type: 'string', enum: ['日常', '激动', '沉稳', '吐槽', '温柔'],
            description: '把上面的情绪归到最接近的一类，便于下游做确定性匹配。拿不准就给「日常」',
          },
          stress: {
            type: 'array', maxItems: 4, items: { type: 'string' },
            description: '要重读的词，必须是这段原文里出现过的词；没有特别要重读的就给空数组',
          },
          pause: { type: 'string', description: '停顿位置和时长，如「说完"三小时"停一拍」；不需要就留空字符串' },
          expression: { type: 'string', description: '表情，如「挑眉」「先笑一下再收住」；不需要就留空字符串' },
          gesture: { type: 'string', description: '动作，如「摊手」「比三根手指」；不需要就留空字符串' },
        },
        required: ['head', 'tail', 'emotion', 'tone_tag', 'stress', 'pause', 'expression', 'gesture'],
        additionalProperties: false,
      },
    },
  },
  required: ['overall', 'cues'],
  additionalProperties: false,
};

export const CUES_SYSTEM =
`你是给出镜口播做表演指导的人。给你一篇要念出来的稿子，你要标出该怎么念、什么表情、什么动作。

**怎么切段**：按「一口气念完的一句或几句」切，不是按标点也不是按段落。
**怎么定位**：每段只给 head（开头 8～20 字）和 tail（结尾 8～20 字），从正文**逐字照抄**（含标点）。
程序会用 head/tail 在正文里截出整段，所以**不要把整段原文写进输出**。按正文顺序排列，段落之间不重叠。
很短的一段（不足 20 字）head 和 tail 可以相同（都写整段）。
标题、小标题、话题标签这类不念出来的内容跳过，不要给它们标提示。

**每条要给什么**：
- emotion：这段用什么情绪念。要具体——「压着火」「带点自嘲」「像跟朋友吐槽」，
  而不是「认真地」「深情地」这种没法执行的词。真的就是平铺直叙，就写「平述」。
- tone_tag：把 emotion 归到「日常/激动/沉稳/吐槽/温柔」里最接近的一类。
  激动=兴奋惊讶热情，沉稳=认真严肃笃定，吐槽=自嘲嫌弃调侃，温柔=共情安慰亲切，其余给日常。
- stress：要重读的词，**必须是这段原文里真实出现过的词**，最多 4 个。没有特别要强调的就给空数组。
- pause：停顿在哪、停多久，如「说完"三小时"停一拍再接下句」。不需要就留空字符串。
- expression：表情。**真人出镜的自然幅度**，不是舞台剧也不是默剧——挑眉、抿嘴、先笑一下再收住，
  这种程度。绝大多数句子不需要专门的表情，不需要就留空字符串。
- gesture：动作。同样克制：摊手、比数字、指一下镜头、身体前倾。不需要就留空字符串。

**铁律**：
1. **不要每条都填满**。一篇稿子里真正需要专门标表情或动作的地方通常不超过三分之一。
   为了显得认真而每句都配一个动作，念出来会像提线木偶——留空是完全正确的答案。
2. 给了博主人设的，表情和动作要符合这个人：性格内敛的人不要让他挥手跳跃。
3. 只做表演指导，**不要改写、增删正文一个字**。
4. 全部使用简体中文。`;

/* ==================================================================
 * 口播总评：录完一遍之后的一张分数卡
 * 走 quality-chat。发音分数只认网关评测，模型不要另打这项的分。出镜没有材料时必须是 null。
 * ================================================================== */

export const SPEAK_REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    score: { type: 'integer', description: '总分 0-100。某一项为 null 时按其余项权重摊开，不要把 null 当 0 分' },
    dims: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string', enum: ['完整', '发音', '节奏', '表达', '出镜'] },
          score: { description: '0-100 的整数；材料写明没有时必须是 null' },
          note: { type: 'string', description: '这一项为什么是这个分，一句话；null 分也用一句话说明缺了什么材料' },
        },
        required: ['key', 'score', 'note'],
        additionalProperties: false,
      },
    },
    lifts: {
      type: 'array', maxItems: 6,
      items: {
        type: 'object',
        properties: {
          quote: { type: 'string', description: '从稿子逐字照抄的原句。整遍的问题就用最先出错的那一句' },
          lose: { type: 'integer', description: '这一条大概扣掉几分' },
          do: { type: 'string', description: '下一次具体怎么做，一句话' },
        },
        required: ['quote', 'lose', 'do'],
        additionalProperties: false,
      },
    },
    next: { type: 'string', description: '下一次重录最该改的一件事。没有待提升就写「这遍可以过」' },
  },
  required: ['score', 'dims', 'lifts', 'next'],
  additionalProperties: false,
};

export const SPEAK_REVIEW_SYSTEM =
`你是口播总评。用户对着稿子念完一遍。你会拿到：稿子、口播提示、转写、网关发音评测。发音分数由网关给出，总评不要另打这项的分。发音评测和出镜材料如果写的是「无」，对应分数必须是 null。

出一份总评，不要分成多份报告。

分数都是 0–100 的整数。
- 完整：稿子有没有念全，有没有漏句、多句、说错词。依据是转写和稿子的对照。
- 发音：只根据发音评测。材料是「无」时，score 必须是 null，不要靠转写猜读音。材料里已有分数时，照抄那个分数，不要自己另打。
- 节奏：语速是否稳、该停的地方停了没有、有没有嗯啊和卡壳。转写没有时间戳时，只根据嗯、啊、重复和断句判断，不要编造每秒几个字。
- 表达：重读、情绪是否贴上口播提示。提示里没要求的，不要扣分。
- 出镜：看镜头、表情和手势是否过满。材料是「无」时，score 必须是 null。

五项都要出现在 dims 里。总分先按权重算：完整 25、发音 25、节奏 20、表达 20、出镜 10。某一项为 null 时，把它的权重按比例摊到其余有分数的项上，不要把 null 当成 0 分。

待提升只列实际扣分的地方，按影响从大到小，最多 6 条。
每条的 quote 从稿子逐字照抄，lose 是大概扣掉的分数，do 是下一次具体怎么做。
做到了的不要写。不要改稿，不要评选题和文笔。
next 只写下一次重录最该改的一件事。没有待提升时，next 写「这遍可以过」。
全部使用简体中文。`;

export const speakReviewUser = (script, cues, transcript, pronunciation) => {
  const cueText = !cues?.cues?.length
    ? '无'
    : [
      cues.overall?.tone ? `整体基调：${cues.overall.tone}` : '',
      cues.overall?.pace ? `语速节奏：${cues.overall.pace}` : '',
      cues.overall?.note ? `出镜提醒：${cues.overall.note}` : '',
      ...cues.cues.map((c) => {
        const bits = [
          c.emotion ? `语气 ${c.emotion}` : '',
          c.stress?.length ? `重读 ${c.stress.join('、')}` : '',
          c.pause ? `停顿 ${c.pause}` : '',
          c.expression ? `表情 ${c.expression}` : '',
          c.gesture ? `动作 ${c.gesture}` : '',
        ].filter(Boolean).join('；');
        return `${c.quote}${bits ? `（${bits}）` : ''}`;
      }),
    ].filter(Boolean).join('\n');

  const pronBlock = !pronunciation || pronunciation.score == null
    ? '无'
    : [
      `分数 ${pronunciation.score}`,
      pronunciation.note || '',
      ...(Array.isArray(pronunciation.issues) ? pronunciation.issues.map((i) => {
        const q = String(i?.quote || '').trim();
        const n = String(i?.note || '').trim();
        if (!q && !n) return '';
        return q ? `${q}${n ? `（${n}）` : ''}` : n;
      }) : []),
    ].filter(Boolean).join('\n');

  return `—— 稿子 ——
===== 正文开始 =====
${script}
===== 正文结束 =====

—— 口播提示 ——
${cueText}

—— 转写 ——
${fence('转写', transcript || '（空）')}
转写没有逐句时间戳。节奏不要编造语速秒数。${DATA_NOTE}

—— 发音评测 ——
${pronBlock}

—— 出镜 ——
无`;
};

export const cuesUser = (draft, persona, text, { mode = 'video' } = {}) => {
  const context = [
    creatorBlock(persona),
    `—— 发布平台 ——\n${platformSpec(draft.platform).label}${draft.tone ? `　调性：${draft.tone}` : ''}`,
    mode === 'read'
      ? `—— 这一版的用途：朗读 ——\n这是一篇给人看的${platformSpec(draft.platform).label}文章，作者要原样念出来（配朗读音频，或念全文的视频），不是短视频口播。\n按朗读文章的节奏标：句子长就标清楚在哪换气、哪里放慢；重读少而准；表情和动作基本不需要，留空。`
      : '',
    /【(画面|字幕|转场|画面提示)】/.test(text)
      ? '—— 稿子里的分栏标注 ——\n稿子里有【画面】【字幕】【转场】这类拍摄标注：只给要念出来的话标（【口播】后面的句子），head/tail 里不要带标注本身和画面、字幕说明。'
      : '',
  ].filter(Boolean).join('\n\n');

  return `${context}

—— 要念的稿子 ——
===== 正文开始 =====
${text}
===== 正文结束 =====

请标出该怎么念、什么表情、什么动作。每段只给 head 和 tail（各 8～20 字），不要把整段原文写进输出。不需要的地方就留空，不要凑。`;
};
