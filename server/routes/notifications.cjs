const express = require('express');
const { getDb, saveDbImmediate } = require('../db.cjs');
const { authMiddleware, requireRole, queryOne } = require('../middleware/auth.cjs');
const { logAudit, sqlSnapshot } = require('../services/audit.cjs');
const { createNotification, uniqueRecipientIds } = require('../services/notifications.cjs');

const router = express.Router();
const now = () => new Date().toISOString();

function safeJson(value, fallback = {}) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}

function migrateLegacyReminders(db) {
  const rows = db.exec("SELECT id,data FROM tasks")[0]?.values || [];
  let migrated = 0;
  rows.forEach(([taskId, raw]) => {
    const task = safeJson(raw, null);
    if (!task || task.itemType !== 'reminder') return;
    const recipientRows = db.exec('SELECT user_id FROM task_recipients WHERE task_id=?', [taskId])[0]?.values || [];
    const recipientIds = recipientRows.map(row => row[0]);
    const component = task.reminderComponent?.type === 'poll' ? task.reminderComponent : null;
    createNotification(db, {
      id: `notification_legacy_${taskId}`,
      type: 'manual',
      title: task.title,
      content: task.description || task.remark || '',
      senderId: task.createdById,
      senderName: task.createdByName,
      recipientIds: recipientIds.length ? recipientIds : task.recipientIds,
      componentType: component ? 'poll' : 'none',
      componentData: component ? { options: component.options || [] } : {},
      expiresAt: task.dueAt || null,
      createdAt: task.createdAt || task.updatedAt || now(),
    });
    db.run('DELETE FROM task_comments WHERE task_id=?', [taskId]);
    db.run('DELETE FROM task_recipients WHERE task_id=?', [taskId]);
    db.run('DELETE FROM tasks WHERE id=?', [taskId]);
    migrated += 1;
  });
  if (migrated) saveDbImmediate();
}

function mapNotification(row, voteSummary) {
  const componentData = safeJson(row.component_data, {});
  const poll = row.component_type === 'poll' ? {
    options: Array.isArray(componentData.options) ? componentData.options : [],
    counts: voteSummary?.counts || [],
    userVote: voteSummary?.userVote ?? null,
  } : null;
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    content: row.content,
    senderId: row.sender_id,
    senderName: row.sender_name,
    direction: row.direction,
    readAt: row.read_at || null,
    actionUrl: row.action_url || '',
    expiresAt: row.expires_at || null,
    createdAt: row.created_at,
    recipientCount: Number(row.recipient_count) || 0,
    readCount: Number(row.read_count) || 0,
    poll,
  };
}

