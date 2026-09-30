import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { riskOf, screenItems, parseManual } from '../server/hotspots.js';

test('不适合蹭的热点在送进模型前挡掉', async () => {
  assert.equal(riskOf('某地发生地震')?.key, 'casualty');
  assert.equal(riskOf('某明星官宣恋情')?.key, 'gossip');
  assert.equal(riskOf('新款手机发布'), null);
  const { kept, blocked } = screenItems([{ title: '新款手机发布' }, { title: '某人被刑拘' }]);
  assert.equal(kept.length, 1);
  assert.equal(blocked[0].riskKey, 'crime');
});

test('手动粘贴的榜单去掉序号、过滤太短的行', async () => {
  const items = parseManual('1. 第一条热点标题\n2、第二条热点标题\n短');
  assert.deepEqual(items.map((i) => i.title), ['第一条热点标题', '第二条热点标题']);
});
