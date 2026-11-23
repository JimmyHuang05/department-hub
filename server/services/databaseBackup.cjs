const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_ROOT } = require('../paths.cjs');
const { getDbSync, saveDbImmediate } = require('../db.cjs');

const BACKUP_DIR = process.env.IBD_BACKUP_DIR
  ? path.resolve(process.env.IBD_BACKUP_DIR)
  : path.join(DATA_ROOT, 'backups');
const BACKUP_SETTINGS_PATH = path.join(DATA_ROOT, 'backup-settings.json');
const BUSINESS_BACKUP_FORMAT = 'ibd-business-backup';
const BUSINESS_BACKUP_VERSION = 1;
const BUSINESS_BACKUP_SUFFIX = '.ibd-business.json';
const BUSINESS_SETTING_IDS = ['main', 'worklog_week_rollover'];
const ALLOWED_MAX_BACKUPS = [0, 3, 7, 14, 30];
const DEFAULT_MAX_BACKUPS = 7;
const TOKEN_PREFIX = 'Qb8';
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const TOKEN_EPOCH = Date.UTC(2020, 0, 1);
const LEGACY_TOKEN_EPOCH = new Date(2020, 0, 1).getTime();
let timer = null;

function encodeBase62(value, width) {
  let number = Math.max(0, Math.floor(Number(value)));
  let encoded = '';
  do {
    encoded = BASE62[number % 62] + encoded;
    number = Math.floor(number / 62);
  } while (number > 0);
  return encoded.padStart(width, '0').slice(-width);
}

function decodeBase62(value) {
  let result = 0;
  for (const character of value) {
    const digit = BASE62.indexOf(character);
    if (digit < 0) return NaN;
    result = result * 62 + digit;
  }
  return result;
}

function tokenChecksum(value) {
  let hash = 17;
  for (const character of value) hash = (hash * 131 + character.charCodeAt(0)) % (62 * 62);
  return encodeBase62(hash, 2);
}

function createBackupToken(type, dataDate, createdAt = new Date()) {
  const dataDay = Date.parse(`${dataDate}T00:00:00Z`);
  const daysSinceEpoch = Math.floor((dataDay - TOKEN_EPOCH) / 86400000);
  const secondsSinceEpoch = Math.floor((createdAt.getTime() - TOKEN_EPOCH) / 1000);
  const random = encodeBase62(crypto.randomInt(62 * 62), 2);
  const body = `${TOKEN_PREFIX}${type}${encodeBase62(daysSinceEpoch, 4)}${encodeBase62(secondsSinceEpoch, 6)}${random}`;
  return `${body}${tokenChecksum(body)}`;
}

function backupTokenFromName(name) {
  const value = String(name || '');
  if (value.endsWith(BUSINESS_BACKUP_SUFFIX)) return value.slice(0, -BUSINESS_BACKUP_SUFFIX.length);
  return value.replace(/\.db$/i, '');
}

function parseBackupToken(name) {
  const token = backupTokenFromName(name);
  if (!/^Qb[78][AR][0-9A-Za-z]{14}$/.test(token)) return null;
  const legacy = token.startsWith('Qb7');
  const epoch = legacy ? LEGACY_TOKEN_EPOCH : TOKEN_EPOCH;
  const body = token.slice(0, -2);
  if (tokenChecksum(body) !== token.slice(-2)) return null;
  const daysSinceEpoch = decodeBase62(token.slice(4, 8));
  const secondsSinceEpoch = decodeBase62(token.slice(8, 14));
  if (!Number.isFinite(daysSinceEpoch) || !Number.isFinite(secondsSinceEpoch)) return null;
  const dataDay = new Date(epoch + daysSinceEpoch * 86400000);
  return {
    type: token[3] === 'A' ? 'automatic' : 'manual',
    dataDate: legacy ? localDateKey(dataDay) : dataDay.toISOString().slice(0, 10),
    createdAt: new Date(epoch + secondsSinceEpoch * 1000),
  };
}

function isBackupFileName(name) {
  return String(name || '').endsWith(BUSINESS_BACKUP_SUFFIX) && Boolean(parseBackupToken(name));
}

function readBackupSettings() {
  try {
    const parsed = JSON.parse(fs.readFileSync(BACKUP_SETTINGS_PATH, 'utf8'));
    return {
      maxBackups: ALLOWED_MAX_BACKUPS.includes(Number(parsed.maxBackups)) ? Number(parsed.maxBackups) : DEFAULT_MAX_BACKUPS,
      starredBackups: Array.isArray(parsed.starredBackups)
        ? Array.from(new Set(parsed.starredBackups.filter(isBackupFileName)))
        : [],
    };
  } catch (_) {
    return { maxBackups: DEFAULT_MAX_BACKUPS, starredBackups: [] };
  }
}

