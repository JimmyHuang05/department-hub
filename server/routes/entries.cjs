const express = require('express');
const { getDb, saveDb, saveDbImmediate } = require('../db.cjs');
const { authMiddleware, requireRole, queryOne } = require('../middleware/auth.cjs');
const { logAudit, sqlSnapshot } = require('../services/audit.cjs');
const { buildImportedEntrySnapshots } = require('../services/entryImportSnapshots.cjs');
const { syncEntryToProduct } = require('../services/projectWorklogLinkage.cjs');
const router = express.Router();
const now = () => new Date().toISOString();
const parseRows = (r) => (r[0]?.values || []).map(row => { const e = JSON.parse(row[0]); e.created_by = row[1]; return e; });
const snapshotRows = (r) => (r[0]?.values || []).map(row => JSON.parse(row[0]));
const normalizeEntryName = value => String(value || '').trim().replace(/\s+/g, '').toLocaleLowerCase('zh-CN');

function saveEntrySnapshot(db, entry, userId, snapshotAt = now()) {
  const weekKey = entry.weekKey;
  if (!weekKey) return;
  const id = `${weekKey}:${entry.id}`;
  db.run(
    'INSERT OR REPLACE INTO entry_snapshots(id,week_key,entry_id,data,created_by,snapshot_at) VALUES(?,?,?,?,?,?)',
    [id, weekKey, entry.id, JSON.stringify(entry), userId, snapshotAt]
  );
}

function saveImportedEntrySnapshots(db, entry, userId, snapshotAt = now()) {
  const snapshots = buildImportedEntrySnapshots(entry);
  if (snapshots.length === 0) {
    saveEntrySnapshot(db, entry, userId, snapshotAt);
    return;
  }
  for (const snapshot of snapshots) {
    saveEntrySnapshot(db, snapshot, userId, snapshotAt);
  }
}

router.get('/', authMiddleware, async (req, res) => {
  const db = await getDb();
  const wk = req.query.weekKey;
  const sql = wk
    ? 'SELECT data,created_by FROM entries WHERE week_key=? ORDER BY updated_at DESC'
    : 'SELECT data,created_by FROM entries ORDER BY updated_at DESC';
  const params = wk ? [wk] : [];
  res.json({ entries: parseRows(db.exec(sql, params)) });
});

router.get('/snapshots/:weekKey', authMiddleware, async (req, res) => {
  const db = await getDb();
  const weekKey = req.params.weekKey;
  const result = db.exec('SELECT data FROM entry_snapshots WHERE week_key=? ORDER BY snapshot_at DESC', [weekKey]);
  res.json({ entries: snapshotRows(result) });
});

router.get('/snapshot-weeks/list', authMiddleware, async (req, res) => {
  const db = await getDb();
  const result = db.exec('SELECT DISTINCT week_key FROM entry_snapshots ORDER BY week_key DESC');
  const weekKeys = (result[0]?.values || []).map(row => row[0]).filter(Boolean);
  res.json({ weekKeys });
});

router.post('/', authMiddleware, requireRole('user', 'admin'), async (req, res) => {
  const { entry } = req.body;
  if (!entry?.id) return res.status(400).json({ error: '缺少记录数据' });
  const db = await getDb();
  if (entry.projectId && !queryOne(db, 'SELECT 1 AS found FROM products WHERE id=?', [entry.projectId])) {
    return res.status(400).json({ error: '关联项目不存在' });
  }
  if (queryOne(db, 'SELECT 1 AS f FROM entries WHERE id = ?', [entry.id])) return res.status(409).json({ error: 'ID 已存在' });
  const normalizedName = normalizeEntryName(entry.productName);
  if (normalizedName) {
    const duplicate = parseRows(db.exec('SELECT data,created_by FROM entries')).find(existing => (
      normalizeEntryName(existing.productName) === normalizedName
    ));
    if (duplicate) return res.status(409).json({ error: `管理周报中已存在项目“${String(entry.productName).trim()}”` });
  }
  db.run('INSERT INTO entries(id,data,created_by,updated_at,week_key) VALUES(?,?,?,?,?)',
    [entry.id, JSON.stringify(entry), req.user.id, entry.updatedAt || now(), entry.weekKey || null]);
  saveImportedEntrySnapshots(db, entry, req.user.id);
  syncEntryToProduct(db, entry, entry.updatedAt || now());
  saveDb();
  const entryName = entry.productName || entry.category || '';
  logAudit(req.user.id, req.user.display_name, 'entry.create', 'entry', entry.id, entryName);
  res.json({ success: true });
});

