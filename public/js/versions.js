/* 前端 · versions：多平台版本与图文配图。从原 app.js 原样拆出。 */
import { markAts, placeCuts } from '../place.js';
import { api, busy, el, esc, markdown, state, toast } from './core.js';
import { platformLabel } from './compose.js';
import { currentText, updateActionLabels } from './export.js';
import { activeJob, startJob, waitJob } from './jobs.js';

/* ==================================================================
 * 多平台版本
 *
 * 一份账号设定、一篇成稿，出多个平台的版本。
 * 后端走的是"适配改写"而不是各平台各生成一遍——事实层不动，只重排结构和语气。
 * 前端这边：勾平台 → 一个一个生成（失败就停）→ 版本之间切着看。
 * ================================================================== */

export const ver = { current: '' };          // '' = 原文；否则是平台 key

el.multiBtn.addEventListener('click', () => {
  if (!state.draft?.content) { toast('先生成正文'); return; }
  state.multiOpen = !state.multiOpen;
  renderMultiBar();
});

export function renderMultiBar() {
  const open = Boolean(state.multiOpen && state.draft?.content);
  el.multiBar.classList.toggle('hidden', !open);
  if (!open) return;

  const own = state.draft.platform;
  const made = state.draft.variants || {};
  el.multiPick.innerHTML = (state.meta?.platforms || [])
    .filter((p) => p.key !== own)     // 账号自己的平台就是原文，不用再改一遍
    .map((p) => {
      const got = made[p.key];
      return `<label class="${got ? 'done' : ''}">
        <input type="checkbox" value="${esc(p.key)}"${got ? '' : ' checked'}>
        ${esc(p.label)}<em>${got ? '已生成 · 勾上重做' : `${p.length}字`}</em>
      </label>`;
    }).join('');
  el.multiHint.textContent = `原文是「${platformLabel(own)}」版本，事实层不会改，只重排结构和语气`;
}

el.multiRunBtn.addEventListener('click', async () => {
  const picked = [...el.multiPick.querySelectorAll('input:checked')].map((i) => i.value);
  if (!picked.length) { toast('先勾几个平台'); return; }

  await busy(el.multiRunBtn, async () => {
    let done = 0;
    for (const key of picked) {
      el.multiHint.textContent = `正在改写「${platformLabel(key)}」…（${done + 1}/${picked.length}）`;
      try {
        // eslint-disable-next-line no-await-in-loop
        const { variant } = await api(`/drafts/${state.draft.id}/variants`,
          { method: 'POST', body: { platform: key } });
        state.draft.variants = { ...(state.draft.variants || {}), [key]: variant };
        done += 1;
        renderVersionTabs();
      } catch (err) {
        // 一个一个来，失败就停——每次都是一次模型调用，不闷头烧
        el.multiHint.textContent = `「${platformLabel(key)}」失败：${err.message}`;
        toast(`${platformLabel(key)} 失败，先停下了`);
        return;
      }
    }
    renderMultiBar();
    renderVersionTabs();
    el.multiHint.textContent = `好了，生成了 ${done} 个版本`;
    toast(`${done} 个平台版本已生成`);
  });
});

/* 版本切换条。原文和各平台版本平级放，不做主次之分——
   发哪个平台哪个就是正文，没有"正本"这回事。 */
export function renderVersionTabs() {
  const made = state.draft?.variants || {};
  const keys = Object.keys(made);
  el.verTabs.classList.toggle('hidden', !keys.length || !state.draft?.content);
  if (!keys.length) { ver.current = ''; return; }

  const own = state.draft.platform;
  const nowChars = (state.draft.content || '').length;
  const tab = (key, label, chars, stale) => `<button data-ver="${esc(key)}"
    class="${ver.current === key ? 'on' : ''}${stale ? ' stale' : ''}"
    ${stale ? 'title="正文在这一版之后改过，内容可能对不上了——重做一次"' : ''}>${esc(label)}<i>${
  stale ? '需重做' : `${chars}字`}</i></button>`;

  el.verTabs.innerHTML = tab('', `${platformLabel(own)}（原文）`, nowChars, false)
    + keys.map((k) => tab(k, platformLabel(k), made[k].chars,
      // 改写时依据的正文长度和现在对不上，说明正文后来被编辑过
      made[k].fromChars !== undefined && made[k].fromChars !== nowChars)).join('');
}

el.verTabs.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-ver]');
  if (!b) return;
  ver.current = b.dataset.ver;
  renderVersionTabs();
  renderIllusBar();          // 配图是挂在版本上的，切版本就换一套
  showVersion();
});

