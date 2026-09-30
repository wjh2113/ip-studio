/* 前端 · core：全局共享：DOM 引用 el、状态 state、接口封装 api、通用小工具（转义、提示、Markdown 渲染等）。
 * state 就是 Pinia 里的那一份，组件和这些模块改的是同一份数据。 */
import { useStudioStore } from '../../web/src/stores/studio.js';

/* 前端逻辑：登录 → 简报 → 三个方向 → 流式成稿 → 历史 */

export const $ = (id) => document.getElementById(id);

export const el = {
  auth: $('authScreen'), app: $('app'), authForm: $('authForm'), authTabs: $('authTabs'),
  authError: $('authError'), authSubmit: $('authSubmit'), userName: $('userName'),
  logout: $('logoutBtn'), history: $('history'), newBtn: $('newBtn'),
  briefForm: $('briefForm'), briefHint: $('briefHint'), topicsBtn: $('topicsBtn'),
  platformSel: $('platformSel'), toneSel: $('toneSel'),
  topicsCard: $('topicsCard'), topics: $('topics'), retopicsBtn: $('retopicsBtn'),
  contentCard: $('contentCard'), content: $('content'), contentTitle: $('contentTitle'),
  counter: $('counter'), copyBtn: $('copyBtn'), downloadBtn: $('downloadBtn'),
  steps: $('steps'), toast: $('toast'), briefCard: $('briefCard'), inheritNote: $('inheritNote'),
  personaList: $('personaList'), personaMoreBtn: $('personaMoreBtn'), personaSummary: $('personaSummary'),
  newPersonaBtn: $('newPersonaBtn'),
  personaModal: $('personaModal'), personaForm: $('personaForm'), personaError: $('personaError'),
  personaModalTitle: $('personaModalTitle'), personaDeleteBtn: $('personaDeleteBtn'),
  accountNav: $('accountNav'), personaSaveHint: $('personaSaveHint'),
  personaCancelBtn: $('personaCancelBtn'), personaCloseBtn: $('personaCloseBtn'),
  personaSaveBtn: $('personaSaveBtn'),
  personaPlatform: $('personaPlatform'), personaTone: $('personaTone'),
  onboardCard: $('onboardCard'), onboardBtn: $('onboardBtn'), skipOnboardBtn: $('skipOnboardBtn'),
  editor: $('editor'), editorBar: $('editorBar'),
  cuesPane: $('cuesPane'), cuesOverall: $('cuesOverall'), cueList: $('cueList'),
  cuesRunBtn: $('cuesRunBtn'), copyCuesBtn: $('copyCuesBtn'), prompterBtn: $('prompterBtn'),
  speakBox: $('speakBox'), speakHint: $('speakHint'), speakList: $('speakList'),
  speakUploadBtn: $('speakUploadBtn'), speakFile: $('speakFile'),
  speakHistory: $('speakHistory'),
  matKind: $('matKind'), matTitle: $('matTitle'), matBody: $('matBody'), matTags: $('matTags'),
  matSaveBtn: $('matSaveBtn'), matList: $('matList'), matHint: $('matHint'), matError: $('matError'),
  illusBtn: $('illusBtn'), illusBar: $('illusBar'), illusChip: $('illusChip'),
  illusHint: $('illusHint'), illusList: $('illusList'),
  illusPlanBtn: $('illusPlanBtn'), illusRunBtn: $('illusRunBtn'),
  markBtn: $('markBtn'), markHint: $('markHint'), markDock: $('markDock'),
  voiceBtn: $('voiceBtn'), voiceNote: $('voiceNote'),
  briefCard: $('briefCard'), main: $('main'),
  creditChip: $('creditChip'), planModal: $('planModal'), planClose: $('planClose'),
  planPeriod: $('planPeriod'), planNow: $('planNow'), planBreakdown: $('planBreakdown'),
  planCards: $('planCards'), planNote: $('planNote'),
  payBox: $('payBox'), payTitle: $('payTitle'), payCancel: $('payCancel'), payQr: $('payQr'),
  payChannels: $('payChannels'), payHint: $('payHint'),
  poolBox: $('poolBox'), poolNote: $('poolNote'), poolToggle: $('poolToggle'), poolList: $('poolList'),
  metricsModal: $('metricsModal'), metricsClose: $('metricsClose'), metricsDate: $('metricsDate'),
  metricsFields: $('metricsFields'), metricsNote: $('metricsNote'), metricsSave: $('metricsSave'),
  insightsModal: $('insightsModal'), insightsClose: $('insightsClose'),
  insightsBody: $('insightsBody'), insightsNote: $('insightsNote'), insightsLink: $('insightsLink'), headStick: document.querySelector('.head-stick'),
  editBtn: $('editBtn'), backReadBtn: $('backReadBtn'), modeNow: $('modeNow'), toolHint: $('toolHint'),
  revBtn: $('revBtn'), revPane: $('revPane'), revClose: $('revClose'), revList: $('revList'),
  revLeft: $('revLeft'), revRight: $('revRight'), revLeftLabel: $('revLeftLabel'),
  confirmBtn: $('confirmBtn'), confirmMenu: $('confirmMenu'),
  exportBtn: $('exportBtn'), exportMenu: $('exportMenu'), copyHint: $('copyHint'),
  multiBtn: $('multiBtn'), multiBar: $('multiBar'), multiPick: $('multiPick'),
  multiHint: $('multiHint'), multiRunBtn: $('multiRunBtn'), verTabs: $('verTabs'),
  prompter: $('prompter'), pStage: $('pStage'), pScroll: $('pScroll'), pBody: $('pBody'),
  pPlay: $('pPlay'), pSpeedVal: $('pSpeedVal'), pSizeVal: $('pSizeVal'), pProgress: $('pProgress'),
  pCues: $('pCues'), pMirror: $('pMirror'), pRestart: $('pRestart'), pRec: $('pRec'), pClose: $('pClose'),
  saveBtn: $('saveBtn'), saveState: $('saveState'), learnBtn: $('learnBtn'),
  reviewBtn: $('reviewBtn'), reviewBox: $('reviewBox'), reviewVerdict: $('reviewVerdict'),
  reviewSummary: $('reviewSummary'), reviewList: $('reviewList'),
  reviewApplyAll: $('reviewApplyAll'), reviewClose: $('reviewClose'),
  reviewFlags: $('reviewFlags'), reviewRisk: $('reviewRisk'),
  selMenu: $('selMenu'), slashMenu: $('slashMenu'), slashItems: $('slashItems'), slashInput: $('slashInput'),
  assistPop: $('assistPop'), assistTitle: $('assistTitle'), assistBody: $('assistBody'),
  assistClose: $('assistClose'), assistRetry: $('assistRetry'),
  assistInsert: $('assistInsert'), assistReplace: $('assistReplace'),
  ideas: $('ideas'), ideasList: $('ideasList'), ideasRefresh: $('ideasRefresh'), ideasNote: $('ideasNote'),
  hotRef: $('hotRef'),
  historyFilter: $('historyFilter'), archiveDoneBtn: $('archiveDoneBtn'),
  sectionPick: $('sectionPick'), sectionChips: $('sectionChips'),
  sectionModal: $('sectionModal'), sectionModalClose: $('sectionModalClose'),
  sectionModalSub: $('sectionModalSub'), manageSectionsBtn: $('manageSectionsBtn'),
  sectionList: $('sectionList'), sectionPreset: $('sectionPreset'),
  sectionAddBtn: $('sectionAddBtn'), sectionForm: $('sectionForm'), sectionName: $('sectionName'),
  sectionPurpose: $('sectionPurpose'), sectionGuide: $('sectionGuide'), sectionError: $('sectionError'),
  fieldRows: $('fieldRows'), fieldAddBtn: $('fieldAddBtn'), sectionInputs: $('sectionInputs'),
  sectionSaveBtn: $('sectionSaveBtn'), sectionCancelBtn: $('sectionCancelBtn'),
  inheritRow: $('inheritRow'), inheritFacts: $('inheritFacts'),
  editParamsBtn: $('editParamsBtn'), paramGrid: $('paramGrid'),
  paramReset: $('paramReset'), resetParamsBtn: $('resetParamsBtn'),
  viewNav: $('viewNav'), writeView: $('writeView'), hotView: $('hotView'),
  hotRun: $('hotRun'), hotMeta: $('hotMeta'), hotSources: $('hotSources'),
  hotMatches: $('hotMatches'), hotIntro: $('hotIntro'),
  boardList: $('boardList'), boardFilter: $('boardFilter'), boardRefresh: $('boardRefresh'),
  manualInput: $('manualInput'), manualRun: $('manualRun'),
  styleSection: $('styleSection'), sampleList: $('sampleList'), digestBox: $('digestBox'),
  rebuildDigestBtn: $('rebuildDigestBtn'), styleHint: $('styleHint'),
};

