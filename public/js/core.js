/* 前端 · core：全局共享：DOM 引用 el、状态 state、接口封装 api、通用小工具（转义、提示、Markdown 渲染等）。
 * state 就是 Pinia 里的那一份，组件和这些模块改的是同一份数据。 */
import { useStudioStore } from '../../web/src/stores/studio.js';
import { api } from '../../web/src/lib/api.js';
import { toast } from '../../web/src/lib/feedback.js';
import { countChars, esc, markdown } from '../../web/src/lib/text.js';
import { lock } from '../../web/src/lib/busy.js';

// 网络、提示、文本小工具已经搬到 web/src/lib/，这里转一手，旧模块的 import 不用改
export { api, toast, countChars, esc, markdown };

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
  steps: $('steps'), briefCard: $('briefCard'), inheritNote: $('inheritNote'),
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
  poolBox: $('poolBox'), poolNote: $('poolNote'), poolToggle: $('poolToggle'), poolList: $('poolList'),
  headStick: document.querySelector('.head-stick'),
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
  manageSectionsBtn: $('manageSectionsBtn'),
  sectionInputs: $('sectionInputs'),
  inheritRow: $('inheritRow'), inheritFacts: $('inheritFacts'),
  editParamsBtn: $('editParamsBtn'), paramGrid: $('paramGrid'),
  paramReset: $('paramReset'), resetParamsBtn: $('resetParamsBtn'),
  styleSection: $('styleSection'), sampleList: $('sampleList'), digestBox: $('digestBox'),
  rebuildDigestBtn: $('rebuildDigestBtn'), styleHint: $('styleHint'),
};

export const state = useStudioStore().$state;

export const currentPersona = () => useStudioStore().currentPersona;

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

/* 同一时刻只允许一个提交在飞行中，防止重复点击生成重复记录 */
/* 和 Vue 那边（web/src/lib/busy.js）共用一把锁 */
export async function busy(btn, fn) {
  if (lock.value) return;
  lock.value = true;
  const label = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> 处理中';
  try { await fn(); } finally { lock.value = false; btn.disabled = false; btn.innerHTML = label; }
}
