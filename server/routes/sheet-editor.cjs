const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const XLSX = require('xlsx');
const JSZip = require('jszip');
const { getDbSync, saveDbImmediate } = require('../db.cjs');
const { authMiddleware, requireRole, queryOne } = require('../middleware/auth.cjs');
const { CLOUD_DIR } = require('../paths.cjs');
const {
  createSheetSession,
  validateSheetSession,
  validateSheetLock,
  heartbeatSheetLock,
  releaseSheetLock,
  createSheetVersion,
  listSheetVersions,
  getSheetVersion,
} = require('../services/sheetEditorStore.cjs');
const { logAudit } = require('../services/audit.cjs');
const { createRateLimiter } = require('../middleware/rateLimit.cjs');

const router = express.Router();
const MAX_EDITOR_FILE_BYTES = Math.min(50 * 1024 * 1024, Math.max(1024 * 1024, Number(process.env.IBD_SHEET_EDITOR_MAX_BYTES) || 25 * 1024 * 1024));
const MAX_EDITOR_EXPANDED_BYTES = 200 * 1024 * 1024;
const MAX_EDITOR_ZIP_ENTRIES = 5000;
const MAX_EDITOR_SHEETS = 64;
const MAX_EDITOR_CELLS = 2_000_000;
const limiterKey = req => `${req.user?.id || req.ip}:${req.params?.fileId || ''}`;
const sessionLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 120, keyGenerator: limiterKey, message: '表格编辑会话创建过于频繁' });
const saveLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 600, keyGenerator: limiterKey, message: '表格保存过于频繁' });
const historyLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 120, keyGenerator: limiterKey, message: '历史版本操作过于频繁' });
const restoreLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 30, keyGenerator: limiterKey, message: '版本恢复操作过于频繁' });
const heartbeatLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 240, keyGenerator: limiterKey, message: '编辑锁续租过于频繁' });
const sheetContentParser = express.raw({
  type: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream'],
  limit: MAX_EDITOR_FILE_BYTES,
});

router.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

function parseSheetContent(req, res, next) {
  sheetContentParser(req, res, error => {
    if (error?.type === 'entity.too.large') return res.status(413).json({ error: '在线编辑文件不能超过 25MB' });
    if (error) return res.status(400).json({ error: '无法读取保存内容' });
    return next();
  });
}

async function validateXlsxArchive(buffer) {
  try {
    const archive = await JSZip.loadAsync(buffer, { checkCRC32: false });
    const entries = Object.values(archive.files);
    if (entries.length > MAX_EDITOR_ZIP_ENTRIES) throw Object.assign(new Error('XLSX 内部文件数量过多'), { status: 413 });
    let expandedBytes = 0;
    for (const entry of entries) {
      expandedBytes += Number(entry?._data?.uncompressedSize || 0);
      if (expandedBytes > MAX_EDITOR_EXPANDED_BYTES) throw Object.assign(new Error('XLSX 解压后内容超过 200MB'), { status: 413 });
    }
  } catch (error) {
    if (error?.status) throw error;
    throw Object.assign(new Error('XLSX 压缩结构无效'), { status: 422 });
  }
}

function validateWorkbookComplexity(workbook) {
  if (workbook.SheetNames.length > MAX_EDITOR_SHEETS) throw Object.assign(new Error('工作表数量不能超过 64 个'), { status: 422 });
  let cells = 0;
  for (const name of workbook.SheetNames) {
    const ref = workbook.Sheets[name]?.['!ref'];
    if (!ref) continue;
    const range = XLSX.utils.decode_range(ref);
    cells += (range.e.r - range.s.r + 1) * (range.e.c - range.s.c + 1);
    if (cells > MAX_EDITOR_CELLS) throw Object.assign(new Error('工作簿有效区域不能超过 200 万个单元格'), { status: 422 });
  }
}
const LEGACY_CLOUD_DIRS = [
  path.join(__dirname, '..', '..', 'data', 'uploads'),
  path.join(__dirname, '..', 'uploads'),
  path.join(__dirname, '..', '..', '.uploads'),
];

