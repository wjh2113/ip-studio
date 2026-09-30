/* 前端 · titles：标题候选。定稿后按不同写法出一批标题，挑一个替换草稿标题和正文第一行。 */
import { api, esc, state, toast } from './core.js';
import { setDraft } from './brief.js';
import { flushSave } from './editor.js';
import { loadHistory } from './compose.js';

const $ = (id) => document.getElementById(id);
const ui = { modal: $('titleModal'), close: $('titleClose'), list: $('titleList'), sub: $('titleSub'), again: $('titleAgain') };
let loading = false;

async function load() {
  if (loading || !state.draft?.id) return;
  loading = true;
  ui.again.disabled = true;
  ui.list.innerHTML = '<div class="idea-skeleton"></div>'.repeat(3);
  try {
    const { titles, limit } = await api(`/drafts/${state.draft.id}/titles`, { method: 'POST', body: {} });
    ui.sub.textContent = limit ? `这个平台标题不超过 ${limit} 字` : '';
    ui.list.innerHTML = titles.map((t, i) => `
      <div class="title-row">
        <div class="title-main">
          <b>${esc(t.text)}</b>
          <div class="title-meta">
            ${t.type ? `<span class="fw-tag">${esc(t.type)}</span>` : ''}
            <span class="${t.over ? 'form-error' : 'hint'}">${t.chars} 字${t.over ? '，超过平台上限' : ''}</span>
            ${t.risk?.length ? `<span class="form-error">含「${t.risk.map(esc).join('、')}」，注意广告法</span>` : ''}
          </div>
          ${t.why ? `<p class="hint">${esc(t.why)}</p>` : ''}
        </div>
        <button type="button" class="btn ghost small" data-title="${i}">用这个</button>
      </div>`).join('');
    ui.list.dataset.titles = JSON.stringify(titles.map((t) => t.text));
  } catch (err) {
    ui.list.innerHTML = `<p class="form-error">${esc(err.message)}</p>`;
  } finally {
    loading = false;
    ui.again.disabled = false;
  }
}

export async function openTitles() {
  if (!state.draft?.content) { toast('还没有正文'); return; }
  await flushSave(true);               // 先把编辑中的改动落盘，标题按最新正文起
  ui.modal.classList.remove('hidden');
  load();
}

const close = () => ui.modal.classList.add('hidden');
ui.close.addEventListener('click', close);
ui.modal.addEventListener('click', (e) => { if (e.target === ui.modal) close(); });
ui.again.addEventListener('click', load);

ui.list.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-title]');
  if (!b) return;
  const text = JSON.parse(ui.list.dataset.titles || '[]')[Number(b.dataset.title)];
  if (!text) return;
  b.disabled = true;
  try {
    const { draft } = await api(`/drafts/${state.draft.id}/title`, { method: 'PUT', body: { title: text } });
    setDraft(draft);
    loadHistory();                     // 左侧创作记录里的标题也跟着换
    close();
    toast('标题已替换，上一版留在历史里');
  } catch (err) {
    toast(err.message);
    b.disabled = false;
  }
});
