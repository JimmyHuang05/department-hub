const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('editor endpoints have scoped rate limits and consistent security headers', () => {
  const route = read('server/routes/sheet-editor.cjs');

  for (const limiter of ['sessionLimiter', 'saveLimiter', 'historyLimiter', 'restoreLimiter', 'heartbeatLimiter']) {
    assert.match(route, new RegExp(`const ${limiter} = createRateLimiter`));
  }
  assert.match(route, /X-Content-Type-Options', 'nosniff'/);
  assert.match(route, /Referrer-Policy', 'no-referrer'/);
  assert.match(route, /Cache-Control', 'no-store'/);
  assert.match(route, /router\.get\('\/:fileId\/source', authMiddleware, requireRole/);
  assert.match(route, /router\.delete\('\/:fileId\/lock', authMiddleware, requireRole/);
});

test('server rejects oversized, highly expanded, or overly complex workbooks before granting a lock', () => {
  const route = read('server/routes/sheet-editor.cjs');
  const sessionBlock = route.slice(route.indexOf("router.post('/:fileId/session'"), route.indexOf('router.put('));

  assert.match(route, /MAX_EDITOR_FILE_BYTES/);
  assert.match(route, /MAX_EDITOR_EXPANDED_BYTES = 200 \* 1024 \* 1024/);
  assert.match(route, /MAX_EDITOR_ZIP_ENTRIES = 5000/);
  assert.match(route, /MAX_EDITOR_SHEETS = 64/);
  assert.match(route, /MAX_EDITOR_CELLS = 2_000_000/);
  assert.match(route, /JSZip\.loadAsync/);
  assert.match(route, /parseSheetContent/);
  assert.ok(sessionBlock.indexOf('validateWorkbookComplexity') < sessionBlock.indexOf('createSheetSession'));
});

test('client conversion bounds workbook structure and iterates only populated cells', () => {
  const converter = read('src/modules/sheet-editor/xlsxToFortuneSheet.ts');

  assert.match(converter, /MAX_RANGE_CELLS = 2_000_000/);
  assert.match(converter, /MAX_POPULATED_CELLS = 500_000/);
  assert.match(converter, /MAX_ROWS = 200_000/);
  assert.match(converter, /for \(const address of Object\.keys\(worksheet\)\)/);
  assert.doesNotMatch(converter, /row <= range\.e\.r/);
});

test('sessions and immutable versions have bounded retention', () => {
  const store = read('server/services/sheetEditorStore.cjs');

  assert.match(store, /VERSION_RETENTION_COUNT = 30/);
  assert.match(store, /VERSION_RETENTION_MS = 90 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(store, /pruneSheetVersions/);
  assert.match(store, /DELETE FROM sheet_locks WHERE expires_at<=/);
  assert.match(store, /DELETE FROM sheet_sessions WHERE status!='active'/);
});

test('editor access and version download are auditable and use a dedicated error-code module', () => {
  const route = read('server/routes/sheet-editor.cjs');
  const errors = read('server/services/errorCodes.cjs');

  assert.match(route, /sheet-editor\.session\.open/);
  assert.match(route, /sheet-editor\.version\.download/);
  assert.match(route, /sheet-editor\.save/);
  assert.match(route, /sheet-editor\.restore/);
  assert.match(errors, /\['\/api\/sheet-editor', 'SHT'\]/);
});
