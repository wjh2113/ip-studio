/* 网络：所有 /api 请求都从这里走。
 *   api(path, { method, body })   JSON 进、JSON 出；失败抛 Error（message 是服务端给的中文文案）
 *   stream(path, body, onEvent, { signal })   流式接口（成稿、划词改写、对话）：按 SSE 事件回调；signal 用来「停止」
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

/* 流式读失败时浏览器常抛英文（network error / Failed to fetch），收成可读中文；已是中文的原样留下 */
export function friendlyNetError(err) {
  const raw = String(err?.message || err || '');
  const name = err?.name || '';
  // TimeoutError 的 message 里也常带 aborted，先认超时再认取消
  if (name === 'TimeoutError' || /timed? ?out|timeout/i.test(raw)) {
    return '等太久没有回音，请重试';
  }
  if (name === 'AbortError' || /^(已取消|请求已取消)/.test(raw) || (/aborted/i.test(raw) && !/network/i.test(raw))) {
    return '已取消';
  }
  if (/network error|failed to fetch|load failed|networkerror|err_network|econnreset|other side closed/i.test(raw)) {
    return '连接中断了。长改稿时偶发，点「重试」即可；一直这样可以把改动拆成几次发';
  }
  return raw.slice(0, 300) || '请求失败';
}

/* 流式接口。onEvent(event, data) 里抛错会中断读取并从这里抛出。
   signal 一 abort（点了「停止」）：连接立刻断开，服务端发现断线就停掉模型，这里抛 AbortError */
export async function stream(path, body, onEvent, { signal } = {}) {
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (res.status === 402) emit('quota', { message: data.error, quota: data.quota });
    throw httpError(data.error || '请求失败', res.status);
  }
  try {
    await readSSE(res, onEvent);
  } catch (err) {
    throw httpError(friendlyNetError(err), err.status);
  }
  emit('spent');
}

export async function readSSE(res, onEvent) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let finished = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) { finished = true; break; }
      buf += decoder.decode(value, { stream: true });
      const blocks = buf.split(/\r?\n\r?\n/);
      buf = blocks.pop() || '';
      for (const block of blocks) {
        let event = 'message';
        const data = [];
        for (const line of block.split(/\r?\n/)) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
        }
        if (data.length) onEvent(event, JSON.parse(data.join('\n')));
      }
    }
  } finally {
    try { if (!finished) await reader.cancel(); }
    finally { reader.releaseLock(); }
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

/* 二进制上传 + SSE 进度（语音改稿）。onEvent(event, data)；done 的 data 作为返回值 */
export async function streamUpload(path, blob, filename, onEvent) {
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': blob.type || 'application/octet-stream',
      'X-Filename': encodeURIComponent(filename || 'upload.webm'),
      Accept: 'text/event-stream',
    },
    body: blob,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (res.status === 402) emit('quota', { message: data.error, quota: data.quota });
    throw httpError(data.error || `上传失败（${res.status}）`, res.status);
  }
  let done = null;
  await readSSE(res, (event, data) => {
    if (event === 'done') done = data;
    onEvent?.(event, data);
  });
  emit('spent');
  return done;
}

/* 下载成文件：Blob → 临时链接 → 点一下 */
export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);     // 有的浏览器只认挂在页面上的链接的 download 文件名
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
