/* 前端 · account：账号设定、语气样本与语气档案、内容栏目。从原 app.js 原样拆出。 */
import { api, busy, creatorLine, currentPersona, el, esc, goStep, state, toast } from './core.js';
import { applyPersonaDefaults, editCurrentPersona, loadIdeas } from './brief.js';
import { loadHistory, platformLabel } from './compose.js';
import { flushSave } from './editor.js';
import { loadPool } from './library.js';
import { useSectionsStore } from '../../web/src/stores/sections.js';
import { useFrameworksStore } from '../../web/src/stores/frameworks.js';
import { legacy } from '../../web/src/lib/legacy.js';

/* ---------------- 账号设定 ---------------- */
/* 刷新后停在原来的账号。不记的话每次回来都跳回第一个，
   多账号的人一刷新就得重新选，还容易在错的账号下开始写。 */
const PERSONA_KEY = 'lastPersona';

const rememberPersona = () => {
  try { localStorage.setItem(PERSONA_KEY, state.personaId == null ? '' : String(state.personaId)); } catch { /* 隐私模式 */ }
};

export async function loadPersonas(preferId) {
  const { personas } = await api('/personas');
  state.personas = personas;
  if (preferId !== undefined) state.personaId = preferId;
  else if (!personas.some((p) => p.id === state.personaId)) {
    let saved;
    try { saved = localStorage.getItem(PERSONA_KEY); } catch { saved = null; }
    // 空串是"全部创作"，和"没存过"要分开；存的账号可能已经被删了，删了就回落到第一个
    const hit = saved === '' ? null
      : saved != null && personas.some((p) => p.id === Number(saved)) ? Number(saved)
        : undefined;
    state.personaId = hit === undefined ? (personas[0]?.id ?? null) : hit;
  }
  rememberPersona();
  renderPersonaBar();
}

export function renderPersonaBar() {
  const list = state.personas;
  const p = currentPersona();

  // 头像：拿名字第一个字做字母标
  const avatarOf = (x) => `<span class="persona-avatar">${esc(x.name?.[0] || '·')}</span>`;

  const row = (x) => {
    const on = x.id === state.personaId;
    return `<button type="button" class="persona-row ${on ? 'on' : ''}" data-persona="${x.id}">
      ${avatarOf(x)}
      <span class="persona-name">
        <b>${esc(x.name)}</b>
        <span class="persona-focus"><span class="pf-tag">${esc(platformLabel(x.platform))}</span>${
  on ? esc(x.content_focus || '') : ''}</span>
      </span>
      ${on ? '<span class="persona-gear" data-edit="1" title="编辑账号设定">⚙</span>' : ''}
    </button>`;
  };

  el.personaList.innerHTML = list.map(row).join('')
    + `<button type="button" class="persona-row ${state.personaId ? '' : 'on'}" data-persona="">
        <span class="persona-avatar">全</span>
        <span class="persona-name"><b>全部创作</b>
          <span class="persona-focus">${list.length ? '不限账号，新建时不带账号语境' : '还没有账号设定'}</span>
        </span>
      </button>`;

  el.personaMoreBtn.classList.toggle('hidden', !p);
  el.personaSummary.innerHTML = p ? [
    ['内容定位', p.content_focus], ['目标用户', p.audience],
    ['解决的问题', p.problem], ['备注', p.notes],
    ['个人人设', [creatorLine(p), p.creator_traits].filter(Boolean).join('\n')],
    [`语气档案（学了 ${p.sample_count || 0} 篇）`, p.style_digest],
  ].filter(([, v]) => v).map(([k, v]) =>
    `<div class="persona-field${k.startsWith('语气') ? ' digest' : ''}"><b>${k}</b>${esc(v)}</div>`).join('') : '';
  el.personaSummary.classList.toggle('hidden', !p || !state.personaOpen);

  const noPersonas = list.length === 0;
  el.onboardCard.classList.toggle('hidden', !noPersonas || state.skipOnboard);
  el.briefCard.classList.toggle('hidden', noPersonas && !state.skipOnboard);

  el.inheritNote.textContent = p
    ? `本篇按账号「${p.name}」的设定创作`
    : '未绑定账号 · 本篇不带账号语境';
  el.inheritNote.classList.toggle('free', !p);
}

