const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('project stage tabs support multi-select activation', () => {
  const projectList = fs.readFileSync(path.join(root, 'src/pages/ProjectList.tsx'), 'utf8');
  const settings = fs.readFileSync(path.join(root, 'src/pages/Settings.tsx'), 'utf8');
  const store = fs.readFileSync(path.join(root, 'src/store/settingsStore.ts'), 'utf8');

  assert.match(projectList, /activeProjectStageIds/);
  assert.match(projectList, /activeProjectStages\.map\(stage =>/);
  assert.match(projectList, /selectedProjectStageNames\.has\(product\.status\)/);
  assert.match(projectList, /current\.filter\(id => id !== stage\.id\)/);
  assert.match(projectList, /\.\.\.current, stage\.id/);
  assert.doesNotMatch(projectList, /label: '全部项目'/);
  assert.doesNotMatch(settings, /阶段展示/);
  assert.doesNotMatch(store, /showInProjectStages/);
});
