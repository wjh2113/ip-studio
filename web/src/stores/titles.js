/* 标题：定稿后可点顶栏直接改，或用「起标题」出一批候选再挑。
 * 改标题会同步草稿 title 和正文第一行的 Markdown 标题，并留一版历史。 */
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '../lib/api.js';
import { toast } from '../lib/feedback.js';
import { useStudioStore } from './studio.js';
import { useHistoryStore } from './history.js';
import { useEditorStore } from './editor.js';
import { useVersionsStore } from './versions.js';

export const useTitlesStore = defineStore('titles', () => {
  const show = ref(false);
  const loading = ref(false);
  const error = ref('');
  const titles = ref([]);
  const limit = ref(0);
  const applying = ref(null);
  const saving = ref(false);

  async function load() {
    const s = useStudioStore();
    if (loading.value || !s.draft?.id) return;
    loading.value = true;
    error.value = '';
    try {
      const out = await api(`/drafts/${s.draft.id}/titles`, { method: 'POST', body: {} });
      titles.value = out.titles;
      limit.value = out.limit || 0;
    } catch (err) {
      error.value = err.message;
    } finally {
      loading.value = false;
    }
  }

  async function open() {
    const s = useStudioStore();
    if (!s.draft?.content) { toast('还没有正文'); return; }
    await useEditorStore().flushSave(true);    // 先把编辑中的改动落盘，标题按最新正文起
    titles.value = [];
    show.value = true;
    load();
  }

  /** 直接改标题（顶栏输入或候选列表采用）。看平台版本时不能改原文标题。 */
  async function setTitle(raw, { toastOk = '标题已改' } = {}) {
    const s = useStudioStore();
    if (!s.draft?.id) return false;
    if (useVersionsStore().current) {
      toast('看别的平台版本时不能改原文标题，请先切回原文');
      return false;
    }
    const title = String(raw || '').replace(/[\r\n]+/g, ' ').replace(/^#+\s*/, '').trim().slice(0, 100);
    if (!title) { toast('标题不能为空'); return false; }
    if (title === String(s.draft.title || '').replace(/^#+\s*/, '').trim()) return true;
    if (saving.value) return false;
    saving.value = true;
    try {
      await useEditorStore().flushSave(true);
      const { draft } = await api(`/drafts/${s.draft.id}/title`, { method: 'PUT', body: { title } });
      // 原地换稿，不走 setDraft，免得打断编辑模式
      s.draft = draft;
      useHistoryStore().load();
      if (toastOk) toast(toastOk);
      return true;
    } catch (err) {
      toast(err.message);
      return false;
    } finally {
      saving.value = false;
    }
  }

  async function apply(i) {
    const text = titles.value[i]?.text;
    if (!text) return;
    applying.value = i;
    try {
      if (await setTitle(text, { toastOk: '标题已替换，上一版留在历史里' })) show.value = false;
    } finally {
      applying.value = null;
    }
  }

  return { show, loading, error, titles, limit, applying, saving, load, open, apply, setTitle };
});
