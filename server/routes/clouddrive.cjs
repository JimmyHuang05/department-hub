const express = require('express');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const multer = require('multer');
const { getDbSync, saveDbImmediate } = require('../db.cjs');
const { authMiddleware, requireRole, queryOne } = require('../middleware/auth.cjs');
const { createRateLimiter } = require('../middleware/rateLimit.cjs');
const { logAudit, sqlSnapshot } = require('../services/audit.cjs');
const { CLOUD_DIR, CLOUD_PREVIEW_DIR } = require('../paths.cjs');
const { MAX_CLOUD_FILE_BYTES, validateCloudFileName } = require('../services/uploadValidation.cjs');
const { createShare, findShare } = require('../services/fileShares.cjs');

const router = express.Router();
const now = () => new Date().toISOString();
const uploadRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 60,
  keyGenerator: req => req.user?.id || req.ip,
  message: '文件上传过于频繁，请稍后再试',
});
const QUOTA_BYTES = 10 * 1024 * 1024 * 1024;
const TRASH_RETENTION_DAYS = 7;
const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
const LEGACY_CLOUD_DIRS = [
  path.join(__dirname, '..', '..', 'data', 'uploads'),
  path.join(__dirname, '..', 'uploads'),
  path.join(__dirname, '..', '..', '.uploads'),
];

if (!fs.existsSync(CLOUD_DIR)) fs.mkdirSync(CLOUD_DIR, { recursive: true });
if (!fs.existsSync(CLOUD_PREVIEW_DIR)) fs.mkdirSync(CLOUD_PREVIEW_DIR, { recursive: true });

const OFFICE_EXTENSIONS = new Set(['.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx']);
const LIBREOFFICE_CANDIDATES = process.platform === 'win32'
  ? ['soffice.com', 'soffice.exe', 'libreoffice.exe']
  : ['libreoffice', 'soffice'];

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, CLOUD_DIR),
  filename: (req, file, cb) => {
    const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 8);
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, id + ext);
  },
});
const upload = multer({
  storage,
  limits: {
    fileSize: MAX_CLOUD_FILE_BYTES,
    files: 1,
    fields: 3,
    fieldSize: 16 * 1024,
    parts: 4,
  },
  fileFilter(req, file, cb) {
    const validation = validateCloudFileName(file.originalname);
    if (!validation.ok) {
      const error = new Error(validation.error);
      error.statusCode = 400;
      return cb(error);
    }
    return cb(null, true);
  },
});

function getUsedBytes() {
  let total = 0;
  for (const f of fs.readdirSync(CLOUD_DIR)) {
    try {
      const stat = fs.statSync(path.join(CLOUD_DIR, f));
      if (stat.isFile()) total += stat.size;
    } catch (_) {}
  }
  return total;
}

function parseRecords() {
  const db = getDbSync();
  if (!db) return [];
  const r = db.exec('SELECT id, data FROM clouddrive_files');
  if (!r.length || !r[0].values) return [];
  return r[0].values.map(row => {
    const item = JSON.parse(row[1]);
    item.id = row[0];
    return item;
  });
}

function getActiveRecords() {
  return parseRecords().filter(i => !i.deletedAt && (i.kind === 'folder' || fileExistsForRecord(i)))
    .sort((a, b) => (b.uploadedAt || '').localeCompare(a.uploadedAt || ''));
}

function uniqueNameInFolder(items, parentId, requestedName, isFolder = false) {
  const normalizedParentId = String(parentId || '');
  const occupied = new Set(items
    .filter(item => !item.deletedAt && String(item.parentId || '') === normalizedParentId)
    .map(item => String(item.fileName || '').toLocaleLowerCase('zh-CN')));
  if (!occupied.has(requestedName.toLocaleLowerCase('zh-CN'))) return requestedName;

  const extension = isFolder ? '' : path.extname(requestedName);
  const originalBase = extension ? requestedName.slice(0, -extension.length) : requestedName;
  for (let index = 1; index < 10000; index += 1) {
    const suffix = ` (${index})`;
    const base = originalBase.slice(0, Math.max(1, 255 - extension.length - suffix.length));
    const candidate = `${base}${suffix}${extension}`;
    if (!occupied.has(candidate.toLocaleLowerCase('zh-CN'))) return candidate;
  }
  throw new Error('无法生成不重复的文件名');
}

