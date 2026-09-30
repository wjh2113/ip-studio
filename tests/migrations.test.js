import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { MIGRATIONS, runMigrations } from '../server/migrations.js';
import { createIsolated } from '../server/client.js';

const latest = MIGRATIONS.at(-1).version;

async function tableCount(pool, name) {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS n FROM information_schema.tables
     WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'
     ${name ? 'AND table_name = $1' : ''}`,
    name ? [name] : [],
  );
  return r.rows[0].n;
}

test('新库跑到最新版本，再跑一次什么都不做', async () => {
  const iso = await createIsolated(`mig1${process.pid}`);
  try {
    assert.equal(await runMigrations(iso), latest);
    assert.ok(await tableCount(iso.pool) >= 20);
    assert.equal(await runMigrations(iso), latest);
  } finally {
    await iso.close();
  }
});

test('迁移失败整体回滚，版本号不变', async () => {
  const iso = await createIsolated(`mig2${process.pid}`);
  try {
    await runMigrations(iso);
    MIGRATIONS.push({ version: latest + 1, name: '故意失败', up: async (d) => { await d.exec('CREATE TABLE half_done (id integer)'); throw new Error('boom'); } });
    await assert.rejects(() => runMigrations(iso), /故意失败/);
    const ver = await iso.pool.query('SELECT COALESCE(MAX(version), 0)::int AS v FROM schema_migrations');
    assert.equal(ver.rows[0].v, latest);
    assert.equal(await tableCount(iso.pool, 'half_done'), 0);
  } finally {
    MIGRATIONS.pop();
    await iso.close();
  }
});
