/* 成稿参考：开关和权重怎么变成「带几条」和提示词里的一句话 */
import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRefs, refCount, weigh, REF_SOURCES } from '../server/refs.js';

test('缺项、写错的补成默认：全开、适中', () => {
  const r = normalizeRefs('{"profile":{"on":false},"samples":{"weight":"huge"}}');
  assert.equal(r.profile.on, false);
  assert.equal(r.profile.weight, 'mid');
  assert.equal(r.samples.weight, 'mid');
  assert.deepEqual(Object.keys(r), REF_SOURCES.map((x) => x.key));
  assert.equal(normalizeRefs('坏的').materials.on, true);
});

test('带几条：关掉 0；少量 / 适中 / 重点三档；精简场景少一档', () => {
  const r = normalizeRefs({ profile: { weight: 'high' }, samples: { weight: 'low' }, materials: { on: false } });
  assert.equal(refCount(r, 'profile'), 8);
  assert.equal(refCount(r, 'profile', { lite: true }), 5);
  assert.equal(refCount(r, 'samples'), 1);
  assert.equal(refCount(r, 'samples', { lite: true }), 1);
  assert.equal(refCount(r, 'materials'), 0);
  assert.equal(refCount(r, 'prefs'), 12);
});

test('提示词：重点和少量各加一句，适中不加，空块还是空', () => {
  const r = normalizeRefs({ profile: { weight: 'high' }, materials: { weight: 'low' } });
  assert.match(weigh('块', r, 'profile'), /重点参考/);
  assert.match(weigh('块', r, 'materials'), /少量参考/);
  assert.equal(weigh('块', r, 'prefs'), '块');
  assert.equal(weigh(null, r, 'profile'), null);
});