function getTrashRecords() {
  return parseRecords().filter(i => !!i.deletedAt)
    .sort((a, b) => (b.deletedAt || '').localeCompare(a.deletedAt || ''));
}

function safeResolve(baseDir, fileName) {
  if (!fileName) return null;
  const resolved = path.resolve(baseDir, fileName);
  const base = path.resolve(baseDir);
  return resolved.startsWith(base + path.sep) || resolved === base ? resolved : null;
}

function resolveCloudFilePath(item) {
  const storedName = item?.storedName;
  if (!storedName) return null;

  const currentPath = safeResolve(CLOUD_DIR, storedName);
  if (currentPath && fs.existsSync(currentPath)) return currentPath;

  for (const legacyDir of LEGACY_CLOUD_DIRS) {
    const legacyPath = safeResolve(legacyDir, storedName);
    if (!legacyPath || !fs.existsSync(legacyPath)) continue;
    if (currentPath) {
      try {
        fs.mkdirSync(CLOUD_DIR, { recursive: true });
        fs.copyFileSync(legacyPath, currentPath);
        return currentPath;
      } catch (_) {
        return legacyPath;
      }
    }
    return legacyPath;
  }

  return null;
}

function fileExistsForRecord(item) {
  return Boolean(resolveCloudFilePath(item));
}

function saveRecord(id, data) {
  const db = getDbSync();
  if (queryOne(db, 'SELECT 1 AS f FROM clouddrive_files WHERE id = ?', [id])) {
    db.run('UPDATE clouddrive_files SET data = ? WHERE id = ?', [JSON.stringify(data), id]);
  } else {
    db.run('INSERT INTO clouddrive_files(id, data) VALUES(?, ?)', [id, JSON.stringify(data)]);
  }
  saveDbImmediate();
}

function deleteStoredFiles(item) {
  const fp = resolveCloudFilePath(item);
  if (fp && fs.existsSync(fp)) fs.unlinkSync(fp);

  if (item?.storedName) {
    const previewName = `${path.basename(item.storedName, path.extname(item.storedName))}.pdf`;
    const previewPath = safeResolve(CLOUD_PREVIEW_DIR, previewName);
    if (previewPath && fs.existsSync(previewPath)) fs.unlinkSync(previewPath);
  }
}

function hardDelete(id, item, shouldSave = true, preserveStoredFiles = false) {
  const db = getDbSync();
  if (!db) return;
  if (item && !preserveStoredFiles) deleteStoredFiles(item);
  db.run('DELETE FROM clouddrive_files WHERE id = ?', [id]);
  if (shouldSave) saveDbImmediate();
}

function isTrashExpired(item, timestamp = Date.now()) {
  if (!item?.deletedAt) return false;
  const deletedAt = new Date(item.deletedAt).getTime();
  return Number.isFinite(deletedAt) && timestamp - deletedAt >= TRASH_RETENTION_MS;
}

function purgeExpiredTrash() {
  const db = getDbSync();
  if (!db) return 0;

  const timestamp = Date.now();
  let deletedCount = 0;
  for (const item of parseRecords()) {
    if (!isTrashExpired(item, timestamp)) continue;
    hardDelete(item.id, item, false);
    deletedCount += 1;
  }

  if (deletedCount > 0) saveDbImmediate();
  return deletedCount;
}

function fixFileName(name) {
  try {
    const fixed = Buffer.from(name, 'latin1').toString('utf8');
    if (fixed.includes('\uFFFD')) return name;
    if (fixed === name) return name;
    return fixed;
  } catch { return name; }
}

function isOfficeFile(item) {
  const ext = path.extname(item.fileName || item.storedName || '').toLowerCase();
  return OFFICE_EXTENSIONS.has(ext);
}

function findLibreOffice() {
  if (process.env.LIBREOFFICE_PATH) return process.env.LIBREOFFICE_PATH;
  return LIBREOFFICE_CANDIDATES[0];
}

function convertOfficeToPdf(sourcePath, outDir) {
  const binary = findLibreOffice();
  const args = [
    '--headless',
    '--nologo',
    '--nofirststartwizard',
    '--convert-to',
    'pdf',
    '--outdir',
    outDir,
    sourcePath,
  ];

  return new Promise((resolve, reject) => {
    execFile(binary, args, { timeout: 120000, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        const hint = stderr || stdout || error.message;
        reject(new Error('Office 预览转换失败: ' + hint));
        return;
      }
      resolve();
    });
  });
}

