/* 前端 · insights：发布数据回填与复盘。从原 app.js 原样拆出。 */
import { api, busy, el, esc, hint, state, toast } from './core.js';

/* ==================================================================
 * 发布数据回填与复盘
 *
 * 产品原来到"导出"就断了。回填几个数字，才能回答"什么有效"——
 * 语气档案学的是"你怎么写"，这个学的是"哪种写法数据好"。
 * ================================================================== */

let metricFields = [];

export async function openMetrics() {
  if (!state.draft?.id) return;
  if (!metricFields.length) {
    try { metricFields = (await api('/metrics')).fields; } catch { return; }
  }
  const m = state.draft.metrics || {};
  el.metricsDate.value = state.draft.published_at || new Date().toISOString().slice(0, 10);
  el.metricsNote.value = m.note || '';
  el.metricsFields.innerHTML = metricFields.map((f) => `
    <label>${esc(f.label)}
      <input type="number" min="0" data-metric="${esc(f.key)}"
        value="${m[f.key] ?? ''}" placeholder="留空不记">
    </label>`).join('');
  el.metricsModal.classList.remove('hidden');
}

el.metricsClose.addEventListener('click', () => el.metricsModal.classList.add('hidden'));

el.metricsSave.addEventListener('click', () => busy(el.metricsSave, async () => {
  const body = { published_at: el.metricsDate.value, note: el.metricsNote.value };
  el.metricsFields.querySelectorAll('[data-metric]').forEach((i) => {
    if (i.value !== '') body[i.dataset.metric] = Number(i.value);
  });
  try {
    const out = await api(`/drafts/${state.draft.id}/metrics`, { method: 'POST', body });
    state.draft.metrics = out.metrics;
    state.draft.published_at = out.published_at;
    el.metricsModal.classList.add('hidden');
    toast(out.metrics ? '已记下' : '已撤销这次回填');
  } catch (err) { toast(err.message); }
}));

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
            <th class="num">阅读中位数</th><th class="num">点赞中位数</th></tr></thead>
          <tbody>${rows.map((r) => `<tr>
            <td>${esc(r.name)}</td>
            <td class="num">${r.count}</td>
            <td class="num">${r.views ?? '<span class="dim">样本不足</span>'}</td>
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
            <th>标题</th><th>发布</th><th class="num">阅读</th><th class="num">点赞</th><th>备注</th>
          </tr></thead><tbody>${d.items.map((x) => `<tr>
            <td>${esc(x.title)}</td>
            <td class="mono">${esc(x.published_at || '')}</td>
            <td class="num">${x.metrics.views ?? '—'}</td>
            <td class="num">${x.metrics.likes ?? '—'}</td>
            <td>${esc(x.metrics.note || '')}</td>
          </tr>`).join('')}</tbody></table>
        </section>`;
  } catch (err) {
    el.insightsBody.innerHTML = `<p class="hint error">${esc(err.message)}</p>`;
  }
}
