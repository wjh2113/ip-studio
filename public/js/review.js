/* 前端 · review：成稿检查。从原 app.js 原样拆出。 */
import { api, busy, el, esc, state, toast } from './core.js';
import { flushSave, markDirty, renderContent } from './editor.js';

/* ==================================================================
 * 成稿检查：让模型回头看一遍错字和通顺性，逐条采纳
 * ================================================================== */

const VERDICT_LABEL = { ok: '没发现问题', minor: '有几处小毛病', bad: '大面积不通顺' };

export const SUMMARY_SOURCE = { board: '　来源：榜单摘要', article: '　来源：抓取原文后概括' };

el.reviewBtn.addEventListener('click', () => runReview());

el.reviewClose.addEventListener('click', () => el.reviewBox.classList.add('hidden'));

export async function runReview({ silent = false } = {}) {
  const draft = state.draft;
  if (!draft?.content?.trim()) return;
  await flushSave();

  if (!silent) {
    el.reviewBox.classList.remove('hidden', 'ok', 'minor', 'bad');
    el.reviewVerdict.className = 'review-verdict';
    el.reviewVerdict.textContent = '检查中';
    el.reviewSummary.textContent = '正在通读全文…';
    el.reviewList.innerHTML = '';
    el.reviewApplyAll.classList.add('hidden');
  }

  await busy(el.reviewBtn, async () => {
    try {
      const { review } = await api(`/drafts/${draft.id}/review`, {
        method: 'POST', body: { content: draft.content },
      });
      state.review = review;
      renderReview(review);
    } catch (err) {
      el.reviewBox.classList.remove('hidden');
      el.reviewVerdict.className = 'review-verdict bad';
      el.reviewVerdict.textContent = '检查失败';
      el.reviewSummary.textContent = err.message;
      el.reviewList.innerHTML = '';
    }
  });
}

function renderReview(review) {
  const worst = review.risk === '高' ? 'bad' : review.risk === '中' ? 'minor' : review.verdict;
  el.reviewBox.classList.remove('hidden', 'ok', 'minor', 'bad');
  el.reviewBox.classList.add(worst);
  el.reviewVerdict.className = `review-verdict ${review.verdict}`;
  el.reviewVerdict.textContent = VERDICT_LABEL[review.verdict] || review.verdict;

  const hasRisk = review.risk && review.risk !== '无';
  el.reviewRisk.classList.toggle('hidden', !hasRisk);
  if (hasRisk) {
    el.reviewRisk.className = `review-risk lv-${review.risk}`;
    el.reviewRisk.textContent = `风险 ${review.risk}`;
  }
  renderFlags(review.flags || []);

  const notes = [
    review.dropped ? `${review.dropped} 条在原文里对不上` : '',
    review.padded ? `${review.padded} 条凑数提示` : '',
  ].filter(Boolean);
  el.reviewSummary.textContent = (review.summary || '')
    + (notes.length ? `　（已忽略：${notes.join('、')}）` : '');

  el.reviewApplyAll.classList.toggle('hidden', review.issues.length < 2);
  el.reviewList.innerHTML = review.issues.map((it, i) => `
    <div class="issue" data-issue="${i}">
      <div class="issue-top">
        <span class="issue-type">${esc(it.type)}</span>
        <span class="issue-why">${esc(it.why)}</span>
        ${it.count > 1 ? `<span class="issue-why">· 原文出现 ${it.count} 次，只改第一处</span>` : ''}
      </div>
      <div class="issue-diff">
        <div class="from">${esc(it.quote)}</div>
        <div class="to">${esc(it.fix)}</div>
      </div>
      <div class="issue-actions">
        <button class="btn primary small" data-apply="${i}">采纳</button>
        <button class="btn ghost small" data-skip="${i}">忽略</button>
      </div>
    </div>`).join('');
}

function renderFlags(flags) {
  el.reviewFlags.innerHTML = flags.map((f) => `
    <div class="flag lv-${esc(f.level)}">
      <div class="flag-top">
        <span class="flag-dim">${esc(f.dimension)}</span>
        <span class="flag-level">${esc(f.level)}</span>
        ${f.source === '词库' ? '<span class="flag-src" title="本地违禁词库命中：一定出现过，是否违规看语境">词库</span>' : ''}
      </div>
      <p class="flag-what">${esc(f.what)}</p>
      ${f.quote ? `<p class="flag-quote">「${esc(f.quote)}」${f.locatable ? '' : '<em>（原文里没精确匹配到，位置仅供参考）</em>'}</p>` : ''}
      <p class="flag-fix">建议：${esc(f.suggestion)}</p>
    </div>`).join('');
}

el.reviewList.addEventListener('click', (e) => {
  const apply = e.target.closest('button[data-apply]');
  const skip = e.target.closest('button[data-skip]');
  const row = e.target.closest('.issue');
  if (!row) return;
  if (apply) applyIssue(Number(apply.dataset.apply), row);
  else if (skip) row.classList.add('done');
});

el.reviewApplyAll.addEventListener('click', () => {
  const rows = [...el.reviewList.querySelectorAll('.issue:not(.done)')];
  let n = 0;
  for (const row of rows) if (applyIssue(Number(row.dataset.issue), row, true)) n++;
  renderContent();
  markDirty();
  toast(n ? `已采纳 ${n} 处` : '没有可采纳的修改');
  if (n) scheduleRecheck();
});

/* 采纳之后重新检测。
 *
 * 但**不是每采纳一条就查一次**——一条一条点的时候会连着发好几次请求，
 * 每次都是一次模型调用。所以攒 2.5 秒：停手了才查，中间再点就重新计时。
 * 期间先把结果标成"过期"，免得人对着一份已经不准的清单继续操作。 */
let recheckTimer = 0;

function scheduleRecheck() {
  clearTimeout(recheckTimer);
  el.reviewBox.classList.add('stale');
  el.reviewSummary.textContent = '正文已改，正在重新检测…';
  recheckTimer = setTimeout(async () => {
    try {
      await flushSave();        // 先落盘，否则查的还是旧正文
      await runReview({ silent: true });
    } finally {
      // 结果回来了才解封——请求还在飞的时候列表里还是旧数据
      el.reviewBox.classList.remove('stale');
    }
  }, 2500);
}

/* 只替换第一处：同一片段可能在文中出现多次，全替换风险太大 */
function applyIssue(index, row, batch = false) {
  const issue = state.review?.issues[index];
  if (!issue || !state.draft) return false;
  const raw = state.draft.content;
  if (!raw.includes(issue.quote)) {
    row.classList.add('done');
    if (!batch) toast('原文已经改过，这条对不上了');
    return false;
  }
  state.draft.content = raw.replace(issue.quote, issue.fix);
  row.classList.add('done');
  if (!batch) {
    renderContent();
    markDirty();
    toast('已采纳');
    scheduleRecheck();
  }
  return true;
}
