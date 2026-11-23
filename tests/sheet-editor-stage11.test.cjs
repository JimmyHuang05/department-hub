const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('mobile editor styling is isolated to the phone breakpoint', () => {
  const css = read('src/styles/sheet-editor.css');
  const page = read('src/pages/SheetEditorPage.tsx');
  const workbook = read('src/modules/sheet-editor/SheetEditorWorkbook.tsx');

  assert.match(css, /@media \(max-width: 767px\)/);
  assert.match(page, /sheet-editor-page__header/);
  assert.match(page, /sheet-editor-page__file-meta/);
  assert.doesNotMatch(page, /sheet-editor-page__status/);
  assert.match(workbook, /sheet-editor-workbook__actions/);
  assert.match(css, /overflow-x: auto/);
  assert.match(css, /scrollbar-width: none/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
});

test('version history becomes a touch-friendly bottom sheet on mobile', () => {
  const css = read('src/styles/sheet-editor.css');
  const workbook = read('src/modules/sheet-editor/SheetEditorWorkbook.tsx');

  assert.match(workbook, /sheet-editor-workbook__history/);
  assert.match(workbook, /sheet-editor-workbook__history-list/);
  assert.match(css, /position: fixed/);
  assert.match(css, /inset: auto 0 0 0/);
  assert.match(css, /72dvh/);
});

test('session, source, and expired-lock failures have explicit recovery paths', () => {
  const page = read('src/pages/SheetEditorPage.tsx');
  const workbook = read('src/modules/sheet-editor/SheetEditorWorkbook.tsx');

  assert.match(page, /sessionAttempt/);
  assert.match(page, /重新连接/);
  assert.match(workbook, /重新加载/);
  assert.match(workbook, /response\.status === 401 \|\| response\.status === 403/);
  assert.match(workbook, /\[401, 403, 423\]\.includes\(response\.status\)/);
  assert.match(workbook, /setSessionExpired\(true\)/);
  assert.match(workbook, /sheet-editor-workbook__expired/);
  assert.match(workbook, /LockKeyhole/);
});

test('desktop sizing remains outside the mobile override', () => {
  const css = read('src/styles/sheet-editor.css');
  const outsideMedia = css.slice(0, css.indexOf('@media'));
  assert.equal(outsideMedia.trim(), '');
});

test('file menu creates workbooks and lists editable cloud xlsx files after a divider', () => {
  const page = read('src/pages/SheetEditorPage.tsx');
  const createIndex = page.indexOf('新建表格');
  const dividerIndex = page.indexOf('role="separator"');
  const listIndex = page.indexOf('可编辑表格');

  assert.ok(createIndex >= 0 && createIndex < dividerIndex && dividerIndex < listIndex);
  assert.match(page, /api\.get<\{ items: CloudSheetFile\[\] \}>\('\/clouddrive'\)/);
  assert.match(page, /endsWith\('\.xlsx'\)/);
  assert.match(page, /XLSX\.utils\.book_new\(\)/);
  assert.match(page, /fetch\('\/api\/clouddrive\/upload'/);
});

test('editor title hides the xlsx suffix without changing the stored file name', () => {
  const page = read('src/pages/SheetEditorPage.tsx');
  assert.match(page, /function sheetTitle\(fileName\?: string\)/);
  assert.match(page, /replace\(\/\\\.xlsx\$\/i, ''\)/);
  assert.match(page, /sheetTitle\(session\?\.file\.name \|\| matchingState\?\.fileName\)/);
  assert.match(page, /setRenameValue\(currentName\)/);
});

test('workbook props stay referentially stable while a cell is being edited', () => {
  const workbook = read('src/modules/sheet-editor/SheetEditorWorkbook.tsx');

  assert.match(workbook, /const WORKBOOK_TOOLBAR_ITEMS = \[/);
  assert.match(workbook, /const handleWorkbookChange = useCallback/);
  assert.match(workbook, /const handleWorkbookOp = useCallback/);
  assert.match(workbook, /const workbookHooks = useMemo/);
  assert.match(workbook, /onChange=\{handleWorkbookChange\}/);
  assert.match(workbook, /onOp=\{handleWorkbookOp\}/);
  assert.match(workbook, /hooks=\{workbookHooks\}/);
  assert.match(workbook, /toolbarItems=\{WORKBOOK_TOOLBAR_ITEMS\}/);
});