/* 切版本只换阅读区的内容——编辑、口播那些始终针对原文，
   否则"编辑的是哪一版"会变成一笔糊涂账 */
export function showVersion() {
  const made = state.draft?.variants || {};
  const text = ver.current ? made[ver.current]?.content : state.draft?.content;
  el.content.innerHTML = withIllus(text || '');
  el.counter.textContent = `${(text || '').length} 字`;
  const other = Boolean(ver.current);
  updateActionLabels();
  // 检查/学习/多平台都以原文为准；看别的版本时禁掉，别让人以为在对当前这版操作。
  // 配图是按版本来的，所以不禁。
  [el.reviewBtn, el.learnBtn, el.multiBtn].forEach((b) => { b.disabled = other; });
  el.multiBtn.title = other ? '多平台版本从原文改写，先切回原文' : '把这篇改成其它平台的版本';
  el.cuesPane?.classList.toggle('hidden', other || state.mode !== 'cue');
}

/* ==================================================================
 * 图文配图
 *
 * 配图挂在**版本**上：公众号要配图，微博通常不需要，
 * 两边该插几张、插在哪也不一样。所以切版本 = 换一套配图。
 * ================================================================== */

const ill = { info: null };

const verOf = () => (ver.current || '__main__');

export const illOf = () => state.draft?.illus?.[verOf()] || null;

el.illusBtn.addEventListener('click', async () => {
  const text = ver.current ? state.draft?.variants?.[ver.current]?.content : state.draft?.content;
  if (!text) { toast('这一版还没有正文'); return; }
  state.illusOpen = !state.illusOpen;
  if (!state.illusOpen) { renderIllusBar(); showVersion(); return; }
  try { ill.info = (await api('/images')).image; } catch { /* 通道信息拿不到不影响 */ }
  if (!illOf()) await planIllus();
  else renderIllusBar();
});

async function planIllus() {
  await busy(el.illusPlanBtn, async () => {
    try {
      const { illus, image } = await api(`/drafts/${state.draft.id}/illus`,
        { method: 'POST', body: { version: ver.current } });
      state.draft.illus = { ...(state.draft.illus || {}), [verOf()]: illus };
      if (image) ill.info = image;
      renderIllusBar();
      showVersion();
    } catch (err) { toast(err.message); }
  });
}

el.illusPlanBtn.addEventListener('click', planIllus);

export function renderIllusBar() {
  const open = Boolean(state.illusOpen);
  el.illusBar.classList.toggle('hidden', !open);
  const marks = markAts(currentText()).length;
  el.illusPlanBtn.textContent = marks ? `按 ${Math.min(marks, 8)} 处指定位置排版` : '重新排版位';
  if (!open) return;
  const store = illOf();
  el.illusChip.textContent = ill.info?.label || '';
  el.illusChip.classList.toggle('warn', ill.info && !ill.info.live);
  if (!store) { el.illusHint.textContent = '正在排版位…'; el.illusList.innerHTML = ''; return; }

  const done = store.items.filter((i) => i.image).length;
  el.illusHint.textContent = `${store.items.length} 张 · 已出 ${done}`
    + (store.capped ? ` · 模型给了 ${store.capped.asked} 个位置，按字数砍到 ${store.capped.cap}` : '')
    + (store.look ? ` · ${store.look}` : '');

  el.illusList.innerHTML = store.items.map((it) => `
    <div class="illus-row">
      ${it.image
    ? `<img src="/image/${esc(it.image.file)}?v=${encodeURIComponent(it.image.at)}" alt="">`
    : '<div class="ph">未出图</div>'}
      <div class="body">
        <div class="where">插在「${esc(it.anchor.slice(0, 16))}…」之后${it.alt ? ` · 图注：${esc(it.alt)}` : ''}</div>
        <textarea data-ill="${it.i}" rows="2">${esc(it.prompt)}</textarea>
      </div>
      ${imageRunning(it.i)
    ? `<button class="mini" data-illimg="${it.i}" disabled>出图中…</button>`
    : `<button class="mini" data-illimg="${it.i}">${it.image ? '重出' : '出这张'}</button>`}
    </div>`).join('');
}

el.illusList.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-illimg]');
  if (b) makeIllus(Number(b.dataset.illimg), b);
});

/* 改提示词只存在本地，等点出图时才带过去——避免每敲一下就打一次接口 */
el.illusList.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.ill === undefined) return;
  const store = illOf();
  if (store) store.items[Number(t.dataset.ill)].prompt = t.value;
});

