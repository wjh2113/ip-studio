/* 前端 · brief：创作简报：参数继承、题材推荐、第一步三个方向。从原 app.js 原样拆出。 */
import { PERSONA_FIELDS, api, busy, currentPersona, el, esc, goStep, hint, state, syncLength, toast } from './core.js';
import { closeSectionManager, collectSectionInputs, loadPersonas, loadSamples, loadSections, missingRequired, renderPersonaBar, renderSectionChips, renderSectionInputs, resetBrief } from './account.js';
import { generate, loadHistory, renderHistory } from './compose.js';
import { renderContent, setMode } from './editor.js';
import { renderCues } from './speak.js';
import { renderIllusBar, renderMultiBar, renderVersionTabs, ver } from './versions.js';
import { addPool, loadMaterials, mat } from './library.js';
import { legacy } from '../../web/src/lib/legacy.js';

/* ---------------- 简报参数：默认跟账号走 ---------------- */

/* 把账号设定填进表单，并回到「只展示」状态 */
export function applyPersonaDefaults() {
  const p = currentPersona();
  const f = el.briefForm;
  if (p) {
    f.platform.value = p.platform;
    f.tone.value = p.tone;
    f.audience.value = p.audience || '';
  }
  syncLength();
  lockParams(!p ? false : true);
}

function lockParams(locked) {
  state.paramsUnlocked = !locked;
  el.inheritRow.classList.toggle('hidden', !locked);
  el.paramGrid.classList.toggle('hidden', locked);
  el.paramReset.classList.toggle('hidden', locked || !currentPersona());
  if (locked) renderInherited();
}

function renderInherited() {
  const f = el.briefForm;
  const p = currentPersona();
  const platform = f.platform.selectedOptions[0]?.textContent || '';
  const facts = [
    ['发布平台', platform],
    ['风格调性', f.tone.value],
    ['目标读者', f.audience.value || (p?.audience || '')],
    ['目标字数', f.length.value ? `约 ${f.length.value} 字` : ''],
  ];
  el.inheritFacts.innerHTML = facts.map(([k, v]) => `
    <span class="inherited-fact"><b>${k}</b>${v
      ? `<span>${esc(v)}</span>`
      : '<span class="empty">未设定</span>'}</span>`).join('');
}

el.editParamsBtn.addEventListener('click', () => {
  lockParams(false);
  el.briefForm.platform.focus();
});

el.resetParamsBtn.addEventListener('click', () => {
  applyPersonaDefaults();
  toast('已恢复账号设定');
});

/* ---------------- 题材推荐 ---------------- */

/* 缓存里有就直接显示；空了就自动补一批（挑走一条后也会自动补齐）。
   自动失败过的账号本次会话不再自动重试，避免没配密钥时反复打扰。 */
export async function loadIdeas() {
  const persona = currentPersona();
  el.ideas.classList.toggle('hidden', !persona);
  if (!persona) return;

  el.ideasList.innerHTML = '';
  try {
    const { ideas } = await api(`/personas/${persona.id}/subjects`);
    if (ideas.length >= 3) { renderIdeas(ideas); return; }
    if (state.ideaFailed.has(persona.id)) {
      // 补不满就先把有的显示出来，别让用户对着空白
      if (ideas.length) renderIdeas(ideas);
      else ideaState('点「换一批」让 AI 想几个');
      return;
    }
    if (ideas.length) renderIdeas(ideas);   // 先显示热点那几条，常规的在后面补进来
    await refreshIdeas({ auto: true });
  } catch (err) {
    ideaState(err.message, true);
  }
}

async function refreshIdeas({ auto = false } = {}) {
  const persona = currentPersona();
  if (!persona) return;
  el.ideasList.innerHTML = '<div class="idea-skeleton"></div>'.repeat(3);
  el.ideasRefresh.disabled = true;
  try {
    const { ideas } = await api(`/personas/${persona.id}/subjects`, { method: 'POST', body: {} });
    state.ideaFailed.delete(persona.id);
    renderIdeas(ideas);
  } catch (err) {
    if (auto) state.ideaFailed.add(persona.id);
    ideaState(err.message, true);
  } finally {
    el.ideasRefresh.disabled = false;
  }
}

