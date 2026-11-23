const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const linkage = require(path.join(root, 'server/services/projectWorklogLinkage.cjs'));
const worklogPage = fs.readFileSync(path.join(root, 'src/pages/WorkLogList.tsx'), 'utf8');
const projectPage = fs.readFileSync(path.join(root, 'src/pages/ProjectList.tsx'), 'utf8');
const projectSheet = fs.readFileSync(path.join(root, 'src/components/ProjectExcelView.tsx'), 'utf8');
const db = fs.readFileSync(path.join(root, 'server/db.cjs'), 'utf8');

test('management weekly report uses the four requested stages', () => {
  assert.match(worklogPage, /MANAGEMENT_STAGE_OPTIONS/);
  assert.match(db, /推进中.*已过会.*运行中.*终止清算/);
  assert.match(db, /上会\|过会.*已过会/);
  assert.match(db, /管理周报阶段迁移完成/);
});

test('project category derives active-passive and collective-single consistently', () => {
  assert.deepEqual(linkage.categoryLinkage('资产管理'), { activePassive: '主动', collectiveSingle: '集合' });
  assert.deepEqual(linkage.categoryLinkage('资产服务（主动管理）'), { activePassive: '主动', collectiveSingle: '单一' });
  assert.deepEqual(linkage.categoryLinkage('资产服务（事务管理）'), { activePassive: '被动', collectiveSingle: '单一' });
});

test('project progress exposes all linked classification fields', () => {
  for (const field of ['projectCategory', 'activePassive', 'collectiveSingle']) {
    assert.match(projectPage, new RegExp(`fieldKey="${field}"`));
    assert.match(projectSheet, new RegExp(`key: '${field}'`));
  }
});

test('server linkage supports updates in both directions', () => {
  const products = fs.readFileSync(path.join(root, 'server/routes/products.cjs'), 'utf8');
  const entries = fs.readFileSync(path.join(root, 'server/routes/entries.cjs'), 'utf8');
  assert.match(products, /syncProductToEntries/);
  assert.match(entries, /syncEntryToProduct/);
  assert.match(products, /changedFields/);
  assert.match(entries, /changedFields/);
});