export const state = useStudioStore().$state;

export const currentPersona = () => state.personas.find((p) => p.id === state.personaId) || null;

export const PERSONA_FIELDS = [
  'name', 'platform', 'tone', 'content_focus', 'audience', 'problem', 'notes',
  'creator_age', 'creator_gender', 'creator_industry', 'creator_role', 'creator_traits',
];

/* 个人人设的一行摘要：32 岁 · 女 · 互联网 / 产品经理 */
export function creatorLine(p) {
  const age = String(p.creator_age || '').trim();
  const job = [p.creator_industry, p.creator_role].filter(Boolean).join(' / ');
  return [age ? (/^\d+$/.test(age) ? `${age} 岁` : age) : '', p.creator_gender, job]
    .filter(Boolean).join(' · ');
}

/* ---------------- 网络 ---------------- */
export async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // 402 = 额度/套餐拦下来了。这一刻正是最愿意付费的时候，
    // 所以不只是抛错，还广播出去把用量面板顶到人面前
    if (res.status === 402) {
      window.dispatchEvent(new CustomEvent('cw-quota', { detail: { message: data.error, quota: data.quota } }));
    }
    throw new Error(data.error || `请求失败（${res.status}）`);
  }
  // 花过钱的请求顺手刷新余额，不用等下次开面板
  // 用事件通知余额面板刷新，而不是直接调 loadPlan：网络层不依赖具体功能模块
  if (options.method && options.method !== 'GET') window.dispatchEvent(new Event('cw-spent'));
  return data;
}

