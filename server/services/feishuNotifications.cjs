const FEISHU_API_BASE = 'https://open.feishu.cn/open-apis';
const REQUEST_TIMEOUT_MS = 8000;

let tokenCache = {
  value: '',
  expiresAt: 0,
};

function readConfig() {
  return {
    enabled: String(process.env.FEISHU_ENABLED || '').toLowerCase() === 'true',
    appId: String(process.env.FEISHU_APP_ID || '').trim(),
    appSecret: String(process.env.FEISHU_APP_SECRET || '').trim(),
    taskChatId: String(process.env.FEISHU_TASK_CHAT_ID || '').trim(),
    publicUrl: String(process.env.IBD_PUBLIC_URL || '').trim().replace(/\/+$/, ''),
  };
}

function isConfigured(config = readConfig()) {
  return config.enabled
    && Boolean(config.appId)
    && Boolean(config.appSecret)
    && Boolean(config.taskChatId);
}

async function requestJson(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || (payload.code !== undefined && payload.code !== 0)) {
      const detail = payload.msg || payload.message || `HTTP ${response.status}`;
      throw new Error(`飞书接口调用失败：${detail}`);
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function getTenantAccessToken(config = readConfig()) {
  if (tokenCache.value && tokenCache.expiresAt > Date.now() + 5 * 60 * 1000) {
    return tokenCache.value;
  }
  const payload = await requestJson(`${FEISHU_API_BASE}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      app_id: config.appId,
      app_secret: config.appSecret,
    }),
  });
  if (!payload.tenant_access_token) throw new Error('飞书未返回 tenant_access_token');
  tokenCache = {
    value: payload.tenant_access_token,
    expiresAt: Date.now() + Math.max(Number(payload.expire || 7200) - 60, 60) * 1000,
  };
  return tokenCache.value;
}

async function resolveRecipientOpenIds(recipients, token) {
  const direct = recipients
    .filter(recipient => recipient.feishuOpenId)
    .map(recipient => ({ ...recipient, openId: recipient.feishuOpenId }));
  const unresolved = recipients.filter(recipient => !recipient.feishuOpenId);
  if (!unresolved.length) return direct;
  const nameResolved = await resolveRecipientsByName(unresolved, token);
  return [
    ...direct,
    ...nameResolved,
  ];
}

async function getPagedItems(url, token) {
  const items = [];
  let pageToken = '';
  do {
    const separator = url.includes('?') ? '&' : '?';
    const pageUrl = `${url}${pageToken ? `${separator}page_token=${encodeURIComponent(pageToken)}` : ''}`;
    const payload = await requestJson(pageUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    items.push(...(payload.data?.items || []));
    pageToken = payload.data?.has_more ? String(payload.data?.page_token || '') : '';
  } while (pageToken);
  return items;
}

async function resolveRecipientsByName(recipients, token) {
  const departmentItems = await getPagedItems(
    `${FEISHU_API_BASE}/contact/v3/departments/0/children?department_id_type=open_department_id&fetch_child=true&page_size=50`,
    token,
  );
  const departmentIds = ['0', ...new Set(
    departmentItems.map(item => item.open_department_id || item.department_id).filter(Boolean),
  )];
  const directoryUsers = [];
  for (const departmentId of departmentIds) {
    const users = await getPagedItems(
      `${FEISHU_API_BASE}/contact/v3/users/find_by_department?department_id=${encodeURIComponent(departmentId)}&department_id_type=open_department_id&user_id_type=open_id&page_size=50`,
      token,
    );
    directoryUsers.push(...users);
  }
  const byOpenId = new Map();
  for (const user of directoryUsers) {
    const openId = user.open_id || user.user_id;
    if (openId) byOpenId.set(openId, user);
  }
  if (byOpenId.size && ![...byOpenId.values()].some(user => String(user.name || '').trim())) {
    throw new Error('飞书通讯录未返回成员姓名，请开通 contact:user.base:readonly 权限并发布应用版本');
  }
  const byName = new Map();
  for (const [openId, user] of byOpenId) {
    const name = String(user.name || '').trim();
    if (!name || user.status?.is_resigned) continue;
    if (!byName.has(name)) byName.set(name, openId);
  }
  return recipients
    .map(recipient => {
      const openId = byName.get(String(recipient.name || recipient.displayName || '').trim());
      return openId ? { ...recipient, openId } : null;
    })
    .filter(Boolean);
}

function taskNotificationCard(task, recipients, config) {
  const mentions = recipients
    .map(recipient => `<at id="${recipient.openId}"></at>`)
    .join(' ');
  const lines = [
    mentions,
    task.projectName ? `**关联项目：** ${task.projectName}` : '',
    task.createdByName ? `**创建人：** ${task.createdByName}` : '',
    task.dueAt ? `**截止时间：** ${task.dueAt}` : '',
    task.description ? `**任务说明：** ${String(task.description).trim().slice(0, 500)}` : '',
    config.publicUrl ? `[查看任务](${config.publicUrl}/tasks)` : '',
  ];
  return {
    header: {
      title: { tag: 'plain_text', content: `GCO Link 新任务：${String(task.title || '').trim()}` },
      template: 'blue',
    },
    elements: [{ tag: 'markdown', content: lines.filter(Boolean).join('\n\n') }],
  };
}

async function sendTaskGroupMessage(chatId, card, token) {
  return requestJson(`${FEISHU_API_BASE}/im/v1/messages?receive_id_type=chat_id`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      receive_id: chatId,
      msg_type: 'interactive',
      content: JSON.stringify(card),
    }),
  });
}

async function notifyTaskCreated(task, recipients) {
  const config = readConfig();
  if (!isConfigured(config)) {
    return { enabled: false, sent: 0, skipped: recipients.length, failures: [] };
  }

  const token = await getTenantAccessToken(config);
  const resolved = await resolveRecipientOpenIds(recipients, token);
  if (!resolved.length) {
    return { enabled: true, sent: 0, skipped: recipients.length, failures: [] };
  }
  const failures = [];
  try {
    const card = taskNotificationCard(task, resolved, config);
    await sendTaskGroupMessage(config.taskChatId, card, token);
  } catch (error) {
    failures.push({
      recipientIds: resolved.map(recipient => recipient.id),
      message: error?.message || '群消息发送失败',
    });
  }

  return {
    enabled: true,
    sent: failures.length ? 0 : resolved.length,
    skipped: Math.max(recipients.length - resolved.length, 0),
    failures,
  };
}

function resetTokenCache() {
  tokenCache = { value: '', expiresAt: 0 };
}

module.exports = {
  isConfigured,
  notifyTaskCreated,
  resetTokenCache,
};
