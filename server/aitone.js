/* AI 味扫描：用规则挑出正文里最像 AI 写的地方。不调模型、不花额度、结果可复现。
 *
 * 和违禁词库（lexicon.js）同一个思路：规则负责「这个说法出现了」，改不改、怎么改交给作者
 * （划词菜单里有「去 AI 味」可以就地重写）。报的都是**说法和结构**，不评判内容好坏。
 *
 * 五类：
 *   套话开头 / 空话 —— 「在当今快节奏的时代」「众所周知」「随着……的发展」
 *   AI 腔词汇     —— 「赋能」「助力」「深度剖析」「至关重要」「不言而喻」
 *   连接词模板     —— 「首先……其次……最后」「总而言之」「值得一提的是」「不仅……更……」
 *   排比与对仗     —— 一句里三个以上同样开头的分句；「不是……而是……」用太多
 *   升华结尾       —— 最后一段「让我们」「愿你」「未来可期」「希望对你有帮助」
 * 另外看整体节奏：段落长短过于整齐（像模板一段段填出来的）。
 *
 * 返回和成稿检查同格式的 flags（dimension: 'AI 味'，source: '规则'），最多 12 条。 */

const RULES = [
  {
    key: 'cliche-open', label: '套话开头', level: '中',
    patterns: [
      /在(当今|如今|当下|这个)[^，。！？\n]{0,12}(时代|社会|世界)/g,
      /随着[^，。！？\n]{1,20}的(不断)?(发展|普及|到来|进步|兴起)/g,
      /众所周知/g, /不可否认/g, /毋庸置疑/g, /不言而喻/g,
      /你(是否|有没有)也?(曾经)?[^，。！？\n]{0,16}(过|呢)?[？?]/g,
      /相信(很多人|大家|你)(都)?(有|曾|遇到)/g,
      /话不多说/g, /那么问题来了/g, /接下来(让我们|我们一起)/g, /一起来看看吧/g,
    ],
    suggestion: '删掉这句，直接从一个具体的场景、数字或你自己的事开始',
  },
  {
    key: 'ai-words', label: 'AI 腔词汇', level: '低',
    words: ['赋能', '助力', '抓手', '深度剖析', '全方位', '多维度', '一站式', '无缝衔接', '显著提升', '至关重要',
      '不容忽视', '重中之重', '底层逻辑', '打造', '链路', '闭环', '颗粒度', '降本增效', '高质量发展', '持续深耕',
      '扬帆起航', '砥砺前行', '乘风破浪', '娓娓道来', '妙不可言', '璀璨', '熠熠生辉'],
    suggestion: '换成大白话：说清楚具体做了什么、变化了多少',
  },
  {
    key: 'connectors', label: '模板连接词', level: '低',
    patterns: [/总而言之/g, /综上所述/g, /总的来说/g, /值得一提的是/g, /值得注意的是/g, /需要注意的是/g,
      /不仅[^，。！？\n]{1,20}[，,]?更(是)?/g, /在此基础上/g, /由此可见/g],
    suggestion: '去掉连接词，让上下文自己接上；真要转折用「但」「所以」这种口语',
  },
  {
    key: 'uplift', label: '升华结尾', level: '中',
    tailOnly: true,
    patterns: [/让我们(一起)?/g, /愿(你|我们|每一个)/g, /未来可期/g, /终将/g, /才是最好的/g, /每一个(人|你)都/g,
      /希望(这篇|本文|以上|这些)[^，。！？\n]{0,12}(帮助|启发)/g, /(点赞|收藏)(和|加)?关注/g, /一起加油/g],
    suggestion: '结尾不喊口号、不升华。落到一个具体动作，或者一句只有你会说的话',
  },
];

const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const paragraphs = (text) => String(text || '').split(/\n\s*\n/).map((p) => p.trim())
  .filter((p) => p && !/^#{1,6}\s/.test(p) && !/^[-*]\s|^\d+[.、]/.test(p) && !/^!\[/.test(p));

export function scanAiTone(text) {
  const src = String(text || '');
  const flags = [];
  const seen = new Set();
  const paras = paragraphs(src);
  const tail = paras.slice(-1).join('\n');

  const add = (rule, quote, what) => {
    const k = `${rule.key}:${quote}`;
    if (seen.has(k)) return;
    seen.add(k);
    flags.push({ dimension: 'AI 味', level: rule.level, quote, what, suggestion: rule.suggestion, locatable: Boolean(quote) && src.includes(quote), source: '规则', rule: rule.key });
  };

  for (const rule of RULES) {
    const hay = rule.tailOnly ? tail : src;
    const res = [...(rule.words || []).map((w) => new RegExp(esc(w), 'g')), ...(rule.patterns || [])];
    let n = 0;
    for (const re of res) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(hay)) && n < 4) {
        n += 1;
        add(rule, m[0], `「${m[0]}」是${rule.label}`);
      }
    }
  }

  // 首先 / 其次 / 最后 三件套
  if (/首先/.test(src) && /其次/.test(src) && /(最后|再次)/.test(src)) {
    add({ key: 'first-then', level: '中', suggestion: '拆成几个小标题或几段各自有开头的话，不用序数词串起来' },
      '首先', '用「首先……其次……最后」串段落，是很典型的 AI 结构');
  }

  // 排比：一句里三个以上分句开头两个字相同
  for (const sentence of src.split(/[。！？!?\n]/)) {
    const parts = sentence.split(/[，,；;、]/).map((x) => x.trim()).filter((x) => x.length >= 3);
    for (let i = 0; i + 2 < parts.length; i += 1) {
      const head = parts[i].slice(0, 2);
      if (parts[i + 1].startsWith(head) && parts[i + 2].startsWith(head)) {
        add({ key: 'parallel', level: '低', suggestion: '留一个最有分量的，或者换成一个具体例子' },
          parts.slice(i, i + 3).join('，').slice(0, 40), `连着三个「${head}……」的排比，读起来像模板`);
        break;
      }
    }
  }

  // 不是……而是…… 用太多
  const notBut = src.match(/不是[^。！？\n]{1,24}而是/g) || [];
  if (notBut.length >= 3) {
    add({ key: 'not-but', level: '低', suggestion: '留一两处，其余直接说「是什么」' },
      notBut[0], `「不是……而是……」用了 ${notBut.length} 次，句式重复`);
  }

  // 段落长短过于整齐
  if (paras.length >= 5) {
    const lens = paras.map((p) => p.length);
    const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
    const sd = Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length);
    if (mean > 40 && sd / mean < 0.22) {
      add({ key: 'even', level: '低', suggestion: '长短错开：有的段落一句话就够，有的可以展开写细节' },
        '', `${paras.length} 段长度都在 ${Math.round(mean)} 字上下，节奏太整齐，像一段段填出来的`);
    }
  }

  const order = ['中', '低'];
  return flags.sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level)).slice(0, 12);
}

/* 并进成稿检查的结果：模型已经报过同一处的不重复 */
export function mergeAiTone(review, text) {
  const tone = scanAiTone(text);
  if (!tone.length) return { ...review, aiTone: 0 };
  const covered = (f) => f.quote && review.flags.some((g) => (g.quote || '').includes(f.quote));
  const add = tone.filter((f) => !covered(f));
  return { ...review, flags: [...review.flags, ...add], aiTone: add.length };
}
