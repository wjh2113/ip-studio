/* 前端 · compose：选了方向之后的流式成稿，以及「换了一篇稿子」时成稿区各块的重置。
 * 简报、方向、创作记录已经在 Vue 里（stores/brief.js、history.js），它们通过 lib/legacy.js 调到这里。 */
import { api, countChars, el, esc, goStep, markSteps, markdown, state, toast } from './core.js';
import { closeAssist, renderContent, setMode } from './editor.js';
import { runReview } from './review.js';
import { renderCues } from './speak.js';
import { renderIllusBar, renderMultiBar, renderVersionTabs, ver } from './versions.js';
import { readSSE } from '../../web/src/lib/api.js';
import { legacy } from '../../web/src/lib/legacy.js';
import { useHistoryStore } from '../../web/src/stores/history.js';

const loadHistory = () => useHistoryStore().load();

/* 换了一篇稿子（或回到空白简报，draft 为 null）：成稿区各块跟着换 */
legacy.draftChanged = (draft) => {
  el.revPane?.classList.add('hidden');
  el.revBtn?.classList.remove('on');
  el.reviewBox.classList.add('hidden');
  state.review = null;
  renderCues(null);
  ver.current = '';                    // 换稿子了，回到原文
  state.multiOpen = false;
  state.illusOpen = false;
  renderIllusBar();
  renderMultiBar();
  renderVersionTabs();
  if (draft?.content) {
    el.contentTitle.textContent = draft.title || '完整文案';
    setMode('read');
    renderContent();
  }
};

legacy.generate = (index) => generate(index);

/* ---------------- 第二步：流式成稿 ---------------- */
export async function generate(index) {
  const draft = state.draft;
  const topic = draft.topics[index];
  state.streaming = true;
  goStep(3);
  setMode('read');
  closeAssist();

  el.contentTitle.textContent = topic.title;
  el.content.innerHTML = '<span class="cursor"></span>';
  el.counter.textContent = '生成中…';

  let text = '';
  try {
    const res = await fetch(`/api/drafts/${draft.id}/content`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || '生成失败');

    await readSSE(res, (event, data) => {
      if (event === 'delta') {
        text += data.text;
        el.content.innerHTML = markdown(text) + '<span class="cursor"></span>';
        el.counter.textContent = `${countChars(text)} 字 · 生成中`;
      } else if (event === 'done') {
        state.draft = data.draft;
        renderContent();
        markSteps(3, true);      // 只更新步骤条状态；已经在第三步了，不用再切一次
        loadHistory();
        runReview();          // 出稿后自动过一遍错字和通顺性
      } else if (event === 'error') {
        throw new Error(data.message);
      }
    });
  } catch (err) {
    el.counter.textContent = '';
    el.content.innerHTML = `<p style="color:var(--danger)">生成中断：${esc(err.message)}</p>`
      + (text ? markdown(text) : '');
    // 服务端在失败时会把原来的稿子恢复回去（重新生成失败不会把已有的正文清掉）：取回来显示
    // 网络断开时服务端可能还没来得及恢复（它要先察觉连接断了）：看到还是 writing 就稍等再取
    try {
      let fresh;
      for (let i = 0; i < 5; i += 1) {
        ({ draft: fresh } = await api(`/drafts/${draft.id}`));
        if (fresh.status !== 'writing') break;
        await new Promise((r) => setTimeout(r, 400));
      }
      if (state.draft?.id === fresh.id && fresh.status !== 'writing') {
        state.draft = fresh;
        if (fresh.content) {
          el.contentTitle.textContent = fresh.title || '完整文案';
          renderContent();
          toast(`生成中断：${err.message}。原来那版还在`);
        }
        loadHistory();
      }
    } catch { /* 取不回来就停在错误提示上 */ }
  } finally {
    state.streaming = false;
  }
}
