const { getDbSync, saveDbImmediate } = require('../db.cjs');

const ROLLOVER_SETTING_ID = 'worklog_week_rollover';
const ROLLOVER_SYSTEM_USER = 'system-week-rollover';
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
let timer = null;

function ensureWeekRolloverSchema(db) {
  db.run(`CREATE TABLE IF NOT EXISTS settings (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS entry_snapshots (
    id TEXT PRIMARY KEY,
    week_key TEXT NOT NULL,
    entry_id TEXT NOT NULL,
    data TEXT NOT NULL,
    created_by TEXT NOT NULL,
    snapshot_at TEXT NOT NULL
  )`);
  try { db.run('ALTER TABLE entries ADD COLUMN week_key TEXT'); } catch (_) {}
  db.run('CREATE INDEX IF NOT EXISTS idx_entries_week_key ON entries(week_key)');
  db.run('CREATE INDEX IF NOT EXISTS idx_entry_snapshots_week_key ON entry_snapshots(week_key)');
}

function getShanghaiParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    year: Number(byType.year),
    month: Number(byType.month),
    day: Number(byType.day),
    weekday: byType.weekday,
    hour: Number(byType.hour),
    minute: Number(byType.minute),
  };
}

function makeLocalDate(parts) {
  return new Date(parts.year, parts.month - 1, parts.day);
}

