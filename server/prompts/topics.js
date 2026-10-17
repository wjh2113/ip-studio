import { frameworkBlock } from '../frameworks.js';
import { weigh, weightNote } from '../refs.js';
import {
  DATA_NOTE, fence, platformSpec, toneSpec,
} from './_shared.js';
import { profileBlock, styleBlock } from './learning.js';

/* 三个方向的 JSON 结构 —— Anthropic 走 output_config.format，其它渠道走提示词约束 */
export const TOPICS_SCHEMA = {
  type: 'object',
  properties: {
    topics: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: {
        type: 'object',
        properties: {
          label: {
            type: 'string',
            description: '给这个方向定性的短标签，2-6 个字，如「个人经历」「方法拆解」「反常识」「对比测评」「行业视角」。'
              + '三个方向的标签必须互不相同，且要能一眼看出差异在哪个维度上',
          },
          title: { type: 'string', description: '可直接使用的标题，符合平台调性' },
          angle: { type: 'string', description: '这个方向的切入角度，一句话说清和另外两个的区别。要具体到"它写什么、另外两个不写什么"' },
          hook: { type: 'string', description: '开篇钩子，一到两句' },
          outline: {
            type: 'array', minItems: 3, maxItems: 5,
            items: { type: 'string' },
            description: '3-5 条内容骨架，每条一个要点',
          },
          audience_fit: { type: 'string', description: '最适合打动谁、为什么' },
        },
        required: ['label', 'title', 'angle', 'hook', 'outline', 'audience_fit'],
        additionalProperties: false,
      },
    },
  },
  required: ['topics'],
  additionalProperties: false,
};

export const creatorBlock = (a) => {
  if (!a) return null;
  const age = String(a.creator_age || '').trim();
  const lines = [
    age ? `年龄：${/^\d+$/.test(age) ? `${age} 岁` : age}` : null,
    a.creator_gender ? `性别：${a.creator_gender}` : null,
    a.creator_industry ? `所在行业：${a.creator_industry}` : null,
    a.creator_role ? `岗位：${a.creator_role}` : null,
    a.creator_traits ? `性格特征：${a.creator_traits}` : null,
  ].filter(Boolean);
  if (!lines.length) return null;

  return `—— 博主本人（第一人称就是这个人）——
${lines.join('\n')}

行文以这个人的身份展开：自称与生活处境要符合其年龄阶段，举例和类比优先取自其行业与岗位的真实工作场景，
语气节奏贴合其性格特征。不要点名罗列这些设定，要让它自然体现在选材、措辞和态度里；
也不要虚构与这份人设明显冲突的经历（如岗位对不上的专业细节、年龄段不符的生活状态）。`;
};

export const personaBlock = (a) => {
  if (!a) return null;
  const lines = [
    `账号名称：${a.name}`,
    a.content_focus ? `内容定位（主要写什么）：${a.content_focus}` : null,
    a.audience ? `账号目标用户：${a.audience}` : null,
    a.problem ? `账号为读者解决的问题：${a.problem}` : null,
    a.notes ? `其它要求与禁忌：${a.notes}` : null,
  ].filter(Boolean);
  return `—— 账号设定 ——\n${lines.join('\n')}\n\n本次创作必须落在这个账号的定位之内：服务它的目标用户、回应它要解决的问题、延续它一贯的语气；不要写成任何账号都能发的通用内容。`;
};

export function brief(d, persona, samples, me = null) {
  const p = platformSpec(d.platform);
  const account = personaBlock(persona);
  const creator = creatorBlock(persona);
  const profile = weigh(profileBlock(me?.profile, { compact: me?.compact }), me?.refs, 'profile');
  const style = styleBlock(persona, samples, me?.prefs, me?.refs);
  const section = sectionBlock(d.section, d.inputs);
  const framework = frameworkBlock(d.framework, d.length);
  const hot = hotspotRefBlock(d.hotspot);
  const head = [account, creator, profile, style, section, framework].filter(Boolean);
  return [
    head.join('\n\n') || null,
    hot ? `\n${hot}` : null,
    head.length || hot ? '\n—— 本篇简报 ——' : null,
    `题材：${d.subject}`,
    `发布平台：${p.label}`,
    `风格调性：${d.tone} —— ${toneSpec(d.tone)}`,
    d.audience && d.audience !== persona?.audience
      ? `本篇聚焦读者：${d.audience}`
      : (persona?.audience ? null : '目标读者：由你根据题材判断'),
    d.keywords ? `必须覆盖的关键词/信息点：${d.keywords}` : null,
    `目标篇幅：约 ${d.length} 字`,
    `\n平台写作规范：\n${p.spec}`,
    (style || section || hot || profile) ? `\n${DATA_NOTE}` : null,
  ].filter((x) => x != null).join('\n');
}

