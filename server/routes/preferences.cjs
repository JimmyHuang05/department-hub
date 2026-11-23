const express = require('express');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { getDb, saveDbImmediate } = require('../db.cjs');
const { authMiddleware, requireRole, requireBusinessRole } = require('../middleware/auth.cjs');
const { DATA_ROOT, THEME_CARDS_PATH } = require('../paths.cjs');

const router = express.Router();
const USER_PREFERENCES_DIR = path.join(DATA_ROOT, 'user-preferences');
const WEEK_KEY_PATTERN = /^\d{6}$/;
const TODO_ITEM_ID_PATTERN = /^(worklog|project)-.{1,180}$/;

function queryOne(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  let row = null;
  if (stmt.step()) row = stmt.getAsObject();
  stmt.free();
  return row;
}

function isHexColor(value) {
  return typeof value === 'string' && (/^#[0-9a-fA-F]{6}$/.test(value.trim()) || /^#[0-9a-fA-F]{3}$/.test(value.trim()));
}

function normalizeSeed(seed) {
  if (!seed || typeof seed !== 'object') return null;
  const required = ['primary', 'accent', 'background', 'text'];
  if (!required.every(key => isHexColor(seed[key]))) return null;
  return {
    primary: seed.primary.trim().toUpperCase(),
    accent: seed.accent.trim().toUpperCase(),
    background: seed.background.trim().toUpperCase(),
    text: seed.text.trim().toUpperCase(),
  };
}

function normalizeTheme(theme) {
  if (!theme || typeof theme !== 'object') return null;
  const seed = normalizeSeed(theme.seed);
  if (!seed) return null;
  return {
    version: 1,
    presetId: typeof theme.presetId === 'string' ? theme.presetId : 'custom',
    seed,
  };
}

function ensureThemeCardsFile() {
  if (!fs.existsSync(DATA_ROOT)) fs.mkdirSync(DATA_ROOT, { recursive: true });
  if (!fs.existsSync(THEME_CARDS_PATH)) {
    fs.writeFileSync(THEME_CARDS_PATH, JSON.stringify({ version: 1, cards: [] }, null, 2), 'utf8');
  }
}

function readThemeCardsStore() {
  ensureThemeCardsFile();
  try {
    const parsed = JSON.parse(fs.readFileSync(THEME_CARDS_PATH, 'utf8'));
    return { version: 1, cards: Array.isArray(parsed.cards) ? parsed.cards : [] };
  } catch {
    return { version: 1, cards: [] };
  }
}

function writeThemeCardsStore(store) {
  ensureThemeCardsFile();
  const tmpPath = `${THEME_CARDS_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify({ version: 1, cards: store.cards || [] }, null, 2), 'utf8');
  fs.renameSync(tmpPath, THEME_CARDS_PATH);
}

function publicThemeCard(card) {
  return {
    id: card.id,
    name: card.name,
    note: card.note || '自定义色卡',
    seed: card.seed,
    shareCode: card.shareCode,
    ownerUserId: card.ownerUserId,
    ownerName: card.ownerName || '',
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
  };
}

function createShareCode() {
  return `IBD-${crypto.randomBytes(9).toString('base64url').toUpperCase()}`;
}

function createCardId() {
  return `theme-card-${crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex')}`;
}

function normalizeThemeCardInput(body) {
  const seed = normalizeSeed(body && body.seed);
  if (!seed) return null;
  const name = String(body.name || '').trim().slice(0, 40) || '未命名色卡';
  const note = String(body.note || '').trim().slice(0, 80) || '自定义色卡';
  return { name, note, seed };
}

const DEFAULT_UI_STATE = {
  worklogOnlyMine: true,
  worklogCardColumns: 3,
  worklogNormalCardFields: ['navScale', 'weeklyProgress', 'nextWeekPlan'],
  worklogProblemCardFields: ['navScale', 'weeklyProgress', 'nextWeekPlan'],
  worklogDirectSalesCardFields: ['nav', 'changePercent', 'weeklyReview', 'nextWeekPlan', 'subscriptionRedemption', 'nextSalesPlan'],
  projectOnlyMine: false,
  projectCardFields: ['client', 'target', 'feeRate', 'establishDate', 'strategy', 'annualIncome', 'performanceIncome', 'thisYearIncome'],
  projectViewMode: 'cards',
  projectAgGridColumnState: [],
  projectExcelColumnWidths: {},
  projectExcelColumnOrder: [],
  projectExcelPinnedColumns: ['productName'],
  projectExcelFontScale: 100,
  showShortcutHints: true,
  showOnlineUsers: true,
  sidebarExpanded: true,
  projectFortuneSheetFrozenColumn: null,
};

const WORKLOG_CARD_FIELD_KEYS = {
  worklogNormalCardFields: new Set(['subCategory', 'status', 'productName', 'clientType', 'navScale', 'establishDate', 'channelSales', 'weeklyProgress', 'nextWeekPlan', 'nav', 'yearStartNav', 'personA', 'personB', 'activePassive', 'collectiveSingle', 'advisorManager', 'productTerm', 'features', 'managementReport', 'riskReport', 'salesReport']),
  worklogProblemCardFields: new Set(['productName', 'status', 'description', 'clientType', 'navScale', 'weeklyProgress', 'deadline', 'nextWeekPlan', 'progressExpectation', 'personA', 'personB', 'activePassive', 'collectiveSingle', 'advisorManager', 'productTerm', 'features', 'managementReport', 'riskReport', 'salesReport']),
  worklogDirectSalesCardFields: new Set(['subCategory', 'productName', 'status', 'clientType', 'navScale', 'productTerm', 'nav', 'changePercent', 'holdingsOver10', 'equityAssetRatio', 'warningLineStatus', 'focusPoint', 'weeklyReview', 'nextWeekPlan', 'channelSales', 'channelContact', 'subscriptionRedemption', 'nextSalesPlan']),
};

function normalizeWorklogCardFields(value, key, limit, fallback) {
  if (!Array.isArray(value)) return fallback;
  const normalized = [...new Set(value.filter(field => typeof field === 'string' && WORKLOG_CARD_FIELD_KEYS[key].has(field)))].slice(0, limit);
  return normalized.length > 0 ? normalized : fallback;
}

function normalizeColumnState(value) {
  if (!Array.isArray(value)) return [];
  const allowedKeys = new Set(['colId', 'hide', 'sort', 'sortIndex', 'pinned', 'width', 'flex']);
  return value.slice(0, 100).map(entry => {
    if (!entry || typeof entry !== 'object' || typeof entry.colId !== 'string') return null;
    const normalized = { colId: entry.colId.slice(0, 120) };
    for (const [key, item] of Object.entries(entry)) {
      if (!allowedKeys.has(key) || key === 'colId') continue;
      if (key === 'hide' && typeof item === 'boolean') normalized.hide = item;
      else if (key === 'sort' && (item === 'asc' || item === 'desc' || item === null)) normalized.sort = item;
      else if (key === 'pinned' && (item === 'left' || item === 'right' || item === null)) normalized.pinned = item;
      else if (['sortIndex', 'width', 'flex'].includes(key) && Number.isFinite(item)) normalized[key] = Number(item);
    }
    return normalized;
  }).filter(Boolean);
}

function normalizeColumnWidths(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).slice(0, 100).flatMap(([key, width]) => (
    typeof key === 'string' && Number.isFinite(width)
      ? [[key.slice(0, 120), Math.min(1000, Math.max(40, Number(width)))]]
      : []
  )));
}

