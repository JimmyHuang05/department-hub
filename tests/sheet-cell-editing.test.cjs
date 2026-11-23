const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src/components/ProjectExcelView.tsx'), 'utf8');
const worklog = fs.readFileSync(path.join(__dirname, '..', 'src/components/WorkLogExcelView.tsx'), 'utf8');

test('double click edits at the end and later clicks can move the caret', () => {
  assert.match(source, /const offset = editorRef\.current\.value\.length/);
  assert.match(source, /onMouseDown=\{event => \{[\s\S]*if \(isEditing\) return;[\s\S]*event\.preventDefault\(\)/);
  assert.match(source, /onDoubleClick=\{event => \{[\s\S]*if \(isEditing\) return;[\s\S]*void beginEdit\(rowIndex, colIndex\)/);
  assert.doesNotMatch(source, /textOffsetAtPoint|caretOffset/);
});

test('management worklog and project progress use the same fixed sheet editor', () => {
  assert.match(worklog, /import ProjectExcelView/);
  assert.match(worklog, /<ProjectExcelView/);
});
