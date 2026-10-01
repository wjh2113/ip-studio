/* 网络不好时录好的口播先存本机，联网后在口播页「待上传」里补交 */
const KEY = 'cw_takes';

export function takes() {
  try { return uni.getStorageSync(KEY) || []; } catch { return []; }
}
export function keepTake(t) {
  uni.setStorageSync(KEY, [{ ...t, at: new Date().toISOString() }, ...takes()].slice(0, 10));
}
export function dropTake(path) {
  uni.setStorageSync(KEY, takes().filter((x) => x.path !== path));
}

/* App 里临时文件会被清：先存成持久文件 */
export function persistFile(path) {
  return new Promise((resolve) => {
    // #ifdef APP-PLUS || MP
    uni.saveFile({ tempFilePath: path, success: (r) => resolve(r.savedFilePath), fail: () => resolve(path) });
    // #endif
    // #ifdef H5
    resolve(path);
    // #endif
  });
}
