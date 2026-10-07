/* 标题类型、开头类型：给发布数据分组用（哪种标题、哪种开头在这个号上数据好）。
 *
 * 用规则判断，不调模型：发布数据每次打开复盘都要重算，规则零成本、结果稳定、作者能看懂为什么归到这一类。
 * 分得粗是故意的——分组太细每组凑不够 3 篇，就什么结论都给不出。
 * 判断顺序就是优先级：一个标题既是提问又带数字，算「提问式」。 */

export const TITLE_TYPES = ['提问式', '数字清单', '反差对比', '亲历讲述', '直给观点'];
export const OPENING_TYPES = ['场景故事', '抛出问题', '数据事实', '观点先行', '直接切入'];

const NUM_UNIT = /(?<!第)(\d+|[一二两三四五六七八九十百千万]+)\s*(个|条|招|步|种|点|件|句|天|年|次|本|岁|倍|%|万|小时|分钟)/;

export function titleType(title) {
  const t = String(title || '').replace(/^#+\s*/, '').trim();
  if (!t) return '';
  if (/[?？]|(吗|呢|么)$|为什么|为何|怎么|如何|凭什么|哪些|是不是|能不能|该不该/.test(t)) return '提问式';
  if (NUM_UNIT.test(t) || /^\d/.test(t)) return '数字清单';
  if (/不是.{0,12}而是|却|反而|其实|别再|千万别|竟然|居然|没想到|误区|真相|\bvs\b|VS|对比|比.{0,8}更/.test(t)) return '反差对比';
  if (/我|自己|亲历|那年|那天/.test(t)) return '亲历讲述';
  return '直给观点';
}

/* 正文开头：去掉标题行，取第一段的前两句 */
export function openingOf(content) {
  const lines = String(content || '').split('\n').map((l) => l.trim())
    .filter((l) => l && !/^#{1,6}\s/.test(l) && !/^[-*>]\s*$/.test(l) && !/^【.*】$/.test(l) && !/^(标题|口播|画面|字幕)[:：]/.test(l));
  const first = (lines[0] || '').replace(/^[>*\-\s]+/, '');
  const sentences = first.match(/[^。！？!?]+[。！？!?]?/g) || [];
  return sentences.slice(0, 2).join('');
}

export function openingType(content) {
  const head = openingOf(content);
  if (head.length < 4) return '';
  const firstSentence = (head.match(/[^。！？!?]+[。！？!?]?/) || [''])[0];
  if (/[?？]/.test(firstSentence)) return '抛出问题';
  if (/(那天|那年|昨天|前天|上周|上个月|去年|有一次|记得|刚|凌晨|早上|晚上|下午|中午|\d+\s*点|周[一二三四五六日末])/.test(firstSentence)
    || /^(我|那|当)/.test(firstSentence) && /了/.test(firstSentence)) return '场景故事';
  if (/\d+(\.\d+)?\s*(%|万|亿|倍|个百分点)|数据|调查|报告显示|统计/.test(firstSentence)) return '数据事实';
  // 观点先行：一句短的判断（「管理就是翻译。」），不是「这篇想聊聊……」这种开场白
  if (firstSentence.length <= 24 && /就是|才是|不是|是|永远|从来|一定|最|必须|别/.test(firstSentence)
    && !/^(我|这篇|今天|本文|聊聊|大家好|最近)/.test(firstSentence)) return '观点先行';
  return '直接切入';
}
