const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { getDb, saveDb, saveDbImmediate } = require('../db.cjs');
const { authMiddleware, requireRole, queryOne } = require('../middleware/auth.cjs');
const { logAudit, sqlSnapshot } = require('../services/audit.cjs');
const { notifyTaskCreated } = require('../services/feishuNotifications.cjs');
const { notifyTaskCreatedByEmail, notifyTaskMentionByEmail } = require('../services/emailNotifications.cjs');
const { createTaskNotification, createTaskMentionNotification } = require('../services/notifications.cjs');
const { TASK_ATTACHMENTS_DIR } = require('../paths.cjs');
const { MAX_CLOUD_FILE_BYTES, validateCloudFileName } = require('../services/uploadValidation.cjs');

const router = express.Router();
fs.mkdirSync(TASK_ATTACHMENTS_DIR, { recursive: true });
const attachmentUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, TASK_ATTACHMENTS_DIR),
    filename: (_req, file, callback) => callback(null, `${crypto.randomUUID().replaceAll('-', '')}${path.extname(file.originalname).toLowerCase().slice(0, 16)}`),
  }),
  limits: { fileSize: MAX_CLOUD_FILE_BYTES, files: 10, fields: 1, parts: 11 },
  fileFilter(_req, file, callback) {
    const validation = validateCloudFileName(file.originalname);
    if (!validation.ok) return callback(Object.assign(new Error(validation.error), { statusCode: 400 }));
    callback(null, true);
  },
});
const now = () => new Date().toISOString();
const validStatuses = new Set(['todo', 'in_progress', 'waiting', 'done', 'cancelled']);
const validPriorities = new Set(['low', 'normal', 'high', 'urgent']);
const validOwnershipTypes = new Set(['self_developed', 'business_center']);
const validBusinessRegions = new Set(['east', 'central', 'west', 'north', 'south']);
const validItemTypes = new Set(['task', 'reminder']);

function makeId(prefix) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
}

function normalizeRecipientIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(id => String(id || '').trim()).filter(Boolean))];
}

function resolveRecipients(db, value) {
  const ids = normalizeRecipientIds(value);
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  const result = db.exec(`SELECT id,display_name,email FROM users WHERE status='active' AND id IN (${placeholders})`, ids);
  const rows = result[0]?.values || [];
  const byId = new Map(rows.map(row => [row[0], { name: row[1], email: row[2] || '' }]));
  return ids.filter(id => byId.has(id)).map(id => ({ id, ...byId.get(id) }));
}

function replaceRecipients(db, taskId, recipients) {
  db.run('DELETE FROM task_recipients WHERE task_id=?', [taskId]);
  recipients.forEach(recipient => db.run(
    'INSERT INTO task_recipients(task_id,user_id,created_at) VALUES(?,?,?)',
    [taskId, recipient.id, now()],
  ));
}

function canEditTask(userId, task) {
  return task.createdById === userId
    || task.assignedToId === userId
    || normalizeRecipientIds(task.recipientIds).includes(userId);
}

function normalizeClassification(task) {
  const ownershipType = validOwnershipTypes.has(task.ownershipType) ? task.ownershipType : 'self_developed';
  const businessRegion = ownershipType === 'business_center' ? String(task.businessRegion || '') : '';
  if (ownershipType === 'business_center' && !validBusinessRegions.has(businessRegion)) return null;
  return { ownershipType, businessRegion };
}

function normalizeTaskForRead(value, commentCount = 0) {
  const task = typeof value === 'string' ? JSON.parse(value) : value;
  const classification = normalizeClassification(task) || { ownershipType: 'self_developed', businessRegion: '' };
  return {
    ...task,
    ...classification,
    itemType: validItemTypes.has(task.itemType) ? task.itemType : 'task',
    remark: String(task.remark || ''),
    attachments: Array.isArray(task.attachments) ? task.attachments.map(item => ({ id: item.id, fileName: item.fileName, fileSize: item.fileSize, mimeType: item.mimeType, uploadedAt: item.uploadedAt })) : [],
    commentCount: Number(commentCount) || 0,
  };
}

function extractTaskRecommendation(content) {
  const text = String(content || '');
  const match = text.match(/【\s*(中性偏推荐|中性偏谨慎|推荐|中性|谨慎)(?=\s*[，,、；;：:]|\s*】)/);
  return match?.[1] || '';
}

