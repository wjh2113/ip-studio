/* 过渡期的桥：已经迁到 Vue 的部分，要调用还留在 public/js 里的函数时从这里拿。
 * public/js 的模块加载时把函数登记进来（legacy.setDraft = setDraft）。
 * 全部迁完后整个文件删掉——到那时不应该还有人 import 它。 */
export const legacy = {};

/* 调一个登记过的旧函数；还没登记（旧模块没加载完）就什么也不做 */
export function callLegacy(name, ...args) {
  const fn = legacy[name];
  return typeof fn === 'function' ? fn(...args) : undefined;
}
