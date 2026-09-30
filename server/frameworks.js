/* 框架库：「怎么写」的沉淀。
 *
 * 和素材库分工：素材管「写什么」（作者的真实经历、数据），是事实来源；
 * 框架管「怎么写」（段落顺序、每段干什么、各占多少篇幅），是结构来源。
 * 两者分开存、分开拼进提示词——混在一起，模型会把范文里的事实当成作者的经历写进去。
 *
 * 一个框架 = 若干槽位（slot），每个槽位：role 作用、guide 要点、ratio 篇幅占比。
 * 内置框架写在代码里（key 形如 b:xxx），用户自己的存在 frameworks 表（key 形如 u:123）。
 * 创作时把选中的框架快照存进 drafts.framework_json，之后改框架、删框架都不影响历史稿件。
 */

const s = (role, ratio, guide) => ({ role, ratio, guide });

export const BUILTIN_FRAMEWORKS = [
  // ---------- 通用 ----------
  { key: 'b:pain-solution', name: '痛点 → 方案', summary: '先戳中一个具体问题，再给能照做的解决办法。干货、教程类最稳的写法。',
    platforms: [], scenes: ['干货', '教程', '方法'],
    slots: [s('痛点场景', 0.15, '用一个读者一看就认出来的具体场景开头，不要泛泛地说「很多人都有这个烦恼」'),
      s('原因拆解', 0.2, '说清楚问题为什么会发生，一到三个原因，每个一句话讲透'),
      s('解决办法', 0.4, '分步骤给出能照做的方法，每步写清怎么做、做到什么程度'),
      s('案例或效果', 0.15, '用作者的真实经历或素材证明方法有效；没有素材就写可感的效果，不编数字'),
      s('行动号召', 0.1, '给一个今天就能开始的最小动作，再引导收藏或留言')] },
  { key: 'b:scqa', name: 'SCQA 结构', summary: '情境 → 冲突 → 问题 → 答案。适合讲观点、讲一个判断。',
    platforms: [], scenes: ['观点', '行业', '分析'],
    slots: [s('情境 S', 0.15, '交代读者熟悉的背景，一两句就够'),
      s('冲突 C', 0.2, '指出背景里的矛盾或变化，制造「那怎么办」的张力'),
      s('问题 Q', 0.1, '把冲突收成一个明确的问题'),
      s('答案 A', 0.55, '给出你的答案，并用两三个论据撑住它')] },
  { key: 'b:listicle', name: '清单体', summary: '开头给承诺，中间 3-7 条并列要点，结尾收束。好读、好收藏。',
    platforms: [], scenes: ['清单', '干货', '避坑'],
    slots: [s('开头承诺', 0.1, '告诉读者读完能得到什么，最好带数字'),
      s('清单条目', 0.75, '3-7 条，每条先给一句结论，再用一个具体例子或细节支撑；条目之间互不重复'),
      s('收束', 0.15, '一句话总结，或给出按什么顺序用这份清单')] },
  { key: 'b:story-three-act', name: '故事三幕', summary: '处境 → 冲突与转折 → 收获。适合「来时路」、个人经历。',
    platforms: [], scenes: ['故事', '经历', '来时路'],
    slots: [s('起：处境', 0.2, '时间、地点、当时的我是什么状态，用细节而不是形容词'),
      s('承转：冲突与转折', 0.5, '遇到了什么事、怎么挣扎、哪一刻变了；只用作者给的素材，不编经历'),
      s('合：收获与观点', 0.3, '这件事让我明白了什么，和读者有什么关系')] },
  { key: 'b:contrarian', name: '反常识观点', summary: '先抛一个和直觉相反的结论，再用论据说服。容易出爆款，也容易翻车，论据要硬。',
    platforms: [], scenes: ['观点', '反常识'],
    slots: [s('反常识结论', 0.1, '一句话抛出和大多数人直觉相反的判断'),
      s('常见误区', 0.2, '先把大家通常怎么想说清楚，显得公平'),
      s('论据', 0.45, '用亲历、类比或素材里的数据证明；没有出处的数字不要写'),
      s('适用边界', 0.15, '主动说明这个结论在什么情况下不成立'),
      s('结论', 0.1, '回到开头的判断，给读者一个可带走的看法')] },
  { key: 'b:compare', name: '对比测评', summary: '定标准 → 逐项对比 → 给结论和适合人群。',
    platforms: [], scenes: ['测评', '对比', '选购'],
    slots: [s('背景与标准', 0.15, '为什么要比、按哪几个维度比'),
      s('逐项对比', 0.5, '每个维度写清各自表现，给出判断依据'),
      s('结论与适合人群', 0.25, '不同需求的人分别该选哪个'),
      s('避坑提醒', 0.1, '容易被忽略的一两个坑')] },
  { key: 'b:before-after', name: '前后变化', summary: '之前 → 转折点 → 做了什么 → 之后。适合讲习惯、方法带来的改变。',
    platforms: [], scenes: ['经历', '改变', '习惯'],
    slots: [s('之前的状态', 0.2, '具体、可感，最好有一个画面'),
      s('转折点', 0.15, '是什么让我决定改变'),
      s('做了什么', 0.4, '具体动作和坚持的细节'),
      s('之后的变化', 0.15, '变化要具体，不夸大'),
      s('给读者的建议', 0.1, '读者可以从哪一步开始')] },
  { key: 'b:qa', name: '答读者问', summary: '引用原问题 → 先给结论 → 展开 → 建议。',
    platforms: [], scenes: ['答疑', '问答'],
    slots: [s('读者的问题', 0.1, '原样引用读者的问题，保留他的处境'),
      s('先给结论', 0.15, '一两句直接回答'),
      s('展开分析', 0.5, '为什么这么答，分几个层次说'),
      s('具体建议', 0.2, '他明天就能做的事'),
      s('邀请提问', 0.05, '欢迎有类似问题的人留言')] },
  { key: 'b:pitfalls', name: '避坑指南', summary: '每个坑写清经过、代价和避法。',
    platforms: [], scenes: ['避坑', '经验'],
    slots: [s('场景引入', 0.1, '什么情况下会踩这些坑'),
      s('坑与避法', 0.7, '3-5 个坑，每个写：怎么踩进去的、付出了什么代价、下次怎么避开'),
      s('总清单', 0.2, '把避法收成一份能对照检查的清单')] },
  { key: 'b:behind-scenes', name: '幕后故事', summary: '成果先行 → 幕后过程 → 意外与取舍。',
    platforms: [], scenes: ['幕后', '经历', '故事'],
    slots: [s('成果先行', 0.15, '先展示做成了什么'),
      s('幕后过程', 0.45, '怎么做出来的，关键节点'),
      s('意外与取舍', 0.25, '遇到的意外、放弃了什么、为什么'),
      s('感受与邀请', 0.15, '真实感受，邀请读者聊聊')] },
  { key: 'b:weekly-review', name: '复盘 / 周记', summary: '一句话总结 → 做了什么 → 学到什么 → 下一步。',
    platforms: [], scenes: ['复盘', '周记', '成长'],
    slots: [s('一句话总结', 0.1, '这段时间最重要的一件事'),
      s('做了什么', 0.3, '按重要程度写两三件'),
      s('学到什么', 0.3, '每条对应上面的一件事'),
      s('下一步', 0.2, '接下来打算怎么做'),
      s('邀请读者', 0.1, '请读者分享他的做法')] },
  // ---------- 平台专用 ----------
  { key: 'b:xhs-seed', name: '小红书种草五段式', summary: '抓眼开头 → 真实场景 → 三个亮点 → 使用细节 → 互动。',
    platforms: ['xiaohongshu'], scenes: ['种草', '好物', '推荐'],
    slots: [s('抓眼开头', 0.12, '直接给结果或痛点，一两句，可以带 emoji'),
      s('我的真实场景', 0.2, '我在什么情况下用、为什么需要'),
      s('三个亮点', 0.4, '每个亮点一小段，写具体体验，不写参数堆砌'),
      s('使用细节与注意', 0.18, '怎么用更好、什么人不适合'),
      s('总结与互动', 0.1, '一句话总结，引导收藏或评论区交流')] },
  { key: 'b:xhs-tutorial', name: '小红书教程', summary: '结果前置 → 准备 → 分步 → 易错点 → 收藏引导。',
    platforms: ['xiaohongshu'], scenes: ['教程', '干货'],
    slots: [s('结果前置', 0.1, '先描述做完是什么效果'),
      s('准备什么', 0.15, '工具、材料或前提条件'),
      s('分步操作', 0.55, '步骤 1、2、3，每步一两句，关键处写数值或时长'),
      s('易错点', 0.12, '最容易做错的一两处'),
      s('收藏引导', 0.08, '提示收藏备用')] },
  { key: 'b:dy-hook-3', name: '抖音口播：钩子 + 三点', summary: '3 秒钩子 → 为什么听我说 → 三个要点 → 总结互动。',
    platforms: ['douyin'], scenes: ['口播', '干货'],
    slots: [s('3 秒钩子', 0.08, '一句话抓住人：反问、反常识或结果'),
      s('为什么听我说', 0.1, '一句话亮明身份或经历'),
      s('要点一', 0.22, '一句结论 + 一个例子，口语化'),
      s('要点二', 0.22, '同上，和要点一不重复'),
      s('要点三', 0.22, '同上'),
      s('总结与互动', 0.16, '一句话总结，抛一个问题让观众评论')] },
  { key: 'b:dy-story', name: '抖音口播：反转故事', summary: '悬念开场 → 经过 → 反转 → 观点 → 互动。',
    platforms: ['douyin'], scenes: ['口播', '故事'],
    slots: [s('悬念开场', 0.12, '先说结果或最冲突的一刻'),
      s('事情经过', 0.38, '按时间讲，短句'),
      s('反转', 0.2, '和观众预期不一样的地方'),
      s('观点', 0.2, '这件事说明了什么'),
      s('互动', 0.1, '问观众怎么看')] },
  { key: 'b:gzh-deep', name: '公众号深度长文', summary: '引子 → 问题 → 三个分论点 → 回到读者 → 结语。',
    platforms: ['gongzhonghao'], scenes: ['深度', '观点', '行业'],
    slots: [s('引子', 0.12, '一个故事、现象或新闻引出话题'),
      s('提出问题', 0.08, '把要讨论的问题说清楚'),
      s('分论点一', 0.22, '小标题 + 论证'),
      s('分论点二', 0.22, '小标题 + 论证'),
      s('分论点三', 0.18, '小标题 + 论证'),
      s('回到读者', 0.12, '这和读者自己有什么关系、可以怎么做'),
      s('结语', 0.06, '一句有余味的收尾')] },
  { key: 'b:gzh-case', name: '公众号案例拆解', summary: '案例速览 → 关键动作 → 背后逻辑 → 可借鉴清单。',
    platforms: ['gongzhonghao'], scenes: ['案例', '拆解', '行业'],
    slots: [s('案例速览', 0.15, '发生了什么，一段说完'),
      s('关键动作拆解', 0.45, '他们做对了哪几件事'),
      s('背后逻辑', 0.25, '为什么这样做有效'),
      s('可借鉴清单', 0.15, '读者能拿走的三五条')] },
  { key: 'b:zhihu-answer', name: '知乎回答', summary: '先给结论 → 亮明身份 → 分点论证 → 反方与边界 → 总结。',
    platforms: ['zhihu'], scenes: ['问答', '观点', '干货'],
    slots: [s('先给结论', 0.1, '第一段直接回答问题'),
      s('身份与经历', 0.1, '为什么我有资格回答'),
      s('分点论证', 0.55, '分点展开，每点有论据'),
      s('反方与边界', 0.15, '什么情况下结论不成立'),
      s('总结', 0.1, '重申结论')] },
  { key: 'b:weibo-short', name: '微博短评', summary: '一句观点 → 一个理由 → 态度收尾。',
    platforms: ['weibo'], scenes: ['观点', '热点'],
    slots: [s('观点', 0.25, '一句话亮明态度'),
      s('理由', 0.45, '一个最有力的事实或理由'),
      s('收尾', 0.3, '态度收尾，可带一个话题标签')] },
  { key: 'b:bili-explainer', name: 'B 站科普脚本', summary: '开场问题 → 背景 → 核心讲解 → 案例 → 总结与三连。',
    platforms: ['bilibili'], scenes: ['科普', '讲解'],
    slots: [s('开场问题', 0.1, '一个让人好奇的问题'),
      s('背景知识', 0.2, '理解后面内容需要知道的'),
      s('核心讲解', 0.45, '分段讲清楚，每段一个小标题'),
      s('案例演示', 0.15, '一个具体例子'),
      s('总结与互动', 0.1, '总结要点，引导互动')] },
];

