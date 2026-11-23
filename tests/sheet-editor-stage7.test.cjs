const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('edits use a debounced single-flight autosave pipeline', () => {
  const workbook = read('src/modules/sheet-editor/SheetEditorWorkbook.tsx');

  assert.match(workbook, /scheduleAutoSave = useCallback\(\(delay = 4000\)/);
  assert.match(workbook, /saveInFlightRef\.current/);
  assert.match(workbook, /if \(readOnly \|\| !dirtyRef\.current \|\| saveInFlightRef\.current \|\| conflictRef\.current\) return/);
  assert.match(workbook, /saveRef\.current\('auto'\)/);
  assert.match(workbook, /clearSaveTimers\(\)/);
});

test('a completed request cannot clear edits made while that request was running', () => {
  const workbook = read('src/modules/sheet-editor/SheetEditorWorkbook.tsx');

  assert.match(workbook, /editGenerationRef\.current \+= 1/);
  assert.match(workbook, /const savingGeneration = editGenerationRef\.current/);
  assert.match(workbook, /structuredClone\(draftSheetsRef\.current\)/);
  assert.match(workbook, /editGenerationRef\.current === savingGeneration/);
  assert.match(workbook, /scheduleAutoSave\(1000\)/);
});

test('offline and transient failures preserve dirty state and retry safely', () => {
  const workbook = read('src/modules/sheet-editor/SheetEditorWorkbook.tsx');

  assert.match(workbook, /navigator\.onLine === false/);
  assert.match(workbook, /addEventListener\('online'/);
  assert.match(workbook, /addEventListener\('offline'/);
  assert.match(workbook, /saveRef\.current\('retry'\)/);
  assert.match(workbook, /}, 10000\)/);
  assert.match(workbook, /conflictRef\.current = true/);
});

test('unsaved changes protect reload, close, and editor file switching', () => {
  const workbook = read('src/modules/sheet-editor/SheetEditorWorkbook.tsx');
  const page = read('src/pages/SheetEditorPage.tsx');

  assert.match(workbook, /addEventListener\('beforeunload'/);
  assert.match(workbook, /event\.preventDefault\(\)/);
  assert.match(workbook, /event\.returnValue = ''/);
  assert.match(page, /confirm: ask/);
  assert.match(page, /当前表格仍有修改尚未保存，切换后这些修改可能丢失/);
  assert.match(page, /当前表格仍有修改尚未保存，新建表格后这些修改可能丢失/);
  assert.doesNotMatch(page, /停止编辑 4 秒后自动保存/);
  assert.doesNotMatch(workbook, /onClick=\{\(\) => void save\('manual'\)\}/);
});
