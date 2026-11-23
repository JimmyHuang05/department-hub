const express = require('express');
const { getDbSync, saveDbImmediate } = require('../db.cjs');
const { authMiddleware } = require('../middleware/auth.cjs');

const router = express.Router();

// Fetch recent edit records for a table/list without one request per row.
router.get('/records/:recordType', authMiddleware, async (req, res) => {
  const { recordType } = req.params;
  const recordIds = String(req.query.recordIds || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
    .slice(0, 300);
  if (!recordIds.length) return res.json({ entries: [] });

  const db = getDbSync();
  if (!db) return res.status(503).json({ error: 'Database unavailable' });
  const placeholders = recordIds.map(() => '?').join(',');
  const result = db.exec(
    `SELECT h.id, h.record_id, h.field, h.old_value, h.new_value, h.edited_by, h.edited_at,
            COALESCE(u.display_name, h.edited_by) AS edited_name
       FROM edit_history h
       LEFT JOIN users u ON u.id = h.edited_by
      WHERE h.record_type = ? AND h.record_id IN (${placeholders})
      ORDER BY h.edited_at DESC LIMIT 300`,
    [recordType, ...recordIds]
  );
  const entries = result[0]?.values.map(row => ({
    id: row[0], recordId: row[1], field: row[2], oldValue: row[3], newValue: row[4],
    editedBy: row[5], editedAt: row[6], editedName: row[7],
  })) || [];
  res.json({ entries });
});

// GET /api/history/:recordType/:recordId — 获取编辑历史
// 支持 ?order=asc 参数（用于操作回放），默认 DESC（最新的在前）
router.get('/:recordType/:recordId', authMiddleware, async (req, res) => {
  const { recordType, recordId } = req.params;
  const order = req.query.order === 'asc' ? 'ASC' : 'DESC';
  const db = getDbSync();
  if (!db) return res.status(503).json({ error: '数据库未就绪' });

  const result = db.exec(
    `SELECT h.id, h.field, h.old_value, h.new_value, h.edited_by, h.edited_at,
            COALESCE(u.display_name, h.edited_by) AS edited_name
       FROM edit_history h
       LEFT JOIN users u ON u.id = h.edited_by
      WHERE h.record_id = ? AND h.record_type = ?
      ORDER BY h.edited_at ${order} LIMIT 200`,
    [recordId, recordType]
  );
  const entries = result[0]?.values.map(row => ({
    id: row[0],
    field: row[1],
    oldValue: row[2],
    newValue: row[3],
    editedBy: row[4],
    editedAt: row[5],
    editedName: row[6],
  })) || [];

  res.json({ entries });
});

// POST /api/history — 记录一次编辑
router.post('/', authMiddleware, async (req, res) => {
  const { recordId, recordType, field, oldValue, newValue } = req.body;
  if (!recordId || !recordType || !field) {
    return res.status(400).json({ error: '缺少必要参数' });
  }

  const db = getDbSync();
  if (!db) return res.status(503).json({ error: '数据库未就绪' });

  const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 8);
  db.run(
    'INSERT INTO edit_history (id, record_id, record_type, field, old_value, new_value, edited_by, edited_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, recordId, recordType, field,
     oldValue != null ? String(oldValue) : '',
     newValue != null ? String(newValue) : '',
     req.user.id, new Date().toISOString()]
  );
  saveDbImmediate();

  res.json({ success: true });
});

module.exports = router;
