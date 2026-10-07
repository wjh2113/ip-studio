/* 同步到 Obsidian：同步密钥的生成、列表、作废。密钥明文只在生成那一刻拿得到（justMade），关掉浮层就清掉 */
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '../lib/api.js';
import { ask, toast } from '../lib/feedback.js';

export const useSyncStore = defineStore('sync', () => {
  const show = ref(false);
  const keys = ref([]);
  const loading = ref(false);
  const justMade = ref(null); // { key, item }

  async function load() {
    loading.value = true;
    try { keys.value = (await api('/sync-keys')).keys || []; } catch (err) { toast(err.message); } finally { loading.value = false; }
  }
  function open() {
    show.value = true;
    justMade.value = null;
    load();
  }
  function close() {
    show.value = false;
    justMade.value = null;
  }
  async function create(name) {
    try {
      justMade.value = await api('/sync-keys', { method: 'POST', body: { name } });
      await load();
    } catch (err) { toast(err.message); }
  }
  async function remove(k) {
    if (!await ask.confirm({ title: `作废「${k.name}」？`, body: '用这把密钥的插件会立刻同步不了，要换一把新的。', ok: '作废', danger: true })) return;
    try {
      await api(`/sync-keys/${k.id}`, { method: 'DELETE' });
      if (justMade.value?.item?.id === k.id) justMade.value = null;
      await load();
      toast('已作废');
    } catch (err) { toast(err.message); }
  }
  return { show, keys, loading, justMade, open, close, load, create, remove };
});
