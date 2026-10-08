/* 成稿参考：这个账号生成选题和成稿时带哪些资料、各带多少、多看重。每个账号一份，在账号设定「成稿参考」里改。
 * 改一项就存（不用点保存），下一次生成起生效，已经写好的稿子不变。不挂账号（全部创作）的稿子按默认：全开、适中。 */
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '../lib/api.js';
import { toast } from '../lib/feedback.js';
import { useAccountStore } from './account.js';
import { useStudioStore } from './studio.js';

export const useRefsStore = defineStore('refs', () => {
  const personaId = ref(null);
  const refs = ref(null);
  const sources = ref([]);
  const weights = ref([]);
  const error = ref('');

  async function load(id) {
    personaId.value = id;
    refs.value = null;
    error.value = '';
    try {
      const r = await api(`/personas/${id}/refs`);
      if (personaId.value !== id) return;
      refs.value = r.refs;
      sources.value = r.sources || [];
      weights.value = r.weights || [];
    } catch (err) { error.value = err.message; }
  }
  async function set(key, patch) {
    const id = personaId.value;
    if (!refs.value || !id) return;
    const prev = refs.value;
    refs.value = { ...prev, [key]: { ...prev[key], ...patch } };      // 先改界面，失败再退回
    try {
      const r = await api(`/personas/${id}/refs`, { method: 'PUT', body: { refs: { [key]: refs.value[key] } } });
      if (personaId.value === id) refs.value = r.refs;
    } catch (err) {
      refs.value = prev;
      toast(err.message);
    }
  }
  async function reset() {
    const id = personaId.value;
    const all = Object.fromEntries(sources.value.map((x) => [x.key, { on: true, weight: 'mid' }]));
    try { refs.value = (await api(`/personas/${id}/refs`, { method: 'PUT', body: { refs: all } })).refs; toast('已恢复默认'); } catch (err) { toast(err.message); }
  }
  /* 这一档会带几条，给界面显示 */
  const countText = (src, weight) => {
    if (!src.counts) return '';
    const i = ['low', 'mid', 'high'].indexOf(weight);
    return `最多 ${src.counts[Math.max(0, i)]} ${src.unit}`;
  };

  /* 从成稿页、简报跳过来：打开那个账号的设定，停在「成稿参考」 */
  function openFor(id) {
    const st = useStudioStore();
    const persona = id ? st.personas.find((p) => p.id === id) : null;
    if (!persona) { toast('不挂账号的稿子按默认参考（全开、适中）。选一个账号，再到它的设定里调'); return; }
    const a = useAccountStore();
    a.open(persona);
    a.page.tab = 'refs';
  }

  return { personaId, refs, sources, weights, error, load, set, reset, countText, openFor };
});
