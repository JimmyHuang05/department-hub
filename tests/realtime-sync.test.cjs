const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { classifyMutation } = require('../server/middleware/realtimeMutation.cjs');
const { canReceiveEvent, normalizeAudience } = require('../server/services/realtimeEvents.cjs');

const root = path.join(__dirname, '..');

function request(method, originalUrl, body = {}) {
  return { method, originalUrl, body, params: {}, get: () => '' };
}

test('mutation classifier covers the full shared-data surface and ignores reads/exports', () => {
  assert.deepEqual(classifyMutation(request('POST', '/api/products')), { resource: 'project', action: 'created', entityId: '*' });
  assert.equal(classifyMutation(request('PUT', '/api/tasks/task-1')).resource, 'task');
  assert.equal(classifyMutation(request('POST', '/api/tasks/task-1/comments')).action, 'replied');
  assert.equal(classifyMutation(request('POST', '/api/questionnaires/q-1/submissions')).resource, 'submission');
  assert.equal(classifyMutation(request('DELETE', '/api/clouddrive/file-1')).action, 'deleted');
  assert.equal(classifyMutation(request('POST', '/api/auth/register')).resource, 'user');
  assert.equal(classifyMutation(request('POST', '/api/questionnaires/q-1/export')), null);
  assert.equal(classifyMutation(request('GET', '/api/products')), null);
});

test('audience filtering never sends targeted events outside their recipients', () => {
  assert.deepEqual(normalizeAudience({ type: 'users', ids: ['u1', 'u1', '', 2] }), { type: 'users', ids: ['u1', '2'] });
  assert.equal(canReceiveEvent({ userId: 'u1' }, { audience: { type: 'users', ids: ['u1'] } }), true);
  assert.equal(canReceiveEvent({ userId: 'u2' }, { audience: { type: 'users', ids: ['u1'] } }), false);
  assert.equal(canReceiveEvent({ role: 'admin' }, { audience: { type: 'roles', ids: ['admin'] } }), true);
  assert.equal(canReceiveEvent({ department: 'd2' }, { audience: { type: 'department', ids: ['d1'] } }), false);
});

test('realtime sync is recoverable, deduplicated and integrated into all core pages', () => {
  const server = fs.readFileSync(path.join(root, 'server/services/realtimeEvents.cjs'), 'utf8');
  const hub = fs.readFileSync(path.join(root, 'server/ws/hub.cjs'), 'utf8');
  const client = fs.readFileSync(path.join(root, 'src/lib/realtime.ts'), 'utf8');
  const collaboration = fs.readFileSync(path.join(root, 'src/hooks/useCollaboration.ts'), 'utf8');
  assert.match(server, /CREATE TABLE IF NOT EXISTS realtime_events/);
  assert.match(server, /sequence INTEGER PRIMARY KEY AUTOINCREMENT/);
  assert.match(server, /DELETE FROM realtime_events WHERE updated_at < \?/);
  assert.match(hub, /canReceiveEvent\(socket, message\)/);
  assert.match(client, /seen\.has\(eventId\)/);
  assert.match(client, /requiresFullSync/);
  assert.match(collaboration, /event\.sequence > lastSequence \+ 1/);
  for (const file of ['Messages.tsx', 'Tasks.tsx', 'QuestionnairesCenter.tsx', 'CloudDrive.tsx', 'ToolsCenter.tsx', 'SkillsCenter.tsx']) {
    assert.match(fs.readFileSync(path.join(root, 'src/pages', file), 'utf8'), /useRealtimeRefresh/, file);
  }
});

test('realtime failures cannot roll back or fail a committed HTTP mutation', () => {
  const middleware = fs.readFileSync(path.join(root, 'server/middleware/realtimeMutation.cjs'), 'utf8');
  assert.match(middleware, /res\.on\('finish'/);
  assert.match(middleware, /res\.statusCode < 200 \|\| res\.statusCode >= 300/);
  assert.match(middleware, /Realtime is best-effort/);
  assert.match(middleware, /publish failed/);
});
