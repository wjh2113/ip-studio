import { TEST_DIR } from './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS, runMigrations } from '../server/migrations.js';

const latest = MIGRATIONS.at(-1).version;

test('新库跑到最新版本，再跑一次什么都不做', () => {
  const db = new DatabaseSync(join(TEST_DIR, 'm1.db'));
  assert.equal(runMigrations(db), latest);
  const tables = db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").get().n;
  assert.ok(tables >= 20);
  assert.equal(runMigrations(db), latest);
});

test('迁移失败整体回滚，版本号不变', () => {
  const db = new DatabaseSync(join(TEST_DIR, 'm2.db'));
  runMigrations(db);
  MIGRATIONS.push({ version: latest + 1, name: '故意失败', up: (d) => { d.exec('CREATE TABLE half_done (id INTEGER)'); throw new Error('boom'); } });
  try {
    assert.throws(() => runMigrations(db), /故意失败/);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, latest);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name = 'half_done'").get().n, 0);
  } finally {
    MIGRATIONS.pop();
  }
});