router.put('/:id', authMiddleware, requireRole('user', 'admin'), async (req, res) => {
  let { entry } = req.body;
  if (!entry) return res.status(400).json({ error: '缺少记录数据' });
  const db = await getDb();
  const currentRow = queryOne(db, 'SELECT data FROM entries WHERE id=?', [req.params.id]);
  if (!currentRow) return res.status(404).json({ error: '记录不存在' });
  const currentEntry = JSON.parse(currentRow.data || '{}');
  const changedFields = Array.isArray(req.body.changedFields) ? new Set(req.body.changedFields.map(String)) : null;
  if (changedFields) {
    entry = {
      ...entry,
      ...Object.fromEntries([
        ['subCategory', 'subCategory'],
        ['activePassive', 'activePassive'],
        ['collectiveSingle', 'collectiveSingle'],
      ].filter(([field]) => !changedFields.has(field)).map(([field, source]) => [field, currentEntry[source] || ''])),
    };
  }
  if (entry.projectId && !queryOne(db, 'SELECT 1 AS found FROM products WHERE id=?', [entry.projectId])) {
    return res.status(400).json({ error: '关联项目不存在' });
  }
  db.run('UPDATE entries SET data=?, updated_at=?, week_key=? WHERE id=?',
    [JSON.stringify(entry), entry.updatedAt || now(), entry.weekKey || null, req.params.id]);
  saveEntrySnapshot(db, entry, req.user.id);
  if (!changedFields || ['subCategory', 'activePassive', 'collectiveSingle'].some(field => changedFields.has(field))) {
    syncEntryToProduct(db, entry, entry.updatedAt || now());
  }
  saveDb();
  res.json({ success: true });
});

router.post('/:id/review', authMiddleware, requireRole('user', 'admin'), async (req, res) => {
  const action = req.body.action;
  const allowed = new Set(['submit', 'return', 'approve', 'reopen']);
  if (!allowed.has(action)) return res.status(400).json({ error: '审核操作无效' });
  if (['return', 'approve'].includes(action) && req.user.role !== 'admin') return res.status(403).json({ error: '只有高级用户可以审核周报' });
  const db = await getDb();
  const row = queryOne(db, 'SELECT data FROM entries WHERE id=?', [req.params.id]);
  if (!row) return res.status(404).json({ error: '周报不存在' });
  const entry = JSON.parse(row.data);
  const statusMap = { submit: 'submitted', return: 'returned', approve: 'approved', reopen: 'draft' };
  entry.reviewStatus = statusMap[action];
  entry.reviewComment = String(req.body.comment || '');
  entry.reviewedBy = req.user.display_name;
  entry.reviewedAt = now();
  entry.updatedAt = now();
  db.run('UPDATE entries SET data=?,updated_at=? WHERE id=?', [JSON.stringify(entry), entry.updatedAt, req.params.id]);
  saveEntrySnapshot(db, entry, req.user.id);
  saveDb();
  logAudit(req.user.id, req.user.display_name, `entry.review.${action}`, 'entry', entry.id, entry.productName || entry.id);
  res.json({ success: true, entry });
});

router.delete('/:id', authMiddleware, requireRole('user', 'admin'), async (req, res) => {
  const db = await getDb();
  const entryData = queryOne(db, 'SELECT * FROM entries WHERE id = ?', [req.params.id]);
  if (!entryData) return res.status(404).json({ error: '记录不存在' });
  const snapshot = sqlSnapshot(db, [{ table: 'entries', sql: 'SELECT * FROM entries WHERE id=?', params: [req.params.id] }]);
  if (req.user.role !== 'admin') {
    if (entryData.created_by !== req.user.id) return res.status(403).json({ error: '无权删除' });
    db.run('DELETE FROM entries WHERE id=? AND created_by=?', [req.params.id, req.user.id]);
  } else db.run('DELETE FROM entries WHERE id=?', [req.params.id]);
  saveDb();
  let entryName = '';
  if (entryData) { try { const d = JSON.parse(entryData.data); entryName = d.productName || d.category || ''; } catch {} }
  logAudit(req.user.id, req.user.display_name, 'entry.delete', 'entry', req.params.id, entryName || req.params.id, snapshot);
  res.json({ success: true });
});

