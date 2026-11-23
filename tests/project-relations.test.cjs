const test = require('node:test');
const assert = require('node:assert/strict');
const initSqlJs = require('sql.js');
const { migrateProjectRelations } = require('../server/services/projectRelations.cjs');

test('relation migration links unique names and leaves duplicates unresolved', async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('CREATE TABLE products(id TEXT PRIMARY KEY,data TEXT)');
  db.run('CREATE TABLE entries(id TEXT PRIMARY KEY,data TEXT)');
  db.run('CREATE TABLE entry_snapshots(id TEXT PRIMARY KEY,data TEXT)');
  db.run('CREATE TABLE clouddrive_files(id TEXT PRIMARY KEY,data TEXT)');
  db.run('INSERT INTO products VALUES(?,?)', ['p1', JSON.stringify({ productName: '唯一项目' })]);
  db.run('INSERT INTO products VALUES(?,?)', ['p2', JSON.stringify({ productName: '重复项目' })]);
  db.run('INSERT INTO products VALUES(?,?)', ['p3', JSON.stringify({ productName: '重复项目' })]);
  db.run('INSERT INTO entries VALUES(?,?)', ['e1', JSON.stringify({ productName: '唯一项目' })]);
  db.run('INSERT INTO entries VALUES(?,?)', ['e2', JSON.stringify({ productName: '重复项目' })]);
  db.run('INSERT INTO clouddrive_files VALUES(?,?)', ['f1', JSON.stringify({ fileName: '唯一项目-合同.pdf' })]);
  const result = migrateProjectRelations(db);
  assert.equal(result.entriesLinked, 1);
  assert.equal(result.filesLinked, 1);
  const entries = db.exec('SELECT data FROM entries ORDER BY id')[0].values.map(row => JSON.parse(row[0]));
  assert.equal(entries[0].projectId, 'p1');
  assert.equal(entries[1].projectId, undefined);
  db.close();
});
