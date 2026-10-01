/* 多平台版本与图文配图。
 *
 * 多平台：一份账号设定、一篇成稿，出多个平台的版本。后端走的是「适配改写」而不是各平台各生成一遍——
 * 事实层不动，只重排结构和语气。勾平台 → 一个一个生成（失败就停）→ 版本之间切着看。
 * 原文和各平台版本平级放：发哪个平台哪个就是正文，没有「正本」这回事。
 *
 * 配图挂在版本上：公众号要配图，微博通常不需要，两边该插几张、插在哪也不一样，所以切版本 = 换一套配图。
 * 编辑、口播、检查这些始终针对原文，否则「改的是哪一版」会变成一笔糊涂账。 */
import { defineStore } from 'pinia';
import { computed, reactive, ref } from 'vue';
import { markAts, placeCuts } from '../../../shared/place.js';
import { api } from '../lib/api.js';
import { on } from '../lib/bus.js';
import { ask, toast } from '../lib/feedback.js';
import { esc, markdown } from '../lib/text.js';
import { useStudioStore } from './studio.js';
import { useJobsStore } from './jobs.js';

export const MAIN = '__main__';

/* 把插图插进正文。有 <此处放图片> 就占掉标记；没有标记才按 anchor 插在段末 */
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

export const imageUrl = (img) => `/image/${img.file}?v=${encodeURIComponent(img.at)}`;