function encodeDate(date) {
  const yy = String(date.getFullYear()).slice(2);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function getBusinessCurrentWeekKey(date = new Date()) {
  const parts = getShanghaiParts(date);
  const today = makeLocalDate(parts);
  const day = today.getDay() || 7;
  let offset = 5 - day;
  if (day === 7) offset = -2;
  if (day === 6) offset = -1;
  const friday = addDays(today, offset);
  return encodeDate(friday);
}

function getPreviousWeekKey(weekKey) {
  const friday = new Date(2000 + Number(weekKey.slice(0, 2)), Number(weekKey.slice(2, 4)) - 1, Number(weekKey.slice(4, 6)));
  return encodeDate(addDays(friday, -7));
}

function getRolloverState(db) {
  const row = db.exec('SELECT data FROM settings WHERE id=?', [ROLLOVER_SETTING_ID]);
  if (!row[0]?.values?.[0]?.[0]) return {};
  try {
    return JSON.parse(row[0].values[0][0]) || {};
  } catch {
    return {};
  }
}

function saveRolloverState(db, state) {
  db.run(
    'INSERT OR REPLACE INTO settings(id,data,updated_at) VALUES(?,?,?)',
    [ROLLOVER_SETTING_ID, JSON.stringify(state), new Date().toISOString()]
  );
}

function parseEntries(db) {
  const rows = db.exec('SELECT id,data,created_by FROM entries ORDER BY updated_at DESC');
  return (rows[0]?.values || []).map(row => ({
    id: row[0],
    data: JSON.parse(row[1]),
    createdBy: row[2],
  }));
}

function latestWeeklyValue(values, preferredWeekKey) {
  if (!values || typeof values !== 'object') return '';
  if (Object.prototype.hasOwnProperty.call(values, preferredWeekKey)) {
    return values[preferredWeekKey];
  }
  const latestKey = Object.keys(values).filter(Boolean).sort().reverse()[0];
  return latestKey ? values[latestKey] : '';
}

function makeAdvancedEntry(entry, currentWeekKey, previousWeekKey, snapshotAt) {
  // 整条周报深复制到新周，确保动态字段等嵌套内容与历史快照互不影响。
  const clonedEntry = JSON.parse(JSON.stringify(entry));
  const previousProgress = latestWeeklyValue(entry.weeklyProgress, previousWeekKey);
  const previousNavScale = latestWeeklyValue(entry.navScaleHistory, previousWeekKey);
  const weeklyProgress = { ...(entry.weeklyProgress || {}) };
  const navScaleHistory = { ...(entry.navScaleHistory || {}) };

  // 新周默认沿用上周内容，之后编辑当前周键只会改变新周数据。
  if (!Object.prototype.hasOwnProperty.call(weeklyProgress, currentWeekKey)) {
    weeklyProgress[currentWeekKey] = previousProgress || '';
  }
  if (!Object.prototype.hasOwnProperty.call(navScaleHistory, currentWeekKey)) {
    navScaleHistory[currentWeekKey] = entry.navScale || previousNavScale || '';
  }

  return {
    ...clonedEntry,
    weekKey: currentWeekKey,
    weeklyProgress,
    navScaleHistory,
    reviewStatus: 'draft',
    reviewComment: '',
    reviewedBy: '',
    reviewedAt: '',
    updatedAt: snapshotAt,
  };
}

function backfillCurrentWeekEntries(db, currentWeekKey, snapshotAt) {
  const previousWeekKey = getPreviousWeekKey(currentWeekKey);
  const rows = parseEntries(db);
  let count = 0;

  for (const row of rows) {
    if (row.data.weekKey !== currentWeekKey) continue;
    const hasProgress = Object.prototype.hasOwnProperty.call(row.data.weeklyProgress || {}, currentWeekKey);
    const hasNavScale = Object.prototype.hasOwnProperty.call(row.data.navScaleHistory || {}, currentWeekKey);
    if (hasProgress && hasNavScale) continue;

    const updated = {
      ...row.data,
      weeklyProgress: {
        ...(row.data.weeklyProgress || {}),
        ...(hasProgress ? {} : { [currentWeekKey]: latestWeeklyValue(row.data.weeklyProgress, previousWeekKey) || '' }),
      },
      navScaleHistory: {
        ...(row.data.navScaleHistory || {}),
        ...(hasNavScale ? {} : { [currentWeekKey]: row.data.navScale || latestWeeklyValue(row.data.navScaleHistory, previousWeekKey) || '' }),
      },
      updatedAt: snapshotAt,
    };
    db.run(
      'UPDATE entries SET data=?, updated_at=? WHERE id=?',
      [JSON.stringify(updated), snapshotAt, row.id]
    );
    count += 1;
  }
  return count;
}

function archiveAndAdvanceEntries(db, currentWeekKey, snapshotAt) {
  const previousWeekKey = getPreviousWeekKey(currentWeekKey);
  const rows = parseEntries(db);
  let count = 0;

  for (const row of rows) {
    // 服务重启或定时任务重复执行时，不再次处理已进入当前周的记录。
    if (row.data.weekKey === currentWeekKey) continue;
    const archived = {
      ...row.data,
      weekKey: previousWeekKey,
      updatedAt: row.data.updatedAt || snapshotAt,
    };
    const advanced = makeAdvancedEntry(row.data, currentWeekKey, previousWeekKey, snapshotAt);
    const owner = row.createdBy || ROLLOVER_SYSTEM_USER;
    db.run(
      'INSERT OR REPLACE INTO entry_snapshots(id,week_key,entry_id,data,created_by,snapshot_at) VALUES(?,?,?,?,?,?)',
      [`${previousWeekKey}:${row.id}`, previousWeekKey, row.id, JSON.stringify(archived), owner, snapshotAt]
    );
    db.run(
      'UPDATE entries SET data=?, updated_at=?, week_key=? WHERE id=?',
      [JSON.stringify(advanced), snapshotAt, currentWeekKey, row.id]
    );
    count += 1;
  }

  return { count, previousWeekKey };
}

function runWeekRollover(db, options = {}) {
  ensureWeekRolloverSchema(db);
  const currentWeekKey = getBusinessCurrentWeekKey(options.now || new Date());
  const state = getRolloverState(db);
  if (state.lastRolloverWeekKey === currentWeekKey) {
    const snapshotAt = new Date().toISOString();
    const backfilledCount = backfillCurrentWeekEntries(db, currentWeekKey, snapshotAt);
    if (backfilledCount > 0) saveDbImmediate();
    return {
      changed: backfilledCount > 0,
      currentWeekKey,
      backfilledCount,
      reason: backfilledCount > 0 ? 'backfilled-current-week' : 'already-rolled',
    };
  }

  const snapshotAt = new Date().toISOString();
  const result = archiveAndAdvanceEntries(db, currentWeekKey, snapshotAt);
  saveRolloverState(db, {
    lastRolloverWeekKey: currentWeekKey,
    lastRolloverAt: snapshotAt,
    lastArchivedWeekKey: result.previousWeekKey,
    lastArchivedEntryCount: result.count,
  });
  saveDbImmediate();

  return {
    changed: true,
    currentWeekKey,
    archivedWeekKey: result.previousWeekKey,
    count: result.count,
  };
}

function startWeekRollover() {
  const check = () => {
    try {
      const db = getDbSync();
      if (!db) return;
      const result = runWeekRollover(db);
      if (result.changed) {
        if (result.reason === 'backfilled-current-week') {
          console.log(`worklog week rollover: backfilled ${result.backfilledCount} current-week entries for ${result.currentWeekKey}`);
        } else {
          console.log(`worklog week rollover: archived ${result.count} entries to ${result.archivedWeekKey}, current ${result.currentWeekKey}`);
        }
      }
    } catch (err) {
      console.error('worklog week rollover failed:', err);
    }
  };
  check();
  if (timer) clearInterval(timer);
  timer = setInterval(check, CHECK_INTERVAL_MS);
}

function stopWeekRollover() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = {
  getBusinessCurrentWeekKey,
  getPreviousWeekKey,
  makeAdvancedEntry,
  backfillCurrentWeekEntries,
  archiveAndAdvanceEntries,
  runWeekRollover,
  ensureWeekRolloverSchema,
  startWeekRollover,
  stopWeekRollover,
};
