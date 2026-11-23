const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb, getDbSync, saveDbImmediate } = require('../db.cjs');
const { authMiddleware, requireRole, generateToken, queryOne } = require('../middleware/auth.cjs');
const { createRateLimiter } = require('../middleware/rateLimit.cjs');
const { logAudit, sqlSnapshot } = require('../services/audit.cjs');
const { removeInitialAdminPasswordFile } = require('../services/securityConfig.cjs');
const {
  makeId,
  normalizeDeviceType,
  publicSession,
  findActiveSession,
  createSession,
  revokeSession,
  revokeActiveSessionForDevice,
  touchSession,
} = require('../services/sessions.cjs');
const { notifySessionRevoked } = require('../ws/hub.cjs');

const { PUBLIC_DEMO_ID, getPublicDemoCredentials } = require('../services/publicDemo.cjs');

const router = express.Router();
const BUSINESS_ROLES = ['intern', 'trust_manager', 'developer', 'admin'];
const SYSTEM_ROLES = ['user', 'admin'];
const loginIpLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 100,
  keyGenerator: req => req.ip,
  message: '登录尝试过于频繁，请稍后再试',
});
const loginAccountLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 20,
  keyGenerator: req => normalizeLoginIdentifier(req.body?.username).toLowerCase() || 'missing-account',
  message: '该账号登录尝试过于频繁，请稍后再试',
});
const selfRegistrationLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: req => req.ip,
  message: '注册申请过于频繁，请稍后再试',
});

function nextUserId() {
  const db = getDbSync();
  const result = db.exec("SELECT MAX(CAST(SUBSTR(id, 5) AS INTEGER)) FROM users WHERE id LIKE 'IBD-%'");
  const maxNum = result.length && result[0].values?.[0]?.[0] ? Number(result[0].values[0][0]) : 0;
  return 'IBD-' + String(maxNum + 1).padStart(5, '0');
}

function normalizeRole(value) {
  return SYSTEM_ROLES.includes(value) ? value : 'user';
}

function normalizeBusinessRole(value) {
  return BUSINESS_ROLES.includes(value) ? value : 'intern';
}

function normalizeLoginIdentifier(value) {
  const trimmed = String(value || '').trim();
  const numericMatch = trimmed.match(/^(?:IBD\s*-?\s*)?(\d{1,5})$/i);
  if (!numericMatch) return trimmed;
  return `IBD-${numericMatch[1].padStart(5, '0')}`;
}

function validateDisplayName(displayName) {
  const name = String(displayName || '').trim();
  if (!name) return '真实姓名不能为空';
  if (!/^[\u4e00-\u9fa5a-zA-Z\s]{2,30}$/.test(name)) {
    return '真实姓名只能包含中文、字母和空格，长度 2-30';
  }
  return '';
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function validateEmail(value) {
  const email = normalizeEmail(value);
  if (!email) return '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return '请输入有效的邮箱地址';
  }
  return '';
}

function normalizeBirthday(value) {
  return String(value || '').trim();
}

