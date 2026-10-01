/* 灵感离线队列（地铁场景）：先存本地，有网再交。
 *
 * 每条带一个随机 key，交给 /api/inbox。服务端按 (用户, key) 去重——
 * 请求发出去了但回包丢了，下次重发也不会存出两份。
 * 本地留最近 100 条记录（含已同步的），列表页直接读这里，离线也能看。 */
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api } from '../lib/api.js';
import { rid } from '../lib/text.js';

const KEY = 'cw_inbox';
const KEEP = 100;
const BATCH = 5;            // 带图的一批别太大：服务端单次请求体有上限

export const useInboxStore = defineStore('inbox', () => {
  const items = ref(load());
  const syncing = ref(false);
  const online = ref(true);

  const pending = computed(() => items.value.filter((x) => x.state !== 'synced'));

  function load() {
    try { return uni.getStorageSync(KEY) || []; } catch { return []; }
  }
  function persist() {
    uni.setStorageSync(KEY, items.value.slice(0, KEEP));
  }

  /* x: { kind: 'pool'|'material', input: 'voice'|'text'|'photo'|'share'|'clip', personaId, subject, note, title, body, materialKind, tags, image } */
  function add(x) {
    const item = { ...x, key: rid(20), state: 'pending', error: '', createdAt: new Date().toISOString() };
    items.value.unshift(item);
    persist();
    flush();
    return item;
  }

  function remove(key) {
    items.value = items.value.filter((x) => x.key !== key);
    persist();
  }

  async function flush() {
    if (syncing.value || !online.value) return;
    const todo = items.value.filter((x) => x.state === 'pending' || x.state === 'failed');
    if (!todo.length) return;
    syncing.value = true;
    try {
      for (let i = 0; i < todo.length; i += BATCH) {
        const batch = todo.slice(i, i + BATCH);
        const { results } = await api('/inbox', {
          method: 'POST',
          body: {
            items: batch.map((x) => ({
              key: x.key, kind: x.kind, personaId: x.personaId ?? null,
              subject: x.subject, note: x.note, title: x.title, body: x.body,
              materialKind: x.materialKind, tags: x.tags, source: x.source || '灵感', image: x.image || undefined,
            })),
          },
        });
        for (const r of results || []) {
          const it = items.value.find((x) => x.key === r.key);
          if (!it) continue;
          if (r.ok) { it.state = 'synced'; it.refId = r.id; it.error = ''; it.image = it.image ? 'sent' : ''; }
          else { it.state = 'failed'; it.error = r.error || '保存失败'; }
        }
        persist();
      }
      uni.$emit('inbox-synced');
    } catch (err) {
      // 网络问题：留在待同步，下次联网再交；不标失败，免得用户以为要手动处理
      if (err.status) for (const x of todo) if (x.state === 'pending') { x.state = 'failed'; x.error = err.message; }
      persist();
    } finally {
      syncing.value = false;
    }
  }

  /* App.vue 里调一次：网络恢复时自动交 */
  function watchNetwork() {
    uni.getNetworkType({ success: (r) => { online.value = r.networkType !== 'none'; if (online.value) flush(); } });
    uni.onNetworkStatusChange((r) => {
      online.value = r.isConnected;
      if (r.isConnected) flush();
    });
  }

  return { items, pending, syncing, online, add, remove, flush, watchNetwork };
});
