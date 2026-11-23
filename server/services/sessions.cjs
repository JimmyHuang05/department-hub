const { getDbSync, saveDb, saveDbImmediate } = require('../db.cjs');

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function queryOne(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const row = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  return row;
}

function normalizeDeviceType(value) {
  return value === 'mobile' ? 'mobile' : 'desktop';
}

function publicSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    deviceId: row.device_id,
    deviceType: normalizeDeviceType(row.device_type),
    deviceName: row.device_name || '',
    loginAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
}

function findActiveSession(userId, deviceType) {
  const db = getDbSync();
  if (!db) return null;
  const row = queryOne(
    db,
    `SELECT * FROM user_sessions
     WHERE user_id = ? AND device_type = ? AND status = 'active'
     ORDER BY datetime(last_seen_at) DESC
     LIMIT 1`,
    [userId, normalizeDeviceType(deviceType)]
  );
  return row;
}

function createSession({ id, userId, tokenId, deviceId, deviceType, deviceName, userAgent, ip }) {
  const db = getDbSync();
  if (!db) throw new Error('数据库未初始化');
  const sessionId = id || makeId('sess');
  const timestamp = nowIso();
  db.run(
    `INSERT INTO user_sessions
      (id, user_id, token_id, device_id, device_type, device_name, user_agent, ip, status, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    [
      sessionId,
      userId,
      tokenId,
      deviceId,
      normalizeDeviceType(deviceType),
      deviceName || '',
      userAgent || '',
      ip || '',
      timestamp,
      timestamp,
    ]
  );
  saveDbImmediate();
  return { id: sessionId, createdAt: timestamp };
}

function revokeSession(sessionId, reason = 'revoked', replacedBySessionId = '') {
  const db = getDbSync();
  if (!db || !sessionId) return null;
  const existing = queryOne(db, 'SELECT * FROM user_sessions WHERE id = ?', [sessionId]);
  if (!existing || existing.status !== 'active') return publicSession(existing);
  db.run(
    `UPDATE user_sessions
     SET status = 'revoked', revoked_at = ?, revoked_reason = ?, replaced_by_session_id = ?
     WHERE id = ?`,
    [nowIso(), reason, replacedBySessionId || '', sessionId]
  );
  saveDbImmediate();
  return publicSession(existing);
}

function revokeActiveSessionForDevice(userId, deviceType, reason, replacedBySessionId) {
  const existing = findActiveSession(userId, deviceType);
  if (!existing) return null;
  revokeSession(existing.id, reason, replacedBySessionId);
  return publicSession(existing);
}

function touchSession(sessionId) {
  const db = getDbSync();
  if (!db || !sessionId) return;
  db.run('UPDATE user_sessions SET last_seen_at = ? WHERE id = ? AND status = "active"', [nowIso(), sessionId]);
  saveDb();
}

function getSession(sessionId) {
  const db = getDbSync();
  if (!db || !sessionId) return null;
  return queryOne(db, 'SELECT * FROM user_sessions WHERE id = ?', [sessionId]);
}

function isSessionActive(sessionId) {
  const row = getSession(sessionId);
  return Boolean(row && row.status === 'active');
}

module.exports = {
  makeId,
  normalizeDeviceType,
  publicSession,
  findActiveSession,
  createSession,
  revokeSession,
  revokeActiveSessionForDevice,
  touchSession,
  getSession,
  isSessionActive,
};
