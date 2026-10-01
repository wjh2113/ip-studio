/* 网络：所有 /api 请求都从这里走。
 *   api(path, { method, body })   JSON 进、JSON 出；失败抛 Error（message 是服务端给的中文文案）
 *   stream(path, body, onEvent)   流式接口（成稿、划词改写）：按 SSE 事件回调
 *   upload(path, blob, filename)  原样上传二进制（录音、视频），服务端按 Content-Type / X-Filename 认格式 */
import { emit } from './bus.js';

export async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // 402 = 额度或套餐拦下来了。这一刻正是最愿意付费的时候，所以不只是抛错，还通知用量面板弹出来
    if (res.status === 402) emit('quota', { message: data.error, quota: data.quota });
    throw httpError(data.error || `请求失败（${res.status}）`, res.status);
  }
  // 花过钱的请求顺手刷新余额，不用等下次开面板（网络层只发通知，不依赖具体功能）
  if (options.method && options.method !== 'GET') emit('spent');
  return data;
}

function httpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/* 流式接口。onEvent(event, data) 里抛错会中断读取并从这里抛出 */
export async function stream(path, body, onEvent) {
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (res.status === 402) emit('quota', { message: data.error, quota: data.quota });
    throw httpError(data.error || '请求失败', res.status);
  }
  await readSSE(res, onEvent);
  emit('spent');
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

/* 二进制上传。文件名做 URL 编码：中文文件名直接放进请求头会被浏览器拒掉 */
export async function upload(path, blob, filename) {
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': blob.type || 'application/octet-stream',
      'X-Filename': encodeURIComponent(filename || 'upload.webm'),
    },
    body: blob,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 402) emit('quota', { message: data.error, quota: data.quota });
    throw httpError(data.error || `上传失败（${res.status}）`, res.status);
  }
  emit('spent');
  return data;
}

/* 下载成文件：Blob → 临时链接 → 点一下 */
export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