function findConvertedPdf(sourcePath, expectedPath, startedAtMs) {
  if (fs.existsSync(expectedPath)) return expectedPath;

  const sourceBase = path.basename(sourcePath, path.extname(sourcePath)).toLowerCase();
  const candidates = [];
  try {
    for (const fileName of fs.readdirSync(CLOUD_PREVIEW_DIR)) {
      if (path.extname(fileName).toLowerCase() !== '.pdf') continue;
      const filePath = path.join(CLOUD_PREVIEW_DIR, fileName);
      const stat = fs.statSync(filePath);
      candidates.push({ filePath, fileName: fileName.toLowerCase(), mtimeMs: stat.mtimeMs });
    }
  } catch (_) {
    return '';
  }

  const matchingName = candidates.find(item => path.basename(item.fileName, '.pdf') === sourceBase);
  if (matchingName) return matchingName.filePath;

  const fresh = candidates
    .filter(item => item.mtimeMs >= startedAtMs - 1000)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
  return fresh?.filePath || '';
}

// GET /api/clouddrive - 娲昏穬鏂囦欢鍒楄〃
router.get('/', authMiddleware, (req, res) => {
  try {
    const items = req.query.projectId
      ? getActiveRecords().filter(item => item.projectId === req.query.projectId)
      : getActiveRecords();
    res.json({ items });
  }
  catch (e) { res.status(500).json({ error: '鑾峰彇鏂囦欢鍒楄〃澶辫触: ' + e.message }); }
});

router.get('/trash', authMiddleware, (req, res) => {
  try { res.json({ items: getTrashRecords() }); }
  catch (e) { res.status(500).json({ error: '获取回收站列表失败: ' + e.message }); }
});

// GET /api/clouddrive/usage - 瀛樺偍绌洪棿
router.get('/usage', authMiddleware, (req, res) => {
  try {
    const used = getUsedBytes();
    res.json({ used, quota: QUOTA_BYTES, usedPercent: Math.round((used / QUOTA_BYTES) * 100) });
  } catch (e) { res.status(500).json({ error: '鑾峰彇绌洪棿浣跨敤鎯呭喌澶辫触: ' + e.message }); }
});

router.post('/folders', authMiddleware, requireRole('user', 'admin'), (req, res) => {
  try {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const parentId = typeof req.body?.parentId === 'string' ? req.body.parentId.trim() : '';
    const validation = validateCloudFileName(name);
    if (!validation.ok) return res.status(400).json({ error: validation.error.replace('文件名', '文件夹名称') });

    const active = getActiveRecords();
    if (parentId && !active.some(item => item.id === parentId && item.kind === 'folder')) {
      return res.status(400).json({ error: '上级文件夹不存在' });
    }
    const uniqueName = uniqueNameInFolder(active, parentId, name, true);

    const id = `folder-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const record = {
      kind: 'folder', fileName: uniqueName, fileSize: 0, mimeType: 'application/x-directory',
      parentId, uploadedBy: req.user.display_name, uploadedById: req.user.id, uploadedAt: now(),
      remark: '', projectId: '', projectName: '',
    };
    saveRecord(id, record);
    logAudit(req.user.id, req.user.display_name, 'clouddrive.folder.create', 'clouddrive', id, uniqueName);
    res.json({ success: true, folder: { id, ...record } });
  } catch (e) { res.status(500).json({ error: '新建文件夹失败: ' + e.message }); }
});

// POST /api/clouddrive/upload - 涓婁紶
router.post('/upload', authMiddleware, requireRole('user', 'admin'), uploadRateLimiter, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: '文件大小超过限制，最大 100MB' });
        return res.status(400).json({ error: '上传错误: ' + err.message });
      }
      return res.status(err.statusCode || 500).json({ error: '上传失败: ' + err.message });
    }
    if (!req.file) return res.status(400).json({ error: '未选择文件' });
    try {
      const used = getUsedBytes();
      if (used + req.file.size > QUOTA_BYTES) { fs.unlinkSync(req.file.path); return res.status(413).json({ error: '云盘空间不足，限额 10GB' }); }

      const id = path.basename(req.file.filename, path.extname(req.file.filename));
      const requestedFileName = fixFileName(req.file.originalname);
      const projectId = String(req.body.projectId || '').trim();
      const parentId = String(req.body.parentId || '').trim();
      if (parentId && !getActiveRecords().some(item => item.id === parentId && item.kind === 'folder')) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: '目标文件夹不存在' });
      }
      const fileName = uniqueNameInFolder(getActiveRecords(), parentId, requestedFileName);
      let projectName = '';
      if (projectId) {
        const project = queryOne(getDbSync(), 'SELECT data FROM products WHERE id=?', [projectId]);
        if (!project) {
          fs.unlinkSync(req.file.path);
          return res.status(400).json({ error: '关联项目不存在' });
        }
        try { projectName = JSON.parse(project.data).productName || ''; } catch {}
      }
      const record = {
        fileName, fileSize: req.file.size, mimeType: req.file.mimetype, storedName: req.file.filename,
        uploadedBy: req.user.display_name, uploadedById: req.user.id, uploadedAt: now(),
        remark: req.body.remark || '', remarkUpdatedBy: '', remarkUpdatedAt: '',
        kind: 'file', parentId, projectId: projectId || '', projectName,
      };
      saveRecord(id, record);
      logAudit(req.user.id, req.user.display_name, 'clouddrive.upload', 'clouddrive', id, fileName);
      res.json({ success: true, file: { id, ...record } });
    } catch (e) { res.status(500).json({ error: '保存文件记录失败: ' + e.message }); }
  });
});

// GET /api/clouddrive/download/:id - 涓嬭浇
router.get('/download/:id', authMiddleware, (req, res) => {
  try {
    const all = parseRecords();
    const item = all.find(i => i.id === req.params.id);
    if (!item) return res.status(404).json({ error: '文件不存在' });
    if (item.kind === 'folder') return res.status(400).json({ error: '文件夹不能直接下载' });
    const filePath = resolveCloudFilePath(item);
    if (!filePath) return res.status(404).json({ error: '文件已丢失' });
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(item.fileName)}`);
    res.setHeader('Content-Type', item.mimeType || 'application/octet-stream');
    res.sendFile(filePath);
  } catch (e) { res.status(500).json({ error: '下载失败: ' + e.message }); }
});

