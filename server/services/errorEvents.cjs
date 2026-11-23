const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { APP_ROOT } = require('../paths.cjs');

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const ERROR_LOG_DIR = process.env.IBD_ERROR_LOG_DIR
  ? path.resolve(process.env.IBD_ERROR_LOG_DIR)
  : path.join(APP_ROOT, 'logs');
let lastCleanupAt = 0;

function createIncidentId() {
  return crypto.randomBytes(8).toString('hex').toUpperCase();
}

function cleanText(value, limit = 500) {
  return String(value || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, limit);
}

function cleanupOldLogs(now = Date.now()) {
  if (now - lastCleanupAt < 24 * 60 * 60 * 1000) return;
  lastCleanupAt = now;
  try {
    fs.mkdirSync(ERROR_LOG_DIR, { recursive: true });
    for (const name of fs.readdirSync(ERROR_LOG_DIR)) {
      if (!/^error-events-\d{4}-\d{2}-\d{2}\.ndjson$/.test(name)) continue;
      const filePath = path.join(ERROR_LOG_DIR, name);
      if (now - fs.statSync(filePath).mtimeMs > RETENTION_MS) fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.error('[error-events] cleanup failed:', error.message);
  }
}

function recordErrorEvent({ incidentId, errorCode, status, req, message, durationMs, stack }) {
  const timestamp = new Date().toISOString();
  cleanupOldLogs();
  const event = {
    incidentId,
    errorCode,
    timestamp,
    status: Number(status) || 500,
    method: cleanText(req?.method, 12),
    path: cleanText(String(req?.originalUrl || req?.path || '').split('?')[0], 300),
    userId: cleanText(req?.user?.id, 100),
    userName: cleanText(req?.user?.display_name, 100),
    message: cleanText(message),
    durationMs: Number.isFinite(durationMs) ? Math.max(0, Math.round(durationMs)) : null,
    stack: cleanText(stack, 2000),
  };
  fs.mkdirSync(ERROR_LOG_DIR, { recursive: true });
  const filePath = path.join(ERROR_LOG_DIR, `error-events-${timestamp.slice(0, 10)}.ndjson`);
  fs.appendFile(filePath, `${JSON.stringify(event)}\n`, error => {
    if (error) console.error('[error-events] write failed:', error.message);
  });
  return event;
}

function readErrorEvents(limit = 500) {
  const boundedLimit = Math.min(1000, Math.max(1, Number(limit) || 500));
  try {
    fs.mkdirSync(ERROR_LOG_DIR, { recursive: true });
    const files = fs.readdirSync(ERROR_LOG_DIR)
      .filter(name => /^error-events-\d{4}-\d{2}-\d{2}\.ndjson$/.test(name))
      .sort((left, right) => right.localeCompare(left));
    const events = [];
    for (const name of files) {
      const lines = fs.readFileSync(path.join(ERROR_LOG_DIR, name), 'utf8').split(/\r?\n/).filter(Boolean).reverse();
      for (const line of lines) {
        try { events.push(JSON.parse(line)); } catch (_) {}
        if (events.length >= boundedLimit) return events;
      }
    }
    return events;
  } catch (error) {
    console.error('[error-events] read failed:', error.message);
    return [];
  }
}

module.exports = { createIncidentId, recordErrorEvent, readErrorEvents };
