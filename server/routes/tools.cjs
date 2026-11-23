const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const zlib = require('zlib');
const multer = require('multer');
const { getDbSync, saveDbImmediate } = require('../db.cjs');
const { authMiddleware, requireRole, queryOne } = require('../middleware/auth.cjs');
const { createRateLimiter } = require('../middleware/rateLimit.cjs');
const { logAudit } = require('../services/audit.cjs');
const { TOOLS_ROOT_DIR, HTML_TOOLS_DIR, SKILLS_DIR } = require('../paths.cjs');
const { createShare, findShare } = require('../services/fileShares.cjs');

const router = express.Router();
const now = () => new Date().toISOString();
const uploadRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 30,
  keyGenerator: req => req.user?.id || req.ip,
  message: '工具上传过于频繁，请稍后再试',
});
const VALID_TYPES = new Set(['html_tool', 'skill']);
const ACTIVE_STATUSES = new Set(['active']);
const TOOL_UPLOAD_LIMIT = 8 * 1024 * 1024;
const LEGACY_HTML_TOOLS_DIR = path.join(__dirname, '..', '..', 'data', 'tools', 'html');
const LEGACY_SKILLS_DIR = path.join(__dirname, '..', '..', 'data', 'tools', 'skills');

for (const dir of [TOOLS_ROOT_DIR, HTML_TOOLS_DIR, SKILLS_DIR, path.join(TOOLS_ROOT_DIR, '.tmp')]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const upload = multer({
  dest: path.join(TOOLS_ROOT_DIR, '.tmp'),
  limits: {
    fileSize: TOOL_UPLOAD_LIMIT,
    files: 1,
    fields: 5,
    fieldSize: 32 * 1024,
    parts: 8,
  },
});

function id(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function queryAll(db, sql, params = []) {
  const rows = [];
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    while (stmt.step()) rows.push(stmt.getAsObject());
  } finally {
    stmt.free();
  }
  return rows;
}

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function canManage(req, item) {
  return req.user.role === 'admin' || item.created_by === req.user.id;
}

function canSee(req, item) {
  if (!item || item.status === 'deleted') return false;
  if (ACTIVE_STATUSES.has(item.status)) return true;
  return canManage(req, item);
}

function getItem(db, itemId) {
  return queryOne(db, 'SELECT * FROM tool_items WHERE id = ?', [itemId]);
}

function getVersion(db, versionId) {
  return queryOne(db, 'SELECT * FROM tool_versions WHERE id = ?', [versionId]);
}

function getVersions(db, itemId) {
  return queryAll(db, 'SELECT * FROM tool_versions WHERE item_id = ? ORDER BY version_no DESC', [itemId]);
}

function getCurrentVersion(db, item) {
  if (!item || !item.current_version_id) return null;
  return getVersion(db, item.current_version_id);
}

function toPublicItem(req, item, versions = undefined) {
  const currentVersion = versions
    ? versions.find(v => v.id === item.current_version_id) || versions[0] || null
    : null;
  const latest = currentVersion || {};
  const versionNo = asNumber(latest.version_no);
  return {
    id: item.id,
    type: item.type,
    name: item.name,
    description: item.description || '',
    category: item.category || '',
    status: item.status,
    visibility: item.visibility,
    currentVersionId: item.current_version_id || '',
    currentVersionNo: versionNo,
    currentVersionLabel: latest.version_label || (versionNo ? `v${versionNo}` : ''),
    createdBy: item.created_by,
    createdByName: item.created_by_name || '',
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    uploadedAt: latest.uploaded_at || '',
    uploadedByName: latest.uploaded_by_name || '',
    fileName: latest.file_name || '',
    fileSize: asNumber(latest.file_size),
    changelog: latest.changelog || '',
    viewCount: asNumber(item.view_count),
    canManage: canManage(req, item),
    openUrl: item.type === 'html_tool' && versionNo ? `/tools-host/${item.id}/current/index.html` : '',
    versions: versions ? versions.map(v => ({
      id: v.id,
      versionNo: asNumber(v.version_no),
      versionLabel: v.version_label || `v${v.version_no}`,
      fileName: v.file_name,
      fileSize: asNumber(v.file_size),
      changelog: v.changelog || '',
      uploadedByName: v.uploaded_by_name || '',
      uploadedAt: v.uploaded_at,
    })) : undefined,
  };
}

function validateUpload(type, file) {
  if (!VALID_TYPES.has(type)) return '无效的类型';
  if (!file) return '缺少上传文件';
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (type === 'html_tool' && ext !== '.html') return 'HTML 工具只支持 .html 文件';
  if (type === 'skill' && !['.md', '.zip', '.skill'].includes(ext)) return 'Skill 支持上传 SKILL.md、zip 或 .skill 文件';
  if (type === 'skill' && ext === '.md' && path.basename(file.originalname || '').toLowerCase() !== 'skill.md') {
    return 'Skill Markdown 文件名必须为 SKILL.md';
  }
  if (type === 'html_tool') {
    const source = fs.readFileSync(file.path, 'utf8');
    if (source.includes('\0') || !/<(?:!doctype\s+html|html)[\s>]/i.test(source)) {
      return '上传内容不是有效的 HTML 页面';
    }
  }
  if (type === 'skill' && ext === '.md') {
    const source = fs.readFileSync(file.path, 'utf8');
    if (source.includes('\0') || !source.trim()) return 'SKILL.md 内容无效';
  }
  if (type === 'skill' && ['.zip', '.skill'].includes(ext) && !isZipFile(file.path)) {
    return 'Skill 压缩包格式无效';
  }
  return '';
}

function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function getVersionDir(type, itemId, versionNo) {
  const base = type === 'html_tool' ? HTML_TOOLS_DIR : SKILLS_DIR;
  return path.join(base, itemId, `v${versionNo}`);
}

function getLegacyVersionDir(type, itemId, versionNo) {
  const base = type === 'html_tool' ? LEGACY_HTML_TOOLS_DIR : LEGACY_SKILLS_DIR;
  return path.join(base, itemId, `v${versionNo}`);
}

function resolveVersionFilePath(item, version) {
  if (!version) return '';
  if (version.stored_path && fs.existsSync(version.stored_path)) return version.stored_path;

  const versionNo = asNumber(version.version_no);
  const storedName = version.stored_name || (item.type === 'html_tool' ? 'index.html' : version.file_name);
  const candidates = [
    path.join(getVersionDir(item.type, item.id, versionNo), storedName),
    path.join(getLegacyVersionDir(item.type, item.id, versionNo), storedName),
  ];
  return candidates.find(candidate => candidate && fs.existsSync(candidate)) || '';
}

function storeUploadedFile(type, itemId, versionNo, file) {
  const versionDir = getVersionDir(type, itemId, versionNo);
  if (!fs.existsSync(versionDir)) fs.mkdirSync(versionDir, { recursive: true });
  const ext = path.extname(file.originalname || '').toLowerCase();
  const storedName = type === 'html_tool' ? 'index.html' : (ext === '.zip' ? 'package.zip' : (ext === '.skill' ? 'package.skill' : 'SKILL.md'));
  const targetPath = path.join(versionDir, storedName);
  fs.renameSync(file.path, targetPath);
  return { storedName, targetPath };
}

function cleanupTemp(file) {
  if (file?.path && fs.existsSync(file.path)) {
    try { fs.unlinkSync(file.path); } catch (_) {}
  }
}

function createVersion({ db, itemId, type, file, changelog, user }) {
  const latest = queryOne(db, 'SELECT MAX(version_no) AS max_no FROM tool_versions WHERE item_id = ?', [itemId]);
  const versionNo = asNumber(latest?.max_no) + 1;
  const versionId = id('ver');
  const checksum = hashFile(file.path);
  const stored = storeUploadedFile(type, itemId, versionNo, file);
  db.run(
    `INSERT INTO tool_versions (
      id, item_id, version_no, version_label, file_name, stored_name, stored_path,
      file_size, mime_type, checksum, changelog, uploaded_by, uploaded_by_name, uploaded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      versionId,
      itemId,
      versionNo,
      `v${versionNo}`,
      file.originalname || stored.storedName,
      stored.storedName,
      stored.targetPath,
      file.size || 0,
      file.mimetype || '',
      checksum,
      changelog || '',
      user.id,
      user.display_name || '',
      now(),
    ]
  );
  return { versionId, versionNo };
}

function readSkillMarkdownFromZip(zipPath) {
  const buffer = fs.readFileSync(zipPath);
  const eocdSig = 0x06054b50;
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 66000); i -= 1) {
    if (buffer.readUInt32LE(i) === eocdSig) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return '';

  const entryCount = buffer.readUInt16LE(eocd + 10);
  const centralDirOffset = buffer.readUInt32LE(eocd + 16);
  let offset = centralDirOffset;

  for (let i = 0; i < entryCount && offset + 46 <= buffer.length; i += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const compression = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const fileName = buffer.toString('utf8', offset + 46, offset + 46 + fileNameLength).replace(/\\/g, '/');
    const isSkillMd = fileName.split('/').pop()?.toLowerCase() === 'skill.md';

    if (isSkillMd) {
      if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) return '';
      const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
      const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
      if (compression === 0) return compressed.toString('utf8');
      if (compression === 8) {
        return zlib.inflateRawSync(compressed, { maxOutputLength: 1024 * 1024 }).toString('utf8');
      }
      return '暂不支持预览该压缩格式';
    }

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return '';
}

function isZipFile(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const header = Buffer.alloc(4);
    fs.readSync(fd, header, 0, 4, 0);
    fs.closeSync(fd);
    return header.readUInt32LE(0) === 0x04034b50;
  } catch {
    return false;
  }
}

router.get('/', authMiddleware, (req, res) => {
  try {
    const type = req.query.type;
    const db = getDbSync();
    const params = [];
    let sql = 'SELECT * FROM tool_items WHERE status != ?';
    params.push('deleted');
    if (type && VALID_TYPES.has(type)) {
      sql += ' AND type = ?';
      params.push(type);
    }
    sql += ' ORDER BY updated_at DESC';
    const items = queryAll(db, sql, params).filter(item => canSee(req, item));
    const result = items.map(item => toPublicItem(req, item, getVersions(db, item.id)));
    res.json({ items: result });
  } catch (e) {
    res.status(500).json({ error: '鑾峰彇宸ュ叿鍒楄〃澶辫触: ' + e.message });
  }
});

router.get('/:id', authMiddleware, (req, res) => {
  try {
    const db = getDbSync();
    const item = getItem(db, req.params.id);
    if (!canSee(req, item)) return res.status(404).json({ error: '内容不存在' });
    res.json({ item: toPublicItem(req, item, getVersions(db, item.id)) });
  } catch (e) {
    res.status(500).json({ error: '鑾峰彇璇︽儏澶辫触: ' + e.message });
  }
});

router.post('/upload', authMiddleware, requireRole('user', 'admin'), uploadRateLimiter, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: '文件大小超过限制，最大 8MB' });
      }
      return res.status(400).json({ error: '上传失败: ' + err.message });
    }

    const type = req.body.type;
    const validationError = validateUpload(type, req.file);
    if (validationError) {
      cleanupTemp(req.file);
      return res.status(400).json({ error: validationError });
    }

    try {
      const db = getDbSync();
      const itemId = id(type === 'html_tool' ? 'tool' : 'skill');
      const timestamp = now();
      const status = type === 'skill' && req.user.role !== 'admin' ? 'draft' : 'active';
      const version = createVersion({
        db,
        itemId,
        type,
        file: req.file,
        changelog: req.body.changelog || '首次上传',
        user: req.user,
      });
      db.run(
        `INSERT INTO tool_items (
          id, type, name, description, category, status, visibility, current_version_id,
          created_by, created_by_name, created_at, updated_at, view_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          itemId,
          type,
          String(req.body.name || req.file.originalname || '').trim() || (type === 'html_tool' ? '未命名工具' : '未命名 Skill'),
          String(req.body.description || '').trim(),
          String(req.body.category || '').trim(),
          status,
          'internal',
          version.versionId,
          req.user.id,
          req.user.display_name || '',
          timestamp,
          timestamp,
          0,
        ]
      );
      saveDbImmediate();
      logAudit(req.user.id, req.user.display_name, type === 'html_tool' ? 'tool.upload' : 'skill.upload', 'tool_center', itemId, req.body.name || req.file.originalname);
      const item = getItem(db, itemId);
      res.json({ success: true, item: toPublicItem(req, item, getVersions(db, itemId)) });
    } catch (e) {
      cleanupTemp(req.file);
      res.status(500).json({ error: '保存上传内容失败: ' + e.message });
    }
  });
});