/* 这一张是不是正在后台出 */
const imageRunning = (i) => Boolean(activeJob('image',
  (p) => p.draftId === state.draft?.id && (p.version || '') === ver.current && p.index === i));

/* 出图结果写回当前稿子（任务做完时稿子可能已经换了，对不上就不动） */
function placeImage({ draftId, version, index, image }) {
  if (!image || state.draft?.id !== draftId) return false;
  const store = state.draft.illus?.[version || '__main__'];
  if (!store?.items?.[index]) return false;
  store.items[index] = { ...store.items[index], image };
  if ((version || '') === ver.current) {
    renderIllusBar();
    showVersion();
    updateActionLabels();
  }
  return true;
}

async function makeIllus(i, btn) {
  const label = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = '出图中…'; }
  try {
    const draftId = state.draft.id;
    const version = ver.current;
    const { job } = await startJob(`/drafts/${draftId}/illus/${i}/image`, { version });
    renderIllusBar();
    const { image } = await waitJob(job);
    placeImage({ draftId, version, index: i, image });
    renderIllusBar();
    showVersion();
    updateActionLabels();
    return true;
  } catch (err) {
    el.illusHint.textContent = `第 ${i + 1} 张：${err.message}`;
    return false;
  } finally {
    if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = label; }
  }
}

/* 一张一张来，失败就停——出图按张计费 */
el.illusRunBtn.addEventListener('click', async () => {
  const store = illOf();
  const todo = (store?.items || []).filter((i) => !i.image);
  if (!todo.length) { toast('每张都出过了'); return; }
  if (ill.info?.live && !await ask.confirm({ title: `要出 ${todo.length} 张图`, body: '按张计费。', ok: '开始出图' })) return;
  await busy(el.illusRunBtn, async () => {
    for (const it of todo) {
      el.illusHint.textContent = `正在出第 ${it.i + 1} 张…`;
      // eslint-disable-next-line no-await-in-loop
      if (!await makeIllus(it.i, null)) { toast(`第 ${it.i + 1} 张失败，先停下了`); return; }
    }
    renderIllusBar();
  });
});

export function weave(text, items, renderText, figFor) {
  const cuts = placeCuts(text, items);
  if (!cuts.length) return renderText(text);
  let out = '';
  let from = 0;
  for (const c of cuts) {
    out += renderText(text.slice(from, c.at)) + figFor(c.item);
    from = c.at + (c.skip || 0);
  }
  return out + renderText(text.slice(from));
}

/* 把插图插进正文。有 <此处放图片> 就占掉标记；没有标记才按 anchor 插在段末。 */
export function withIllus(text) {
  const items = illOf()?.items || [];
  return weave(text, items, markdown, (it) => {
    const label = it.alt || String(it.prompt || '').slice(0, 24);
    return it.image
      ? `<figure class="illus"><img src="/image/${esc(it.image.file)}?v=${encodeURIComponent(it.image.at)}" alt="${esc(it.alt)}">${
        it.alt ? `<figcaption>${esc(it.alt)}</figcaption>` : ''}</figure>`
      : `<figure class="illus empty">第 ${(it.i ?? 0) + 1} 张还没出图${label ? ` · ${esc(label)}` : ''}</figure>`;
  });
}

/* 吸顶状态：贴到顶了才给分隔线和投影，没贴住时保持干净。
   用 IntersectionObserver 而不是 scroll 事件——后者每帧都要算，这里只需要知道"越界了没有"。 */
if (el.headStick) {
  const sentinel = document.createElement('div');
  sentinel.style.cssText = 'position:absolute;top:0;height:1px;width:1px;pointer-events:none';
  el.headStick.parentElement.style.position = 'relative';
  el.headStick.parentElement.prepend(sentinel);
  new IntersectionObserver(([e]) => {
    el.headStick.classList.toggle('stuck', !e.isIntersecting);
  }, {
    // 和 CSS 里的 --topbar-h 保持一致，别在两个地方各写一个数
    rootMargin: `-${getComputedStyle(document.documentElement).getPropertyValue('--topbar-h').trim() || '66px'} 0px 0px 0px`,
    threshold: 0,
  }).observe(sentinel);
}

/* 刷新前发起、或者切走后才做完的出图：回来时补上 */
window.addEventListener('cw-job-done', (e) => {
  const job = e.detail;
  if (job.kind !== 'image') return;
  if (job.status === 'done') placeImage(job.result || {});
  else if (state.illusOpen) renderIllusBar();
});
