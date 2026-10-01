/* 登录态与启动：拉 /me 和 /meta，决定先显示登录页还是直接进应用；进应用后把各块数据拉一遍。 */
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '../lib/api.js';
import { emit } from '../lib/bus.js';
import { toast } from '../lib/feedback.js';
import { useStudioStore } from './studio.js';
import { useAccountStore } from './account.js';
import { useBriefStore } from './brief.js';
import { useHistoryStore } from './history.js';
import { usePlanStore } from './plan.js';

export const useSessionStore = defineStore('session', () => {
  const showAuth = ref(false);     // 启动完、确认没登录，才露出登录页（避免已登录的人先闪一下登录页）

  async function boot() {
    const s = useStudioStore();
    try {
      const [{ user }, meta] = await Promise.all([api('/me'), api('/meta')]);
      s.meta = meta;
      s.llm = meta.llm;
      if (user) await enter(user);
      else showAuth.value = true;
    } catch (err) {
      toast(err.message);
    }
  }

  async function login(mode, body) {
    const { user } = await api(`/auth/${mode}`, { method: 'POST', body });
    showAuth.value = false;
    await enter(user);
  }

  async function enter(user) {
    const s = useStudioStore();
    s.user = user;
    const account = useAccountStore();
    const brief = useBriefStore();
    await account.loadPersonas();
    brief.reset();
    useHistoryStore().load();
    usePlanStore().load();
    // 进了应用再通知：任务中心这类要登录才能拉数据的模块听这个，不在未登录时白打接口
    emit('enter');
  }

  /* 不走 api()：它会在请求成功后发「花过点数」的通知，余额面板跟着去拉 /plan，这时已经退出了只会拿到 401 */
  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    location.reload();
  }

  return { showAuth, boot, login, enter, logout };
});