// DELETE /api/clouddrive/:id - 绉诲叆鍥炴敹绔欙紙杞垹闄わ級
router.get('/preview/:id', authMiddleware, async (req, res) => {
  try {
    const all = parseRecords();
    const item = all.find(i => i.id === req.params.id);
    if (!item) return res.status(404).json({ error: '文件不存在' });
    if (item.deletedAt) return res.status(410).json({ error: '回收站文件暂不支持预览' });
    if (!isOfficeFile(item)) return res.status(415).json({ error: '该文件类型不需要转换预览' });

    const sourcePath = resolveCloudFilePath(item);
    if (!sourcePath) return res.status(404).json({ error: '文件已丢失' });

    const sourceBase = path.basename(item.storedName, path.extname(item.storedName));
    let convertedPath = path.join(CLOUD_PREVIEW_DIR, `${sourceBase}.pdf`);
    const cacheReady = fs.existsSync(convertedPath);

    if (!cacheReady) {
      const startedAtMs = Date.now();
      await convertOfficeToPdf(sourcePath, CLOUD_PREVIEW_DIR);
      convertedPath = findConvertedPdf(sourcePath, convertedPath, startedAtMs);
      if (!convertedPath) {
        return res.status(500).json({ error: 'Office 转换完成，但没有生成 PDF 文件' });
      }
    }

    if (!fs.existsSync(convertedPath)) return res.status(404).json({ error: '预览文件不存在' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(item.fileName.replace(/\.[^.]+$/, '.pdf'))}`);
    const stream = fs.createReadStream(convertedPath);
    stream.on('error', () => {
      if (!res.headersSent) res.status(500).json({ error: '预览文件读取失败' });
      else res.destroy();
    });
    stream.pipe(res);
  } catch (e) {
    res.status(500).json({ error: e.message || 'Office 预览失败' });
  }
});

router.delete('/:id', authMiddleware, requireRole('user', 'admin'), (req, res) => {
  try {
    const items = getActiveRecords();
    const item = items.find(i => i.id === req.params.id);
    if (!item) return res.status(404).json({ error: '文件不存在' });
    if (item.kind === 'folder' && items.some(child => String(child.parentId || '') === req.params.id)) {
      return res.status(409).json({ error: '请先清空文件夹中的内容' });
    }
    const db = getDbSync();
    const snapshot = sqlSnapshot(db, [{ table: 'clouddrive_files', mode: 'replace', sql: 'SELECT * FROM clouddrive_files WHERE id=?', params: [req.params.id] }]);
    item.deletedAt = now();
    saveRecord(req.params.id, item);
    logAudit(req.user.id, req.user.display_name, 'clouddrive.trash', 'clouddrive', req.params.id, item.fileName, snapshot);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: '删除失败: ' + e.message }); }
});

// POST /api/clouddrive/:id/restore - 浠庡洖鏀剁珯鎭㈠
router.post('/:id/restore', authMiddleware, requireRole('user', 'admin'), (req, res) => {
  try {
    const items = getTrashRecords();
    const item = items.find(i => i.id === req.params.id);
    if (!item) return res.status(404).json({ error: '文件不在回收站中' });
    delete item.deletedAt;
    saveRecord(req.params.id, item);
    logAudit(req.user.id, req.user.display_name, 'clouddrive.restore', 'clouddrive', req.params.id, item.fileName);
    res.json({ success: true, file: item });
  } catch (e) { res.status(500).json({ error: '恢复失败: ' + e.message }); }
});

// DELETE /api/clouddrive/:id/permanent - 姘镐箙鍒犻櫎
router.delete('/:id/permanent', authMiddleware, requireRole('user', 'admin'), (req, res) => {
  try {
    const all = parseRecords();
    const item = all.find(i => i.id === req.params.id);
    if (!item) return res.status(404).json({ error: '文件不存在' });
    const db = getDbSync();
    const snapshot = sqlSnapshot(db, [{ table: 'clouddrive_files', sql: 'SELECT * FROM clouddrive_files WHERE id=?', params: [req.params.id] }]);
    hardDelete(req.params.id, item, true, true);
    logAudit(req.user.id, req.user.display_name, 'clouddrive.permanent', 'clouddrive', req.params.id, item.fileName, snapshot);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: '删除失败: ' + e.message }); }
});

router.post('/:id/share', authMiddleware, (req, res) => {
  try {
    const item = parseRecords().find(candidate => candidate.id === req.params.id && !candidate.deletedAt);
    if (!item) return res.status(404).json({ error: '文件不存在' });
    if (item.kind === 'folder') return res.status(400).json({ error: '文件夹不能分享下载' });
    if (!resolveCloudFilePath(item)) return res.status(404).json({ error: '文件已丢失' });
    const token = createShare('clouddrive', item.id, '', req.user.id);
    logAudit(req.user.id, req.user.display_name, 'clouddrive.share', 'clouddrive', item.id, item.fileName);
    res.json({ url: `/api/clouddrive/shared/${token}` });
  } catch (e) {
    res.status(500).json({ error: '生成分享链接失败: ' + e.message });
  }
});

router.get('/shared/:token', (req, res) => {
  try {
    const share = findShare(req.params.token, 'clouddrive');
    if (!share) return res.status(404).json({ error: '分享链接无效' });
    const item = parseRecords().find(candidate => candidate.id === share.resource_id && !candidate.deletedAt);
    if (!item || item.kind === 'folder') return res.status(410).json({ error: '分享文件已失效' });
    const filePath = resolveCloudFilePath(item);
    if (!filePath) return res.status(410).json({ error: '分享文件已失效' });
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(item.fileName)}`);
    res.setHeader('Content-Type', item.mimeType || 'application/octet-stream');
    res.sendFile(filePath);
  } catch (e) {
    res.status(500).json({ error: '下载失败: ' + e.message });
  }
});

