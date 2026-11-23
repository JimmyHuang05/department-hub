const crypto = require('crypto');
const { getDbSync, saveDb, saveDbImmediate } = require('../db.cjs');
const { sendBirthdayReminderEmails, sendWeeklyTodoEmails } = require('./emailNotifications.cjs');
const { nextRunAt, normalizeSchedule } = require('./jobSchedule.cjs');

const CHECK_INTERVAL_MS = 30_000;
const RUN_TIMEOUT_MS = 10 * 60 * 1000;
let timer = null;
let ticking = false;

function ensureScheduledJobSchema(db = getDbSync()) {
  if (!db) return;
  db.run(`CREATE TABLE IF NOT EXISTS scheduled_jobs (
    id TEXT PRIMARY KEY,
    job_key TEXT UNIQUE NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    schedule_json TEXT NOT NULL,
    config_json TEXT NOT NULL DEFAULT '{}',
    next_run_at TEXT,
    last_run_at TEXT,
    last_status TEXT DEFAULT 'never',
    last_error TEXT DEFAULT '',
    running INTEGER NOT NULL DEFAULT 0,
    updated_by TEXT DEFAULT '',
    updated_at TEXT NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS scheduled_job_runs (
    id TEXT PRIMARY KEY,
    job_key TEXT NOT NULL,
    trigger_type TEXT NOT NULL,
    scheduled_at TEXT,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL,
    result_json TEXT NOT NULL DEFAULT '{}',
    error TEXT DEFAULT '',
    triggered_by TEXT DEFAULT ''
  )`);
  db.run('CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_due ON scheduled_jobs(enabled, next_run_at)');
  db.run('CREATE INDEX IF NOT EXISTS idx_scheduled_job_runs_key_time ON scheduled_job_runs(job_key, started_at)');
  db.run(`CREATE TABLE IF NOT EXISTS birthday_email_deliveries (
    birthday_user_id TEXT NOT NULL,
    birthday_year INTEGER NOT NULL,
    recipient_user_id TEXT NOT NULL,
    sent_at TEXT NOT NULL,
    PRIMARY KEY (birthday_user_id, birthday_year, recipient_user_id)
  )`);
}

