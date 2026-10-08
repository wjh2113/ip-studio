/* 邀请码：前台里的管理员（APP_ADMINS）生成、复制、作废。凭码注册一人一码 */
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '../lib/api.js';
import { ask, toast } from '../lib/feedback.js';

export const useInvitesStore = defineStore('invites', () => {
  const show = ref(false);
  const list = ref([]);
  const mode = ref('');          // invite | open | closed：服务器现在的注册方式
  const loading = ref(false);
  const fresh = ref([]);         // 刚生成的，顶上高亮

  async function load() {
    loading.value = true;
    try {
      const r = await api('/invites');
      list.value = r.invites || [];
      mode.value = r.mode || '';
    } catch (err) { toast(err.message); } finally { loading.value = false; }
  }
  function open() {
    show.value = true;
    fresh.value = [];
    load();
  }
  async function create(note, count = 1) {
    try {
      const r = await api('/invites', { method: 'POST', body: { note, count } });
      fresh.value = (r.invites || []).map((x) => x.id);
      await load();
      return r.invites || [];
    } catch (err) { toast(err.message); return []; }
  }
  async function revoke(x) {
    if (!await ask.confirm({ title: `作废邀请码 ${x.code}？`, body: '作废后这个码不能再注册。已经用它注册的人不受影响。', ok: '作废', danger: true })) return;
    try { await api(`/invites/${x.id}`, { method: 'DELETE' }); await load(); } catch (err) { toast(err.message); }
  }
  /* 发给对方的那段话：带链接，点开直接到注册页、码已填好 */
  const linkOf = (code) => `${location.origin}/app?signup=1&invite=${encodeURIComponent(code)}`;
  const messageOf = (code) => `邀请你用「自媒体助手」：打开 ${linkOf(code)} 注册（邀请码 ${code}，只能用一次）`;

  return { show, list, mode, loading, fresh, load, open, create, revoke, linkOf, messageOf };
});
