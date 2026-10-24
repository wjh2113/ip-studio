/* 模型列表的展示：按厂商分组、名字拆成「主名 + 版本」、标出测试版。只管怎么显示，不改 id（提交给网关的永远是原 id）。
 * 厂商按 id 前缀认，认不出的归「其他」。不用任何品牌图标，只用首字母圆点区分。 */

const VENDORS = [
  [/^claude/, 'Claude'],
  [/^(gpt|chatgpt|o\d)/, 'OpenAI'],
  [/^gemini|^gemma/, 'Google'],
  [/^deepseek/, 'DeepSeek'],
  [/^(qwen|qwq|tongyi)/, '通义千问'],
  [/^(kimi|moonshot)/, 'Kimi'],
  [/^(glm|chatglm|zhipu|cogview)/, '智谱'],
  [/^(doubao|seed)/, '豆包'],
  [/^ernie/, '文心'],
  [/^hunyuan/, '混元'],
  [/^(minimax|abab)/, 'MiniMax'],
  [/^step/, '阶跃星辰'],
  [/^yi-/, '零一万物'],
  [/^(llama|meta-llama)/, 'Llama'],
  [/^(mistral|mixtral|codestral)/, 'Mistral'],
  [/^demo-/, '演示'],
];

export function vendorOf(m) {
  const id = String(m?.id || '').toLowerCase();
  return VENDORS.find(([re]) => re.test(id))?.[1] || '其他';
}

const PREVIEW_RE = /\s*[（(]?\b(preview|beta|exp|experimental)\b[）)]?|\s*[（(]?(测试版?|预览版?|内测)[）)]?/gi;

/* 「Claude Opus 5.5 Preview」→ { main: 'Opus', ver: '5.5', preview: true }（在 Claude 组里）
   「DeepSeek V4 Pro」→ { main: 'DeepSeek', ver: 'V4 Pro' }：去掉厂商名后开头就是版本号的，厂商名留着当主名 */
export function splitName(m, vendor = vendorOf(m)) {
  let name = String(m?.name || m?.id || '').trim();
  const preview = PREVIEW_RE.test(name);
  PREVIEW_RE.lastIndex = 0;
  name = name.replace(PREVIEW_RE, '').replace(/\s*[·•\-—]\s*$/, '').trim();
  const lowVendor = vendor.toLowerCase();
  if (name.toLowerCase().startsWith(`${lowVendor} `)) {
    const rest = name.slice(vendor.length).trim().replace(/^[·•\-—:：/]\s*/, '');
    if (rest && !/\d/.test(rest.split(/\s+/)[0])) name = rest;
  }
  const tokens = name.split(/\s+/);
  const cut = tokens.findIndex((t) => /\d/.test(t));
  if (cut <= 0) return { main: name, ver: '', preview };
  return { main: tokens.slice(0, cut).join(' '), ver: tokens.slice(cut).join(' '), preview };
}

/* 按列表里第一次出现的顺序分组 */
export function groupModels(models) {
  const groups = [];
  const at = new Map();
  for (const m of models || []) {
    const vendor = vendorOf(m);
    if (!at.has(vendor)) { at.set(vendor, groups.length); groups.push({ vendor, items: [] }); }
    groups[at.get(vendor)].items.push({ ...m, ...splitName(m, vendor) });
  }
  return groups;
}

/* 首字母圆点的颜色：按厂商名散列，同一厂商颜色固定 */
const DOT = ['#d97757', '#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ef4444', '#0ea5e9', '#14b8a6', '#6366f1', '#ec4899'];
export function vendorColor(vendor) {
  let h = 0;
  for (const ch of String(vendor)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return DOT[h % DOT.length];
}
