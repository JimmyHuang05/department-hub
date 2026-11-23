/**
 * 审计日志工具函数
 * 用法: const { logAudit } = require('./audit.cjs');
 *       logAudit(req.user.id, req.user.display_name, 'product.delete', 'product', id, '删除产品: XX');
 */
const { getDbSync, saveDb } = require('../db.cjs');

function logAudit(userId, userName, action, targetType = '', targetId = '', detail = '', snapshot = null) {
  try {
    const db = getDbSync();
    if (!db) return;
    const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 8);
    db.run(
      'INSERT INTO audit_log (id, user_id, user_name, action, target_type, target_id, detail, created_at, snapshot_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, userId, userName || '', action, targetType, targetId, detail, new Date().toISOString(), snapshot ? JSON.stringify(snapshot) : '']
    );
    saveDb();
    return id;
  } catch (e) {
    console.error('[audit] 写入失败:', e.message);
  }
}

function queryRows(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function sqlSnapshot(db, specs) {
  return {
    version: 1,
    records: specs.map(spec => ({ table: spec.table, mode: spec.mode || 'insert', rows: queryRows(db, spec.sql, spec.params || []) }))
      .filter(record => record.rows.length),
  };
}

module.exports = { logAudit, queryRows, sqlSnapshot };
