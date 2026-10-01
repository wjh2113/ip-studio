/* 网络：所有 /api 请求都从这里走。
 *
 * App 里没有浏览器 cookie 那一套，登录换一个 token（请求头 X-Client: app），之后每次带 Authorization: Bearer。
 * H5 调试时 cookie 和 token 都会带上，服务端两样都认。
 *   api(path, { method, body })     JSON 进、JSON 出；失败抛 ApiError（message 是服务端给的中文文案）
 *   streamAll(path, body)           成稿这类 SSE 接口：等整个流结束，按事件返回（手机端不逐字显示，省电也省事）
 *   uploadBytes(path, filePath, …)  录音、视频原样上传（服务端按 Content-Type / X-Filename 认格式） */
import { API_BASE } from '../config.js';

const TOKEN_KEY = 'cw_token';

export const token = {
  get: () => uni.getStorageSync(TOKEN_KEY) || '',
  set: (t) => uni.setStorageSync(TOKEN_KEY, t || ''),
  clear: () => uni.removeStorageSync(TOKEN_KEY),
};

export class ApiError extends Error {
  constructor(message, status = 0, data = null) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export const url = (path) => `${API_BASE}${path}`;

function headers(extra = {}) {
  const t = token.get();
  return { 'X-Client': 'app', ...(t ? { Authorization: `Bearer ${t}` } : {}), ...extra };
}

/* 401 统一处理：清掉 token，回登录页。由 App.vue 监听 */
function onFail(status, data) {
  if (status === 401) {
    token.clear();
    uni.$emit('auth-expired');
  }
  if (status === 402) uni.$emit('quota', { message: data?.error, quota: data?.quota });
  return new ApiError(data?.error || `请求失败（${status}）`, status, data);
}

export function api(path, { method = 'GET', body, timeout = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    uni.request({
      url: url(`/api${path}`),
      method,
      data: body,
      timeout,
      header: headers(body ? { 'Content-Type': 'application/json' } : {}),
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          if (method !== 'GET') uni.$emit('spent');
          resolve(res.data || {});
        } else {
          reject(onFail(res.statusCode, res.data));
        }
      },
      fail: () => reject(new ApiError('网络不通，稍后再试', 0)),
    });
  });
}

/* 解析一整段 SSE 文本 → [{ event, data }] */
export function parseSSE(text) {
  const out = [];
  for (const block of String(text || '').split('\n\n')) {
    let event = 'message';
    let data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (!data) continue;
    try { out.push({ event, data: JSON.parse(data) }); } catch { /* 半截的块不要 */ }
  }
  return out;
}

export function streamAll(path, body) {
  return new Promise((resolve, reject) => {
    uni.request({
      url: url(`/api${path}`),
      method: 'POST',
      data: JSON.stringify(body || {}),
      dataType: 'text',
      responseType: 'text',
      timeout: 180000,
      header: headers({ 'Content-Type': 'application/json' }),
      success: (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          let data = null;
          try { data = JSON.parse(res.data); } catch { /* 不是 JSON 就用状态码说话 */ }
          reject(onFail(res.statusCode, data));
          return;
        }
        const events = parseSSE(res.data);
        const err = events.find((e) => e.event === 'error');
        if (err) { reject(new ApiError(err.data?.message || '生成中断', 500)); return; }
        uni.$emit('spent');
        resolve(events);
      },
      fail: () => reject(new ApiError('网络不通，稍后再试', 0)),
    });
  });
}

/* 读本地文件成 ArrayBuffer：H5 是 blob: 地址，App 走 plus.io */
export function readBytes(filePath) {
  // #ifdef H5
  return fetch(filePath).then((r) => r.arrayBuffer());
  // #endif
  // #ifndef H5
  return new Promise((resolve, reject) => {
    // #ifdef APP-PLUS
    plus.io.resolveLocalFileSystemURL(filePath, (entry) => {
      entry.file((file) => {
        const reader = new plus.io.FileReader();
        reader.onloadend = (e) => {
          const b64 = String(e.target.result || '').split(',')[1] || '';
          resolve(uni.base64ToArrayBuffer(b64));
        };
        reader.onerror = () => reject(new ApiError('读不到录好的文件', 0));
        reader.readAsDataURL(file);
      }, () => reject(new ApiError('读不到录好的文件', 0)));
    }, () => reject(new ApiError('读不到录好的文件', 0)));
    // #endif
    // #ifdef MP
    uni.getFileSystemManager().readFile({ filePath, success: (r) => resolve(r.data), fail: () => reject(new ApiError('读不到录好的文件', 0)) });
    // #endif
  });
  // #endif
}

/* 二进制原样上传。文件名做 URL 编码：中文放进请求头会出错 */
export async function uploadBytes(path, filePath, { type = 'application/octet-stream', filename = 'upload.bin' } = {}) {
  const bytes = await readBytes(filePath);
  return new Promise((resolve, reject) => {
    uni.request({
      url: url(`/api${path}`),
      method: 'POST',
      data: bytes,
      timeout: 300000,
      header: headers({ 'Content-Type': type, 'X-Filename': encodeURIComponent(filename) }),
      success: (res) => {
        let data = res.data;
        if (typeof data === 'string') { try { data = JSON.parse(data); } catch { data = {}; } }
        if (res.statusCode >= 200 && res.statusCode < 300) { uni.$emit('spent'); resolve(data || {}); } else reject(onFail(res.statusCode, data));
      },
      fail: () => reject(new ApiError('上传失败：网络不通', 0)),
    });
  });
}

/* 图片地址：服务端返回的是 /image/… 这种相对路径，App 里要补上域名 */
export const assetUrl = (p) => (!p ? '' : /^(https?:|data:|blob:)/.test(p) ? p : url(p));
