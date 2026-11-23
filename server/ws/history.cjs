/**
 * 编辑历史版本管理
 * 记录每个记录（产品/日志）的每次修改，支持版本回溯
 */
const { getDb, saveDbImmediate } = require('../db.cjs');

// 创建 edit_history 表（在 init 时调用）
function initHistoryTable(db) {
  db.run(`CREATE TABLE IF NOT EXISTS edit_history (
    id TEXT PRIMARY KEY,
    record_id TEXT NOT NULL,
    record_type TEXT NOT NULL,
    field TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    edited_by TEXT NOT NULL,
    edited_at TEXT NOT NULL
  )`);
  // 索引
  try {
    db.run('CREATE INDEX IF NOT EXISTS idx_history_record ON edit_history(record_id, record_type)');
    db.run('CREATE INDEX IF NOT EXISTS idx_history_time ON edit_history(edited_at)');
  } catch (e) { /* ignore */ }
}

// 记录一次编辑
function recordEdit(recordId, recordType, field, oldValue, newValue, editedBy) {
  const db = getDb();
  const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 8);
  db.run(
    'INSERT INTO edit_history (id, record_id, record_type, field, old_value, new_value, edited_by, edited_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, recordId, recordType, field,
     oldValue != null ? String(oldValue) : '',
     newValue != null ? String(newValue) : '',
     editedBy, new Date().toISOString()]
  );
  saveDbImmediate();
}

// 获取某个记录的历史版本
function getRecordHistory(recordId, recordType) {
  const db = getDb();
  const result = db.exec(
    'SELECT id, field, old_value, new_value, edited_by, edited_at FROM edit_history WHERE record_id = ? AND record_type = ? ORDER BY edited_at DESC LIMIT 200',
    [recordId, recordType]
  );
  return result[0]?.values.map(row => ({
    id: row[0],
    field: row[1],
    oldValue: row[2],
    newValue: row[3],
    editedBy: row[4],
    editedAt: row[5],
  })) || [];
}

// 获取某个记录在某个时间点的快照构建
function getHistoryForRecord(recordId, recordType) {
  return getRecordHistory(recordId, recordType);
}

module.exports = { initHistoryTable, recordEdit, getHistoryForRecord };