function writeBackupSettings(settings) {
  fs.mkdirSync(DATA_ROOT, { recursive: true });
  const temporary = `${BACKUP_SETTINGS_PATH}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(settings, null, 2), 'utf8');
  fs.renameSync(temporary, BACKUP_SETTINGS_PATH);
}

function getMaxBackups() {
  return readBackupSettings().maxBackups;
}

function getStarredBackups() {
  return new Set(readBackupSettings().starredBackups);
}

function setMaxBackups(value) {
  const maxBackups = Number(value);
  if (!ALLOWED_MAX_BACKUPS.includes(maxBackups)) throw new Error('备份设置只能选择不备份、3、7、14 或 30 天');
  const settings = readBackupSettings();
  writeBackupSettings({ ...settings, maxBackups });
  pruneBackups();
  return maxBackups;
}

function setBackupStarred(name, starred) {
  if (!isBackupFileName(name)) throw new Error('业务备份文件名无效');
  const settings = readBackupSettings();
  const names = new Set(settings.starredBackups);
  if (starred) names.add(name);
  else names.delete(name);
  writeBackupSettings({ ...settings, starredBackups: Array.from(names).sort() });
  if (!starred) pruneBackups();
  return starred;
}

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function previousDateKey(now = new Date()) {
  const date = new Date(now);
  date.setDate(date.getDate() - 1);
  return localDateKey(date);
}

function rows(result) {
  return (result[0]?.values || []).map(values => Object.fromEntries(result[0].columns.map((column, index) => [column, values[index]])));
}

function buildBusinessBackup(db = getDbSync(), options = {}) {
  if (!db) throw new Error('数据库尚未初始化');
  const createdAt = options.now || new Date();
  const dataDate = options.dataDate || localDateKey(createdAt);
  const settingPlaceholders = BUSINESS_SETTING_IDS.map(() => '?').join(',');
  return {
    format: BUSINESS_BACKUP_FORMAT,
    version: BUSINESS_BACKUP_VERSION,
    createdAt: createdAt.toISOString(),
    dataDate,
    scope: ['products', 'entries', 'entry_snapshots', 'business_settings'],
    tables: {
      products: rows(db.exec('SELECT id,data,created_by,updated_at FROM products ORDER BY id')),
      entries: rows(db.exec('SELECT id,data,created_by,updated_at,week_key FROM entries ORDER BY id')),
      entrySnapshots: rows(db.exec('SELECT id,week_key,entry_id,data,created_by,snapshot_at FROM entry_snapshots ORDER BY id')),
      settings: rows(db.exec(`SELECT id,data,updated_at FROM settings WHERE id IN (${settingPlaceholders}) ORDER BY id`, BUSINESS_SETTING_IDS)),
    },
  };
}

function validateJsonRows(rowsValue, requiredKeys, label) {
  if (!Array.isArray(rowsValue)) throw new Error(`业务备份缺少 ${label} 数据`);
  const ids = new Set();
  for (const row of rowsValue) {
    if (!row || requiredKeys.some(key => typeof row[key] !== 'string')) throw new Error(`${label} 数据格式无效`);
    if (ids.has(row.id)) throw new Error(`${label} 包含重复 ID`);
    ids.add(row.id);
    if ('data' in row) {
      try { JSON.parse(row.data); } catch { throw new Error(`${label} 包含损坏的 JSON 数据`); }
    }
  }
}

function validateBusinessBackup(value) {
  const backup = Buffer.isBuffer(value) ? JSON.parse(value.toString('utf8')) : value;
  if (!backup || backup.format !== BUSINESS_BACKUP_FORMAT || backup.version !== BUSINESS_BACKUP_VERSION) {
    throw new Error('不是有效的 IBD 业务数据备份');
  }
  if (!backup.tables || typeof backup.tables !== 'object') throw new Error('业务备份内容不完整');
  validateJsonRows(backup.tables.products, ['id', 'data', 'created_by', 'updated_at'], '项目进度');
  validateJsonRows(backup.tables.entries, ['id', 'data', 'created_by', 'updated_at'], '管理周报');
  validateJsonRows(backup.tables.entrySnapshots, ['id', 'week_key', 'entry_id', 'data', 'created_by', 'snapshot_at'], '周报历史');
  validateJsonRows(backup.tables.settings, ['id', 'data', 'updated_at'], '业务设置');
  if (backup.tables.settings.some(row => !BUSINESS_SETTING_IDS.includes(row.id))) throw new Error('业务备份包含越权设置');
  return backup;
}

function applyBusinessBackupToDb(db, value) {
  const backup = validateBusinessBackup(value);
  db.run('BEGIN');
  try {
    db.run('DELETE FROM entry_snapshots');
    db.run('DELETE FROM entries');
    db.run('DELETE FROM products');
    for (const id of BUSINESS_SETTING_IDS) db.run('DELETE FROM settings WHERE id=?', [id]);
    for (const row of backup.tables.products) {
      db.run('INSERT INTO products(id,data,created_by,updated_at) VALUES(?,?,?,?)', [row.id, row.data, row.created_by, row.updated_at]);
    }
    for (const row of backup.tables.entries) {
      db.run('INSERT INTO entries(id,data,created_by,updated_at,week_key) VALUES(?,?,?,?,?)', [row.id, row.data, row.created_by, row.updated_at, row.week_key || null]);
    }
    for (const row of backup.tables.entrySnapshots) {
      db.run('INSERT INTO entry_snapshots(id,week_key,entry_id,data,created_by,snapshot_at) VALUES(?,?,?,?,?,?)', [row.id, row.week_key, row.entry_id, row.data, row.created_by, row.snapshot_at]);
    }
    for (const row of backup.tables.settings) {
      db.run('INSERT INTO settings(id,data,updated_at) VALUES(?,?,?)', [row.id, row.data, row.updated_at]);
    }
    db.run('COMMIT');
  } catch (error) {
    try { db.run('ROLLBACK'); } catch (_) {}
    throw error;
  }
  return backup;
}

function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  const starred = getStarredBackups();
  return fs.readdirSync(BACKUP_DIR)
    .filter(isBackupFileName)
    .map(name => {
      const filePath = path.join(BACKUP_DIR, name);
      return { name, path: filePath, stat: fs.statSync(filePath), starred: starred.has(name) };
    })
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
}

function selectBackupsToPrune(backups, maximum = DEFAULT_MAX_BACKUPS) {
  return backups.filter(backup => !backup.starred).sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs).slice(maximum);
}

function pruneBackups() {
  if (getMaxBackups() === 0) return;
  for (const backup of selectBackupsToPrune(listBackups(), getMaxBackups())) fs.unlinkSync(backup.path);
}

function createBusinessBackup(options = {}) {
  const now = options.now || new Date();
  const dataDate = options.dataDate || (options.type === 'manual' ? localDateKey(now) : previousDateKey(now));
  const type = options.type === 'manual' ? 'R' : 'A';
  const backup = buildBusinessBackup(getDbSync(), { now, dataDate });
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const existing = type === 'A' ? listBackups().find(item => !item.starred && parseBackupToken(item.name)?.type === 'automatic' && parseBackupToken(item.name)?.dataDate === dataDate) : null;
  const target = existing?.path || path.join(BACKUP_DIR, `${createBackupToken(type, dataDate, now)}${BUSINESS_BACKUP_SUFFIX}`);
  const temporary = `${target}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(backup), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, target);
  pruneBackups();
  return target;
}