const BUILTIN_BY_KEY = new Map(BUILTIN_FRAMEWORKS.map((f) => [f.key, f]));
export const builtinOf = (key) => BUILTIN_BY_KEY.get(key) || null;

export const FRAMEWORK_LIMITS = { name: 30, summary: 200, slots: [2, 10], role: 20, guide: 200, perUser: 50, scenes: 6, source: 8000 };

/* 清洗用户提交的框架。篇幅占比归一化到合计 1；缺省的平均分。 */
export function normalizeFramework(body = {}, platformKeys = []) {
  const text = (v, max) => String(v ?? '').trim().slice(0, max);
  const name = text(body.name, FRAMEWORK_LIMITS.name);
  if (!name) throw Object.assign(new Error('给框架起个名字'), { status: 400 });
  const raw = Array.isArray(body.slots) ? body.slots : [];
  const slots = raw.map((x) => ({
    role: text(x?.role, FRAMEWORK_LIMITS.role),
    guide: text(x?.guide, FRAMEWORK_LIMITS.guide),
    ratio: Math.max(0, Number(x?.ratio) || 0),
  })).filter((x) => x.role);
  const [min, max] = FRAMEWORK_LIMITS.slots;
  if (slots.length < min) throw Object.assign(new Error(`至少要有 ${min} 段`), { status: 400 });
  if (slots.length > max) throw Object.assign(new Error(`最多 ${max} 段`), { status: 400 });
  const total = slots.reduce((n, x) => n + x.ratio, 0);
  for (const x of slots) x.ratio = total > 0 ? x.ratio / total : 1 / slots.length;
  const platforms = (Array.isArray(body.platforms) ? body.platforms : []).filter((p) => platformKeys.includes(p));
  const scenes = (Array.isArray(body.scenes) ? body.scenes : String(body.scenes || '').split(/[,，、\s]+/))
    .map((x) => text(x, 10)).filter(Boolean).slice(0, FRAMEWORK_LIMITS.scenes);
  const out = { name, summary: text(body.summary, FRAMEWORK_LIMITS.summary), platforms, scenes, slots };
  // 范文原文：只在「从范文拆解」时带上，用来查成稿和范文的重合（防洗稿）；undefined = 不改
  if (body.source_text !== undefined) out.source_text = String(body.source_text || '').trim().slice(0, FRAMEWORK_LIMITS.source);
  return out;
}

