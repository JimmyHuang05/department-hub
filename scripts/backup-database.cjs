const { createDatabaseBackup } = require('../server/services/databaseBackup.cjs');

try {
  const target = createDatabaseBackup({ skipFlush: true });
  if (!target) throw new Error('数据库文件不存在');
  console.log(`数据库备份完成: ${target}`);
} catch (error) {
  console.error(`数据库备份失败: ${error.message}`);
  process.exitCode = 1;
}