router.post('/:id/version', authMiddleware, requireRole('user', 'admin'), uploadRateLimiter, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: '鏂囦欢澶у皬瓒呰繃闄愬埗锛屾渶澶?8MB' });
      }
      return res.status(400).json({ error: '上传失败: ' + err.message });
    }

    try {
      const db = getDbSync();
      const item = getItem(db, req.params.id);
      if (!item || item.status === 'deleted') {
        cleanupTemp(req.file);
        return res.status(404).json({ error: '内容不存在' });
      }
      if (!canManage(req, item)) {
        cleanupTemp(req.file);
        return res.status(403).json({ error: '只有上传者或高级用户可以更新' });
      }
      const validationError = validateUpload(item.type, req.file);
      if (validationError) {
        cleanupTemp(req.file);
        return res.status(400).json({ error: validationError });
      }
      const version = createVersion({
        db,
        itemId: item.id,
        type: item.type,
        file: req.file,
        changelog: req.body.changelog || '',
        user: req.user,
      });
      db.run('UPDATE tool_items SET current_version_id = ?, updated_at = ? WHERE id = ?', [version.versionId, now(), item.id]);
      saveDbImmediate();
      logAudit(req.user.id, req.user.display_name, item.type === 'html_tool' ? 'tool.update' : 'skill.update', 'tool_center', item.id, `${item.name} ${version.versionNo}`);
      const nextItem = getItem(db, item.id);
      res.json({ success: true, item: toPublicItem(req, nextItem, getVersions(db, item.id)) });
    } catch (e) {
      cleanupTemp(req.file);
      res.status(500).json({ error: '更新版本失败: ' + e.message });
    }
  });
});