/* 切换账号 = 切换创作语境：重置简报默认值并按账号过滤历史 */
el.personaList.addEventListener('click', (e) => {
  if (e.target.closest('[data-edit]')) { editCurrentPersona(); return; }
  const btn = e.target.closest('[data-persona]');
  if (!btn || state.streaming) return;
  const v = btn.dataset.persona;
  const next = v === '' ? null : Number(v);
  if (next === state.personaId) return;
  state.personaId = next;
  rememberPersona();
  resetBrief();
  renderPersonaBar();
  loadHistory();
});

export function resetBrief() {
  state.draft = null;
  goStep(1);
  el.briefForm.reset();
  state.pendingHotspot = null;
  el.hotRef.classList.add('hidden');
  applyPersonaDefaults();
  el.sectionInputs.classList.add('hidden');
  el.sectionInputs.innerHTML = '';
  loadSections(state.personaId);
  loadIdeas();
  loadPool();
}

/* ==================================================================
 * 语气学习：用户确认后，把这篇成稿喂给账号
 * ================================================================== */

el.learnBtn.addEventListener('click', async () => {
  const draft = state.draft;
  if (!draft?.content?.trim()) return;
  if (!draft.persona_id) {
    toast('这篇没有绑定账号，先在侧栏选一个账号再创作');
    return;
  }
  const persona = state.personas.find((p) => p.id === draft.persona_id);
  const name = persona?.name || draft.persona?.name || '该账号';
  if (!await ask.confirm({
    title: `把这篇喂给账号「${name}」学语气？`,
    body: '之后这个号的选题和成稿都会模仿它的语感。可以随时在账号设定里删掉样本。',
    ok: '喂进去',
  })) return;

  await flushSave();
  await busy(el.learnBtn, async () => {
    try {
      const { digest } = await api(`/personas/${draft.persona_id}/samples`, {
        method: 'POST', body: { draft_id: draft.id },
      });
      await loadPersonas(state.personaId);
      toast(digest ? '学好了，语气档案已更新' : '已加入样本');
    } catch (err) {
      toast(err.message);
    }
  });
});

/* ---------------- 账号设定里的样本管理 ---------------- */

export async function loadSamples(personaId) {
  el.styleSection.classList.toggle('hidden', !personaId);
  if (!personaId) return;
  el.sampleList.innerHTML = '';
  el.digestBox.innerHTML = '';
  try {
    const { samples, digest } = await api(`/personas/${personaId}/samples`);
    renderSamples(samples, digest);
  } catch (err) {
    el.styleHint.textContent = err.message;
  }
}

function renderSamples(samples, digest) {
  el.sampleList.innerHTML = samples.map((s) => `
    <div class="sample-row">
      <span class="name">${esc(s.title || '未命名样本')}</span>
      <span class="meta">${s.length} 字</span>
      <button class="del" data-sample="${s.id}" title="删除">×</button>
    </div>`).join('');
  el.digestBox.innerHTML = digest
    ? `<b>学到的语气档案</b>${esc(digest)}`
    : '';
  el.styleHint.textContent = samples.length
    ? `已学 ${samples.length} 篇`
    : '在成稿页点「喂给账号学习」即可添加';
  el.rebuildDigestBtn.classList.toggle('hidden', !samples.length);
}

el.sampleList.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-sample]');
  if (!btn || !state.editingId) return;
  if (!await ask.confirm({ title: '删除这篇样本？', body: '语气档案会用剩下的样本重新学一遍。', ok: '删除', danger: true })) return;
  await busy(btn, async () => {
    try {
      const { samples, digest } = await api(`/personas/${state.editingId}/samples/${btn.dataset.sample}`, { method: 'DELETE' });
      renderSamples(samples, digest);
      loadPersonas(state.personaId);
    } catch (err) { toast(err.message); }
  });
});

el.rebuildDigestBtn.addEventListener('click', async () => {
  if (!state.editingId) return;
  await busy(el.rebuildDigestBtn, async () => {
    try {
      const { digest } = await api(`/personas/${state.editingId}/digest`, { method: 'POST', body: {} });
      const { samples } = await api(`/personas/${state.editingId}/samples`);
      renderSamples(samples, digest);
      loadPersonas(state.personaId);
      toast('语气档案已重新学习');
    } catch (err) { toast(err.message); }
  });
});

