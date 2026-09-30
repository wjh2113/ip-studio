/* 前端 · library：素材库与选题池。从原 app.js 原样拆出。 */
import { $, api, busy, el, esc, goStep, state, toast } from './core.js';

/* ==================================================================
 * 素材库
 *
 * 存的是作者的真实经历、数据、案例——写作时按题材召回，
 * 拼进 user 消息，和栏目素材同属"唯一可信的事实来源"那一层。
 * 素材越厚，能写的真东西越多，模型编造的余地越小。
 * ================================================================== */

export const mat = { list: [], kinds: [], editing: null };

export async function loadMaterials(personaId) {
  if (!personaId) { mat.list = []; renderMaterials(); return; }
  try {
    const { materials, kinds } = await api(`/personas/${personaId}/materials`);
    mat.list = materials;
    mat.kinds = kinds;
    if (!el.matKind.options.length) {
      el.matKind.innerHTML = kinds.map((k) => `<option>${esc(k)}</option>`).join('');
    }
  } catch { mat.list = []; }
  renderMaterials();
}

function renderMaterials() {
  el.matList.innerHTML = mat.list.map((m) => (mat.editing === m.id ? `
    <div class="mat-item editing" data-mat="${m.id}">
      <div class="mat-head">
        <select data-f="kind">${mat.kinds.map((k) =>
    `<option${k === m.kind ? ' selected' : ''}>${esc(k)}</option>`).join('')}</select>
        <input data-f="title" value="${esc(m.title)}" maxlength="80">
      </div>
      <textarea data-f="body" rows="3" maxlength="4000">${esc(m.body)}</textarea>
      <div class="mat-add-foot">
        <input data-f="tags" value="${esc(m.tags)}" maxlength="200" placeholder="标签，逗号分隔">
        <button class="mini" data-save="${m.id}">保存</button>
        <button class="mini" data-cancel="1">取消</button>
      </div>
    </div>` : `
    <div class="mat-item" data-mat="${m.id}">
      <div class="mat-head">
        <span class="mat-kind">${esc(m.kind)}</span>
        <b>${esc(m.title)}</b>
        ${m.used_count ? `<span class="mat-used">用过 ${m.used_count} 次</span>` : ''}
        <span class="mat-acts">
          <button class="mini" data-edit="${m.id}">改</button>
          <button class="mini" data-del="${m.id}">删</button>
        </span>
      </div>
      <p>${esc(m.body)}</p>
      ${m.tags ? `<div class="mat-tags">${m.tags.split(/[,，]/).filter(Boolean)
    .map((t) => `<span>${esc(t.trim())}</span>`).join('')}</div>` : ''}
    </div>`)).join('');

  const used = mat.list.filter((m) => m.used_count).length;
  el.matHint.textContent = mat.list.length
    ? `共 ${mat.list.length} 条，其中 ${used} 条被写进过稿子。写作时按题材自动召回最相关的几条，用不上的不会硬塞。`
    : '还没有素材。存几条真实的经历、数据、案例——这是模型唯一能拿来写"真东西"的来源。';
}

el.matSaveBtn.addEventListener('click', () => busy(el.matSaveBtn, async () => {
  el.matError.textContent = '';
  const body = {
    kind: el.matKind.value, title: el.matTitle.value.trim(),
    body: el.matBody.value.trim(), tags: el.matTags.value.trim(),
  };
  if (!body.title || !body.body) { el.matError.textContent = '标题和内容都要填'; return; }
  try {
    await api(`/personas/${state.editingId}/materials`, { method: 'POST', body });
    el.matTitle.value = ''; el.matBody.value = ''; el.matTags.value = '';
    await loadMaterials(state.editingId);
    toast('已存进素材库');
  } catch (err) { el.matError.textContent = err.message; }
}));

el.matList.addEventListener('click', async (e) => {
  const t = e.target;
  if (t.dataset.edit) { mat.editing = Number(t.dataset.edit); renderMaterials(); return; }
  if (t.dataset.cancel) { mat.editing = null; renderMaterials(); return; }
  if (t.dataset.del) {
    const m = mat.list.find((x) => x.id === Number(t.dataset.del));
    if (!await ask.confirm({ title: `删掉素材「${m?.title}」？`, ok: '删除', danger: true })) return;
    try { await api(`/materials/${t.dataset.del}`, { method: 'DELETE' }); await loadMaterials(state.editingId); } catch (err) { toast(err.message); }
    return;
  }
  if (t.dataset.save) {
    const box = t.closest('[data-mat]');
    const f = (n) => box.querySelector(`[data-f="${n}"]`).value.trim();
    try {
      await api(`/materials/${t.dataset.save}`, { method: 'PUT',
        body: { kind: f('kind'), title: f('title'), body: f('body'), tags: f('tags') } });
      mat.editing = null;
      await loadMaterials(state.editingId);
      toast('已更新');
    } catch (err) { toast(err.message); }
  }
});

