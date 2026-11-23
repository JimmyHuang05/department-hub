const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('FortuneSheet enables core editing, formulas, formatting, and sheet operations', () => {
  const workbook = read('src/modules/sheet-editor/SheetEditorWorkbook.tsx');

  assert.match(workbook, /allowEdit/);
  assert.match(workbook, /showToolbar/);
  assert.match(workbook, /showFormulaBar/);
  assert.match(workbook, /showSheetTabs/);
  assert.match(workbook, /forceCalculation/);
  for (const action of ['undo', 'redo', 'clear-format', 'bold', 'border', 'merge-cell', 'text-wrap', 'freeze', 'quick-formula']) {
    assert.match(workbook, new RegExp(`'${action}'`));
  }
  assert.match(workbook, /afterAddSheet/);
  assert.match(workbook, /afterDeleteSheet/);
  assert.match(workbook, /afterUpdateSheetName/);
});

test('local edits are detected while routine autosave status stays silent', () => {
  const page = read('src/pages/SheetEditorPage.tsx');
  const workbook = read('src/modules/sheet-editor/SheetEditorWorkbook.tsx');

  assert.match(workbook, /onOp=\{handleWorkbookOp\}/);
  assert.match(workbook, /onDirtyChange\(true\)/);
  assert.match(workbook, /onDirtyChange\(false\)/);
  assert.match(page, /const \[dirty, setDirty\]/);
  assert.doesNotMatch(page, /sheet-editor-page__status/);
  assert.doesNotMatch(workbook, /已自动保存到云盘/);
});

test('xlsx compatibility includes hidden structure, links, and both Excel date systems', () => {
  const converter = read('src/modules/sheet-editor/xlsxToFortuneSheet.ts');

  assert.match(converter, /colhidden/);
  assert.match(converter, /rowhidden/);
  assert.match(converter, /workbook\.Workbook\?\.Sheets/);
  assert.match(converter, /source\.l\?\.Target/);
  assert.match(converter, /linkType:/);
  assert.match(converter, /WBProps\?\.date1904/);
  assert.match(converter, /Date\.UTC\(1904, 0, 1\)/);
  assert.match(converter, /Date\.UTC\(1899, 11, 30\)/);
});

test('stage five tracks edits independently from transport', () => {
  const workbook = read('src/modules/sheet-editor/SheetEditorWorkbook.tsx');
  assert.match(workbook, /draftSheetsRef/);
  assert.match(workbook, /markDirty/);
});
