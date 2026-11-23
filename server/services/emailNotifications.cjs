const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_QUESTIONNAIRE_EMAIL_ATTACHMENT_LIMIT = 20 * 1024 * 1024;
let transporterCache = null;
let transporterCacheKey = '';
let transportFactory = options => nodemailer.createTransport(options);

function readConfig() {
  const port = Number(process.env.SMTP_PORT || 465);
  return {
    enabled: String(process.env.SMTP_ENABLED || '').toLowerCase() === 'true',
    host: String(process.env.SMTP_HOST || 'smtp.qq.com').trim(),
    port: Number.isFinite(port) && port > 0 ? port : 465,
    secure: String(process.env.SMTP_SECURE ?? 'true').toLowerCase() !== 'false',
    user: String(process.env.SMTP_USER || '').trim(),
    authCode: String(process.env.SMTP_AUTH_CODE || '').trim(),
    fromName: String(process.env.SMTP_FROM_NAME || 'GCO Link 任务助手').trim(),
    publicUrl: String(process.env.IBD_PUBLIC_URL || '').trim().replace(/\/+$/, ''),
  };
}

function isConfigured(config = readConfig()) {
  return config.enabled
    && Boolean(config.host)
    && Boolean(config.user)
    && Boolean(config.authCode);
}

function buildQuestionnaireEmailAttachments(files, uploadDir) {
  const configuredLimit = Number(process.env.QUESTIONNAIRE_EMAIL_ATTACHMENT_LIMIT_BYTES);
  const sizeLimit = Number.isFinite(configuredLimit) && configuredLimit >= 0
    ? configuredLimit
    : DEFAULT_QUESTIONNAIRE_EMAIL_ATTACHMENT_LIMIT;
  const baseDir = path.resolve(String(uploadDir || ''));
  const attachments = [];
  let totalSize = 0;

  for (const file of Array.isArray(files) ? files : []) {
    const storedName = path.basename(String(file?.storedName || file?.filename || ''));
    const filePath = path.resolve(baseDir, storedName);
    const fileSize = Number(file?.fileSize ?? file?.size ?? 0);
    if (!storedName || !filePath.startsWith(`${baseDir}${path.sep}`) || !fs.existsSync(filePath)) continue;
    if (!Number.isFinite(fileSize) || fileSize < 0 || totalSize + fileSize > sizeLimit) continue;
    totalSize += fileSize;
    attachments.push({
      filename: path.basename(String(file?.fileName || file?.originalname || storedName)),
      path: filePath,
      contentType: String(file?.mimeType || file?.mimetype || '') || undefined,
    });
  }

  return { attachments, totalSize, sizeLimit };
}

