const express = require('express');
const fs = require('fs');
const path = require('path');
const { authMiddleware, requireBusinessRole } = require('../middleware/auth.cjs');
const { ALLOWED_MAX_BACKUPS, BACKUP_DIR, applyBusinessBackupFile, createBusinessBackup, getMaxBackups, isBackupFileName, listBackups, parseBackupToken, setBackupStarred, setMaxBackups, validateBusinessBackup } = require('../services/databaseBackup.cjs');

const router = express.Router();
router.use(authMiddleware, requireBusinessRole('developer'));

router.get('/', (_req, res) => {
  const backups = listBackups().map(backup => ({
    name: backup.name,
    dataDate: parseBackupToken(backup.name)?.dataDate || backup.name.match(/^data-(\d{4}-\d{2}-\d{2})\.db$/)?.[1] || '',
    type: parseBackupToken(backup.name)?.type || 'legacy',
    size: backup.stat.size,
    createdAt: backup.stat.mtime.toISOString(),
    starred: backup.starred,
  }));
  res.json({ backups, maxBackups: getMaxBackups(), maxBackupOptions: ALLOWED_MAX_BACKUPS, schedule: '00:00' });
});

router.put('/settings', (req, res) => {
  try {
    const maxBackups = setMaxBackups(req.body?.maxBackups);
    res.json({ success: true, maxBackups });
  } catch (error) {
    res.status(400).json({ error: error.message || '备份设置无效' });
  }
});

router.post('/create', (_req, res) => {
  try {
    const filePath = createBusinessBackup({ type: 'manual' });
    const backup = listBackups().find(item => item.path === filePath);
    res.json({ success: true, backup: backup ? { name: backup.name, size: backup.stat.size, createdAt: backup.stat.mtime.toISOString() } : null });
  } catch (error) {
    console.error('business backup creation failed:', error);
    res.status(500).json({ error: error.message || '创建业务备份失败' });
  }
});

router.get('/:name/download', (req, res) => {
  const name = String(req.params.name || '');
  if (!isBackupFileName(name)) {
    return res.status(400).json({ error: '备份文件名无效' });
  }
  const backup = listBackups().find(item => item.name === name);
  if (!backup || path.resolve(path.dirname(backup.path)) !== path.resolve(BACKUP_DIR)) {
    return res.status(404).json({ error: '备份不存在' });
  }
  res.download(backup.path, name);
});

router.put('/:name/star', (req, res) => {
  const name = String(req.params.name || '');
  if (!isBackupFileName(name)) {
    return res.status(400).json({ error: '备份文件名无效' });
  }
  const backup = listBackups().find(item => item.name === name);
  if (!backup || path.resolve(path.dirname(backup.path)) !== path.resolve(BACKUP_DIR)) {
    return res.status(404).json({ error: '备份不存在' });
  }
  try {
    const starred = setBackupStarred(name, Boolean(req.body?.starred));
    res.json({ success: true, name, starred });
  } catch (error) {
    res.status(400).json({ error: error.message || '星标设置失败' });
  }
});

router.post('/:name/apply', async (req, res) => {
  const name = String(req.params.name || '');
  if (!isBackupFileName(name)) {
    return res.status(400).json({ error: '备份文件名无效' });
  }
  const backup = listBackups().find(item => item.name === name);
  if (!backup || path.resolve(path.dirname(backup.path)) !== path.resolve(BACKUP_DIR)) {
    return res.status(404).json({ error: '备份不存在' });
  }
  try {
    validateBusinessBackup(fs.readFileSync(backup.path));
    applyBusinessBackupFile(backup.path);
    res.json({ success: true });
  } catch (error) {
    console.error('business backup restore failed:', error);
    res.status(500).json({ error: error.message || '应用备份失败' });
  }
});

module.exports = router;