router.post('/batch-delete', authMiddleware, requireRole('admin'), async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: '缺少 ID 列表' });
  const db = await getDb();
  const snapshot = sqlSnapshot(db, [{ table: 'entries', sql: `SELECT * FROM entries WHERE id IN (${ids.map(() => '?').join(',')})`, params: ids }]);
  db.run(`DELETE FROM entries WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  saveDbImmediate();
  logAudit(req.user.id, req.user.display_name, 'entry.batch-delete', 'entry', ids.join(','), '批量删除 ' + ids.length + ' 条', snapshot);
  res.json({ success: true });
});

router.post('/replace', authMiddleware, requireRole('admin'), async (req, res) => {
  const { entries } = req.body;
  if (!Array.isArray(entries)) return res.status(400).json({ error: '缺少记录列表' });
  if (entries.some(entry => !entry?.id)) return res.status(400).json({ error: '导入数据包含无效周报记录' });
  if (new Set(entries.map(entry => entry.id)).size !== entries.length) {
    return res.status(400).json({ error: '导入数据包含重复 ID' });
  }
  const db = await getDb();
  const t = now();
  db.run('BEGIN');
  try {
    db.run('DELETE FROM entries');
    db.run('DELETE FROM entry_snapshots');
    for (const e of entries) {
      db.run('INSERT INTO entries(id,data,created_by,updated_at,week_key) VALUES(?,?,?,?,?)',
        [e.id, JSON.stringify(e), req.user.id, e.updatedAt || t, e.weekKey || null]);
      saveImportedEntrySnapshots(db, e, req.user.id, t);
    }
    db.run('COMMIT');
  } catch (error) {
    try { db.run('ROLLBACK'); } catch {}
    throw error;
  }
  saveDbImmediate();
  logAudit(req.user.id, req.user.display_name, 'entry.import', 'entry', entries.length + '条', '导入覆盖 ' + entries.length + ' 条记录');
  res.json({ success: true });
});

router.post('/merge', authMiddleware, requireRole('user', 'admin'), async (req, res) => {
  const { entries } = req.body;
  if (!Array.isArray(entries)) return res.status(400).json({ error: '缺少记录列表' });
  if (entries.some(entry => !entry?.id)) return res.status(400).json({ error: '合并数据包含无效周报记录' });
  if (new Set(entries.map(entry => entry.id)).size !== entries.length) {
    return res.status(400).json({ error: '合并数据包含重复 ID' });
  }
  const db = await getDb();
  const t = now();
  db.run('BEGIN');
  try {
    for (const entry of entries) {
      if (entry.projectId && !queryOne(db, 'SELECT 1 AS found FROM products WHERE id=?', [entry.projectId])) {
        throw new Error(`关联项目不存在: ${entry.projectId}`);
      }
      if (queryOne(db, 'SELECT 1 AS found FROM entries WHERE id=?', [entry.id])) {
        db.run(
          'UPDATE entries SET data=?,updated_at=?,week_key=? WHERE id=?',
          [JSON.stringify(entry), entry.updatedAt || t, entry.weekKey || null, entry.id]
        );
      } else {
        db.run(
          'INSERT INTO entries(id,data,created_by,updated_at,week_key) VALUES(?,?,?,?,?)',
          [entry.id, JSON.stringify(entry), req.user.id, entry.updatedAt || t, entry.weekKey || null]
        );
      }
      saveImportedEntrySnapshots(db, entry, req.user.id, t);
    }
    db.run('COMMIT');
  } catch (error) {
    try { db.run('ROLLBACK'); } catch {}
    throw error;
  }
  saveDbImmediate();
  logAudit(req.user.id, req.user.display_name, 'entry.import.merge', 'entry', entries.length + '条', '合并补全管理周报');
  res.json({ success: true });
});

router.post('/batch-create', authMiddleware, requireRole('user', 'admin'), async (req, res) => {
  const { entries: list } = req.body;
  if (!Array.isArray(list) || !list.length) return res.status(400).json({ error: '缺少记录列表' });
  const db = await getDb();
  const t = now();
  for (const e of list) {
    if (queryOne(db, 'SELECT 1 AS f FROM entries WHERE id=?', [e.id])) continue;
    db.run('INSERT INTO entries(id,data,created_by,updated_at,week_key) VALUES(?,?,?,?,?)',
      [e.id, JSON.stringify(e), req.user.id, e.updatedAt || t, e.weekKey || null]);
    saveImportedEntrySnapshots(db, e, req.user.id, t);
  }
  saveDbImmediate();
  res.json({ success: true, count: list.length });
});

module.exports = router;
