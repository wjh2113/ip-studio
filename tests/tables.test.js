/* 表格：粘坏的合回去、阅读渲染、编辑器存取、Word 导出 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTables, readTable, splitRow, tableToMarkdown } from '../shared/tables.js';
import { markdown } from '../web/src/lib/text.js';
import { docToHtml } from '../web/src/lib/richdoc.js';
import { buildDocx } from '../server/docx.js';

// 截图里那种：编辑器以前不认表格，每行之间被插了空行
const BROKEN = '回到三层价值来看：\n\n| 提升层面 | 降本提效 | 增收体验 |\n\n| --- | --- | --- |\n\n| **效率**：工作处理得更快 | 自动录单 | 缩短收货 |\n\n| **决策**：更合理 | 优化补货 | 提高可得性 |\n\n后面的段落';

test('粘坏的表格合回去；没有分隔行的竖线文字不动', () => {
  const n = normalizeTables(BROKEN);
  assert.match(n, /\| 提升层面 \| 降本提效 \| 增收体验 \|\n\| --- \| --- \| --- \|\n\| \*\*效率\*\*/);
  assert.match(n, /回到三层价值来看：\n\n\|/);
  assert.match(n, /\|\n\n后面的段落$/);
  assert.equal(normalizeTables('| 只是 |\n\n| 两行竖线 |'), '| 只是 |\n\n| 两行竖线 |');
  assert.equal(normalizeTables('没有表格\n\n照旧'), '没有表格\n\n照旧');
});

test('拆单元格：转义的竖线、列数对不齐的行', () => {
  assert.deepEqual(splitRow('| a\\|b | c |'), ['a|b', 'c']);
  const t = readTable(['| a | b |', '| :--- | ---: |', '| 1 |', '| 1 | 2 | 3 |'], 0);
  assert.deepEqual(t.align, ['', 'right']);
  assert.deepEqual(t.rows, [['1', ''], ['1', '2 | 3']]);
  assert.equal(tableToMarkdown({ header: ['a|b', 'c'], rows: [['1']] }), '| a\\|b | c |\n| --- | --- |\n| 1 |  |');
});

test('阅读渲染：画成表格，单元格里的加粗照样生效，HTML 被转义', () => {
  const html = markdown(BROKEN.replace('自动录单', '<b>自动</b>录单'));
  assert.match(html, /<table><thead><tr><th>提升层面<\/th>/);
  assert.match(html, /<td><strong>效率<\/strong>：工作处理得更快<\/td>/);
  assert.match(html, /&lt;b&gt;自动&lt;\/b&gt;录单/);
  assert.equal((html.match(/<tr>/g) || []).length, 3);
  assert.match(html, /<p>后面的段落<\/p>$/);
});

test('编辑器读入：表格变成表头 + 单元格', () => {
  const html = docToHtml(BROKEN);
  assert.match(html, /<table><tbody><tr><th><p>提升层面<\/p><\/th>/);
  assert.match(html, /<td><p><strong>效率<\/strong>：工作处理得更快<\/p><\/td>/);
  assert.equal((html.match(/<tr>/g) || []).length, 3);
});

test('Word 导出：输出成真表格，表头一行、每格一个单元格', async () => {
  const buf = await buildDocx({ title: '', text: BROKEN, items: [], readImage: async () => null });
  const xml = buf.toString('utf8');
  assert.equal((xml.match(/<w:tbl>/g) || []).length, 1);
  assert.equal((xml.match(/<w:tr>/g) || []).length, 3);
  assert.equal((xml.match(/<w:tc>/g) || []).length, 9);
  assert.match(xml, /<w:tblHeader\/>/);
  assert.ok(!xml.includes('| --- |'), '分隔行不该写进 Word');
});
