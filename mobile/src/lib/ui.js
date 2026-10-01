/* 交互小工具：提示、确认、操作菜单、跳转。把 uni 的回调式 API 包成 Promise */

export function toast(title, icon = 'none') {
  uni.showToast({ title: String(title || '').slice(0, 40), icon, duration: 2000 });
}

export function confirm({ title = '', content = '', ok = '确定', cancel = '取消', danger = false } = {}) {
  return new Promise((resolve) => {
    uni.showModal({
      title, content, confirmText: ok, cancelText: cancel,
      confirmColor: danger ? '#e5484d' : '#2f6bff',
      success: (r) => resolve(Boolean(r.confirm)),
      fail: () => resolve(false),
    });
  });
}

/* 返回选中的下标，取消返回 -1 */
export function sheet(items) {
  return new Promise((resolve) => {
    uni.showActionSheet({ itemList: items, success: (r) => resolve(r.tapIndex), fail: () => resolve(-1) });
  });
}

const query = (q) => {
  const s = Object.entries(q || {}).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return s ? `?${s}` : '';
};

export const go = (path, q) => uni.navigateTo({ url: `/pages/${path}${query(q)}` });
export const swap = (path, q) => uni.redirectTo({ url: `/pages/${path}${query(q)}` });
export const tab = (name) => uni.switchTab({ url: `/pages/${name}/index` });
export const back = (fallback = 'today') => {
  if (getCurrentPages().length > 1) uni.navigateBack();
  else tab(fallback);
};

export function copy(text, tip = '已复制') {
  return new Promise((resolve) => {
    uni.setClipboardData({
      data: String(text || ''),
      showToast: false,
      success: () => { toast(tip, 'success'); resolve(true); },
      fail: () => { toast('复制失败'); resolve(false); },
    });
  });
}
