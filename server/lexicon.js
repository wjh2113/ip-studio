/* 违禁词本地词库：成稿检查里「确定性」的那一层。
 *
 * 模型查法律风险会漏、也会凑数；词库不花钱、不漏报、结果可复现。两者分工：
 *   - 词库负责「这个词出现了」——一定报，位置精确；
 *   - 模型负责「在这个语境下算不算违规」——比如「最好」在「最好先备菜」里不是广告用语。
 * 所以宽口径的词只报「中」并写明「宣传语境下才违规」，交给作者判断；只有几乎不可能用对的词才报「高」。
 *
 * 词表是起点，不是法律意见。要加词就在对应分组的 words 里加；正则用于需要排除常见搭配的词。
 */

export const LEXICON = [
  {
    key: 'ad-strict', dimension: '法律风险', level: '高', label: '广告法绝对化用语',
    words: ['史上最', '全网最低', '全网第一', '国家级', '世界级', '最高级', '顶级', '万能', '100%有效', '百分百有效', '独一无二', '销量冠军'],
    suggestion: '换成可证明的具体描述（数据 + 出处），或直接删掉',
  },
  {
    key: 'ad-loose', dimension: '法律风险', level: '中', label: '绝对化用语（宣传语境下违规）',
    words: ['最好', '最佳', '最强', '唯一', '首个', '首选', '绝对', '永久', '无敌', '极致'],
    patterns: [/第一(?![次步天个时件条点段期部遍年名批轮周章节页位眼口反感印])/g],
    // 这些搭配是日常说法，不算
    except: [/最好(先|别|不要|还是|的办法|的方式)/, /绝对(不|没|别)/, /唯一(的办法|能做的)/],
    suggestion: '如果是在介绍产品或服务，换成具体、可证明的说法；如果只是日常表达可以忽略',
  },
  {
    key: 'medical', dimension: '法律风险', level: '高', label: '医疗功效承诺',
    words: ['药到病除', '根治', '包治', '治愈率', '抗癌', '防癌', '降血压', '降血糖', '无副作用', '不反弹', '祛病'],
    suggestion: '非医疗机构不能宣称治疗或预防效果；改成个人感受，并提示「因人而异、请遵医嘱」',
  },
  {
    key: 'finance', dimension: '法律风险', level: '高', label: '收益承诺 / 荐股',
    words: ['稳赚', '保本', '零风险', '保证收益', '稳赚不赔', '必涨', '内幕消息', '翻倍收益', '躺赚'],
    suggestion: '不能承诺收益或暗示确定性；如涉及投资，写明「不构成投资建议，投资有风险」',
  },
  {
    key: 'diversion', dimension: '平台调性', level: '中', label: '站外引流',
    words: ['加微信', '加我微信', '加V', '加v', '微信号', '私信领取', '扫码领取', '二维码', 'vx'],
    // 公众号本来就在微信里，提微信不算引流
    skipPlatforms: ['gongzhonghao'],
    suggestion: '小红书、抖音等平台会对站外引流限流甚至封号；改用平台内的私信或群聊功能',
  },
];

const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* 扫一遍正文，返回和模型检查同格式的 flags（多一个 source: '词库'）。
   同一个词只报一次；最多报 12 条，按级别排序。 */
export function scanLexicon(text, { platform } = {}) {
  const src = String(text || '');
  const hits = [];
  const seen = new Set();
  const taken = [];      // 已报过的位置：「史上最好」报了「史上最」，就不再报里面的「最好」
  const overlaps = (a, b) => taken.some(([x, y]) => a < y && b > x);
  for (const rule of LEXICON) {
    if (rule.skipPlatforms?.includes(platform)) continue;
    const res = [
      ...(rule.words || []).map((w) => new RegExp(esc(w), 'g')),
      ...(rule.patterns || []),
    ];
    for (const re of res) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(src))) {
        const word = m[0];
        const around = src.slice(Math.max(0, m.index - 2), m.index + word.length + 6);
        if (rule.except?.some((ex) => ex.test(around))) continue;
        if (overlaps(m.index, m.index + word.length)) continue;
        taken.push([m.index, m.index + word.length]);
        if (seen.has(word)) continue;
        seen.add(word);
        hits.push({
          dimension: rule.dimension,
          level: rule.level,
          quote: word,
          what: `「${word}」属于${rule.label}`,
          suggestion: rule.suggestion,
          locatable: true,
          source: '词库',
          rule: rule.key,
        });
      }
    }
  }
  const order = ['高', '中'];
  return hits.sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level)).slice(0, 12);
}

/* 把词库命中并进模型的检查结果：模型已经报过同一个词的不重复；风险等级重算 */
export function mergeLexicon(review, text, opts) {
  const lex = scanLexicon(text, opts);
  if (!lex.length) return { ...review, lexicon: 0 };
  const covered = (f) => review.flags.some((g) => (g.quote || '').includes(f.quote) || (g.what || '').includes(f.quote));
  const add = lex.filter((f) => !covered(f));
  const flags = [...add, ...review.flags].sort((a, b) => ['高', '中', '低'].indexOf(a.level) - ['高', '中', '低'].indexOf(b.level));
  const risk = flags.some((f) => f.level === '高') ? '高' : flags.length ? '中' : '无';
  return { ...review, flags, risk, lexicon: add.length };
}
