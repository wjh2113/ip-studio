/* 成稿参考：生成选题和成稿时带哪些「懂作者」的资料、各带多少、多看重。
 *
 * 每个账号一份，存在 personas.refs_json；不挂账号（全部创作）的按默认。每一项：
 *   on      带不带
 *   weight  low 少量参考 / mid 适中（默认）/ high 重点参考
 * 权重管两件事：召回几条（数量），以及提示词里怎么说（少量：贴切才用；重点：尽量用上、优先于别的参考）。
 * 这里只放纯函数，读写在 db.js 的 Personas.refs / setRefs。 */

export const REF_SOURCES = [
  { key: 'profile', label: '个人档案', hint: '你的工作经历、项目、数据成果和观点；成稿里写到「我」时只用这里的事', counts: [2, 5, 8], unit: '条' },
  { key: 'digest', label: '语气档案', hint: '从你喂过的文章里学到的写法：句子长短、开头结尾习惯、口头禅', counts: null },
  { key: 'samples', label: '相似范文', hint: '和这次题材最像的几篇你写过的文章，只学语感，不搬内容', counts: [1, 2, 3], unit: '篇' },
  { key: 'prefs', label: '改稿习惯', hint: '从你改 AI 初稿的动作里学到的规则（在账号设定「AI 眼中的我」里管）', counts: [6, 12, 20], unit: '条' },
  { key: 'materials', label: '素材库', hint: '你收集的外部资料，按题材挑相关的几条；用的时候会注明出处', counts: [3, 6, 8], unit: '条' },
  { key: 'perf', label: '发布数据', hint: '这个号哪种写法数据好（回填够 6 篇才有）', counts: null },
];
export const REF_WEIGHTS = ['low', 'mid', 'high'];
export const WEIGHT_LABEL = { low: '少量参考', mid: '适中', high: '重点参考' };

/* 存的东西可能缺项、写错：一律补成完整的一份 */
export function normalizeRefs(raw) {
  let obj = raw;
  if (typeof raw === 'string') { try { obj = JSON.parse(raw); } catch { obj = null; } }
  const out = {};
  for (const s of REF_SOURCES) {
    const x = obj && typeof obj === 'object' ? obj[s.key] : null;
    out[s.key] = {
      on: x?.on !== false,
      weight: REF_WEIGHTS.includes(x?.weight) ? x.weight : 'mid',
    };
  }
  return out;
}

/* 这一项带几条：关掉是 0；topics / assist 这类精简场景再减一档 */
export function refCount(refs, key, { lite = false } = {}) {
  const s = REF_SOURCES.find((x) => x.key === key);
  const r = refs?.[key];
  if (!s?.counts || !r?.on) return r?.on ? 1 : 0;
  const i = REF_WEIGHTS.indexOf(r.weight);
  return s.counts[Math.max(0, lite ? i - 1 : i)];
}

/* 提示词里跟在这一块后面的一句话：适中不说，少量和重点各说一句 */
export function weightNote(refs, key) {
  const w = refs?.[key]?.weight;
  if (w === 'high') return '（作者把这一项设为「重点参考」：能用上的尽量用上，和别的参考冲突时以这一项为准。）';
  if (w === 'low') return '（作者把这一项设为「少量参考」：只在非常贴切时才用，用不上就不用。）';
  return '';
}

/* 给块加上权重说明；块是空的就还是空的 */
export const weigh = (block, refs, key) => {
  if (!block) return block;
  const note = weightNote(refs, key);
  return note ? `${block}\n${note}` : block;
};
