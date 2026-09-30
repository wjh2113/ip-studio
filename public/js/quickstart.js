/* 前端 · quickstart：快速建号。
 *
 * 新手面对十几个设定项最容易放弃。这里先让他贴一段自我介绍（可以再贴几篇旧文章），
 * 模型把账号设定填好放进表单，他检查、改完再保存——把「填写」变成「检查」。
 * 旧文章不在这一步存：账号保存成功后（brief.js 发 cw-persona-created）再批量存成语气样本，语气档案只蒸馏一次。
 */
import { api, busy, el, state, toast } from './core.js';
import { openPersonaModal } from './brief.js';
import { loadSamples } from './account.js';

const $ = (id) => document.getElementById(id);
const ui = {
  btn: $('quickBtn'), link: $('quickLink'), modal: $('quickModal'), close: $('quickClose'),
  intro: $('quickIntro'), posts: $('quickPosts'), run: $('quickRun'), error: $('quickError'),
};

let pending = [];            // 等账号保存后要存成语气样本的旧文章

function open() {
  ui.error.textContent = '';
  ui.modal.classList.remove('hidden');
  setTimeout(() => ui.intro.focus(), 30);
}

const close = () => ui.modal.classList.add('hidden');

ui.btn?.addEventListener('click', open);
ui.link?.addEventListener('click', (e) => { e.preventDefault(); open(); });
ui.close?.addEventListener('click', close);
ui.modal?.addEventListener('click', (e) => { if (e.target === ui.modal) close(); });

ui.run?.addEventListener('click', () => busy(ui.run, async () => {
  ui.error.textContent = '';
  try {
    const { fields, samples, empty } = await api('/personas/quickstart', {
      method: 'POST', body: { intro: ui.intro.value, posts: ui.posts.value },
    });
    close();
    // 设定弹窗已经开着（从「新建账号」里点进来的）就直接填，不然先打开一个新的
    if (el.personaModal.classList.contains('hidden') || state.editingId) openPersonaModal(null);
    const f = el.personaForm;
    for (const [k, v] of Object.entries(fields)) {
      if (!v || !f[k]) continue;
      f[k].value = v;
      f[k].classList.add('quick-filled');
    }
    pending = samples || [];
    const blank = (empty || []).length;
    el.personaSaveHint.textContent = `已按你的介绍填好${blank ? `，${blank} 项看不出来留空了` : ''}。检查一下再保存`
      + (pending.length ? `；保存后 ${pending.length} 篇旧文章会存成语气样本` : '');
    toast('填好了，改完点保存');
  } catch (err) {
    ui.error.textContent = err.message;
  }
}));

/* 没保存就关掉设定：带来的旧文章也作废，别挂到下一个新建的账号上 */
[el.personaCancelBtn, el.personaCloseBtn].forEach((b) => b?.addEventListener('click', () => { pending = []; }));

/* 改过的字段去掉高亮：高亮只是告诉他「这是帮你填的，看一眼」 */
el.personaForm.addEventListener('input', (e) => e.target.classList?.remove('quick-filled'));

window.addEventListener('cw-persona-created', async (e) => {
  el.personaForm.querySelectorAll('.quick-filled').forEach((n) => n.classList.remove('quick-filled'));
  if (!pending.length) return;
  const samples = pending;
  pending = [];
  el.personaSaveHint.textContent = `正在把 ${samples.length} 篇旧文章存成语气样本，顺便总结你的语气…`;
  try {
    const out = await api(`/personas/${e.detail.id}/samples/batch`, { method: 'POST', body: { samples } });
    el.personaSaveHint.textContent = `已创建，存了 ${out.added} 篇语气样本${out.skipped ? `（${out.skipped} 篇太短没存）` : ''}，语气档案也好了`;
    loadSamples(e.detail.id);
  } catch (err) {
    el.personaSaveHint.textContent = `账号已创建，但语气样本没存上：${err.message}。可以在「语气样本」里再加`;
  }
});