function getTransporter(config) {
  const cacheKey = JSON.stringify([
    config.host,
    config.port,
    config.secure,
    config.user,
    config.authCode,
  ]);
  if (transporterCache && transporterCacheKey === cacheKey) return transporterCache;
  transporterCache = transportFactory({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.authCode,
    },
    connectionTimeout: DEFAULT_TIMEOUT_MS,
    greetingTimeout: DEFAULT_TIMEOUT_MS,
    socketTimeout: DEFAULT_TIMEOUT_MS,
  });
  transporterCacheKey = cacheKey;
  return transporterCache;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function taskEmailContent(task, recipient, config) {
  const title = String(task.title || '').trim();
  const taskUrl = config.publicUrl ? `${config.publicUrl}/tasks` : '';
  const lines = [
    `您好，${recipient.name || '同事'}：`,
    '',
    `您收到一项新的 GCO Link 任务：${title}`,
    task.projectName ? `关联项目：${task.projectName}` : '',
    task.createdByName ? `创建人：${task.createdByName}` : '',
    task.dueAt ? `截止时间：${task.dueAt}` : '',
    task.description ? `任务说明：${String(task.description).trim().slice(0, 1000)}` : '',
    taskUrl ? `查看任务：${taskUrl}` : '',
  ].filter((line, index, values) => line || (index > 0 && values[index - 1]));

  const details = [
    task.projectName ? ['关联项目', task.projectName] : null,
    task.createdByName ? ['创建人', task.createdByName] : null,
    task.dueAt ? ['截止时间', task.dueAt] : null,
    task.description ? ['任务说明', String(task.description).trim().slice(0, 1000)] : null,
  ].filter(Boolean);
  const detailRows = details.map(([label, value]) => `
    <tr>
      <td style="padding:8px 12px;color:#64748b;vertical-align:top;white-space:nowrap">${escapeHtml(label)}</td>
      <td style="padding:8px 12px;color:#0f172a;line-height:1.6">${escapeHtml(value)}</td>
    </tr>`).join('');

  return {
    subject: `[GCO Link] 新任务：${title}`,
    text: lines.join('\n'),
    html: `<!doctype html>
<html lang="zh-CN">
<body style="margin:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;color:#0f172a">
  <div style="max-width:640px;margin:24px auto;background:#ffffff;border:1px solid #e2e8f0">
    <div style="padding:22px 28px;background:#1d4ed8;color:#ffffff">
      <div style="font-size:13px;opacity:.85">GCO Link 任务中心</div>
      <h1 style="margin:8px 0 0;font-size:22px;line-height:1.4">${escapeHtml(title)}</h1>
    </div>
    <div style="padding:26px 28px">
      <p style="margin:0 0 18px;line-height:1.7">您好，${escapeHtml(recipient.name || '同事')}：</p>
      <p style="margin:0 0 18px;line-height:1.7">您收到一项新的任务，请及时查看并处理。</p>
      <table style="width:100%;border-collapse:collapse;background:#f8fafc;border:1px solid #e2e8f0">${detailRows}</table>
      ${taskUrl ? `<p style="margin:24px 0 0"><a href="${escapeHtml(taskUrl)}" style="display:inline-block;padding:11px 20px;background:#2563eb;color:#ffffff;text-decoration:none">查看任务</a></p>` : ''}
    </div>
    <div style="padding:14px 28px;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:12px">此邮件由 GCO Link 自动发送，请勿直接回复。</div>
  </div>
</body>
</html>`,
  };
}

async function notifyTaskCreatedByEmail(task, recipients) {
  const config = readConfig();
  if (!isConfigured(config)) {
    return { enabled: false, sent: 0, skipped: recipients.length, failures: [] };
  }
  const uniqueRecipients = [];
  const seen = new Set();
  for (const recipient of recipients) {
    const email = normalizeEmail(recipient.email);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    uniqueRecipients.push({ ...recipient, email });
  }
  if (!uniqueRecipients.length) {
    return { enabled: true, sent: 0, skipped: recipients.length, failures: [] };
  }

  const transporter = getTransporter(config);
  const results = await Promise.allSettled(uniqueRecipients.map(recipient => {
    const content = taskEmailContent(task, recipient, config);
    return transporter.sendMail({
      from: { name: config.fromName, address: config.user },
      to: { name: recipient.name || recipient.email, address: recipient.email },
      ...content,
    });
  }));
  const failures = results
    .map((result, index) => result.status === 'rejected'
      ? {
        recipientId: uniqueRecipients[index].id,
        message: result.reason?.message || '邮件发送失败',
      }
      : null)
    .filter(Boolean);

  return {
    enabled: true,
    sent: uniqueRecipients.length - failures.length,
    skipped: recipients.length - uniqueRecipients.length,
    failures,
  };
}

function taskMentionEmailContent(task, actor, comment, recipient, config) {
  const taskTitle = String(task?.title || '未命名任务').trim();
  const actorName = String(actor?.name || '有成员').trim();
  const commentContent = String(comment?.content || '').trim().slice(0, 2000);
  const taskUrl = config.publicUrl
    ? `${config.publicUrl}/discussions?taskId=${encodeURIComponent(task?.id || '')}&commentId=${encodeURIComponent(comment?.id || '')}`
    : '';
  return {
    subject: `[GCO Link] ${actorName} 在任务回复中提到了你：${taskTitle}`,
    text: [
      `${recipient.name || '同事'}，您好：`,
      '',
      `${actorName} 在任务“${taskTitle}”的回复中提到了你。`,
      '',
      commentContent,
      '',
      taskUrl ? `查看并回复：${taskUrl}` : '',
    ].filter(Boolean).join('\n'),
    html: `<!doctype html><html lang="zh-CN"><body style="margin:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;color:#0f172a"><div style="max-width:640px;margin:24px auto;background:#fff;border:1px solid #e2e8f0"><div style="padding:22px 28px;background:#1d4ed8;color:#fff"><div style="font-size:13px;opacity:.85">GCO Link 任务中心</div><h1 style="margin:8px 0 0;font-size:21px;line-height:1.45">回复中提到了你</h1></div><div style="padding:26px 28px"><p style="margin:0 0 18px;line-height:1.7">${escapeHtml(recipient.name || '同事')}，您好：</p><p style="margin:0 0 18px;line-height:1.7"><strong>${escapeHtml(actorName)}</strong> 在任务“<strong>${escapeHtml(taskTitle)}</strong>”的回复中提到了你。</p><div style="padding:16px 18px;background:#f8fafc;border-left:3px solid #2563eb;white-space:pre-wrap;word-break:break-word;line-height:1.8;color:#334155">${escapeHtml(commentContent)}</div>${taskUrl ? `<p style="margin:24px 0 0"><a href="${escapeHtml(taskUrl)}" style="display:inline-block;padding:11px 20px;background:#2563eb;color:#fff;text-decoration:none">查看并回复</a></p>` : ''}</div><div style="padding:14px 28px;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:12px">此邮件由 GCO Link 自动发送，请勿直接回复。</div></div></body></html>`,
  };
}

