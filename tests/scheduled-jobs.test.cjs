const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const initSqlJs = require('sql.js');
const { nextRunAt, normalizeSchedule } = require('../server/services/jobSchedule.cjs');
const { JOB_DEFINITIONS, buildBirthdayReminderEvents, buildWeeklyTodoDigests, ensureScheduledJobSchema, shanghaiWeekRange, taskDueEndTime } = require('../server/services/scheduledJobs.cjs');

test('task due dates expire at the end of the selected Shanghai calendar day', () => {
  assert.equal(new Date(taskDueEndTime('2026-08-31')).toISOString(), '2026-08-31T15:59:59.999Z');
  assert.equal(taskDueEndTime(''), Number.NaN);
});

test('scheduled jobs calculate daily times in Asia Shanghai', () => {
  assert.equal(
    nextRunAt({ kind: 'daily', time: '09:30' }, new Date('2026-08-03T00:00:00.000Z')).toISOString(),
    '2026-08-03T01:30:00.000Z',
  );
  assert.equal(
    nextRunAt({ kind: 'daily', time: '09:30' }, new Date('2026-08-03T02:00:00.000Z')).toISOString(),
    '2026-08-04T01:30:00.000Z',
  );
});

test('scheduled jobs calculate weekly times in Asia Shanghai', () => {
  assert.equal(
    nextRunAt({ kind: 'weekly', weekday: 1, time: '00:05' }, new Date('2026-08-02T12:00:00.000Z')).toISOString(),
    '2026-08-02T16:05:00.000Z',
  );
});

test('scheduled job rules reject unsafe or excessive intervals', () => {
  assert.throws(() => normalizeSchedule({ kind: 'interval', minutes: 1 }), /5/);
  assert.throws(() => normalizeSchedule({ kind: 'daily', time: '25:00' }), /无效/);
});

test('scheduled jobs API is admin-only and handlers are allow-listed', () => {
  const root = path.join(__dirname, '..');
  const route = fs.readFileSync(path.join(root, 'server/routes/scheduled-jobs.cjs'), 'utf8');
  const service = fs.readFileSync(path.join(root, 'server/services/scheduledJobs.cjs'), 'utf8');
  assert.match(route, /router\.use\(authMiddleware, requireRole\('admin'\)\)/);
  assert.match(service, /const JOB_DEFINITIONS = Object\.freeze/);
  assert.doesNotMatch(service, /child_process|execFile|spawn\(/);
});

test('user presets use the scheduler while worklog rollover remains an internal lifecycle service', () => {
  const root = path.join(__dirname, '..');
  const index = fs.readFileSync(path.join(root, 'server/index.cjs'), 'utf8');
  const cloud = fs.readFileSync(path.join(root, 'server/routes/clouddrive.cjs'), 'utf8');
  const rollover = fs.readFileSync(path.join(root, 'server/services/weekRollover.cjs'), 'utf8');
  assert.match(index, /startScheduledJobs\(\)/);
  assert.match(index, /startWeekRollover\(\)/);
  assert.match(index, /startDatabaseBackups\(\)/);
  assert.match(rollover, /const db = getDbSync\(\)/);
  assert.doesNotMatch(cloud, /trashCleanupTimer/);
});

test('scheduled job schema repairs itself after an older database is restored', async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  ensureScheduledJobSchema(db);
  const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")[0].values.map(row => row[0]);
  assert.deepEqual(tables, ['birthday_email_deliveries', 'scheduled_job_runs', 'scheduled_jobs']);
  const indexes = db.exec("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_scheduled_%' ORDER BY name")[0].values.map(row => row[0]);
  assert.deepEqual(indexes, ['idx_scheduled_job_runs_key_time', 'idx_scheduled_jobs_due']);
  db.close();
});

test('scheduled jobs expose weekly todo and daily birthday emails', () => {
  assert.deepEqual(Object.keys(JOB_DEFINITIONS), ['weekly_todo_email', 'birthday_reminder_email']);
  assert.equal(JOB_DEFINITIONS.weekly_todo_email.defaultEnabled, true);
  assert.deepEqual(
    JOB_DEFINITIONS.weekly_todo_email.defaultSchedule,
    { kind: 'weekly', weekday: 1, time: '08:00' },
  );
  assert.equal(typeof JOB_DEFINITIONS.weekly_todo_email.run, 'function');
  assert.equal(JOB_DEFINITIONS.birthday_reminder_email.defaultEnabled, true);
  assert.deepEqual(JOB_DEFINITIONS.birthday_reminder_email.defaultSchedule, { kind: 'daily', time: '09:00' });
});