export function syncLength() {
  const opt = el.platformSel.selectedOptions[0];
  if (opt) el.briefForm.length.value = opt.dataset.length;
}

/* ---------------- 小工具 ---------------- */
/* 三步各占一屏，一次只显示一张卡。
   以前三张堆着往下滚，到第三步时前两步还杵在上面——既长又分不清现在在哪一步。 */
export function goStep(n, { done = false } = {}) {
  state.step = n;
  el.main.dataset.step = n;      // 宽度按步骤走，见 .main[data-step]
  el.briefCard.classList.toggle('hidden', n !== 1);
  el.topicsCard.classList.toggle('hidden', n !== 2);
  el.contentCard.classList.toggle('hidden', n !== 3);
  markSteps(n, done);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* 哪几步现在能点。往回走随便走，往前只能走到已经有内容的那一步 */
function reachable(n) {
  if (n === 1) return true;
  if (n === 2) return Boolean(state.draft?.topics?.length);
  return Boolean(state.draft?.content);
}

export function markSteps(current, done = false) {
  [...el.steps.children].forEach((li) => {
    const n = Number(li.dataset.step);
    li.classList.toggle('active', n === current);
    li.classList.toggle('done', n < current || (done && n === current));
    li.classList.toggle('reachable', n !== current && reachable(n));
  });
}

el.steps.addEventListener('click', (e) => {
  const li = e.target.closest('.step');
  const n = Number(li?.dataset.step);
  if (!n || n === state.step || state.streaming || !reachable(n)) return;
  goStep(n, { done: n === 3 });
});

/* 卡片里的「← 改题材」「← 换方向」 */
document.addEventListener('click', (e) => {
  const b = e.target.closest('.step-back[data-goto]');
  if (b && !state.streaming) goStep(Number(b.dataset.goto));
});

export function hint(text, isError = false) {
  el.briefHint.textContent = text;
  el.briefHint.classList.toggle('error', isError);
}

let toastTimer;

export function toast(message) {
  el.toast.textContent = message;
  el.toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.add('hidden'), 2600);
}

/* 同一时刻只允许一个提交在飞行中，防止重复点击生成重复记录 */
export async function busy(btn, fn) {
  if (state.busy) return;
  state.busy = true;
  const label = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> 处理中';
  try { await fn(); } finally { state.busy = false; btn.disabled = false; btn.innerHTML = label; }
}

export const countChars = (s) => s.replace(/\s/g, '').length;

export const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/* 极简 Markdown 渲染：先转义再套标签，够用且安全 */
export function markdown(src) {
  const lines = esc(src).split('\n');
  const out = [];
  let list = null;

  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const openList = (tag) => { if (list !== tag) { closeList(); out.push(`<${tag}>`); list = tag; } };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { closeList(); continue; }

    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { closeList(); const n = h[1].length; out.push(`<h${n}>${inline(h[2])}</h${n}>`); continue; }

    if (/^(---|\*\*\*|___)\s*$/.test(line)) { closeList(); out.push('<hr />'); continue; }

    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    if (ul) { openList('ul'); out.push(`<li>${inline(ul[1])}</li>`); continue; }

    const ol = line.match(/^\s*\d+[.、)]\s+(.*)$/);
    if (ol) { openList('ol'); out.push(`<li>${inline(ol[1])}</li>`); continue; }

    const bq = line.match(/^&gt;\s?(.*)$/);
    if (bq) { closeList(); out.push(`<blockquote>${inline(bq[1])}</blockquote>`); continue; }

    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join('');
}

const inline = (s) => s
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
