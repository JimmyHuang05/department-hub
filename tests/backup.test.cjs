const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const initSqlJs = require('sql.js');
const {
  millisecondsUntilNextMidnight,
  previousDateKey,
  selectBackupsToPrune,
  DEFAULT_MAX_BACKUPS,
  BUSINESS_BACKUP_SUFFIX,
  applyBusinessBackupToDb,
  buildBusinessBackup,
  createBackupToken,
  isBackupFileName,
  parseBackupToken,
  validateBusinessBackup,
} = require('../server/services/databaseBackup.cjs');
const { validateDatabaseBuffer } = require('../server/db.cjs');

test('restore validation accepts a healthy sql.js database', async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('CREATE TABLE sample(id TEXT PRIMARY KEY, value TEXT)');
  db.run('INSERT INTO sample(id,value) VALUES(?,?)', ['1', 'ok']);
  const file = path.join(os.tmpdir(), `ibd-backup-test-${Date.now()}.db`);
  fs.writeFileSync(file, Buffer.from(db.export()));
  db.close();

  const reopened = new SQL.Database(fs.readFileSync(file));
  const integrity = reopened.exec('PRAGMA integrity_check');
  reopened.close();
  fs.unlinkSync(file);
  assert.equal(integrity[0].values[0][0], 'ok');
});

test('automatic backup is scheduled for local midnight and labels prior-day data', () => {
  const now = new Date(2026, 6, 17, 23, 59, 30, 0);
  assert.equal(millisecondsUntilNextMidnight(now), 30_000);
  assert.equal(previousDateKey(new Date(2026, 6, 18, 0, 0, 0, 0)), '2026-07-17');
});

test('backup retention removes oldest files after fourteen copies', () => {
  const backups = Array.from({ length: 17 }, (_, index) => ({
    name: `backup-${index}`,
    stat: { mtimeMs: index },
  }));
  const removed = selectBackupsToPrune(backups, 14);
  assert.deepEqual(removed.map(item => item.name), ['backup-2', 'backup-1', 'backup-0']);
});

test('starred backups are excluded from retention and do not consume ordinary slots', () => {
  const backups = [
    { name: 'new', stat: { mtimeMs: 4 }, starred: false },
    { name: 'starred-old', stat: { mtimeMs: 1 }, starred: true },
    { name: 'middle', stat: { mtimeMs: 3 }, starred: false },
    { name: 'old', stat: { mtimeMs: 2 }, starred: false },
  ];
  assert.deepEqual(
    selectBackupsToPrune(backups, 2).map(item => item.name),
    ['old'],
  );
});

test('backup retention defaults to seven days and supports the administrator options', () => {
  assert.equal(DEFAULT_MAX_BACKUPS, 7);
  const backups = Array.from({ length: 10 }, (_, index) => ({ name: String(index), stat: { mtimeMs: index } }));
  assert.equal(selectBackupsToPrune(backups).length, 3);
});

test('backup options include disabled and three-day retention', () => {
  const { ALLOWED_MAX_BACKUPS } = require('../server/services/databaseBackup.cjs');
  assert.deepEqual(ALLOWED_MAX_BACKUPS, [0, 3, 7, 14, 30]);
});

test('business backup token has embedded metadata and rejects legacy database files', () => {
  const createdAt = new Date(2026, 6, 18, 0, 0, 5);
  const token = createBackupToken('A', '2026-07-17', createdAt);
  assert.match(token, /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)[0-9A-Za-z]{18}$/);
  const name = `${token}${BUSINESS_BACKUP_SUFFIX}`;
  const parsed = parseBackupToken(name);
  assert.equal(parsed.type, 'automatic');
  assert.equal(parsed.dataDate, '2026-07-17');
  assert.equal(parsed.createdAt.getTime(), Math.floor(createdAt.getTime() / 1000) * 1000);
  assert.equal(isBackupFileName(name), true);
  assert.equal(isBackupFileName(`${token}.db`), false);
  const replacement = token.endsWith('0') ? '1' : '0';
  assert.equal(parseBackupToken(`${token.slice(0, -1)}${replacement}${BUSINESS_BACKUP_SUFFIX}`), null);
});

