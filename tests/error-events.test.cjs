const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createIncidentId } = require('../server/services/errorEvents.cjs');

test('error incidents use unique 16-character identifiers', () => {
  const ids = Array.from({ length: 100 }, () => createIncidentId());
  ids.forEach(id => assert.match(id, /^[A-F0-9]{16}$/));
  assert.equal(new Set(ids).size, ids.length);
});

test('API errors receive an incident id and are written without request bodies', () => {
  const root = path.join(__dirname, '..');
  const server = fs.readFileSync(path.join(root, 'server/index.cjs'), 'utf8');
  const events = fs.readFileSync(path.join(root, 'server/services/errorEvents.cjs'), 'utf8');
  const client = fs.readFileSync(path.join(root, 'src/utils/errorCodes.ts'), 'utf8');
  assert.match(server, /body = \{ \.\.\.body, errorCode, incidentId \}/);
  assert.match(events, /error-events-\$\{timestamp\.slice\(0, 10\)\}\.ndjson/);
  assert.doesNotMatch(events, /req\?\.body|req\.body/);
  assert.match(client, /事件编号：\$\{incidentId\}/);
});

test('event log is developer-only and appears below the audit log', () => {
  const root = path.join(__dirname, '..');
  const route = fs.readFileSync(path.join(root, 'server/routes/error-events.cjs'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
  const sidebar = fs.readFileSync(path.join(root, 'src/components/Layout/Sidebar.tsx'), 'utf8');
  assert.match(route, /requireBusinessRole\('developer'\)/);
  assert.match(app, /path:'\/admin\/error-events', developer:true/);
  assert.match(sidebar, /操作日志[\s\S]*事件日志/);
});
