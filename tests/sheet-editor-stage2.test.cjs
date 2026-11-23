const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('cloud drive exposes online editing only for active xlsx files', () => {
  const cloudDrive = read('src/pages/CloudDrive.tsx');

  assert.match(cloudDrive, /file\.name\.toLowerCase\(\)\.endsWith\('\.xlsx'\)/);
  assert.match(cloudDrive, /!showTrash && file\.kind === 'file'/);
  assert.match(cloudDrive, /key: 'online-edit', label: '在线编辑'/);
  assert.match(cloudDrive, /window\.open\(`\/sheet-editor\/\$\{encodeURIComponent\(file\.id\)\}`/);
  assert.match(cloudDrive, /'noopener,noreferrer'/);
});

test('cloud drive state is remembered per user and reused by the editor file menu', () => {
  const cloudDrive = read('src/pages/CloudDrive.tsx');
  const editor = read('src/pages/SheetEditorPage.tsx');
  const state = read('src/utils/cloudDriveEditorState.ts');

  for (const field of ['folderId', 'search', 'sortKey', 'sortDirection', 'viewMode', 'scrollTop', 'windowScrollY']) {
    assert.match(cloudDrive, new RegExp(`${field}(?:\\s*:|\\s*[,}])`));
  }
  assert.match(state, /stateKey\(userId\)/);
  assert.match(state, /readPageSnapshot<CloudDriveEditorState>/);
  assert.match(state, /STATE_TTL_MS = 2 \* 60 \* 60 \* 1000/);
  assert.match(editor, /readCloudDriveEditorState/);
  assert.match(editor, /matchingState\?\.fileName/);
  assert.match(editor, /matchingState\?\.folderId/);
});