test('business backup restores only projects, worklogs, snapshots and business settings', async () => {
  const SQL = await initSqlJs();
  const makeDb = () => {
    const db = new SQL.Database();
    db.run('CREATE TABLE users(id TEXT PRIMARY KEY,display_name TEXT)');
    db.run('CREATE TABLE products(id TEXT PRIMARY KEY,data TEXT,created_by TEXT,updated_at TEXT)');
    db.run('CREATE TABLE entries(id TEXT PRIMARY KEY,data TEXT,created_by TEXT,updated_at TEXT,week_key TEXT)');
    db.run('CREATE TABLE entry_snapshots(id TEXT PRIMARY KEY,week_key TEXT,entry_id TEXT,data TEXT,created_by TEXT,snapshot_at TEXT)');
    db.run('CREATE TABLE settings(id TEXT PRIMARY KEY,data TEXT,updated_at TEXT)');
    db.run('CREATE TABLE tasks(id TEXT PRIMARY KEY,data TEXT)');
    return db;
  };
  const source = makeDb();
  source.run("INSERT INTO users VALUES ('source-user','来源用户')");
  source.run("INSERT INTO products VALUES ('p1','{\"productName\":\"备份项目\"}','source-user','2026-08-03')");
  source.run("INSERT INTO entries VALUES ('e1','{\"productName\":\"备份周报\"}','source-user','2026-08-03','260807')");
  source.run("INSERT INTO entry_snapshots VALUES ('s1','260731','e1','{\"productName\":\"历史周报\"}','source-user','2026-08-01')");
  source.run("INSERT INTO settings VALUES ('main','{\"statusConfigs\":[]}','2026-08-03'),('worklog_week_rollover','{\"lastRolloverWeekKey\":\"260807\"}','2026-08-03'),('secret-setting','{\"keep\":true}','2026-08-03')");
  source.run("INSERT INTO tasks VALUES ('source-task','{\"title\":\"不应备份\"}')");

  const backup = validateBusinessBackup(buildBusinessBackup(source, { now: new Date('2026-08-03T08:00:00.000Z'), dataDate: '2026-08-03' }));
  assert.deepEqual(backup.scope, ['products', 'entries', 'entry_snapshots', 'business_settings']);
  assert.equal(backup.tables.settings.some(row => row.id === 'secret-setting'), false);

  const target = makeDb();
  target.run("INSERT INTO users VALUES ('target-user','当前用户')");
  target.run("INSERT INTO products VALUES ('old','{\"productName\":\"旧项目\"}','target-user','2026-08-02')");
  target.run("INSERT INTO tasks VALUES ('target-task','{\"title\":\"必须保留\"}')");
  target.run("INSERT INTO settings VALUES ('secret-setting','{\"keep\":true}','2026-08-03')");
  applyBusinessBackupToDb(target, backup);

  assert.equal(target.exec('SELECT COUNT(*) FROM products')[0].values[0][0], 1);
  assert.equal(target.exec("SELECT id FROM products")[0].values[0][0], 'p1');
  assert.equal(target.exec('SELECT COUNT(*) FROM entries')[0].values[0][0], 1);
  assert.equal(target.exec('SELECT COUNT(*) FROM entry_snapshots')[0].values[0][0], 1);
  assert.equal(target.exec("SELECT id FROM users")[0].values[0][0], 'target-user');
  assert.equal(target.exec("SELECT id FROM tasks")[0].values[0][0], 'target-task');
  assert.equal(target.exec("SELECT COUNT(*) FROM settings WHERE id='secret-setting'")[0].values[0][0], 1);
  source.close();
  target.close();
});

test('restore validation rejects databases missing application tables', async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('CREATE TABLE unrelated(id TEXT)');
  const buffer = Buffer.from(db.export());
  db.close();
  await assert.rejects(() => validateDatabaseBuffer(buffer), /缺少必要的数据表/);
});
