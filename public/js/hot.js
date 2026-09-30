/* 前端 · hot：热点板块：榜单与比对。从原 app.js 原样拆出。 */
import { api, busy, currentPersona, el, esc, state, toast } from './core.js';
import { resetBrief } from './account.js';
import { useSubject } from './brief.js';
import { SUMMARY_SOURCE } from './review.js';

/* ==================================================================
 * 热点板块：抓全网榜单 → 和账号定位比对 → 给出可蹭的点和选题
 * ================================================================== */

el.viewNav.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-view]');
  if (btn) setView(btn.dataset.view);
});

function setView(view) {
  state.view = view;
  el.writeView.classList.toggle('hidden', view !== 'write');
  el.hotView.classList.toggle('hidden', view !== 'hot');
  [...el.viewNav.children].forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  if (view === 'hot') openHot();
}

/* 进热点板块：先把上次的结果和缓存的榜单摆出来，不自动烧一次模型调用 */
export async function openHot() {
  const persona = currentPersona();
  if (!persona) {
    el.hotMatches.innerHTML = '<div class="hot-note">先在左边选一个账号，热点才有比对的对象。</div>';
    el.hotRun.disabled = true;
    return;
  }
  el.hotRun.disabled = false;
  el.hotIntro.textContent =
    `抓取全网榜单，和「${persona.name}」的定位逐条比对，只留下这个号真能接得住的，并给出蹭点和选题建议。`;

  try {
    const { hotspots } = await api(`/personas/${persona.id}/hotspots`);
    renderHotspots(hotspots);
  } catch { /* 读缓存失败就当没有 */ }

  if (!state.boards) loadBoards();
}

async function loadBoards(force = false) {
  el.boardList.innerHTML = '<div class="ideas-state">正在抓取榜单…</div>';
  try {
    state.boards = await api(`/hotspots${force ? '?force=1' : ''}`);
    renderBoards();
    renderSources(state.boards.sources);
  } catch (err) {
    el.boardList.innerHTML = `<div class="ideas-state error">${esc(err.message)}</div>`;
  }
}

function renderSources(sources = []) {
  el.hotSources.innerHTML = (sources || []).map((s) => `
    <span class="source-pill ${s.ok ? 'ok' : 'bad'}" title="${esc(s.error || '')}">
      ${s.ok ? '●' : '○'} ${esc(s.label)}${s.ok ? ` ${s.count}` : ' 抓取失败'}
    </span>`).join('');
}

