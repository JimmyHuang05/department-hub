const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('the workbook downloads its source only through the controlled session endpoint', () => {
  const page = read('src/pages/SheetEditorPage.tsx');
  const workbook = read('src/modules/sheet-editor/SheetEditorWorkbook.tsx');

  for (const property of ['sourceUrl', 'sessionId', 'sessionToken']) {
    assert.match(page, new RegExp(`${property}=\\{session\\.${property}\\}`));
  }
  assert.match(workbook, /sourceUrl\.startsWith\('\/api\/sheet-editor\/'\)/);
  assert.match(workbook, /'X-Sheet-Session-Id': sessionId/);
  assert.match(workbook, /'X-Sheet-Session-Token': sessionToken/);
  assert.match(workbook, /cache: 'no-store'/);
  assert.match(workbook, /response\.arrayBuffer\(\)/);
  assert.match(workbook, /controller\.abort\(\)/);
});

test('xlsx conversion preserves workbook structure and common presentation data', () => {
  const converter = read('src/modules/sheet-editor/xlsxToFortuneSheet.ts');

  assert.match(converter, /workbook\.SheetNames\.map/);
  assert.match(converter, /cellFormula: true/);
  assert.match(converter, /cellStyles: true/);
  assert.match(converter, /cellNF: true/);
  assert.match(converter, /source\.f\.startsWith\('='\)/);
  assert.match(converter, /worksheet\['!merges'\]/);
  assert.match(converter, /worksheet\['!cols'\]/);
  assert.match(converter, /worksheet\['!rows'\]/);
  assert.match(converter, /font\?\.bold/);
  assert.match(converter, /fill\?\.fgColor/);
  assert.match(converter, /alignment\?\.wrapText/);
  assert.match(converter, /celldata/);
});

test('stage four source transport remains a controlled GET endpoint', () => {
  const route = read('server/routes/sheet-editor.cjs');

  assert.match(route, /router\.get\('\/:fileId\/source', authMiddleware/);
  assert.match(route, /private, no-store, max-age=0/);
});
