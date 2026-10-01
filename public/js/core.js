/* 前端 · core：成稿区（第三步）这几个还没迁到 Vue 的模块共用的东西：DOM 引用 el、状态 state，
 * 以及从 web/src/lib 转过来的 api、toast、文本小工具。
 * state 就是 Pinia 里的那一份，组件和这些模块改的是同一份数据。 */
import { useStudioStore } from '../../web/src/stores/studio.js';
import { api } from '../../web/src/lib/api.js';
import { toast } from '../../web/src/lib/feedback.js';
import { countChars, esc, markdown } from '../../web/src/lib/text.js';
import { lock } from '../../web/src/lib/busy.js';
import { useBriefStore } from '../../web/src/stores/brief.js';

// 网络、提示、文本小工具已经搬到 web/src/lib/，这里转一手，旧模块的 import 不用改
export { api, toast, countChars, esc, markdown };

export const $ = (id) => document.getElementById(id);

export const el = {
  content: $('content'), contentTitle: $('contentTitle'),
  counter: $('counter'), copyBtn: $('copyBtn'), downloadBtn: $('downloadBtn'),
  editor: $('editor'), editorBar: $('editorBar'),
  cuesPane: $('cuesPane'), cuesOverall: $('cuesOverall'), cueList: $('cueList'),
  cuesRunBtn: $('cuesRunBtn'), copyCuesBtn: $('copyCuesBtn'), prompterBtn: $('prompterBtn'),
  speakBox: $('speakBox'), speakHint: $('speakHint'), speakList: $('speakList'),
  speakUploadBtn: $('speakUploadBtn'), speakFile: $('speakFile'),
  speakHistory: $('speakHistory'),
  illusBtn: $('illusBtn'), illusBar: $('illusBar'), illusChip: $('illusChip'),
  illusHint: $('illusHint'), illusList: $('illusList'),
  illusPlanBtn: $('illusPlanBtn'), illusRunBtn: $('illusRunBtn'),
  markBtn: $('markBtn'), markHint: $('markHint'), markDock: $('markDock'),
  voiceBtn: $('voiceBtn'), voiceNote: $('voiceNote'),
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
  saveBtn: $('saveBtn'), saveState: $('saveState'), reviewBtn: $('reviewBtn'), reviewBox: $('reviewBox'), reviewVerdict: $('reviewVerdict'),
  reviewSummary: $('reviewSummary'), reviewList: $('reviewList'),
  reviewApplyAll: $('reviewApplyAll'), reviewClose: $('reviewClose'),
  reviewFlags: $('reviewFlags'), reviewRisk: $('reviewRisk'),
  selMenu: $('selMenu'), slashMenu: $('slashMenu'), slashItems: $('slashItems'), slashInput: $('slashInput'),
  assistPop: $('assistPop'), assistTitle: $('assistTitle'), assistBody: $('assistBody'),
  assistClose: $('assistClose'), assistRetry: $('assistRetry'),
  assistInsert: $('assistInsert'), assistReplace: $('assistReplace'),
  };

export const state = useStudioStore().$state;

/* 步骤条在 Vue 里（stores/brief.js）。旧模块还要跳到第三步、标「完成」，转一手 */
export function goStep(n, opts) {
  useBriefStore().goStep(n, opts);
}

export function markSteps(current, done = false) {
  useBriefStore().goStep(current, { done, scroll: false });
}

/* 同一时刻只允许一个提交在飞行中，防止重复点击生成重复记录。和 Vue 那边（web/src/lib/busy.js）共用一把锁 */
export async function busy(btn, fn) {
  if (lock.value) return;
  lock.value = true;
  const label = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> 处理中';
  try { await fn(); } finally { lock.value = false; btn.disabled = false; btn.innerHTML = label; }
}
