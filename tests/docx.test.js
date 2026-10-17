/* Word 导出：加粗、颜色要进 Word 的样式，不能把 <span> 当正文；正文里的同域图要嵌进去。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDocx } from '../server/docx.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

test('docx：加粗和标红写成样式，手贴的 png 嵌进文档', async () => {
  const seen = [];
  const buf = await buildDocx({
    title: '题',
    text: '这是<span style="color:#FF0000">**红粗**</span>和**只粗**\n\n![](/image/7/a.png)\n\n- 一条',
    items: [],
    readImage: async (file) => {
      seen.push(file);
      return file === '7/a.png' ? PNG : null;
    },
  });
  const xml = buf.toString('utf8');
  assert.match(xml, /<w:b\/>/);
  assert.match(xml, /w:color w:val="FF0000"/);
  assert.equal(xml.includes('&lt;span'), false);
  assert.equal(xml.includes('**'), false);
  assert.deepEqual(seen, ['7/a.png']);
  assert.ok(xml.includes('word/media/image1.png'));
  assert.match(xml, /一条/);
});