// PUT /api/clouddrive/:id/move - 移动到指定文件夹
router.put('/:id/move', authMiddleware, requireRole('user', 'admin'), (req, res) => {
  try {
    const targetParentId = typeof req.body?.parentId === 'string' ? req.body.parentId.trim() : '';
    const all = parseRecords();
    const item = all.find(record => record.id === req.params.id);
    if (!item) return res.status(404).json({ error: '文件不存在' });
    if (item.deletedAt) return res.status(409).json({ error: '回收站中的文件不能移动，请先恢复文件' });
    if (targetParentId === req.params.id) return res.status(400).json({ error: '不能移动到自身' });

    if (targetParentId) {
      const target = all.find(record => record.id === targetParentId && !record.deletedAt);
      if (!target || target.kind !== 'folder') return res.status(404).json({ error: '目标文件夹不存在' });

      if (item.kind === 'folder') {
        let cursor = target;
        const visited = new Set();
        while (cursor && !visited.has(cursor.id)) {
          if (cursor.id === req.params.id) return res.status(400).json({ error: '不能把文件夹移动到它的子文件夹中' });
          visited.add(cursor.id);
          cursor = all.find(record => record.id === String(cursor.parentId || '') && !record.deletedAt);
        }
      }
    }

    if (String(item.parentId || '') === targetParentId) {
      return res.json({ success: true, file: { id: req.params.id, ...item } });
    }

    const duplicate = all.some(record =>
      record.id !== req.params.id
      && !record.deletedAt
      && String(record.parentId || '') === targetParentId
      && String(record.fileName || '').localeCompare(String(item.fileName || ''), 'zh-CN', { sensitivity: 'base' }) === 0
    );
    if (duplicate) return res.status(409).json({ error: '目标文件夹中已存在同名文件' });

    const previousParentId = String(item.parentId || '');
    item.parentId = targetParentId;
    item.updatedAt = now();
    item.movedAt = item.updatedAt;
    item.movedBy = req.user.display_name;
    saveRecord(req.params.id, item);
    logAudit(req.user.id, req.user.display_name, 'clouddrive.move', 'clouddrive', req.params.id, `移动：${previousParentId || '根目录'} → ${targetParentId || '根目录'}`);
    res.json({ success: true, file: { id: req.params.id, ...item } });
  } catch (e) { res.status(500).json({ error: '移动失败: ' + e.message }); }
});

