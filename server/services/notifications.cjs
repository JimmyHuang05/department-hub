const crypto = require('crypto');
const { broadcastToUser } = require('../ws/hub.cjs');

const now = () => new Date().toISOString();

function makeNotificationId() {
  return `notification_${crypto.randomUUID().replaceAll('-', '')}`;
}

function uniqueRecipientIds(value, senderId = '') {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(id => String(id || '').trim()).filter(id => id && id !== senderId))];
}

function createNotification(db, input) {
  const id = String(input.id || makeNotificationId());
  const senderId = String(input.senderId || 'system');
  const recipientIds = uniqueRecipientIds(input.recipientIds, input.includeSender ? '' : senderId);
  const createdAt = input.createdAt || now();
  const componentType = input.componentType === 'poll' ? 'poll' : 'none';
  const componentData = componentType === 'poll' ? input.componentData || {} : {};
  db.run(`INSERT OR IGNORE INTO notifications
    (id,type,title,content,sender_id,sender_name,component_type,component_data,action_url,expires_at,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`, [
    id,
    String(input.type || 'system'),
    String(input.title || '').trim().slice(0, 200),
    String(input.content || '').trim().slice(0, 4000),
    senderId,
    String(input.senderName || '系统').slice(0, 100),
    componentType,
    JSON.stringify(componentData),
    String(input.actionUrl || '').slice(0, 500),
    input.expiresAt || null,
    createdAt,
  ]);
  recipientIds.forEach(userId => db.run(
    'INSERT OR IGNORE INTO notification_recipients(notification_id,user_id,created_at) VALUES(?,?,?)',
    [id, userId, createdAt],
  ));
  recipientIds.forEach(userId => broadcastToUser(userId, {
    type: 'notification-new',
    notification: {
      id,
      title: String(input.title || '').trim().slice(0, 200),
      content: String(input.content || '').trim().slice(0, 4000),
      actionUrl: String(input.actionUrl || '').slice(0, 500),
      createdAt,
    },
  }));
  return { id, recipientIds };
}

function taskAudience(task, actorId = '') {
  return uniqueRecipientIds([
    task.createdById,
    task.assignedToId,
    ...(Array.isArray(task.recipientIds) ? task.recipientIds : []),
  ], actorId);
}

function createTaskNotification(db, task, actor, event, detail = '', options = {}) {
  const labels = {
    created: '你收到了一项新任务',
    comment: '任务有了新回复',
    status: '任务阶段已更新',
  };
  const excluded = new Set(options.excludeRecipientIds || []);
  const recipientIds = taskAudience(task, actor.id).filter(id => !excluded.has(id));
  if (!recipientIds.length) return { id: '', recipientIds: [] };
  return createNotification(db, {
    type: event === 'comment' ? 'task_comment' : event === 'status' ? 'task_status' : 'task_created',
    title: labels[event] || '任务有新动态',
    content: detail || task.title,
    senderId: actor.id,
    senderName: actor.name,
    recipientIds,
    actionUrl: `/discussions?taskId=${encodeURIComponent(task.id)}`,
  });
}

function createTaskMentionNotification(db, task, actor, comment, mentionIds) {
  return createNotification(db, {
    type: 'task_mention',
    title: `${actor.name || '有成员'} 在任务回复中提到了你`,
    content: `${task.title}：${String(comment.content || '').slice(0, 160)}`,
    senderId: actor.id,
    senderName: actor.name,
    recipientIds: mentionIds,
    actionUrl: `/discussions?taskId=${encodeURIComponent(task.id)}&commentId=${encodeURIComponent(comment.id)}`,
  });
}

module.exports = { createNotification, createTaskNotification, createTaskMentionNotification, taskAudience, uniqueRecipientIds };
