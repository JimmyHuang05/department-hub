const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
const cors = require('cors');
const { WebSocketServer } = require('ws');

// 本地启动时自动读取未纳入版本控制的 .env；容器/部署平台环境变量仍具有更高优先级。
if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(path.join(__dirname, '..', '.env'));
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('[env] 加载 .env 失败:', error.message);
  }
}

const { getDb, getDbSync, saveDb, saveDbImmediate, closeDb } = require('./db.cjs');
const { authMiddleware, requireRole } = require('./middleware/auth.cjs');
const { createRateLimiter } = require('./middleware/rateLimit.cjs');
const { decodeAvatarDataUri } = require('./services/uploadValidation.cjs');
const { handleConnection } = require('./ws/hub.cjs');
const { AVATAR_DIR, HTML_TOOLS_DIR } = require('./paths.cjs');
const { startScheduledJobs, stopScheduledJobs } = require('./services/scheduledJobs.cjs');
const { startWeekRollover, stopWeekRollover } = require('./services/weekRollover.cjs');
const { startDatabaseBackups, stopDatabaseBackups } = require('./services/databaseBackup.cjs');
const { migrateProjectRelations } = require('./services/projectRelations.cjs');
const { skillVersionHeaders } = require('./services/skillVersion.cjs');
const { createErrorCode } = require('./services/errorCodes.cjs');
const { createIncidentId, recordErrorEvent } = require('./services/errorEvents.cjs');
const { realtimeMutationMiddleware } = require('./middleware/realtimeMutation.cjs');
const { ensureRealtimeSchema } = require('./services/realtimeEvents.cjs');
const LEGACY_HTML_TOOLS_DIR = path.join(__dirname, '..', 'data', 'tools', 'html');

const { initializePublicDemo, getPublicDemoCredentials } = require('./services/publicDemo.cjs');

const app = express();
if (process.env.IBD_TRUST_PROXY === 'loopback') app.set('trust proxy', 'loopback');
const PORT = process.env.PORT || 3000;
const SERVER_HOST = String(process.env.IBD_HOST || '0.0.0.0').trim() || '0.0.0.0';
const demoLoginEnabled = process.env.NODE_ENV !== 'production'
  && ['127.0.0.1', '::1'].includes(SERVER_HOST)
  && process.env.IBD_DEMO_LOGIN === '1'
  && process.env.IBD_LOCAL_ADMIN_PASSWORD === '123456';

app.get('/healthz', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!getDbSync()) {
    return res.status(503).json({ status: 'starting' });
  }
  return res.json({ status: 'ok' });
});

// 鑾峰彇灞€鍩熺綉 IP
function getLanIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}
const LAN_IP = getLanIP();

