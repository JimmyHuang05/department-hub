const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { SHEET_EDITOR_DB_PATH, SHEET_EDITOR_ROOT } = require('../paths.cjs');

let editorDbPromise = null;
const LOCK_LEASE_MS = 90 * 1000;
const VERSION_RETENTION_COUNT = 30;
const VERSION_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

function persist(db) {
  fs.mkdirSync(path.dirname(SHEET_EDITOR_DB_PATH), { recursive: true });
  const tempPath = `${SHEET_EDITOR_DB_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, Buffer.from(db.export()), { mode: 0o600 });
  fs.renameSync(tempPath, SHEET_EDITOR_DB_PATH);
}

async function getEditorDb() {
  if (editorDbPromise) return editorDbPromise;
  editorDbPromise = (async () => {
    const SQL = await initSqlJs();
    const db = fs.existsSync(SHEET_EDITOR_DB_PATH)
      ? new SQL.Database(fs.readFileSync(SHEET_EDITOR_DB_PATH))
      : new SQL.Database();
    db.run(`CREATE TABLE IF NOT EXISTS sheet_sessions (
      id TEXT PRIMARY KEY,
      file_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      user_name TEXT NOT NULL,
      mode TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_used_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    )`);
    db.run('CREATE INDEX IF NOT EXISTS idx_sheet_sessions_lookup ON sheet_sessions(file_id, user_id, status)');
    db.run(`CREATE TABLE IF NOT EXISTS sheet_locks (
      file_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      user_name TEXT NOT NULL,
      acquired_at TEXT NOT NULL,
      heartbeat_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS sheet_versions (
      id TEXT PRIMARY KEY,
      file_id TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      size INTEGER NOT NULL,
      source_revision TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_by_name TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`);
    db.run('CREATE INDEX IF NOT EXISTS idx_sheet_versions_file ON sheet_versions(file_id, created_at DESC)');
    const startupNow = new Date().toISOString();
    const staleSessionCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    db.run("UPDATE sheet_sessions SET status='expired' WHERE status='active' AND expires_at<=?", [startupNow]);
    db.run('DELETE FROM sheet_locks WHERE expires_at<=?', [startupNow]);
    db.run("DELETE FROM sheet_sessions WHERE status!='active' AND created_at<?", [staleSessionCutoff]);
    persist(db);
    return db;
  })().catch(error => {
    editorDbPromise = null;
    throw error;
  });
  return editorDbPromise;
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function queryOne(db, sql, params = []) {
  const statement = db.prepare(sql);
  try {
    statement.bind(params);
    return statement.step() ? statement.getAsObject() : null;
  } finally {
    statement.free();
  }
}

function queryAll(db, sql, params = []) {
  const statement = db.prepare(sql);
  const rows = [];
  try {
    statement.bind(params);
    while (statement.step()) rows.push(statement.getAsObject());
    return rows;
  } finally {
    statement.free();
  }
}

function versionDirectory(fileId) {
  const bucket = crypto.createHash('sha256').update(String(fileId)).digest('hex');
  return path.join(SHEET_EDITOR_ROOT, 'versions', bucket);
}

function versionFilePath(fileId, storedName) {
  const rawName = String(storedName || '');
  if (!rawName || path.basename(rawName) !== rawName) return '';
  const root = path.resolve(versionDirectory(fileId));
  const candidate = path.resolve(root, rawName);
  return candidate.startsWith(`${root}${path.sep}`) ? candidate : '';
}

function pruneSheetVersions(db, fileId) {
  const cutoff = Date.now() - VERSION_RETENTION_MS;
  const rows = queryAll(db, 'SELECT id,stored_name,created_at FROM sheet_versions WHERE file_id=? ORDER BY created_at DESC', [fileId]);
  rows.forEach((row, index) => {
    const expired = Date.parse(row.created_at) < cutoff;
    if (index < VERSION_RETENTION_COUNT && !expired) return;
    const filePath = versionFilePath(fileId, row.stored_name);
    try {
      if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
      db.run('DELETE FROM sheet_versions WHERE id=? AND file_id=?', [row.id, fileId]);
    } catch (error) {
      console.warn('[sheet-editor] 清理历史版本失败:', error.message);
    }
  });
}

async function createSheetSession({ fileId, userId, userName, mode = 'edit', lifetimeMs = 30 * 60 * 1000 }) {
  const db = await getEditorDb();
  const id = `sheet-session-${crypto.randomUUID()}`;
  const token = crypto.randomBytes(32).toString('base64url');
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + lifetimeMs).toISOString();
  const existingLock = queryOne(db, 'SELECT * FROM sheet_locks WHERE file_id=?', [fileId]);
  if (existingLock && Date.parse(existingLock.expires_at) <= Date.now()) {
    db.run('DELETE FROM sheet_locks WHERE file_id=?', [fileId]);
  }
  const activeLock = queryOne(db, 'SELECT * FROM sheet_locks WHERE file_id=?', [fileId]);
  const grantedMode = mode === 'edit' && (!activeLock || activeLock.user_id === userId) ? 'edit' : 'readonly';
  db.run(
    "UPDATE sheet_sessions SET status='superseded' WHERE file_id=? AND user_id=? AND status='active'",
    [fileId, userId],
  );
  db.run(
    'INSERT INTO sheet_sessions(id,file_id,user_id,user_name,mode,token_hash,status,created_at,last_used_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
    [id, fileId, userId, userName || '', grantedMode, tokenHash(token), 'active', createdAt, createdAt, expiresAt],
  );
  if (grantedMode === 'edit') {
    const lockExpiresAt = new Date(Date.now() + LOCK_LEASE_MS).toISOString();
    db.run('DELETE FROM sheet_locks WHERE file_id=?', [fileId]);
    db.run(
      'INSERT INTO sheet_locks(file_id,session_id,user_id,user_name,acquired_at,heartbeat_at,expires_at) VALUES(?,?,?,?,?,?,?)',
      [fileId, id, userId, userName || '', createdAt, createdAt, lockExpiresAt],
    );
  }
  persist(db);
  return {
    id,
    token,
    mode: grantedMode,
    createdAt,
    expiresAt,
    lock: grantedMode === 'edit'
      ? { ownerName: userName || '', expiresAt: new Date(Date.now() + LOCK_LEASE_MS).toISOString() }
      : activeLock ? { ownerName: String(activeLock.user_name || '其他用户'), expiresAt: String(activeLock.expires_at) } : null,
  };
}

async function validateSheetSession({ sessionId, token, fileId, userId }) {
  if (!sessionId || !token) return null;
  const db = await getEditorDb();
  const row = queryOne(db, 'SELECT * FROM sheet_sessions WHERE id=?', [sessionId]);
  if (!row || row.status !== 'active' || row.file_id !== fileId || row.user_id !== userId) return null;
  if (Date.parse(row.expires_at) <= Date.now()) {
    db.run("UPDATE sheet_sessions SET status='expired' WHERE id=?", [sessionId]);
    db.run('DELETE FROM sheet_locks WHERE session_id=?', [sessionId]);
    persist(db);
    return null;
  }
  const actual = Buffer.from(tokenHash(token));
  const expected = Buffer.from(String(row.token_hash));
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  const usedAt = new Date().toISOString();
  db.run('UPDATE sheet_sessions SET last_used_at=? WHERE id=?', [usedAt, sessionId]);
  persist(db);
  return row;
}

async function validateSheetLock({ sessionId, fileId, userId }) {
  const db = await getEditorDb();
  const lock = queryOne(db, 'SELECT * FROM sheet_locks WHERE file_id=?', [fileId]);
  if (!lock || lock.session_id !== sessionId || lock.user_id !== userId) return null;
  if (Date.parse(lock.expires_at) <= Date.now()) {
    db.run('DELETE FROM sheet_locks WHERE file_id=?', [fileId]);
    persist(db);
    return null;
  }
  return lock;
}

async function heartbeatSheetLock({ sessionId, fileId, userId }) {
  const db = await getEditorDb();
  const lock = await validateSheetLock({ sessionId, fileId, userId });
  if (!lock) return null;
  const heartbeatAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + LOCK_LEASE_MS).toISOString();
  db.run('UPDATE sheet_locks SET heartbeat_at=?, expires_at=? WHERE file_id=? AND session_id=?', [heartbeatAt, expiresAt, fileId, sessionId]);
  persist(db);
  return { heartbeatAt, expiresAt };
}

async function releaseSheetLock({ sessionId, fileId, userId }) {
  const db = await getEditorDb();
  db.run('DELETE FROM sheet_locks WHERE file_id=? AND session_id=? AND user_id=?', [fileId, sessionId, userId]);
  persist(db);
}

async function createSheetVersion({ fileId, sourcePath, checksum, sourceRevision, reason, userId, userName }) {
  const db = await getEditorDb();
  const id = `sheet-version-${crypto.randomUUID()}`;
  const storedName = `${id}.xlsx`;
  const directory = versionDirectory(fileId);
  const targetPath = versionFilePath(fileId, storedName);
  const tempPath = `${targetPath}.${process.pid}.tmp`;
  fs.mkdirSync(directory, { recursive: true });
  try {
    fs.copyFileSync(sourcePath, tempPath, fs.constants.COPYFILE_EXCL);
    const descriptor = fs.openSync(tempPath, 'r+');
    try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    fs.renameSync(tempPath, targetPath);
    const stat = fs.statSync(targetPath);
    const actualChecksum = crypto.createHash('sha256').update(fs.readFileSync(targetPath)).digest('hex');
    const createdAt = new Date().toISOString();
    db.run(
      'INSERT INTO sheet_versions(id,file_id,stored_name,checksum,size,source_revision,reason,created_by,created_by_name,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
      [id, fileId, storedName, actualChecksum, stat.size, sourceRevision, reason, userId, userName || '', createdAt],
    );
    pruneSheetVersions(db, fileId);
    persist(db);
    return { id, fileId, checksum: actualChecksum, size: stat.size, sourceRevision, reason, createdBy: userId, createdByName: userName || '', createdAt };
  } catch (error) {
    try { db.run('DELETE FROM sheet_versions WHERE id=?', [id]); } catch {}
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch {}
    try { if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath); } catch {}
    throw error;
  }
}

async function listSheetVersions(fileId, limit = 50) {
  const db = await getEditorDb();
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 100));
  return queryAll(
    db,
    'SELECT id,checksum,size,source_revision,reason,created_by,created_by_name,created_at FROM sheet_versions WHERE file_id=? ORDER BY created_at DESC LIMIT ?',
    [fileId, safeLimit],
  ).map(row => ({
    id: row.id,
    checksum: row.checksum,
    size: Number(row.size),
    sourceRevision: row.source_revision,
    reason: row.reason,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
  }));
}

async function getSheetVersion(fileId, versionId) {
  const db = await getEditorDb();
  const row = queryOne(db, 'SELECT * FROM sheet_versions WHERE id=? AND file_id=?', [versionId, fileId]);
  if (!row) return null;
  const filePath = versionFilePath(fileId, row.stored_name);
  if (!filePath || !fs.existsSync(filePath)) return null;
  return { ...row, filePath };
}

module.exports = {
  getEditorDb,
  createSheetSession,
  validateSheetSession,
  validateSheetLock,
  heartbeatSheetLock,
  releaseSheetLock,
  createSheetVersion,
  listSheetVersions,
  getSheetVersion,
};