router.get('/', authMiddleware, async (req, res) => {
  const db = await getDb();
  migrateLegacyReminders(db);
  const filter = ['all', 'unread', 'sent'].includes(String(req.query.filter)) ? String(req.query.filter) : 'all';
  let condition = '(n.sender_id=? OR nr.user_id=?)';
  const params = [req.user.id, req.user.id];
  if (filter === 'unread') condition = 'nr.user_id=? AND nr.read_at IS NULL';
  if (filter === 'unread') params.splice(0, params.length, req.user.id);
  if (filter === 'sent') condition = 'n.sender_id=?';
  if (filter === 'sent') params.splice(0, params.length, req.user.id);
  const rows = db.exec(`SELECT n.*,nr.read_at,
    CASE WHEN n.sender_id=? THEN 'sent' ELSE 'received' END AS direction,
    (SELECT COUNT(*) FROM notification_recipients x WHERE x.notification_id=n.id) AS recipient_count,
    (SELECT COUNT(*) FROM notification_recipients x WHERE x.notification_id=n.id AND x.read_at IS NOT NULL) AS read_count
    FROM notifications n
    LEFT JOIN notification_recipients nr ON nr.notification_id=n.id AND nr.user_id=? AND nr.archived_at IS NULL
    LEFT JOIN notification_archives na ON na.notification_id=n.id AND na.user_id=?
    WHERE na.notification_id IS NULL AND ${condition}
    ORDER BY n.created_at DESC`, [req.user.id, req.user.id, req.user.id, ...params]);
  const columns = rows[0]?.columns || [];
  const items = (rows[0]?.values || []).map(values => Object.fromEntries(columns.map((key, index) => [key, values[index]])));
  const voteRows = db.exec(`SELECT notification_id,user_id,option_index FROM notification_votes
    WHERE notification_id IN (SELECT n.id FROM notifications n LEFT JOIN notification_recipients nr ON nr.notification_id=n.id AND nr.user_id=? WHERE ${condition})`, [req.user.id, ...params])[0]?.values || [];
  const votes = new Map();
  voteRows.forEach(([notificationId, userId, optionIndex]) => {
    const entry = votes.get(notificationId) || { counts: [], userVote: null };
    entry.counts[optionIndex] = (entry.counts[optionIndex] || 0) + 1;
    if (userId === req.user.id) entry.userVote = Number(optionIndex);
    votes.set(notificationId, entry);
  });
  const unread = queryOne(db, 'SELECT COUNT(*) AS count FROM notification_recipients WHERE user_id=? AND read_at IS NULL AND archived_at IS NULL', [req.user.id])?.count || 0;
  const sent = queryOne(db, `SELECT COUNT(*) AS count FROM notifications n WHERE n.sender_id=?
    AND NOT EXISTS (SELECT 1 FROM notification_archives na WHERE na.notification_id=n.id AND na.user_id=?)`, [req.user.id, req.user.id])?.count || 0;
  const total = queryOne(db, `SELECT COUNT(DISTINCT n.id) AS count FROM notifications n LEFT JOIN notification_recipients nr ON nr.notification_id=n.id AND nr.user_id=? AND nr.archived_at IS NULL
    WHERE (n.sender_id=? OR nr.user_id=?) AND NOT EXISTS (SELECT 1 FROM notification_archives na WHERE na.notification_id=n.id AND na.user_id=?)`, [req.user.id, req.user.id, req.user.id, req.user.id])?.count || 0;
  res.json({ notifications: items.map(item => mapNotification(item, votes.get(item.id))), counts: { all: Number(total), unread: Number(unread), sent: Number(sent) } });
});

router.post('/', authMiddleware, requireRole('user', 'admin'), async (req, res) => {
  const db = await getDb();
  const title = String(req.body?.title || '').trim().slice(0, 200);
  const content = String(req.body?.content || '').trim().slice(0, 4000);
  const recipientIds = uniqueRecipientIds(req.body?.recipientIds, '');
  if (!title || !content) return res.status(400).json({ error: '提醒标题和内容不能为空' });
  if (!recipientIds.length) return res.status(400).json({ error: '请至少选择一位通知人员' });
  const placeholders = recipientIds.map(() => '?').join(',');
  const validRows = db.exec(`SELECT id FROM users WHERE status='active' AND id IN (${placeholders})`, recipientIds)[0]?.values || [];
  if (validRows.length !== recipientIds.length) return res.status(400).json({ error: '通知人员不存在或账号未启用' });
  const componentType = req.body?.componentType === 'poll' ? 'poll' : 'none';
  const options = componentType === 'poll' ? [...new Set((req.body?.pollOptions || []).map(value => String(value || '').trim()).filter(Boolean))].slice(0, 10) : [];
  if (componentType === 'poll' && options.length < 2) return res.status(400).json({ error: '投票至少需要两个选项' });
  const created = createNotification(db, {
    type: 'manual', title, content,
    senderId: req.user.id, senderName: req.user.display_name,
    recipientIds,
    componentType,
    componentData: { options },
    expiresAt: req.body?.expiresAt || null,
  });
  saveDbImmediate();
  logAudit(req.user.id, req.user.display_name, 'notification.create', 'notification', created.id, title);
  res.status(201).json({ success: true, id: created.id });
});

router.put('/read-all', authMiddleware, async (req, res) => {
  const db = await getDb();
  db.run('UPDATE notification_recipients SET read_at=COALESCE(read_at,?) WHERE user_id=? AND archived_at IS NULL', [now(), req.user.id]);
  saveDbImmediate();
  res.json({ success: true });
});