function renderIdeas(ideas) {
  state.ideas = ideas;
  el.ideasList.innerHTML = ideas.map((i, n) => {
    const hot = i.kind === 'hot' ? i.hotspot : null;
    return `
    <button type="button" class="idea ${hot ? 'from-hot' : ''}" data-idea="${n}">
      ${hot ? `<span class="idea-tag">🔥 热点 · ${esc(hot.platform)}${i.strength ? ` · 关联${esc(i.strength)}` : ''}</span>` : ''}
      <span class="idea-save" data-save-idea="${n}" title="存进选题池，以后再写">＋</span>
      <b>${esc(i.subject)}</b>
      ${i.reason ? `<span>${esc(i.reason)}</span>` : ''}
      ${hot ? `<span class="idea-origin">原文：${esc(hot.title)}</span>` : ''}
      ${hot && hot.summary ? `<span class="idea-summary">${esc(hot.summary)}</span>` : ''}
      ${hot && !hot.summary ? '<span class="idea-summary muted">抓不到原文概要，动笔前请点开原文看一眼</span>' : ''}
    </button>`;
  }).join('');
  el.ideasNote.textContent = ideas.some((i) => i.kind === 'hot')
    ? '热点优先，其余是这个号还没写过的'
    : '这个号还没写过的';
}

function ideaState(text, isError = false) {
  el.ideasList.innerHTML = `<div class="ideas-state${isError ? ' error' : ''}">${esc(text)}</div>`;
}

el.ideasList.addEventListener('click', (e) => {
  // 「＋」存进选题池，点卡片本身才是现在就写
  const save = e.target.closest('[data-save-idea]');
  if (save) {
    e.stopPropagation();
    const i = state.ideas?.[Number(save.dataset.saveIdea)];
    if (i) addPool(i.subject, i.kind === 'hot' ? '热点' : '推荐', i.reason || '');
    return;
  }
  const btn = e.target.closest('button[data-idea]');
  if (!btn) return;
  const idea = state.ideas?.[Number(btn.dataset.idea)];
  if (!idea) return;
  useSubject(idea.subject, idea.hotspot || null);
});

/* 选定题材（可能挂着一条热点，一起带进创作） */
export function useSubject(subject, hotspot) {
  state.pendingHotspot = hotspot;
  el.briefForm.subject.value = subject;
  el.briefForm.subject.focus();
  el.briefForm.subject.setSelectionRange(subject.length, subject.length);
  el.hotRef.classList.toggle('hidden', !hotspot);
  if (hotspot) {
    el.hotRef.innerHTML = `
      <span class="hot-ref-tag">🔥 借势热点</span>
      <span class="hot-ref-title">${hotspot.url
        ? `<a href="${esc(hotspot.url)}" target="_blank" rel="noopener noreferrer">${esc(hotspot.title)}</a>`
        : esc(hotspot.title)}</span>
      ${hotspot.summary
        ? `<span class="hot-ref-summary">${esc(hotspot.summary)}</span>`
        : '<span class="hot-ref-summary muted">没抓到原文概要，成稿里只会写到「最近大家在讨论」的程度</span>'}
      <button type="button" class="icon-btn" id="hotRefClear" title="不借势这条">×</button>`;
  }
}

el.ideasRefresh.addEventListener('click', () => refreshIdeas());

el.hotRef.addEventListener('click', (e) => {
  if (!e.target.closest('#hotRefClear')) return;
  state.pendingHotspot = null;
  el.hotRef.classList.add('hidden');
  toast('已取消借势，本篇按普通题材写');
});

el.newPersonaBtn.addEventListener('click', () => openPersonaModal(null));

el.onboardBtn.addEventListener('click', () => openPersonaModal(null));

/* 编辑当前账号。入口是账号行上的齿轮——原来那个独立的「编辑」按钮
   已经跟下拉一起去掉了，别再留一个指向 null 的监听。 */
export function editCurrentPersona() {
  const p = currentPersona();
  if (p) openPersonaModal(p);
}

el.skipOnboardBtn.addEventListener('click', () => {
  state.skipOnboard = true;
  renderPersonaBar();
  el.briefForm.subject.focus();
});

/* 账号设定的板块。加一个新板块 = 这里加一条 + index.html 里加一个 data-panel 块。
   needsSaved 的板块要先有账号才有意义——素材、样本都挂在 persona id 上。 */
const ACCOUNT_TABS = [
  { key: 'basic', label: '基本设定', hint: '这个号是谁、写给谁' },
  { key: 'persona', label: '个人人设', hint: '第一人称用谁的口吻' },
  { key: 'material', label: '素材库', hint: '你的真实经历与数据', needsSaved: true },
  { key: 'style', label: '语气样本', hint: '喂成稿学你的语感', needsSaved: true },
];

function renderAccountNav() {
  const saved = Boolean(state.editingId);
  el.accountNav.innerHTML = ACCOUNT_TABS.map((t) => {
    const off = t.needsSaved && !saved;
    return `<button type="button" data-tab="${esc(t.key)}"${off ? ' disabled' : ''}
      title="${off ? '先保存账号再设置这一项' : esc(t.hint)}">${esc(t.label)}<i>${
  off ? '先保存账号' : esc(t.hint)}</i></button>`;
  }).join('');
  showAccountTab(ACCOUNT_TABS.some((t) => t.key === state.accountTab
    && !(t.needsSaved && !saved)) ? state.accountTab : 'basic');
}

