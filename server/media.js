/* 已通过身份校验的媒体：范围读取，避免将整段录音或视频装进内存。 */
import { open } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';

export function mediaRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!m || (!m[1] && !m[2]) || !size) return false;
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  const end = m[1] ? (m[2] ? Math.min(Number(m[2]), size - 1) : size - 1) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size) return false;
  return { start, end };
}

export async function sendMedia(file, mime, req, res) {
  let handle;
  try {
    handle = await open(file, 'r');
    const { size } = await handle.stat();
    const range = mediaRange(req.headers.range, size);
    if (range === false) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' });
      res.end();
      return;
    }
    res.writeHead(range ? 206 : 200, {
      'Content-Type': mime,
      'Content-Length': range ? range.end - range.start + 1 : size,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=3600',
      ...(range ? { 'Content-Range': `bytes ${range.start}-${range.end}/${size}` } : {}),
    });
    if (req.method === 'HEAD') { res.end(); return; }
    await pipeline(handle.createReadStream({ ...(range || {}), autoClose: false }), res);
  } catch (err) {
    if (!res.headersSent) {
      if (err.code !== 'ENOENT' && err.code !== 'ENOTDIR') throw err;
      res.writeHead(404).end('Not Found');
    } else if (!res.destroyed) res.destroy();
  } finally {
    await handle?.close();
  }
}
