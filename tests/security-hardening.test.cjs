const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createRateLimiter } = require('../server/middleware/rateLimit.cjs');
const {
  MAX_AVATAR_BYTES,
  MAX_CLOUD_FILE_BYTES,
  decodeAvatarDataUri,
  validateCloudFileName,
} = require('../server/services/uploadValidation.cjs');

test('avatar validation accepts a small JPEG and rejects disguised content', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const decoded = decodeAvatarDataUri(`data:image/jpeg;base64,${jpeg.toString('base64')}`);
  assert.deepEqual(decoded, jpeg);
  assert.throws(
    () => decodeAvatarDataUri(`data:image/jpeg;base64,${Buffer.from('not-jpeg').toString('base64')}`),
    /JPEG/,
  );
  assert.throws(
    () => decodeAvatarDataUri(`data:image/jpeg;base64,${Buffer.alloc(MAX_AVATAR_BYTES + 1).toString('base64')}`),
    /1MB/,
  );
});

test('cloud upload validation blocks scripts and keeps the 100MB limit explicit', () => {
  assert.equal(MAX_CLOUD_FILE_BYTES, 100 * 1024 * 1024);
  assert.equal(validateCloudFileName('项目进度.xlsx').ok, true);
  assert.equal(validateCloudFileName('运行脚本.ps1').ok, false);
  assert.equal(validateCloudFileName('程序.exe').ok, false);
  assert.equal(validateCloudFileName('bad\u0000name.pdf').ok, false);
  assert.equal(validateCloudFileName('../合同.pdf').ok, false);
  assert.equal(validateCloudFileName('合同?.pdf').ok, false);
  assert.equal(validateCloudFileName('...').ok, false);
});

test('tool and skill uploads allow every expected multipart field', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server/routes/tools.cjs'), 'utf8');
  assert.match(source, /files:\s*1/);
  assert.match(source, /fields:\s*5/);
  assert.match(source, /parts:\s*8/);
  assert.match(source, /TOOL_UPLOAD_LIMIT = 8 \* 1024 \* 1024/);
});

test('cloud drive exposes authenticated context-menu rename with validation and conflict checks', () => {
  const root = path.join(__dirname, '..');
  const routeSource = fs.readFileSync(path.join(root, 'server/routes/clouddrive.cjs'), 'utf8');
  const pageSource = fs.readFileSync(path.join(root, 'src/pages/CloudDrive.tsx'), 'utf8');

  assert.match(routeSource, /router\.put\('\/:id\/name', authMiddleware, requireRole\('user', 'admin'\)/);
  assert.match(routeSource, /validateCloudFileName\(requestedName\)/);
  assert.match(routeSource, /云盘中已存在同名文件/);
  assert.match(routeSource, /重命名不能修改文件扩展名/);
  assert.match(routeSource, /clouddrive\.rename/);
  assert.match(pageSource, /onContextMenu=\{event => openFileContextMenu\(event, file\)\}/);
  assert.match(pageSource, /data-cloud-drive-context-menu/);
  assert.doesNotMatch(pageSource, /双击重命名/);
  assert.match(pageSource, /event\.key === 'Enter'/);
  assert.match(pageSource, /event\.key === 'Escape'/);
});

test('rate limiter returns 429 after the configured request count', () => {
  const limiter = createRateLimiter({ windowMs: 60_000, max: 2, keyGenerator: () => 'same-user' });
  const req = { ip: '127.0.0.1', socket: {} };
  const calls = [];
  const makeRes = () => ({
    headers: {},
    statusCode: 200,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { calls.push({ status: this.statusCode, body }); return this; },
  });
  let passed = 0;
  limiter(req, makeRes(), () => { passed += 1; });
  limiter(req, makeRes(), () => { passed += 1; });
  limiter(req, makeRes(), () => { passed += 1; });
  assert.equal(passed, 2);
  assert.equal(calls.at(-1).status, 429);
});

test('database persistence uses bounded batching and atomic replacement', () => {
  const root = path.join(__dirname, '..');
  const source = fs.readFileSync(path.join(root, 'server/db.cjs'), 'utf8');
  assert.match(source, /SAVE_MAX_WAIT_MS = 10000/);
  assert.match(source, /fs\.fsyncSync\(fd\)/);
  assert.match(source, /fs\.renameSync\(tempPath, DB_PATH\)/);
  assert.doesNotMatch(source, /fs\.writeFileSync\(DB_PATH, buffer\)/);
});

test('login, registration and uploads have rate limits', () => {
  const root = path.join(__dirname, '..');
  const authSource = fs.readFileSync(path.join(root, 'server/routes/auth.cjs'), 'utf8');
  const cloudSource = fs.readFileSync(path.join(root, 'server/routes/clouddrive.cjs'), 'utf8');
  const toolSource = fs.readFileSync(path.join(root, 'server/routes/tools.cjs'), 'utf8');
  assert.match(authSource, /loginIpLimiter, limitLoginAccount/);
  assert.match(authSource, /return loginAccountLimiter\(req, res, next\)/);
  assert.match(authSource, /selfRegistrationLimiter/);
  assert.match(cloudSource, /uploadRateLimiter/);
  assert.match(toolSource, /uploadRateLimiter/);
});

test('production CORS requires an explicit origin allow-list', () => {
  const root = path.join(__dirname, '..');
  const source = fs.readFileSync(path.join(root, 'server/index.cjs'), 'utf8');
  assert.match(source, /process\.env\.CORS_ORIGINS/);
  assert.match(source, /process\.env\.NODE_ENV !== 'production'/);
  assert.doesNotMatch(source, /app\.use\(cors\(\)\)/);
});

test('public demo visitors can browse and preview reports but cannot modify shared data or access API keys', () => {
  const { publicDemoAllowsRequest } = require('../server/services/publicDemo.cjs');
  const allowed = (method, originalUrl) => publicDemoAllowsRequest({ method, originalUrl });
  assert.equal(allowed('GET', '/api/tasks'), true);
  assert.equal(allowed('POST', '/api/weekly-reports/preview'), true);
  assert.equal(allowed('POST', '/api/auth/logout'), true);
  assert.equal(allowed('POST', '/api/products'), false);
  assert.equal(allowed('PUT', '/api/auth/password'), false);
  assert.equal(allowed('GET', '/api/api-keys/mine/?x=1'), false);
});
