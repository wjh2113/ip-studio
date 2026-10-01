/* 登录态 + 服务端元信息（平台、调性、模型通道）。token 存本地，冷启动先用它拉一次 /me */
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api, token } from '../lib/api.js';

export const useSessionStore = defineStore('session', () => {
  const user = ref(null);
  const meta = ref(null);
  const ready = ref(false);

  async function boot() {
    try {
      const [{ user: u }, m] = await Promise.all([api('/me'), api('/meta')]);
      user.value = u;
      meta.value = m;
    } catch {
      user.value = null;
    } finally {
      ready.value = true;
    }
    return user.value;
  }

  async function login(mode, body) {
    const out = await api(`/auth/${mode}`, { method: 'POST', body });
    if (out.token) token.set(out.token);
    user.value = out.user;
    if (!meta.value) meta.value = await api('/meta').catch(() => null);
    return out.user;
  }

  async function logout() {
    try { await api('/auth/logout', { method: 'POST', body: {} }); } catch { /* 网络不通也要能退出 */ }
    token.clear();
    user.value = null;
  }

  const platformLabel = (key) => meta.value?.platforms?.find((p) => p.key === key)?.label || key || '';

  return { user, meta, ready, boot, login, logout, platformLabel };
});
