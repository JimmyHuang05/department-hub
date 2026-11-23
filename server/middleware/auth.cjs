const jwt = require('jsonwebtoken');
const { getDbSync } = require('../db.cjs');
const { isSessionActive, touchSession, getSession } = require('../services/sessions.cjs');
const { loadJwtSecret } = require('../services/securityConfig.cjs');

const JWT_SECRET = loadJwtSecret();
const VALID_ROLES = ['user', 'admin'];

function queryOne(db, sql, params = []) {
  try {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return row;
    }
    stmt.free();
  } catch (e) {
    console.error('queryOne failed:', e);
  }
  return null;
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  const queryToken = typeof req.query?.access_token === 'string' ? req.query.access_token : '';
  if ((!header || !header.startsWith('Bearer ')) && !queryToken) {
    return res.status(401).json({ error: '未登录' });
  }

  const tokenStr = queryToken || header.slice(7);
  try {
    const decoded = jwt.verify(tokenStr, JWT_SECRET);

    const db = getDbSync();
    if (decoded.sid) {
      if (!isSessionActive(decoded.sid)) {
        const session = getSession(decoded.sid);
        return res.status(401).json({
          code: 'SESSION_REVOKED',
          error: '你的账号已在另一台设备登录，本设备已下线。',
          logoutInfo: {
            deviceType: session?.device_type || decoded.deviceType || '',
            deviceName: session?.device_name || '',
            loginAt: session?.revoked_at || new Date().toISOString(),
          },
        });
      }
      touchSession(decoded.sid);
    }

    if (db && decoded.jti) {
      const blacklisted = queryOne(db, 'SELECT 1 AS found FROM token_blacklist WHERE jti = ?', [decoded.jti]);
      if (blacklisted && blacklisted.found === 1) {
        return res.status(401).json({ error: '登录已过期，请重新登录' });
      }
    }

    if (db) {
      const userInfo = queryOne(db, 'SELECT status, role, business_role, display_name FROM users WHERE id = ?', [decoded.id]);
      if (!userInfo) {
        return res.status(401).json({ error: '用户不存在' });
      }
      if (userInfo.status === 'disabled') {
        return res.status(403).json({ error: '账号已被禁用，请联系高级用户' });
      }
      decoded.role = VALID_ROLES.includes(userInfo.role) ? userInfo.role : 'user';
      decoded.business_role = userInfo.business_role || 'intern';
      decoded.display_name = userInfo.display_name;
    }

    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
}

function requireRole(...roles) {
  const allowed = roles.flat();
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: '未登录' });
    }
    if (!allowed.includes(req.user.role)) {
      const roleLabel = req.user.role || '未知';
      return res.status(403).json({ error: `角色 "${roleLabel}" 无权限执行此操作` });
    }
    next();
  };
}

function requireBusinessRole(...businessRoles) {
  const allowed = businessRoles.flat();
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: '未登录' });
    }
    if (!allowed.includes(req.user.business_role)) {
      return res.status(403).json({ error: '仅开发者可访问此功能' });
    }
    next();
  };
}

function adminMiddleware(req, res, next) {
  return requireRole('admin')(req, res, next);
}

function generateToken(user, session = {}) {
  const jti = user.jti || Date.now().toString(36) + Math.random().toString(36).substr(2, 8);
  return jwt.sign(
    {
      id: user.id,
      display_name: user.display_name,
      role: user.role,
      business_role: user.business_role || 'intern',
      jti,
      sid: session.sessionId,
      deviceType: session.deviceType,
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function getUserInfo(id) {
  const db = getDbSync();
  if (!db) return null;
  const row = queryOne(db, 'SELECT id, display_name, role, business_role, status, created_at FROM users WHERE id = ?', [id]);
  return row || null;
}

module.exports = {
  authMiddleware,
  adminMiddleware,
  requireRole,
  requireBusinessRole,
  generateToken,
  getUserInfo,
  queryOne,
  JWT_SECRET,
  VALID_ROLES,
};
