/* 管理后台的数据：独立入口、独立账号，和业务前台不共享会话。
 * 后台用的 api 不发「花过点数」的通知（那是前台余额用的），所以这里用 fetch 自己包一层。 */
import { defineStore } from 'pinia';
import { ref } from 'vue';

export async function adminApi(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `请求失败（${res.status}）`);
  return data;
}

export const fmt = (n) => Number(n || 0).toLocaleString('zh-CN');
export const fmtTokens = (n) => (n >= 10000 ? `${(n / 10000).toFixed(1)} 万` : fmt(n));
export const fmtTime = (iso) => (iso
  ? new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  : '—');

/* 左侧分区：一次只显示一个，加分区 = 这里加一条 + AdminApp 里放一个对应组件 */
export const ADMIN_SECTIONS = [
  { key: 'overview', label: '概览', hint: '调用量与趋势' },
  { key: 'quality', label: '内容质量', hint: '改稿与采纳' },
  { key: 'cost', label: '成本', hint: '按模型估算' },
  { key: 'ab', label: '提示词 A/B', hint: '变体与分流' },
  { key: 'eval', label: 'Eval', hint: '用例与盲测' },
  { key: 'pay', label: '支付接入', hint: '商户凭据与自检' },
  { key: 'usage', label: '功能用量', hint: '各功能与报错' },
  { key: 'prompts', label: '提示词', hint: '实际发出去的' },
  { key: 'users', label: '用户', hint: '注册与创作数' },
  { key: 'admins', label: '管理员', hint: '账号管理' },
];

const SEC_KEY = 'adminSection';

export const useAdminStore = defineStore('admin', () => {
  const admin = ref(null);
  const gate = ref(null);           // /admin/session：{ needsSetup, setupLocked, gate }
  const overview = ref(null);       // /admin/overview
  const loading = ref(false);
  const error = ref('');
  const days = ref('7');
  const tick = ref(0);             // 每点一次「刷新」/换天数 +1：A/B、评测、支付这几块自己拉数据，靠它跟着一起刷
  let saved = null;
  try { saved = localStorage.getItem(SEC_KEY); } catch { /* 隐私模式 */ }
  const section = ref(ADMIN_SECTIONS.some((s) => s.key === saved) ? saved : 'overview');

  async function boot() {
    try {
      const d = await adminApi('/admin/session');
      if (d.admin) { admin.value = d.admin; load(); return; }
      gate.value = d;
    } catch (err) {
      gate.value = { error: err.message };
    }
  }

  async function login(username, password) {
    const setup = gate.value?.needsSetup;
    const { admin: a } = await adminApi(setup ? '/admin/setup' : '/admin/login', { method: 'POST', body: { username, password } });
    gate.value = null;
    admin.value = a;
    load();
  }

  async function logout() {
    await fetch('/api/admin/logout', { method: 'POST' });
    location.reload();
  }

  async function load() {
    tick.value += 1;
    loading.value = true;
    error.value = '';
    try {
      overview.value = await adminApi(`/admin/overview?days=${days.value}`);
    } catch (err) {
      error.value = err.message;
      if (/登录/.test(err.message)) setTimeout(() => location.reload(), 1200);
    } finally {
      loading.value = false;
    }
  }

  function show(key) {
    section.value = key;
    try { localStorage.setItem(SEC_KEY, key); } catch { /* 隐私模式 */ }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return { admin, gate, overview, loading, error, days, tick, section, boot, login, logout, load, show };
});
