const express = require('express');
const { getDbSync, saveDbImmediate } = require('../db.cjs');
const { authMiddleware, requireBusinessRole } = require('../middleware/auth.cjs');

const router = express.Router();

const RESTORE_TABLES = new Set([
  'products', 'entries', 'users', 'token_blacklist', 'tasks', 'task_recipients',
  'task_comments', 'notification_archives', 'notification_recipients', 'clouddrive_files',
]);

function columnsFor(db, table) {
  const stmt = db.prepare(`PRAGMA table_info(${table})`);
  const columns = [];
  while (stmt.step()) columns.push(String(stmt.getAsObject().name || ''));
  stmt.free();
  return columns.filter(Boolean);
}

router.post('/:id/undo', authMiddleware, requireBusinessRole('developer'), (req, res) => {
  const db = getDbSync();
  if (!db) return res.status(500).json({ error: '数据库未就绪' });
  let stmt;
  try {
    stmt = db.prepare('SELECT * FROM audit_log WHERE id=?');
    stmt.bind([req.params.id]);
    const log = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();
    stmt = null;
    if (!log) return res.status(404).json({ error: '操作日志不存在' });
    if (log.undone_at) return res.status(409).json({ error: '这次删除已经撤回' });
    if (!log.snapshot_json) return res.status(409).json({ error: '这条历史记录没有删除快照，无法撤回' });
    const snapshot = JSON.parse(String(log.snapshot_json));
    if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.records) || !snapshot.records.length) {
      return res.status(409).json({ error: '删除快照为空，无法撤回' });
    }
    db.run('BEGIN');
    for (const operation of snapshot.operations || []) {
      if (operation.type !== 'delete' || !RESTORE_TABLES.has(operation.table) || !operation.where) throw new Error('删除快照包含不支持的恢复操作');
      const allowed = new Set(columnsFor(db, operation.table));
      const keys = Object.keys(operation.where).filter(key => allowed.has(key));
      if (!keys.length) throw new Error('恢复操作缺少有效条件');
      db.run(`DELETE FROM ${operation.table} WHERE ${keys.map(key => `${key}=?`).join(' AND ')}`, keys.map(key => operation.where[key]));
    }
    for (const record of snapshot.records) {
      if (!RESTORE_TABLES.has(record.table) || !Array.isArray(record.rows)) throw new Error('删除快照包含不支持的数据类型');
      const allowed = new Set(columnsFor(db, record.table));
      for (const row of record.rows) {
        const columns = Object.keys(row).filter(column => allowed.has(column));
        if (!columns.length) continue;
        const verb = record.mode === 'replace' ? 'INSERT OR REPLACE' : 'INSERT';
        db.run(`${verb} INTO ${record.table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`, columns.map(column => row[column]));
      }
    }
    const undoneAt = new Date().toISOString();
    db.run('UPDATE audit_log SET undone_at=?,undone_by=? WHERE id=?', [undoneAt, req.user.id, req.params.id]);
    db.run('COMMIT');
    saveDbImmediate();
    res.json({ success: true, undoneAt });
  } catch (e) {
    try { if (stmt) stmt.free(); } catch (_) {}
    try { db.run('ROLLBACK'); } catch (_) {}
    const conflict = /UNIQUE constraint|PRIMARY KEY/i.test(String(e.message));
    res.status(conflict ? 409 : 500).json({ error: conflict ? '同一标识的数据已经存在，为避免覆盖新数据，本次未撤回' : '撤回失败: ' + e.message });
  }
});

router.get('/', authMiddleware, requireBusinessRole('developer'), (req, res) => {
  const { limit = 100, action, userId } = req.query;
  const db = getDbSync();
  if (!db) return res.status(500).json({ error: '数据库未就绪' });

  try {
    const maxLimit = Math.min(Number(limit) || 100, 500);
    let sql = 'SELECT * FROM audit_log';
    const params = [];
    const conditions = [];

    if (action) { conditions.push('action = ?'); params.push(action); }
    if (userId) { conditions.push('user_id = ?'); params.push(userId); }

    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(maxLimit);

    const stmt = db.prepare(sql);
    stmt.bind(params);
    const auditRows = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      const canUndo = Boolean(row.snapshot_json) && !row.undone_at;
      delete row.snapshot_json;
      auditRows.push({ ...row, can_undo: canUndo, source: 'audit_log' });
    }
    stmt.free();

    const historyRows = [];
    if (!action) {
      const historySql = `
        SELECT h.id, h.record_id, h.record_type, h.field, h.old_value, h.new_value, h.edited_by, h.edited_at,
               COALESCE(u.display_name, h.edited_by) AS edited_name
        FROM edit_history h
        LEFT JOIN users u ON u.id = h.edited_by
        ${userId ? 'WHERE h.edited_by = ?' : ''}
        ORDER BY h.edited_at DESC
        LIMIT ?
      `;
      const historyParams = userId ? [userId, maxLimit] : [maxLimit];
      const historyStmt = db.prepare(historySql);
      historyStmt.bind(historyParams);
      while (historyStmt.step()) {
        const row = historyStmt.getAsObject();
        const recordType = row.record_type || '';
        historyRows.push({
          id: 'history_' + row.id,
          user_id: row.edited_by || '',
          user_name: row.edited_name || row.edited_by || '',
          action: recordType === 'entry' ? 'entry.update' : recordType === 'product' ? 'product.update' : recordType + '.update',
          target_type: recordType,
          target_id: row.record_id || '',
          detail: `字段 ${row.field || ''}: ${row.old_value || ''} -> ${row.new_value || ''}`,
          created_at: row.edited_at,
          field: row.field || '',
          old_value: row.old_value || '',
          new_value: row.new_value || '',
          source: 'edit_history',
        });
      }
      historyStmt.free();
    }

    const rows = [...auditRows, ...historyRows]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, maxLimit);

    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: '查询失败: ' + e.message });
  }
});

module.exports = router;
