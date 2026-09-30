/* 前端 · frameworks：写法框架。
 *   - 简报里的「写法框架」一排：不套框架（默认）+ 推荐的三个 + 当前选中的（如果不在推荐里）
 *   - 框架库浮层：内置 + 我的，按平台筛；可以新建、编辑、删除、把内置的复制成自己的再改
 * 选中的框架 key 存在 state.frameworkKey，提交简报时带给后端。 */
import { api, busy, el, esc, state, toast } from './core.js';

const $ = (id) => document.getElementById(id);
const ui = {
  pick: $('fwChips'), libBtn: $('fwLibBtn'), modal: $('fwModal'), close: $('fwClose'),
  tabs: $('fwTabs'), platform: $('fwPlatform'), newBtn: $('fwNewBtn'), list: $('fwList'),
  editor: $('fwEditor'), name: $('fwName'), summary: $('fwSummary'), plats: $('fwPlats'),
  scenes: $('fwScenes'), slots: $('fwSlots'), slotAdd: $('fwSlotAdd'), preview: $('fwPreview'),
  error: $('fwError'), cancel: $('fwCancel'), save: $('fwSave'),
};

const fw = { recs: [], all: null, platforms: [], tab: 'all', editing: null, chosen: null };

const platformLabel = (k) => fw.platforms.find((p) => p.key === k)?.label || k;
const pct = (r) => Math.round(r * 100);

/* 一条横向色条，宽度按篇幅占比，一眼看出结构 */
function slotBar(slots) {
  return `<div class="fw-bar-slots">${slots.map((x, i) => `
    <span class="fw-seg s${i % 6}" style="flex:${Math.max(x.ratio, 0.02)}" title="${esc(x.role)} ${pct(x.ratio)}%">${esc(x.role)}</span>`).join('')}</div>`;
}

/* ---------------- 简报里的一排 ---------------- */

async function loadRecs() {
  if (!state.user) return;
  const q = new URLSearchParams({ platform: el.platformSel.value || '' });
  if (state.sectionId) q.set('section_id', state.sectionId);
  const subject = el.briefForm.subject.value.trim();
  if (subject) q.set('subject', subject.slice(0, 200));
  try {
    const { frameworks } = await api(`/frameworks/recommend?${q}`);
    fw.recs = frameworks;
  } catch { fw.recs = []; }
  renderPick();
}

function renderPick() {
  const list = [...fw.recs];
  // 选中的框架不在推荐里（比如从框架库挑的）也要显示出来
  if (state.frameworkKey && !list.some((f) => f.key === state.frameworkKey) && fw.chosen?.key === state.frameworkKey) {
    list.unshift(fw.chosen);
  }
  ui.pick.innerHTML = [
    `<button type="button" class="section-chip ${state.frameworkKey ? '' : 'on'}" data-fw="">不套框架</button>`,
    ...list.map((f) => `<button type="button" class="section-chip ${state.frameworkKey === f.key ? 'on' : ''}"
      data-fw="${esc(f.key)}" title="${esc(f.summary || '')}">${esc(f.name)}${f.builtin ? '' : '<span class="n">我的</span>'}</button>`),
  ].join('');
}

function choose(f) {
  state.frameworkKey = f ? f.key : null;
  fw.chosen = f || null;
  renderPick();
}

ui.pick.addEventListener('click', (e) => {
  const b = e.target.closest('[data-fw]');
  if (!b) return;
  const key = b.dataset.fw;
  choose(key ? [...fw.recs, fw.chosen].find((f) => f?.key === key) : null);
});

el.platformSel.addEventListener('change', loadRecs);
el.briefForm.subject.addEventListener('change', loadRecs);
window.addEventListener('cw-brief-context', () => { loadRecs(); });
el.newBtn?.addEventListener('click', () => choose(null));

/* ---------------- 框架库浮层 ---------------- */

async function loadAll() {
  const data = await api('/frameworks');
  fw.all = data;
  fw.platforms = data.platforms;
  ui.platform.innerHTML = `<option value="">全部平台</option>${data.platforms.map((p) => `<option value="${esc(p.key)}">${esc(p.label)}</option>`).join('')}`;
  ui.plats.innerHTML = `<span class="sections-label">适用平台</span>${data.platforms.map((p) => `
    <label class="fw-plat"><input type="checkbox" value="${esc(p.key)}" />${esc(p.label)}</label>`).join('')}
    <span class="hint">都不勾 = 通用</span>`;
}

