/* 成稿检查和 AI 味扫描：结果作为一张卡片放进右栏「AI 对话」（和改稿在同一串对话里，能接着问、接着改）。
 *   点「检查」：右栏自动展开、切到 AI 对话，先出一张「正在检查…」，结果回来换成检查结果卡片   run
 *   卡片里逐条采纳 / 忽略 / 在正文里看 / 让 AI 改，逻辑在 chat.js（applyIssue 等）
 *   「改完了，再检查一遍」：强制再查，新卡片接在后面   recheck
 *   「扫 AI 味」：同样出一张卡片   scanTone
 * 查的是版本栏正开着的那一版（原文或小红书等平台版本），采纳也改那一版。
 * 检查和扫 AI 味都跟着右栏对话左下角选的模型；检查还会带上技能页打开了「检查时也参考」的技能。
 * 成稿后不自动检查——工具栏手动点；正文、模型、参考技能都和上次相同时不调接口，直接滚到上次那张卡片。 */
import { defineStore } from 'pinia';
import { reactive, ref } from 'vue';
import { api } from '../lib/api.js';
import { toast } from '../lib/feedback.js';
import { useStudioStore } from './studio.js';
import { useEditorStore } from './editor.js';
import { useChatStore } from './chat.js';
import { useSettingsStore } from './settings.js';
import { useSkillsStore } from './skills.js';

export const VERDICT_LABEL = { ok: '没发现问题', minor: '有几处小毛病', bad: '大面积不通顺' };

function hashText(s) {
  // 轻量指纹：够判断「正文有没有改过」；不追求密码学强度
  let h = 2166136261;
  const str = String(s || '');
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${str.length}:${(h >>> 0).toString(16)}`;
}

export const useReviewStore = defineStore('review', () => {
  const running = ref(false);
  const last = reactive({ fp: '', id: 0 });     // 上次检查的正文指纹和那张卡片

  async function run({ force = false } = {}) {
    const s = useStudioStore();
    const ed = useEditorStore();
    const chat = useChatStore();
    const draft = s.draft;
    const version = ed.editVer;
    const text = ed.text;
    if (!draft || !text.trim() || running.value) return;
    chat.open();
    await chat.load();
    // 换了模型、改了参考的技能，也算「变了」，要重新查
    const fp = `${draft.id}\n${version}\n${hashText(text)}\n${useSettingsStore().chatModel}\n${useSkillsStore().reviewStamp}`;
    if (!force && last.fp === fp && last.id && chat.messages.some((m) => m.id === last.id)) {
      chat.focusMessage(last.id);
      toast('正文和设置都没变，还是上次的检查结果');
      return;
    }
    await ed.flushSave();
    const card = chat.pushCard('review');
    running.value = true;
    try {
      const { message } = await api(`/drafts/${draft.id}/review`, {
        method: 'POST', body: { content: text, version, chat: true, ...(force ? { force: true } : {}) },
      });
      if (s.draft?.id !== draft.id || !card) return;
      const m = chat.settleCard(card, message);
      Object.assign(last, { fp, id: m.id });
      if (message.review?.cached) toast('正文没改过，用了上次的检查结果');
    } catch (err) {
      if (card) Object.assign(card, { pending: false, error: err.message, retryCard: 'review' });
    } finally {
      running.value = false;
    }
  }

  const recheck = () => run({ force: true });

  /* AI 味扫描：快档模型 + 本地规则，结果也是一张卡片 */
  const tone = reactive({ running: false });
  async function scanTone() {
    const s = useStudioStore();
    const ed = useEditorStore();
    const chat = useChatStore();
    const draft = s.draft;
    const version = ed.editVer;
    const text = ed.text;
    if (!draft || !text.trim() || tone.running) return;
    chat.open();
    await chat.load();
    const card = chat.pushCard('tone');
    tone.running = true;
    try {
      const { message } = await api(`/drafts/${draft.id}/ai-tone`, {
        method: 'POST', body: { content: text, version: version || undefined, chat: true },
      });
      if (s.draft?.id === draft.id && card) chat.settleCard(card, message);
    } catch (err) {
      if (card) Object.assign(card, { pending: false, error: err.message, retryCard: 'tone' });
    } finally { tone.running = false; }
  }

  function reset() {
    running.value = false;
    tone.running = false;
    Object.assign(last, { fp: '', id: 0 });
  }

  return { running, run, recheck, tone, scanTone, reset };
});
