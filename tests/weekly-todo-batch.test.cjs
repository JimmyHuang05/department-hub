const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const preferences = fs.readFileSync(path.join(root, 'server/routes/preferences.cjs'), 'utf8');
const dashboard = fs.readFileSync(path.join(root, 'src/pages/Dashboard.tsx'), 'utf8');

test('weekly todo batch endpoints are user and week scoped', () => {
  assert.match(preferences, /todo-snoozes\/batch'/);
  assert.match(preferences, /todo-snoozes\/batch\/restore/);
  assert.match(preferences, /req\.user\.id, input\.weekKey, itemId/);
  assert.match(preferences, /itemIds\.length > 200/);
  assert.match(preferences, /BEGIN/);
  assert.match(preferences, /ROLLBACK/);
});

test('dashboard supports selection, confirmation and undo', () => {
  assert.match(dashboard, /BatchTodoConfirm/);
  assert.match(dashboard, /todoBulkMode/);
  assert.match(dashboard, /toggleAllTodos/);
  assert.match(dashboard, /confirmBatchSnooze/);
  assert.match(dashboard, /undoBatchSnooze/);
  assert.match(dashboard, /仅隐藏当前账号本周的提醒/);
});

test('manager progress cards open completed and pending detail lists', () => {
  assert.match(dashboard, /completedItems: ManagerTodoDetail\[\]/);
  assert.match(dashboard, /pendingItems: ManagerTodoDetail\[\]/);
  assert.match(dashboard, /manager-todo-progress/);
  assert.match(dashboard, /managers: currentItems\.map/);
  assert.match(dashboard, /function ManagerTodoDetailModal/);
  assert.match(dashboard, /onSelect=\{setSelectedManagerTodo\}/);
  assert.match(dashboard, /to=\{detail\.href\}/);
});

test('manager progress is based on a fixed weekly todo snapshot', () => {
  assert.match(preferences, /manager-todo-progress/);
  assert.match(preferences, /manager_todo_snapshots/);
  assert.match(preferences, /Number\(existing\?\.count \|\| 0\) === 0/);
  assert.match(preferences, /snoozed\.has\(itemId\) \|\| !currentById\.has\(itemId\)/);
  assert.match(preferences, /completedItems\.length \/ total/);
});
