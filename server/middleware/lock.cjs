/**
 * 乐观锁并发控制模块
 * 版本号存储在 data JSON 中的 _version 字段，无需数据库表结构变更
 */

function getRowVersion(db, table, id) {
  const stmt = db.prepare(`SELECT data FROM ${table} WHERE id = ?`);
  stmt.bind([id]);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    try {
      const data = JSON.parse(row.data);
      return { version: data._version || 1, data };
    } catch (e) { return { version: 1, data: {} }; }
  }
  stmt.free();
  return null;
}

function tryOptimisticUpdate(db, table, id, newData, expectedVersion) {
  const existing = getRowVersion(db, table, id);
  if (!existing) return { success: false, message: '记录不存在' };

  const currentVersion = existing.version;
  if (expectedVersion !== null && expectedVersion !== undefined &&
      Number(expectedVersion) !== Number(currentVersion)) {
    return {
      success: false, message: `数据冲突：已被其他用户修改（版本 ${currentVersion}），请刷新`,
      conflict: true, currentVersion,
      serverData: { ...existing.data, _version: currentVersion, _conflict: true },
    };
  }

  const newVersion = Number(currentVersion) + 1;
  const saveData = { ...newData, _version: newVersion };
  const now = new Date().toISOString();
  db.run(`UPDATE ${table} SET data = ?, updated_at = ? WHERE id = ?`,
    [JSON.stringify(saveData), now, id]);
  return { success: true, message: '更新成功', newVersion };
}

module.exports = { tryOptimisticUpdate };
