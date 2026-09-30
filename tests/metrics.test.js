import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createIsolated } from '../server/client.js';
import { bind, migrateMetrics, runMigrations } from '../server/migrations.js';
import { Drafts, Metrics, Users } from '../server/db.js';
import { dayOf, near7 } from '../server/routes/insights.js';

test('迁移 5：老的单份发布数据搬成一行快照，日期取发布日期', async () => {
  const iso = await createIsolated(`met${process.pid}`);
  const client = await iso.pool.connect();
  try {
    await runMigrations(iso);
    await client.query('DROP TABLE draft_metrics');
    const user = await client.query("INSERT INTO users (username, pass_hash, created_at) VALUES ('m', 'x:y', '2026-01-01') RETURNING id");
    const uid = user.rows[0].id;
    const ins = `INSERT INTO drafts (user_id, subject, platform, tone, audience, keywords, length, metrics_json, published_at, created_at, updated_at)
      VALUES ($1, 's', 'xiaohongshu', '', '', '', 600, $2, $3, '2026-03-01', '2026-03-09T10:00:00Z')`;
    await client.query(ins, [uid, JSON.stringify({ views: 1200, likes: 30, note: '被转了' }), '2026-03-02']);
    await client.query(ins, [uid, JSON.stringify({ views: 50 }), '']);
    await client.query(ins, [uid, 'null', '']);
    await migrateMetrics(bind(client));
    const rows = (await client.query('SELECT * FROM draft_metrics ORDER BY draft_id')).rows;
    assert.equal(rows.length, 2);
    assert.equal(rows[0].captured_on, '2026-03-02');
    assert.equal(rows[0].views, 1200);
    assert.equal(rows[0].comments, null);
    assert.equal(rows[0].note, '被转了');
    assert.equal(rows[1].captured_on, '2026-03-09');
  } finally {
    client.release();
    await iso.close();
  }
});

test('快照：同一天同一平台再填是改，不同天是加；删稿一起删', async () => {
  const u = await Users.create('metrics-user', 'x:y');
  const d = await Drafts.create(u.id, { subject: 's', platform: 'xiaohongshu', tone: 't', audience: '', keywords: '', length: 600 });
  await Metrics.put(d.id, u.id, { platform: 'xiaohongshu', capturedOn: '2026-09-01', values: { views: 100 } });
  await Metrics.put(d.id, u.id, { platform: 'xiaohongshu', capturedOn: '2026-09-01', values: { views: 150, likes: 3 } });
  await Metrics.put(d.id, u.id, { platform: 'xiaohongshu', capturedOn: '2026-09-08', values: { views: 900 } });
  await Metrics.put(d.id, u.id, { platform: 'gongzhonghao', capturedOn: '2026-09-08', values: { views: 40 } });
  const list = await Metrics.list(d.id, u.id);
  assert.equal(list.length, 3);
  assert.equal(list.find((m) => m.capturedOn === '2026-09-01').views, 150);
  assert.equal(list[0].capturedOn, '2026-09-08');
  const grouped = (await Metrics.forDrafts(u.id, [d.id])).get(d.id);
  assert.equal(grouped[0].capturedOn, '2026-09-01');       // 复盘里从早到晚
  await Drafts.remove(d.id, u.id);
  assert.equal((await Metrics.list(d.id, u.id)).length, 0);
});

test('发布后第几天，和「第 7 天」口径', async () => {
  assert.equal(dayOf('2026-09-01', '2026-09-08'), 7);
  assert.equal(dayOf('', '2026-09-08'), null);
  const trend = [
    { day: 1, views: 100 }, { day: 5, views: 700 }, { day: 8, views: 900 }, { day: 30, views: 3000 },
  ];
  assert.equal(near7(trend), 900);                          // 第 8 天比第 5 天更接近第 7 天
  assert.equal(near7([{ day: 2, views: 1 }, { day: 12, views: 2 }]), null);
});
