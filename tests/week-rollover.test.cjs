const test = require('node:test');
const assert = require('node:assert/strict');
const initSqlJs = require('sql.js');
const {
  archiveAndAdvanceEntries,
  backfillCurrentWeekEntries,
  getBusinessCurrentWeekKey,
  makeAdvancedEntry,
} = require('../server/services/weekRollover.cjs');

test('Monday midnight in Shanghai starts the new business week', () => {
  assert.equal(getBusinessCurrentWeekKey(new Date('2026-07-26T15:59:59.000Z')), '260724');
  assert.equal(getBusinessCurrentWeekKey(new Date('2026-07-26T16:00:00.000Z')), '260731');
});

test('new week inherits the previous week fields without sharing nested objects', () => {
  const source = {
    id: 'entry-1',
    weekKey: '260724',
    productName: '测试项目',
    nextWeekPlan: '继续推进',
    navScale: '1000万',
    weeklyProgress: { '260724': '完成初稿' },
    navScaleHistory: { '260724': '900万' },
    dynamicFields: { weeklyReview: '本周平稳' },
    reviewStatus: 'approved',
    reviewComment: '已确认',
  };

  const advanced = makeAdvancedEntry(source, '260731', '260724', '2026-07-27T00:00:00.000Z');

  assert.equal(advanced.weekKey, '260731');
  assert.equal(advanced.weeklyProgress['260731'], '完成初稿');
  assert.equal(advanced.navScaleHistory['260731'], '1000万');
  assert.equal(advanced.nextWeekPlan, '继续推进');
  assert.equal(advanced.dynamicFields.weeklyReview, '本周平稳');
  assert.equal(advanced.reviewStatus, 'draft');
  assert.equal(advanced.reviewComment, '');

  advanced.weeklyProgress['260731'] = '新周修改';
  advanced.dynamicFields.weeklyReview = '新周动态字段';
  assert.equal(source.weeklyProgress['260724'], '完成初稿');
  assert.equal(source.weeklyProgress['260731'], undefined);
  assert.equal(source.dynamicFields.weeklyReview, '本周平稳');
});

test('week rollover archives the old value and does not process current-week rows twice', async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('CREATE TABLE entries (id TEXT PRIMARY KEY, data TEXT, created_by TEXT, updated_at TEXT, week_key TEXT)');
  db.run('CREATE TABLE entry_snapshots (id TEXT PRIMARY KEY, week_key TEXT, entry_id TEXT, data TEXT, created_by TEXT, snapshot_at TEXT)');

  const source = {
    id: 'entry-1',
    weekKey: '260724',
    weeklyProgress: { '260724': '上周内容' },
    navScaleHistory: {},
    updatedAt: '2026-07-24T08:00:00.000Z',
  };
  db.run(
    'INSERT INTO entries(id,data,created_by,updated_at,week_key) VALUES(?,?,?,?,?)',
    [source.id, JSON.stringify(source), 'user-1', source.updatedAt, source.weekKey]
  );

  const first = archiveAndAdvanceEntries(db, '260731', '2026-07-27T00:00:00.000Z');
  const second = archiveAndAdvanceEntries(db, '260731', '2026-07-27T00:01:00.000Z');

  assert.equal(first.count, 1);
  assert.equal(second.count, 0);

  const current = JSON.parse(db.exec("SELECT data FROM entries WHERE id='entry-1'")[0].values[0][0]);
  const archived = JSON.parse(db.exec("SELECT data FROM entry_snapshots WHERE id='260724:entry-1'")[0].values[0][0]);
  assert.equal(current.weeklyProgress['260731'], '上周内容');
  assert.equal(archived.weeklyProgress['260724'], '上周内容');
  assert.equal(archived.weeklyProgress['260731'], undefined);
});

test('already-advanced rows are backfilled for the current week once', async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('CREATE TABLE entries (id TEXT PRIMARY KEY, data TEXT, created_by TEXT, updated_at TEXT, week_key TEXT)');

  const source = {
    id: 'entry-2',
    weekKey: '260731',
    navScale: '1200万',
    weeklyProgress: { '260724': '已归档但未继承' },
    navScaleHistory: { '260724': '1100万' },
  };
  db.run(
    'INSERT INTO entries(id,data,created_by,updated_at,week_key) VALUES(?,?,?,?,?)',
    [source.id, JSON.stringify(source), 'user-1', '', source.weekKey]
  );

  assert.equal(backfillCurrentWeekEntries(db, '260731', '2026-07-27T01:00:00.000Z'), 1);
  assert.equal(backfillCurrentWeekEntries(db, '260731', '2026-07-27T01:01:00.000Z'), 0);

  const current = JSON.parse(db.exec("SELECT data FROM entries WHERE id='entry-2'")[0].values[0][0]);
  assert.equal(current.weeklyProgress['260731'], '已归档但未继承');
  assert.equal(current.navScaleHistory['260731'], '1200万');
});
