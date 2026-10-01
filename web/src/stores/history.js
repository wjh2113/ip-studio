/* 左侧的创作记录：进行中 / 已归档 / 口播三个筛选，归档、恢复、删除、「把已完成的收起来」。
 * 列表按当前账号过滤；「全部创作」时不过滤，并在每条上标出属于哪个号。 */
import { defineStore } from 'pinia';
import { reactive, ref } from 'vue';
import { api } from '../lib/api.js';
import { ask, toast } from '../lib/feedback.js';
import { useStudioStore } from './studio.js';
import { useBriefStore } from './brief.js';
import { useSpeakStore } from './speak.js';
import { useFrameworksStore } from './frameworks.js';

export const DRAFT_STATUS = { topics: '待选方向', writing: '生成中', done: '已完成' };

export const useHistoryStore = defineStore('history', () => {
  const list = ref([]);
  const counts = reactive({ active: 0, archived: 0, activeDone: 0 });
  const archivingDone = ref(false);

  async function load() {
    const s = useStudioStore();
    if (s.historyMode === 'speaks') { useSpeakStore().loadHistory(); return; }
    try {
      const q = new URLSearchParams();
      if (s.personaId !== null) q.set('persona_id', s.personaId);
      if (s.showArchived) q.set('archived', '1');
      const data = await api(`/drafts${q.toString() ? `?${q}` : ''}`);
      list.value = data.drafts;
      Object.assign(counts, data.counts);
      api('/speaks').then(({ speaks }) => { s.speakCount = speaks.length; }).catch(() => {});
    } catch { /* 未登录或网络异常时静默 */ }
  }

  /* 筛选：'active' | 'archived' | 'speaks' */
  function filter(which) {
    const s = useStudioStore();
    if (s.streaming) return;
    s.historyMode = which === 'speaks' ? 'speaks' : 'drafts';
    if (which !== 'speaks') s.showArchived = which === 'archived';
    load();
  }

  async function open(id) {
    const s = useStudioStore();
    if (s.streaming) return;
    const { draft } = await api(`/drafts/${id}`);
    // 点的是别的号下的稿子：侧栏跟着切到那个号
    if (draft.persona_id && draft.persona_id !== s.personaId && s.personas.some((p) => p.id === draft.persona_id)) {
      s.personaId = draft.persona_id;
      load();
    }
    useBriefStore().setDraft(draft);
  }

  async function archive(id, archived) {
    try {
      await api(`/drafts/${id}/archive`, { method: 'POST', body: { archived } });
      const s = useStudioStore();
      if (s.draft?.id === id) s.draft.archived_at = archived ? new Date().toISOString() : null;
      toast(archived ? '已归档' : '已恢复');
      load();
    } catch (err) { toast(err.message); }
  }

  async function remove(id) {
    if (!await ask.confirm({ title: '删除这条创作记录？', ok: '删除', danger: true })) return;
    try {
      await api(`/drafts/${id}`, { method: 'DELETE' });
    } catch (err) { toast(err.message); return; }
    const s = useStudioStore();
    if (s.draft?.id === id && !s.streaming) {
      useBriefStore().reset();
      useFrameworksStore().choose(null);     // 和「＋ 新建」一样，回到不套框架
    }
    load();
  }

  async function archiveDone() {
    const n = counts.activeDone;
    if (!n || archivingDone.value) return;
    if (!await ask.confirm({ title: `把 ${n} 篇已完成的创作收进归档？`, body: '随时可以在「已归档」里恢复。', ok: '归档' })) return;
    archivingDone.value = true;
    try {
      const s = useStudioStore();
      const { archived } = await api('/drafts/archive-done', {
        method: 'POST', body: { persona_id: s.personaId === null ? '' : s.personaId },
      });
      toast(`已归档 ${archived} 篇`);
      await load();
    } catch (err) { toast(err.message); } finally { archivingDone.value = false; }
  }

  return { list, counts, archivingDone, load, filter, open, archive, remove, archiveDone };
});
