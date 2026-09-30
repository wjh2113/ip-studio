import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Users, Personas, Drafts, Materials, Revisions, db } from '../server/db.js';
import { recallMaterials } from '../server/routes.js';

const user = Users.create('db-user', 'x:y');
const persona = Personas.create(user.id, {
  name: '测试号', platform: 'xiaohongshu', tone: '轻松', content_focus: '', audience: '', problem: '', notes: '',
  creator_age: '', creator_gender: '', creator_industry: '', creator_role: '', creator_traits: '',
});

test('素材召回：字面相关的召回，不相关的不给', () => {
  Materials.create(user.id, persona.id, { kind: '数据', title: 'AI 让团队变小', body: '8 人团队走了 4 个，周报从 4.2 小时降到 47 分钟', tags: 'AI,团队' });
  Materials.create(user.id, persona.id, { kind: '经历', title: '周末备菜', body: '30 分钟做三个菜', tags: '做菜' });
  assert.deepEqual(recallMaterials(user.id, persona.id, 'AI 会让团队变小吗').map((m) => m.title), ['AI 让团队变小']);
  assert.deepEqual(recallMaterials(user.id, persona.id, '区块链跨境支付'), []);
  assert.deepEqual(recallMaterials(user.id, null, 'AI 团队'), []);
});

function newDraft() {
  return Drafts.create(user.id, { subject: '题材', platform: 'xiaohongshu', tone: '轻松', audience: '', keywords: '', length: 600 }, persona);
}

test('正文历史：自动保存 10 分钟内只留一版，手动保存一定留', () => {
  const d = newDraft();
  Drafts.setContent(d.id, user.id, { chosen: 0, title: 't', content: '生成版', status: 'done' });
  for (let i = 0; i < 5; i += 1) Drafts.saveContent(d.id, user.id, `自动保存 ${i}`);
  assert.equal(Revisions.list(d.id, user.id).length, 1);          // 只有生成那一版
  Drafts.saveContent(d.id, user.id, '手动保存版', { snapshot: true });
  const list = Revisions.list(d.id, user.id);
  assert.equal(list.length, 3);                                  // 生成版 + 手动前的旧版 + 手动版
});

test('正文历史：距上一版超过 10 分钟的自动保存会留一版', () => {
  const d = newDraft();
  Drafts.setContent(d.id, user.id, { chosen: 0, title: 't', content: '生成版', status: 'done' });
  db.prepare('UPDATE draft_revisions SET created_at = ? WHERE draft_id = ?').run('2000-01-01T00:00:00.000Z', d.id);
  Drafts.saveContent(d.id, user.id, '一小时后的自动保存');
  assert.equal(Revisions.list(d.id, user.id).length, 2);
});

test('正文历史：每篇最多 50 版', () => {
  const d = newDraft();
  for (let i = 0; i < 60; i += 1) Revisions.keep(d.id, user.id, `第 ${i} 版`);
  const list = Revisions.list(d.id, user.id);
  assert.equal(list.length, 50);
  assert.equal(Revisions.byId(list[0].id, d.id, user.id).content, '第 59 版');
});