async function notifyTaskMentionByEmail(task, actor, comment, recipients) {
  const config = readConfig();
  const list = Array.isArray(recipients) ? recipients : [];
  if (!isConfigured(config)) return { enabled: false, sent: 0, skipped: list.length, failures: [] };
  const uniqueRecipients = [];
  const seen = new Set();
  for (const recipient of list) {
    const email = normalizeEmail(recipient?.email);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    uniqueRecipients.push({ ...recipient, email });
  }
  if (!uniqueRecipients.length) return { enabled: true, sent: 0, skipped: list.length, failures: [] };

  const transporter = getTransporter(config);
  const results = await Promise.allSettled(uniqueRecipients.map(recipient => transporter.sendMail({
    from: { name: config.fromName, address: config.user },
    to: { name: recipient.name || recipient.email, address: recipient.email },
    ...taskMentionEmailContent(task, actor, comment, recipient, config),
  })));
  const failures = results.map((result, index) => result.status === 'rejected'
    ? { recipientId: uniqueRecipients[index].id, message: result.reason?.message || '邮件发送失败' }
    : null).filter(Boolean);
  return {
    enabled: true,
    sent: uniqueRecipients.length - failures.length,
    skipped: list.length - uniqueRecipients.length,
    failures,
  };
}

function weeklyTodoEmailContent(digest, config) {
  const taskUrl = config.publicUrl ? `${config.publicUrl}/tasks` : '';
  const tasks = Array.isArray(digest.tasks) ? digest.tasks : [];
  const period = `${digest.weekStart || ''} 至 ${digest.weekEnd || ''}`;
  const taskRows = tasks.length
    ? tasks.map((task, index) => `
      <tr>
        <td style="padding:10px 12px;border-top:1px solid #e2e8f0;color:#64748b;vertical-align:top">${index + 1}</td>
        <td style="padding:10px 12px;border-top:1px solid #e2e8f0;vertical-align:top">
          <div style="font-weight:600;color:#0f172a">${escapeHtml(task.title || '未命名任务')}</div>
          ${task.projectName ? `<div style="margin-top:4px;color:#64748b;font-size:13px">${escapeHtml(task.projectName)}</div>` : ''}
        </td>
        <td style="padding:10px 12px;border-top:1px solid #e2e8f0;color:${task.overdue ? '#b91c1c' : '#475569'};white-space:nowrap;vertical-align:top">${escapeHtml(task.dueLabel || '未设置')}</td>
      </tr>`).join('')
    : '<tr><td style="padding:28px;text-align:center;color:#64748b">本周暂无待办任务</td></tr>';
  const textRows = tasks.length
    ? tasks.map((task, index) => `${index + 1}. ${task.title || '未命名任务'}${task.projectName ? `｜${task.projectName}` : ''}｜${task.dueLabel || '未设置截止时间'}`)
    : ['本周暂无待办任务'];

  return {
    subject: `[GCO Link] 本周待办（${digest.weekStart || ''}）`,
    text: [
      `${digest.name || '同事'}，您好：`,
      '',
      `以下是您 ${period} 的待办任务：`,
      ...textRows,
      taskUrl ? `查看任务中心：${taskUrl}` : '',
    ].filter(Boolean).join('\n'),
    html: `<!doctype html>
<html lang="zh-CN">
<body style="margin:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;color:#0f172a">
  <div style="max-width:680px;margin:24px auto;background:#ffffff;border:1px solid #e2e8f0">
    <div style="padding:22px 28px;background:#1d4ed8;color:#ffffff">
      <div style="font-size:13px;opacity:.85">GCO Link 任务中心</div>
      <h1 style="margin:8px 0 0;font-size:22px;line-height:1.4">本周待办</h1>
      <div style="margin-top:8px;font-size:13px;opacity:.9">${escapeHtml(period)}</div>
    </div>
    <div style="padding:24px 28px">
      <p style="margin:0 0 18px;line-height:1.7">${escapeHtml(digest.name || '同事')}，您好。以下是您本周需要关注的任务，共 ${tasks.length} 项。</p>
      <table style="width:100%;border-collapse:collapse;background:#f8fafc;border:1px solid #e2e8f0">
        ${taskRows}
      </table>
      ${taskUrl ? `<p style="margin:24px 0 0"><a href="${escapeHtml(taskUrl)}" style="display:inline-block;padding:11px 20px;background:#2563eb;color:#ffffff;text-decoration:none">打开任务中心</a></p>` : ''}
    </div>
    <div style="padding:14px 28px;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:12px">此邮件由 GCO Link 自动发送，请勿直接回复。</div>
  </div>
</body>
</html>`,
  };
}