const allowedCorsOrigins = new Set(
  String(process.env.CORS_ORIGINS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean),
);
app.use(cors({
  origin(origin, callback) {
    if (!origin || process.env.NODE_ENV !== 'production' || allowedCorsOrigins.has(origin)) {
      return callback(null, true);
    }
    return callback(null, false);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type', 'X-API-Key', 'X-Mutation-ID', 'X-IBD-Skill-Version', 'X-Sheet-Session-Id', 'X-Sheet-Session-Token', 'X-Sheet-Expected-Checksum', 'X-Sheet-Expected-Revision'],
  exposedHeaders: ['X-IBD-Skill-Version', 'X-IBD-Skill-Updated-At', 'X-IBD-Skill-URL', 'X-IBD-Skill-Update'],
  maxAge: 86400,
}));
app.use('/api/upload/avatar', express.json({ limit: '2mb' }));
app.use(express.json({ limit: '2mb' }));
app.use(realtimeMutationMiddleware);

// 所有 API 错误自动附带稳定错误代码，便于用户上报和维护定位。
app.use('/api', (req, res, next) => {
  const startedAt = Date.now();
  const sendJson = res.json.bind(res);
  res.json = body => {
    if (res.statusCode >= 400 && body && typeof body === 'object') {
      const errorCode = body.errorCode || createErrorCode(req, res.statusCode);
      const incidentId = body.incidentId || createIncidentId();
      body = { ...body, errorCode, incidentId };
      recordErrorEvent({
        incidentId,
        errorCode,
        status: res.statusCode,
        req,
        message: body.error || body.message || '请求失败',
        durationMs: Date.now() - startedAt,
      });
    }
    return sendJson(body);
  };
  next();
});

app.get('/api/demo-login', (req, res) => {
  const publicDemo = getPublicDemoCredentials();
  res.set('Cache-Control', 'no-store').json({
    enabled: Boolean(publicDemo || demoLoginEnabled),
    ...(publicDemo || {}),
  });
});

app.get('/api/demo-data', authMiddleware, async (req, res) => {
  const db = await getDb();
  const synthetic = db.exec("SELECT 1 FROM settings WHERE id='demo-dataset'").length > 0;
  res.set('Cache-Control', 'no-store').json({ synthetic });
});

app.get('/api/server-info', (req, res) => {
  res.json({ lanIP: LAN_IP, port: PORT });
});

// API 璺敱
app.use('/api/auth', require('./routes/auth.cjs'));
app.use('/api/entries', require('./routes/entries.cjs'));
app.use('/api/weekly-reports', require('./routes/weekly-reports.cjs'));
app.use('/api/products', require('./routes/products.cjs'));
app.use('/api/settings', require('./routes/settings.cjs'));
app.use('/api/preferences', require('./routes/preferences.cjs'));
app.use('/api/history', require('./routes/history.cjs'));
app.use('/api/api-keys', require('./routes/api-keys.cjs'));
app.use('/api/integration', skillVersionHeaders);
app.use('/api/integration', require('./routes/integration-openapi.cjs'));
app.use('/api/integration/v1', require('./routes/integration.cjs'));
app.use('/api/agent', skillVersionHeaders);
app.use('/api/agent/v1', require('./routes/agent.cjs'));
app.use('/api/audit', require('./routes/audit.cjs'));
app.use('/api/error-events', require('./routes/error-events.cjs'));
app.use('/api/backups', require('./routes/backups.cjs'));
app.use('/api/scheduled-jobs', require('./routes/scheduled-jobs.cjs'));
app.use('/api/tasks', require('./routes/tasks.cjs'));
app.use('/api/notifications', require('./routes/notifications.cjs'));
app.use('/api/realtime', require('./routes/realtime.cjs'));
app.use('/api/tools', require('./routes/tools.cjs'));
app.use('/api/questionnaires', require('./routes/questionnaire-module.cjs'));

function setToolHostHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "sandbox allow-scripts allow-forms allow-popups; default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; frame-ancestors 'self';");
}

const TOOL_SCROLLBAR_STYLE = `<style id="ibd-scrollbar-style">
*{scrollbar-width:thin;scrollbar-color:rgba(100,116,139,.38) transparent}
::-webkit-scrollbar{width:3px;height:3px;-webkit-appearance:none}
::-webkit-scrollbar-track{border:0;background:transparent}
::-webkit-scrollbar-thumb{min-width:24px;min-height:24px;border:0;border-radius:0;background:rgba(100,116,139,.38)}
::-webkit-scrollbar-thumb:hover{background:rgba(71,85,105,.58)}
::-webkit-scrollbar-button,::-webkit-scrollbar-button:single-button,::-webkit-scrollbar-button:double-button,::-webkit-scrollbar-button:horizontal:start:decrement,::-webkit-scrollbar-button:horizontal:end:increment,::-webkit-scrollbar-button:vertical:start:decrement,::-webkit-scrollbar-button:vertical:end:increment{display:none!important;width:0!important;height:0!important;border:0!important;background:transparent!important;-webkit-appearance:none}
::-webkit-scrollbar-corner{background:transparent}
</style>`;

function sendToolHtml(res, filePath) {
  const html = fs.readFileSync(filePath, 'utf8');
  const styledHtml = /<\/head\s*>/i.test(html)
    ? html.replace(/<\/head\s*>/i, `${TOOL_SCROLLBAR_STYLE}</head>`)
    : `${TOOL_SCROLLBAR_STYLE}${html}`;
  res.type('html').send(styledHtml);
}