router.put('/:id', authMiddleware, requireRole('user', 'admin'), (req, res) => {
  try {
    const db = getDbSync();
    const item = getItem(db, req.params.id);
    if (!item || item.status === 'deleted') return res.status(404).json({ error: '内容不存在' });
    if (!canManage(req, item)) return res.status(403).json({ error: '只有上传者或高级用户可以修改' });
    db.run(
      'UPDATE tool_items SET name = ?, description = ?, category = ?, updated_at = ? WHERE id = ?',
      [
        String(req.body.name || item.name).trim(),
        String(req.body.description || '').trim(),
        String(req.body.category || '').trim(),
        now(),
        item.id,
      ]
    );
    saveDbImmediate();
    const nextItem = getItem(db, item.id);
    res.json({ success: true, item: toPublicItem(req, nextItem, getVersions(db, item.id)) });
  } catch (e) {
    res.status(500).json({ error: '保存信息失败: ' + e.message });
  }
});

router.post('/:id/enable', authMiddleware, requireRole('user', 'admin'), (req, res) => {
  changeStatus(req, res, 'active');
});

router.post('/:id/disable', authMiddleware, requireRole('user', 'admin'), (req, res) => {
  changeStatus(req, res, 'disabled');
});

router.delete('/:id', authMiddleware, requireRole('user', 'admin'), (req, res) => {
  changeStatus(req, res, 'deleted');
});