/* 防洗稿：成稿里和范文连续 n 字以上相同的片段。标点和空白不算，重叠的片段合并。 */
export function copyOverlap(text, source, n = 8) {
  const norm = (x) => String(x || '').replace(/[\s，。！？、；：“”‘’（）《》【】,.!?;:'"()\[\]<>#*\-—…·]/g, '');
  const a = norm(text);
  const b = norm(source);
  if (a.length < n || b.length < n) return [];
  const grams = new Set();
  for (let i = 0; i + n <= b.length; i += 1) grams.add(b.slice(i, i + n));
  const hits = [];
  let i = 0;
  while (i + n <= a.length) {
    if (grams.has(a.slice(i, i + n))) {
      let j = i + n;
      while (j < a.length && grams.has(a.slice(j - n + 1, j + 1))) j += 1;
      hits.push(a.slice(i, j));
      i = j;
    } else i += 1;
  }
  return hits;
}

/* 推荐：按平台、题材/栏目与场景标签的字面重合、用户自己的优先、用得多的优先。
   量级几十条，规则打分足够，结果可解释。 */
export function recommendFrameworks(list, { platform, subject = '', section = '' } = {}, limit = 3) {
  const hay = `${subject} ${section}`;
  const scored = list
    .filter((f) => !f.platforms.length || f.platforms.includes(platform))
    .map((f) => {
      let score = f.platforms.includes(platform) ? 3 : 0;
      for (const sc of f.scenes) if (sc && hay.includes(sc)) score += 2;
      if (f.name && hay && [...f.name].some((ch) => /[一-龥]/.test(ch) && hay.includes(ch))) score += 0.2;
      if (!f.builtin) score += 1;
      score += Math.log1p(f.used_count || 0) * 0.5;
      return { f, score };
    });
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.f);
}

/* 拼进提示词的框架块。目标字数按槽位占比分配，取整到 10。 */
export function frameworkBlock(fw, length) {
  if (!fw?.slots?.length) return null;
  const total = Number(length) || 800;
  const lines = fw.slots.map((x, i) => {
    const n = Math.max(20, Math.round((x.ratio * total) / 10) * 10);
    return `${i + 1}. ${x.role}（约 ${n} 字）${x.guide ? `：${x.guide}` : ''}`;
  });
  return `—— 本篇写法框架：${fw.name} ——
${lines.join('\n')}

按这个框架的段落顺序和篇幅比例组织全文。槽位名称是写作说明，不要照抄成小标题（除非平台规范本身要求小标题）；
框架只管结构，事实只能来自作者提供的素材和本篇简报，框架里没有的事实不要编。`;
}

/* 存进草稿的快照：只留生成和展示要用的字段 */
export const frameworkSnapshot = (fw) => (fw ? {
  key: fw.key, name: fw.name, summary: fw.summary || '', slots: fw.slots,
} : null);
