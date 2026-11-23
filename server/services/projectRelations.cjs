const { saveDbImmediate } = require('../db.cjs');

function normalizeProjectName(value) {
  return String(value || '').trim().replace(/\s+/g, '').toLocaleLowerCase('zh-CN');
}

function parseJson(value) {
  try { return JSON.parse(value); } catch { return null; }
}

function projectIndex(db) {
  const rows = db.exec('SELECT id,data FROM products');
  const projects = (rows[0]?.values || []).map(([id, raw]) => ({ id, data: parseJson(raw) })).filter(row => row.data);
  const byName = new Map();
  for (const project of projects) {
    const key = normalizeProjectName(project.data.productName);
    if (!key) continue;
    const group = byName.get(key) || [];
    group.push(project);
    byName.set(key, group);
  }
  return { projects, byName };
}

function uniqueProjectIdForName(index, name) {
  const matches = index.byName.get(normalizeProjectName(name)) || [];
  return matches.length === 1 ? matches[0].id : null;
}

// Already-linked JSON can stay in SQLite instead of crossing into JavaScript.
// CASE guards malformed historical rows, which were previously ignored by parseJson().
const needsProjectLink = `CASE WHEN json_valid(data)
  THEN COALESCE(json_extract(data, '$.projectId'), '') IN ('', 0)
  ELSE 0 END`;

function migrateProjectRelations(db) {
  const index = projectIndex(db);
  let entriesLinked = 0;
  let filesLinked = 0;
  let snapshotsLinked = 0;

  const entryRows = db.exec(`SELECT id,data FROM entries WHERE ${needsProjectLink}`);
  for (const [id, raw] of entryRows[0]?.values || []) {
    const entry = parseJson(raw);
    if (!entry || entry.projectId) continue;
    const projectId = uniqueProjectIdForName(index, entry.productName);
    if (!projectId) continue;
    entry.projectId = projectId;
    db.run('UPDATE entries SET data=? WHERE id=?', [JSON.stringify(entry), id]);
    entriesLinked += 1;
  }

  const snapshotRows = db.exec(`SELECT id,data FROM entry_snapshots WHERE ${needsProjectLink}`);
  for (const [id, raw] of snapshotRows[0]?.values || []) {
    const entry = parseJson(raw);
    if (!entry || entry.projectId) continue;
    const projectId = uniqueProjectIdForName(index, entry.productName);
    if (!projectId) continue;
    entry.projectId = projectId;
    db.run('UPDATE entry_snapshots SET data=? WHERE id=?', [JSON.stringify(entry), id]);
    snapshotsLinked += 1;
  }

  const fileRows = db.exec(`SELECT id,data FROM clouddrive_files WHERE ${needsProjectLink}`);
  for (const [id, raw] of fileRows[0]?.values || []) {
    const file = parseJson(raw);
    if (!file || file.projectId) continue;
    const text = normalizeProjectName(`${file.fileName || ''} ${file.remark || ''}`);
    const candidates = index.projects.filter(project => {
      const name = normalizeProjectName(project.data.productName);
      return name && text.includes(name) && (index.byName.get(name) || []).length === 1;
    });
    if (candidates.length !== 1) continue;
    file.projectId = candidates[0].id;
    file.projectName = candidates[0].data.productName || '';
    db.run('UPDATE clouddrive_files SET data=? WHERE id=?', [JSON.stringify(file), id]);
    filesLinked += 1;
  }

  if (entriesLinked || filesLinked || snapshotsLinked) saveDbImmediate();
  return { entriesLinked, filesLinked, snapshotsLinked };
}

module.exports = { migrateProjectRelations, normalizeProjectName, projectIndex, uniqueProjectIdForName };
