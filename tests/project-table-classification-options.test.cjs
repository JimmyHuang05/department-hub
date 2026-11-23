const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const sheet = fs.readFileSync(path.join(root, 'src/components/ProjectExcelView.tsx'), 'utf8');
const page = fs.readFileSync(path.join(root, 'src/pages/ProjectList.tsx'), 'utf8');

test('project table receives classification options through the shared field option map', () => {
  assert.match(sheet, /fieldOptions\?: Record<string, string\[\]>/);
  assert.match(sheet, /options: fieldOptions\[column\.key\]/);
  for (const field of ['projectCategory', 'activePassive', 'collectiveSingle']) {
    assert.match(page, new RegExp(`${field}: projectFieldOptions\\.${field}`));
  }
});