function showAccountTab(key) {
  state.accountTab = key;
  document.querySelectorAll('.acc-panel').forEach((n) => n.classList.toggle('hidden', n.dataset.panel !== key));
  el.accountNav.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.tab === key));
  el.accountNav.closest('.acc-body')?.querySelector('.acc-main')?.scrollTo({ top: 0 });
}

el.accountNav.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (b && !b.disabled) showAccountTab(b.dataset.tab);
});

export function openPersonaModal(persona) {
  // 同一个账号来回开关记住停在哪个板块；换了账号就回到基本设定，
  // 否则打开另一个号直接落在「语气样本」上会以为走错地方了
  if (state.editingId !== (persona?.id ?? null)) state.accountTab = 'basic';
  state.editingId = persona?.id ?? null;
  el.personaModalTitle.textContent = persona ? `账号设定 · ${persona.name}` : '新建账号设定';
  el.personaError.textContent = '';
  el.personaSaveHint.textContent = persona ? '' : '先填名称并保存，才能设置素材库和语气样本';
  el.personaDeleteBtn.classList.toggle('hidden', !persona);
  document.getElementById('quickTip')?.classList.toggle('hidden', Boolean(persona));
  const f = el.personaForm;
  f.reset();
  if (persona) {
    for (const k of PERSONA_FIELDS) f[k].value = persona[k] ?? '';
  }
  el.personaModal.classList.remove('hidden');
  document.body.classList.add('no-scroll');
  renderAccountNav();
  loadSamples(persona?.id ?? null);
  mat.editing = null;
  loadMaterials(persona?.id ?? null);
  setTimeout(() => f.name.focus(), 30);
}

const closePersonaModal = () => {
  el.personaModal.classList.add('hidden');
  document.body.classList.remove('no-scroll');
  loadSections(state.personaId);          // 栏目可能刚被增删，简报那边要跟上
};

el.personaCancelBtn.addEventListener('click', closePersonaModal);

el.personaCloseBtn.addEventListener('click', closePersonaModal);

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!el.sectionModal.classList.contains('hidden')) closeSectionManager();
  else if (!el.personaModal.classList.contains('hidden')) closePersonaModal();
});

el.personaForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  el.personaError.textContent = '';
  const body = Object.fromEntries(new FormData(el.personaForm).entries());
  const id = state.editingId;
  await busy(el.personaSaveBtn, async () => {
    try {
      const { persona } = await api(id ? `/personas/${id}` : '/personas', {
        method: id ? 'PUT' : 'POST', body,
      });
      state.skipOnboard = false;

      // 新建之后**留在页面上**：素材库、样本都要有账号 id 才能设，
      // 这会儿关掉等于逼人再点开一次，左边那几个板块也就白解锁了
      if (!id) {
        state.editingId = persona.id;
        el.personaModalTitle.textContent = `账号设定 · ${persona.name}`;
        el.personaSaveHint.textContent = '已创建 —— 左边的素材库、语气样本现在可以设了';
        el.personaDeleteBtn.classList.remove('hidden');
        renderAccountNav();
              loadSamples(persona.id);
        loadMaterials(persona.id);
        await loadPersonas(persona.id);
        resetBrief();
        loadHistory();
        toast('账号已创建，之后的创作都会带上这份设定');
        // 快速建号带来的旧文章在这之后存成语气样本（quickstart.js 听这个）
        window.dispatchEvent(new CustomEvent('cw-persona-created', { detail: persona }));
        return;
      }

      closePersonaModal();
      await loadPersonas(persona.id);
      loadIdeas();
      loadHistory();
      toast('账号设定已更新');
    } catch (err) {
      el.personaError.textContent = err.message;
    }
  });
});

el.personaDeleteBtn.addEventListener('click', async () => {
  const p = currentPersona();
  if (!p) return;
  const n = p.draft_count || 0;
  if (!await ask.confirm({
    title: `删除账号「${p.name}」？`,
    body: n ? `其下 ${n} 条创作会保留在「全部创作」里。` : '',
    ok: '删除', danger: true,
  })) return;
  await api(`/personas/${p.id}`, { method: 'DELETE' });
  closePersonaModal();
  await loadPersonas(undefined);
  resetBrief();
  loadHistory();
  toast('账号已删除');
});

