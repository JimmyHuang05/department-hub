const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

test('single selected project uses the ownership-aware single delete endpoint', () => {
  const page = read('src/pages/ProjectList.tsx');
  const store = read('src/store/projectStore.ts');
  assert.match(page, /if \(ids\.length === 1\)[\s\S]*await deleteProduct\(ids\[0\]\)/);
  assert.match(store, /api\.delete\(`\/products\/\$\{id\}`\)/);
});

test('project deletion accepts creator, assigned managers, or administrator', () => {
  const route = read('server/routes/products.cjs');
  assert.match(route, /user\.role === 'admin' \|\| productRow\.created_by === user\.id/);
  assert.match(route, /\[product\.trustManager, product\.trustManagerB\]/);
  assert.match(route, /仅项目创建人、信托经理 A\/B 或高级用户可以删除该项目/);
});

test('fortune sheet exposes delete row through the shared confirmation flow', () => {
  const view = read('src/modules/project-fortune-sheet/ProjectFortuneSheetView.tsx');
  const page = read('src/pages/ProjectList.tsx');
  assert.match(view, /key: 'delete-row'/);
  assert.match(view, /onDeleteRow\(data\[selectedRow - 1\]\)/);
  assert.match(page, /onDeleteRow=\{product => requestDeleteProject\(product\)\}/);
});

test('project context menus remain inside the viewport', () => {
  const excel = read('src/components/ProjectExcelView.tsx');
  const sharedMenu = read('src/components/Layout/ContextMenu.tsx');
  assert.match(excel, /maxHeight: 'calc\(100dvh - 16px\)'/);
  assert.match(excel, /overflowY: 'auto'/);
  assert.match(sharedMenu, /maxHeight: 'calc\(100dvh - 16px\)'/);
});