router.put('/:id/read', authMiddleware, async (req, res) => {
  const db = await getDb();
  const recipient = queryOne(db, 'SELECT notification_id FROM notification_recipients WHERE notification_id=? AND user_id=? AND archived_at IS NULL', [req.params.id, req.user.id]);
  if (!recipient) return res.status(404).json({ error: '消息不存在' });
  const readAt = now();
  db.run('UPDATE notification_recipients SET read_at=COALESCE(read_at,?) WHERE notification_id=? AND user_id=?', [readAt, req.params.id, req.user.id]);
  saveDbImmediate();
  res.json({ success: true, readAt });
});

router.delete('/:id', authMiddleware, async (req, res) => {
  const db = await getDb();
  const notification = queryOne(db, `SELECT n.id,n.title,n.sender_id,CASE WHEN nr.user_id IS NOT NULL THEN 1 ELSE 0 END AS is_recipient
    FROM notifications n LEFT JOIN notification_recipients nr ON nr.notification_id=n.id AND nr.user_id=? AND nr.archived_at IS NULL WHERE n.id=?`, [req.user.id, req.params.id]);
  if (!notification || (notification.sender_id !== req.user.id && !notification.is_recipient)) return res.status(404).json({ error: '消息不存在' });
  const snapshot = sqlSnapshot(db, [
    { table: 'notification_archives', mode: 'replace', sql: 'SELECT * FROM notification_archives WHERE notification_id=? AND user_id=?', params: [req.params.id, req.user.id] },
    { table: 'notification_recipients', mode: 'replace', sql: 'SELECT * FROM notification_recipients WHERE notification_id=? AND user_id=?', params: [req.params.id, req.user.id] },
  ]);
  snapshot.operations = [{ type: 'delete', table: 'notification_archives', where: { notification_id: req.params.id, user_id: req.user.id } }];
  const archivedAt = now();
  db.run(`INSERT INTO notification_archives(notification_id,user_id,archived_at) VALUES(?,?,?)
    ON CONFLICT(notification_id,user_id) DO UPDATE SET archived_at=excluded.archived_at`, [req.params.id, req.user.id, archivedAt]);
  db.run('UPDATE notification_recipients SET archived_at=? WHERE notification_id=? AND user_id=?', [archivedAt, req.params.id, req.user.id]);
  saveDbImmediate();
  logAudit(req.user.id, req.user.display_name, 'notification.archive', 'notification', req.params.id, notification.title || '', snapshot);
  res.json({ success: true });
});

router.post('/:id/vote', authMiddleware, async (req, res) => {
  const db = await getDb();
  const notification = queryOne(db, `SELECT n.component_type,n.component_data,n.expires_at FROM notifications n
    JOIN notification_recipients nr ON nr.notification_id=n.id AND nr.user_id=? AND nr.archived_at IS NULL WHERE n.id=?`, [req.user.id, req.params.id]);
  if (!notification || notification.component_type !== 'poll') return res.status(404).json({ error: '投票不存在' });
  if (notification.expires_at && new Date(notification.expires_at).getTime() < Date.now()) return res.status(400).json({ error: '投票已截止' });
  const options = safeJson(notification.component_data, {}).options || [];
  const optionIndex = Number(req.body?.optionIndex);
  if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= options.length) return res.status(400).json({ error: '投票选项无效' });
  db.run(`INSERT INTO notification_votes(notification_id,user_id,option_index,voted_at) VALUES(?,?,?,?)
    ON CONFLICT(notification_id,user_id) DO UPDATE SET option_index=excluded.option_index,voted_at=excluded.voted_at`, [req.params.id, req.user.id, optionIndex, now()]);
  db.run('UPDATE notification_recipients SET read_at=COALESCE(read_at,?) WHERE notification_id=? AND user_id=?', [now(), req.params.id, req.user.id]);
  saveDbImmediate();
  res.json({ success: true });
});

module.exports = router;
