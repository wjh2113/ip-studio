/* 在单独的线程里解析上传的 Word / PDF：大文件解析是纯 CPU 活，放主线程会卡住所有请求 */
import { parentPort, workerData } from 'node:worker_threads';
import { extractText } from './filetext.js';

try {
  parentPort.postMessage({ ok: true, result: extractText(Buffer.from(workerData.buffer), workerData.name) });
} catch (err) {
  parentPort.postMessage({ ok: false, status: err?.status || 400, message: String(err?.message || err) });
}
