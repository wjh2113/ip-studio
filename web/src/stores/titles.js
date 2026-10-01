/* 标题候选：定稿后按不同写法出一批标题，挑一个替换草稿标题和正文第一行 */
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '../lib/api.js';
import { toast } from '../lib/feedback.js';
import { useStudioStore } from './studio.js';
import { useBriefStore } from './brief.js';
import { useHistoryStore } from './history.js';
import { useEditorStore } from './editor.js';

export const useTitlesStore = defineStore('titles', () => {
  const show = ref(false);
  const loading = ref(false);
  const error = ref('');
  const titles = ref([]);
  const limit = ref(0);
  const applying = ref(null);

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

  async function apply(i) {
    const s = useStudioStore();
    const text = titles.value[i]?.text;
    if (!text || !s.draft) return;
    applying.value = i;
    try {
      const { draft } = await api(`/drafts/${s.draft.id}/title`, { method: 'PUT', body: { title: text } });
      useBriefStore().setDraft(draft);
      useHistoryStore().load();                // 左侧创作记录里的标题也跟着换
      show.value = false;
      toast('标题已替换，上一版留在历史里');
    } catch (err) {
      toast(err.message);
    } finally {
      applying.value = null;
    }
  }

  return { show, loading, error, titles, limit, applying, load, open, apply };
});
