const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const toolbar = fs.readFileSync(path.join(root, 'src/components/DataTable/TableToolbar.tsx'), 'utf8');
const worklog = fs.readFileSync(path.join(root, 'src/pages/WorkLogList.tsx'), 'utf8');

test('management weekly report function menu omits the weekly summary shortcut', () => {
  assert.doesNotMatch(toolbar, /onWeeklySummary|<span>工作小结<\/span>/);
  assert.doesNotMatch(worklog, /onWeeklySummary=/);
});
