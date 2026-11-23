const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const select = fs.readFileSync(path.join(root, 'src/components/Form/AppSelect.tsx'), 'utf8');
const projectSheet = fs.readFileSync(path.join(root, 'src/components/ProjectExcelView.tsx'), 'utf8');
const worklogSheet = fs.readFileSync(path.join(root, 'src/components/WorkLogExcelView.tsx'), 'utf8');

test('sheet dropdowns open only after their trigger has mounted and been measured', () => {
  assert.match(select, /const \[open, setOpen\] = useState\(false\)/);
  assert.match(select, /if \(autoOpen\) requestOpen\(\)/);
  assert.doesNotMatch(select, /useState\(autoOpen\)/);
  assert.match(select, /onMouseDown=\{event => event\.stopPropagation\(\)\}/);
});

test('project and worklog sheets share the repaired select editor', () => {
  assert.match(projectSheet, /column\.type === 'select'/);
  assert.match(projectSheet, /<AppSelect[\s\S]*?autoOpen/);
  assert.match(worklogSheet, /<ProjectExcelView/);
  assert.match(worklogSheet, /type: 'select'/);
});