export const TOPICS_SYSTEM =
`你是一位资深自媒体主编，擅长把一个宽泛题材拆成几个真正不同的选题方向。
要求：
1. 三个方向必须在「切入角度」上互相错开——比如个人经历 / 方法拆解 / 反常识观点 / 对比测评 / 行业视角，不要只是换标题措辞。
   **label 就是这个差异维度的名字**，2-6 字，三个必须互不相同。
   **angle 要说清"它写什么、另外两个不写什么"**——读者是靠这一句来选的，写成套话等于三个方向没区别。
2. 标题写成可以直接发布的样子，符合目标平台的语感，不要出现「方向一」这类元描述。
3. 钩子要具体：给出场景、数字、冲突或反差，禁止「你知道吗」「今天教大家」这类套话。
4. 骨架每条都是能写成一段的实质要点，不是空泛的小标题。
5. 若给出了账号设定，三个方向都必须服务于该账号的定位与它要解决的问题——差异体现在切入角度上，而不是跑到账号定位之外去。
   若给出了博主本人的人设，优先选那些他凭自身年龄、行业、岗位和性格真的写得出来、别人写不出来的角度。
6. 若指定了栏目，三个方向都必须是这个栏目该有的样子——比如「来时路」就该讲来历和差异，不要写成干货教程。
7. 若给出了写法框架，三个方向的内容骨架都按框架的段落顺序展开（骨架条目和框架槽位一一对应），差异仍然体现在切入角度上。
8. 全部使用简体中文。`;

export const topicsUser = (d, persona, samples, perf = '', me = null) =>
`请基于下面这份创作简报，给出 3 个差异化的选题方向。

${brief(d, persona, samples, me)}${perf ? `\n\n${perf}` : ''}`;

/* 过往发布数据（server/performance.js 算好的），只在样本够时才有。
   数字和标题放在标签里当资料；怎么用写在标签外面，而且明确排在题材契合和差异化之后。 */
export function performanceBlock(perf, use = 'topics') {
  if (!perf?.enough) return '';
  const byLift = Object.entries(perf.byLabel || {}).sort((a, b) => b[1].lift - a[1].lift);
  const good = byLift.filter(([, g]) => g.lift >= 1.3);
  const weak = byLift.filter(([, g]) => g.lift <= 0.7);
  const fmt = (list) => list.map(([k, g]) => `「${k}」阅读中位数 ${g.median}（${g.n} 篇）`).join('；');
  const lines = [];
  const split = (group) => {
    const list = Object.entries(group || {}).sort((a, b) => b[1].lift - a[1].lift);
    return [list.filter(([, g]) => g.lift >= 1.3), list.filter(([, g]) => g.lift <= 0.7)];
  };
  if (use === 'topics') {
    if (good.length) lines.push(`数据好的方向类型：${fmt(good)}`);
    if (weak.length) lines.push(`数据弱的方向类型：${fmt(weak)}`);
    const [tg, tw] = split(perf.byTitle);
    if (tg.length) lines.push(`数据好的标题写法：${fmt(tg)}`);
    if (tw.length) lines.push(`数据弱的标题写法：${fmt(tw)}`);
  }
  if (use === 'content') {
    const [og, ow] = split(perf.byOpening);
    if (og.length) lines.push(`数据好的开头方式：${fmt(og)}`);
    if (ow.length) lines.push(`数据弱的开头方式：${fmt(ow)}`);
    if (!lines.length) return '';
    return `—— 这个号过往的发布数据（${perf.n} 篇，阅读中位数 ${perf.overall}）——
${fence('performance', lines.join('\n'))}
${DATA_NOTE}
参考用法：开篇可以往数据好的开头方式上靠，但选定方向的开篇钩子和事实要求优先，不要为了套路改掉方向。`;
  }
  if (perf.top?.length) lines.push(`数据最好的几篇：${perf.top.map((t) => `《${t.title}》阅读 ${t.views}`).join('；')}`);
  if (!lines.length) return '';
  const how = use === 'topics'
    ? '参考用法：三个方向里可以有一个用数据好的方向类型，少用数据弱的；题材契合和三个方向之间的差异仍然优先，不要为了套类型硬凑。'
    : '参考用法：可以沿着数据好的那几篇的主题往深处或旁边延伸，但不能重复它们；账号定位仍然优先。';
  return `—— 这个号过往的发布数据（${perf.n} 篇，阅读中位数 ${perf.overall}）——
${fence('performance', lines.join('\n'))}
${DATA_NOTE}
${how}`;
}

