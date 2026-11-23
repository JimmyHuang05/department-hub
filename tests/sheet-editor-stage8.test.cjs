const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('the editor store grants one expiring write lease per file', () => {
  const store = read('server/services/sheetEditorStore.cjs');

  assert.match(store, /LOCK_LEASE_MS = 90 \* 1000/);
  assert.match(store, /CREATE TABLE IF NOT EXISTS sheet_locks/);
  assert.match(store, /file_id TEXT PRIMARY KEY/);
  assert.match(store, /activeLock\.user_id === userId/);
  assert.match(store, /\? 'edit' : 'readonly'/);
  assert.match(store, /heartbeatSheetLock/);
  assert.match(store, /releaseSheetLock/);
  assert.match(store, /Date\.parse\(lock\.expires_at\) <= Date\.now\(\)/);
});

test('save authorization checks current lock ownership in addition to the session', () => {
  const route = read('server/routes/sheet-editor.cjs');

  assert.match(route, /validateSheetLock\(\{ sessionId: session\.id, fileId: req\.params\.fileId, userId: req\.user\.id \}\)/);
  assert.match(route, /status\(423\)/);
  assert.match(route, /SHEET_LOCK_LOST/);
  assert.match(route, /lock\/heartbeat/);
  assert.match(route, /router\.delete\('\/:fileId\/lock'/);
});

test('the client renews and releases its lease and degrades safely when it is lost', () => {
  const workbook = read('src/modules/sheet-editor/SheetEditorWorkbook.tsx');

  assert.match(workbook, /setInterval\(\(\) => void heartbeat\(\), 25000\)/);
  assert.match(workbook, /method: 'POST'/);
  assert.match(workbook, /method: 'DELETE'/);
  assert.match(workbook, /keepalive: true/);
  assert.match(workbook, /addEventListener\('pagehide', release\)/);
  assert.match(workbook, /response\.status === 423/);
  assert.match(workbook, /setLockLost\(true\)/);
  assert.match(workbook, /allowEdit=\{!readOnly\}/);
  assert.match(workbook, /showToolbar=\{!readOnly\}/);
});

test('a concurrent viewer sees who owns the edit lease', () => {
  const page = read('src/pages/SheetEditorPage.tsx');
  const workbook = read('src/modules/sheet-editor/SheetEditorWorkbook.tsx');

  assert.match(page, /lock: \{ ownerName: string; expiresAt: string \} \| null/);
  assert.match(page, /其他用户.*正在编辑此文件/);
  assert.match(page, /lockOwnerName=\{session\.lock\?\.ownerName/);
  assert.match(workbook, /只读模式/);
  assert.match(workbook, /lockOwnerName/);
});
