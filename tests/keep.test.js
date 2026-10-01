import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { rebindCues, rebindIllus } from '../server/keep.js';
import { IMAGE_MARK } from '../shared/place.js';

test('rebindCues：只留下正文里还能逐字找到的提示', async () => {
  const cues = { cues: [{ quote: '第一句' }, { quote: '被删掉的句子' }, { quote: '第三句' }] };
  const { cues: next, dropped } = rebindCues('第一句。第三句。', cues);
  assert.equal(dropped, 1);
  assert.deepEqual(next.cues.map((c) => c.quote), ['第一句', '第三句']);
  assert.equal(next.trimmed, 1);
});

test('rebindCues：全对不上时清空', async () => {
  assert.deepEqual(rebindCues('全新正文', { cues: [{ quote: '旧' }] }), { cues: null, dropped: 1 });
});

test('rebindIllus：没有图片标记时按锚点重新定位，找不到的丢掉', async () => {
  const illus = { __main__: { items: [{ anchor: '段落一' }, { anchor: '已删除' }] } };
  const { illus: next, dropped } = rebindIllus('开头\n段落一\n结尾', illus);
  assert.equal(dropped, 1);
  assert.equal(next.__main__.placed, 'auto');
  assert.equal(next.__main__.items[0].at, 3);
});

test('rebindIllus：有图片标记时按标记顺序对位', async () => {
  const illus = { __main__: { items: [{ anchor: 'a' }, { anchor: 'b' }, { anchor: 'c' }] } };
  const text = `第一段\n${IMAGE_MARK}\n第二段\n${IMAGE_MARK}`;
  const { illus: next, dropped } = rebindIllus(text, illus);
  assert.equal(next.__main__.placed, 'mark');
  assert.equal(next.__main__.items.length, 2);
  assert.equal(dropped, 1);
});
