const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('immutable versions are isolated by a hashed file bucket and tracked in the editor database', () => {
  const store = read('server/services/sheetEditorStore.cjs');

  assert.match(store, /CREATE TABLE IF NOT EXISTS sheet_versions/);
  assert.match(store, /idx_sheet_versions_file/);
  assert.match(store, /createHash\('sha256'\)\.update\(String\(fileId\)\)/);
  assert.match(store, /COPYFILE_EXCL/);
  assert.match(store, /fs\.fsyncSync\(descriptor\)/);
  assert.match(store, /actualChecksum/);
  assert.match(store, /listSheetVersions/);
  assert.match(store, /getSheetVersion/);
});

test('normal save snapshots and rechecks the source before replacement', () => {
  const route = read('server/routes/sheet-editor.cjs');
  const saveStart = route.indexOf("router.put(");
  const versionsStart = route.indexOf("router.get('/:fileId/versions'");
  const saveBlock = route.slice(saveStart, versionsStart);

  assert.match(saveBlock, /reason: 'auto_save'/);
  assert.ok(saveBlock.indexOf('await createSheetVersion') < saveBlock.indexOf('fs.renameSync(tempPath, source.filePath)'));
  assert.match(saveBlock, /备份期间源文件已发生变化/);
});

test('restore requires session, write lock, optimistic version, and backup of the current file', () => {
  const route = read('server/routes/sheet-editor.cjs');

  assert.match(route, /versions\/:versionId\/restore/);
  assert.match(route, /session\.mode !== 'edit'/);
  assert.match(route, /validateSheetLock/);
  assert.match(route, /currentChecksum !== expectedChecksum \|\| currentRevision !== expectedRevision/);
  assert.match(route, /checksumFile\(version\.filePath\) !== version\.checksum/);
  assert.match(route, /reason: 'before_restore'/);
  assert.match(route, /sheet-editor\.restore/);
});

test('the editor exposes authenticated version listing, download, and guarded restore', () => {
  const workbook = read('src/modules/sheet-editor/SheetEditorWorkbook.tsx');

  assert.match(workbook, /历史版本/);
  assert.match(workbook, /\/versions\?limit=50/);
  assert.match(workbook, /\/download`/);
  assert.match(workbook, /URL\.createObjectURL/);
  assert.match(workbook, /当前版本会先自动备份/);
  assert.match(workbook, /dirtyRef\.current/);
  assert.match(workbook, /'X-Sheet-Expected-Checksum'/);
  assert.match(workbook, /window\.location\.reload\(\)/);
});
