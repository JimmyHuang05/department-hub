const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getDb, getDbSync, saveDb, saveDbImmediate } = require('../db.cjs');
const { JWT_SECRET, queryOne } = require('../middleware/auth.cjs');

const KEY_PREFIX = 'ibd';
const PLAIN_KEY_PATTERN = /^ibd-[a-z0-9]{32}$/;
const ALL_SCOPES = [
  'read:projects',
  'read:worklogs',
  'read:clouddrive',
  'read:tools',
  'read:skills',
  'read:questionnaires',
];
const DEFAULT_SCOPES = ALL_SCOPES;

function makeId(prefix = 'ak') {
  return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(6).toString('hex')}`;
}

function hashKey(key) {
  return crypto.createHash('sha256').update(String(key || '')).digest('hex');
}

function cipherKey() {
  return crypto.createHash('sha256').update(String(JWT_SECRET || 'dev-secret')).digest();
}

function encryptPlainKey(plainKey) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', cipherKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainKey, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map(buffer => buffer.toString('base64url')).join('.');
}

function decryptPlainKey(payload) {
  const [ivRaw, tagRaw, encryptedRaw] = String(payload || '').split('.');
  if (!ivRaw || !tagRaw || !encryptedRaw) return '';
  const decipher = crypto.createDecipheriv('aes-256-gcm', cipherKey(), Buffer.from(ivRaw, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

function generatePlainKey() {
  return `${KEY_PREFIX}-${crypto.randomBytes(16).toString('hex')}`;
}

function keyPrefix(plainKey) {
  return plainKey.slice(0, 13);
}

function isCurrentPlainKeyFormat(plainKey) {
  return PLAIN_KEY_PATTERN.test(String(plainKey || ''));
}

function maskPlainKey(plainKey) {
  const key = String(plainKey || '');
  if (!isCurrentPlainKeyFormat(key)) return '';
  return `${key.slice(0, 9)}${'*'.repeat(23)}${key.slice(-4)}`;
}

function safeParseScopes(value) {
  try {
    const scopes = JSON.parse(value || '[]');
    return Array.isArray(scopes) ? scopes.filter(scope => ALL_SCOPES.includes(scope)) : [];
  } catch {
    return [];
  }
}

function withDefaultScopes(value) {
  return [...new Set([...safeParseScopes(value), ...DEFAULT_SCOPES])];
}

function publicKey(row) {
  let maskedKey = `${row.key_prefix}...${String(row.key_hash || '').slice(-6)}`;
  try {
    const plainKey = decryptPlainKey(row.encrypted_key);
    maskedKey = maskPlainKey(plainKey) || maskedKey;
  } catch {
    // Keep the hashed fallback for older records that cannot be decrypted.
  }

  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.key_prefix,
    maskedKey,
    scopes: safeParseScopes(row.scopes),
    status: row.status,
    expiresAt: row.expires_at || null,
    lastUsedAt: row.last_used_at || null,
    createdAt: row.created_at,
    revokedAt: row.revoked_at || null,
  };
}

function buildRow(userId, plainKey) {
  const now = new Date().toISOString();
  return {
    id: makeId('ak'),
    user_id: userId,
    name: '专属数据 API',
    key_prefix: keyPrefix(plainKey),
    key_hash: hashKey(plainKey),
    encrypted_key: encryptPlainKey(plainKey),
    scopes: JSON.stringify(DEFAULT_SCOPES),
    status: 'active',
    expires_at: null,
    last_used_at: null,
    created_at: now,
    revoked_at: null,
  };
}

function insertRow(db, row) {
  db.run(
    'INSERT INTO api_keys(id,user_id,name,key_prefix,key_hash,encrypted_key,scopes,status,expires_at,last_used_at,created_at,revoked_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
    [row.id, row.user_id, row.name, row.key_prefix, row.key_hash, row.encrypted_key, row.scopes, row.status, row.expires_at, row.last_used_at, row.created_at, row.revoked_at]
  );
}

async function ensureUserApiKey(userId) {
  const db = await getDb();
  const existing = queryOne(db, 'SELECT id,name,key_prefix,key_hash,encrypted_key,scopes,status,expires_at,last_used_at,created_at,revoked_at FROM api_keys WHERE user_id = ? AND status = ? ORDER BY created_at DESC LIMIT 1', [userId, 'active']);
  if (existing?.encrypted_key) {
    try {
      if (isCurrentPlainKeyFormat(decryptPlainKey(existing.encrypted_key))) {
        const scopes = withDefaultScopes(existing.scopes);
        if (JSON.stringify(scopes) !== JSON.stringify(safeParseScopes(existing.scopes))) {
          existing.scopes = JSON.stringify(scopes);
          db.run('UPDATE api_keys SET scopes = ? WHERE id = ?', [existing.scopes, existing.id]);
          saveDbImmediate();
        }
        return publicKey(existing);
      }
    } catch {
      // Fall through and issue a fresh key if the stored key is unreadable.
    }
  }

  db.run('UPDATE api_keys SET status = ?, revoked_at = ? WHERE user_id = ? AND status = ?', ['revoked', new Date().toISOString(), userId, 'active']);
  const row = buildRow(userId, generatePlainKey());
  insertRow(db, row);
  saveDbImmediate();
  return publicKey(row);
}

async function revealUserApiKey(userId, password) {
  const db = await getDb();
  const user = queryOne(db, 'SELECT password FROM users WHERE id = ?', [userId]);
  if (!user || !bcrypt.compareSync(String(password || ''), user.password)) {
    return { ok: false, error: '登录密码不正确' };
  }
  await ensureUserApiKey(userId);
  const row = queryOne(db, 'SELECT encrypted_key FROM api_keys WHERE user_id = ? AND status = ? ORDER BY created_at DESC LIMIT 1', [userId, 'active']);
  const plainKey = decryptPlainKey(row?.encrypted_key);
  if (!plainKey) return { ok: false, error: 'API Key 无法解密，请刷新后重试' };
  return { ok: true, plainKey };
}

function getUserApiKey(userId) {
  const db = getDbSync();
  if (!db) return null;
  const row = queryOne(db, 'SELECT id,name,key_prefix,key_hash,encrypted_key,scopes,status,expires_at,last_used_at,created_at,revoked_at FROM api_keys WHERE user_id = ? AND status = ? ORDER BY created_at DESC LIMIT 1', [userId, 'active']);
  return row ? publicKey(row) : null;
}

function authenticateApiKey(req, res, next) {
  const plainKey = String(req.headers['x-api-key'] || req.query.apiKey || '').trim();
  if (!plainKey) return res.status(401).json({ error: '缺少 API Key' });

  const db = getDbSync();
  if (!db) return res.status(503).json({ error: '数据库尚未初始化' });

  const keyHash = hashKey(plainKey);
  const row = queryOne(db, `
    SELECT k.*, u.display_name, u.role, u.business_role, u.status AS user_status
    FROM api_keys k
    JOIN users u ON u.id = k.user_id
    WHERE k.key_hash = ? AND k.status = 'active'
    LIMIT 1
  `, [keyHash]);

  if (!row) return res.status(401).json({ error: 'API Key 无效或已刷新' });
  if (row.user_status !== 'active') return res.status(403).json({ error: '用户账号不可用' });

  req.apiKey = {
    id: row.id,
    userId: row.user_id,
    scopes: withDefaultScopes(row.scopes),
  };
  req.user = {
    id: row.user_id,
    display_name: row.display_name,
    role: row.role,
    business_role: row.business_role,
  };

  db.run('UPDATE api_keys SET last_used_at = ? WHERE id = ?', [new Date().toISOString(), row.id]);
  saveDb();
  next();
}

function requireApiScope(scope) {
  return (req, res, next) => {
    if (!req.apiKey?.scopes?.includes(scope)) {
      return res.status(403).json({ error: 'API Key 权限不足' });
    }
    next();
  };
}

function logApiAccess(req, { statusCode = 200, resultCount = 0 } = {}) {
  const db = getDbSync();
  if (!db || !req.apiKey) return;
  db.run(
    'INSERT INTO api_access_logs(id,api_key_id,user_id,endpoint,query,status_code,result_count,ip,user_agent,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
    [
      makeId('alog'),
      req.apiKey.id,
      req.apiKey.userId,
      req.path,
      JSON.stringify(req.query || {}),
      statusCode,
      resultCount,
      req.ip || req.socket?.remoteAddress || '',
      req.headers['user-agent'] || '',
      new Date().toISOString(),
    ]
  );
  saveDb();
}

module.exports = {
  ALL_SCOPES,
  authenticateApiKey,
  ensureUserApiKey,
  getUserApiKey,
  logApiAccess,
  requireApiScope,
  revealUserApiKey,
};
