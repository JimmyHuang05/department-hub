const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const initSqlJs = require('sql.js');

const root = path.join(__dirname, '..');
const route = fs.readFileSync(path.join(root, 'server/routes/notifications.cjs'), 'utf8');
const dbSource = fs.readFileSync(path.join(root, 'server/db.cjs'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
const page = fs.readFileSync(path.join(root, 'src/pages/Messages.tsx'), 'utf8');
const tasksRoute = fs.readFileSync(path.join(root, 'server/routes/tasks.cjs'), 'utf8');
const dashboard = fs.readFileSync(path.join(root, 'src/pages/Dashboard.tsx'), 'utf8');
const { createNotification, createTaskNotification } = require('../server/services/notifications.cjs');

test('messages use independent persistence and routes instead of task item types', () => {
  assert.match(dbSource, /CREATE TABLE IF NOT EXISTS notifications/);
  assert.match(dbSource, /CREATE TABLE IF NOT EXISTS notification_recipients/);
  assert.match(dbSource, /CREATE TABLE IF NOT EXISTS notification_votes/);
  assert.match(app, /case 'tasks': return <Messages \/>/);
  assert.doesNotMatch(app, /case 'tasks': return <Tasks \/>/);
  assert.match(route, /router\.put\('\/read-all'/);
  assert.match(route, /router\.put\('\/:id\/read'/);
  assert.match(route, /router\.post\('\/:id\/vote'/);
});

test('message inbox is read-oriented and does not expose task lifecycle controls', () => {
  assert.match(page, /全部消息/);
  assert.match(page, /我发出的/);
  assert.match(page, /全部标为已读/);
  assert.match(page, /任务协作仍在任务中心完成/);
  assert.match(page, /不会自动创建待办/);
  assert.doesNotMatch(page, /TaskStatusSelect/);
  assert.doesNotMatch(page, /负责人 \/ 创建人/);
  assert.doesNotMatch(page, /任务归属/);
});

test('task collaboration events create system messages with task deep links', () => {
  assert.match(tasksRoute, /createTaskNotification\(db, data/);
  assert.match(tasksRoute, /createTaskNotification\(db, next/);
  assert.match(tasksRoute, /createTaskNotification\(db, task/);
  assert.match(page, /navigate\(selected\.actionUrl\)/);
  assert.match(dashboard, /\/notifications\?filter=unread/);
});

test('notification creation stores one recipient state per user and excludes the sender', async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('CREATE TABLE notifications(id TEXT PRIMARY KEY,type TEXT,title TEXT,content TEXT,sender_id TEXT,sender_name TEXT,component_type TEXT,component_data TEXT,action_url TEXT,expires_at TEXT,created_at TEXT)');
  db.run('CREATE TABLE notification_recipients(notification_id TEXT,user_id TEXT,read_at TEXT,archived_at TEXT,created_at TEXT,PRIMARY KEY(notification_id,user_id))');
  createNotification(db, { id: 'n1', type: 'manual', title: '标题', content: '内容', senderId: 'u1', senderName: '甲', recipientIds: ['u1', 'u2', 'u2', 'u3'] });
  const recipients = db.exec('SELECT user_id FROM notification_recipients ORDER BY user_id')[0].values.map(row => row[0]);
  assert.deepEqual(recipients, ['u2', 'u3']);
});

test('task notifications reach participants other than the actor', async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('CREATE TABLE notifications(id TEXT PRIMARY KEY,type TEXT,title TEXT,content TEXT,sender_id TEXT,sender_name TEXT,component_type TEXT,component_data TEXT,action_url TEXT,expires_at TEXT,created_at TEXT)');
  db.run('CREATE TABLE notification_recipients(notification_id TEXT,user_id TEXT,read_at TEXT,archived_at TEXT,created_at TEXT,PRIMARY KEY(notification_id,user_id))');
  createTaskNotification(db, { id: 't1', title: '任务', createdById: 'u1', assignedToId: 'u2', recipientIds: ['u3', 'u4'] }, { id: 'u3', name: '丙' }, 'comment', '新回复');
  const recipients = db.exec('SELECT user_id FROM notification_recipients ORDER BY user_id')[0].values.map(row => row[0]);
  assert.deepEqual(recipients, ['u1', 'u2', 'u4']);
  const actionUrl = db.exec('SELECT action_url FROM notifications')[0].values[0][0];
  assert.equal(actionUrl, '/discussions?taskId=t1');
});
