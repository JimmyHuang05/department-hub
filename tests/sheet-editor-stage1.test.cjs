const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('stage one exposes an authenticated fullscreen editor route with mobile-only global navigation', () => {
  const app = read('src/App.tsx');
  const fullscreenRoute = read('src/components/Layout/FullscreenProtectedRoute.tsx');

  assert.match(app, /path="\/sheet-editor\/:fileId"/);
  assert.match(app, /FullscreenProtectedRoute/);
  assert.match(fullscreenRoute, /Navigate to="\/login"/);
  assert.match(fullscreenRoute, /<Sidebar mobileOnly \/>/);
  assert.doesNotMatch(fullscreenRoute, /<Sidebar\s*\/>/);
});

test('FortuneSheet is isolated behind a second lazy boundary', () => {
  const page = read('src/pages/SheetEditorPage.tsx');
  const workbook = read('src/modules/sheet-editor/SheetEditorWorkbook.tsx');

  assert.match(page, /lazy\(\(\) => loadPageWithRecovery/);
  assert.match(page, /SheetEditorBoundary/);
  assert.match(page, /SheetEditorWorkbook/);
  assert.match(workbook, /@fortune-sheet\/react/);
  assert.match(workbook, /data-testid="sheet-editor-workbook"/);
});
