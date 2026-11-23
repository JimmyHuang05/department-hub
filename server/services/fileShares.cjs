const crypto = require('crypto');
const { getDbSync, saveDbImmediate } = require('../db.cjs');

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function createShare(resourceType, resourceId, versionId, userId) {
  const db = getDbSync();
  if (!db) throw new Error('数据库未就绪');
  const token = crypto.randomBytes(24).toString('base64url');
  db.run(
    'INSERT INTO file_share_links (token_hash, resource_type, resource_id, version_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [hashToken(token), resourceType, resourceId, versionId || '', userId, new Date().toISOString()]
  );
  saveDbImmediate();
  return token;
}

function findShare(token, resourceType) {
  const db = getDbSync();
  if (!db || !token) return null;
  const stmt = db.prepare('SELECT * FROM file_share_links WHERE token_hash = ? AND resource_type = ?');
  try {
    stmt.bind([hashToken(token), resourceType]);
    return stmt.step() ? stmt.getAsObject() : null;
  } finally {
    stmt.free();
  }
}

module.exports = { createShare, findShare };