export const useVersionsStore = defineStore('versions', () => {
  const current = ref('');                 // '' = 原文；否则是平台 key
  const verKey = computed(() => current.value || MAIN);

  const draft = () => useStudioStore().draft;
  const variants = computed(() => draft()?.variants || {});

  /* 当前在看的版本的正文 */
  const text = computed(() => (current.value ? variants.value[current.value]?.content : draft()?.content) || '');
  const label = computed(() => (current.value ? useStudioStore().platformLabel(current.value) : ''));

  /* 当前版本的配图 */
  const illus = computed(() => draft()?.illus?.[verKey.value] || null);
  const imageCount = computed(() => (illus.value?.items || []).filter((it) => it.image).length);

  /* 阅读区的 HTML：Markdown + 插图（图还没出的显示占位） */
  const html = computed(() => weave(text.value, illus.value?.items || [], markdown, (it) => {
    const name = it.alt || String(it.prompt || '').slice(0, 24);
    return it.image
      ? `<figure class="illus"><img src="${esc(imageUrl(it.image))}" alt="${esc(it.alt)}">${it.alt ? `<figcaption>${esc(it.alt)}</figcaption>` : ''}</figure>`
      : `<figure class="illus empty">第 ${(it.i ?? 0) + 1} 张还没出图${name ? ` · ${esc(name)}` : ''}</figure>`;
  }));

  /* 版本切换条：原文 + 已出的平台版本。正文在某个版本之后改过，那个版本标「需重做」 */
  const tabs = computed(() => {
    const d = draft();
    const keys = Object.keys(variants.value);
    if (!keys.length || !d?.content) return [];
    const s = useStudioStore();
    const nowChars = d.content.length;
    return [
      { key: '', label: `${s.platformLabel(d.platform)}（原文）`, chars: nowChars, stale: false },
      ...keys.map((k) => {
        const v = variants.value[k];
        return { key: k, label: s.platformLabel(k), chars: v.chars, stale: v.fromChars !== undefined && v.fromChars !== nowChars };
      }),
    ];
  });

  function switchTo(key) {
    current.value = key;
  }

  /* 换稿子了：回到原文，收起两条工具栏 */
  function reset() {
    current.value = '';
    multi.open = false;
    ill.open = false;
  }

  /* ---------- 多平台 ---------- */
  const multi = reactive({ open: false, picked: [], running: false, hint: '' });

  const multiOptions = computed(() => {
    const d = draft();
    if (!d) return [];
    // 账号自己的平台就是原文，不用再改一遍
    return (useStudioStore().meta?.platforms || []).filter((p) => p.key !== d.platform)
      .map((p) => ({ ...p, made: Boolean(variants.value[p.key]) }));
  });

  function openMulti() {
    const d = draft();
    if (!d?.content) { toast('先生成正文'); return; }
    // 没出过的默认勾上；出过的不勾（勾上就是重做）
    multi.picked = multiOptions.value.filter((p) => !p.made).map((p) => p.key);
    multi.hint = `原文是「${useStudioStore().platformLabel(d.platform)}」版本，事实层不会改，只重排结构和语气`;
    multi.open = true;
  }

  async function runMulti() {
    const s = useStudioStore();
    const picked = [...multi.picked];
    if (!picked.length) { toast('先勾几个平台'); return; }
    if (multi.running) return;
    multi.running = true;
    const draftId = s.draft.id;
    let done = 0;
    try {
      for (const key of picked) {
        if (s.draft?.id !== draftId) return;     // 换了稿子就停：剩下的别再花钱
        multi.hint = `正在改写「${s.platformLabel(key)}」…（${done + 1}/${picked.length}）`;
        try {
          // eslint-disable-next-line no-await-in-loop
          const { variant } = await api(`/drafts/${draftId}/variants`, { method: 'POST', body: { platform: key } });
          if (s.draft?.id !== draftId) return;
          s.draft.variants = { ...(s.draft.variants || {}), [key]: variant };
          done += 1;
        } catch (err) {
          // 一个一个来，失败就停——每次都是一次模型调用，不闷头烧
          multi.hint = `「${s.platformLabel(key)}」失败：${err.message}`;
          toast(`${s.platformLabel(key)} 失败，先停下了`);
          return;
        }
      }
      multi.picked = [];
      multi.hint = `好了，生成了 ${done} 个版本`;
      toast(`${done} 个平台版本已生成`);
    } finally {
      multi.running = false;
    }
  }

  /* ---------- 配图 ---------- */
  const ill = reactive({ open: false, info: null, planning: false, runningAll: false, hint: '', making: new Set() });

  const markCount = computed(() => markAts(text.value).length);

  /* 改过画面提示词的配图位（`版本:序号`）：出图时才把改过的带过去 */
  const edited = new Set();
  function editPrompt(i, prompt) {
    const item = illus.value?.items?.[i];
    if (!item || item.prompt === prompt) return;
    item.prompt = prompt;
    edited.add(`${verKey.value}:${i}`);
  }

  async function toggleIllus() {
    if (!text.value) { toast('这一版还没有正文'); return; }
    ill.open = !ill.open;
    if (!ill.open) return;
    ill.hint = '';
    try { ill.info = (await api('/images')).image; } catch { /* 通道信息拿不到不影响 */ }
    if (!illus.value) await planIllus();
  }

  async function planIllus() {
    const s = useStudioStore();
    if (ill.planning || !s.draft) return;
    const draft = s.draft;
    const key = verKey.value;
    ill.planning = true;
    try {
      const { illus: plan, image } = await api(`/drafts/${draft.id}/illus`, { method: 'POST', body: { version: current.value } });
      if (s.draft?.id !== draft.id) return;      // 排版位期间换了稿子
      s.draft.illus = { ...(s.draft.illus || {}), [key]: plan };
      if (image) ill.info = image;
    } catch (err) { toast(err.message); } finally { ill.planning = false; }
  }

  /* 这一张是不是正在出（自己刚点的，或者后台任务里还在跑的——刷新页面后也认得出来） */
  function imageRunning(i) {
    const s = useStudioStore();
    if (ill.making.has(`${verKey.value}:${i}`)) return true;
    return Boolean(useJobsStore().active('image',
      (p) => p.draftId === s.draft?.id && (p.version || '') === current.value && p.index === i));
  }

  /* 出图结果写回当前稿子（任务做完时稿子可能已经换了，对不上就不动） */
  function placeImage({ draftId, version, index, image }) {
    const s = useStudioStore();
    if (!image || s.draft?.id !== draftId) return false;
    const store = s.draft.illus?.[version || MAIN];
    if (!store?.items?.[index]) return false;
    store.items[index] = { ...store.items[index], image };
    return true;
  }

  async function makeIllus(i) {
    const s = useStudioStore();
    const jobs = useJobsStore();
    const draftId = s.draft.id;
    const version = current.value;
    const tag = `${version || MAIN}:${i}`;
    ill.making.add(tag);
    try {
      // 配图栏里改过画面提示词的，随请求带上，服务端存下来再出图；没改过就不带
      const item = s.draft.illus?.[version || MAIN]?.items?.[i];
      const body = item && edited.has(`${version || MAIN}:${i}`) ? { version, prompt: item.prompt } : { version };
      const { job } = await jobs.start(`/drafts/${draftId}/illus/${i}/image`, body);
      edited.delete(`${version || MAIN}:${i}`);
      const { image } = await jobs.wait(job);
      placeImage({ draftId, version, index: i, image });
      if (!ill.runningAll) ill.hint = '';       // 回到「N 张 · 已出 M」
      return true;
    } catch (err) {
      ill.hint = `第 ${i + 1} 张：${err.message}`;
      return false;
    } finally {
      ill.making.delete(tag);
    }
  }

  /* 一张一张来，失败就停——出图按张计费 */
  async function runAllIllus() {
    const todo = (illus.value?.items || []).filter((it) => !it.image);
    if (!todo.length) { toast('每张都出过了'); return; }
    if (ill.info?.live && !await ask.confirm({ title: `要出 ${todo.length} 张图`, body: '按张计费。', ok: '开始出图' })) return;
    if (ill.runningAll) return;
    ill.runningAll = true;
    try {
      for (const it of todo) {
        ill.hint = `正在出第 ${it.i + 1} 张…`;
        // eslint-disable-next-line no-await-in-loop
        if (!await makeIllus(it.i)) { toast(`第 ${it.i + 1} 张失败，先停下了`); return; }
      }
    } finally {
      ill.runningAll = false;
      if (/^正在出/.test(ill.hint)) ill.hint = '';
    }
  }

  // 刷新前发起、或者切走后才做完的出图：回来时补上
  on('job-done', (job) => {
    if (job.kind === 'image' && job.status === 'done') placeImage(job.result || {});
  });

  return {
    current, verKey, text, label, illus, imageCount, html, tabs, switchTo, reset,
    multi, multiOptions, openMulti, runMulti,
    ill, markCount, editPrompt, toggleIllus, planIllus, imageRunning, makeIllus, runAllIllus,
  };
});
