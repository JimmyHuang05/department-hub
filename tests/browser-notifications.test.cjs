const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const service = fs.readFileSync(path.join(root, 'server/services/notifications.cjs'), 'utf8');
const collaboration = fs.readFileSync(path.join(root, 'src/hooks/useCollaboration.ts'), 'utf8');
const preferences = fs.readFileSync(path.join(root, 'src/utils/browserNotifications.ts'), 'utf8');
const profile = fs.readFileSync(path.join(root, 'src/pages/Profile.tsx'), 'utf8');

test('new persisted messages are pushed only to their recipient users', () => {
  assert.match(service, /broadcastToUser\(userId/);
  assert.match(service, /type: 'notification-new'/);
  assert.match(collaboration, /wsClient\.on\('notification-new'/);
  assert.match(collaboration, /showRealtimeBrowserNotification\(user\.id/);
});

test('browser notification permission and sound are user-controlled preferences', () => {
  assert.match(preferences, /Notification\.requestPermission\(\)/);
  assert.match(preferences, /new Notification\(payload\.title/);
  assert.match(preferences, /createOscillator\(\)/);
  assert.match(profile, /桌面通知权限/);
  assert.match(profile, /label="浏览器通知"/);
  assert.match(profile, /label="消息提示音"/);
});
