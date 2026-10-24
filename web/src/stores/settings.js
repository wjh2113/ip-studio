/* 个人设置：模型能力、对话记录保存天数、AI 对话用的模型。所有账号共用，存在服务端。
 * 对话模型：列表由服务端去网关取（租户 Key 不出服务端），显示 name、存 id；空 = 自动。
 * 已存的模型从列表里没了就标「已停用」，要用户自己换，不替他换。 */
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '../lib/api.js';
import { toast } from '../lib/feedback.js';
import { useChatStore } from './chat.js';

export const LLM_PREF_OPTIONS = [
  { key: 'auto', label: '自动（推荐）', hint: '按功能分档：成稿、对话等用高质量；选题、检查等用快速档。这是系统默认。' },
  { key: 'quality', label: '偏质量', hint: '尽量用高质量模型，写得更稳，可能更慢、更费点。' },
  { key: 'fast', label: '偏快速', hint: '尽量用快速模型，更快更省，复杂写作可能差一点。' },
];

export const KEEP_OPTIONS = [
  { days: 30, label: '30 天' },
  { days: 100, label: '100 天（默认）' },
  { days: 365, label: '1 年' },
  { days: 0, label: '一直保留' },
];

export const useSettingsStore = defineStore('settings', () => {
  const open = ref(false);
  const loading = ref(false);
  const saving = ref(false);
  const llmPref = ref('auto');
  const chatKeepDays = ref(100);
  const error = ref('');
  const chatModel = ref('');          // '' = 自动
  const models = ref([]);             // [{ id, name, available }]
  const modelsGone = ref(false);      // 存着的模型已经不在列表里
  const canPick = ref(false);         // 当前通道能不能指定模型（网关 / 演示能，其他只有自动）
  const modelsError = ref('');
  let modelsAt = 0;

  /* 打开对话栏、打开设置页时取一次；1 分钟内不重复取，fresh 强制刷新 */
  async function loadModels(fresh = false) {
    if (!fresh && modelsAt && Date.now() - modelsAt < 60_000) return;
    modelsError.value = '';
    try {
      const data = await api(`/llm/models${fresh ? '?fresh=1' : ''}`);
      models.value = data.models || [];
      chatModel.value = data.chatModel || '';
      modelsGone.value = Boolean(data.gone);
      canPick.value = Boolean(data.canPick);
      modelsAt = Date.now();
    } catch (err) {
      modelsError.value = err.message;
    }
  }

  async function setChatModel(id) {
    const prev = chatModel.value;
    chatModel.value = id;        // 先换上，失败再退回
    try {
      const data = await api('/settings', { method: 'PUT', body: { chatModel: id } });
      chatModel.value = data.chatModel;
      modelsGone.value = false;
      const m = models.value.find((x) => x.id === data.chatModel);
      toast(data.chatModel ? `AI 对话改用：${m?.name || data.chatModel}` : 'AI 对话改回自动选模型');
    } catch (err) {
      chatModel.value = prev;
      toast(err.message);
    }
  }

  function show() { open.value = true; load(); }
  function close() { open.value = false; }

  async function load() {
    loading.value = true;
    error.value = '';
    try {
      const data = await api('/settings');
      llmPref.value = data.llmPref || 'auto';
      chatKeepDays.value = Number(data.chatKeepDays);
      chatModel.value = data.chatModel || '';
      void loadModels(true);
      useChatStore().keepDays = chatKeepDays.value;
    } catch (err) {
      error.value = err.message;
    } finally {
      loading.value = false;
    }
  }

  async function save(patch) {
    saving.value = true;
    error.value = '';
    try {
      const data = await api('/settings', { method: 'PUT', body: patch });
      llmPref.value = data.llmPref;
      chatKeepDays.value = data.chatKeepDays;
      useChatStore().keepDays = data.chatKeepDays;
      if (patch.llmPref != null) {
        const opt = LLM_PREF_OPTIONS.find((x) => x.key === data.llmPref);
        toast(`模型能力：${opt?.label || data.llmPref}`);
      }
      if (patch.chatKeepDays != null) {
        toast(data.chatKeepDays
          ? `对话记录保存 ${KEEP_OPTIONS.find((c) => c.days === data.chatKeepDays)?.label || `${data.chatKeepDays} 天`}，过期自动删`
          : '对话记录一直保留');
      }
    } catch (err) {
      error.value = err.message;
      toast(err.message);
    } finally {
      saving.value = false;
    }
  }

  return {
    open, loading, saving, llmPref, chatKeepDays, error, show, close, load, save,
    chatModel, models, modelsGone, canPick, modelsError, loadModels, setChatModel,
  };
});