async function sendWeeklyTodoEmails(digests) {
  const config = readConfig();
  const list = Array.isArray(digests) ? digests : [];
  if (!isConfigured(config)) {
    return { enabled: false, sent: 0, skipped: list.length, failures: [] };
  }
  const recipients = [];
  const seen = new Set();
  for (const digest of list) {
    const email = normalizeEmail(digest.email);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    recipients.push({ ...digest, email });
  }
  if (!recipients.length) {
    return { enabled: true, sent: 0, skipped: list.length, failures: [] };
  }
  const transporter = getTransporter(config);
  const results = await Promise.allSettled(recipients.map(digest => transporter.sendMail({
    from: { name: config.fromName, address: config.user },
    to: { name: digest.name || digest.email, address: digest.email },
    ...weeklyTodoEmailContent(digest, config),
  })));
  const failures = results
    .map((result, index) => result.status === 'rejected'
      ? { recipientId: recipients[index].id, message: result.reason?.message || '邮件发送失败' }
      : null)
    .filter(Boolean);
  return {
    enabled: true,
    sent: recipients.length - failures.length,
    skipped: list.length - recipients.length,
    failures,
  };
}

function birthdayReminderEmailContent(event, recipient) {
  const birthdayName = String(event?.name || '同事').trim() || '同事';
  const birthdayLabel = String(event?.birthdayLabel || '').trim();
  const recipientName = String(recipient?.name || '同事').trim() || '同事';
  return {
    subject: `[GCO Link] 生日提醒：${birthdayName} 的生日还有 10 天`,
    text: [
      `${recipientName}，您好：`,
      '',
      `${birthdayName} 的生日是 ${birthdayLabel}，还有 10 天。`,
      '可以提前准备一句祝福。',
      '',
      '此邮件由 GCO Link 自动发送。',
    ].join('\n'),
    html: `<!doctype html><html lang="zh-CN"><body style="margin:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;color:#0f172a"><div style="max-width:640px;margin:24px auto;background:#fff;border:1px solid #e2e8f0"><div style="padding:22px 28px;background:#1d4ed8;color:#fff"><div style="font-size:13px;opacity:.85">GCO Link 生日提醒</div><h1 style="margin:8px 0 0;font-size:21px">${escapeHtml(birthdayName)} 的生日还有 10 天</h1></div><div style="padding:26px 28px"><p style="margin:0 0 18px;line-height:1.7">${escapeHtml(recipientName)}，您好：</p><p style="margin:0;line-height:1.8"><strong>${escapeHtml(birthdayName)}</strong> 的生日是 <strong>${escapeHtml(birthdayLabel)}</strong>，可以提前准备一句祝福。</p></div><div style="padding:14px 28px;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:12px">此邮件由 GCO Link 自动发送，仅显示生日月日，不显示出生年份。</div></div></body></html>`,
  };
}