function applyBusinessBackupFile(filePath) {
  const backup = applyBusinessBackupToDb(getDbSync(), fs.readFileSync(filePath));
  saveDbImmediate();
  return backup;
}

function millisecondsUntilNextMidnight(now = new Date()) {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return Math.max(1, next.getTime() - now.getTime());
}

function scheduleNextBackup() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    if (getMaxBackups() !== 0) {
      try { createBusinessBackup(); } catch (error) { console.error('business backup failed:', error); }
    }
    scheduleNextBackup();
  }, millisecondsUntilNextMidnight());
  timer.unref?.();
}

function startDatabaseBackups() {
  try { pruneBackups(); } catch (error) { console.error('business backup cleanup failed:', error); }
  if (getMaxBackups() !== 0 && listBackups().length === 0) {
    try { createBusinessBackup(); } catch (error) { console.error('initial business backup failed:', error); }
  }
  scheduleNextBackup();
}

function stopDatabaseBackups() {
  if (timer) clearTimeout(timer);
  timer = null;
}

module.exports = {
  ALLOWED_MAX_BACKUPS,
  BACKUP_DIR,
  BUSINESS_BACKUP_FORMAT,
  BUSINESS_BACKUP_SUFFIX,
  DEFAULT_MAX_BACKUPS,
  applyBusinessBackupFile,
  applyBusinessBackupToDb,
  buildBusinessBackup,
  createBackupToken,
  createBusinessBackup,
  getMaxBackups,
  isBackupFileName,
  listBackups,
  millisecondsUntilNextMidnight,
  parseBackupToken,
  previousDateKey,
  pruneBackups,
  selectBackupsToPrune,
  setBackupStarred,
  setMaxBackups,
  startDatabaseBackups,
  stopDatabaseBackups,
  validateBusinessBackup,
};