/* ==================================================================
 * 选题池与排期
 *
 * 热点里看到的机会、推荐里想留的题材，不当场写就丢了。
 * 池子负责"攒"，日期负责"排到哪天"——空日期就只是待选。
 * 刻意不做完整日历：自媒体的排期粒度就是"这周写哪几条"。
 * ================================================================== */

const pool = { list: [], open: false };

const today = () => new Date().toISOString().slice(0, 10);

export async function loadPool() {
  try {
    const q = state.personaId ? `?persona=${state.personaId}` : '';
    pool.list = (await api(`/pool${q}`)).pool;
  } catch { pool.list = []; }
  renderPool();
}

function renderPool() {
  const undone = pool.list.filter((x) => x.status !== 'done');
  const due = undone.filter((x) => x.plan_date && x.plan_date <= today()).length;
  el.poolNote.textContent = pool.list.length
    ? `${undone.length} 条待写${due ? ` · ${due} 条到期` : ''}`
    : '空的';
  el.poolToggle.textContent = pool.open ? '收起 ▴' : '展开 ▾';
  el.poolList.classList.toggle('hidden', !pool.open);
  if (!pool.open) return;

  el.poolList.innerHTML = (pool.list.length ? pool.list.map((x) => {
    const overdue = x.plan_date && x.plan_date <= today() && x.status !== 'done';
    return `
    <div class="pool-row ${overdue ? 'today' : ''} ${x.status === 'done' ? 'done' : ''}" data-pool="${x.id}">
      <span class="src">${esc(x.source)}</span>
      <span class="subj" title="${esc(x.note || '')}">${esc(x.subject)}</span>
      <input type="date" value="${esc(x.plan_date)}" data-date="${x.id}" title="排到哪天，留空就只是待选">
      <button class="mini" data-write="${x.id}">写这条</button>
      <button class="mini" data-poolrm="${x.id}">删</button>
    </div>`;
  }).join('') : '<div class="pool-empty">还没攒选题。热点板块里看到能蹭的、推荐题材里想留的，都可以先存进来。</div>')
    + `<div class="pool-add">
        <input id="poolInput" placeholder="想到什么先记一条，回车存入">
        <button class="btn ghost small" type="button" id="poolAddBtn">存入</button>
      </div>`;
}

el.poolToggle.addEventListener('click', () => { pool.open = !pool.open; renderPool(); });

export async function addPool(subject, source = '手动', note = '') {
  if (!subject.trim()) return;
  try {
    await api('/pool', { method: 'POST', body: { subject, source, note, persona_id: state.personaId } });
    pool.open = true;
    await loadPool();
    toast('已存进选题池');
  } catch (err) { toast(err.message); }
}

el.poolList.addEventListener('click', async (e) => {
  const t = e.target;
  if (t.id === 'poolAddBtn') { await addPool($('poolInput').value); return; }
  if (t.dataset.poolrm) {
    const x = pool.list.find((i) => i.id === Number(t.dataset.poolrm));
    if (!await ask.confirm({
      title: x?.subject ? `删掉选题「${x.subject}」？` : '删掉这条选题？',
      body: '选题池里去掉。已经写成的稿子还在。',
      ok: '删除', danger: true,
    })) return;
    try { await api(`/pool/${t.dataset.poolrm}`, { method: 'DELETE' }); await loadPool(); } catch (err) { toast(err.message); }
    return;
  }
  if (t.dataset.write) {
    // 「写这条」= 把题材填进简报并标记为已用，不自动生成——生成要花钱，让人自己按
    const x = pool.list.find((i) => i.id === Number(t.dataset.write));
    if (!x) return;
    goStep(1);
    el.briefForm.subject.value = x.subject;
    el.briefForm.subject.focus();
    try { await api(`/pool/${x.id}`, { method: 'PUT', body: { status: 'done' } }); await loadPool(); } catch { /* 标记失败不影响填入 */ }
  }
});

el.poolList.addEventListener('change', async (e) => {
  if (!e.target.dataset.date) return;
  try {
    await api(`/pool/${e.target.dataset.date}`, { method: 'PUT', body: { plan_date: e.target.value } });
    await loadPool();
  } catch (err) { toast(err.message); }
});

el.poolList.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'poolInput') { e.preventDefault(); addPool(e.target.value); }
});