/* ==================================================================
 * 题材推荐：进入创作简报时默认给三条这个号还没写过的题材
 * ================================================================== */

export const SUBJECTS_SCHEMA = {
  type: 'object',
  properties: {
    ideas: {
      type: 'array', minItems: 3, maxItems: 3,
      items: {
        type: 'object',
        properties: {
          subject: { type: 'string', description: '一句话的题材，就是「这篇写什么」，15-30 字，不是标题' },
          reason: { type: 'string', description: '一句话说明为什么这个号现在适合写它，20 字以内' },
        },
        required: ['subject', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['ideas'],
  additionalProperties: false,
};

export const SUBJECTS_SYSTEM =
`你是这个自媒体账号的选题策划。给你账号的定位和它已经写过的东西，你要提出三条**还没写过的新题材**。
要求：
1. 「题材」是「这篇写什么」的范围，不是标题——别写成带钩子的标题党句子，也别写成空泛的大词（如「聊聊效率」）。
2. 三条必须落在账号定位之内：服务它的目标用户、回应它要解决的问题；同时三条之间在**内容主题**上要明显错开，
   不要是同一件事的三种说法（切入角度的差异是下一步的事，这里要的是三个不同的题目）。
3. **严格避开已写过的清单**：不只是字面不同，实质主题重合的也不行；某个题材只是"换个说法"重提旧事，就换一个。
4. 优先挑这个号真的写得出来的：能用到博主本人的行业、岗位、生活处境的，比泛泛的通用话题好。
5. 每条配一句话理由，说人话，别写"能引发共鸣"这类套话。
6. 全部使用简体中文。`;

export const subjectsUser = (persona, used = [], perf = '') => {
  const head = [personaBlock(persona), creatorBlock(persona)].filter(Boolean).join('\n\n');
  const history = used.length
    ? used.map((u, i) => `${i + 1}. ${u.subject}${u.title && u.title !== u.subject ? `（成稿标题：${u.title}）` : ''}`).join('\n')
    : '（这个号还没写过任何内容）';

  return `${head}

—— 这个号已经写过的（务必避开）——
${history}

${perf ? `${perf}\n\n` : ''}请给出 3 条这个号还没写过的新题材。`;
};

/* ==================================================================
 * 热点比对：把榜单和账号定位放一起，挑出真能蹭的
 * ================================================================== */

export const HOTSPOT_SCHEMA = {
  type: 'object',
  properties: {
    matches: {
      type: 'array', minItems: 0, maxItems: 5,
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer', description: '榜单列表里的编号，必须原样引用' },
          source_title: { type: 'string', description: '该条热点的原标题，逐字照抄' },
          angle: { type: 'string', description: '蹭热点的点：这条热点和这个账号之间的那座桥，一到两句说清' },
          subject: { type: 'string', description: '选题建议：一句可以直接开写的题材，15-30 字' },
          strength: { type: 'string', enum: ['强', '中', '弱'], description: '关联强度' },
          caution: { type: 'string', description: '需要注意的分寸；没有就留空字符串' },
        },
        required: ['index', 'source_title', 'angle', 'subject', 'strength', 'caution'],
        additionalProperties: false,
      },
    },
    note: { type: 'string', description: '一句话总体判断，比如今天整体没什么可蹭的' },
  },
  required: ['matches', 'note'],
  additionalProperties: false,
};

export const HOTSPOT_SYSTEM =
`你是这个自媒体账号的热点编辑。给你一份全网榜单和这个账号的定位，你要挑出**这个号真的能蹭**的热点。

判断标准：
1. **宁缺毋滥**。只挑和账号定位、目标用户、要解决的问题有真实关联的；关联牵强就不要选。
   **只有「强」和「中」的会被采用，标成「弱」的会被系统直接丢掉**——所以不要用弱关联的条目凑数，那是白写。
   一条都没有就返回空列表，并在 note 里说清今天为什么没有——这是完全可以接受的答案，不要为了凑数硬找。
2. 优先选那些**这个号有独特发言权**的：能用上博主本人的行业、岗位、经验，别人蹭不出这个角度的。
3. 「蹭热点的点」要具体到那座桥：热点里的哪个细节 × 账号关心的哪件事 = 一个新的表达。
   不要写「可以结合这个话题谈谈自己的看法」这种等于没说的话。
4. 「选题建议」是可以直接开写的题材，不是标题，也不是热点原标题的复述。

**红线（必须遵守）**：
- 涉及伤亡、灾难、事故、犯罪、疾病爆发、个人不幸、以及政治敏感的内容，**一律不要作为可蹭热点推荐，直接跳过**。
  这类事件不是流量素材。哪怕它和账号定位沾边，也不要选。
- **点名到具体个人的争议**——要求某人道歉、批评某人、某人被开除/被告/互撕——一律跳过，
  哪怕它背后的公共议题和账号有关。要谈那个议题，就等一条不点名的热点，或者自己另起一个选题。
- 娱乐八卦、明星私事、网络骂战，除非账号定位本身就是这个领域，否则也跳过。
- 如果某条热点本身可以蹭、但容易踩到当事人或读者，就在 caution 里写清分寸；没有风险就留空字符串。

榜单在给你之前，已经由系统过滤掉了伤亡、灾难、犯罪、战争、点名争议、明星私生活这几类；
但过滤是关键词规则，难免有漏网的——**你看到明显属于这几类的，仍然要自己跳过**。

**你只看得到标题**（有的带一句摘要），看不到原文。所以：
- 「蹭热点的点」只能建立在标题/摘要**字面给出的信息**上，不要补充你以为的背景、人物、数据或来龙去脉——你并不知道。
- 如果一条热点光看标题判断不了它到底在说什么，就不要选它。

index 必须是榜单里的真实编号，source_title 必须逐字照抄，不要改写。全部使用简体中文。`;

export const hotspotUser = (persona, items) => {
  const head = [personaBlock(persona), creatorBlock(persona)].filter(Boolean).join('\n\n');
  const list = items
    .map((it, i) => `${i + 1}. [${it.platform}] ${it.title}${it.summary ? `　—　${it.summary.slice(0, 60)}` : ''}`)
    .join('\n');

  return `${head}

—— 当前全网榜单 ——
${fence('榜单', list)}
${DATA_NOTE}

请从中挑出这个账号真能蹭的热点，最多 5 条，宁可少也不要硬凑。`;
};

/* 把抓到的原文压成概要 —— 只允许复述原文，不许补充 */
export const ARTICLE_SUMMARY_SYSTEM =
`你在为一位自媒体作者做资料卡。给你一篇文章的正文，请压成 2-3 句话的概要。
要求：
1. 只写原文里**确实说了**的事：发生了什么、谁说的、关键数字或结论。
2. 不要评价，不要引申，不要补充原文之外的背景——你只是在复述。
3. 抓到的正文可能夹带网页导航、广告、评论区文字，忽略它们，只概括主体内容。
4. 如果正文残缺到看不出在讲什么，只回一个字：无。
5. 120 字以内，简体中文，直接输出概要本身。`;

export const articleSummaryUser = (title, body) =>
`标题：${title}

正文（可能含网页杂质）：
${fence('网页正文', body)}
${DATA_NOTE}`;

/* 创作时引用热点：只能用概要里的信息 */
export const hotspotRefBlock = (hot) => {
  if (!hot?.title) return null;
  const summary = String(hot.summary || '').trim();
  return `—— 本篇要借势的热点 ——
${fence('热点', `原标题：${hot.title}${hot.platform ? `（来源：${hot.platform}）` : ''}
${summary ? `原文概要：${summary}` : '原文概要：抓不到原文，只有这个标题。'}`)}
${hot.angle ? `蹭这条的角度：${hot.angle}` : ''}

写作要求：
- 在开头或前三分之一处**自然地把这条热点当作由头引出来**，别写成新闻转述，也别通篇围着它转——它是引子，账号自己的观点才是主体。
- ${summary
    ? '引用时只能用上面概要里给出的信息。概要没说的细节、数字、人名、时间一律不要写。'
    : '**没有原文概要，所以你不知道这条热点的具体内容**。只能写到「最近大家在讨论 XX」这个程度，绝对不要编造事件细节、数据或当事人说法。'}
- 不要写「据报道」「有数据显示」这类看似有出处、实则没有的表述。`;
};

/* ==================================================================
 * 内容栏目：一个账号下的几条内容线
 * ================================================================== */

/* 预设只是起手模板，用户可以改可以删，也可以完全自定义 */
export const SECTION_PRESETS = [
  {
    name: '来时路',
    purpose: '讲清楚这个号是怎么来的、为什么是我在做、和同类账号的不一样在哪',
    guide: '用具体的时间点和转折事件推进，不喊口号不写宣言；把「为什么是我」落在真实经历和代价上；'
      + '差异化不要自夸，用别人做不到的具体事实说话；结尾给读者一个继续看下去的理由。',
    fields: [
      { label: '你的背景经历', hint: '做过什么、在哪待过、有什么别人没有的经历', required: true },
      { label: '为什么开始做这个号', hint: '触发你开始的那件事或那个念头', required: true },
      { label: '和同类账号的不一样', hint: '别人做不到、或者不愿意做的是什么' },
      { label: '想让读者记住你什么', hint: '一句话' },
    ],
  },
  {
    name: '生活日常',
    purpose: '记录日常里和账号定位相关的真实片段，让读者看到人，而不只是内容',
    guide: '场景优先、细节先行，从一个具体的时刻切进去；允许没有结论、不硬塞道理；'
      + '和账号主题保持若即若离的关联，不要写成流水账。',
    fields: [
      { label: '具体是哪天、什么场景', hint: '时间、地点、当时在干嘛', required: true },
      { label: '发生了什么', hint: '按顺序说，越具体越好', required: true },
      { label: '你当时的感受', hint: '不用升华，如实说' },
    ],
  },
  {
    name: '干货教程',
    purpose: '把一件具体的事拆成读者今天就能照着做的步骤',
    guide: '开头先说清这篇能解决什么问题、适合谁；步骤要能被验证，给判断标准而不只是动作；'
      + '标出常见的坑和对应的修正；结尾给一个最小可行的起点。',
    fields: [
      { label: '要教会读者做什么', hint: '做完之后他能得到什么结果', required: true },
      { label: '你自己的实操经验', hint: '你是怎么做的、用了什么工具、花了多久', required: true },
      { label: '常见的坑', hint: '你见过别人在哪一步翻车' },
      { label: '判断做对了的标准', hint: '怎么知道这一步做成了' },
    ],
  },
  {
    name: '行业观察',
    purpose: '从行业里正在发生的变化，讲出对读者有用的判断',
    guide: '先给结论再拆机制；用可核查的事实或亲历案例支撑，不堆形容词；'
      + '承认判断的边界和不确定性；落到读者能做的动作上。',
    fields: [
      { label: '你观察到的变化', hint: '具体是什么在变，从什么变成什么', required: true },
      { label: '你的判断', hint: '你认为这意味着什么', required: true },
      { label: '支撑判断的事实或案例', hint: '你亲历的、或可核查的；没有就留空，不要编' },
      { label: '这个判断的边界', hint: '什么情况下它不成立' },
    ],
  },
  {
    name: '答读者问',
    purpose: '回答读者反复问到的问题，一次说透一个',
    guide: '开头复述问题和提问者的处境，让同类读者对上号；先给直接答案再解释为什么；'
      + '区分不同处境下的不同做法；不回避「这件事没有标准答案」。',
    fields: [
      { label: '读者的原问题', hint: '尽量原话，别改写', required: true },
      { label: '提问者的处境', hint: '什么行业、什么阶段、卡在哪' },
      { label: '你的答案要点', hint: '先说结论，再列理由', required: true },
    ],
  },
  {
    name: '避坑指南',
    purpose: '把自己或身边人踩过的坑讲清楚，让读者少走弯路',
    guide: '每个坑写清楚：当时怎么想的、实际发生了什么、代价是什么、现在会怎么做；'
      + '不居高临下，承认当时的判断在当时是合理的；给可复用的识别信号。',
    fields: [
      { label: '踩过的坑', hint: '一个或几个，具体说', required: true },
      { label: '当时是怎么想的', hint: '为什么当时觉得那样做是对的' },
      { label: '实际代价', hint: '损失了什么：钱、时间、机会', required: true },
      { label: '现在你会怎么做', hint: '可复用的做法或识别信号' },
    ],
  },
  {
    name: '幕后故事',
    purpose: '把做这件事的过程本身讲出来，包括不体面的部分',
    guide: '有具体的时间线和数字；写出犹豫、返工和放弃掉的方案；'
      + '不做成功学叙事，允许结果是平淡的。',
    fields: [
      { label: '时间线', hint: '什么时候开始、经过了哪几个阶段', required: true },
      { label: '关键决定', hint: '哪几个岔路口，你选了什么', required: true },
      { label: '返工或放弃掉的方案', hint: '试过但没成的' },
      { label: '结果', hint: '如实说，平淡也没关系' },
    ],
  },
];

export const sectionBlock = (section, inputs = null) => {
  if (!section?.name) return null;
  const lines = [
    `栏目名：${section.name}`,
    section.purpose ? `这个栏目讲什么：${section.purpose}` : null,
    section.guide ? `这个栏目的写作要点：${section.guide}` : null,
  ].filter(Boolean);

  const head = `—— 本篇所属栏目 ——
${lines.join('\n')}

本篇必须是这个栏目该有的样子：它和账号里其它栏目的区别，就体现在上面这几句里。
栏目要点和通用的平台规范冲突时，以栏目要点为准——它更贴近这个号自己的做法。`;

  const materials = sectionInputsBlock(section, inputs);
  return materials ? `${head}\n\n${materials}` : head;
};

/* 栏目要的素材：作者自己填的，是这篇里唯一可信的事实来源 */
export const sectionInputsBlock = (section, inputs) => {
  const fields = Array.isArray(section?.fields) ? section.fields : [];
  if (!fields.length || !inputs) return null;

  const filled = fields
    .map((f) => ({ label: f.label, value: String(inputs[f.label] ?? '').trim() }))
    .filter((f) => f.value);
  const missing = fields.filter((f) => !String(inputs[f.label] ?? '').trim()).map((f) => f.label);
  if (!filled.length) return null;

  return `—— 作者为这个栏目提供的素材 ——
${fence('栏目素材', filled.map((f) => `【${f.label}】${f.value}`).join('\n'))}

这些是作者本人提供的真实信息，**是这篇里唯一可信的事实来源**：
- 写作时优先用它们，把它们展开成有细节的段落，而不是原样复述一遍。
- **不要编造它们之外的个人经历、时间、地点、数字、职位或人物关系。**${missing.length
    ? `\n- 作者没有填「${missing.join('」「')}」，说明他没提供这部分信息——不要脑补，绕开或用不涉及具体事实的方式处理。`
    : ''}`;
};