function renderBoards() {
  const boards = state.boards;
  if (!boards) return;
  const groups = [...new Set(boards.items.map((i) => i.platform))];
  if (el.boardFilter.options.length !== groups.length + 1) {
    el.boardFilter.innerHTML = `<option value="">全部平台（${boards.items.length} 条）</option>`
      + groups.map((g) => `<option value="${esc(g)}">${esc(g)}</option>`).join('');
  }
  const pick = el.boardFilter.value;
  const rows = boards.items.filter((i) => !pick || i.platform === pick);

  el.boardList.innerHTML = rows.map((it, i) => `
    <div class="board-row">
      <span class="no">${i + 1}</span>
      <span class="plat">${esc(it.platform)}</span>
      ${it.url
        ? `<a href="${esc(it.url)}" target="_blank" rel="noopener noreferrer">${esc(it.title)}</a>`
        : `<span style="flex:1">${esc(it.title)}</span>`}
      <span class="heat">${formatHeat(it.heat)}</span>
    </div>`).join('');

  const when = new Date(boards.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  el.hotMeta.textContent = `榜单更新于 ${when}`;
}

el.boardFilter.addEventListener('change', renderBoards);

el.boardRefresh.addEventListener('click', () => loadBoards(true));

const formatHeat = (n) => (!n ? '' : n >= 10000 ? `${(n / 10000).toFixed(1)} 万` : String(n));

/* ---------------- 比对 ---------------- */

el.hotRun.addEventListener('click', () => runHotspots({}));

el.manualRun.addEventListener('click', () => {
  const manual = el.manualInput.value.trim();
  if (!manual) { toast('先粘一份榜单'); return; }
  runHotspots({ manual });
});

async function runHotspots(body) {
  const persona = currentPersona();
  if (!persona) return;
  el.hotMatches.innerHTML = '<div class="idea-skeleton"></div><div class="idea-skeleton"></div>';
  await busy(body.manual ? el.manualRun : el.hotRun, async () => {
    try {
      const { hotspots } = await api(`/personas/${persona.id}/hotspots`, { method: 'POST', body });
      renderHotspots(hotspots);
      if (!body.manual) loadBoards();
    } catch (err) {
      el.hotMatches.innerHTML = `<div class="hot-note">${esc(err.message)}</div>`;
    }
  });
}

function renderHotspots(hot) {
  if (!hot) { el.hotMatches.innerHTML = ''; return; }
  renderSources(hot.sources);

  const when = new Date(hot.at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const screened = hot.screened
    ? `　·　已挡掉 ${hot.screened} 条不适合蹭的<span class="screened-peek" title="${esc((hot.screenedSample || []).map((b) => `${b.risk}：${b.title}`).join('\n'))}">（看类型）</span>`
    : '';
  const head = `<div class="hint" style="margin-bottom:4px">${when} 比对了 ${hot.total} 条热点${screened}</div>`;

  if (!hot.matches.length) {
    el.hotMatches.innerHTML = head
      + `<div class="hot-note">${esc(hot.note || '这一轮榜单里没有适合这个号蹭的热点。硬蹭不如不蹭，等下一轮。')}</div>`;
    return;
  }

  state.hotMatches = hot.matches;
  el.hotMatches.innerHTML = head + hot.matches.map((m, idx) => {
    const o = m.origin || {};
    return `
    <article class="match ${m.strength === '强' ? 'strong' : ''}">
      <div class="match-top">
        <span class="badge">${esc(o.platform || '')}</span>
        <span class="badge s-${esc(m.strength)}">关联度 ${esc(m.strength)}</span>
        ${o.heat ? `<span class="badge">热度 ${formatHeat(o.heat)}</span>` : ''}
      </div>

      <div class="match-block">
        <b>原文章</b>
        <p>${o.url
          ? `<a href="${esc(o.url)}" target="_blank" rel="noopener noreferrer">${esc(o.title)}</a>`
          : esc(o.title)}</p>
        ${o.summary
          ? `<p class="origin-summary">${esc(o.summary)}<em>${SUMMARY_SOURCE[o.summarySource] || ''}</em></p>`
          : '<p class="origin-summary muted">抓不到原文概要（平台反爬或需要 JS），动笔前请点开原文核实</p>'}
      </div>

      <div class="match-block">
        <b>蹭热点的点</b>
        <p>${esc(m.angle)}</p>
      </div>

      <div class="match-block">
        <b>选题建议</b>
        <p>${esc(m.subject)}</p>
      </div>

      ${m.caution ? `<div class="match-block caution"><b>注意分寸</b><p>${esc(m.caution)}</p></div>` : ''}

      <button class="btn primary small" data-match="${esc(String(idx))}">
        用这个题材去创作
      </button>
    </article>`;
  }).join('');
}

/* 一键把选题带回创作简报 */
el.hotMatches.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-match]');
  if (!btn) return;
  const m = state.hotMatches?.[Number(btn.dataset.match)];
  if (!m) return;
  setView('write');
  resetBrief();
  useSubject(m.subject, {
    title: m.origin?.title || '', url: m.origin?.url || '',
    platform: m.origin?.platform || '', summary: m.origin?.summary || '',
    summarySource: m.origin?.summarySource || 'none', angle: m.angle,
  });
  toast('已带回创作简报，成稿会引用这条热点');
});