function visible() {
  const p = ui.platform.value;
  const mine = fw.all?.mine || [];
  const builtin = fw.all?.builtin || [];
  const pool = fw.tab === 'mine' ? mine : fw.tab === 'builtin' ? builtin : [...mine, ...builtin];
  // 选了平台时，该平台专用的排在通用的前面；「我的」始终在前
  const rank = (f) => (f.builtin ? 2 : 0) + (p && f.platforms.includes(p) ? 0 : 1);
  return pool.filter((f) => !p || !f.platforms.length || f.platforms.includes(p))
    .map((f, i) => ({ f, i })).sort((a, b) => rank(a.f) - rank(b.f) || a.i - b.i).map((x) => x.f);
}

function renderList() {
  const list = visible();
  if (!list.length) {
    ui.list.innerHTML = `<p class="hint">${fw.tab === 'mine' ? '还没有自己的框架。可以新建，也可以把内置的复制过来再改。' : '这个平台下没有框架。'}</p>`;
    return;
  }
  ui.list.innerHTML = list.map((f) => `
    <div class="fw-card ${state.frameworkKey === f.key ? 'on' : ''}" data-key="${esc(f.key)}">
      <div class="fw-card-head">
        <b>${esc(f.name)}</b>
        <span class="fw-tag">${f.builtin ? '内置' : '我的'}</span>
        <span class="fw-tag">${f.platforms.length ? f.platforms.map(platformLabel).map(esc).join(' / ') : '通用'}</span>
        ${f.used_count ? `<span class="hint">用过 ${f.used_count} 次</span>` : ''}
      </div>
      ${f.summary ? `<p class="fw-sum">${esc(f.summary)}</p>` : ''}
      ${slotBar(f.slots)}
      <div class="fw-actions">
        <button type="button" class="btn primary small" data-use="${esc(f.key)}">${state.frameworkKey === f.key ? '正在用' : '用这个写'}</button>
        ${f.builtin
          ? `<button type="button" class="btn ghost small" data-copy="${esc(f.key)}">复制到我的</button>`
          : `<button type="button" class="btn ghost small" data-edit="${f.id}">编辑</button>
             <button type="button" class="btn ghost small" data-del="${f.id}">删除</button>`}
      </div>
    </div>`).join('');
}

async function openLib() {
  ui.modal.classList.remove('hidden');
  closeEditor();
  // 每次打开都重新拉：使用次数、别处的增删都要反映出来
  if (!fw.all) ui.list.innerHTML = '<p class="hint">加载中…</p>';
  try { await loadAll(); } catch (err) { ui.list.innerHTML = `<p class="form-error">${esc(err.message)}</p>`; return; }
  ui.platform.value = el.platformSel.value || '';
  renderList();
}

const closeLib = () => ui.modal.classList.add('hidden');

ui.libBtn.addEventListener('click', openLib);
ui.close.addEventListener('click', closeLib);
ui.modal.addEventListener('click', (e) => { if (e.target === ui.modal) closeLib(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !ui.modal.classList.contains('hidden')) closeLib(); });
ui.platform.addEventListener('change', renderList);
ui.tabs.addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (!b) return;
  fw.tab = b.dataset.tab;
  ui.tabs.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  renderList();
});

const findKey = (key) => [...(fw.all?.mine || []), ...(fw.all?.builtin || [])].find((f) => f.key === key);

ui.list.addEventListener('click', async (e) => {
  const use = e.target.closest('[data-use]');
  const copy = e.target.closest('[data-copy]');
  const edit = e.target.closest('[data-edit]');
  const del = e.target.closest('[data-del]');
  if (use) {
    choose(findKey(use.dataset.use));
    closeLib();
    toast(`本篇按「${fw.chosen.name}」的结构写`);
  } else if (copy) {
    await busy(copy, async () => {
      try {
        const { framework } = await api('/frameworks', { method: 'POST', body: { from: copy.dataset.copy } });
        await loadAll();
        fw.tab = 'mine';
        ui.tabs.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.tab === 'mine'));
        renderList();
        openEditor(framework);
      } catch (err) { toast(err.message); }
    });
  } else if (edit) {
    openEditor(fw.all.mine.find((f) => f.id === Number(edit.dataset.edit)));
  } else if (del) {
    const f = fw.all.mine.find((x) => x.id === Number(del.dataset.del));
    if (!f || !await window.ask.confirm({ title: `删除框架「${f.name}」？`, body: '用它写过的稿子不受影响。', danger: true, ok: '删除' })) return;
    try {
      await api(`/frameworks/${f.id}`, { method: 'DELETE' });
      if (state.frameworkKey === f.key) choose(null);
      await loadAll();
      renderList();
      loadRecs();
    } catch (err) { toast(err.message); }
  }
});

