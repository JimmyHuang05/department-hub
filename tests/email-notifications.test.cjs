const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  notifyTaskCreatedByEmail,
  notifyTaskMentionByEmail,
  notifyQuestionnaireSubmissionByEmail,
  sendBirthdayReminderEmails,
  sendWeeklyTodoEmails,
  resetTransporterCache,
  setTransportFactoryForTests,
} = require('../server/services/emailNotifications.cjs');

const envKeys = [
  'SMTP_ENABLED',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_SECURE',
  'SMTP_USER',
  'SMTP_AUTH_CODE',
  'SMTP_FROM_NAME',
  'IBD_PUBLIC_URL',
];

function saveEnv() {
  return Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
}

function restoreEnv(original) {
  for (const key of envKeys) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
  setTransportFactoryForTests();
  resetTransporterCache();
}

function enableTestSmtp() {
  process.env.SMTP_ENABLED = 'true';
  process.env.SMTP_HOST = 'smtp.qq.com';
  process.env.SMTP_PORT = '465';
  process.env.SMTP_SECURE = 'true';
  process.env.SMTP_USER = 'sender@qq.com';
  process.env.SMTP_AUTH_CODE = 'test-authorization-code';
  process.env.SMTP_FROM_NAME = 'IBD Link 任务助手';
  process.env.IBD_PUBLIC_URL = 'https://ibd.example.com';
}

test('QQ SMTP sends a separate task email to every valid unique recipient', async () => {
  const original = saveEnv();
  enableTestSmtp();
  const sent = [];
  let transportOptions;
  setTransportFactoryForTests(options => {
    transportOptions = options;
    return { sendMail: async message => { sent.push(message); return { messageId: 'test' }; } };
  });

  try {
    const result = await notifyTaskCreatedByEmail(
      {
        title: '补齐项目材料',
        projectName: '测试项目',
        createdByName: '创建人',
        dueAt: '2026-08-04',
        description: '请及时处理',
      },
      [
        { id: 'u1', name: '甲', email: 'one@example.com' },
        { id: 'u2', name: '乙', email: 'two@example.com' },
        { id: 'u3', name: '重复', email: 'ONE@example.com' },
      ],
    );

    assert.equal(result.sent, 2);
    assert.equal(result.skipped, 1);
    assert.equal(result.failures.length, 0);
    assert.equal(sent.length, 2);
    assert.equal(transportOptions.host, 'smtp.qq.com');
    assert.equal(transportOptions.port, 465);
    assert.equal(transportOptions.secure, true);
    assert.deepEqual(sent.map(message => message.to.address), ['one@example.com', 'two@example.com']);
    assert.match(sent[0].subject, /补齐项目材料/);
    assert.match(sent[0].html, /https:\/\/ibd\.example\.com\/tasks/);
  } finally {
    restoreEnv(original);
  }
});

test('email notification skips recipients without a valid email address', async () => {
  const original = saveEnv();
  enableTestSmtp();
  let called = false;
  setTransportFactoryForTests(() => ({
    sendMail: async () => { called = true; },
  }));

  try {
    const result = await notifyTaskCreatedByEmail(
      { title: '测试任务' },
      [{ id: 'u1', name: '无邮箱', email: '' }, { id: 'u2', name: '错误邮箱', email: 'invalid' }],
    );
    assert.equal(result.sent, 0);
    assert.equal(result.skipped, 2);
    assert.equal(called, false);
  } finally {
    restoreEnv(original);
  }
});

test('task mention sends one email per unique mentioned member with a direct reply link', async () => {
  const original = saveEnv();
  enableTestSmtp();
  const sent = [];
  setTransportFactoryForTests(() => ({
    sendMail: async message => { sent.push(message); return { messageId: 'mention' }; },
  }));
  try {
    const result = await notifyTaskMentionByEmail(
      { id: 'task-1', title: '港股项目分析' },
      { id: 'sender', name: '王清扬' },
      { id: 'comment-8', content: '@陈静 请补充发行人情况' },
      [
        { id: 'u1', name: '陈静', email: 'chen@example.com' },
        { id: 'u2', name: '重复邮箱', email: 'CHEN@example.com' },
        { id: 'u3', name: '无邮箱', email: '' },
      ],
    );
    assert.equal(result.sent, 1);
    assert.equal(result.skipped, 2);
    assert.equal(sent.length, 1);
    assert.match(sent[0].subject, /王清扬/);
    assert.match(sent[0].subject, /港股项目分析/);
    assert.match(sent[0].html, /@陈静 请补充发行人情况/);
    assert.match(sent[0].html, /\/discussions\?taskId=task-1&amp;commentId=comment-8/);
  } finally {
    restoreEnv(original);
  }
});