function changeStatus(req, res, status) {
  try {
    const db = getDbSync();
    const item = getItem(db, req.params.id);
    if (!item || item.status === 'deleted') return res.status(404).json({ error: '内容不存在' });
    if (!canManage(req, item)) return res.status(403).json({ error: '只有上传者或高级用户可以操作' });
    db.run('UPDATE tool_items SET status = ?, updated_at = ? WHERE id = ?', [status, now(), item.id]);
    saveDbImmediate();
    const actionPrefix = item.type === 'html_tool' ? 'tool' : 'skill';
    const action = status === 'active' ? `${actionPrefix}.enable` : status === 'disabled' ? `${actionPrefix}.disable` : `${actionPrefix}.delete`;
    logAudit(req.user.id, req.user.display_name, action, 'tool_center', item.id, item.name);
    const nextItem = getItem(db, item.id);
    res.json({ success: true, item: toPublicItem(req, nextItem, getVersions(db, item.id)) });
  } catch (e) {
    res.status(500).json({ error: '状态更新失败: ' + e.message });
  }
}

router.get('/:id/download', authMiddleware, (req, res) => {
  sendVersionFile(req, res);
});

router.post('/:id/share', authMiddleware, (req, res) => {
  try {
    const db = getDbSync();
    const item = getItem(db, req.params.id);
    if (!canSee(req, item) || item.type !== 'skill') return res.status(404).json({ error: 'Skill 不存在' });
    const version = getCurrentVersion(db, item);
    if (!version || !resolveVersionFilePath(item, version)) return res.status(404).json({ error: '文件已丢失' });
    const token = createShare('skill', item.id, version.id, req.user.id);
    logAudit(req.user.id, req.user.display_name, 'skill.share', 'tool_center', item.id, item.name);
    res.json({ url: `/api/tools/shared/${token}` });
  } catch (e) {
    res.status(500).json({ error: '生成分享链接失败: ' + e.message });
  }
});