function normalizeUiState(value, fallback = DEFAULT_UI_STATE) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    worklogOnlyMine: typeof source.worklogOnlyMine === 'boolean'
      ? source.worklogOnlyMine
      : fallback.worklogOnlyMine,
    worklogCardColumns: [3, 4, 5, 6].includes(Number(source.worklogCardColumns))
      ? Number(source.worklogCardColumns)
      : fallback.worklogCardColumns,
    worklogNormalCardFields: normalizeWorklogCardFields(source.worklogNormalCardFields, 'worklogNormalCardFields', WORKLOG_CARD_FIELD_KEYS.worklogNormalCardFields.size, fallback.worklogNormalCardFields),
    worklogProblemCardFields: normalizeWorklogCardFields(source.worklogProblemCardFields, 'worklogProblemCardFields', 3, fallback.worklogProblemCardFields),
    worklogDirectSalesCardFields: normalizeWorklogCardFields(source.worklogDirectSalesCardFields, 'worklogDirectSalesCardFields', 6, fallback.worklogDirectSalesCardFields),
    projectOnlyMine: typeof source.projectOnlyMine === 'boolean'
      ? source.projectOnlyMine
      : fallback.projectOnlyMine,
    projectCardFields: Array.isArray(source.projectCardFields) && source.projectCardFields.length > 0
      ? source.projectCardFields.filter(field => typeof field === 'string').slice(0, 20)
      : fallback.projectCardFields,
    projectViewMode: ['cards', 'table', 'fs'].includes(source.projectViewMode)
      ? source.projectViewMode
      : ['fortune-sheet', 'excel', 'ag-grid'].includes(source.projectViewMode) ? 'table' : fallback.projectViewMode,
    projectAgGridColumnState: Array.isArray(source.projectAgGridColumnState)
      ? normalizeColumnState(source.projectAgGridColumnState)
      : fallback.projectAgGridColumnState,
    projectExcelColumnWidths: source.projectExcelColumnWidths && typeof source.projectExcelColumnWidths === 'object'
      ? normalizeColumnWidths(source.projectExcelColumnWidths)
      : fallback.projectExcelColumnWidths,
    projectExcelColumnOrder: Array.isArray(source.projectExcelColumnOrder)
      ? source.projectExcelColumnOrder.filter(item => typeof item === 'string').slice(0, 100)
      : fallback.projectExcelColumnOrder,
    projectExcelPinnedColumns: Array.isArray(source.projectExcelPinnedColumns)
      ? source.projectExcelPinnedColumns.filter(item => typeof item === 'string').slice(0, 100)
      : fallback.projectExcelPinnedColumns,
    projectExcelFontScale: Number.isFinite(source.projectExcelFontScale)
      ? Math.min(150, Math.max(50, Number(source.projectExcelFontScale)))
      : fallback.projectExcelFontScale,
    showShortcutHints: typeof source.showShortcutHints === 'boolean'
      ? source.showShortcutHints
      : fallback.showShortcutHints,
    showOnlineUsers: typeof source.showOnlineUsers === 'boolean'
      ? source.showOnlineUsers
      : fallback.showOnlineUsers,
    sidebarExpanded: typeof source.sidebarExpanded === 'boolean'
      ? source.sidebarExpanded
      : fallback.sidebarExpanded,
    projectFortuneSheetFrozenColumn: Number.isInteger(source.projectFortuneSheetFrozenColumn)
      && Number(source.projectFortuneSheetFrozenColumn) >= 0
      ? Math.min(999, Number(source.projectFortuneSheetFrozenColumn))
      : null,
  };
}