test('disabled email integration makes no SMTP request', async () => {
  const original = saveEnv();
  process.env.SMTP_ENABLED = 'false';
  let called = false;
  setTransportFactoryForTests(() => ({
    sendMail: async () => { called = true; },
  }));

  try {
    const result = await notifyTaskCreatedByEmail(
      { title: '测试任务' },
      [{ id: 'u1', name: '收件人', email: 'one@example.com' }],
    );
    assert.equal(result.enabled, false);
    assert.equal(result.sent, 0);
    assert.equal(called, false);
  } finally {
    restoreEnv(original);
  }
});

test('weekly todo email sends one personalized digest per member', async () => {
  const original = saveEnv();
  enableTestSmtp();
  const sent = [];
  setTransportFactoryForTests(() => ({
    sendMail: async message => { sent.push(message); return { messageId: 'weekly' }; },
  }));

  try {
    const result = await sendWeeklyTodoEmails([
      {
        id: 'u1',
        name: '甲',
        email: 'one@example.com',
        weekStart: '2026-08-03',
        weekEnd: '2026-08-09',
        tasks: [
          { title: '补齐项目材料', projectName: '测试项目', dueLabel: '2026-08-05', overdue: false },
          { title: '处理逾期事项', dueLabel: '已逾期 · 2026-08-01', overdue: true },
        ],
      },
      {
        id: 'u2',
        name: '乙',
        email: 'two@example.com',
        weekStart: '2026-08-03',
        weekEnd: '2026-08-09',
        tasks: [],
      },
    ]);

    assert.equal(result.sent, 2);
    assert.equal(result.failures.length, 0);
    assert.equal(sent.length, 2);
    assert.match(sent[0].subject, /本周待办/);
    assert.match(sent[0].html, /补齐项目材料/);
    assert.match(sent[0].html, /已逾期/);
    assert.match(sent[1].html, /本周暂无待办任务/);
  } finally {
    restoreEnv(original);
  }
});

test('birthday reminder sends only valid unique recipients without exposing birth year', async () => {
  const original = saveEnv();
  enableTestSmtp();
  const sent = [];
  setTransportFactoryForTests(() => ({
    sendMail: async message => { sent.push(message); return { messageId: 'birthday' }; },
  }));
  try {
    const result = await sendBirthdayReminderEmails(
      { id: 'birthday-user', name: 'Alice', birthdayLabel: '8月31日' },
      [
        { id: 'u1', name: 'Bob', email: 'bob@example.com' },
        { id: 'u2', name: 'Duplicate', email: 'BOB@example.com' },
        { id: 'u3', name: 'No email', email: '' },
      ],
    );
    assert.deepEqual(result.sent, ['u1']);
    assert.equal(result.skipped, 2);
    assert.equal(sent.length, 1);
    assert.match(sent[0].subject, /Alice/);
    assert.match(sent[0].html, /8月31日/);
    assert.doesNotMatch(sent[0].html, /2000/);
  } finally {
    restoreEnv(original);
  }
});

test('questionnaire notification attaches uploaded answer files', async () => {
  const original = saveEnv();
  enableTestSmtp();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ibd-questionnaire-email-'));
  const storedName = 'stored-document.pdf';
  const filePath = path.join(tempDir, storedName);
  fs.writeFileSync(filePath, 'test attachment');
  let sentMessage;
  setTransportFactoryForTests(() => ({
    sendMail: async message => { sentMessage = message; return { messageId: 'questionnaire' }; },
  }));

  try {
    const result = await notifyQuestionnaireSubmissionByEmail(
      {
        questionnaireTitle: 'Attachment test',
        submittedAt: '2026-08-07',
        attachmentDirectory: tempDir,
        attachments: [{ storedName, fileName: 'customer-document.pdf', fileSize: 15, mimeType: 'application/pdf' }],
      },
      { id: 'u1', name: 'Manager', email: 'manager@example.com' },
    );
    assert.equal(result.sent, 1);
    assert.deepEqual(sentMessage.attachments, [{
      filename: 'customer-document.pdf',
      path: filePath,
      contentType: 'application/pdf',
    }]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
    restoreEnv(original);
  }
});
