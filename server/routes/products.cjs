const express = require('express');
const { getDb, saveDb, saveDbImmediate } = require('../db.cjs');
const { tryOptimisticUpdate } = require('../middleware/lock.cjs');
const { authMiddleware, requireRole, queryOne } = require('../middleware/auth.cjs');
const { logAudit, sqlSnapshot } = require('../services/audit.cjs');
const { getEditingLockOwner, getEditingLocks } = require('../ws/hub.cjs');
const { categoryLinkage, normalizeProductClassification, syncProductToEntries } = require('../services/projectWorklogLinkage.cjs');
const router = express.Router();
const now = () => new Date().toISOString();
const rows = (r) => (r[0]?.values || []).map(x => JSON.parse(x[0]));
const transactionId = () => `ptx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
const DEFAULT_SHEET_TYPOGRAPHY = { fontFamily: 'default', fontSize: 13 };

const normalizeProductName = (value) => String(value || '').trim().replace(/\s+/g, '').toLocaleLowerCase('zh-CN');
const releasesProductName = (product) => {
  const status = String(product?.status || '').trim().replace(/\s+/g, '');
  return status.includes('中止') || status.includes('终止');
};

function getProductNameOccupiedStatuses(db) {
  const row = queryOne(db, "SELECT data FROM settings WHERE id = 'main'");
  if (!row?.data) return null;
  try {
    const settings = JSON.parse(row.data);
    if (!Array.isArray(settings.projectNumberOccupiedStatusIds)) return null;
    const selectedIds = new Set(settings.projectNumberOccupiedStatusIds);
    return new Set((settings.statusConfigs || [])
      .filter(status => selectedIds.has(status.id))
      .map(status => String(status.name || '').trim()));
  } catch {
    return null;
  }
}

function productOccupiesName(product, occupiedStatuses) {
  if (product?.projectBackup === true) return true;
  if (releasesProductName(product)) return false;
  return occupiedStatuses instanceof Set
    ? occupiedStatuses.has(String(product?.status || '').trim())
    : true;
}

function validateUniqueProductNames(products, existingProducts = [], occupiedStatuses = null) {
  const names = new Map();
  // Historical data may already contain duplicate names. Those existing
  // duplicates must not prevent an unrelated project from being created.
  for (const product of existingProducts) {
    if (!productOccupiesName(product, occupiedStatuses)) continue;
    const name = normalizeProductName(product?.productName);
    if (name && !names.has(name)) names.set(name, product);
  }
  for (const product of products) {
    // A stopped project remains in history but no longer reserves its name.
    if (!productOccupiesName(product, occupiedStatuses)) continue;
    const name = normalizeProductName(product?.productName);
    // Spreadsheet mode intentionally supports inserting a temporary blank row.
    // Once a name is supplied it must be unique, but blank drafts may coexist.
    if (!name) continue;
    const previous = names.get(name);
    if (previous && previous.id !== product.id) {
      return { error: `项目名称“${String(product.productName).trim()}”已存在` };
    }
    names.set(name, product);
  }
  return null;
}

function allProducts(db) {
  return rows(db.exec('SELECT data FROM products'));
}

function participantNames(value) {
  return String(value || '').split(/[\/，,、；;\s]+/).map(name => name.trim()).filter(Boolean);
}

function canDeleteProduct(user, productRow) {
  if (user.role === 'admin' || productRow.created_by === user.id) return true;
  let product;
  try { product = JSON.parse(productRow.data || '{}'); } catch { return false; }
  const displayName = String(user.display_name || '').trim();
  if (!displayName) return false;
  return [product.trustManager, product.trustManagerB]
    .some(value => participantNames(value).includes(displayName));
}

const NUMERIC_FIELDS = new Set(['usd', 'rmb', 'feeRate', 'annualIncome', 'thisYearIncome', 'performanceIncome']);
const DATE_FIELDS = new Set(['deadline', 'projectCreatedDate', 'establishDate', 'projectStoppedDate']);
const PROTECTED_FIELDS = new Set(['id', 'createdAt', 'updatedAt', '_version', 'dynamicFields']);

function isValidIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validateBatchChange(change, index) {
  if (!change || typeof change !== 'object') return `第 ${index + 1} 项修改无效`;
  const id = String(change.id || '').trim();
  const field = String(change.field || '').trim();
  if (!id || !field) return `第 ${index + 1} 项缺少项目或字段`;
  if (PROTECTED_FIELDS.has(field) || !/^[A-Za-z_][A-Za-z0-9_.-]{0,99}$/.test(field)) return `字段“${field}”不可批量修改`;
  if (field.startsWith('dynamicFields.') && field.length === 'dynamicFields.'.length) return '自定义字段无效';
  if (NUMERIC_FIELDS.has(field) && !Number.isFinite(Number(change.value))) return `字段“${field}”必须是数字`;
  if (DATE_FIELDS.has(field) && change.value !== '' && !isValidIsoDate(String(change.value))) return `字段“${field}”日期无效`;
  return null;
}

function applyProductField(product, field, value) {
  if (field.startsWith('dynamicFields.')) {
    const key = field.slice('dynamicFields.'.length);
    return { ...product, dynamicFields: { ...(product.dynamicFields || {}), [key]: value } };
  }
  const next = { ...product, [field]: NUMERIC_FIELDS.has(field) ? Number(value) : value };
  if (field === 'projectCategory') Object.assign(next, categoryLinkage(value) || {});
  return next;
}

function readProductField(product, field) {
  if (field.startsWith('dynamicFields.')) return product.dynamicFields?.[field.slice('dynamicFields.'.length)] ?? '';
  return product[field] ?? '';
}

function sameFieldValue(left, right) {
  return JSON.stringify(left ?? '') === JSON.stringify(right ?? '');
}

function readCellFormat(db, id, field) {
  const row = queryOne(db, 'SELECT format FROM product_cell_formats WHERE product_id=? AND field=?', [id, field]);
  if (!row) return {};
  try { return JSON.parse(row.format || '{}'); } catch { return {}; }
}

function writeCellFormat(db, id, field, format, userId, savedAt) {
  const normalized = format && typeof format === 'object' ? format : {};
  if (Object.keys(normalized).length === 0) {
    db.run('DELETE FROM product_cell_formats WHERE product_id=? AND field=?', [id, field]);
    return;
  }
  db.run(
    `INSERT INTO product_cell_formats(product_id,field,format,updated_by,updated_at) VALUES(?,?,?,?,?)
     ON CONFLICT(product_id,field) DO UPDATE SET format=excluded.format,updated_by=excluded.updated_by,updated_at=excluded.updated_at`,
    [id, field, JSON.stringify(normalized), userId, savedAt],
  );
}

function transactionLabel(value, count) {
  const label = String(value || '').trim().slice(0, 80);
  return label || `批量修改 ${count} 个单元格`;
}

router.get('/', authMiddleware, async (req, res) => {
  const db = await getDb();
  res.json({ products: rows(db.exec('SELECT data FROM products ORDER BY updated_at DESC')) });
});

router.post('/', authMiddleware, requireRole('user', 'admin'), async (req, res) => {
  const { product } = req.body;
  if (!product?.id) return res.status(400).json({ error: '缺少产品数据' });
  const db = await getDb();
  if (queryOne(db, 'SELECT 1 AS f FROM products WHERE id = ?', [product.id])) return res.status(409).json({ error: 'ID 已存在' });
  const nameError = validateUniqueProductNames([product], allProducts(db), getProductNameOccupiedStatuses(db));
  if (nameError) return res.status(409).json(nameError);
  const savedProduct = { ...product, _version: 1 };
  db.run('INSERT INTO products(id,data,created_by,updated_at) VALUES(?,?,?,?)',
    [product.id, JSON.stringify(savedProduct), req.user.id, product.updatedAt || now()]);
  saveDb();
  const productName = product.productName || '';
  logAudit(req.user.id, req.user.display_name, 'product.create', 'product', product.id, productName);
  res.json({ success: true });
});

router.put('/batch-fields', authMiddleware, requireRole('user', 'admin'), async (req, res) => {
  const changes = req.body?.changes;
  if (!Array.isArray(changes) || changes.length === 0) return res.status(400).json({ error: '缺少批量修改数据' });
  if (changes.length > 5000) return res.status(400).json({ error: '单次最多修改 5000 个单元格' });
  for (let index = 0; index < changes.length; index += 1) {
    const error = validateBatchChange(changes[index], index);
    if (error) return res.status(400).json({ error, index });
    const lock = getEditingLockOwner('project', changes[index].id, changes[index].lockField || changes[index].field);
    if (lock && lock.userId !== req.user.id) {
      return res.status(409).json({ error: `“${lock.displayName}”正在编辑该字段`, locked: true, index, owner: lock.displayName });
    }
  }

  const db = await getDb();
  const byProduct = new Map();
  for (const change of changes) {
    if (!byProduct.has(change.id)) byProduct.set(change.id, []);
    byProduct.get(change.id).push(change);
  }
  const existingProducts = allProducts(db);
  const existingById = new Map(existingProducts.map(product => [product.id, product]));
  const savedProducts = [];
  const recordedChanges = [];
  for (const [id, productChanges] of byProduct.entries()) {
    let product = existingById.get(id);
    if (!product) return res.status(404).json({ error: `项目 ${id} 不存在` });
    const expectedVersion = productChanges.find(change => change.version != null)?.version;
    if (expectedVersion != null && Number(expectedVersion) !== Number(product._version || 1)) {
      return res.status(409).json({ error: '数据已被其他用户修改，请刷新后重试', conflict: true, id });
    }
    for (const change of productChanges) {
      const before = readProductField(product, change.field);
      product = applyProductField(product, change.field, change.value);
      const after = readProductField(product, change.field);
      if (!sameFieldValue(before, after)) recordedChanges.push({ id, field: change.field, lockField: change.lockField || change.field, before, after });
    }
    product = { ...product, updatedAt: now(), _version: Number(product._version || 1) + 1 };
    savedProducts.push(product);
  }
  const changedIds = new Set(savedProducts.map(product => product.id));
  const nameError = validateUniqueProductNames(savedProducts, existingProducts.filter(product => !changedIds.has(product.id)), getProductNameOccupiedStatuses(db));
  if (nameError) return res.status(409).json(nameError);

  db.run('BEGIN');
  try {
    for (const product of savedProducts) {
      db.run('UPDATE products SET data=?,updated_at=? WHERE id=?', [JSON.stringify(product), product.updatedAt, product.id]);
      syncProductToEntries(db, product, product.updatedAt);
    }
    const savedTransactionId = transactionId();
    const savedAt = now();
    // A new edit creates a new history branch; transactions waiting for redo
    // must no longer be replayed on top of it.
    db.run("UPDATE product_transactions SET status='superseded',updated_at=? WHERE created_by=? AND status='undone'", [savedAt, req.user.id]);
    if (recordedChanges.length > 0) {
      db.run(
        'INSERT INTO product_transactions(id,label,changes,created_by,created_at,status,updated_at) VALUES(?,?,?,?,?,?,?)',
        [savedTransactionId, transactionLabel(req.body?.label, recordedChanges.length), JSON.stringify(recordedChanges), req.user.id, savedAt, 'applied', savedAt],
      );
    }
    db.run('COMMIT');
  } catch (error) {
    try { db.run('ROLLBACK'); } catch {}
    throw error;
  }
  saveDbImmediate();
  logAudit(req.user.id, req.user.display_name, 'product.batch-fields', 'product', [...changedIds].join(','), `批量修改 ${changes.length} 个字段`);
  const latest = queryOne(db, 'SELECT id,label,created_at,status FROM product_transactions WHERE created_by=? ORDER BY created_at DESC LIMIT 1', [req.user.id]);
  res.json({ success: true, products: savedProducts, transaction: latest ? { id: latest.id, label: latest.label, createdAt: latest.created_at, status: latest.status, changeCount: recordedChanges.length } : null });
});

router.get('/transactions', authMiddleware, requireRole('user', 'admin'), async (req, res) => {
  const db = await getDb();
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const result = db.exec(
    `SELECT t.id,t.label,t.changes,t.created_at,t.status,t.updated_at,COALESCE(u.display_name,t.created_by)
       FROM product_transactions t LEFT JOIN users u ON u.id=t.created_by
      WHERE t.created_by=? ORDER BY t.created_at DESC LIMIT ?`,
    [req.user.id, limit],
  );
  const transactions = (result[0]?.values || []).map(row => {
    let changes = [];
    try { changes = JSON.parse(row[2] || '[]'); } catch {}
    return { id: row[0], label: row[1], changes, changeCount: changes.length, createdAt: row[3], status: row[4], updatedAt: row[5], createdByName: row[6] };
  });
  res.json({ transactions });
});

router.get('/cell-formats', authMiddleware, requireRole('user', 'admin'), async (_req, res) => {
  const db = await getDb();
  const result = db.exec('SELECT product_id,field,format FROM product_cell_formats');
  const formats = {};
  for (const row of result[0]?.values || []) {
    try { formats[`${row[0]}:${row[1]}`] = JSON.parse(row[2] || '{}'); } catch {}
  }
  res.json({ formats });
});

router.get('/sheet-typography', authMiddleware, requireRole('user', 'admin'), async (_req, res) => {
  const db = await getDb();
  const row = queryOne(db, "SELECT data FROM settings WHERE id='project-sheet-typography'");
  let typography = DEFAULT_SHEET_TYPOGRAPHY;
  try { typography = { ...typography, ...JSON.parse(row?.data || '{}') }; } catch {}
  res.json({ typography });
});

router.put('/sheet-typography', authMiddleware, requireRole('user', 'admin'), async (req, res) => {
  const allowedFamilies = new Set(['default', 'microsoft-yahei', 'simsun', 'simhei', 'arial', 'times-new-roman']);
  const fontFamily = String(req.body?.fontFamily || 'default');
  const fontSize = Number(req.body?.fontSize);
  if (!allowedFamilies.has(fontFamily) || !Number.isInteger(fontSize) || fontSize < 8 || fontSize > 36) {
    return res.status(400).json({ error: '字体或字号无效' });
  }
  const typography = { fontFamily, fontSize };
  const db = await getDb();
  db.run("INSERT OR REPLACE INTO settings(id,data,updated_at) VALUES('project-sheet-typography',?,?)", [JSON.stringify(typography), now()]);
  saveDbImmediate();
  logAudit(req.user.id, req.user.display_name, 'product.sheet-typography', 'product-sheet', 'global', `设置全表字体与字号`);
  res.json({ success: true, typography });
});

router.put('/cell-formats', authMiddleware, requireRole('user', 'admin'), async (req, res) => {
  const changes = req.body?.changes;
  if (!Array.isArray(changes) || changes.length === 0) return res.status(400).json({ error: '缺少格式修改数据' });
  if (changes.length > 5000) return res.status(400).json({ error: '单次最多修改 5000 个单元格格式' });
  const db = await getDb();
  const productIds = new Set(allProducts(db).map(product => product.id));
  const recordedChanges = [];
  for (const change of changes) {
    const id = String(change?.id || '').trim();
    const field = String(change?.field || '').trim();
    if (!productIds.has(id) || !/^[A-Za-z_][A-Za-z0-9_.-]{0,99}$/.test(field)) return res.status(400).json({ error: '格式修改包含无效单元格' });
    const before = readCellFormat(db, id, field);
    const after = change.format && typeof change.format === 'object' ? change.format : {};
    if (!sameFieldValue(before, after)) recordedChanges.push({ kind: 'format', id, field, before, after });
  }
  if (recordedChanges.length === 0) return res.json({ success: true });
  const savedAt = now();
  const savedTransactionId = transactionId();
  db.run('BEGIN');
  try {
    db.run("UPDATE product_transactions SET status='superseded',updated_at=? WHERE created_by=? AND status='undone'", [savedAt, req.user.id]);
    for (const change of recordedChanges) writeCellFormat(db, change.id, change.field, change.after, req.user.id, savedAt);
    db.run(
      'INSERT INTO product_transactions(id,label,changes,created_by,created_at,status,updated_at) VALUES(?,?,?,?,?,?,?)',
      [savedTransactionId, transactionLabel(req.body?.label, recordedChanges.length), JSON.stringify(recordedChanges), req.user.id, savedAt, 'applied', savedAt],
    );
    db.run('COMMIT');
  } catch (error) {
    try { db.run('ROLLBACK'); } catch {}
    throw error;
  }
  saveDbImmediate();
  logAudit(req.user.id, req.user.display_name, 'product.cell-format', 'product', [...new Set(recordedChanges.map(item => item.id))].join(','), `修改 ${recordedChanges.length} 个单元格格式`);
  res.json({ success: true, transaction: { id: savedTransactionId, status: 'applied', changeCount: recordedChanges.length } });
});

async function replayTransaction(req, res, targetStatus) {
  const db = await getDb();
  const row = queryOne(db, 'SELECT * FROM product_transactions WHERE id=? AND created_by=?', [req.params.id, req.user.id]);
  if (!row) return res.status(404).json({ error: '事务不存在或无权操作' });
  const expectedStatus = targetStatus === 'undone' ? 'applied' : 'undone';
  if (row.status !== expectedStatus) return res.status(409).json({ error: targetStatus === 'undone' ? '该事务已经撤销' : '该事务当前不可重做' });
  let changes = [];
  try { changes = JSON.parse(row.changes || '[]'); } catch { return res.status(500).json({ error: '事务数据损坏' }); }
  const currentProducts = allProducts(db);
  const byId = new Map(currentProducts.map(product => [product.id, product]));
  const expectedKey = targetStatus === 'undone' ? 'after' : 'before';
  const valueKey = targetStatus === 'undone' ? 'before' : 'after';
  for (const change of changes) {
    if (change.kind === 'format') {
      if (!sameFieldValue(readCellFormat(db, change.id, change.field), change[expectedKey])) {
        return res.status(409).json({ error: '相关单元格格式已被后续修改，本次操作已取消', conflict: true });
      }
      continue;
    }
    const product = byId.get(change.id);
    if (!product) return res.status(409).json({ error: '事务中的项目已不存在，无法继续' });
    if (!sameFieldValue(readProductField(product, change.field), change[expectedKey])) {
      return res.status(409).json({ error: '相关单元格已被后续修改，为避免覆盖他人数据，本次操作已取消', conflict: true, id: change.id, field: change.field });
    }
    const lock = getEditingLockOwner('project', change.id, change.lockField || change.field);
    if (lock && lock.userId !== req.user.id) return res.status(409).json({ error: `“${lock.displayName}”正在编辑相关字段`, locked: true });
  }
  const changedProducts = new Map();
  for (const change of changes) {
    if (change.kind === 'format') continue;
    const base = changedProducts.get(change.id) || byId.get(change.id);
    changedProducts.set(change.id, applyProductField(base, change.field, change[valueKey]));
  }
  const savedAt = now();
  const savedProducts = [...changedProducts.values()].map(product => ({ ...product, updatedAt: savedAt, _version: Number(product._version || 1) + 1 }));
  const changedIds = new Set(savedProducts.map(product => product.id));
  const nameError = validateUniqueProductNames(savedProducts, currentProducts.filter(product => !changedIds.has(product.id)), getProductNameOccupiedStatuses(db));
  if (nameError) return res.status(409).json(nameError);
  db.run('BEGIN');
  try {
    for (const product of savedProducts) db.run('UPDATE products SET data=?,updated_at=? WHERE id=?', [JSON.stringify(product), product.updatedAt, product.id]);
    for (const change of changes.filter(item => item.kind === 'format')) writeCellFormat(db, change.id, change.field, change[valueKey], req.user.id, savedAt);
    db.run('UPDATE product_transactions SET status=?,updated_at=? WHERE id=?', [targetStatus, savedAt, row.id]);
    db.run('COMMIT');
  } catch (error) {
    try { db.run('ROLLBACK'); } catch {}
    throw error;
  }
  saveDbImmediate();
  logAudit(req.user.id, req.user.display_name, targetStatus === 'undone' ? 'product.transaction.undo' : 'product.transaction.redo', 'product_transaction', row.id, row.label);
  return res.json({ success: true, products: savedProducts, transaction: { id: row.id, status: targetStatus } });
}

router.post('/transactions/:id/undo', authMiddleware, requireRole('user', 'admin'), (req, res) => replayTransaction(req, res, 'undone'));
router.post('/transactions/:id/redo', authMiddleware, requireRole('user', 'admin'), (req, res) => replayTransaction(req, res, 'applied'));

router.put('/:id', authMiddleware, requireRole('user', 'admin'), async (req, res) => {
  const { product } = req.body;
  if (!product) return res.status(400).json({ error: '缺少产品数据' });
  const db = await getDb();
  const existingProducts = allProducts(db);
  const occupiedStatuses = getProductNameOccupiedStatuses(db);
  const currentProduct = existingProducts.find(item => item.id === req.params.id);
  if (currentProduct) {
    const locks = getEditingLocks('project', req.params.id);
    const changedFields = Object.keys(product).filter(field => !['_version', 'updatedAt'].includes(field)
      && JSON.stringify(product[field]) !== JSON.stringify(currentProduct[field]));
    const blockingLock = locks.find(lock => lock.userId !== req.user.id && changedFields.includes(lock.field));
    if (blockingLock) return res.status(409).json({ error: `“${blockingLock.displayName}”正在编辑该字段`, locked: true, owner: blockingLock.displayName });
  }
  const productNameReservationChanged = !currentProduct
    || normalizeProductName(currentProduct.productName) !== normalizeProductName(product.productName)
    || productOccupiesName(currentProduct, occupiedStatuses) !== productOccupiesName(product, occupiedStatuses);
  if (productNameReservationChanged) {
    const nameError = validateUniqueProductNames(
      [product],
      existingProducts.filter(item => item.id !== req.params.id),
      occupiedStatuses,
    );
    if (nameError) return res.status(409).json(nameError);
  }
  const changedFields = Array.isArray(req.body.changedFields) ? new Set(req.body.changedFields.map(String)) : null;
  const safeProduct = changedFields && currentProduct
    ? {
        ...product,
        ...Object.fromEntries(['projectCategory', 'activePassive', 'collectiveSingle']
          .filter(field => !changedFields.has(field))
          .map(field => [field, currentProduct[field] || ''])),
      }
    : product;
  const normalizedProduct = normalizeProductClassification(safeProduct, currentProduct);
  const { _version, ...clean } = normalizedProduct;
  const r = tryOptimisticUpdate(db, 'products', req.params.id, clean, _version);
  if (!r.success) return r.conflict ? res.status(409).json({ error: r.message, conflict: true, serverData: r.serverData })
    : res.status(404).json({ error: r.message });
  syncProductToEntries(db, { ...clean, id: req.params.id }, clean.updatedAt || now());
  saveDb();
  res.json({ success: true, version: r.newVersion });
});

router.delete('/:id', authMiddleware, requireRole('user', 'admin'), async (req, res) => {
  const db = await getDb();
  const productData = queryOne(db, 'SELECT * FROM products WHERE id = ?', [req.params.id]);
  if (!productData) return res.status(404).json({ error: '项目不存在' });
  if (!canDeleteProduct(req.user, productData)) {
    return res.status(403).json({ error: '仅项目创建人、信托经理 A/B 或高级用户可以删除该项目' });
  }
  const snapshot = sqlSnapshot(db, [{ table: 'products', sql: 'SELECT * FROM products WHERE id=?', params: [req.params.id] }]);
  db.run('DELETE FROM products WHERE id=?', [req.params.id]);
  saveDb();
  let productName = '';
  if (productData) { try { const d = JSON.parse(productData.data); productName = d.productName || ''; } catch {} }
  logAudit(req.user.id, req.user.display_name, 'product.delete', 'product', req.params.id, productName || req.params.id, snapshot);
  res.json({ success: true });
});

router.post('/batch-delete', authMiddleware, requireRole('user', 'admin'), async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: '缺少 ID 列表' });
  const normalizedIds = [...new Set(ids.map(id => String(id || '').trim()).filter(Boolean))];
  if (!normalizedIds.length) return res.status(400).json({ error: '缺少有效的项目 ID' });
  if (normalizedIds.length > 500) return res.status(400).json({ error: '单次最多删除 500 个项目' });
  const db = await getDb();
  const deletableIds = [];
  const deniedIds = [];
  const missingIds = [];
  for (const id of normalizedIds) {
    const productRow = queryOne(db, 'SELECT data,created_by FROM products WHERE id=?', [id]);
    if (!productRow) missingIds.push(id);
    else if (canDeleteProduct(req.user, productRow)) deletableIds.push(id);
    else deniedIds.push(id);
  }
  const snapshot = deletableIds.length ? sqlSnapshot(db, [{ table: 'products', sql: `SELECT * FROM products WHERE id IN (${deletableIds.map(() => '?').join(',')})`, params: deletableIds }]) : null;
  if (deletableIds.length) {
    db.run(`DELETE FROM products WHERE id IN (${deletableIds.map(() => '?').join(',')})`, deletableIds);
  }
  saveDbImmediate();
  logAudit(req.user.id, req.user.display_name, 'product.batch-delete', 'product', deletableIds.join(','), '批量删除 ' + deletableIds.length + ' 个产品', snapshot);
  res.json({ success: true, deletedIds: deletableIds, deniedIds, missingIds });
});

router.post('/replace', authMiddleware, requireRole('admin'), async (req, res) => {
  const { products } = req.body;
  if (!Array.isArray(products)) return res.status(400).json({ error: '缺少产品列表' });
  if (products.some(product => !product?.id)) return res.status(400).json({ error: '导入数据包含无效项目' });
  if (new Set(products.map(product => product.id)).size !== products.length) {
    return res.status(400).json({ error: '导入数据包含重复 ID' });
  }
  const db = await getDb();
  const nameError = validateUniqueProductNames(products, [], getProductNameOccupiedStatuses(db));
  if (nameError) return res.status(409).json(nameError);
  const t = now();
  db.run('BEGIN');
  try {
    db.run('DELETE FROM products');
    for (const p of products) db.run('INSERT INTO products(id,data,created_by,updated_at) VALUES(?,?,?,?)',
      [p.id, JSON.stringify({ ...p, _version: 1 }), req.user.id, p.updatedAt || t]);
    db.run('COMMIT');
  } catch (error) {
    try { db.run('ROLLBACK'); } catch {}
    throw error;
  }
  saveDbImmediate();
  logAudit(req.user.id, req.user.display_name, 'product.import', 'product', products.length + '条', '导入覆盖 ' + products.length + ' 个产品');
  res.json({ success: true, version: 1, product: savedProduct });
});

router.post('/merge', authMiddleware, requireRole('user', 'admin'), async (req, res) => {
  const { products } = req.body;
  if (!Array.isArray(products)) return res.status(400).json({ error: '缺少产品列表' });
  if (products.some(product => !product?.id)) return res.status(400).json({ error: '合并数据包含无效项目' });
  if (new Set(products.map(product => product.id)).size !== products.length) {
    return res.status(400).json({ error: '合并数据包含重复 ID' });
  }
  const db = await getDb();
  const incomingIds = new Set(products.map(product => product.id));
  const nameError = validateUniqueProductNames(
    products,
    allProducts(db).filter(product => !incomingIds.has(product.id)),
    getProductNameOccupiedStatuses(db),
  );
  if (nameError) return res.status(409).json(nameError);
  const t = now();
  const savedProducts = [];
  db.run('BEGIN');
  try {
    for (const product of products) {
      const existing = queryOne(db, 'SELECT data FROM products WHERE id=?', [product.id]);
      if (existing) {
        const oldVersion = Number(JSON.parse(existing.data)._version) || 1;
        const savedProduct = { ...product, _version: oldVersion + 1 };
        db.run(
          'UPDATE products SET data=?,updated_at=? WHERE id=?',
          [JSON.stringify(savedProduct), product.updatedAt || t, product.id]
        );
        savedProducts.push(savedProduct);
      } else {
        const savedProduct = { ...product, _version: 1 };
        db.run(
          'INSERT INTO products(id,data,created_by,updated_at) VALUES(?,?,?,?)',
          [product.id, JSON.stringify(savedProduct), req.user.id, product.updatedAt || t]
        );
        savedProducts.push(savedProduct);
      }
    }
    db.run('COMMIT');
  } catch (error) {
    try { db.run('ROLLBACK'); } catch {}
    throw error;
  }
  saveDbImmediate();
  logAudit(req.user.id, req.user.display_name, 'product.import.merge', 'product', products.length + '条', '合并补全项目');
  res.json({ success: true, products: savedProducts });
});

module.exports = router;
