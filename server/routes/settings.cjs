const express = require('express');
const { getDb, saveDb, saveDbImmediate } = require('../db.cjs');
const { authMiddleware, requireRole } = require('../middleware/auth.cjs');

const router = express.Router();

const EXCHANGE_RATE_KEYS = [
  'exchangeRate',
  'manualExchangeRate',
  'autoExchangeRate',
  'exchangeRateMode',
  'exchangeRateUpdatedAt',
  'exchangeRateSource',
  'exchangeRateSourceDate',
];

function readSettingsRow(db, id) {
  const result = db.exec('SELECT data FROM settings WHERE id = ?', [id]);
  if (!result.length || !result[0].values.length) return null;
  try {
    return JSON.parse(result[0].values[0][0]);
  } catch {
    return null;
  }
}

function pickExchangeRateSettings(settings = {}) {
  return Object.fromEntries(EXCHANGE_RATE_KEYS
    .filter(key => settings[key] !== undefined)
    .map(key => [key, settings[key]]));
}

function withoutExchangeRateSettings(settings = {}) {
  const shared = { ...settings };
  EXCHANGE_RATE_KEYS.forEach(key => delete shared[key]);
  return shared;
}

function personalExchangeRateId(userId) {
  return `user_exchange_rate:${userId}`;
}

// POST /api/settings/exchange-rate/live
router.post('/exchange-rate/live', authMiddleware, requireRole('user', 'admin'), async (req, res) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch('https://api.frankfurter.dev/v2/rate/USD/CNY', {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`汇率服务返回 ${response.status}`);

    const payload = await response.json();
    const rate = Number(payload.rate);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error('汇率服务返回了无效数据');

    const db = await getDb();
    const globalSettings = readSettingsRow(db, 'main') || {};
    const personalId = personalExchangeRateId(req.user.id);
    const current = readSettingsRow(db, personalId) || pickExchangeRateSettings(globalSettings);
    const updatedAt = new Date().toISOString();
    const next = {
      ...pickExchangeRateSettings(current),
      exchangeRate: rate,
      autoExchangeRate: rate,
      exchangeRateMode: 'auto',
      exchangeRateUpdatedAt: updatedAt,
      exchangeRateSource: 'Frankfurter',
      exchangeRateSourceDate: payload.date || undefined,
    };
    db.run(
      'INSERT OR REPLACE INTO settings (id, data, updated_at) VALUES (?, ?, ?)',
      [personalId, JSON.stringify(next), updatedAt]
    );
    saveDbImmediate();

    res.json({
      rate,
      updatedAt,
      source: 'Frankfurter',
      sourceDate: payload.date || undefined,
    });
  } catch (error) {
    const message = error && error.name === 'AbortError'
      ? '实时汇率服务响应超时'
      : (error.message || '实时汇率获取失败');
    res.status(502).json({ error: message });
  } finally {
    clearTimeout(timeout);
  }
});

// GET /api/settings
router.get('/', authMiddleware, async (req, res) => {
  const db = await getDb();
  const sharedSettings = readSettingsRow(db, 'main');
  const personalExchangeRate = readSettingsRow(db, personalExchangeRateId(req.user.id));
  if (!sharedSettings && !personalExchangeRate) {
    return res.json({ settings: null });
  }
  res.json({
    settings: {
      ...(sharedSettings || {}),
      ...(personalExchangeRate || pickExchangeRateSettings(sharedSettings || {})),
    },
  });
});

// GET /api/settings/me/project-columns
router.get('/me/project-columns', authMiddleware, async (req, res) => {
  const db = await getDb();
  const id = `user_project_columns:${req.user.id}`;
  const result = db.exec('SELECT data FROM settings WHERE id = ?', [id]);
  if (result.length === 0 || result[0].values.length === 0) {
    return res.json({ columns: [] });
  }
  try {
    const data = JSON.parse(result[0].values[0][0]);
    res.json({ columns: Array.isArray(data.columns) ? data.columns.slice(0, 5) : [] });
  } catch {
    res.json({ columns: [] });
  }
});

// PUT /api/settings/me/project-columns
router.put('/me/project-columns', authMiddleware, requireRole('user', 'admin'), async (req, res) => {
  const columns = Array.isArray(req.body.columns) ? req.body.columns : [];
  const normalized = columns
    .filter(key => typeof key === 'string' && key.trim())
    .map(key => key.trim())
    .slice(0, 5);

  const db = await getDb();
  const now = new Date().toISOString();
  db.run(
    'INSERT OR REPLACE INTO settings (id, data, updated_at) VALUES (?, ?, ?)',
    [`user_project_columns:${req.user.id}`, JSON.stringify({ columns: normalized }), now]
  );
  saveDbImmediate();

  res.json({ success: true, columns: normalized });
});

// PUT /api/settings
router.put('/', authMiddleware, requireRole('user', 'admin'), async (req, res) => {
  const { settings } = req.body;
  if (!settings) return res.status(400).json({ error: '缺少设置数据' });

  const db = await getDb();
  const now = new Date().toISOString();
  const currentShared = readSettingsRow(db, 'main') || {};
  const sharedSettings = {
    ...currentShared,
    ...withoutExchangeRateSettings(settings),
  };
  const personalExchangeRate = pickExchangeRateSettings(settings);
  db.run(
    "INSERT OR REPLACE INTO settings (id, data, updated_at) VALUES ('main', ?, ?)",
    [JSON.stringify(sharedSettings), now]
  );
  db.run(
    'INSERT OR REPLACE INTO settings (id, data, updated_at) VALUES (?, ?, ?)',
    [personalExchangeRateId(req.user.id), JSON.stringify(personalExchangeRate), now]
  );
  saveDbImmediate();

  res.json({ success: true, settings: { ...sharedSettings, ...personalExchangeRate } });
});

module.exports = router;
