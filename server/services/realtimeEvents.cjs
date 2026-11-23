const crypto = require('crypto');
const { getDbSync, saveDb } = require('../db.cjs');

const RETENTION_MS = Math.max(24, Number(process.env.REALTIME_EVENT_RETENTION_HOURS) || 72) * 60 * 60 * 1000;
const MAX_RECOVERY_EVENTS = 500;
const metrics = { published: 0, recovered: 0, publishErrors: 0, startedAt: new Date().toISOString() };

function enabled(name, fallback = true) {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  return !['0', 'false', 'off', 'no'].includes(String(value).toLowerCase());
}

function ensureRealtimeSchema(db = getDbSync()) {
  if (!db) return;
  db.run(`CREATE TABLE IF NOT EXISTS realtime_events (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT UNIQUE NOT NULL,
    resource TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_id TEXT NOT NULL DEFAULT '*',
    parent_id TEXT NOT NULL DEFAULT '',
    version TEXT NOT NULL DEFAULT '',
    actor_id TEXT NOT NULL DEFAULT '',
    actor_name TEXT NOT NULL DEFAULT '',
    audience_type TEXT NOT NULL DEFAULT 'all',
    audience_ids TEXT NOT NULL DEFAULT '[]',
    mutation_id TEXT NOT NULL DEFAULT '',
    changed_fields TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL,
    payload TEXT NOT NULL
  )`);
  db.run('CREATE INDEX IF NOT EXISTS idx_realtime_events_updated_at ON realtime_events(updated_at)');
}

function normalizeAudience(audience) {
  const type = ['all', 'users', 'roles', 'department'].includes(audience?.type) ? audience.type : 'all';
  const ids = Array.isArray(audience?.ids) ? [...new Set(audience.ids.map(String).filter(Boolean))] : [];
  return { type, ids };
}

function canReceiveEvent(client, event) {
  const audience = normalizeAudience(event?.audience);
  if (audience.type === 'all') return true;
  if (audience.type === 'users') return audience.ids.includes(String(client?.userId || ''));
  if (audience.type === 'roles') return audience.ids.includes(String(client?.role || ''));
  return audience.ids.includes(String(client?.department || ''));
}

function rowToEvent(row) {
  try { return JSON.parse(String(row.payload || '{}')); } catch { return null; }
}

function queryRows(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function publishDataChange(input) {
  if (!enabled('REALTIME_DATA_SYNC_ENABLED')) return null;
  const db = getDbSync();
  if (!db) return null;
  ensureRealtimeSchema(db);
  const now = input.updatedAt || new Date().toISOString();
  const audience = normalizeAudience(input.audience);
  const base = {
    type: 'data-change',
    eventId: input.eventId || crypto.randomUUID(),
    resource: String(input.resource || 'unknown'),
    action: String(input.action || 'updated'),
    entityId: String(input.entityId || '*'),
    parentId: input.parentId == null ? '' : String(input.parentId),
    version: input.version == null ? '' : String(input.version),
    updatedAt: now,
    actor: { id: String(input.actor?.id || ''), name: String(input.actor?.name || '') },
    audience,
    mutationId: String(input.mutationId || ''),
    changedFields: Array.isArray(input.changedFields) ? input.changedFields.map(String) : [],
  };
  db.run(`INSERT INTO realtime_events
    (event_id, resource, action, entity_id, parent_id, version, actor_id, actor_name,
     audience_type, audience_ids, mutation_id, changed_fields, updated_at, payload)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    base.eventId, base.resource, base.action, base.entityId, base.parentId, base.version,
    base.actor.id, base.actor.name, audience.type, JSON.stringify(audience.ids),
    base.mutationId, JSON.stringify(base.changedFields), now, JSON.stringify(base),
  ]);
  const sequenceRow = queryRows(db, 'SELECT sequence FROM realtime_events WHERE event_id = ?', [base.eventId])[0];
  const event = { ...base, sequence: Number(sequenceRow?.sequence || 0) };
  db.run('UPDATE realtime_events SET payload = ? WHERE event_id = ?', [JSON.stringify(event), base.eventId]);
  const cutoff = new Date(Date.now() - RETENTION_MS).toISOString();
  db.run('DELETE FROM realtime_events WHERE updated_at < ?', [cutoff]);
  saveDb();
  // Lazy import avoids a startup cycle between the hub and the event service.
  require('../ws/hub.cjs').broadcastDataChange(event);
  metrics.published += 1;
  return event;
}

function getChangesAfter(after, client, limit = MAX_RECOVERY_EVENTS) {
  const db = getDbSync();
  if (!db) return { events: [], latestSequence: 0, hasMore: false };
  ensureRealtimeSchema(db);
  const safeAfter = Math.max(0, Number(after) || 0);
  const safeLimit = Math.min(MAX_RECOVERY_EVENTS, Math.max(1, Number(limit) || MAX_RECOVERY_EVENTS));
  const bounds = queryRows(db, 'SELECT MIN(sequence) AS earliest, MAX(sequence) AS latest FROM realtime_events')[0] || {};
  const earliestSequence = Number(bounds.earliest || 0);
  const requiresFullSync = safeAfter > 0 && earliestSequence > 0 && safeAfter < earliestSequence - 1;
  const rows = queryRows(db, 'SELECT sequence, payload FROM realtime_events WHERE sequence > ? ORDER BY sequence ASC LIMIT ?', [safeAfter, safeLimit + 1]);
  const hasMore = rows.length > safeLimit;
  const events = rows.slice(0, safeLimit).map(rowToEvent).filter(Boolean).filter(event => canReceiveEvent(client, event));
  metrics.recovered += events.length;
  const latestSequence = Number(rows[Math.min(rows.length, safeLimit) - 1]?.sequence || safeAfter);
  return { events, latestSequence, earliestSequence, hasMore, requiresFullSync };
}

module.exports = {
  ensureRealtimeSchema,
  publishDataChange,
  getChangesAfter,
  canReceiveEvent,
  normalizeAudience,
  enabled,
  recordPublishError() { metrics.publishErrors += 1; },
  getRealtimeMetrics() { return { ...metrics }; },
};