function readCloudRecord(fileId) {
  const row = queryOne(getDbSync(), 'SELECT data FROM clouddrive_files WHERE id=?', [fileId]);
  if (!row?.data) return null;
  try { return { id: fileId, ...JSON.parse(row.data) }; } catch { return null; }
}

function safeFileIn(root, storedName) {
  const rawName = String(storedName || '');
  const cleanName = path.basename(rawName);
  if (!cleanName || cleanName !== rawName) return '';
  const rootPath = path.resolve(root);
  const candidate = path.resolve(rootPath, cleanName);
  if (!candidate.startsWith(`${rootPath}${path.sep}`) || !fs.existsSync(candidate)) return '';
  return candidate;
}

function resolveSourceFile(item) {
  const roots = [CLOUD_DIR, ...LEGACY_CLOUD_DIRS];
  for (const root of roots) {
    const candidate = safeFileIn(root, item?.storedName);
    if (candidate) return candidate;
  }
  return '';
}

function validateEditableSource(fileId) {
  const item = readCloudRecord(fileId);
  if (!item) return { status: 404, error: '云盘文件不存在' };
  if (item.deletedAt) return { status: 410, error: '回收站文件不能在线编辑' };
  if (item.kind === 'folder') return { status: 400, error: '文件夹不能在线编辑' };
  if (path.extname(item.fileName || '').toLowerCase() !== '.xlsx') {
    return { status: 415, error: '当前阶段仅支持 .xlsx 文件' };
  }
  const filePath = resolveSourceFile(item);
  if (!filePath) return { status: 404, error: '云盘源文件已丢失' };
  return { item, filePath };
}

function checksumFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function sourceRevision(item, filePath) {
  const stat = fs.statSync(filePath);
  return String(item.updatedAt || item.renamedAt || item.uploadedAt || stat.mtimeMs);
}

router.post('/:fileId/session', authMiddleware, requireRole('user', 'admin'), sessionLimiter, async (req, res) => {
  try {
    const source = validateEditableSource(req.params.fileId);
    if (source.error) return res.status(source.status).json({ error: source.error });
    const stat = fs.statSync(source.filePath);
    if (stat.size > MAX_EDITOR_FILE_BYTES) return res.status(413).json({ error: '在线编辑仅支持不超过 25MB 的 XLSX 文件' });
    const sourceBuffer = fs.readFileSync(source.filePath);
    await validateXlsxArchive(sourceBuffer);
    validateWorkbookComplexity(XLSX.read(sourceBuffer, { type: 'buffer', dense: true, cellStyles: false }));
    const requestedMode = req.body?.mode === 'readonly' ? 'readonly' : 'edit';
    const session = await createSheetSession({
      fileId: source.item.id,
      userId: req.user.id,
      userName: req.user.display_name,
      mode: requestedMode,
    });
    logAudit(
      req.user.id,
      req.user.display_name,
      'sheet-editor.session.open',
      'clouddrive',
      source.item.id,
      session.mode === 'edit' ? '取得在线编辑锁' : `只读打开；当前编辑者：${session.lock?.ownerName || '其他用户'}`,
    );
    res.setHeader('Cache-Control', 'no-store');
    return res.status(201).json({
      sessionId: session.id,
      sessionToken: session.token,
      mode: session.mode,
      lock: session.lock,
      expiresAt: session.expiresAt,
      sourceUrl: `/api/sheet-editor/${encodeURIComponent(source.item.id)}/source`,
      file: {
        id: source.item.id,
        name: source.item.fileName,
        size: stat.size,
        mimeType: source.item.mimeType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        revision: sourceRevision(source.item, source.filePath),
        checksum: checksumFile(source.filePath),
      },
    });
  } catch (error) {
    if (error?.status) return res.status(error.status).json({ error: error.message });
    console.error('[sheet-editor] 创建会话失败:', error);
    return res.status(500).json({ error: '创建表格编辑会话失败' });
  }
});

