/* 前端 · compose：第二步流式成稿、创作记录列表。从原 app.js 原样拆出。 */
import { api, busy, countChars, currentPersona, el, esc, goStep, markSteps, markdown, state, toast } from './core.js';
import { renderPersonaBar } from './account.js';
import { renderTopics, setDraft } from './brief.js';
import { closeAssist, renderContent, setMode } from './editor.js';
import { runReview } from './review.js';
import { loadDraftSpeaks, loadSpeakHistory, onSpeakCheck, openSpeakRecord } from './speak.js';

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
  el.contentCard.classList.remove('hidden');
  el.contentCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  el.topics.querySelectorAll('button').forEach((b) => { b.disabled = true; });

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
  } finally {
    state.streaming = false;
    el.topics.querySelectorAll('button').forEach((b) => { b.disabled = false; });
    renderTopics(state.draft);
  }
}

export async function readSSE(res, onEvent) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const blocks = buf.split('\n\n');
    buf = blocks.pop() || '';
    for (const block of blocks) {
      let event = 'message';
      let data = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (data) onEvent(event, JSON.parse(data));
    }
  }
}

/* ---------------- 历史 ---------------- */
export async function loadHistory() {
  if (state.historyMode === 'speaks') return loadSpeakHistory();
  try {
    const q = new URLSearchParams();
    if (state.personaId !== null) q.set('persona_id', state.personaId);
    if (state.showArchived) q.set('archived', '1');
    const { drafts, counts } = await api(`/drafts${q.toString() ? `?${q}` : ''}`);
    state.list = drafts;
    state.counts = counts;
    renderHistory();
    api('/speaks').then(({ speaks }) => {
      if (el.cntSpeaks) el.cntSpeaks.textContent = speaks.length || '';
    }).catch(() => {});
  } catch { /* 未登录或网络异常时静默 */ }
}

el.historyFilter.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn || state.streaming) return;
  state.historyMode = btn.dataset.view === 'speaks' ? 'speaks' : 'drafts';
  if (state.historyMode === 'drafts') state.showArchived = btn.dataset.arch === '1';
  [...el.historyFilter.children].forEach((b) => b.classList.toggle('on', b === btn));
  loadHistory();
});

el.archiveDoneBtn.addEventListener('click', async () => {
  const n = state.counts.activeDone;
  if (!n) return;
  if (!await ask.confirm({ title: `把 ${n} 篇已完成的创作收进归档？`, body: '随时可以在「已归档」里恢复。', ok: '归档' })) return;
  await busy(el.archiveDoneBtn, async () => {
    try {
      const { archived } = await api('/drafts/archive-done', {
        method: 'POST',
        body: { persona_id: state.personaId === null ? '' : state.personaId },
      });
      toast(`已归档 ${archived} 篇`);
      loadHistory();
    } catch (err) { toast(err.message); }
  });
});

export function renderHistory() {
  if (state.historyMode === 'speaks') {
    loadSpeakHistory();
    return;
  }
  const list = state.list || [];
  el.cntActive.textContent = state.counts.active || '';
  el.cntArchived.textContent = state.counts.archived || '';
  el.historyFoot.classList.toggle('hidden', state.showArchived || !state.counts.activeDone);
  el.archiveDoneBtn.textContent = `把 ${state.counts.activeDone} 篇已完成的收起来`;

  if (!list.length) {
    const p = currentPersona();
    el.history.innerHTML = state.showArchived
      ? '<div class="empty">归档里还是空的<br />在「进行中」把不再需要的收起来</div>'
      : `<div class="empty">${p ? `「${esc(p.name)}」还没有创作记录` : '还没有创作记录'}<br />从右边填写题材开始</div>`;
    return;
  }
  const STATUS = { topics: '待选方向', writing: '生成中', done: '已完成' };
  const showTag = state.personaId === null;
  el.history.innerHTML = list.map((d) => {
    const owner = state.personas.find((p) => p.id === d.persona_id);
    const tag = showTag ? `<span class="persona-tag">${esc(owner ? owner.name : '无账号')}</span>` : '';
    return `
    <div class="history-item ${state.draft?.id === d.id ? 'active' : ''} ${d.archived_at ? 'archived' : ''}" data-id="${d.id}">
      <div class="acts">
        <button data-arch-id="${d.id}" data-to="${d.archived_at ? '0' : '1'}"
          title="${d.archived_at ? '恢复到进行中' : '归档'}">${d.archived_at ? '↩' : '📥'}</button>
        <button class="del" data-del="${d.id}" title="删除">×</button>
      </div>
      <h4>${esc(d.title || d.subject)}</h4>
      <p>${tag}<span>${esc(platformLabel(d.platform))}</span><span>·</span><span>${STATUS[d.status] || d.status}</span></p>
    </div>`;
  }).join('');
}

el.history.addEventListener('click', async (e) => {
  if (await onSpeakCheck(e)) return;
  const speakDel = e.target.closest('button[data-speak-del]');
  if (speakDel) {
    e.stopPropagation();
    const id = Number(speakDel.dataset.speakDel);
    if (!await ask.confirm({ title: '删除这一遍口播记录？', body: '录音和总评会一起去掉。', ok: '删除', danger: true })) return;
    try {
      await api(`/speaks/${id}`, { method: 'DELETE' });
      if (state.focusSpeakId === id) state.focusSpeakId = null;
      toast('已删除这遍口播');
      loadHistory();
      if (state.mode === 'cue') loadDraftSpeaks();
    } catch (err) { toast(err.message); }
    return;
  }

  const speakItem = e.target.closest('.history-item[data-speak]');
  if (speakItem) {
    if (state.streaming) return;
    await openSpeakRecord(Number(speakItem.dataset.speak));
    return;
  }

  const arch = e.target.closest('button[data-arch-id]');
  if (arch) {
    e.stopPropagation();
    try {
      await api(`/drafts/${arch.dataset.archId}/archive`, {
        method: 'POST', body: { archived: arch.dataset.to === '1' },
      });
      toast(arch.dataset.to === '1' ? '已归档' : '已恢复');
      loadHistory();
    } catch (err) { toast(err.message); }
    return;
  }

  const del = e.target.closest('button[data-del]');
  if (del) {
    e.stopPropagation();
    const id = Number(del.dataset.del);
    if (!await ask.confirm({ title: '删除这条创作记录？', ok: '删除', danger: true })) return;
    await api(`/drafts/${id}`, { method: 'DELETE' });
    if (state.draft?.id === id) el.newBtn.click();
    loadHistory();
    return;
  }
  const item = e.target.closest('.history-item');
  if (!item || state.streaming) return;
  const { draft } = await api(`/drafts/${item.dataset.id}`);
  if (draft.persona_id && draft.persona_id !== state.personaId
      && state.personas.some((p) => p.id === draft.persona_id)) {
    state.personaId = draft.persona_id;
    renderPersonaBar();
    loadHistory();
  }
  setDraft(draft);
});

export const platformLabel = (key) =>
  state.meta?.platforms.find((p) => p.key === key)?.label || key;