function validateBirthday(value, required = false) {
  const birthday = normalizeBirthday(value);
  if (!birthday) return required ? '请填写生日' : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthday)) return '生日格式无效';
  const date = new Date(`${birthday}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== birthday) return '生日日期无效';
  const today = new Date().toISOString().slice(0, 10);
  if (birthday < '1900-01-01' || birthday > today) return '生日日期超出有效范围';
  return '';
}

function ensureTrustManagerOption(db, displayName) {
  const name = String(displayName || '').trim();
  if (!name) return;
  const row = queryOne(db, "SELECT data FROM settings WHERE id = 'main'");
  if (!row?.data) return;

  try {
    const settings = JSON.parse(row.data);
    const managers = Array.isArray(settings.trustManagers) ? settings.trustManagers : [];
    const exists = managers.some(manager => {
      if (typeof manager === 'string') return manager.trim() === name;
      return manager && String(manager.name || '').trim() === name;
    });
    if (exists) return;

    const newManager = {
      id: 'tm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      name,
    };
    db.run(
      "INSERT OR REPLACE INTO settings (id, data, updated_at) VALUES ('main', ?, ?)",
      [JSON.stringify({ ...settings, trustManagers: [...managers, newManager] }), new Date().toISOString()]
    );
  } catch {
    // Do not block user changes when settings JSON is malformed.
  }
}

function publicUser(row) {
  return {
    id: row.id,
    display_name: row.display_name,
    email: row.email || '',
    birthday: row.birthday || '',
    role: normalizeRole(row.role),
    business_role: row.business_role || 'intern',
    status: row.status,
    created_at: row.created_at,
  };
}

function limitLoginAccount(req, res, next) {
  const demo = getPublicDemoCredentials();
  if (demo && req.body?.username === demo.identifier && req.body?.password === demo.password) return next();
  return loginAccountLimiter(req, res, next);
}

router.post('/login', loginIpLimiter, limitLoginAccount, async (req, res) => {
  const { username, password, deviceId, deviceType, deviceName, force } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'UID/姓名和密码不能为空' });
  }

  const db = await getDb();
  const normalizedUsername = normalizeLoginIdentifier(username);
  let user = queryOne(
    db,
    'SELECT id, password, display_name, email, birthday, role, business_role, status, created_at FROM users WHERE id = ?',
    [normalizedUsername]
  );
  if (!user) {
    user = queryOne(
      db,
      'SELECT id, password, display_name, email, birthday, role, business_role, status, created_at FROM users WHERE display_name = ?',
      [normalizedUsername]
    );
  }

  const publicDemo = user?.id === PUBLIC_DEMO_ID ? getPublicDemoCredentials() : null;
  const passwordValid = user?.id === PUBLIC_DEMO_ID
    ? typeof password === 'string' && password === publicDemo?.password
    : Boolean(user && bcrypt.compareSync(password, user.password));
  if (!passwordValid) {
    return res.status(401).json({ error: 'UID/姓名或密码错误' });
  }
  if (user.status === 'disabled') {
    return res.status(403).json({ error: '账号已被禁用，请联系高级用户' });
  }
  if (user.status === 'pending') {
    return res.status(403).json({ error: '账号正在等待高级用户审核，请稍后再试' });
  }

  user.role = normalizeRole(user.role);
  if (publicDemo) {
    const token = generateToken(user, { expiresIn: '2h' });
    return res.json({ token, user: publicUser(user) });
  }
  const normalizedDeviceType = normalizeDeviceType(deviceType);
  const normalizedDeviceId = String(deviceId || '').trim() || `unknown-${normalizedDeviceType}`;
  const normalizedDeviceName = String(deviceName || '').trim() || (normalizedDeviceType === 'mobile' ? '移动端设备' : '电脑端设备');
  const activeSession = findActiveSession(user.id, normalizedDeviceType);

  if (activeSession && activeSession.device_id !== normalizedDeviceId && !force) {
    const typeLabel = normalizedDeviceType === 'mobile' ? '移动端' : '电脑端';
    return res.status(409).json({
      code: 'DEVICE_LIMIT_REACHED',
      error: `该账号已在另一台${typeLabel}登录，继续登录会使之前的${typeLabel}下线。`,
      conflict: publicSession(activeSession),
    });
  }

  const isSameDeviceSession = activeSession && activeSession.device_id === normalizedDeviceId;
  const sessionId = isSameDeviceSession ? activeSession.id : makeId('sess');
  const tokenId = makeId('tok');
  const token = generateToken({ ...user, jti: tokenId }, {
    sessionId,
    deviceType: normalizedDeviceType,
  });
  const newSession = isSameDeviceSession
    ? { id: activeSession.id, createdAt: activeSession.created_at }
    : createSession({
      id: sessionId,
      userId: user.id,
      tokenId,
      deviceId: normalizedDeviceId,
      deviceType: normalizedDeviceType,
      deviceName: normalizedDeviceName,
      userAgent: req.headers['user-agent'] || '',
      ip: req.ip || req.socket?.remoteAddress || '',
    });

  if (isSameDeviceSession) {
    touchSession(activeSession.id);
  } else if (activeSession) {
    revokeSession(activeSession.id, 'same_device_type_login', sessionId);
    if (activeSession.device_id !== normalizedDeviceId) {
      notifySessionRevoked(activeSession.id, {
        reason: 'same_device_type_login',
        message: '你的账号已在另一台设备登录，本设备已下线。',
        deviceType: normalizedDeviceType,
        deviceName: normalizedDeviceName,
        loginAt: newSession.createdAt,
      });
    }
  }

  logAudit(user.id, user.display_name, 'auth.login', 'user', user.id, `登录: ${user.display_name}`);
  res.json({ token, user: publicUser(user) });
});

router.get('/me', authMiddleware, (req, res) => {
  const db = getDbSync();
  const user = queryOne(db, 'SELECT id, display_name, email, birthday, role, business_role, status FROM users WHERE id = ?', [req.user.id]);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  // Nginx auth_request uses these trusted response headers to bind downstream
  // applications to the identity verified from the bearer token. Never let a
  // browser-provided account header become the source of truth.
  res.setHeader('X-IBD-User-Id', String(user.id));
  res.setHeader('X-IBD-User-Name', encodeURIComponent(String(user.display_name || user.id)));
  res.json({ user: publicUser(user) });
});

router.post('/register-self', selfRegistrationLimiter, async (req, res) => {
  const { display_name, password, business_role } = req.body;
  const nameError = validateDisplayName(display_name);
  if (nameError) return res.status(400).json({ error: nameError });
  if (!password || password.length < 6) return res.status(400).json({ error: '密码至少 6 个字符' });

  const db = await getDb();
  const name = display_name.trim();
  if (queryOne(db, 'SELECT id FROM users WHERE display_name = ?', [name])) {
    return res.status(409).json({ error: '该姓名已被注册' });
  }

  const id = nextUserId();
  db.run(
    'INSERT INTO users (id, display_name, password, role, business_role, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, name, bcrypt.hashSync(password, 10), 'user', normalizeBusinessRole(business_role), 'pending', new Date().toISOString()]
  );
  saveDbImmediate();
  res.json({ success: true, message: '注册成功，等待高级用户审核' });
});

router.post('/register', authMiddleware, requireRole('admin'), async (req, res) => {
  const { display_name, email, password, role, business_role } = req.body;
  const nameError = validateDisplayName(display_name);
  if (nameError) return res.status(400).json({ error: nameError });
  const emailError = validateEmail(email);
  if (emailError) return res.status(400).json({ error: emailError });
  if (!password || password.length < 6) return res.status(400).json({ error: '密码至少 6 个字符' });

  const db = await getDb();
  const name = display_name.trim();
  if (queryOne(db, 'SELECT id FROM users WHERE display_name = ?', [name])) {
    return res.status(409).json({ error: '该姓名已被注册' });
  }
  const normalizedEmail = normalizeEmail(email);
  if (normalizedEmail && queryOne(db, 'SELECT id FROM users WHERE LOWER(email) = ?', [normalizedEmail])) {
    return res.status(409).json({ error: '该邮箱已被其他账号使用' });
  }

  const id = nextUserId();
  const newBusinessRole = normalizeBusinessRole(business_role);
  db.run(
    'INSERT INTO users (id, display_name, email, password, role, business_role, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, name, normalizedEmail, bcrypt.hashSync(password, 10), normalizeRole(role), newBusinessRole, 'active', new Date().toISOString()]
  );
  if (newBusinessRole === 'trust_manager') ensureTrustManagerOption(db, name);
  saveDbImmediate();
  logAudit(req.user.id, req.user.display_name, 'user.register', 'user', id, `注册用户: ${name}`);
  res.json({ success: true, message: '注册成功' });
});

router.post('/logout', authMiddleware, async (req, res) => {
  if (req.user.id === PUBLIC_DEMO_ID) return res.json({ success: true });
  if (req.user.sid) {
    revokeSession(req.user.sid, 'logout');
  } else {
    revokeActiveSessionForDevice(req.user.id, req.user.deviceType || 'desktop', 'logout');
  }
  if (!req.user.jti) return res.json({ success: true });

  const db = await getDb();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  db.run(
    'INSERT OR IGNORE INTO token_blacklist (jti, user_id, expires_at) VALUES (?, ?, ?)',
    [req.user.jti, req.user.id, expiresAt]
  );
  saveDbImmediate();
  res.json({ success: true, message: '已登出' });
});

router.put('/password', authMiddleware, async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) return res.status(400).json({ error: '旧密码和新密码不能为空' });
  if (newPassword.length < 6) return res.status(400).json({ error: '新密码至少 6 个字符' });

  const db = await getDb();
  const row = queryOne(db, 'SELECT password FROM users WHERE id = ?', [req.user.id]);
  if (!row) return res.status(404).json({ error: '用户不存在' });
  if (!bcrypt.compareSync(oldPassword, row.password)) return res.status(400).json({ error: '旧密码错误' });

  db.run('UPDATE users SET password = ? WHERE id = ?', [bcrypt.hashSync(newPassword, 10), req.user.id]);
  saveDbImmediate();
  if (req.user.id === 'IBD-00001') removeInitialAdminPasswordFile();
  res.json({ success: true, message: '密码已修改' });
});

router.put('/profile', authMiddleware, async (req, res) => {
  const { display_name, email, birthday } = req.body;
  const nameError = validateDisplayName(display_name);
  if (nameError) return res.status(400).json({ error: nameError });
  const emailError = validateEmail(email);
  if (emailError) return res.status(400).json({ error: emailError });
  const birthdayError = validateBirthday(birthday);
  if (birthdayError) return res.status(400).json({ error: birthdayError });

  const db = await getDb();
  const name = display_name.trim();
  const normalizedEmail = normalizeEmail(email);
  const normalizedBirthday = normalizeBirthday(birthday);
  const existing = queryOne(db, 'SELECT id FROM users WHERE display_name = ? AND id != ?', [name, req.user.id]);
  if (existing) return res.status(409).json({ error: '该姓名已被使用' });
  if (normalizedEmail) {
    const emailOwner = queryOne(db, 'SELECT id FROM users WHERE LOWER(email) = ? AND id != ?', [normalizedEmail, req.user.id]);
    if (emailOwner) return res.status(409).json({ error: '该邮箱已被其他账号使用' });
  }

  db.run('UPDATE users SET display_name = ?, email = ?, birthday = ? WHERE id = ?', [name, normalizedEmail, normalizedBirthday, req.user.id]);
  saveDbImmediate();
  res.json({ success: true, message: '资料已更新' });
});

router.put('/birthday', authMiddleware, async (req, res) => {
  const birthday = normalizeBirthday(req.body?.birthday);
  const birthdayError = validateBirthday(birthday, true);
  if (birthdayError) return res.status(400).json({ error: birthdayError });
  const db = await getDb();
  db.run('UPDATE users SET birthday = ? WHERE id = ?', [birthday, req.user.id]);
  saveDbImmediate();
  logAudit(req.user.id, req.user.display_name, 'user.birthday.update', 'user', req.user.id, '补充生日信息');
  res.json({ success: true, message: '生日已保存' });
});

router.put('/users/:id/reset-password', authMiddleware, requireRole('admin'), async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: '密码至少 6 个字符' });

  const db = await getDb();
  const targetUser = queryOne(db, 'SELECT id, display_name FROM users WHERE id = ?', [req.params.id]);
  if (!targetUser) return res.status(404).json({ error: '用户不存在' });

  db.run('UPDATE users SET password = ? WHERE id = ?', [bcrypt.hashSync(newPassword, 10), req.params.id]);
  saveDbImmediate();
  if (req.params.id === 'IBD-00001') removeInitialAdminPasswordFile();
  res.json({ success: true, message: `用户 ${targetUser.display_name} 的密码已重置` });
});

router.get('/directory', authMiddleware, async (req, res) => {
  const db = await getDb();
  const result = db.exec("SELECT id, display_name, email FROM users WHERE status = 'active' ORDER BY display_name, id");
  const users = result[0]?.values.map(row => ({
    id: row[0],
    display_name: row[1],
    hasEmail: Boolean(String(row[2] || '').trim()),
  })) || [];
  res.json({ users });
});

router.get('/directory/:id', authMiddleware, async (req, res) => {
  const db = await getDb();
  const user = queryOne(db, 'SELECT id, display_name, role, business_role, status FROM users WHERE id = ?', [req.params.id]);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  res.json({ user });
});

router.get('/users', authMiddleware, requireRole('admin'), async (req, res) => {
  const db = await getDb();
  const result = db.exec('SELECT id, display_name, email, birthday, role, business_role, status, created_at FROM users ORDER BY created_at');
  const users = result[0]?.values.map(row => publicUser({
    id: row[0],
    display_name: row[1],
    email: row[2],
    birthday: row[3],
    role: row[4],
    business_role: row[5],
    status: row[6],
    created_at: row[7],
  })) || [];
  res.json({ users });
});

router.put('/users/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  const { display_name, email, birthday, role, business_role, status } = req.body;
  const targetId = req.params.id;
  if (targetId === req.user.id && role && normalizeRole(role) !== req.user.role) {
    return res.status(400).json({ error: '不能自行修改自己的角色' });
  }
  if (targetId === req.user.id && status === 'disabled') {
    return res.status(400).json({ error: '不能禁用自己' });
  }

  const db = await getDb();
  const targetUser = queryOne(db, 'SELECT id, role, business_role, display_name, email FROM users WHERE id = ?', [targetId]);
  if (!targetUser) return res.status(404).json({ error: '用户不存在' });

  const updates = [];
  const params = [];
  if (display_name !== undefined) {
    const nameError = validateDisplayName(display_name);
    if (nameError) return res.status(400).json({ error: nameError });
    const name = display_name.trim();
    if (queryOne(db, 'SELECT id FROM users WHERE display_name = ? AND id != ?', [name, targetId])) {
      return res.status(409).json({ error: '该姓名已被使用' });
    }
    updates.push('display_name = ?');
    params.push(name);
  }
  if (email !== undefined) {
    const emailError = validateEmail(email);
    if (emailError) return res.status(400).json({ error: emailError });
    const normalizedEmail = normalizeEmail(email);
    if (normalizedEmail && queryOne(db, 'SELECT id FROM users WHERE LOWER(email) = ? AND id != ?', [normalizedEmail, targetId])) {
      return res.status(409).json({ error: '该邮箱已被其他账号使用' });
    }
    updates.push('email = ?');
    params.push(normalizedEmail);
  }
  if (birthday !== undefined) {
    const birthdayError = validateBirthday(birthday);
    if (birthdayError) return res.status(400).json({ error: birthdayError });
    updates.push('birthday = ?');
    params.push(normalizeBirthday(birthday));
  }
  if (role !== undefined) {
    if (!SYSTEM_ROLES.includes(role)) return res.status(400).json({ error: '角色必须为 user 或 admin' });
    updates.push('role = ?');
    params.push(role);
  }
  if (business_role !== undefined) {
    updates.push('business_role = ?');
    params.push(normalizeBusinessRole(business_role));
  }
  if (status !== undefined) {
    if (!['active', 'disabled'].includes(status)) return res.status(400).json({ error: '状态必须为 active 或 disabled' });
    updates.push('status = ?');
    params.push(status);
  }
  if (!updates.length) return res.status(400).json({ error: '没有需要更新的字段' });

  params.push(targetId);
  db.run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);
  const nextBusinessRole = business_role !== undefined ? normalizeBusinessRole(business_role) : (targetUser.business_role || 'intern');
  const nextDisplayName = display_name !== undefined ? display_name.trim() : targetUser.display_name;
  if (status === 'active' && nextBusinessRole === 'trust_manager') ensureTrustManagerOption(db, nextDisplayName);
  saveDbImmediate();
  const detail = [role ? `角色->${role}` : '', status ? `状态->${status}` : ''].filter(Boolean).join(', ');
  logAudit(req.user.id, req.user.display_name, 'user.update', 'user', targetId, detail || '更新信息');
  res.json({ success: true, message: '用户已更新' });
});

router.delete('/users/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  const targetId = req.params.id;
  if (targetId === req.user.id) return res.status(400).json({ error: '不能删除自己的账号' });

  const db = await getDb();
  const existing = queryOne(db, 'SELECT * FROM users WHERE id = ?', [targetId]);
  if (!existing) return res.status(404).json({ error: '用户不存在' });

  const snapshot = sqlSnapshot(db, [
    { table: 'users', sql: 'SELECT * FROM users WHERE id=?', params: [targetId] },
    { table: 'token_blacklist', sql: 'SELECT * FROM token_blacklist WHERE user_id=?', params: [targetId] },
  ]);
  db.run('DELETE FROM token_blacklist WHERE user_id = ?', [targetId]);
  db.run('DELETE FROM users WHERE id = ?', [targetId]);
  saveDbImmediate();
  logAudit(req.user.id, req.user.display_name, 'user.delete', 'user', targetId, `删除用户: ${existing.display_name}`, snapshot);
  res.json({ success: true, message: '用户已删除' });
});

module.exports = router;
