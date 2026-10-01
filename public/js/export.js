/* 前端 · export：复制 / 下载 / 导出。从原 app.js 原样拆出。 */
import { busy, el, esc, markdown, state, toast } from './core.js';
import { useStudioStore } from '../../web/src/stores/studio.js';
import { illOf, ver, weave } from './versions.js';

/* ---------------- 复制 / 下载 ---------------- */
/* 复制和下载都要跟着**当前正在看的版本**走。
   切到微博版却复制出公众号原文，这个功能最后一步就废了。 */
/* 复制/下载按钮的文案。要在三个时机都刷：切版本、首次渲染正文、出完图之后——
   出了图按钮还写着"下载 .md"，人就不知道图会不会带上。 */
export function updateActionLabels() {
  const other = Boolean(ver.current);
  const hasImg = (illOf()?.items || []).some((it) => it.image);
  el.copyBtn.textContent = other ? `复制${currentLabel()}版` : '复制';
  el.downloadBtn.textContent = `${other ? `下载${currentLabel()}版` : '下载'}${hasImg ? '图文' : ' .md'}`;
  el.copyBtn.title = hasImg ? '正文 + 配图一起复制（富文本）' : '复制正文';
  if (el.copyHint) {
    el.copyHint.textContent = `${other ? `${currentLabel()}版` : '正文'}${
      hasImg ? '；连图一起（富文本）' : ''}`;
  }
}

export function currentText() {
  return (ver.current ? state.draft?.variants?.[ver.current]?.content : state.draft?.content) || '';
}

export const currentLabel = () => (ver.current ? useStudioStore().platformLabel(ver.current) : '');

/* 把图读成 data URI。
   剪贴板里放图片链接是没用的——指向 localhost 且要登录态，
   粘到公众号编辑器那边取不到。只有把字节本身塞进去才带得走。 */
async function inlineImages(items) {
  const out = new Map();
  await Promise.all(items.filter((it) => it.image).map(async (it) => {
    try {
      const res = await fetch(`/image/${it.image.file}?v=${encodeURIComponent(it.image.at)}`);
      if (!res.ok) return;
      const blob = await res.blob();
      const uri = await new Promise((ok, no) => {
        const r = new FileReader();
        r.onload = () => ok(r.result);
        r.onerror = no;
        r.readAsDataURL(blob);
      });
      out.set(it.i, uri);
    } catch { /* 单张读不到就跳过，别让整次复制失败 */ }
  }));
  return out;
}

/* 带图的富文本。和阅读区用的是同一套插图逻辑，只是图换成了 data URI */
async function richHtml(text) {
  const items = illOf()?.items || [];
  const uris = await inlineImages(items);
  const html = weave(text, items, markdown, (it) => {
    const uri = uris.get(it.i);
    if (!uri) return '';
    return `<figure style="margin:22px 0"><img src="${uri}" alt="${esc(it.alt)}" style="max-width:100%">`
      + (it.alt ? `<figcaption style="font-size:13px;color:#888;text-align:center;margin-top:6px">${esc(it.alt)}</figcaption>` : '')
      + '</figure>';
  });
  return { html, imgs: uris.size };
}

el.copyBtn.addEventListener('click', () => busy(el.copyBtn, async () => {
  const text = currentText();
  if (!text) return;
  const label = ver.current ? `「${currentLabel()}」版本` : '';
  try {
    const { html, imgs } = await richHtml(text);
    if (imgs && window.ClipboardItem) {
      // 同时写两种格式：富文本编辑器取 HTML（带图），纯文本处取 markdown
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      })]);
      toast(`已复制${label}，带 ${imgs} 张图`);
      return;
    }
    await navigator.clipboard.writeText(text);
    toast(imgs ? `已复制${label}（这个浏览器带不了图，用「下载图文包」）` : `已复制${label || '到剪贴板'}`);
  } catch {
    toast('复制失败，请手动选中文本');
  }
}));

let forceFormat = '';        // 菜单里明确选的格式；空 = 按有没有图自动决定

export const downloadAs = (fmt) => { forceFormat = fmt; el.downloadBtn.click(); };

el.downloadBtn.addEventListener('click', () => busy(el.downloadBtn, async () => {
  const d = state.draft;
  const text = currentText();
  if (!text) return;
  const base = (d.title || d.subject).slice(0, 40).replace(/[\\/:*?"<>|]/g, '')
    + (ver.current ? `-${currentLabel()}` : '');

  const want = forceFormat; forceFormat = '';
  const got = want === 'md' ? false : (want === 'html' || (illOf()?.items || []).some((it) => it.image));
  // 有图就存成自包含的 .html——图嵌在文件里，浏览器打开全选复制，
  // 任何富文本编辑器都能接。存 .md 等于把图丢了。
  const { html, imgs } = got ? await richHtml(text) : { html: '', imgs: 0 };
  // 明确点了「下载图文」但一张图都没出，也照样给 html——用户选的是格式，不是条件

  const [body, mime, ext] = (imgs || want === 'html')
    ? [`<!doctype html><meta charset="utf-8"><title>${esc(base)}</title>`
      + '<body style="max-width:720px;margin:40px auto;padding:0 20px;'
      + 'font:16px/1.8 -apple-system,\'PingFang SC\',sans-serif;color:#1a1a1a">'
      + html, 'text/html;charset=utf-8', 'html']
    : [text, 'text/markdown;charset=utf-8', 'md'];

  const url = URL.createObjectURL(new Blob([body], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${base}.${ext}`;      // 文件名带平台，几个版本一起下载才分得清
  a.click();
  URL.revokeObjectURL(url);
  if (imgs) toast(`已下载，含 ${imgs} 张图（浏览器打开后全选复制即可粘进编辑器）`);
}));