router.get('/shared/:token', (req, res) => {
  try {
    const share = findShare(req.params.token, 'skill');
    if (!share) return res.status(404).json({ error: '分享链接无效' });
    const db = getDbSync();
    const item = getItem(db, share.resource_id);
    if (!item || item.type !== 'skill' || item.status !== 'active') return res.status(410).json({ error: '分享文件已失效' });
    const version = getVersion(db, share.version_id);
    const filePath = version?.item_id === item.id ? resolveVersionFilePath(item, version) : '';
    if (!filePath) return res.status(410).json({ error: '分享文件已失效' });
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(version.file_name)}`);
    res.setHeader('Content-Type', version.mime_type || 'application/octet-stream');
    res.sendFile(filePath);
  } catch (e) {
    res.status(500).json({ error: '下载失败: ' + e.message });
  }
});

router.get('/:id/versions/:versionId/download', authMiddleware, (req, res) => {
  sendVersionFile(req, res, req.params.versionId);
});

function sendVersionFile(req, res, versionId = '') {
  try {
    const db = getDbSync();
    const item = getItem(db, req.params.id);
    if (!canSee(req, item)) return res.status(404).json({ error: '内容不存在' });
    const version = versionId ? getVersion(db, versionId) : getCurrentVersion(db, item);
    if (!version || version.item_id !== item.id) return res.status(404).json({ error: '版本不存在' });
    const filePath = resolveVersionFilePath(item, version);
    if (!filePath) return res.status(404).json({ error: '文件已丢失' });
    const action = item.type === 'html_tool' ? 'tool.download' : 'skill.download';
    logAudit(req.user.id, req.user.display_name, action, 'tool_center', item.id, version.file_name);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(version.file_name)}`);
    res.setHeader('Content-Type', version.mime_type || 'application/octet-stream');
    res.sendFile(filePath);
  } catch (e) {
    res.status(500).json({ error: '下载失败: ' + e.message });
  }
}

router.get('/:id/skill-preview', authMiddleware, (req, res) => {
  try {
    const db = getDbSync();
    const item = getItem(db, req.params.id);
    if (!canSee(req, item) || item.type !== 'skill') return res.status(404).json({ error: 'Skill 不存在' });
    const version = getCurrentVersion(db, item);
    const filePath = resolveVersionFilePath(item, version);
    if (!version || !filePath) return res.status(404).json({ error: '文件已丢失' });
    const ext = path.extname(filePath).toLowerCase();
    if (['.zip', '.skill'].includes(ext) && isZipFile(filePath)) {
      const content = readSkillMarkdownFromZip(filePath);
      return res.json({ content: content ? content.slice(0, 300000) : '未找到 SKILL.md。' });
    }
    const text = fs.readFileSync(filePath, 'utf8');
    res.json({ content: text.slice(0, 300000) });
  } catch (e) {
    res.status(500).json({ error: '读取 Skill 失败: ' + e.message });
  }
});

module.exports = router;
