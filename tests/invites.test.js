/* 邀请码：凭码注册、一码一人、并发只能占到一次、用户名撞了码不作废、作废后不能用；谁算前台管理员 */
import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.REGISTER_OPEN = '0';
process.env.APP_ADMINS = 'boss, 另一个';
delete process.env.ACCESS_PASSWORD;

const { Invites, Users } = await import('../server/db.js');
const { registerMode, newInviteCode, normalizeInvite, registerWithInvite, isAppAdmin, publicUser } = await import('../server/auth.js');

test('注册方式：REGISTER_OPEN=0 是凭码注册；码的格式和输入宽松', () => {
  assert.equal(registerMode(), 'invite');
  const c = newInviteCode();
  assert.match(c, /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
  assert.equal(normalizeInvite(c.toLowerCase().replace('-', ' ')), c);
  assert.equal(normalizeInvite('abc'), '');
});

test('凭码注册：一码一人；用户名撞了码还能用；作废的不能用', async () => {
  await Users.create('已有的人', 'x:y');
  const inv = await Invites.create(newInviteCode(), '给小王', 'boss');
  await assert.rejects(registerWithInvite(inv.code, '已有的人', 'secret123'), /已被注册/);
  const u = await registerWithInvite(inv.code.toLowerCase(), '小王', 'secret123');
  assert.equal(u.username, '小王');
  await assert.rejects(registerWithInvite(inv.code, '小李', 'secret123'), /用过|作废/);
  const row = (await Invites.list()).find((x) => x.id === inv.id);
  assert.equal(row.used_name, '小王');
  assert.ok(row.used_at);
  assert.equal(await Invites.revoke(inv.id), false);       // 用过的不能作废

  const inv2 = await Invites.create(newInviteCode(), '', 'boss');
  assert.equal(await Invites.revoke(inv2.id), true);
  await assert.rejects(registerWithInvite(inv2.code, '小赵', 'secret123'), /用过|作废/);
  await assert.rejects(registerWithInvite('', '小赵', 'secret123'), /邀请码/);
});

test('同一个码两个人同时用：只有一个注册成功', async () => {
  const inv = await Invites.create(newInviteCode(), '', 'boss');
  const got = await Promise.allSettled([
    registerWithInvite(inv.code, '并发甲', 'secret123'),
    registerWithInvite(inv.code, '并发乙', 'secret123'),
  ]);
  assert.equal(got.filter((x) => x.status === 'fulfilled').length, 1);
});

test('前台管理员：APP_ADMINS 里的用户名（逗号、空格分隔都行）', () => {
  assert.equal(isAppAdmin({ username: 'boss' }), true);
  assert.equal(isAppAdmin({ username: '另一个' }), true);
  assert.equal(isAppAdmin({ username: '小王' }), false);
  assert.equal(publicUser({ id: 1, username: 'boss', created_at: '' }).admin, true);
});

test('改用户名：内容挂在 id 上，改名后按新名字找得到', async () => {
  const u = await Users.create('ip', 'x:y');
  await Users.rename(u.id, 'jonny');
  assert.equal((await Users.byName('jonny')).id, u.id);
  assert.equal(await Users.byName('ip'), null);
});