test('birthday reminders include only active employees and active recipients', async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('CREATE TABLE users(id TEXT,display_name TEXT,email TEXT,birthday TEXT,status TEXT)');
  db.run("INSERT INTO users VALUES ('u1','Alice','alice@example.com','2000-08-31','active')");
  db.run("INSERT INTO users VALUES ('u2','Bob','bob@example.com','1999-01-01','active')");
  db.run("INSERT INTO users VALUES ('u3','Former intern','former@example.com','2001-08-31','disabled')");
  db.run("INSERT INTO users VALUES ('u4','Pending','pending@example.com','2002-01-01','pending')");
  ensureScheduledJobSchema(db);
  const events = buildBirthdayReminderEvents(db, new Date('2026-08-21T02:00:00.000Z'));
  assert.deepEqual(events.map(event => event.id), ['u1']);
  assert.deepEqual(events[0].recipients.map(recipient => recipient.id), ['u1', 'u2']);
  db.run("INSERT INTO birthday_email_deliveries VALUES ('u1',2026,'u1','2026-08-21T02:00:00.000Z')");
  const remaining = buildBirthdayReminderEvents(db, new Date('2026-08-21T02:00:00.000Z'));
  assert.deepEqual(remaining[0].recipients.map(recipient => recipient.id), ['u2']);
  db.close();
});

test('weekly todo email uses Beijing Monday-to-Sunday boundaries', () => {
  assert.deepEqual(
    shanghaiWeekRange(new Date('2026-08-03T00:00:00.000Z')),
    { start: '2026-08-02T16:00:00.000Z', end: '2026-08-09T16:00:00.000Z' },
  );
  assert.deepEqual(
    shanghaiWeekRange(new Date('2026-08-09T15:59:59.000Z')),
    { start: '2026-08-02T16:00:00.000Z', end: '2026-08-09T16:00:00.000Z' },
  );
});

test('weekly todo digest is personalized and excludes completed or later tasks', async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run("CREATE TABLE users(id TEXT,display_name TEXT,email TEXT,status TEXT)");
  db.run("CREATE TABLE tasks(id TEXT,data TEXT,assigned_to TEXT,due_at TEXT,status TEXT,updated_at TEXT)");
  db.run("CREATE TABLE task_recipients(task_id TEXT,user_id TEXT)");
  db.run("INSERT INTO users VALUES ('u1','甲','one@example.com','active'),('u2','乙','two@example.com','active')");
  db.run("INSERT INTO tasks VALUES (?,?,?,?,?,?)", ['t1', JSON.stringify({ title: '本周任务' }), 'u1', '2026-08-05T02:00:00.000Z', 'todo', '2026-08-03T00:00:00.000Z']);
  db.run("INSERT INTO tasks VALUES (?,?,?,?,?,?)", ['t2', JSON.stringify({ title: '逾期任务' }), 'u1', '2026-08-01T02:00:00.000Z', 'todo', '2026-08-03T00:00:00.000Z']);
  db.run("INSERT INTO tasks VALUES (?,?,?,?,?,?)", ['t3', JSON.stringify({ title: '以后任务' }), 'u1', '2026-08-12T02:00:00.000Z', 'todo', '2026-08-03T00:00:00.000Z']);
  db.run("INSERT INTO tasks VALUES (?,?,?,?,?,?)", ['t4', JSON.stringify({ title: '已完成任务' }), 'u1', '2026-08-05T02:00:00.000Z', 'done', '2026-08-03T00:00:00.000Z']);
  db.run("INSERT INTO tasks VALUES (?,?,?,?,?,?)", ['t5', JSON.stringify({ title: '共同任务' }), 'u1', null, 'todo', '2026-08-03T00:00:00.000Z']);
  db.run("INSERT INTO task_recipients VALUES ('t5','u2')");

  const digests = buildWeeklyTodoDigests(db, new Date('2026-08-03T00:00:00.000Z'));
  assert.deepEqual(digests.map(item => item.name), ['乙', '甲']);
  assert.deepEqual(digests.find(item => item.id === 'u1').tasks.map(item => item.title), ['逾期任务', '本周任务', '共同任务']);
  assert.deepEqual(digests.find(item => item.id === 'u2').tasks.map(item => item.title), ['共同任务']);
  assert.equal(digests.find(item => item.id === 'u1').tasks[0].overdue, true);
  db.close();
});
