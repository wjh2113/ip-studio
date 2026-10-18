import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSSE } from '../web/src/lib/api.js';
import { sendMedia } from '../server/media.js';

test('SSE 回调异常取消上游并释放读取锁', async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode('event: delta\ndata: {"text":"a"}\n\n')); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(readSSE({ body }, () => { throw Error('callback'); }), /callback/);
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
});

test('SSE 跨块 CRLF、多行 JSON 和正常结束释放锁', async () => {
  const body = new ReadableStream({ start(c) {
    for (const part of ['event: done\r\n', 'data: {"text":\r\n', 'data: "中文"}\r\n\r', '\n']) c.enqueue(new TextEncoder().encode(part));
    c.close();
  } });
  const events = [];
  await readSSE({ body }, (event, data) => events.push({ event, data }));
  assert.deepEqual(events, [{ event: 'done', data: { text: '中文' } }]);
  assert.equal(body.locked, false);
});

test('媒体真实 HTTP：整份、范围、后缀、无效范围、HEAD 和缺失文件', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ip-media-'));
  await writeFile(join(dir, 'sample'), '0123456789');
  const server = http.createServer((req, res) => {
    void sendMedia(join(dir, req.url === '/missing' ? 'missing' : 'sample'), 'audio/mpeg', req, res).catch(() => res.destroy());
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const [range, status, content] of [[null, 200, '0123456789'], ['bytes=2-5', 206, '2345'], ['bytes=-3', 206, '789'], ['bytes=8-', 206, '89'], ['bytes=99-', 416, ''], ['bytes=-0', 416, '']]) {
      const res = await fetch(base, { headers: range ? { Range: range } : {} });
      assert.equal(res.status, status, range);
      assert.equal(await res.text(), content);
      if (status === 206) assert.match(res.headers.get('content-range'), /^bytes \d+-\d+\/10$/);
    }
    const head = await fetch(base, { method: 'HEAD' });
    assert.equal(head.headers.get('content-length'), '10');
    assert.equal(await head.text(), '');
    assert.equal((await fetch(base + '/missing')).status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