router.put(
  '/:fileId/content',
  authMiddleware,
  requireRole('user', 'admin'),
  saveLimiter,
  parseSheetContent,
  async (req, res) => {
    let tempPath = '';
    try {
      const session = await validateSheetSession({
        sessionId: String(req.headers['x-sheet-session-id'] || ''),
        token: String(req.headers['x-sheet-session-token'] || ''),
        fileId: req.params.fileId,
        userId: req.user.id,
      });
      if (!session || session.mode !== 'edit') return res.status(403).json({ error: '编辑会话无效、已过期或为只读模式' });
      const lock = await validateSheetLock({ sessionId: session.id, fileId: req.params.fileId, userId: req.user.id });
      if (!lock) return res.status(423).json({ code: 'SHEET_LOCK_LOST', error: '编辑锁已失效，当前页面已转为只读' });

      const source = validateEditableSource(req.params.fileId);
      if (source.error) return res.status(source.status).json({ error: source.error });
      const expectedChecksum = String(req.headers['x-sheet-expected-checksum'] || '').toLowerCase();
      const expectedRevision = String(req.headers['x-sheet-expected-revision'] || '');
      if (!/^[a-f0-9]{64}$/.test(expectedChecksum) || !expectedRevision) {
        return res.status(400).json({ error: '缺少有效的源文件版本信息' });
      }
      const currentChecksum = checksumFile(source.filePath);
      const currentRevision = sourceRevision(source.item, source.filePath);
      if (currentChecksum !== expectedChecksum || currentRevision !== expectedRevision) {
        return res.status(409).json({
          code: 'SHEET_VERSION_CONFLICT',
          error: '源文件已被其他操作更新，请重新加载后再编辑',
          current: { checksum: currentChecksum, revision: currentRevision, size: fs.statSync(source.filePath).size },
        });
      }
      if (!Buffer.isBuffer(req.body) || req.body.length < 4 || req.body[0] !== 0x50 || req.body[1] !== 0x4b) {
        return res.status(400).json({ error: '保存内容不是有效的 XLSX 文件' });
      }
      await validateXlsxArchive(req.body);
      const parsed = XLSX.read(req.body, { type: 'buffer', dense: true, cellStyles: false });
      if (!parsed.SheetNames?.length) return res.status(400).json({ error: '工作簿至少需要一个工作表' });
      validateWorkbookComplexity(parsed);

      // All checks above are synchronous; re-check immediately before the atomic replacement.
      if (checksumFile(source.filePath) !== expectedChecksum) {
        return res.status(409).json({ code: 'SHEET_VERSION_CONFLICT', error: '保存期间源文件已发生变化，请重新加载' });
      }
      await createSheetVersion({
        fileId: source.item.id,
        sourcePath: source.filePath,
        checksum: currentChecksum,
        sourceRevision: currentRevision,
        reason: 'auto_save',
        userId: req.user.id,
        userName: req.user.display_name,
      });
      if (checksumFile(source.filePath) !== expectedChecksum) {
        return res.status(409).json({ code: 'SHEET_VERSION_CONFLICT', error: '备份期间源文件已发生变化，请重新加载' });
      }
      tempPath = `${source.filePath}.${crypto.randomUUID()}.tmp`;
      const descriptor = fs.openSync(tempPath, 'wx', 0o600);
      try {
        fs.writeFileSync(descriptor, req.body);
        fs.fsyncSync(descriptor);
      } finally {
        fs.closeSync(descriptor);
      }
      fs.renameSync(tempPath, source.filePath);
      tempPath = '';

      const updatedAt = new Date().toISOString();
      const nextItem = {
        ...source.item,
        size: req.body.length,
        updatedAt,
        modifiedBy: req.user.display_name || req.user.id,
      };
      const { id: _recordId, ...storedItem } = nextItem;
      getDbSync().run('UPDATE clouddrive_files SET data=? WHERE id=?', [JSON.stringify(storedItem), source.item.id]);
      saveDbImmediate();
      const checksum = checksumFile(source.filePath);
      logAudit(req.user.id, req.user.display_name, 'sheet-editor.save', 'clouddrive', source.item.id, `在线保存：${source.item.fileName}`);
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ checksum, revision: updatedAt, size: req.body.length, updatedAt });
    } catch (error) {
      if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      if (error?.status) return res.status(error.status).json({ error: error.message });
      console.error('[sheet-editor] 保存失败:', error);
      return res.status(500).json({ error: '保存工作簿失败，源文件未被替换' });
    }
  },
);