async function sendBirthdayReminderEmails(event, recipients) {
  const config = readConfig();
  const list = Array.isArray(recipients) ? recipients : [];
  if (!isConfigured(config)) return { enabled: false, sent: [], skipped: list.length, failures: [] };
  const uniqueRecipients = [];
  const seen = new Set();
  for (const recipient of list) {
    const email = normalizeEmail(recipient?.email);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    uniqueRecipients.push({ ...recipient, email });
  }
  if (!uniqueRecipients.length) return { enabled: true, sent: [], skipped: list.length, failures: [] };
  const transporter = getTransporter(config);
  const results = await Promise.allSettled(uniqueRecipients.map(recipient => transporter.sendMail({
    from: { name: config.fromName, address: config.user },
    to: { name: recipient.name || recipient.email, address: recipient.email },
    ...birthdayReminderEmailContent(event, recipient),
  })));
  const sent = [];
  const failures = [];
  results.forEach((result, index) => {
    const recipient = uniqueRecipients[index];
    if (result.status === 'fulfilled') sent.push(recipient.id);
    else failures.push({ recipientId: recipient.id, message: result.reason?.message || '邮件发送失败' });
  });
  return { enabled: true, sent, skipped: list.length - uniqueRecipients.length, failures };
}

function resetTransporterCache() {
  transporterCache = null;
  transporterCacheKey = '';
}

async function notifyQuestionnaireSubmissionByEmail(submission, recipient) {
  const config = readConfig();
  const email = normalizeEmail(recipient?.email);
  if (!isConfigured(config)) return { enabled: false, sent: 0, skipped: 1, failures: [] };
  if (!email) return { enabled: true, sent: 0, skipped: 1, failures: [] };
  const title = String(submission.questionnaireTitle || '未命名问卷');
  const submittedAt = String(submission.submittedAt || '');
  const recipientName = String(recipient.name || '经理');
  const questionnaireUrl = config.publicUrl ? `${config.publicUrl}/questionnaires` : '';
  const emailFiles = buildQuestionnaireEmailAttachments(submission.attachments, submission.attachmentDirectory);
  try {
    await getTransporter(config).sendMail({
      from: { name: config.fromName, address: config.user },
      to: { name: recipientName, address: email },
      subject: `[GCO Link] 您的问卷收到新答卷：${title}`,
      text: [`${recipientName}，您好：`, '', `您分享的问卷“${title}”收到了一份新答卷。`, submittedAt ? `提交时间：${submittedAt}` : '', questionnaireUrl ? `查看答卷：${questionnaireUrl}` : ''].filter(Boolean).join('\n'),
      html: `<!doctype html><html lang="zh-CN"><body style="margin:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;color:#0f172a"><div style="max-width:640px;margin:24px auto;background:#fff;border:1px solid #e2e8f0"><div style="padding:22px 28px;background:#1d4ed8;color:#fff"><div style="font-size:13px;opacity:.85">GCO Link 问卷中心</div><h1 style="margin:8px 0 0;font-size:21px">收到新答卷</h1></div><div style="padding:26px 28px"><p>${escapeHtml(recipientName)}，您好：</p><p>您分享的问卷“${escapeHtml(title)}”收到了一份新答卷。</p><p>提交时间：${escapeHtml(submittedAt)}</p>${questionnaireUrl ? `<p><a href="${escapeHtml(questionnaireUrl)}" style="display:inline-block;padding:11px 20px;background:#2563eb;color:#fff;text-decoration:none">查看全部答卷</a></p>` : ''}</div><div style="padding:14px 28px;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:12px">此邮件由 GCO Link 自动发送，请勿直接回复。</div></div></body></html>`,
      attachments: emailFiles.attachments,
    });
    return { enabled: true, sent: 1, skipped: 0, failures: [] };
  } catch (error) {
    return { enabled: true, sent: 0, skipped: 0, failures: [{ recipientId: recipient.id, message: error?.message || '邮件发送失败' }] };
  }
}

function setTransportFactoryForTests(factory) {
  transportFactory = factory || (options => nodemailer.createTransport(options));
  resetTransporterCache();
}

module.exports = {
  isConfigured,
  notifyTaskCreatedByEmail,
  notifyTaskMentionByEmail,
  notifyQuestionnaireSubmissionByEmail,
  sendBirthdayReminderEmails,
  sendWeeklyTodoEmails,
  resetTransporterCache,
  setTransportFactoryForTests,
};
