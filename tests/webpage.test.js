/* 对标抓取：SSRF 黑名单、抓取的各种拒绝（内网、跳转、类型、大小）、从网页和粘贴文本拆提纲。 */
import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { extractHtml, extractText, fetchPage, FetchError, isBlockedIp } from '../server/webpage.js';

test('地址黑名单：内网、回环、链路本地、CGNAT、组播、保留段都拦，IPv6 和 ::ffff: 映射也拦', () => {
  const blocked = [
    '127.0.0.1', '127.255.255.254', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
    '100.64.0.1', '100.127.255.255', '0.0.0.0', '224.0.0.1', '239.255.255.250', '240.0.0.1', '255.255.255.255',
    '192.0.2.1', '198.18.0.1', '198.51.100.7', '203.0.113.9', '192.0.0.8',
    '::', '::1', 'fe80::1', 'fe80::1%eth0', 'fc00::1', 'fd12:3456::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1',
    '::ffff:10.0.0.1', '::ffff:169.254.169.254', '64:ff9b::a9fe:a9fe', '2001:db8::1', '2001::1', '2002:7f00:1::1',
    '100::1', '::127.0.0.1', '[::1]', 'not-an-ip', '',
  ];
  for (const ip of blocked) assert.equal(isBlockedIp(ip), true, `${ip} 应当被拦`);
  const allowed = ['8.8.8.8', '1.1.1.1', '110.242.68.66', '172.32.0.1', '100.128.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8', '2408:8000::1'];
  for (const ip of allowed) assert.equal(isBlockedIp(ip), false, `${ip} 应当放行`);
});

/* 本机起一个小网站，各种路径演示各种情况 */
function site() {
  const server = http.createServer((req, res) => {
    if (req.url === '/page') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<html><head><title>T</title></head><body><h2>一</h2><h2>二</h2></body></html>');
    } else if (req.url.startsWith('/hop')) {
      const n = Number(req.url.slice(4)) || 0;
      res.writeHead(302, { location: n > 0 ? `/hop${n - 1}` : '/page' });
      res.end();
    } else if (req.url === '/json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    } else if (req.url === '/big') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(Buffer.alloc(3 * 1024 * 1024, 97));
    } else if (req.url === '/slow') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.write('<p>');
      // 不结束，等客户端超时
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

test('抓取：内网地址默认拒绝；测试开关只在 NODE_ENV=test 时生效', async (t) => {
  const server = await site();
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  delete process.env.BENCHMARK_ALLOW_PRIVATE;
  await assert.rejects(() => fetchPage(`${base}/page`), (e) => e instanceof FetchError && e.code === 'blocked');
  await assert.rejects(() => fetchPage(`http://localhost:${server.address().port}/page`), (e) => e.code === 'blocked');
  await assert.rejects(() => fetchPage('http://[::1]/'), (e) => e.code === 'blocked');
  await assert.rejects(() => fetchPage('http://169.254.169.254/latest/meta-data/'), (e) => e.code === 'blocked');
  await assert.rejects(() => fetchPage('file:///etc/passwd'), (e) => e.code === 'url');
  await assert.rejects(() => fetchPage('http://user:pw@example.com/'), (e) => e.code === 'url');

  process.env.BENCHMARK_ALLOW_PRIVATE = '1';
  process.env.NODE_ENV = 'production';
  try {
    await assert.rejects(() => fetchPage(`${base}/page`), (e) => e.code === 'blocked');
  } finally {
    process.env.NODE_ENV = 'test';
  }
  const ok = await fetchPage(`${base}/page`);
  assert.equal(ok.type, 'html');
  assert.match(ok.body, /<h2>一<\/h2>/);
  delete process.env.BENCHMARK_ALLOW_PRIVATE;
});

test('抓取：最多跟 3 跳，只收 HTML / 纯文本，超过 2MB、超时都报错', async (t) => {
  const server = await site();
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  process.env.BENCHMARK_ALLOW_PRIVATE = '1';
  try {
    const three = await fetchPage(`${base}/hop2`);           // hop2 → hop1 → hop0 → page：3 跳
    assert.equal(three.url, `${base}/page`);
    await assert.rejects(() => fetchPage(`${base}/hop3`), (e) => e.code === 'redirects');
    await assert.rejects(() => fetchPage(`${base}/json`), (e) => e.code === 'type');
    await assert.rejects(() => fetchPage(`${base}/big`), (e) => e.code === 'too-big');
    await assert.rejects(() => fetchPage(`${base}/missing`), (e) => e.code === 'status');
    await assert.rejects(() => fetchPage(`${base}/slow`, { timeoutMs: 300, maxBytes: 1024, redirects: 3 }), (e) => e.code === 'timeout');
  } finally {
    delete process.env.BENCHMARK_ALLOW_PRIVATE;
  }
});

test('拆网页：标题优先 og:title，提纲取 h1–h3（最多 12 条），不够就取段落首句；摘要约 300 字', () => {
  const html = `<html><head><title>备用标题</title><meta property="og:title" content="周末备菜 &amp; 省时"></head>
    <body><nav><h2>导航不算</h2></nav><article><h1>周末备菜 &amp; 省时</h1>
    ${Array.from({ length: 14 }, (_, i) => `<h2>第${i + 1}步</h2><p>内容${i + 1}。后面的话。</p>`).join('')}
    </article><script>var x = '<h2>脚本不算</h2>';</script></body></html>`;
  const out = extractHtml(html);
  assert.equal(out.title, '周末备菜 & 省时');
  assert.equal(out.outline.length, 12);
  assert.equal(out.outline[0], '第1步');
  assert.ok(!out.outline.some((x) => /导航|脚本/.test(x)));
  assert.ok(out.excerpt.length <= 300 && out.excerpt.startsWith('周末备菜'));

  const plain = extractHtml('<title>只有段落</title><body><p>第一段第一句。第二句。</p><p>第二段开头！然后</p></body>');
  assert.equal(plain.title, '只有段落');
  assert.deepEqual(plain.outline, ['第一段第一句。', '第二段开头！']);
});

test('拆粘贴文本：认 Markdown 标题和「一、」编号小标题；都没有就取段落首句；标题没给用第一行', () => {
  const md = extractText('# 大标题\n\n## 为什么\n说点什么。\n## 怎么做\n再说点。\n一、第三点\n内容');
  assert.equal(md.title, '大标题');
  assert.deepEqual(md.outline, ['为什么', '怎么做', '第三点']);
  const paras = extractText('第一段。还有。\n第二段的话很长，继续！\n第三段收尾', '给定标题');
  assert.equal(paras.title, '给定标题');
  assert.deepEqual(paras.outline, ['第一段。', '第二段的话很长，继续！', '第三段收尾']);
});