/* ---------------- 编辑器 ---------------- */

function slotRow(x = { role: '', guide: '', ratio: 0.2 }) {
  return `<div class="fw-slot">
    <input class="fw-role" maxlength="20" placeholder="这一段的作用，例：痛点开头" value="${esc(x.role)}" />
    <input class="fw-guide" maxlength="200" placeholder="要点：这段该写什么、怎么写" value="${esc(x.guide || '')}" />
    <input class="fw-ratio" type="number" min="1" max="100" step="1" value="${pct(x.ratio) || 20}" title="篇幅占比 %" /><span class="hint">%</span>
    <button type="button" class="icon-btn" data-up title="上移">↑</button>
    <button type="button" class="icon-btn" data-down title="下移">↓</button>
    <button type="button" class="icon-btn" data-rm title="删掉这段">×</button>
  </div>`;
}

function readSlots() {
  return [...ui.slots.querySelectorAll('.fw-slot')].map((r) => ({
    role: r.querySelector('.fw-role').value.trim(),
    guide: r.querySelector('.fw-guide').value.trim(),
    ratio: Number(r.querySelector('.fw-ratio').value) || 0,
  })).filter((x) => x.role);
}

function renderPreview() {
  const slots = readSlots();
  const total = slots.reduce((n, x) => n + x.ratio, 0) || 1;
  ui.preview.innerHTML = slots.length ? slotBar(slots.map((x) => ({ ...x, ratio: x.ratio / total }))) : '';
}

function openEditor(f = null) {
  fw.editing = f;
  ui.editor.classList.remove('hidden');
  ui.list.classList.add('hidden');
  ui.name.value = f?.name || '';
  ui.summary.value = f?.summary || '';
  ui.scenes.value = (f?.scenes || []).join('，');
  ui.plats.querySelectorAll('input[type=checkbox]').forEach((c) => { c.checked = (f?.platforms || []).includes(c.value); });
  const slots = f?.slots?.length ? f.slots : [
    { role: '开头', guide: '', ratio: 0.15 }, { role: '主体', guide: '', ratio: 0.7 }, { role: '结尾', guide: '', ratio: 0.15 },
  ];
  ui.slots.innerHTML = slots.map(slotRow).join('');
  ui.error.textContent = '';
  renderPreview();
  ui.name.focus();
}

function closeEditor() {
  fw.editing = null;
  ui.editor.classList.add('hidden');
  ui.list.classList.remove('hidden');
}

ui.newBtn.addEventListener('click', () => openEditor(null));
ui.cancel.addEventListener('click', closeEditor);
ui.slotAdd.addEventListener('click', () => {
  if (ui.slots.children.length >= 10) { ui.error.textContent = '最多 10 段'; return; }
  ui.slots.insertAdjacentHTML('beforeend', slotRow());
  renderPreview();
});
ui.slots.addEventListener('input', renderPreview);
ui.slots.addEventListener('click', (e) => {
  const row = e.target.closest('.fw-slot');
  if (!row) return;
  if (e.target.closest('[data-rm]')) row.remove();
  else if (e.target.closest('[data-up]') && row.previousElementSibling) row.previousElementSibling.before(row);
  else if (e.target.closest('[data-down]') && row.nextElementSibling) row.nextElementSibling.after(row);
  else return;
  renderPreview();
});

ui.save.addEventListener('click', async () => {
  const body = {
    name: ui.name.value.trim(),
    summary: ui.summary.value.trim(),
    scenes: ui.scenes.value,
    platforms: [...ui.plats.querySelectorAll('input:checked')].map((c) => c.value),
    slots: readSlots(),
  };
  if (!body.name) { ui.error.textContent = '给框架起个名字'; return; }
  if (body.slots.length < 2) { ui.error.textContent = '至少要有 2 段'; return; }
  await busy(ui.save, async () => {
    try {
      const { framework } = fw.editing
        ? await api(`/frameworks/${fw.editing.id}`, { method: 'PUT', body })
        : await api('/frameworks', { method: 'POST', body });
      if (state.frameworkKey === framework.key) fw.chosen = framework;
      await loadAll();
      closeEditor();
      renderList();
      loadRecs();
      toast('框架已保存');
    } catch (err) { ui.error.textContent = err.message; }
  });
});