router.post('/:id/attachments', authMiddleware, requireRole('user', 'admin'), (req, res) => {
  attachmentUpload.array('files', 10)(req, res, async error => {
    if (error) return res.status(error.statusCode || (error.code === 'LIMIT_FILE_SIZE' ? 413 : 400)).json({ error: error.code === 'LIMIT_FILE_SIZE' ? '单个附件不能超过 100MB' : error.message || '附件上传失败' });
    const files = req.files || [];
    try {
      const db = await getDb();
      const row = queryOne(db, 'SELECT data FROM tasks WHERE id=?', [req.params.id]);
      if (!row) throw Object.assign(new Error('任务不存在'), { statusCode: 404 });
      const task = JSON.parse(row.data);
      if (!canEditTask(req.user.id, task)) throw Object.assign(new Error('只有任务创建人或协作人员可以上传附件'), { statusCode: 403 });
      const existing = Array.isArray(task.attachments) ? task.attachments : [];
      if (existing.length + files.length > 10) throw Object.assign(new Error('每个任务最多上传 10 个附件'), { statusCode: 400 });
      const uploadedAt = now();
      const added = files.map(file => ({ id: makeId('attachment'), fileName: file.originalname, storedName: file.filename, fileSize: file.size, mimeType: file.mimetype || 'application/octet-stream', uploadedAt }));
      task.attachments = [...existing, ...added];
      task.updatedAt = uploadedAt;
      db.run('UPDATE tasks SET data=?,updated_at=? WHERE id=?', [JSON.stringify(task), uploadedAt, req.params.id]);
      saveDbImmediate();
      logAudit(req.user.id, req.user.display_name, 'task.attachment.upload', 'task', req.params.id, added.map(item => item.fileName).join(', '));
      res.status(201).json({ attachments: added.map(({ storedName, ...item }) => item) });
    } catch (uploadError) {
      files.forEach(file => { try { fs.unlinkSync(file.path); } catch (_) {} });
      res.status(uploadError.statusCode || 500).json({ error: uploadError.message || '附件上传失败' });
    }
  });
});

router.get('/:id/attachments/:attachmentId', authMiddleware, async (req, res) => {
  const db = await getDb();
  const row = queryOne(db, 'SELECT data FROM tasks WHERE id=?', [req.params.id]);
  if (!row) return res.status(404).json({ error: '任务不存在' });
  const task = JSON.parse(row.data);
  const attachment = (Array.isArray(task.attachments) ? task.attachments : []).find(item => item.id === req.params.attachmentId);
  if (!attachment) return res.status(404).json({ error: '附件不存在' });
  const filePath = path.join(TASK_ATTACHMENTS_DIR, path.basename(attachment.storedName || ''));
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '附件文件不存在' });
  res.download(filePath, attachment.fileName);
});

function taskPayload(task, base, req, recipients) {
  const classification = normalizeClassification(task);
  if (!classification) return null;
  return {
    ...base,
    ...task,
    ...classification,
    id: base?.id || task.id,
    title: String(task.title || '').trim().slice(0, 200),
    description: String(task.description || '').trim().slice(0, 4000),
    remark: String(task.remark || '').trim().slice(0, 2000),
    itemType: validItemTypes.has(task.itemType) ? task.itemType : (validItemTypes.has(base?.itemType) ? base.itemType : 'task'),
    status: task.status || base?.status || 'todo',
    priority: task.priority || base?.priority || 'normal',
    assignedToId: task.assignedToId || base?.assignedToId || req.user.id,
    assignedToName: task.assignedToName || base?.assignedToName || req.user.display_name,
    recipientIds: recipients.map(item => item.id),
    recipientNames: recipients.map(item => item.name),
    createdById: base?.createdById || req.user.id,
    createdByName: base?.createdByName || req.user.display_name,
    createdAt: base?.createdAt || task.createdAt || now(),
    updatedAt: now(),
  };
}

