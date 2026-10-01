/* 带登录态的图片。服务端的配图要登录才能看：H5 同源有 cookie，直接用地址；
 * App / 小程序的 <image> 发不了 Authorization 头，先带头下载成本地临时文件再显示。 */
import { assetUrl, token } from './api.js';

const cache = new Map();

export function authedImage(path) {
  if (!path) return Promise.resolve('');
  const full = assetUrl(path);
  // #ifdef H5
  return Promise.resolve(full);
  // #endif
  // #ifndef H5
  if (cache.has(full)) return cache.get(full);
  const p = new Promise((resolve) => {
    uni.downloadFile({
      url: full,
      header: { Authorization: `Bearer ${token.get()}`, 'X-Client': 'app' },
      success: (r) => resolve(r.statusCode === 200 ? r.tempFilePath : ''),
      fail: () => resolve(''),
    });
  });
  cache.set(full, p);
  p.then((v) => { if (!v) cache.delete(full); });
  return p;
  // #endif
}

/* 存到相册：先拿到本地文件，再申请权限保存。权限被拒时返回 'denied'，页面画引导 */
export async function saveToAlbum(path) {
  const local = await localFile(path);
  if (!local) return 'failed';
  return new Promise((resolve) => {
    // #ifdef H5
    // 浏览器没有相册：退化成下载
    const a = document.createElement('a');
    a.href = local;
    a.download = `配图-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    resolve('ok');
    // #endif
    // #ifndef H5
    uni.saveImageToPhotosAlbum({
      filePath: local,
      success: () => resolve('ok'),
      fail: (e) => resolve(/auth|denied|permission/i.test(e?.errMsg || '') ? 'denied' : 'failed'),
    });
    // #endif
  });
}

async function localFile(path) {
  // #ifdef H5
  return assetUrl(path);
  // #endif
  // #ifndef H5
  return authedImage(path);
  // #endif
}

/* 打开系统设置页，让用户手动开相册权限 */
export function openSettings() {
  // #ifdef APP-PLUS
  if (uni.getSystemInfoSync().platform === 'ios') plus.runtime.openURL('app-settings:');
  else {
    const main = plus.android.runtimeMainActivity();
    const Intent = plus.android.importClass('android.content.Intent');
    const Settings = plus.android.importClass('android.provider.Settings');
    const Uri = plus.android.importClass('android.net.Uri');
    const intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
    intent.setData(Uri.fromParts('package', main.getPackageName(), null));
    main.startActivity(intent);
  }
  // #endif
  // #ifdef MP
  uni.openSetting();
  // #endif
}
