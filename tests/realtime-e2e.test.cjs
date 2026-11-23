const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { WebSocket } = require('ws');

const root = path.join(__dirname, '..');

async function waitForHealth(baseUrl, process, logs) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (process.exitCode != null) throw new Error(`server exited ${process.exitCode}: ${logs.join('')}`);
    try { if ((await fetch(`${baseUrl}/healthz`)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`server did not become healthy: ${logs.join('')}`);
}

async function api(baseUrl, route, token, options = {}) {
  const response = await fetch(`${baseUrl}/api${route}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(body)}`);
  return body;
}

async function login(baseUrl, username, password, deviceId) {
  return api(baseUrl, '/auth/login', '', { method: 'POST', body: JSON.stringify({ username, password, deviceId, deviceType: 'desktop', force: true }) });
}

function connectClient(wsUrl, token) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    const timer = setTimeout(() => reject(new Error('websocket auth timeout')), 5000);
    socket.on('open', () => socket.send(JSON.stringify({ type: 'auth', token })));
    socket.on('message', raw => {
      const message = JSON.parse(raw.toString());
      if (message.type === 'auth-ok') { clearTimeout(timer); resolve(socket); }
    });
    socket.on('error', reject);
  });
}

function nextDataChange(socket) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('data-change timeout')), 5000);
    const listener = raw => {
      const message = JSON.parse(raw.toString());
      if (message.type !== 'data-change') return;
      clearTimeout(timer);
      socket.off('message', listener);
      resolve(message);
    };
    socket.on('message', listener);
  });
}

test('two authenticated users receive live changes and a disconnected user recovers the gap', { timeout: 30000 }, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ibd-realtime-e2e-'));
  const port = 32000 + Math.floor(Math.random() * 20000);
  const logs = [];
  const server = spawn(process.execPath, ['server/index.cjs'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port), IBD_HOST: '127.0.0.1', NODE_ENV: 'test', IBD_DATA_DIR: temp,
      IBD_TEST_PASSWORD: 'RealtimeTest!2026', IBD_JWT_SECRET: 'realtime-test-secret-with-more-than-32-characters',
      REALTIME_DATA_SYNC_ENABLED: 'true', REALTIME_RECOVERY_ENABLED: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', chunk => logs.push(chunk.toString()));
  server.stderr.on('data', chunk => logs.push(chunk.toString()));
  let firstSocket;
  let secondSocket;
  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(baseUrl, server, logs);
    const admin = await login(baseUrl, 'IBD-00001', 'RealtimeTest!2026', 'e2e-admin');
    await api(baseUrl, '/auth/register', admin.token, { method: 'POST', body: JSON.stringify({ display_name: 'Realtime User', password: 'RealtimeTest!2026', role: 'user', business_role: 'intern', email: '' }) });
    const users = await api(baseUrl, '/auth/users', admin.token);
    const secondId = users.users.find(user => user.display_name === 'Realtime User').id;
    const member = await login(baseUrl, secondId, 'RealtimeTest!2026', 'e2e-member');

    firstSocket = await connectClient(`ws://127.0.0.1:${port}/ws`, admin.token);
    secondSocket = await connectClient(`ws://127.0.0.1:${port}/ws`, member.token);
    const firstForAdmin = nextDataChange(firstSocket);
    const firstForMember = nextDataChange(secondSocket);
    await api(baseUrl, '/questionnaires', admin.token, { method: 'POST', body: JSON.stringify({ title: 'Realtime E2E 1', fields: [] }), headers: { 'X-Mutation-ID': 'e2e-first' } });
    const [adminEvent, memberEvent] = await Promise.all([firstForAdmin, firstForMember]);
    assert.equal(adminEvent.resource, 'questionnaire');
    assert.equal(memberEvent.eventId, adminEvent.eventId);
    assert.ok(adminEvent.sequence > 0);

    secondSocket.close();
    await new Promise(resolve => secondSocket.once('close', resolve));
    const nextForAdmin = nextDataChange(firstSocket);
    await api(baseUrl, '/questionnaires', admin.token, { method: 'POST', body: JSON.stringify({ title: 'Realtime E2E 2', fields: [] }), headers: { 'X-Mutation-ID': 'e2e-second' } });
    const secondEvent = await nextForAdmin;
    const recovery = await api(baseUrl, `/realtime/changes?after=${adminEvent.sequence}`, member.token);
    assert.ok(recovery.events.some(event => event.eventId === secondEvent.eventId));
    assert.ok(recovery.latestSequence >= secondEvent.sequence);
  } finally {
    firstSocket?.close(); secondSocket?.close();
    server.kill('SIGTERM');
    await new Promise(resolve => { server.once('exit', resolve); setTimeout(resolve, 2000); });
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
