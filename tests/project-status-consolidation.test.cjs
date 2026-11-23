const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('landed projects migrate to established and deprecated statuses disappear', () => {
  const db = fs.readFileSync(path.join(root, 'server/db.cjs'), 'utf8');
  const settings = fs.readFileSync(path.join(root, 'src/store/settingsStore.ts'), 'utf8');
  const exportSource = fs.readFileSync(path.join(root, 'src/utils/projectProgressExport.ts'), 'utf8');
  const projectStore = fs.readFileSync(path.join(root, 'src/store/projectStore.ts'), 'utf8');

  assert.match(db, /product\.status !== '已落地'/);
  assert.match(db, /product\.status === '已落地' \? '已成立'/);
  assert.match(db, /'项目中止'/);
  assert.match(db, /status\?\.name !== '已落地' && status\?\.name !== '终止'/);
  assert.match(projectStore, /product\.status === '已落地' \? '已成立'/);
  assert.doesNotMatch(settings, /name: '已落地'/);
  assert.doesNotMatch(settings, /name: '终止'/);
  assert.match(exportSource, /STATUS_OPTIONS = \['已成立'/);
  assert.doesNotMatch(exportSource, /"已落地"/);
});
