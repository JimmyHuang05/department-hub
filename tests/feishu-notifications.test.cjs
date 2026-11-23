const test = require('node:test');
const assert = require('node:assert/strict');

const {
  notifyTaskCreated,
  resetTokenCache,
} = require('../server/services/feishuNotifications.cjs');

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  };
}

test('Feishu task notification sends one group card and mentions an already resolved recipient', async () => {
  const originalFetch = global.fetch;
  const originalEnv = {
    enabled: process.env.FEISHU_ENABLED,
    appId: process.env.FEISHU_APP_ID,
    appSecret: process.env.FEISHU_APP_SECRET,
    taskChatId: process.env.FEISHU_TASK_CHAT_ID,
    publicUrl: process.env.IBD_PUBLIC_URL,
  };
  process.env.FEISHU_ENABLED = 'true';
  process.env.FEISHU_APP_ID = 'cli_test';
  process.env.FEISHU_APP_SECRET = 'test-secret';
  process.env.FEISHU_TASK_CHAT_ID = 'oc_task_group';
  process.env.IBD_PUBLIC_URL = 'https://ibd.example.com';
  resetTokenCache();

  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/tenant_access_token/internal')) {
      return jsonResponse({ code: 0, tenant_access_token: 'tenant-token', expire: 7200 });
    }
    return jsonResponse({ code: 0, data: { message_id: 'om_test' } });
  };

  try {
    const result = await notifyTaskCreated(
      {
        title: '补齐项目材料',
        projectName: '测试项目',
        createdByName: '创建人',
        dueAt: '2026-08-01',
        description: '请补齐材料。',
      },
      [{ id: 'IBD-00001', name: '接收人', feishuOpenId: 'ou_recipient' }],
    );

    assert.equal(result.sent, 1);
    assert.equal(result.skipped, 0);
    assert.equal(result.failures.length, 0);
    assert.equal(calls.length, 2);
    assert.match(calls[1].url, /receive_id_type=chat_id/);
    const messageBody = JSON.parse(calls[1].options.body);
    assert.equal(messageBody.receive_id, 'oc_task_group');
    assert.equal(messageBody.msg_type, 'interactive');
    const card = JSON.parse(messageBody.content);
    assert.match(card.elements[0].content, /<at id="ou_recipient"><\/at>/);
    assert.match(card.elements[0].content, /https:\/\/ibd\.example\.com\/tasks/);
  } finally {
    global.fetch = originalFetch;
    process.env.FEISHU_ENABLED = originalEnv.enabled;
    process.env.FEISHU_APP_ID = originalEnv.appId;
    process.env.FEISHU_APP_SECRET = originalEnv.appSecret;
    process.env.FEISHU_TASK_CHAT_ID = originalEnv.taskChatId;
    process.env.IBD_PUBLIC_URL = originalEnv.publicUrl;
    resetTokenCache();
  }
});

test('disabled Feishu integration skips notification without a network request', async () => {
  const originalFetch = global.fetch;
  const originalEnabled = process.env.FEISHU_ENABLED;
  process.env.FEISHU_ENABLED = 'false';
  let called = false;
  global.fetch = async () => {
    called = true;
    throw new Error('should not be called');
  };

  try {
    const result = await notifyTaskCreated(
      { title: '测试任务' },
      [{ id: 'IBD-00001', name: '接收人', email: 'recipient@example.com' }],
    );
    assert.equal(result.enabled, false);
    assert.equal(result.sent, 0);
    assert.equal(called, false);
  } finally {
    global.fetch = originalFetch;
    process.env.FEISHU_ENABLED = originalEnabled;
  }
});

test('Feishu task notification falls back to an exact unique directory name', async () => {
  const originalFetch = global.fetch;
  const originalEnv = {
    enabled: process.env.FEISHU_ENABLED,
    appId: process.env.FEISHU_APP_ID,
    appSecret: process.env.FEISHU_APP_SECRET,
    taskChatId: process.env.FEISHU_TASK_CHAT_ID,
  };
  process.env.FEISHU_ENABLED = 'true';
  process.env.FEISHU_APP_ID = 'cli_test';
  process.env.FEISHU_APP_SECRET = 'test-secret';
  process.env.FEISHU_TASK_CHAT_ID = 'oc_task_group';
  resetTokenCache();

  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/tenant_access_token/internal')) {
      return jsonResponse({ code: 0, tenant_access_token: 'tenant-token', expire: 7200 });
    }
    if (url.includes('/contact/v3/departments/0/children')) {
      return jsonResponse({ code: 0, data: { items: [], has_more: false } });
    }
    if (url.includes('/contact/v3/users/find_by_department')) {
      return jsonResponse({
        code: 0,
        data: {
          items: [{ name: '接收人', open_id: 'ou_recipient', status: { is_resigned: false } }],
          has_more: false,
        },
      });
    }
    return jsonResponse({ code: 0, data: { message_id: 'om_test' } });
  };

  try {
    const result = await notifyTaskCreated(
      { title: '按姓名通知' },
      [{ id: 'IBD-00001', name: '接收人', email: '' }],
    );
    assert.equal(result.sent, 1);
    assert.equal(result.skipped, 0);
    assert.equal(calls.length, 4);
    const messageBody = JSON.parse(calls[3].options.body);
    assert.equal(messageBody.receive_id, 'oc_task_group');
    assert.match(JSON.parse(messageBody.content).elements[0].content, /<at id="ou_recipient"><\/at>/);
  } finally {
    global.fetch = originalFetch;
    process.env.FEISHU_ENABLED = originalEnv.enabled;
    process.env.FEISHU_APP_ID = originalEnv.appId;
    process.env.FEISHU_APP_SECRET = originalEnv.appSecret;
    process.env.FEISHU_TASK_CHAT_ID = originalEnv.taskChatId;
    resetTokenCache();
  }
});
