const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('sheet editor sessions are stored separately with opaque hashed tokens', () => {
  const paths = read('server/paths.cjs');
  const store = read('server/services/sheetEditorStore.cjs');

  assert.match(paths, /SHEET_EDITOR_DB_PATH/);
  assert.match(store, /randomBytes\(32\)\.toString\('base64url'\)/);
  assert.match(store, /token_hash TEXT NOT NULL/);
  assert.match(store, /createHash\('sha256'\)/);
  assert.match(store, /timingSafeEqual/);
  assert.match(store, /30 \* 60 \* 1000/);
  assert.match(store, /status='superseded'/);
  assert.match(store, /fs\.renameSync\(tempPath, SHEET_EDITOR_DB_PATH\)/);
  assert.doesNotMatch(store, /token TEXT/);
});

test('source delivery requires authentication and a file-bound editor session', () => {
  const route = read('server/routes/sheet-editor.cjs');
  const server = read('server/index.cjs');

  assert.match(server, /app\.use\('\/api\/sheet-editor'/);
  assert.match(route, /router\.post\('\/:fileId\/session', authMiddleware, requireRole/);
  assert.match(route, /router\.get\('\/:fileId\/source', authMiddleware/);
  assert.match(route, /x-sheet-session-id/);
  assert.match(route, /x-sheet-session-token/);
  assert.match(route, /fileId: req\.params\.fileId/);
  assert.match(route, /userId: req\.user\.id/);
  assert.match(route, /deletedAt/);
  assert.match(route, /\.toLowerCase\(\) !== '\.xlsx'/);
  assert.match(route, /private, no-store, max-age=0/);
  assert.match(route, /path\.basename\(rawName\)/);
});

test('the client establishes a session before loading the workbook', () => {
  const page = read('src/pages/SheetEditorPage.tsx');

  assert.match(page, /api\.post<SheetEditorSession>/);
  assert.match(page, /\/session`, \{ mode: 'edit' \}/);
  assert.match(page, /!session \? \(/);
  assert.match(page, /正在建立安全读取会话/);
  assert.doesNotMatch(page, /localStorage.*sessionToken/);
  assert.doesNotMatch(page, /\/source.*fetch/);
});
