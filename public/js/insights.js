/* 前端 · insights：发布数据回填与复盘。从原 app.js 原样拆出。 */
import { api, busy, el, esc, hint, state, toast } from './core.js';
import { platformLabel } from './compose.js';

/* ==================================================================
 * 发布数据回填与复盘
 *
 * 产品原来到"导出"就断了。回填几个数字，才能回答"什么有效"——
 * 语气档案学的是"你怎么写"，这个学的是"哪种写法数据好"。
 * ================================================================== */

let metricFields = [];
const $ = (id) => document.getElementById(id);
const mx = { on: $('metricsOn'), platform: $('metricsPlatform'), platformRow: $('metricsPlatformRow'), history: $('metricsHistory') };
let history = [];

/* 本地日期（不是 UTC）：晚上 11 点填的数不该记到明天 */
const localDay = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const dayNo = (pub, on) => {
  if (!pub || !on) return null;
  return Math.round((Date.parse(on) - Date.parse(pub)) / 86400000);
};

/* 按当前选的平台和日期填表：当天已经记过就带出来改；没记过就空着，占位里给上次的数做参考 */
function fillMetricFields() {
  const platform = mx.platform.value || state.draft.platform || '';
  const on = mx.on.value;
  const same = history.filter((h) => (h.platform || state.draft.platform) === platform);
  const hit = same.find((h) => h.capturedOn === on);
  const last = same.find((h) => h.capturedOn < on) || null;
  el.metricsNote.value = hit?.note || '';
  el.metricsFields.innerHTML = metricFields.map((f) => `
    <label>${esc(f.label)}
      <input type="number" min="0" data-metric="${esc(f.key)}"
        value="${hit?.[f.key] ?? ''}" placeholder="${last?.[f.key] != null ? `上次 ${last[f.key]}` : '留空不记'}">
    </label>`).join('');
  renderMetricHistory();
}

function renderMetricHistory() {
  if (!history.length) { mx.history.innerHTML = ''; return; }
  const pub = el.metricsDate.value;
  const label = (k) => metricFields.find((f) => f.key === k)?.label || k;
  mx.history.innerHTML = `<h4>历次回填</h4>${history.map((h) => {
    const n = dayNo(pub, h.capturedOn);
    const nums = metricFields.filter((f) => h[f.key] != null).map((f) => `${label(f.key)} ${h[f.key]}`).join(' · ');
    const on = h.capturedOn === mx.on.value && (h.platform || state.draft.platform) === (mx.platform.value || state.draft.platform);
    return `<div class="metrics-snap${on ? ' on' : ''}">
      <span class="mono">${esc(h.capturedOn)}</span>
      ${n != null ? `<span>第 ${n} 天</span>` : ''}
      ${mx.platformRow.classList.contains('hidden') ? '' : `<span>${esc(platformLabel(h.platform))}</span>`}
      <span class="grow" title="${esc(h.note || '')}">${esc(nums || h.note || '')}</span>
      <button type="button" class="mini del" data-metric-del="${h.id}" title="删掉这次">删除</button>
    </div>`;
  }).join('')}`;
}

export async function openMetrics() {
  if (!state.draft?.id) return;
  if (!metricFields.length) {
    try { metricFields = (await api('/metrics')).fields; } catch { return; }
  }
  let platforms = [state.draft.platform];
  try {
    const d = await api(`/drafts/${state.draft.id}/metrics`);
    history = d.history || [];
    platforms = d.platforms?.length ? d.platforms : platforms;
  } catch (err) { toast(err.message); return; }
  el.metricsDate.value = state.draft.published_at || localDay();
  mx.on.value = localDay();
  mx.platform.innerHTML = platforms.map((p) => `<option value="${esc(p)}">${esc(platformLabel(p))}</option>`).join('');
  mx.platform.value = state.draft.platform;
  mx.platformRow.classList.toggle('hidden', platforms.length < 2);
  fillMetricFields();
  el.metricsModal.classList.remove('hidden');
}

el.metricsClose.addEventListener('click', () => el.metricsModal.classList.add('hidden'));
mx.on.addEventListener('change', fillMetricFields);
mx.platform.addEventListener('change', fillMetricFields);
el.metricsDate.addEventListener('change', renderMetricHistory);

function applySaved(out) {
  state.draft.metrics = out.metrics;
  state.draft.published_at = out.published_at;
  history = out.history || [];
}