app.get('/tools-host/:id/current/index.html', (req, res) => {
  try {
    const db = getDbSync();
    if (!db) return res.status(404).send('Not found');
    const itemStmt = db.prepare('SELECT current_version_id, status FROM tool_items WHERE id = ? AND type = ?');
    itemStmt.bind([req.params.id, 'html_tool']);
    const item = itemStmt.step() ? itemStmt.getAsObject() : null;
    itemStmt.free();
    if (!item || item.status !== 'active') return res.status(404).send('Not found');

    const versionStmt = db.prepare('SELECT version_no, stored_name, stored_path FROM tool_versions WHERE id = ?');
    versionStmt.bind([item.current_version_id]);
    const version = versionStmt.step() ? versionStmt.getAsObject() : null;
    versionStmt.free();
    const currentPath = version?.stored_path || '';
    const storedName = version?.stored_name || 'index.html';
    const versionNo = Number(version?.version_no) || 1;
    const filePath = currentPath && fs.existsSync(currentPath)
      ? currentPath
      : [
        path.join(HTML_TOOLS_DIR, req.params.id, `v${versionNo}`, storedName),
        path.join(LEGACY_HTML_TOOLS_DIR, req.params.id, `v${versionNo}`, storedName),
      ].find(candidate => fs.existsSync(candidate));
    if (!version || !filePath || !fs.existsSync(filePath)) return res.status(404).send('Not found');

    db.run('UPDATE tool_items SET view_count = COALESCE(view_count, 0) + 1 WHERE id = ?', [req.params.id]);
    saveDb();
    setToolHostHeaders(res);
    sendToolHtml(res, filePath);
  } catch (e) {
    res.status(500).send('Tool host error');
  }
});

app.get('/tools-host/:id/v:versionNo/index.html', (req, res) => {
  try {
    const versionNo = Number(req.params.versionNo);
    if (!Number.isInteger(versionNo) || versionNo < 1) return res.status(404).send('Not found');
    const candidates = [
      path.join(HTML_TOOLS_DIR, req.params.id, `v${versionNo}`, 'index.html'),
      path.join(LEGACY_HTML_TOOLS_DIR, req.params.id, `v${versionNo}`, 'index.html'),
    ];
    const resolved = candidates.map(candidate => path.resolve(candidate)).find(candidate => {
      const base = candidate.includes(path.resolve(LEGACY_HTML_TOOLS_DIR))
        ? path.resolve(LEGACY_HTML_TOOLS_DIR)
        : path.resolve(HTML_TOOLS_DIR);
      return candidate.startsWith(base + path.sep) && fs.existsSync(candidate);
    });
    if (!resolved) return res.status(404).send('Not found');
    setToolHostHeaders(res);
    sendToolHtml(res, resolved);
  } catch (e) {
    res.status(500).send('Tool host error');
  }
});
app.use('/api/clouddrive', require('./routes/clouddrive.cjs'));
app.use('/api/sheet-editor', require('./routes/sheet-editor.cjs'));
app.post('/api/exchange-rate', authMiddleware, requireRole('user', 'admin'), (req, res) => {
  const { rate } = req.body;
  if (rate == null || isNaN(Number(rate))) {
    return res.status(400).json({ error: '无效的汇率' });
  }
  try {
    const db = getDbSync();
    const personalSettingsId = `user_exchange_rate:${req.user.id}`;
    const row = db.exec('SELECT data FROM settings WHERE id=?', [personalSettingsId]);
    let s;
    if (row && row[0] && row[0].values && row[0].values[0]) {
      s = JSON.parse(row[0].values[0][0]);
    } else {
      s = {};
    }
    s.exchangeRate = Number(rate);
    s.manualExchangeRate = Number(rate);
    s.exchangeRateMode = 'manual';
    s.exchangeRateUpdatedAt = new Date().toISOString();
    db.run('INSERT OR REPLACE INTO settings(id, data, updated_at) VALUES(?,?,?)',
      [personalSettingsId, JSON.stringify(s), new Date().toISOString()]);
    saveDbImmediate();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: '保存汇率失败: ' + e.message });
  }
});

const distPath = path.join(__dirname, '..', 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath, {
    setHeaders(res, filePath) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (path.basename(filePath) === 'index.html') {
        res.setHeader('Cache-Control', 'no-store, max-age=0');
      } else if (path.basename(filePath).toLowerCase() === 'skill.md') {
        res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
      } else if (path.relative(distPath, filePath).split(path.sep)[0] === 'assets') {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=3600');
      }
    },
  }));
  app.use((req, res, next) => {
    if (req.path.startsWith('/api') || !['GET', 'HEAD'].includes(req.method)) {
      return next();
    }

    // Missing scripts, styles and other files must be real 404 responses. Returning
    // index.html here makes browsers reject the response as an invalid JS module.
    if (path.extname(req.path)) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'no-store');
      return res.status(404).type('text/plain').send('Not found');
    }

    if (!req.accepts('html')) {
      return next();
    }

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.sendFile(path.join(distPath, 'index.html'));
  });
}

