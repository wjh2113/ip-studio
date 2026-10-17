import test from 'node:test';
import assert from 'node:assert/strict';
import { IMAGE_MARK } from '../shared/place.js';
import { docToHtml, isSafeImageSrc, sanitizeColor, sanitizeDoc } from '../web/src/lib/richdoc.js';
import { markdown } from '../web/src/lib/text.js';

test('sanitizeColor 只认 #RGB / #RRGGBB', () => {
  assert.equal(sanitizeColor('#f00'), '#FF0000');
  assert.equal(sanitizeColor('#00aaBB'), '#00AABB');
  assert.equal(sanitizeColor('red'), '');
  assert.equal(sanitizeColor('url(x)'), '');
});

test('sanitizeDoc 保留颜色与同域图，剥掉危险 HTML', () => {
  const src = `开头<span style="color:#ff0000">红字</span>结尾\n![说明](/image/1/2-a-abc.png)\n<script>alert(1)</script>\n![x](data:image/png;base64,xx)`;
  const out = sanitizeDoc(src);
  assert.match(out, /color:#FF0000/);
  assert.match(out, /!\[说明\]\(\/image\/1\/2-a-abc\.png\)/);
  assert.doesNotMatch(out, /script/i);
  assert.doesNotMatch(out, /data:image/);
});

test('sanitizeDoc 保留 IMAGE_MARK', () => {
  const out = sanitizeDoc(`一段\n${IMAGE_MARK}\n下一段`);
  assert.ok(out.includes(IMAGE_MARK));
});

test('docToHtml 把标记与图片变成 TipTap 能吃的节点', () => {
  const html = docToHtml(`# 标题\n\n<span style="color:#00AA00">绿</span>\n\n${IMAGE_MARK}\n\n![a](/image/9/1-a-x.png)`);
  assert.match(html, /<h1>/);
  assert.match(html, /color:#00AA00/);
  assert.match(html, /data-image-mark/);
  assert.match(html, /src="\/image\/9\/1-a-x\.png"/);
  assert.equal(isSafeImageSrc('/image/9/1-a-x.png'), true);
  assert.equal(isSafeImageSrc('https://evil.test/x.png'), false);
});

test('markdown 渲染颜色与同域图', () => {
  const html = markdown(`看<span style="color:#112233">色</span>和![图](/image/3/d-a-1.png)`);
  assert.match(html, /style="color:#112233"/);
  assert.match(html, /src="\/image\/3\/d-a-1\.png"/);
  assert.match(html, /class="doc-img"/);
  assert.doesNotMatch(html, /<script/i);
});

test('markdown 仍渲染粗体标题列表', () => {
  const html = markdown('# 题\n\n**粗**\n\n- 一项');
  assert.match(html, /<h1>/);
  assert.match(html, /<strong>粗<\/strong>/);
  assert.match(html, /<ul>/);
});
