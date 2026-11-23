const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('project batch field updates are authenticated, bounded and atomic', () => {
  const source = read('server/routes/products.cjs');
  assert.match(source, /router\.put\('\/batch-fields', authMiddleware, requireRole\('user', 'admin'\)/);
  assert.match(source, /changes\.length > 5000/);
  assert.match(source, /getEditingLockOwner\('project'/);
  assert.match(source, /db\.run\('BEGIN'\)/);
  assert.match(source, /db\.run\('COMMIT'\)/);
  assert.match(source, /db\.run\('ROLLBACK'\)/);
  assert.match(source, /saveDbImmediate\(\)/);
});

test('collaboration hub owns expiring project field locks', () => {
  const source = read('server/ws/hub.cjs');
  const vite = read('vite.config.ts');
  assert.match(source, /const editingLocks = new Map\(\)/);
  assert.match(source, /EDITING_LOCK_TTL = 15000/);
  assert.match(source, /type: 'editing-lock-result'/);
  assert.match(source, /granted: false/);
  assert.match(source, /releaseClientLocks\(\)/);
  assert.match(source, /getEditingLockOwner/);
  assert.match(vite, /'\/ws'[\s\S]*target: 'ws:\/\/127\.0\.0\.1:3000'[\s\S]*ws: true/);
});

test('custom project table exposes validation preview, remote cursors and fill handle', () => {
  const source = read('src/components/ProjectExcelView.tsx');
  assert.match(source, /requestEditingLock/);
  assert.match(source, /cellLock\(product\.id, column\.key\)/);
  assert.match(source, /title="粘贴内容需要检查"/);
  assert.match(source, /仅应用合法项/);
  assert.match(source, /project-sheet__remote-label/);
  assert.match(source, /project-sheet__fill-handle/);
  assert.match(source, /completeFillDrag/);
});

test('project spreadsheet persists transactions and exposes row and import conflict actions', () => {
  const route = read('server/routes/products.cjs');
  const db = read('server/db.cjs');
  const sheet = read('src/components/ProjectExcelView.tsx');
  const importModal = read('src/components/DataTable/ImportModal.tsx');
  assert.match(db, /CREATE TABLE IF NOT EXISTS product_transactions/);
  assert.match(route, /router\.get\('\/transactions'/);
  assert.match(route, /transactions\/:id\/undo/);
  assert.match(route, /transactions\/:id\/redo/);
  assert.match(route, /相关单元格已被后续修改/);
  assert.match(sheet, /表格事务历史/);
  assert.match(sheet, /复制整行数据/);
  assert.match(sheet, /复制为新项目/);
  assert.match(sheet, /startSelectionAutoScroll/);
  assert.match(sheet, /viewport\.scrollBy/);
  assert.match(sheet, /document\.elementFromPoint/);
  assert.match(sheet, /closest\('\.project-sheet-select-panel'\)/);
  assert.match(sheet, /data-sheet-function=\{column\.type\}[\s\S]*onMouseDown=\{event =>/);
  assert.match(importModal, /冲突更新/);
  assert.match(importModal, /conflictPreview/);
});

test('project page keeps the legacy FortuneSheet implementation while hiding its mode entry', () => {
  const page = read('src/pages/ProjectList.tsx');
  const preferences = read('src/store/uiPreferenceStore.ts');
  assert.match(page, /ProjectFortuneSheetModule/);
  assert.doesNotMatch(page, /changeDisplayMode\('fs'\)/);
  assert.doesNotMatch(page, />\s*FS\s*<\/button>/);
  assert.match(preferences, /'cards' \| 'table' \| 'fs'/);
  assert.match(preferences, /legacyViewMode === 'fs'[\s\S]*\? 'table'/);
});

test('project spreadsheet exposes an FS-style editor bar with persisted format transactions', () => {
  const route = read('server/routes/products.cjs');
  const db = read('server/db.cjs');
  const sheet = read('src/components/ProjectExcelView.tsx');
  assert.match(db, /CREATE TABLE IF NOT EXISTS product_cell_formats/);
  assert.match(route, /router\.get\('\/cell-formats'/);
  assert.match(route, /router\.put\('\/cell-formats'/);
  assert.match(route, /kind: 'format'/);
  assert.match(sheet, /project-sheet-toolbar/);
  assert.match(sheet, /aria-label="单元格内容编辑栏"/);
  assert.match(sheet, /applyFormatPatch/);
  assert.match(sheet, /searchMatches/);
  assert.match(sheet, /formatToolbarMenu === 'number'[\s\S]*货币 ￥/);
  assert.match(sheet, /自动换行/);
  assert.match(sheet, /设置字体颜色/);
  assert.match(sheet, /设置填充颜色/);
  assert.match(sheet, /格式刷/);
  assert.match(sheet, /粘贴格式/);
  assert.match(sheet, /清除格式/);
  assert.match(sheet, /Ctrl\+Shift\+C|control && event\.shiftKey && event\.key\.toLowerCase\(\) === 'c'/);
  assert.match(sheet, /applyBorderPreset/);
  assert.match(sheet, /borderTop\?: boolean/);
  assert.match(sheet, /borderLineStyle/);
  assert.match(sheet, /microsoft-yahei/);
  assert.match(sheet, /is-mixed/);
  assert.match(sheet, /FormatToolbarMenu/);
  assert.match(sheet, /toggleFormatToolbarMenu/);
  assert.match(sheet, /formatToolbarMenu === 'number'/);
  assert.match(sheet, /formatToolbarMenu === 'borders'/);
  assert.match(sheet, /formatToolbarMenu === 'alignment'/);
  assert.doesNotMatch(sheet, /h-11 items-center gap-1 overflow-x-auto/);
  assert.match(sheet, /onDoubleClick=\{event => \{[\s\S]*beginEdit\(rowIndex, colIndex\)/);
});

test('project spreadsheet keeps the column filter open while its value list scrolls', () => {
  const source = read('src/components/ProjectExcelView.tsx');
  assert.match(source, /target\.closest\('\[data-project-sheet-filter-menu\]'\)/);
  assert.match(source, /addEventListener\('scroll', handleScroll, true\)/);
  assert.doesNotMatch(source, /if \(!filterMenu\)[\s\S]{0,900}addEventListener\('scroll', close, true\)/);
});
