const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const select = fs.readFileSync(path.join(root, 'src/components/Form/AppSelect.tsx'), 'utf8');
const sheet = fs.readFileSync(path.join(root, 'src/components/ProjectExcelView.tsx'), 'utf8');
const worklog = fs.readFileSync(path.join(root, 'src/components/WorkLogExcelView.tsx'), 'utf8');

test('sheet dropdown panels track the live trigger cell width', () => {
  assert.match(select, /matchTriggerWidth\?: boolean/);
  assert.match(select, /matchTriggerWidth \? position\.width : Math\.max\(position\.width, 168\)/);
  assert.match(sheet, /panelClassName="project-sheet-select-panel"\s+matchTriggerWidth/);
});

test('worklog table reuses the project sheet dropdown editor', () => {
  assert.match(worklog, /<ProjectExcelView/);
});
