const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('authenticated entry does not block on every page module', () => {
  const source = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
  assert.doesNotMatch(source, /authenticatedPageLoaders|preloadAuthenticatedPages/);
  assert.match(source, /const idlePageLoaders = \[loadProjectList, loadWorkLogList\]/);
  assert.match(source, /scheduleIdlePagePreload/);
  assert.doesNotMatch(source, /Promise\.all\(\[[\s\S]*preloadPages/);
});

test('only the three high-frequency pages retain component state', () => {
  const source = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
  assert.match(source, /statefulPageKeys = new Set<CachedPageKey>\(\['dashboard', 'projects', 'worklog'\]\)/);
  assert.match(source, /if \(!statefulPageKeys\.has\(activeKey\)\) return/);
});

test('top-right toast only displays error feedback', () => {
  const source = fs.readFileSync(path.join(root, 'src/components/Toast.tsx'), 'utf8');
  assert.match(source, /if \(type !== 'error'\) return/);
  assert.match(source, /aria-live="assertive"/);
});

test('active source does not use blocking browser confirmation dialogs', () => {
  const sourceFiles = [
    'src/components/DataTable/ImportModal.tsx',
    'src/components/DataTable/WorkLogImportModal.tsx',
    'src/modules/sheet-editor/SheetEditorWorkbook.tsx',
    'src/pages/SheetEditorPage.tsx',
  ];
  for (const file of sourceFiles) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(source, /window\.(confirm|alert)|\b(confirm|alert)\(/, file);
    assert.match(source, /useConfirm/, file);
  }
});

test('common technical failures have an actionable user-facing explanation', () => {
  const source = fs.readFileSync(path.join(root, 'src/utils/errorCodes.ts'), 'utf8');
  assert.match(source, /你没有执行此操作的权限/);
  assert.match(source, /数据已被其他人更新/);
  assert.match(source, /网络连接不稳定/);
  assert.match(source, /事件编号/);
});

test('desktop weekly todo bulk mode supports selecting one card or its checkbox', () => {
  const dashboard = fs.readFileSync(path.join(root, 'src/pages/Dashboard.tsx'), 'utf8');
  assert.match(dashboard, /onClick=\{\(\) => \{ if \(todoBulkMode\) toggleSelectedTodo\(item\.id\); \}\}/);
  assert.match(dashboard, /aria-pressed=\{selectedTodoIds\.has\(item\.id\)\}/);
  assert.match(dashboard, /if \(todoBulkMode\) event\.preventDefault\(\)/);
  assert.doesNotMatch(dashboard, /event\.preventDefault\(\); toggleSelectedTodo\(item\.id\)/);
});

test('business administrators see manager pending todo counts and detail lists', () => {
  const dashboard = fs.readFileSync(path.join(root, 'src/pages/Dashboard.tsx'), 'utf8');
  assert.match(dashboard, /user\?\.business_role === 'admin'/);
  assert.match(dashboard, /buildManagerTodoProgress\(entries, products, weekKey, now\)/);
  assert.match(dashboard, /percentage: 0/);
  assert.match(dashboard, /completedItems: \[\]/);
  assert.match(dashboard, /待处理[\s\S]*item\.pending/);
  assert.match(dashboard, /总计[\s\S]*item\.total/);
  assert.match(dashboard, /!isBusinessAdmin && !isIntern && stats\.todoItems\.length > 0/);
});