router.get('/:fileId/versions', authMiddleware, requireRole('user', 'admin'), historyLimiter, async (req, res) => {
  try {
    const session = await validateSheetSession({
      sessionId: String(req.headers['x-sheet-session-id'] || ''),
      token: String(req.headers['x-sheet-session-token'] || ''),
      fileId: req.params.fileId,
      userId: req.user.id,
    });
    if (!session) return res.status(403).json({ error: '编辑会话无效或已过期' });
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ versions: await listSheetVersions(req.params.fileId, req.query.limit) });
  } catch (error) {
    console.error('[sheet-editor] 读取版本列表失败:', error);
    return res.status(500).json({ error: '读取历史版本失败' });
  }
});

router.get('/:fileId/versions/:versionId/download', authMiddleware, requireRole('user', 'admin'), historyLimiter, async (req, res) => {
  try {
    const session = await validateSheetSession({
      sessionId: String(req.headers['x-sheet-session-id'] || ''),
      token: String(req.headers['x-sheet-session-token'] || ''),
      fileId: req.params.fileId,
      userId: req.user.id,
    });
    if (!session) return res.status(403).json({ error: '编辑会话无效或已过期' });
    const version = await getSheetVersion(req.params.fileId, req.params.versionId);
    if (!version) return res.status(404).json({ error: '历史版本不存在或文件已丢失' });
    logAudit(req.user.id, req.user.display_name, 'sheet-editor.version.download', 'clouddrive', req.params.fileId, req.params.versionId);
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`历史版本_${version.created_at}.xlsx`)}`);
    return res.sendFile(version.filePath);
  } catch (error) {
    console.error('[sheet-editor] 下载历史版本失败:', error);
    return res.status(500).json({ error: '下载历史版本失败' });
  }
});

router.post('/:fileId/versions/:versionId/restore', authMiddleware, requireRole('user', 'admin'), restoreLimiter, async (req, res) => {
  let tempPath = '';
  try {
    const sessionId = String(req.headers['x-sheet-session-id'] || '');
    const session = await validateSheetSession({
      sessionId,
      token: String(req.headers['x-sheet-session-token'] || ''),
      fileId: req.params.fileId,
      userId: req.user.id,
    });
    if (!session || session.mode !== 'edit') return res.status(403).json({ error: '恢复版本需要有效的编辑会话' });
    const lock = await validateSheetLock({ sessionId, fileId: req.params.fileId, userId: req.user.id });
    if (!lock) return res.status(423).json({ code: 'SHEET_LOCK_LOST', error: '编辑锁已失效，无法恢复版本' });
    const source = validateEditableSource(req.params.fileId);
    if (source.error) return res.status(source.status).json({ error: source.error });
    const expectedChecksum = String(req.headers['x-sheet-expected-checksum'] || '').toLowerCase();
    const expectedRevision = String(req.headers['x-sheet-expected-revision'] || '');
    const currentChecksum = checksumFile(source.filePath);
    const currentRevision = sourceRevision(source.item, source.filePath);
    if (currentChecksum !== expectedChecksum || currentRevision !== expectedRevision) {
      return res.status(409).json({ code: 'SHEET_VERSION_CONFLICT', error: '当前文件已有新版本，请重新加载后再恢复' });
    }
    const version = await getSheetVersion(req.params.fileId, req.params.versionId);
    if (!version || checksumFile(version.filePath) !== version.checksum) {
      return res.status(422).json({ error: '历史版本不存在或完整性校验失败' });
    }
    await createSheetVersion({
      fileId: source.item.id,
      sourcePath: source.filePath,
      checksum: currentChecksum,
      sourceRevision: currentRevision,
      reason: 'before_restore',
      userId: req.user.id,
      userName: req.user.display_name,
    });
    if (checksumFile(source.filePath) !== expectedChecksum) {
      return res.status(409).json({ code: 'SHEET_VERSION_CONFLICT', error: '备份期间当前文件已发生变化，请重新加载' });
    }
    tempPath = `${source.filePath}.${crypto.randomUUID()}.restore.tmp`;
    fs.copyFileSync(version.filePath, tempPath, fs.constants.COPYFILE_EXCL);
    const descriptor = fs.openSync(tempPath, 'r+');
    try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    fs.renameSync(tempPath, source.filePath);
    tempPath = '';
    const updatedAt = new Date().toISOString();
    const { id: _recordId, ...storedItem } = source.item;
    storedItem.size = fs.statSync(source.filePath).size;
    storedItem.updatedAt = updatedAt;
    storedItem.modifiedBy = req.user.display_name || req.user.id;
    getDbSync().run('UPDATE clouddrive_files SET data=? WHERE id=?', [JSON.stringify(storedItem), source.item.id]);
    saveDbImmediate();
    const checksum = checksumFile(source.filePath);
    logAudit(req.user.id, req.user.display_name, 'sheet-editor.restore', 'clouddrive', source.item.id, `恢复历史版本：${req.params.versionId}`);
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ checksum, revision: updatedAt, size: storedItem.size, restoredVersionId: version.id });
  } catch (error) {
    if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    console.error('[sheet-editor] 恢复历史版本失败:', error);
    return res.status(500).json({ error: '恢复历史版本失败' });
  }
});

router.post('/:fileId/lock/heartbeat', authMiddleware, requireRole('user', 'admin'), heartbeatLimiter, async (req, res) => {
  try {
    const sessionId = String(req.headers['x-sheet-session-id'] || '');
    const token = String(req.headers['x-sheet-session-token'] || '');
    const session = await validateSheetSession({ sessionId, token, fileId: req.params.fileId, userId: req.user.id });
    if (!session || session.mode !== 'edit') return res.status(423).json({ code: 'SHEET_LOCK_LOST', error: '编辑会话已失效' });
    const lock = await heartbeatSheetLock({ sessionId, fileId: req.params.fileId, userId: req.user.id });
    if (!lock) return res.status(423).json({ code: 'SHEET_LOCK_LOST', error: '编辑锁已失效' });
    res.setHeader('Cache-Control', 'no-store');
    return res.json(lock);
  } catch (error) {
    console.error('[sheet-editor] 编辑锁续租失败:', error);
    return res.status(500).json({ error: '编辑锁续租失败' });
  }
});

router.delete('/:fileId/lock', authMiddleware, requireRole('user', 'admin'), async (req, res) => {
  try {
    const sessionId = String(req.headers['x-sheet-session-id'] || '');
    const token = String(req.headers['x-sheet-session-token'] || '');
    const session = await validateSheetSession({ sessionId, token, fileId: req.params.fileId, userId: req.user.id });
    if (session) await releaseSheetLock({ sessionId, fileId: req.params.fileId, userId: req.user.id });
    return res.status(204).end();
  } catch (error) {
    console.error('[sheet-editor] 释放编辑锁失败:', error);
    return res.status(500).json({ error: '释放编辑锁失败' });
  }
});

router.get('/:fileId/source', authMiddleware, requireRole('user', 'admin'), async (req, res) => {
  try {
    const sessionId = String(req.headers['x-sheet-session-id'] || '');
    const sessionToken = String(req.headers['x-sheet-session-token'] || '');
    const session = await validateSheetSession({
      sessionId,
      token: sessionToken,
      fileId: req.params.fileId,
      userId: req.user.id,
    });
    if (!session) return res.status(403).json({ error: '编辑会话无效或已过期' });

    const source = validateEditableSource(req.params.fileId);
    if (source.error) return res.status(source.status).json({ error: source.error });
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('Content-Type', source.item.mimeType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(source.item.fileName)}`);
    return res.sendFile(source.filePath);
  } catch (error) {
    console.error('[sheet-editor] 读取源文件失败:', error);
    return res.status(500).json({ error: '读取表格源文件失败' });
  }
});

module.exports = router;