function shanghaiWeekRange(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(now).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  const weekday = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`).getUTCDay();
  const daysSinceMonday = (weekday + 6) % 7;
  const startMs = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) - daysSinceMonday) - 8 * 60 * 60 * 1000;
  return {
    start: new Date(startMs).toISOString(),
    end: new Date(startMs + 7 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

function shanghaiDateLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date).replaceAll('/', '-');
}

function taskDueEndTime(value) {
  const date = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!date) return NaN;
  return Date.parse(`${date[1]}-${date[2]}-${date[3]}T23:59:59.999+08:00`);
}

function buildWeeklyTodoDigests(db = getDbSync(), now = new Date()) {
  if (!db) return [];
  const range = shanghaiWeekRange(now);
  const users = rows(db.exec("SELECT id,display_name,email FROM users WHERE status='active' AND email IS NOT NULL AND TRIM(email)<>'' ORDER BY display_name"));
  const tasks = rows(db.exec("SELECT id,data,assigned_to,due_at,status FROM tasks WHERE status NOT IN ('done','cancelled') ORDER BY due_at IS NULL,due_at,updated_at DESC"));
  const recipientRows = rows(db.exec('SELECT task_id,user_id FROM task_recipients'));
  const recipientsByTask = new Map();
  for (const recipient of recipientRows) {
    if (!recipientsByTask.has(recipient.task_id)) recipientsByTask.set(recipient.task_id, new Set());
    recipientsByTask.get(recipient.task_id).add(recipient.user_id);
  }
  const weekStart = shanghaiDateLabel(range.start);
  const weekEnd = shanghaiDateLabel(new Date(new Date(range.end).getTime() - 1));

  return users.map(user => {
    const memberTasks = tasks.flatMap(row => {
      const belongsToUser = row.assigned_to === user.id || recipientsByTask.get(row.id)?.has(user.id);
      if (!belongsToUser) return [];
      const task = parseJson(row.data, {});
      const dueValue = row.due_at || task.dueAt || '';
      const dueTime = taskDueEndTime(dueValue);
      if (Number.isFinite(dueTime) && dueTime >= new Date(range.end).getTime()) return [];
      const overdue = Number.isFinite(dueTime) && dueTime < new Date(range.start).getTime();
      return [{
        id: row.id,
        title: String(task.title || '').trim() || '未命名任务',
        projectName: String(task.projectName || '').trim(),
        dueAt: dueValue,
        dueLabel: dueValue ? `${overdue ? '已逾期 · ' : ''}${shanghaiDateLabel(dueValue) || dueValue}` : '未设置截止时间',
        overdue,
      }];
    });
    return {
      id: user.id,
      name: user.display_name,
      email: user.email,
      weekStart,
      weekEnd,
      tasks: memberTasks,
    };
  });
}

function shanghaiCalendarParts(now = new Date()) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
}

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function birthdayMonthDayForYear(birthday, year) {
  const monthDay = String(birthday || '').slice(5, 10);
  return monthDay === '02-29' && !isLeapYear(year) ? '02-28' : monthDay;
}

function buildBirthdayReminderEvents(db = getDbSync(), now = new Date()) {
  if (!db) return [];
  ensureScheduledJobSchema(db);
  const today = shanghaiCalendarParts(now);
  const targetUtc = new Date(Date.UTC(Number(today.year), Number(today.month) - 1, Number(today.day) + 10));
  const birthdayYear = targetUtc.getUTCFullYear();
  const targetMonthDay = `${String(targetUtc.getUTCMonth() + 1).padStart(2, '0')}-${String(targetUtc.getUTCDate()).padStart(2, '0')}`;
  const activeUsers = rows(db.exec("SELECT id,display_name,email,birthday FROM users WHERE status='active' ORDER BY display_name,id"));
  const recipients = activeUsers
    .filter(user => String(user.email || '').trim())
    .map(user => ({ id: user.id, name: user.display_name, email: user.email }));
  return activeUsers.flatMap(user => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(user.birthday || ''))) return [];
    if (birthdayMonthDayForYear(user.birthday, birthdayYear) !== targetMonthDay) return [];
    const delivered = new Set(rows(db.exec(
      'SELECT recipient_user_id FROM birthday_email_deliveries WHERE birthday_user_id=? AND birthday_year=?',
      [user.id, birthdayYear],
    )).map(row => row.recipient_user_id));
    return [{
      id: user.id,
      name: user.display_name,
      birthdayYear,
      birthdayLabel: `${targetUtc.getUTCMonth() + 1}月${targetUtc.getUTCDate()}日`,
      recipients: recipients.filter(recipient => !delivered.has(recipient.id)),
    }];
  });
}

const JOB_DEFINITIONS = Object.freeze({
  weekly_todo_email: {
    name: '每周待办邮件',
    description: '每周一向成员邮箱分别发送本周待办，包括已逾期、本周到期和未设置截止时间的未完成任务。',
    defaultEnabled: true,
    defaultSchedule: { kind: 'weekly', weekday: 1, time: '08:00' },
    async run() {
      const db = getDbSync();
      const digests = buildWeeklyTodoDigests(db);
      const taskCount = digests.reduce((sum, digest) => sum + digest.tasks.length, 0);
      const result = await sendWeeklyTodoEmails(digests);
      if (!result.enabled) return { skipped: true, count: 0, message: 'SMTP 邮件服务未启用' };
      if (!digests.length) return { skipped: true, count: 0, message: '没有配置有效邮箱的成员' };
      if (result.sent === 0 && result.failures.length) throw new Error(`每周待办邮件发送失败：${result.failures[0].message}`);
      return {
        count: result.sent,
        message: `已向 ${result.sent} 名成员发送本周待办，共汇总 ${taskCount} 项任务`,
        detail: { recipients: digests.length, sent: result.sent, skipped: result.skipped, failures: result.failures.length, tasks: taskCount },
      };
    },
  },
  birthday_reminder_email: {
    name: '员工生日提醒',
    description: '每天检查启用中的员工，在生日前 10 天向所有启用且已填写邮箱的员工发送提醒。',
    defaultEnabled: true,
    defaultSchedule: { kind: 'daily', time: '09:00' },
    async run() {
      const db = getDbSync();
      const events = buildBirthdayReminderEvents(db);
      if (!events.length) return { skipped: true, count: 0, message: '今日没有需要发送的生日提醒' };
      let sent = 0;
      let skipped = 0;
      const failures = [];
      for (const event of events) {
        if (!event.recipients.length) continue;
        const result = await sendBirthdayReminderEmails(event, event.recipients);
        if (!result.enabled) return { skipped: true, count: 0, message: 'SMTP 邮件服务未启用' };
        const sentAt = new Date().toISOString();
        for (const recipientId of result.sent) {
          db.run(
            'INSERT OR IGNORE INTO birthday_email_deliveries(birthday_user_id,birthday_year,recipient_user_id,sent_at) VALUES(?,?,?,?)',
            [event.id, event.birthdayYear, recipientId, sentAt],
          );
        }
        sent += result.sent.length;
        skipped += result.skipped;
        failures.push(...result.failures);
      }
      saveDbImmediate();
      if (sent === 0 && failures.length) throw new Error(`生日提醒邮件发送失败：${failures[0].message}`);
      return {
        count: sent,
        message: `已发送 ${sent} 封生日提醒邮件`,
        detail: { birthdays: events.length, sent, skipped, failures: failures.length },
      };
    },
  },
});

function parseJson(value, fallback) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}

function rows(result) {
  return (result[0]?.values || []).map(row => Object.fromEntries(result[0].columns.map((column, index) => [column, row[index]])));
}

function seedScheduledJobs(db = getDbSync(), now = new Date(), resetRunning = false) {
  if (!db) return;
  ensureScheduledJobSchema(db);
  const timestamp = now.toISOString();
  const jobKeys = Object.keys(JOB_DEFINITIONS);
  const placeholders = jobKeys.map(() => '?').join(',');
  db.run(`DELETE FROM scheduled_jobs WHERE job_key NOT IN (${placeholders})`, jobKeys);
  for (const [jobKey, definition] of Object.entries(JOB_DEFINITIONS)) {
    const schedule = normalizeSchedule(definition.defaultSchedule);
    const next = definition.runOnStartup ? timestamp : nextRunAt(schedule, now).toISOString();
    db.run(
      `INSERT OR IGNORE INTO scheduled_jobs
       (id,job_key,enabled,schedule_json,config_json,next_run_at,last_status,running,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?)`,
      [crypto.randomUUID(), jobKey, definition.defaultEnabled ? 1 : 0, JSON.stringify(schedule), '{}', next, 'never', 0, timestamp],
    );
  }
  if (resetRunning) db.run('UPDATE scheduled_jobs SET running=0 WHERE running<>0');
  saveDb();
}

function publicJob(row) {
  const definition = JOB_DEFINITIONS[row.job_key];
  return {
    key: row.job_key,
    name: definition?.name || row.job_key,
    description: definition?.description || '',
    enabled: Boolean(row.enabled),
    schedule: parseJson(row.schedule_json, definition?.defaultSchedule || { kind: 'daily', time: '00:00' }),
    config: parseJson(row.config_json, {}),
    nextRunAt: row.next_run_at || '',
    lastRunAt: row.last_run_at || '',
    lastStatus: row.last_status || 'never',
    lastError: row.last_error || '',
    running: Boolean(row.running),
    updatedBy: row.updated_by || '',
    updatedAt: row.updated_at || '',
  };
}

function listScheduledJobs(db = getDbSync()) {
  if (!db) return [];
  seedScheduledJobs(db);
  return rows(db.exec('SELECT * FROM scheduled_jobs ORDER BY rowid')).map(publicJob);
}

function getJobRow(jobKey, db = getDbSync()) {
  const result = rows(db.exec('SELECT * FROM scheduled_jobs WHERE job_key=?', [jobKey]));
  return result[0] || null;
}

function updateScheduledJob(jobKey, updates, actor = '') {
  const db = getDbSync();
  const definition = JOB_DEFINITIONS[jobKey];
  if (!definition) throw Object.assign(new Error('定时任务不存在'), { statusCode: 404 });
  const current = getJobRow(jobKey, db);
  if (!current) throw Object.assign(new Error('定时任务尚未初始化'), { statusCode: 409 });
  const enabled = updates.enabled === undefined ? Boolean(current.enabled) : Boolean(updates.enabled);
  const schedule = updates.schedule === undefined
    ? parseJson(current.schedule_json, definition.defaultSchedule)
    : normalizeSchedule(updates.schedule);
  const now = new Date();
  const next = enabled ? nextRunAt(schedule, now).toISOString() : null;
  db.run(
    `UPDATE scheduled_jobs SET enabled=?,schedule_json=?,next_run_at=?,last_error='',updated_by=?,updated_at=? WHERE job_key=?`,
    [enabled ? 1 : 0, JSON.stringify(schedule), next, actor, now.toISOString(), jobKey],
  );
  saveDbImmediate();
  return publicJob(getJobRow(jobKey, db));
}

function withTimeout(promise, milliseconds = RUN_TIMEOUT_MS) {
  let timeout;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('任务执行超时')), milliseconds);
      timeout.unref?.();
    }),
  ]).finally(() => clearTimeout(timeout));
}

async function runScheduledJob(jobKey, options = {}) {
  const db = getDbSync();
  const definition = JOB_DEFINITIONS[jobKey];
  const row = getJobRow(jobKey, db);
  if (!definition || !row) throw Object.assign(new Error('定时任务不存在'), { statusCode: 404 });
  if (row.running) throw Object.assign(new Error('任务正在执行，请稍后再试'), { statusCode: 409 });

  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const triggerType = options.triggerType || 'manual';
  db.run('UPDATE scheduled_jobs SET running=1,last_status=? WHERE job_key=? AND running=0', ['running', jobKey]);
  db.run(
    `INSERT INTO scheduled_job_runs(id,job_key,trigger_type,scheduled_at,started_at,status,result_json,error,triggered_by)
     VALUES(?,?,?,?,?,?,?,?,?)`,
    [runId, jobKey, triggerType, options.scheduledAt || null, startedAt, 'running', '{}', '', options.triggeredBy || ''],
  );
  saveDb();

  try {
    const result = await withTimeout(Promise.resolve().then(() => definition.run(parseJson(row.config_json, {}))));
    const finishedAt = new Date().toISOString();
    const status = result?.skipped ? 'skipped' : 'success';
    db.run('UPDATE scheduled_job_runs SET finished_at=?,status=?,result_json=? WHERE id=?', [finishedAt, status, JSON.stringify(result || {}), runId]);
    db.run('UPDATE scheduled_jobs SET running=0,last_run_at=?,last_status=?,last_error=? WHERE job_key=?', [finishedAt, status, '', jobKey]);
    saveDbImmediate();
    return { id: runId, status, result: result || {} };
  } catch (error) {
    const finishedAt = new Date().toISOString();
    const message = String(error?.message || error || '任务执行失败').slice(0, 1000);
    db.run('UPDATE scheduled_job_runs SET finished_at=?,status=?,error=? WHERE id=?', [finishedAt, 'failed', message, runId]);
    db.run('UPDATE scheduled_jobs SET running=0,last_run_at=?,last_status=?,last_error=? WHERE job_key=?', [finishedAt, 'failed', message, jobKey]);
    saveDbImmediate();
    throw error;
  }
}

function listJobRuns(jobKey, limit = 30, db = getDbSync()) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 30, 100));
  const result = rows(db.exec(
    `SELECT id,job_key,trigger_type,scheduled_at,started_at,finished_at,status,result_json,error,triggered_by
     FROM scheduled_job_runs WHERE job_key=? ORDER BY started_at DESC LIMIT ${safeLimit}`,
    [jobKey],
  ));
  return result.map(row => ({
    id: row.id,
    jobKey: row.job_key,
    triggerType: row.trigger_type,
    scheduledAt: row.scheduled_at || '',
    startedAt: row.started_at,
    finishedAt: row.finished_at || '',
    status: row.status,
    result: parseJson(row.result_json, {}),
    error: row.error || '',
    triggeredBy: row.triggered_by || '',
  }));
}

async function tickScheduledJobs(now = new Date()) {
  if (ticking) return;
  ticking = true;
  try {
    const db = getDbSync();
    ensureScheduledJobSchema(db);
    const due = rows(db.exec(
      `SELECT job_key,next_run_at,schedule_json FROM scheduled_jobs
       WHERE enabled=1 AND running=0 AND next_run_at IS NOT NULL AND next_run_at<=? ORDER BY next_run_at`,
      [now.toISOString()],
    ));
    for (const job of due) {
      const scheduledAt = job.next_run_at;
      const schedule = parseJson(job.schedule_json, JOB_DEFINITIONS[job.job_key]?.defaultSchedule);
      db.run('UPDATE scheduled_jobs SET next_run_at=? WHERE job_key=?', [nextRunAt(schedule, now).toISOString(), job.job_key]);
      saveDb();
      try {
        await runScheduledJob(job.job_key, { triggerType: 'scheduled', scheduledAt, triggeredBy: 'scheduler' });
      } catch (error) {
        console.error(`[scheduled-job] ${job.job_key} failed:`, error?.message || error);
      }
    }
  } finally {
    ticking = false;
  }
}

function startScheduledJobs() {
  seedScheduledJobs(getDbSync(), new Date(), true);
  tickScheduledJobs().catch(error => console.error('[scheduled-job] initial tick failed:', error));
  if (timer) clearInterval(timer);
  timer = setInterval(() => tickScheduledJobs().catch(error => console.error('[scheduled-job] tick failed:', error)), CHECK_INTERVAL_MS);
  timer.unref?.();
}

function stopScheduledJobs() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = {
  JOB_DEFINITIONS,
  ensureScheduledJobSchema,
  listJobRuns,
  listScheduledJobs,
  runScheduledJob,
  seedScheduledJobs,
  startScheduledJobs,
  stopScheduledJobs,
  tickScheduledJobs,
  updateScheduledJob,
  buildWeeklyTodoDigests,
  buildBirthdayReminderEvents,
  shanghaiWeekRange,
  taskDueEndTime,
};