function preferenceFilePath(userId) {
  const key = crypto.createHash('sha256').update(String(userId)).digest('hex');
  return path.join(USER_PREFERENCES_DIR, `${key}.json`);
}

function readPreferenceFile(userId) {
  try {
    const parsed = JSON.parse(fs.readFileSync(preferenceFilePath(userId), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function writePreferenceFile(userId, patch) {
  fs.mkdirSync(USER_PREFERENCES_DIR, { recursive: true });
  const current = readPreferenceFile(userId) || {};
  const updatedAt = new Date().toISOString();
  const next = { ...current, ...patch, version: 1, userId: String(userId), updatedAt };
  const target = preferenceFilePath(userId);
  const temporary = `${target}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(temporary, target);
  return next;
}

function parseUiState(value) {
  if (!value) return { ...DEFAULT_UI_STATE };
  try {
    return normalizeUiState(JSON.parse(value));
  } catch {
    return { ...DEFAULT_UI_STATE };
  }
}

router.get('/todo-snoozes', authMiddleware, async (req, res) => {
  const weekKey = String(req.query.weekKey || '');
  if (!WEEK_KEY_PATTERN.test(weekKey)) return res.status(400).json({ error: '无效的周次' });
  const db = await getDb();
  const result = db.exec(
    'SELECT item_id FROM todo_snoozes WHERE user_id=? AND week_key=? ORDER BY created_at DESC',
    [req.user.id, weekKey]
  );
  const itemIds = (result[0]?.values || []).map(row => row[0]).filter(Boolean);
  res.json({ itemIds });
});

router.post('/manager-todo-progress', authMiddleware, requireBusinessRole('admin'), async (req, res) => {
  const weekKey = String(req.body?.weekKey || '');
  const managers = Array.isArray(req.body?.managers) ? req.body.managers : [];
  if (!WEEK_KEY_PATTERN.test(weekKey) || managers.length > 100) {
    return res.status(400).json({ error: '经理待办统计参数无效' });
  }
  const normalized = managers.map(input => {
    const manager = String(input?.manager || '').trim().slice(0, 100);
    const items = Array.isArray(input?.items) ? input.items.slice(0, 500).filter(item => TODO_ITEM_ID_PATTERN.test(String(item?.id || ''))).map(item => ({
      id: String(item.id),
      type: item.type === 'project' ? 'project' : 'worklog',
      title: String(item.title || '').slice(0, 300),
      description: String(item.description || '').slice(0, 1000),
      meta: String(item.meta || '').slice(0, 500),
      href: String(item.href || '').slice(0, 1000),
    })) : [];
    return { manager, items };
  }).filter(input => input.manager);
  if (normalized.reduce((sum, input) => sum + input.items.length, 0) > 5000) {
    return res.status(400).json({ error: '待办条目数量超出限制' });
  }

  const db = await getDb();
  const createdAt = new Date().toISOString();
  db.run('BEGIN');
  try {
    normalized.forEach(input => {
      const existing = queryOne(db, 'SELECT COUNT(*) AS count FROM manager_todo_snapshots WHERE week_key=? AND manager_name=?', [weekKey, input.manager]);
      if (Number(existing?.count || 0) === 0) {
        input.items.forEach(item => db.run(
          'INSERT OR IGNORE INTO manager_todo_snapshots(week_key,manager_name,item_id,payload,created_at) VALUES(?,?,?,?,?)',
          [weekKey, input.manager, item.id, JSON.stringify(item), createdAt]
        ));
      }
    });
    db.run('COMMIT');
    saveDbImmediate();
  } catch (error) {
    try { db.run('ROLLBACK'); } catch {}
    return res.status(500).json({ error: '生成本周待办快照失败' });
  }

  const usersResult = db.exec("SELECT id, display_name FROM users WHERE status='active'");
  const usersByName = new Map();
  (usersResult[0]?.values || []).forEach(row => {
    const name = String(row[1] || '').trim();
    if (!name) return;
    const existing = usersByName.get(name) || [];
    existing.push(String(row[0]));
    usersByName.set(name, existing);
  });

  const knownManagersResult = db.exec('SELECT DISTINCT manager_name FROM manager_todo_snapshots WHERE week_key=?', [weekKey]);
  const inputByManager = new Map(normalized.map(input => [input.manager, input]));
  (knownManagersResult[0]?.values || []).forEach(row => {
    const manager = String(row[0] || '');
    if (manager && !inputByManager.has(manager)) inputByManager.set(manager, { manager, items: [] });
  });

  const result = Array.from(inputByManager.values()).map(input => {
    const snapshotResult = db.exec(
      'SELECT item_id,payload FROM manager_todo_snapshots WHERE week_key=? AND manager_name=? ORDER BY created_at,item_id',
      [weekKey, input.manager]
    );
    const currentById = new Map(input.items.map(item => [item.id, item]));
    const userIds = usersByName.get(input.manager) || [];
    const snoozed = new Set();
    userIds.forEach(userId => {
      const snoozeResult = db.exec('SELECT item_id FROM todo_snoozes WHERE user_id=? AND week_key=?', [userId, weekKey]);
      (snoozeResult[0]?.values || []).forEach(row => snoozed.add(String(row[0])));
    });
    const completedItems = [];
    const pendingItems = [];
    (snapshotResult[0]?.values || []).forEach(row => {
      let stored;
      try { stored = JSON.parse(String(row[1] || '{}')); } catch { stored = {}; }
      const itemId = String(row[0]);
      const detail = currentById.get(itemId) || stored;
      if (snoozed.has(itemId) || !currentById.has(itemId)) completedItems.push(detail);
      else pendingItems.push(detail);
    });
    const total = completedItems.length + pendingItems.length;
    return {
      manager: input.manager,
      total,
      completed: completedItems.length,
      pending: pendingItems.length,
      percentage: total > 0 ? Math.round((completedItems.length / total) * 100) : 0,
      completedItems,
      pendingItems,
    };
  }).filter(item => item.total > 0).sort((left, right) => left.percentage - right.percentage || right.pending - left.pending || left.manager.localeCompare(right.manager, 'zh-CN'));

  res.json({ items: result });
});

router.post('/todo-snoozes', authMiddleware, requireRole('user', 'admin'), async (req, res) => {
  const weekKey = String(req.body.weekKey || '');
  const itemId = String(req.body.itemId || '');
  if (!WEEK_KEY_PATTERN.test(weekKey) || !TODO_ITEM_ID_PATTERN.test(itemId)) {
    return res.status(400).json({ error: '无效的免打扰记录' });
  }
  const db = await getDb();
  const createdAt = new Date().toISOString();
  db.run(
    'INSERT OR REPLACE INTO todo_snoozes(user_id,week_key,item_id,created_at) VALUES(?,?,?,?)',
    [req.user.id, weekKey, itemId, createdAt]
  );
  saveDbImmediate();
  res.json({ success: true, itemId, weekKey, createdAt });
});

function validateTodoSnoozeBatch(req, res) {
  const weekKey = String(req.body?.weekKey || '');
  const itemIds = [...new Set(Array.isArray(req.body?.itemIds) ? req.body.itemIds.map(item => String(item || '')) : [])];
  if (!WEEK_KEY_PATTERN.test(weekKey)) {
    res.status(400).json({ error: '无效的周次' });
    return null;
  }
  if (itemIds.length === 0 || itemIds.length > 200 || itemIds.some(itemId => !TODO_ITEM_ID_PATTERN.test(itemId))) {
    res.status(400).json({ error: '待办条目无效，单次最多处理 200 项' });
    return null;
  }
  return { weekKey, itemIds };
}

router.post('/todo-snoozes/batch', authMiddleware, requireRole('user', 'admin'), async (req, res) => {
  const input = validateTodoSnoozeBatch(req, res);
  if (!input) return;
  const db = await getDb();
  const createdAt = new Date().toISOString();
  db.run('BEGIN');
  try {
    input.itemIds.forEach(itemId => db.run(
      'INSERT OR REPLACE INTO todo_snoozes(user_id,week_key,item_id,created_at) VALUES(?,?,?,?)',
      [req.user.id, input.weekKey, itemId, createdAt]
    ));
    db.run('COMMIT');
    saveDbImmediate();
    res.json({ success: true, weekKey: input.weekKey, itemIds: input.itemIds, count: input.itemIds.length, createdAt });
  } catch (error) {
    try { db.run('ROLLBACK'); } catch {}
    res.status(500).json({ error: '批量处理本周待办失败' });
  }
});

router.post('/todo-snoozes/batch/restore', authMiddleware, requireRole('user', 'admin'), async (req, res) => {
  const input = validateTodoSnoozeBatch(req, res);
  if (!input) return;
  const db = await getDb();
  db.run('BEGIN');
  try {
    input.itemIds.forEach(itemId => db.run(
      'DELETE FROM todo_snoozes WHERE user_id=? AND week_key=? AND item_id=?',
      [req.user.id, input.weekKey, itemId]
    ));
    db.run('COMMIT');
    saveDbImmediate();
    res.json({ success: true, weekKey: input.weekKey, itemIds: input.itemIds, count: input.itemIds.length });
  } catch (error) {
    try { db.run('ROLLBACK'); } catch {}
    res.status(500).json({ error: '撤销批量处理失败' });
  }
});

router.get('/theme', authMiddleware, async (req, res) => {
  const profile = readPreferenceFile(req.user.id);
  if (profile && Object.prototype.hasOwnProperty.call(profile, 'theme')) {
    return res.json({ theme: normalizeTheme(profile.theme), updatedAt: profile.updatedAt || null });
  }
  const db = await getDb();
  const row = queryOne(db, 'SELECT theme, updated_at FROM user_preferences WHERE user_id = ?', [req.user.id]);
  if (!row || !row.theme) {
    const migrated = writePreferenceFile(req.user.id, { theme: null });
    return res.json({ theme: null, updatedAt: migrated.updatedAt });
  }
  try {
    const theme = normalizeTheme(JSON.parse(row.theme));
    const migrated = writePreferenceFile(req.user.id, { theme });
    res.json({ theme, updatedAt: migrated.updatedAt });
  } catch {
    res.json({ theme: null });
  }
});

router.get('/ui-state', authMiddleware, async (req, res) => {
  const profile = readPreferenceFile(req.user.id);
  if (profile?.uiState) {
    return res.json({ uiState: normalizeUiState(profile.uiState), updatedAt: profile.updatedAt || null });
  }
  const db = await getDb();
  const row = queryOne(db, 'SELECT ui_state, updated_at FROM user_preferences WHERE user_id = ?', [req.user.id]);
  const uiState = parseUiState(row?.ui_state);
  const migrated = writePreferenceFile(req.user.id, { uiState });
  res.json({ uiState, updatedAt: migrated.updatedAt });
});

router.put('/ui-state', authMiddleware, requireRole('user', 'admin'), async (req, res) => {
  if (!req.body.uiState || typeof req.body.uiState !== 'object') {
    return res.status(400).json({ error: '无效的界面偏好' });
  }

  const db = await getDb();
  const row = queryOne(db, 'SELECT ui_state FROM user_preferences WHERE user_id = ?', [req.user.id]);
  const current = parseUiState(row?.ui_state);
  const uiState = normalizeUiState(req.body.uiState, current);
  const now = new Date().toISOString();
  if (row) {
    db.run('UPDATE user_preferences SET ui_state = ?, updated_at = ? WHERE user_id = ?', [JSON.stringify(uiState), now, req.user.id]);
  } else {
    db.run('INSERT INTO user_preferences (user_id, theme, ui_state, updated_at) VALUES (?, NULL, ?, ?)', [req.user.id, JSON.stringify(uiState), now]);
  }
  saveDbImmediate();
  writePreferenceFile(req.user.id, { uiState });
  res.json({ success: true, uiState, updatedAt: now });
});

router.put('/theme', authMiddleware, requireRole('user', 'admin'), async (req, res) => {
  const theme = normalizeTheme(req.body.theme);
  if (!theme) return res.status(400).json({ error: '无效的主题配置' });

  const db = await getDb();
  const now = new Date().toISOString();
  const existing = queryOne(db, 'SELECT user_id FROM user_preferences WHERE user_id = ?', [req.user.id]);
  if (existing) {
    db.run('UPDATE user_preferences SET theme = ?, updated_at = ? WHERE user_id = ?', [JSON.stringify(theme), now, req.user.id]);
  } else {
    db.run('INSERT INTO user_preferences (user_id, theme, ui_state, updated_at) VALUES (?, ?, NULL, ?)', [req.user.id, JSON.stringify(theme), now]);
  }
  saveDbImmediate();
  writePreferenceFile(req.user.id, { theme });
  res.json({ success: true, theme, updatedAt: now });
});

router.delete('/theme', authMiddleware, requireRole('user', 'admin'), async (req, res) => {
  const db = await getDb();
  db.run('UPDATE user_preferences SET theme = NULL, updated_at = ? WHERE user_id = ?', [new Date().toISOString(), req.user.id]);
  saveDbImmediate();
  writePreferenceFile(req.user.id, { theme: null });
  res.json({ success: true });
});

router.get('/theme-cards', authMiddleware, requireRole('user', 'admin'), (req, res) => {
  try {
    const store = readThemeCardsStore();
    const cards = store.cards
      .filter(card => !card.deletedAt && card.ownerUserId === req.user.id)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      .map(publicThemeCard);
    res.json({ cards });
  } catch (error) {
    res.status(500).json({ error: `璇诲彇鑹插崱澶辫触锛?{error.message}` });
  }
});

router.post('/theme-cards', authMiddleware, requireRole('user', 'admin'), (req, res) => {
  try {
    const input = normalizeThemeCardInput(req.body);
    if (!input) return res.status(400).json({ error: '无效的色卡配置' });

    const store = readThemeCardsStore();
    const now = new Date().toISOString();
    const card = {
      id: createCardId(),
      ownerUserId: req.user.id,
      ownerName: req.user.display_name || req.user.name || req.user.username || '',
      shareCode: createShareCode(),
      createdAt: now,
      updatedAt: now,
      ...input,
    };
    store.cards.push(card);
    writeThemeCardsStore(store);
    res.json({ card: publicThemeCard(card) });
  } catch (error) {
    res.status(500).json({ error: '新建色卡失败: ' + error.message });
  }
});

router.put('/theme-cards/:id', authMiddleware, requireRole('user', 'admin'), (req, res) => {
  try {
    const input = normalizeThemeCardInput(req.body);
    if (!input) return res.status(400).json({ error: '无效的色卡配置' });

    const store = readThemeCardsStore();
    const index = store.cards.findIndex(card => card.id === req.params.id && !card.deletedAt);
    if (index === -1) return res.status(404).json({ error: '色卡不存在' });
    const card = store.cards[index];
    if (card.ownerUserId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: '没有权限编辑该色卡' });
    }
    store.cards[index] = { ...card, ...input, updatedAt: new Date().toISOString() };
    writeThemeCardsStore(store);
    res.json({ card: publicThemeCard(store.cards[index]) });
  } catch (error) {
    res.status(500).json({ error: '保存色卡失败: ' + error.message });
  }
});

router.delete('/theme-cards/:id', authMiddleware, requireRole('user', 'admin'), (req, res) => {
  try {
    const store = readThemeCardsStore();
    const index = store.cards.findIndex(card => card.id === req.params.id && !card.deletedAt);
    if (index === -1) return res.status(404).json({ error: '色卡不存在' });
    const card = store.cards[index];
    if (card.ownerUserId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: '没有权限删除该色卡' });
    }
    store.cards.splice(index, 1);
    writeThemeCardsStore(store);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: '删除色卡失败: ' + error.message });
  }
});

router.get('/theme-cards/share/:code', authMiddleware, requireRole('user', 'admin'), (req, res) => {
  const code = String(req.params.code || '').trim();
  const store = readThemeCardsStore();
  const card = store.cards.find(item => !item.deletedAt && item.shareCode === code);
  if (!card) return res.status(404).json({ error: '娌℃湁鎵惧埌瀵瑰簲鑹插崱' });
  res.json({ card: publicThemeCard(card) });
});

router.post('/theme-cards/import', authMiddleware, requireRole('user', 'admin'), (req, res) => {
  try {
    const shareCode = String(req.body.shareCode || '').trim();
    const store = readThemeCardsStore();
    const source = store.cards.find(item => !item.deletedAt && item.shareCode === shareCode);
    if (!source) return res.status(404).json({ error: '娌℃湁鎵惧埌瀵瑰簲鑹插崱' });

    const now = new Date().toISOString();
    const card = {
      id: createCardId(),
      ownerUserId: req.user.id,
      ownerName: req.user.display_name || req.user.name || req.user.username || '',
      name: source.name,
      note: `瀵煎叆鑷?${source.ownerName || '鍒嗕韩鑹插崱'}`,
      seed: source.seed,
      shareCode: createShareCode(),
      createdAt: now,
      updatedAt: now,
    };
    store.cards.push(card);
    writeThemeCardsStore(store);
    res.json({ card: publicThemeCard(card) });
  } catch (error) {
    res.status(500).json({ error: `瀵煎叆鑹插崱澶辫触锛?{error.message}` });
  }
});

module.exports = router;