/* ---------------- 第一步：三个方向 ---------------- */
el.briefForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(el.briefForm).entries());
  body.persona_id = state.personaId ?? '';
  if (state.pendingHotspot) body.hotspot = state.pendingHotspot;
  if (state.sectionId) {
    const missing = missingRequired();
    if (missing.length) {
      hint(`先补上：${missing.join('、')}`, true);
      el.sectionInputs.querySelector('textarea[data-input]')?.focus();
      return;
    }
    body.section_id = state.sectionId;
    const inputs = collectSectionInputs();
    if (inputs) body.inputs = inputs;
  }
  if (state.frameworkKey) body.framework = state.frameworkKey;
  const p = currentPersona();
  hint(p ? `正在以「${p.name}」的定位拆解题材…` : '正在拆解题材，生成三个差异化方向…');

  await busy(el.topicsBtn, async () => {
    try {
      const { draft } = await api('/drafts/topics', { method: 'POST', body });
      hint('');
      setDraft(draft);
      loadHistory();
      loadIdeas();
    } catch (err) {
      hint(err.message, true);
    }
  });
});

el.retopicsBtn.addEventListener('click', async () => {
  if (!state.draft) return;
  await busy(el.retopicsBtn, async () => {
    try {
      const { draft } = await api(`/drafts/${state.draft.id}/topics`, { method: 'POST', body: {} });
      setDraft(draft);
    } catch (err) {
      toast(err.message);
    }
  });
});

el.newBtn.addEventListener('click', () => {
  if (state.streaming) return;
  resetBrief();
  renderHistory();
  el.briefForm.subject.focus();
});

/* ---------------- 渲染方向 ---------------- */
legacy.setDraft = (d) => setDraft(d);

export function setDraft(draft) {
  state.revOpen = false;
  state.revId = null;
  state.revText = '';
  state.revisions = [];
  el.revPane?.classList.add('hidden');
  el.revBtn?.classList.remove('on');
  state.draft = draft;
  fillBrief(draft);
  renderTopics(draft);

  el.reviewBox.classList.add('hidden');
  state.review = null;
  renderCues(null);
  ver.current = '';                    // 换草稿了，回到原文
  state.multiOpen = false;
  state.illusOpen = false;
  renderIllusBar();
  renderMultiBar();
  renderVersionTabs();
  // 打开一篇旧稿时直接落到它已经走到的那一步
  if (draft.content) {
    el.contentTitle.textContent = draft.title || '完整文案';
    setMode('read');
    renderContent();
    goStep(3, { done: true });
  } else {
    goStep(draft.topics?.length ? 2 : 1);
  }
  renderHistory();
}

function fillBrief(d) {
  if (d.persona) {
    el.inheritNote.textContent = `本稿基于账号「${d.persona.name}」的设定创作`;
    el.inheritNote.classList.remove('free');
  } else {
    el.inheritNote.textContent = '本稿未绑定账号';
    el.inheritNote.classList.add('free');
  }
  const f = el.briefForm;
  f.subject.value = d.subject;
  f.platform.value = d.platform;
  f.tone.value = d.tone;
  f.audience.value = d.audience || d.persona?.audience || '';
  f.keywords.value = d.keywords || '';
  f.length.value = d.length;
  state.sectionId = d.section_id ?? null;
  state.frameworkKey = d.framework?.key || null;
  renderSectionChips();
  renderSectionInputs(d.inputs || {});
  lockParams(true);
}

/* 一个方向一横条：左边是"这是什么"，右边是"怎么写"。
   原来三个窄长条并排，每条 900 多像素高，读起来要上下扫三趟，也没法横向比较。 */
export function renderTopics(draft) {
  const fwNote = document.getElementById('topicsFw');
  if (fwNote) fwNote.textContent = draft.framework ? `写法：${draft.framework.name}` : '';
  el.topics.innerHTML = draft.topics.map((t, i) => `
    <div class="topic ${draft.chosen === i ? 'chosen' : ''}">
      <div class="topic-main">
        <span class="topic-tag">
          <b>${i + 1}</b>${esc(t.label || `方向 ${i + 1}`)}
        </span>
        <h3>${esc(t.title)}</h3>
        <p class="angle"><b>差异</b>${esc(t.angle)}</p>
        <p class="hook">${esc(t.hook)}</p>
        ${t.audience_fit ? `<p class="fit">适合：${esc(t.audience_fit)}</p>` : ''}
        <button class="btn ${draft.chosen === i ? 'ghost' : 'primary'} small" data-index="${i}">
          ${draft.chosen === i ? '重新生成这篇' : '用这个方向写'}
        </button>
      </div>
      <div class="topic-outline">
        <b>结构</b>
        <ul>${t.outline.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>
      </div>
    </div>`).join('');
}

el.topics.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-index]');
  if (btn && !state.streaming) generate(Number(btn.dataset.index));
});
