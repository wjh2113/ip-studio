/* Word / PDF 取文字。样本文件在 tests/fixtures/files：
 *   article.docx      pandoc 生成（标题、二级标题、列表、中英混排）
 *   article-lo.pdf    同一篇用 LibreOffice 导出（Identity-H + ToUnicode，字体子集化）
 *   objstm.pdf        同上，qpdf 改成对象流（字体字典藏在压缩的对象流里）
 *   permissions-aes.pdf  同上，qpdf 加了 AES-128、空打开密码（只限制权限）
 *   password.pdf      设了打开密码（AES-256）
 *   ucs2.pdf          reportlab 的 STSong-Light（UniGB-UCS2-H，没有 ToUnicode）
 *   image-only.pdf    只有图形没有文字（相当于扫描件） */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateRawSync, crc32 } from 'node:zlib';
import { fromRoot } from '../server/paths.js';
import { extractText, joinLines, unzip } from '../server/filetext.js';

const file = (name) => readFileSync(fromRoot(`tests/fixtures/files/${name}`));
const ARTICLE = '第一年当组长的时候，团队里走了两个新人。我花了很长时间才明白，带人这件事不是教技能，而是帮他们找到自己能赢的地方。'
  + '这一段故意写得很长很长，用来测试折行之后能不能重新拼成一段完整的话，而不是被拆成好几行碎片。';

test('docx：标题单独取出，二级标题、列表、段落都在', () => {
  const r = extractText(file('article.docx'), 'article.docx');
  assert.equal(r.kind, 'docx');
  assert.equal(r.title, '我做产品经理的第五年');
  assert.ok(r.text.startsWith(ARTICLE));
  assert.match(r.text, /\n## 三个教训\n/);
  assert.match(r.text, /\n- 先听再说\n- 给具体的反馈\n- Use English words like product manager and OKR in the middle\.\n\n最后一段/);
});

test('PDF（LibreOffice 导出）：折行拼回整段，列表另起，标题来自文档信息', () => {
  for (const name of ['article-lo.pdf', 'objstm.pdf', 'permissions-aes.pdf']) {
    const r = extractText(file(name), name);
    assert.equal(r.kind, 'pdf', name);
    assert.equal(r.title, '我做产品经理的第五年', name);
    const paras = r.text.split('\n\n');
    assert.equal(paras[0], ARTICLE, name);
    assert.ok(paras.includes('- 先听再说'), name);
    assert.ok(paras.at(-1).startsWith('最后一段'), name);
  }
});

test('PDF：没有 ToUnicode 的 UCS2 中文字体也能读', () => {
  const r = extractText(file('ucs2.pdf'), 'x.pdf');
  assert.equal(r.title, '报告标题：团队管理');
  assert.deepEqual(r.text.split('\n\n'), ['第一行文字，介绍一下背景，这句话比较长所以要折到下一行继续写完。', '第二段开始，Hello World 混排。']);
});

test('读不了的给明确的办法：有打开密码、扫描件、老 .doc、别的格式', () => {
  assert.throws(() => extractText(file('password.pdf'), 'a.pdf'), (e) => e.status === 400 && /打开密码/.test(e.message));
  assert.throws(() => extractText(file('image-only.pdf'), 'a.pdf'), (e) => e.status === 422 && /扫描件/.test(e.message));
  const ole = Buffer.alloc(64); ole.writeUInt32BE(0xd0cf11e0, 0);
  assert.throws(() => extractText(ole, 'a.doc'), /另存为 \.docx/);
  assert.throws(() => extractText(Buffer.from('hello'), 'a.xlsx'), /只支持/);
  assert.throws(() => extractText(Buffer.alloc(0), 'a.pdf'), /空的/);
  assert.equal(extractText(Buffer.from('# 标题\r\n正文'), 'a.md').text, '# 标题\n正文');
});

test('坏文件只报错，不挂：截断的 PDF、损坏的 zip', () => {
  const pdf = file('article-lo.pdf');
  assert.throws(() => extractText(pdf.subarray(0, 2000), 'a.pdf'), (e) => e.status >= 400 && e.status < 500);
  assert.throws(() => extractText(Buffer.concat([Buffer.from('PK\u0003\u0004'), Buffer.alloc(100)]), 'a.docx'), (e) => e.status === 400);
});

/* 手拼一个最小的 docx（deflate 压缩）：中文 Word 的标题样式 id 是 "1"、"2"，只能靠样式名认 */
function zip(files) {
  const parts = []; const central = []; let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text); const data = deflateRawSync(raw); const nm = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc32(raw) >>> 0, 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nm.length, 26);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(8, 10); cen.writeUInt32LE(crc32(raw) >>> 0, 16);
    cen.writeUInt32LE(data.length, 20); cen.writeUInt32LE(raw.length, 24); cen.writeUInt16LE(nm.length, 28); cen.writeUInt32LE(offset, 42);
    parts.push(local, nm, data); central.push(cen, nm); offset += 30 + nm.length + data.length;
  }
  const cd = Buffer.concat(central); const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

test('docx：中文样式名的标题、表格、换行、实体', () => {
  const p = (t, style = '') => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
  const buf = zip({
    'word/styles.xml': '<w:styles><w:style w:type="paragraph" w:styleId="1"><w:name w:val="heading 1"/></w:style><w:style w:type="paragraph" w:styleId="2"><w:name w:val="标题 2"/></w:style></w:styles>',
    'word/document.xml': `<w:document><w:body>${p('真正的标题', '1')}${p('第一段 &amp; 引号&quot;')}<w:p><w:r><w:t>上一行</w:t><w:br/><w:t>下一行</w:t></w:r></w:p>${p('小标题', '2')}<w:tbl><w:tr><w:tc>${p('单元格')}</w:tc></w:tr></w:tbl><w:p/></w:body></w:document>`,
  });
  assert.equal(unzip(buf).size, 2);
  const r = extractText(buf, 'x.docx');
  assert.equal(r.title, '真正的标题');
  assert.equal(r.text, '第一段 & 引号"\n\n上一行\n下一行\n\n## 小标题\n\n单元格');
});

test('拼段落：页码去掉，句末标点的短行收段，中英文接缝', () => {
  const raw = '这是很长的一行文字，一直写到页面的最右边才折下来，然后\n继续写完这句话。\nThis line is long enough to wrap and then\ncontinues here.\n短句。\n- 3 -\f第二页的开头。';
  assert.equal(joinLines(raw), '这是很长的一行文字，一直写到页面的最右边才折下来，然后继续写完这句话。\n\nThis line is long enough to wrap and then continues here.\n\n短句。\n\n第二页的开头。');
});