router.get('/', authMiddleware, async (req, res) => {
  const db = await getDb();
  const conditions = [];
  const params = [];
  if (req.query.mine === 'true') {
    conditions.push('(assigned_to=? OR created_by=? OR EXISTS (SELECT 1 FROM task_recipients tr WHERE tr.task_id=tasks.id AND tr.user_id=?))');
    params.push(req.user.id, req.user.id, req.user.id);
  }
  if (req.query.projectId) { conditions.push('project_id=?'); params.push(req.query.projectId); }
  if (req.query.status) { conditions.push('status=?'); params.push(req.query.status); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = db.exec(`SELECT data,(SELECT COUNT(*) FROM task_comments tc WHERE tc.task_id=tasks.id AND tc.deleted_at IS NULL) AS comment_count FROM tasks ${where} ORDER BY CASE status WHEN 'done' THEN 1 WHEN 'cancelled' THEN 2 ELSE 0 END,due_at IS NULL,due_at,updated_at DESC`, params);
  const requestedType = String(req.query.type || '').trim();
  if (requestedType && !validItemTypes.has(requestedType)) return res.status(400).json({ error: '任务类型无效' });
  const recommendationRows = db.exec('SELECT task_id,content FROM task_comments WHERE deleted_at IS NULL ORDER BY created_at DESC,id DESC')[0]?.values || [];
  const recommendationsByTask = new Map();
  recommendationRows.forEach(row => {
    if (recommendationsByTask.has(row[0])) return;
    const recommendation = extractTaskRecommendation(row[1]);
    if (recommendation) recommendationsByTask.set(row[0], recommendation);
  });
  const tasks = (result[0]?.values || []).map(row => {
    const task = normalizeTaskForRead(row[0], row[1]);
    return { ...task, recommendation: recommendationsByTask.get(task.id) || '' };
  });
  res.json({ tasks: requestedType ? tasks.filter(task => task.itemType === requestedType) : tasks });
});

router.get('/search-index', authMiddleware, async (_req, res) => {
  const db = await getDb();
  const taskRows = db.exec(`SELECT data FROM tasks ORDER BY updated_at DESC`)[0]?.values || [];
  const commentRows = db.exec(`SELECT task_id,user_name,content,created_at FROM task_comments WHERE deleted_at IS NULL ORDER BY created_at DESC`)[0]?.values || [];
  const commentsByTask = new Map();
  commentRows.forEach(row => {
    const list = commentsByTask.get(row[0]) || [];
    list.push({ userName: row[1] || '', content: row[2] || '', createdAt: row[3] || '' });
    commentsByTask.set(row[0], list);
  });
  res.json({
    items: taskRows.map(row => {
      const task = normalizeTaskForRead(row[0]);
      return { ...task, comments: commentsByTask.get(task.id) || [] };
    }),
  });
});

router.post('/', authMiddleware, requireRole('user', 'admin'), async (req, res) => {
  const task = req.body.task;
  if (task?.itemType === 'reminder') return res.status(400).json({ error: '提醒请通过消息中心发送' });
  if (!task?.id || !String(task.title || '').trim()) return res.status(400).json({ error: '任务标题不能为空' });
  if (!validStatuses.has(task.status || 'todo') || !validPriorities.has(task.priority || 'normal')) return res.status(400).json({ error: '任务状态或优先级无效' });
  const db = await getDb();
  if (task.projectId && !queryOne(db, 'SELECT 1 AS found FROM products WHERE id=?', [task.projectId])) return res.status(400).json({ error: '关联项目不存在' });
  const recipientIds = normalizeRecipientIds(task.recipientIds);
  const recipients = resolveRecipients(db, recipientIds);
  if (recipients.length !== recipientIds.length) return res.status(400).json({ error: '关联人员不存在或账号未启用' });
  const data = taskPayload(task, null, req, recipients);
  if (!data) return res.status(400).json({ error: '请选择业务中心区域' });
  db.run('INSERT INTO tasks(id,data,created_by,assigned_to,project_id,status,due_at,updated_at) VALUES(?,?,?,?,?,?,?,?)', [data.id, JSON.stringify(data), req.user.id, data.assignedToId, data.projectId || '', data.status, data.dueAt || null, data.updatedAt]);
  replaceRecipients(db, data.id, recipients);
  if (data.itemType === 'task') createTaskNotification(db, data, { id: req.user.id, name: req.user.display_name }, 'created', data.title);
  saveDb();
  logAudit(req.user.id, req.user.display_name, 'task.create', 'task', data.id, data.title);
  res.status(201).json({ success: true, task: { ...data, commentCount: 0 } });

  void notifyTaskCreated(data, recipients).then(result => {
    if (result.enabled) logAudit(req.user.id, req.user.display_name, 'task.notify.feishu', 'task', data.id, `飞书通知：成功 ${result.sent}，未匹配 ${result.skipped}，失败 ${result.failures.length}`);
  }).catch(error => console.error('[feishu] 任务通知失败:', error.message));
  void notifyTaskCreatedByEmail(data, recipients).then(result => {
    if (result.enabled) logAudit(req.user.id, req.user.display_name, 'task.notify.email', 'task', data.id, `邮件通知：成功 ${result.sent}，跳过 ${result.skipped}，失败 ${result.failures.length}`);
  }).catch(error => console.error('[email] 任务通知失败:', error.message));
});

router.put('/:id', authMiddleware, requireRole('user', 'admin'), async (req, res) => {
  const db = await getDb();
  const row = queryOne(db, 'SELECT data FROM tasks WHERE id=?', [req.params.id]);
  if (!row) return res.status(404).json({ error: '任务不存在' });
  const old = JSON.parse(row.data);
  if (!canEditTask(req.user.id, old)) return res.status(403).json({ error: '仅任务负责人、创建人或协作人员可以修改任务信息' });
  const updates = req.body.task || {};
  const recipientIds = updates.recipientIds === undefined ? normalizeRecipientIds(old.recipientIds) : normalizeRecipientIds(updates.recipientIds);
  const recipients = resolveRecipients(db, recipientIds);
  if (recipients.length !== recipientIds.length) return res.status(400).json({ error: '关联人员不存在或账号未启用' });
  const assignedToId = String(updates.assignedToId === undefined ? old.assignedToId : updates.assignedToId || '').trim();
  const assignee = assignedToId ? queryOne(db, "SELECT id,display_name FROM users WHERE id=? AND status='active'", [assignedToId]) : null;
  if (!assignee) return res.status(400).json({ error: '请选择有效的任务负责人' });
  updates.assignedToId = assignee.id;
  updates.assignedToName = assignee.display_name;
  const next = taskPayload({ ...old, ...updates }, old, req, recipients);
  if (!next || !next.title || !validStatuses.has(next.status) || !validPriorities.has(next.priority)) return res.status(400).json({ error: '任务数据无效' });
  if (updates.recipientIds !== undefined) replaceRecipients(db, next.id, recipients);
  db.run('UPDATE tasks SET data=?,assigned_to=?,project_id=?,status=?,due_at=?,updated_at=? WHERE id=?', [JSON.stringify(next), next.assignedToId || '', next.projectId || '', next.status, next.dueAt || null, next.updatedAt, req.params.id]);
  if (next.itemType === 'task' && old.status !== next.status) createTaskNotification(db, next, { id: req.user.id, name: req.user.display_name }, 'status', `${next.title}：${old.status} → ${next.status}`);
  saveDb();
  logAudit(req.user.id, req.user.display_name, 'task.update', 'task', next.id, `${next.title}: ${next.status}`);
  res.json({ success: true, task: next });
});

router.get('/:id/comments', authMiddleware, async (req, res) => {
  const db = await getDb();
  if (!queryOne(db, 'SELECT 1 AS found FROM tasks WHERE id=?', [req.params.id])) return res.status(404).json({ error: '任务不存在' });
  const result = db.exec('SELECT id,user_id,user_name,content,mention_data,created_at,updated_at,deleted_at FROM task_comments WHERE task_id=? ORDER BY created_at ASC,id ASC', [req.params.id]);
  const comments = (result[0]?.values || []).map(row => {
    let mentions = [];
    try { mentions = JSON.parse(row[4] || '[]'); } catch { mentions = []; }
    return { id: row[0], userId: row[1], userName: row[2], content: row[7] ? '' : row[3], mentionIds: mentions.map(item => item.id), mentionNames: mentions.map(item => item.name), createdAt: row[5], updatedAt: row[6], deleted: Boolean(row[7]) };
  });
  res.json({ comments });
});

router.post('/:id/comments', authMiddleware, requireRole('user', 'admin'), async (req, res) => {
  const db = await getDb();
  const taskRow = queryOne(db, 'SELECT data FROM tasks WHERE id=?', [req.params.id]);
  if (!taskRow) return res.status(404).json({ error: '任务不存在' });
  const content = String(req.body?.content || '').trim().slice(0, 2000);
  if (!content) return res.status(400).json({ error: '留言内容不能为空' });
  const requestedMentionIds = normalizeRecipientIds(req.body?.mentionIds)
    .filter(id => id !== req.user.id)
    .slice(0, 20);
  const mentions = resolveRecipients(db, requestedMentionIds)
    .filter(person => content.includes(`@${person.name}`));
  const timestamp = now();
  const comment = { id: makeId('task_comment'), userId: req.user.id, userName: req.user.display_name || '', content, mentionIds: mentions.map(item => item.id), mentionNames: mentions.map(item => item.name), createdAt: timestamp, updatedAt: timestamp, deleted: false };
  db.run('INSERT INTO task_comments(id,task_id,user_id,user_name,content,mention_data,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)', [comment.id, req.params.id, comment.userId, comment.userName, comment.content, JSON.stringify(mentions.map(item => ({ id: item.id, name: item.name }))), timestamp, timestamp]);
  db.run('UPDATE tasks SET updated_at=? WHERE id=?', [timestamp, req.params.id]);
  const task = normalizeTaskForRead(taskRow.data);
  if (task.itemType === 'task') {
    const actor = { id: req.user.id, name: req.user.display_name };
    createTaskNotification(db, task, actor, 'comment', `${req.user.display_name} 回复了“${task.title}”：${content.slice(0, 160)}`, { excludeRecipientIds: comment.mentionIds });
    if (comment.mentionIds.length) createTaskMentionNotification(db, task, actor, comment, comment.mentionIds);
  }
  saveDbImmediate();
  logAudit(req.user.id, req.user.display_name, 'task.comment.create', 'task', req.params.id, content.slice(0, 80));
  res.status(201).json({ comment });
  if (mentions.length) {
    const actor = { id: req.user.id, name: req.user.display_name || '' };
    void notifyTaskMentionByEmail(task, actor, comment, mentions).then(result => {
      if (result.enabled) logAudit(req.user.id, req.user.display_name, 'task.mention.notify.email', 'task', req.params.id, `提及邮件：成功 ${result.sent}，跳过 ${result.skipped}，失败 ${result.failures.length}`);
    }).catch(error => console.error('[email] 任务提及通知失败:', error.message));
  }
});

router.delete('/:id/comments/:commentId', authMiddleware, requireRole('user', 'admin'), async (req, res) => {
  const db = await getDb();
  const comment = queryOne(db, 'SELECT * FROM task_comments WHERE id=? AND task_id=?', [req.params.commentId, req.params.id]);
  if (!comment) return res.status(404).json({ error: '留言不存在' });
  if (comment.deleted_at) return res.json({ success: true });
  if (comment.user_id !== req.user.id) return res.status(403).json({ error: '只能删除自己的留言' });
  const snapshot = sqlSnapshot(db, [{ table: 'task_comments', mode: 'replace', sql: 'SELECT * FROM task_comments WHERE id=?', params: [comment.id] }]);
  const timestamp = now();
  db.run('UPDATE task_comments SET content=?,deleted_at=?,deleted_by=?,updated_at=? WHERE id=?', ['', timestamp, req.user.id, timestamp, comment.id]);
  saveDbImmediate();
  logAudit(req.user.id, req.user.display_name, 'task.comment.delete', 'task', req.params.id, comment.id, snapshot);
  res.json({ success: true });
});

router.delete('/:id', authMiddleware, requireRole('user', 'admin'), async (req, res) => {
  const db = await getDb();
  const row = queryOne(db, 'SELECT * FROM tasks WHERE id=?', [req.params.id]);
  if (!row) return res.status(404).json({ error: '任务不存在' });
  if (req.user.role !== 'admin' && row.created_by !== req.user.id) return res.status(403).json({ error: '只有创建人可以删除任务' });
  const snapshot = sqlSnapshot(db, [
    { table: 'tasks', sql: 'SELECT * FROM tasks WHERE id=?', params: [req.params.id] },
    { table: 'task_recipients', sql: 'SELECT * FROM task_recipients WHERE task_id=?', params: [req.params.id] },
    { table: 'task_comments', sql: 'SELECT * FROM task_comments WHERE task_id=?', params: [req.params.id] },
  ]);
  db.run('DELETE FROM task_recipients WHERE task_id=?', [req.params.id]);
  db.run('DELETE FROM task_comments WHERE task_id=?', [req.params.id]);
  db.run('DELETE FROM tasks WHERE id=?', [req.params.id]);
  saveDbImmediate();
  const task = JSON.parse(row.data);
  logAudit(req.user.id, req.user.display_name, 'task.delete', 'task', req.params.id, task.title || req.params.id, snapshot);
  res.json({ success: true });
});

module.exports = router;