// 澶村儚瀛樺偍鐩綍
if (!fs.existsSync(AVATAR_DIR)) {
  fs.mkdirSync(AVATAR_DIR, { recursive: true });
}
app.use('/api/avatars', express.static(AVATAR_DIR, {
  setHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=86400');
  },
}));

let sharp;
try { sharp = require('sharp'); } catch (_) {}
const avatarUploadLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 30,
  keyGenerator: req => req.user?.id || req.ip,
  message: '头像上传过于频繁，请稍后再试',
});
app.post('/api/upload/avatar', authMiddleware, avatarUploadLimiter, async (req, res) => {
  const { image, userId } = req.body;
  let tempPath = '';
  if (!image) return res.status(400).json({ error: '缂哄皯鍥剧墖鏁版嵁' });
  try {
    const targetId = (userId && req.user.role === 'admin') ? userId : req.user.id;
    if (!/^IBD-\d{5}$/.test(String(targetId || ''))) {
      return res.status(400).json({ error: '用户编号无效' });
    }
    const filePath = path.join(AVATAR_DIR, `${targetId}.jpg`);
    tempPath = `${filePath}.${process.pid}.tmp`;
    const buf = decodeAvatarDataUri(image);

    if (sharp) {
      // 鍘嬬缉鍒?200x200, JPEG quality 60 鈫?閫氬父 <20KB
      await sharp(buf).resize(200, 200, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 60 }).toFile(tempPath);
    } else {
      fs.writeFileSync(tempPath, buf, { mode: 0o600 });
    }
    fs.renameSync(tempPath, filePath);
    tempPath = '';
    const oldPng = path.join(AVATAR_DIR, `${targetId}.png`);
    if (fs.existsSync(oldPng)) fs.unlinkSync(oldPng);
    res.json({ success: true, url: `/api/avatars/${targetId}.jpg?t=${Date.now()}` });
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: '涓婁紶澶辫触: ' + e.message });
  } finally {
    if (tempPath && fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath); } catch (_) {}
    }
  }
});

app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: '请求内容过大' });
  }
  if (res.headersSent) return next(err);
  console.error('[api-error]', err);
  const status = Number(err?.statusCode || err?.status) || 500;
  return res.status(status).json({
    error: process.env.NODE_ENV === 'production' && status >= 500 ? '服务器处理请求失败' : (err?.message || '服务器处理请求失败'),
    ...(err?.code && status < 500 ? { code: err.code } : {}),
  });
});

// Create HTTP server
const server = http.createServer(app);

// WebSocket server shares the HTTP port
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', handleConnection);

// 鍚姩
async function start() {
  const db = await getDb();
  initializePublicDemo(db);
  ensureRealtimeSchema(db);
  const relationMigration = migrateProjectRelations(db);
  if (relationMigration.entriesLinked || relationMigration.filesLinked || relationMigration.snapshotsLinked) {
    console.log('project relation migration:', relationMigration);
  }
  startWeekRollover();
  startDatabaseBackups();
  startScheduledJobs();
  server.listen(PORT, SERVER_HOST, () => {
    console.log(`鉁?鏈嶅姟鍣ㄥ凡鍚姩: http://${SERVER_HOST}:${PORT}`);
    console.log(`   WebSocket: ws://${SERVER_HOST}:${PORT}/ws`);
    if (SERVER_HOST === '0.0.0.0') {
      console.log(`   灞€鍩熺綉璁块棶: http://${LAN_IP}:${PORT}`);
    }
  });
}

start().catch(err => {
  console.error('鍚姩澶辫触:', err);
  process.exit(1);
});

['SIGINT', 'SIGTERM'].forEach(signal => {
  process.on(signal, () => {
    stopWeekRollover();
    stopDatabaseBackups();
    stopScheduledJobs();
    wss.close();
    server.close();
    closeDb();
    process.exit(0);
  });
});