/* ==================================================================
 * 内容栏目：账号下的几条内容线，创作时选一条
 * ================================================================== */

export async function loadSections(personaId, { forPicker = true } = {}) {
  if (!personaId) {
    state.sections = [];
    el.sectionPick.classList.add('hidden');
    return;
  }
  try {
    const { sections, presets } = await api(`/personas/${personaId}/sections`);
    state.sections = sections;
    state.presets = presets;
    if (forPicker) renderSectionChips();
  } catch { /* 账号不在了就静默 */ }
}

export function renderSectionChips() {
  // 账号或栏目变了，写法框架的推荐也要跟着换
  window.dispatchEvent(new Event('cw-brief-context'));
  const list = state.sections;
  const persona = currentPersona();
  el.sectionPick.classList.toggle('hidden', !persona);
  if (!persona) { state.sectionId = null; return; }
  if (!list.some((s) => s.id === state.sectionId)) {
    state.sectionId = null;
    el.sectionInputs.classList.add('hidden');
    el.sectionInputs.innerHTML = '';
  }

  el.sectionChips.innerHTML = [
    `<button type="button" class="section-chip ${state.sectionId === null ? 'on' : ''}" data-section=""
      title="不指定栏目，按账号的通用定位写">常规创作</button>`,
    ...list.map((s) => `
      <button type="button" class="section-chip ${state.sectionId === s.id ? 'on' : ''}"
        data-section="${s.id}" title="${esc(s.purpose || '')}">
        ${esc(s.name)}${s.draft_count ? `<span class="n">${s.draft_count}</span>` : ''}
      </button>`),
  ].join('');
}

el.sectionChips.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-section]');
  if (!btn) return;
  state.sectionId = btn.dataset.section ? Number(btn.dataset.section) : null;
  renderSectionChips();
  renderSectionInputs();
  useFrameworksStore().applySectionDefault();
});

/* 选中的栏目要什么素材，就在简报里问什么 */
export function renderSectionInputs(values = {}) {
  const section = state.sections.find((s) => s.id === state.sectionId);
  const fields = section?.fields || [];
  el.sectionInputs.classList.toggle('hidden', !fields.length);
  // 必须清空：留在 DOM 里的隐藏输入框会被 FormData 收走，
  // 之前还带 required，整个表单会被卡住且不给任何提示
  if (!fields.length) { el.sectionInputs.innerHTML = ''; return; }

  el.sectionInputs.innerHTML = `
    <div class="section-inputs-head">
      <b>「${esc(section.name)}」需要你提供</b>
      <span>模型只会用你在这里填的，不会自己编</span>
    </div>
    ${fields.map((f) => `
      <label>
        <span class="lab">${esc(f.label)}${f.required ? ' <span class="req">*</span>' : ''}
          ${f.hint ? `<em>${esc(f.hint)}</em>` : ''}</span>
        <textarea data-input="${esc(f.label)}" rows="2" maxlength="1500"
          >${esc(values[f.label] || '')}</textarea>
      </label>`).join('')}`;
}

export function collectSectionInputs() {
  const out = {};
  el.sectionInputs.querySelectorAll('textarea[data-input]').forEach((t) => {
    const v = t.value.trim();
    if (v) out[t.dataset.input] = v;
  });
  return Object.keys(out).length ? out : null;
}

/* 必填的没填就别发请求，省一次调用 */
export function missingRequired() {
  const section = state.sections.find((s) => s.id === state.sectionId);
  const values = collectSectionInputs() || {};
  return (section?.fields || []).filter((f) => f.required && !values[f.label]).map((f) => f.label);
}

/* ---------------- 栏目管理浮层在 Vue（SectionModal.vue） ---------------- */

el.manageSectionsBtn.addEventListener('click', () => useSectionsStore().openManager());

// 管理浮层关掉后：增删过的栏目同步到简报那一排
legacy.sectionsChanged = () => {
  renderSectionChips();
  renderSectionInputs(collectSectionInputs() || {});
};
