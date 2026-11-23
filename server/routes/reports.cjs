/**
 * 閿欒涓婃姤璺敱
 *
 * 瑙掕壊鏉冮檺锛? *   POST /api/reports      鈥?viewer+
 *   GET /api/reports       鈥?user+
 *   PUT /api/reports/:id   鈥?user+
 */
const express = require('express');
const { getDbSync, saveDbImmediate } = require('../db.cjs');
const { authMiddleware, requireRole } = require('../middleware/auth.cjs');

const router = express.Router();

// ==============================
// 1. 鍒涘缓閿欒鎶ュ憡锛坴iewer+锛?// ==============================
router.post('/', authMiddleware, requireRole('viewer', 'user', 'admin'), async (req, res) => {
  const { targetType, targetId, targetSummary, description } = req.body;
  if (!targetType || !targetId || !description || !description.trim()) {
    return res.status(400).json({ error: '缂哄皯蹇呭～瀛楁' });
  }
  if (!['product', 'worklog'].includes(targetType)) {
    return res.status(400).json({ error: 'targetType 蹇呴』涓?product 鎴?worklog' });
  }

  const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 8);
  const now = new Date().toISOString();
  const db = getDbSync();

  try {
    db.run(
      `INSERT INTO error_reports (id, target_type, target_id, target_summary, description, reported_by, reported_by_name, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [id, targetType, targetId, targetSummary || '', description.trim(), req.user.id, req.user.display_name || '', now]
    );
    saveDbImmediate();
    res.json({ success: true, id });
  } catch (e) {
    res.status(500).json({ error: '鍒涘缓鎶ュ憡澶辫触: ' + e.message });
  }
});

// ==============================
// 2. 鑾峰彇閿欒鎶ュ憡鍒楄〃锛坲ser+锛?// ==============================
router.get('/', authMiddleware, requireRole('user', 'admin'), (req, res) => {
  const { status } = req.query;
  const db = getDbSync();

  try {
    let sql = 'SELECT * FROM error_reports';
    const params = [];
    if (status === 'pending' || status === 'resolved') {
      sql += ' WHERE status = ?';
      params.push(status);
    }
    sql += ' ORDER BY created_at DESC LIMIT 200';

    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: '鏌ヨ澶辫触: ' + e.message });
  }
});

// ==============================
// 3. 鎸夌洰鏍囪幏鍙栨姤鍛婏紙user+锛?// ==============================
router.get('/by-target', authMiddleware, requireRole('user', 'admin'), (req, res) => {
  const { type, id } = req.query;
  if (!type || !id) return res.status(400).json({ error: '缂哄皯 type 鎴?id' });

  const db = getDbSync();
  try {
    const stmt = db.prepare('SELECT * FROM error_reports WHERE target_type = ? AND target_id = ? ORDER BY created_at DESC');
    stmt.bind([type, id]);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: '鏌ヨ澶辫触: ' + e.message });
  }
});

// ==============================
// 4. 鏍囪宸插鐞嗭紙user+锛?// ==============================
router.put('/:id/resolve', authMiddleware, requireRole('user', 'admin'), (req, res) => {
  const db = getDbSync();
  const now = new Date().toISOString();

  try {
    const existing = db.exec('SELECT id FROM error_reports WHERE id = ?', [req.params.id]);
    if (!existing || !existing[0] || !existing[0].values || !existing[0].values[0]) {
      return res.status(404).json({ error: '报告不存在' });
    }

    db.run(
      'UPDATE error_reports SET status = ?, resolved_by = ?, resolved_at = ? WHERE id = ?',
      ['resolved', req.user.id, now, req.params.id]
    );
    saveDbImmediate();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: '操作失败: ' + e.message });
  }
});

module.exports = router;
