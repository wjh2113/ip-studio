/* 平台版本拆表 + JSON 写前行锁：改正文不会盖掉口播提示；并发写配图互不覆盖 */
import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Drafts, Users } from '../server/db.js';

async function seed() {
  const name = `vl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const u = await Users.create(name, 'x');
  const d = await Drafts.create(u.id, {
    subject: '周末备菜', platform: 'gongzhonghao', tone: '实用干货',
    audience: '', keywords: '', length: 800,
  });
  await Drafts.setContent(d.id, u.id, { chosen: 0, title: '标题', content: '原文正文一段。', status: 'done' });
  return { uid: u.id, id: d.id };
}

test('平台版本：改正文不盖掉同版口播提示', async () => {
  const { uid, id } = await seed();
  await Drafts.upsertVariant(id, uid, 'xiaohongshu', {
    content: '小红书版正文', chars: 6, fromChars: 7, from: 'gongzhonghao', at: 't0',
    cues: { cues: [{ quote: '小红书版正文' }], mode: 'video' },
  });
  await Drafts.upsertVariant(id, uid, 'xiaohongshu', {
    content: '小红书版正文（手改）', chars: 10, editedAt: 't1',
  });
  const d = await Drafts.byId(id, uid);
  assert.equal(d.variants.xiaohongshu.content, '小红书版正文（手改）');
  assert.equal(d.variants.xiaohongshu.cues?.mode, 'video');
  assert.equal(d.variants.xiaohongshu.cues?.cues?.[0]?.quote, '小红书版正文');
});

test('配图 patchIllus：并发写两张，两张都在', async () => {
  const { uid, id } = await seed();
  await Drafts.setIllus(id, uid, {
    __main__: {
      items: [
        { i: 0, prompt: 'a', image: null },
        { i: 1, prompt: 'b', image: null },
      ],
    },
  });
  await Promise.all([
    Drafts.patchIllus(id, uid, (prev) => {
      const pack = prev.__main__;
      return {
        ...prev,
        __main__: { ...pack, items: pack.items.map((it, i) => (i === 0 ? { ...it, image: { file: '0.png' } } : it)) },
      };
    }),
    Drafts.patchIllus(id, uid, (prev) => {
      const pack = prev.__main__;
      return {
        ...prev,
        __main__: { ...pack, items: pack.items.map((it, i) => (i === 1 ? { ...it, image: { file: '1.png' } } : it)) },
      };
    }),
  ]);
  const d = await Drafts.byId(id, uid);
  assert.equal(d.illus.__main__.items[0].image.file, '0.png');
  assert.equal(d.illus.__main__.items[1].image.file, '1.png');
});