el.metricsSave.addEventListener('click', () => busy(el.metricsSave, async () => {
  const body = {
    published_at: el.metricsDate.value,
    captured_on: mx.on.value,
    platform: mx.platform.value,
    note: el.metricsNote.value,
  };
  el.metricsFields.querySelectorAll('[data-metric]').forEach((i) => {
    if (i.value !== '') body[i.dataset.metric] = Number(i.value);
  });
  try {
    const out = await api(`/drafts/${state.draft.id}/metrics`, { method: 'POST', body });
    applySaved(out);
    el.metricsModal.classList.add('hidden');
    toast(out.removed ? '已删掉这一天的记录' : '已记下，过几天可以再填一次看走势');
  } catch (err) { toast(err.message); }
}));

mx.history.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-metric-del]');
  if (!b) return;
  b.disabled = true;
  try {
    applySaved(await api(`/drafts/${state.draft.id}/metrics/${b.dataset.metricDel}`, { method: 'DELETE' }));
    fillMetricFields();
  } catch (err) { toast(err.message); b.disabled = false; }
});

/* ---------------- 复盘 ---------------- */

el.insightsLink.addEventListener('click', (e) => { e.preventDefault(); el.metricsModal.classList.add('hidden'); openInsights(); });

el.insightsClose.addEventListener('click', () => el.insightsModal.classList.add('hidden'));

async function openInsights() {
  el.insightsModal.classList.remove('hidden');
  el.insightsBody.innerHTML = '<div class="idea-skeleton"></div>'.repeat(2);
  try {
    const q = state.personaId ? `?persona=${state.personaId}` : '';
    const d = await api(`/insights${q}`);
    el.insightsNote.textContent = `已回填 ${d.total} 篇`;

    const table = (title, rows, hint) => `
      <section class="ins-block">
        <h3>${esc(title)}<em>${esc(hint)}</em></h3>
        ${rows.length ? `<table class="admin-table">
          <thead><tr><th>${esc(title)}</th><th class="num">篇数</th>
            <th class="num">阅读中位数</th><th class="num" title="只比发布后第 5～9 天记下的数">第 7 天阅读</th><th class="num">点赞中位数</th></tr></thead>
          <tbody>${rows.map((r) => `<tr>
            <td>${esc(r.name)}</td>
            <td class="num">${r.count}</td>
            <td class="num">${r.views ?? '<span class="dim">样本不足</span>'}</td>
            <td class="num">${r.views7 ?? '<span class="dim">—</span>'}</td>
            <td class="num">${r.likes ?? '<span class="dim">—</span>'}</td>
          </tr>`).join('')}</tbody>
        </table>` : '<p class="hint">还没有可分组的数据。</p>'}
      </section>`;

    el.insightsBody.innerHTML = `<p class="hint ins-note">${esc(d.note)}</p>`
      + table('平台', d.byPlatform, '同一篇发不同平台，表现差很多')
      + table('栏目', d.bySection, '哪个栏目的读者最买账')
      + table('方向类型', d.byLabel, '反常识 / 方法拆解 / 个人经历…哪类更吃香')
      + `<section class="ins-block"><h3>明细<em>最近 40 篇</em></h3>
          <table class="admin-table"><thead><tr>
            <th>标题</th><th>平台</th><th>发布</th><th class="num">阅读</th><th class="num">点赞</th><th>走势</th><th>备注</th>
          </tr></thead><tbody>${d.items.map((x) => `<tr>
            <td>${esc(x.title)}</td>
            <td>${esc(platformLabel(x.platform))}</td>
            <td class="mono">${esc(x.published_at || '')}</td>
            <td class="num">${x.metrics.views ?? '—'}</td>
            <td class="num">${x.metrics.likes ?? '—'}</td>
            <td class="ins-trend">${trendText(x.trend)}</td>
            <td>${esc(x.metrics.note || '')}</td>
          </tr>`).join('')}</tbody></table>
        </section>`;
  } catch (err) {
    el.insightsBody.innerHTML = `<p class="hint error">${esc(err.message)}</p>`;
  }
}

/* 走势：「第 1 天 1200 → 第 7 天 5400」，只回填过一次就不显示 */
function trendText(trend = []) {
  const pts = trend.filter((t) => t.views != null);
  if (pts.length < 2) return '';
  return pts.map((t) => `${t.day != null ? `第 ${t.day} 天` : esc(t.on)} ${t.views}`).join(' → ');
}
