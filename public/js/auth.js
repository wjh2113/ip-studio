/* 前端 · auth：登录 / 注册。从原 app.js 原样拆出。 */
import { api, busy, el, state } from './core.js';
import { loadPersonas, loadSections } from './account.js';
import { applyPersonaDefaults, loadIdeas } from './brief.js';
import { loadHistory } from './compose.js';
import { loadPool } from './library.js';
import { loadPlan } from './plan.js';

/* ---------------- 登录 / 注册 ---------------- */
let authMode = 'login';

el.authTabs.addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  authMode = tab.dataset.mode;
  [...el.authTabs.children].forEach((t) => t.classList.toggle('active', t === tab));
  el.authSubmit.textContent = authMode === 'login' ? '登录' : '注册并进入';
  el.authForm.password.autocomplete = authMode === 'login' ? 'current-password' : 'new-password';
  el.authError.textContent = '';
  const invite = document.getElementById('inviteRow');
  invite?.classList.toggle('hidden', authMode !== 'register' || invite?.dataset.needed !== '1');
});

el.authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  el.authError.textContent = '';
  const fd = new FormData(el.authForm);
  await busy(el.authSubmit, async () => {
    try {
      const { user } = await api(`/auth/${authMode}`, {
        method: 'POST',
        body: {
          username: fd.get('username'),
          password: fd.get('password'),
          ...(authMode === 'register' ? { invite: fd.get('invite') } : {}),
        },
      });
      el.auth.classList.add('hidden');
      el.authForm.reset();
      enterApp(user);
    } catch (err) {
      el.authError.textContent = err.message;
    }
  });
});

el.logout.addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST' });
  location.reload();
});

export async function enterApp(user) {
  state.user = user;
  el.userName.textContent = user.username;
  el.app.classList.remove('hidden');
  await loadPersonas();
  applyPersonaDefaults();
  loadSections(state.personaId);
  loadHistory();
  loadIdeas();
  loadPool();          // 侧栏一进来就该看到攒了多少选题
  loadPlan();
  // 进了应用再通知：任务中心这类要登录才能拉数据的模块听这个，不在未登录时白打接口
  window.dispatchEvent(new Event('cw-enter'));
}
