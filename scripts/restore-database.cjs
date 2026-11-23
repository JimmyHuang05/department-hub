const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const { DB_PATH } = require('../server/paths.cjs');
const { BACKUP_DIR } = require('../server/services/databaseBackup.cjs');

async function main() {
  const sourceArg = process.argv[2];
  if (!sourceArg) throw new Error('用法: npm run db:restore -- <备份文件路径>（恢复前请停止后端服务）');
  const source = path.resolve(sourceArg);
  if (!fs.existsSync(source)) throw new Error(`备份文件不存在: ${source}`);

  const SQL = await initSqlJs();
  const candidate = new SQL.Database(fs.readFileSync(source));
  const integrity = candidate.exec('PRAGMA integrity_check');
  candidate.close();
  if (integrity[0]?.values?.[0]?.[0] !== 'ok') throw new Error('备份文件完整性检查未通过');

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  if (fs.existsSync(DB_PATH)) {
    const safetyName = `pre-restore-${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}.db`;
    fs.copyFileSync(DB_PATH, path.join(BACKUP_DIR, safetyName));
  }
  const tempPath = `${DB_PATH}.restore.tmp`;
  fs.copyFileSync(source, tempPath);
  fs.copyFileSync(tempPath, DB_PATH);
  fs.unlinkSync(tempPath);
  console.log(`数据库恢复完成: ${DB_PATH}`);
}

main().catch(error => {
  console.error(`数据库恢复失败: ${error.message}`);
  process.exitCode = 1;
});