// PUT /api/clouddrive/:id/name - 在线重命名
router.put('/:id/name', authMiddleware, requireRole('user', 'admin'), (req, res) => {
  try {
    const requestedName = typeof req.body?.fileName === 'string' ? req.body.fileName.trim() : '';
    const validation = validateCloudFileName(requestedName);
    if (!validation.ok) return res.status(400).json({ error: validation.error });

    const all = parseRecords();
    const item = all.find(record => record.id === req.params.id);
    if (!item) return res.status(404).json({ error: '文件不存在' });
    if (item.deletedAt) return res.status(409).json({ error: '回收站中的文件不能重命名，请先恢复文件' });
    if (item.kind !== 'folder' && path.extname(requestedName).toLowerCase() !== path.extname(item.fileName || '').toLowerCase()) {
      return res.status(400).json({ error: '重命名不能修改文件扩展名' });
    }

    const duplicate = all.some(record =>
      record.id !== req.params.id
      && !record.deletedAt
      && String(record.parentId || '') === String(item.parentId || '')
      && String(record.fileName || '').localeCompare(requestedName, 'zh-CN', { sensitivity: 'base' }) === 0
    );
    if (duplicate) return res.status(409).json({ error: '云盘中已存在同名文件' });

    const previousName = item.fileName;
    if (previousName === requestedName) return res.json({ success: true, file: { id: req.params.id, ...item } });

    item.fileName = requestedName;
    item.renamedAt = now();
    item.renamedBy = req.user.display_name;
    saveRecord(req.params.id, item);
    logAudit(req.user.id, req.user.display_name, 'clouddrive.rename', 'clouddrive', req.params.id, `重命名：${previousName} → ${requestedName}`);
    res.json({ success: true, file: { id: req.params.id, ...item } });
  } catch (e) { res.status(500).json({ error: '重命名失败: ' + e.message }); }
});

// PUT /api/clouddrive/:id/remark - 淇敼澶囨敞
router.put('/:id/remark', authMiddleware, requireRole('user', 'admin'), (req, res) => {
  try {
    const { remark } = req.body;
    if (typeof remark !== 'string') return res.status(400).json({ error: '缺少备注内容' });
    const all = parseRecords();
    const item = all.find(i => i.id === req.params.id);
    if (!item) return res.status(404).json({ error: '文件不存在' });
    item.remark = remark;
    item.remarkUpdatedBy = req.user.display_name;
    item.remarkUpdatedAt = now();
    saveRecord(req.params.id, item);
    logAudit(req.user.id, req.user.display_name, 'clouddrive.remark', 'clouddrive', req.params.id, '更新备注: ' + remark.substring(0, 50));
    res.json({ success: true, file: item });
  } catch (e) { res.status(500).json({ error: '更新备注失败: ' + e.message }); }
});

module.exports = router;
module.exports.purgeExpiredTrash = purgeExpiredTrash;
