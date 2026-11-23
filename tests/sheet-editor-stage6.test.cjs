const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('save requires an editable file-bound session and exact source version', () => {
  const route = read('server/routes/sheet-editor.cjs');

  assert.match(route, /router\.put\(/);
  assert.match(route, /'\/:fileId\/content'/);
  assert.match(route, /session\.mode !== 'edit'/);
  assert.match(route, /x-sheet-expected-checksum/);
  assert.match(route, /x-sheet-expected-revision/);
  assert.match(route, /currentChecksum !== expectedChecksum \|\| currentRevision !== expectedRevision/);
  assert.match(route, /status\(409\)/);
  assert.match(route, /SHEET_VERSION_CONFLICT/);
});

test('save validates XLSX content and atomically replaces the source', () => {
  const route = read('server/routes/sheet-editor.cjs');

  assert.match(route, /MAX_EDITOR_FILE_BYTES/);
  assert.match(route, /req\.body\[0\] !== 0x50/);
  assert.match(route, /XLSX\.read\(req\.body/);
  assert.match(route, /SheetNames\?\.length/);
  assert.match(route, /fs\.openSync\(tempPath, 'wx', 0o600\)/);
  assert.match(route, /fs\.fsyncSync\(descriptor\)/);
  assert.match(route, /fs\.renameSync\(tempPath, source\.filePath\)/);
  assert.match(route, /saveDbImmediate\(\)/);
  assert.match(route, /sheet-editor\.save/);
});

test('client serializes the live workbook and advances its version only after success', () => {
  const workbook = read('src/modules/sheet-editor/SheetEditorWorkbook.tsx');
  const serializer = read('src/modules/sheet-editor/fortuneSheetToXlsx.ts');

  assert.match(workbook, /serializeFortuneSheetWorkbook\(savingSheets\)/);
  assert.match(workbook, /method: 'PUT'/);
  assert.match(workbook, /'X-Sheet-Expected-Checksum'/);
  assert.match(workbook, /'X-Sheet-Expected-Revision'/);
  assert.match(workbook, /response\.status === 409/);
  assert.match(workbook, /versionRef\.current = \{ checksum: result\.checksum, revision: result\.revision \}/);
  assert.match(serializer, /XLSX\.write\(workbook/);
  assert.match(serializer, /cell\.f\.replace\(\/\^=\//);
  assert.match(serializer, /worksheet\['!merges'\]/);
  assert.match(serializer, /worksheet\['!cols'\]/);
  assert.match(serializer, /worksheet\['!rows'\]/);
});

test('CORS explicitly permits optimistic-concurrency headers', () => {
  const server = read('server/index.cjs');
  assert.match(server, /X-Sheet-Expected-Checksum/);
  assert.match(server, /X-Sheet-Expected-Revision/);
});
