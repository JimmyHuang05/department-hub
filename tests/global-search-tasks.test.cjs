const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const search = fs.readFileSync(path.join(root, 'src/utils/globalSearch.ts'), 'utf8');
const sidebar = fs.readFileSync(path.join(root, 'src/components/Layout/Sidebar.tsx'), 'utf8');
const globalSearch = fs.readFileSync(path.join(root, 'src/components/Layout/GlobalSearch.tsx'), 'utf8');
const tasksPage = fs.readFileSync(path.join(root, 'src/pages/Tasks.tsx'), 'utf8');
const tasksRoute = fs.readFileSync(path.join(root, 'server/routes/tasks.cjs'), 'utf8');

test('global search indexes task details and non-deleted task comments', () => {
  assert.match(search, /type GlobalSearchKind = 'project' \| 'worklog' \| 'task'/);
  assert.match(search, /label: '任务动态'/);
  assert.match(search, /href: `\/tasks\?taskId=/);
  assert.match(tasksRoute, /router\.get\('\/search-index'/);
  assert.match(tasksRoute, /WHERE deleted_at IS NULL/);
});

test('both global search entry points load tasks and task detail accepts direct links', () => {
  assert.match(sidebar, /api\.get<\{ items: GlobalSearchTask\[\] \}>\('\/tasks\/search-index'\)/);
  assert.match(globalSearch, /fetch\('\/api\/tasks\/search-index'/);
  assert.match(tasksPage, /params\.get\('taskId'\)/);
  assert.match(tasksPage, /tasks\.find\(item => item\.id === requestedTaskId\)/);
});
