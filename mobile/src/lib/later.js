/* 审稿「稍后」的卡：存在本机，今天页的待办里列出来，点进去回到那篇的审稿 */
const KEY = 'cw_later';

export function laterList() {
  try { return uni.getStorageSync(KEY) || []; } catch { return []; }
}

export function addLater(item) {
  const list = laterList().filter((x) => !(x.draftId === item.draftId && x.quote === item.quote));
  list.unshift({ ...item, at: new Date().toISOString() });
  uni.setStorageSync(KEY, list.slice(0, 50));
}

export function dropLater(draftId, quote) {
  uni.setStorageSync(KEY, laterList().filter((x) => !(x.draftId === draftId && (quote == null || x.quote === quote))));
}
