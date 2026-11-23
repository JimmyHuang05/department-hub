const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const JSZip = require('jszip');
const express = require('express');
const { getDb, getDbSync, saveDbImmediate } = require('../db.cjs');
const { authenticateApiKey } = require('../services/apiKeys.cjs');
const { JWT_SECRET, queryOne } = require('../middleware/auth.cjs');
const { logAudit } = require('../services/audit.cjs');
const { DATA_ROOT, CLOUD_DIR, TOOLS_ROOT_DIR, SKILLS_DIR } = require('../paths.cjs');

const router = express.Router();
const CHANGE_TTL_MS = 15 * 60 * 1000;
const UPLOAD_TTL_MS = 60 * 60 * 1000;
const MAX_UPLOAD_SIZE = 100 * 1024 * 1024;
const STAGE_DIR = path.join(DATA_ROOT, 'agent-staging');
const PROJECT_FIELDS = new Set(['productName', 'status', 'trustManager', 'trustManagerB', 'client', 'rmb', 'usd', 'feeRate', 'establishDate', 'target', 'remarks']);
const WORKLOG_FIELDS = new Set(['category', 'subCategory', 'productName', 'status', 'clientType', 'personA', 'personB', 'navScale', 'weeklyProgress', 'nextWeekPlan', 'weekKey']);
const QUESTIONNAIRE_FIELDS = new Set(['title', 'description', 'thankYouMessage', 'status', 'fields']);
const QUESTIONNAIRE_STATUSES = new Set(['draft', 'published', 'closed']);
const QUESTION_TYPES = new Set([
  'text', 'textarea', 'radio', 'checkbox', 'select',
  'short_text', 'long_text', 'single_choice', 'multiple_choice',
  'date', 'number', 'phone', 'email', 'attachment', 'rating', 'section_break',
]);
const QUESTION_CHOICE_TYPES = new Set(['radio', 'checkbox', 'select', 'single_choice', 'multiple_choice']);
const RESOURCE_ACTIONS = Object.freeze({
  project: ['update'],
  worklog: ['update'],
  clouddrive: ['upload', 'create_folder', 'trash'],
  tool: ['create', 'publish_version', 'update_metadata'],
  skill: ['create', 'publish_version', 'update_metadata'],
  questionnaire: ['create', 'update'],
});

fs.mkdirSync(STAGE_DIR, { recursive: true });
fs.mkdirSync(CLOUD_DIR, { recursive: true });
fs.mkdirSync(TOOLS_ROOT_DIR, { recursive: true });
fs.mkdirSync(SKILLS_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, STAGE_DIR),
    filename: (_req, file, cb) => cb(null, `${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}${path.extname(file.originalname).slice(0, 16)}`),
  }),
  limits: { fileSize: MAX_UPLOAD_SIZE, files: 1 },
});

router.use(authenticateApiKey);

function now() { return new Date().toISOString(); }
function makeId(prefix) { return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(6).toString('hex')}`; }
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function tokenSecret() { return crypto.createHash('sha256').update(`${JWT_SECRET}:agent-confirmation`).digest(); }
function signToken(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', tokenSecret()).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}
function verifyToken(token) {
  const [encoded, signature] = String(token || '').split('.');
  if (!encoded || !signature) return null;
  const expected = crypto.createHmac('sha256', tokenSecret()).update(encoded).digest('base64url');
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try { return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')); } catch { return null; }
}
function allRows(db, sql, params = []) {
  const result = [];
  const stmt = db.prepare(sql);
  try { stmt.bind(params); while (stmt.step()) result.push(stmt.getAsObject()); } finally { stmt.free(); }
  return result;
}
function safeJson(value, fallback = {}) { try { return JSON.parse(value); } catch { return fallback; } }
function cleanName(value, fallback = 'file') {
  const name = path.basename(String(value || fallback)).replace(/[\x00-\x1f<>:"/\\|?*]/g, '_').trim();
  return name.slice(0, 180) || fallback;
}
function currentRevision(resource, row, data) {
  if (!row) return '';
  if (resource === 'project') return String(data?._version || 1);
  if (resource === 'worklog') return String(data?.updatedAt || row.updated_at || '');
  if (resource === 'questionnaire' || resource === 'tool' || resource === 'skill') return String(row.updated_at || '');
  if (resource === 'clouddrive') return String(data?.updatedAt || data?.uploadedAt || '');
  return '';
}
function diffChanges(before, after, labels = {}) {
  const keys = [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])];
  return keys.filter(key => stable(before?.[key]) !== stable(after?.[key])).map(key => ({
    field: key,
    label: labels[key] || key,
    before: before?.[key] ?? null,
    after: after?.[key] ?? null,
  }));
}
function selectFields(source, fields) {
  const result = {};
  for (const key of fields) if (Object.prototype.hasOwnProperty.call(source || {}, key)) result[key] = source[key];
  return result;
}
function assertFields(changes, allowed) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw Object.assign(new Error('changes 必须是对象'), { status: 400 });
  const keys = Object.keys(changes || {});
  if (!keys.length) throw Object.assign(new Error('没有需要修改的字段'), { status: 400 });
  const invalid = keys.filter(key => !allowed.has(key));
  if (invalid.length) throw Object.assign(new Error(`不允许修改字段：${invalid.join('、')}`), { status: 400 });
}
function assertOwner(req, row) {
  if (row && req.user.role !== 'admin' && String(row.created_by || '') !== String(req.user.id)) {
    throw Object.assign(new Error('只能修改自己发布的工具或技能'), { status: 403 });
  }
}
function validateQuestionnaire(value) {
  if (!String(value.title || '').trim()) throw Object.assign(new Error('问卷名称不能为空'), { status: 400 });
  if (value.status != null && !QUESTIONNAIRE_STATUSES.has(String(value.status))) throw Object.assign(new Error('问卷状态无效'), { status: 400 });
  if (value.fields == null) return;
  if (!Array.isArray(value.fields) || value.fields.length > 50) throw Object.assign(new Error('问卷字段必须是数组且不能超过 50 项'), { status: 400 });
  value.fields.forEach((field, index) => {
    if (!field || typeof field !== 'object' || Array.isArray(field)) throw Object.assign(new Error(`第 ${index + 1} 个问卷字段无效`), { status: 400 });
    if (!String(field.label || '').trim()) throw Object.assign(new Error(`第 ${index + 1} 个问卷字段缺少标题`), { status: 400 });
    if (!QUESTION_TYPES.has(String(field.type || ''))) throw Object.assign(new Error(`第 ${index + 1} 个问卷字段类型无效`), { status: 400 });
    if (QUESTION_CHOICE_TYPES.has(field.type) && (!Array.isArray(field.options) || field.options.length < 1 || field.options.length > 100)) {
      throw Object.assign(new Error(`第 ${index + 1} 个问卷字段需要 1 至 100 个选项`), { status: 400 });
    }
  });
}
function validateCloudParent(db, parentId) {
  if (!parentId) return;
  const parent = resourceRow(db, 'clouddrive', parentId);
  const data = parent ? safeJson(parent.data) : null;
  if (!data || data.kind !== 'folder' || data.deletedAt) throw Object.assign(new Error('云盘目标文件夹不存在'), { status: 400 });
}
function assertCloudFolderEmpty(db, targetId, data) {
  if (data.kind !== 'folder') return;
  const hasChild = allRows(db, 'SELECT data FROM clouddrive_files').some(row => {
    const child = safeJson(row.data);
    return String(child.parentId || '') === targetId && !child.deletedAt;
  });
  if (hasChild) throw Object.assign(new Error('非空文件夹不能删除，请先处理其中内容'), { status: 409 });
}
function getUpload(db, uploadRef, req) {
  const row = queryOne(db, 'SELECT * FROM agent_uploads WHERE id=? AND api_key_id=? AND user_id=?', [uploadRef, req.apiKey.id, req.user.id]);
  if (!row || row.status !== 'staged' || Date.parse(row.expires_at) <= Date.now() || !fs.existsSync(row.stored_path)) {
    throw Object.assign(new Error('暂存文件不存在或已过期'), { status: 400 });
  }
  return row;
}
function resourceRow(db, resource, id) {
  if (resource === 'project') return queryOne(db, 'SELECT data,updated_at,created_by FROM products WHERE id=?', [id]);
  if (resource === 'worklog') return queryOne(db, 'SELECT data,updated_at,created_by,week_key FROM entries WHERE id=?', [id]);
  if (resource === 'questionnaire') return queryOne(db, 'SELECT * FROM questionnaires WHERE id=?', [id]);
  if (resource === 'tool' || resource === 'skill') return queryOne(db, 'SELECT * FROM tool_items WHERE id=? AND status != ?', [id, 'deleted']);
  if (resource === 'clouddrive') return queryOne(db, 'SELECT data FROM clouddrive_files WHERE id=?', [id]);
  return null;
}
function publicQuestionnaire(row) {
  return row ? { title: row.title, description: row.description || '', thankYouMessage: row.thank_you_message || '', status: row.status, fields: safeJson(row.fields_json, []) } : {};
}
async function validatePublishUpload(resource, staged) {
  if (staged.file_size > 8 * 1024 * 1024) throw Object.assign(new Error('工具或技能发布文件不能超过 8MB'), { status: 413 });
  const extension = path.extname(staged.file_name).toLowerCase();
  if (resource === 'tool') {
    if (!['.html', '.htm'].includes(extension)) throw Object.assign(new Error('工具只能发布 HTML 文件'), { status: 400 });
    const head = fs.readFileSync(staged.stored_path).subarray(0, 4096).toString('utf8').toLowerCase();
    if (!head.includes('<html') && !head.includes('<!doctype')) throw Object.assign(new Error('工具文件不是有效 HTML'), { status: 400 });
    return;
  }
  if (!['.md', '.zip', '.skill'].includes(extension)) throw Object.assign(new Error('技能只支持 SKILL.md、.zip 或 .skill 文件'), { status: 400 });
  if (extension === '.md') {
    if (path.basename(staged.file_name).toLowerCase() !== 'skill.md') throw Object.assign(new Error('Markdown 技能入口必须命名为 SKILL.md'), { status: 400 });
    return;
  }
  let archive;
  try { archive = await JSZip.loadAsync(fs.readFileSync(staged.stored_path)); }
  catch { throw Object.assign(new Error('技能压缩包无法读取'), { status: 400 }); }
  const entries = Object.values(archive.files);
  if (entries.length > 300) throw Object.assign(new Error('技能压缩包文件数量超过 300'), { status: 400 });
  let totalSize = 0;
  let hasSkillMd = false;
  for (const entry of entries) {
    const original = String(entry.unsafeOriginalName || entry.name || '').replace(/\\/g, '/');
    if (original.startsWith('/') || original.split('/').includes('..')) throw Object.assign(new Error('技能压缩包包含不安全路径'), { status: 400 });
    if (!entry.dir && path.posix.basename(entry.name).toLowerCase() === 'skill.md') hasSkillMd = true;
    totalSize += Number(entry._data?.uncompressedSize || 0);
  }
  if (totalSize > 32 * 1024 * 1024) throw Object.assign(new Error('技能解压后内容超过 32MB'), { status: 413 });
  if (!hasSkillMd) throw Object.assign(new Error('技能压缩包缺少 SKILL.md'), { status: 400 });
}

async function prepareDescription(db, req, command) {
  const resource = String(command.resource || '');
  const action = String(command.action || '');
  if (!RESOURCE_ACTIONS[resource]?.includes(action)) throw Object.assign(new Error('不支持的资源或操作'), { status: 400 });
  const targetId = String(command.target?.id || '');
  const targetRevision = String(command.target?.revision ?? '');
  const payload = command.payload || {};
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw Object.assign(new Error('payload 必须是对象'), { status: 400 });
  let row = targetId ? resourceRow(db, resource, targetId) : null;
  let before = {};
  let after = {};
  let title = '';

  if (resource === 'project') {
    if (!row) throw Object.assign(new Error('项目不存在'), { status: 404 });
    const data = safeJson(row.data);
    assertFields(payload.changes, PROJECT_FIELDS);
    before = selectFields(data, Object.keys(payload.changes));
    after = { ...before, ...payload.changes };
    title = data.productName || targetId;
  } else if (resource === 'worklog') {
    if (!row) throw Object.assign(new Error('周报不存在'), { status: 404 });
    const data = safeJson(row.data);
    assertFields(payload.changes, WORKLOG_FIELDS);
    before = selectFields(data, Object.keys(payload.changes));
    after = { ...before, ...payload.changes };
    title = data.productName || data.category || targetId;
  } else if (resource === 'questionnaire') {
    if (action === 'create') {
      if (!String(payload.title || '').trim()) throw Object.assign(new Error('问卷名称不能为空'), { status: 400 });
      before = {};
      after = selectFields({ ...payload, status: 'draft' }, QUESTIONNAIRE_FIELDS);
      validateQuestionnaire(after);
      title = String(payload.title).trim();
    } else {
      if (!row) throw Object.assign(new Error('问卷不存在'), { status: 404 });
      assertFields(payload.changes, QUESTIONNAIRE_FIELDS);
      const current = publicQuestionnaire(row);
      before = selectFields(current, Object.keys(payload.changes));
      after = { ...before, ...payload.changes };
      validateQuestionnaire({ ...current, ...payload.changes });
      title = row.title;
    }
  } else if (resource === 'clouddrive') {
    if (action === 'upload') {
      validateCloudParent(db, String(payload.parentId || ''));
      const staged = getUpload(db, String(payload.uploadRef || ''), req);
      before = {};
      after = { fileName: cleanName(payload.fileName || staged.file_name), fileSize: staged.file_size, checksum: staged.checksum, parentId: String(payload.parentId || ''), remark: String(payload.remark || '') };
      title = after.fileName;
    } else if (action === 'create_folder') {
      validateCloudParent(db, String(payload.parentId || ''));
      if (!String(payload.name || '').trim()) throw Object.assign(new Error('文件夹名称不能为空'), { status: 400 });
      before = {}; after = { name: cleanName(payload.name, '新建文件夹'), parentId: String(payload.parentId || '') }; title = after.name;
    } else {
      if (!row) throw Object.assign(new Error('云盘项目不存在'), { status: 404 });
      const data = safeJson(row.data);
      if (data.deletedAt) throw Object.assign(new Error('文件已在回收站中'), { status: 409 });
      assertCloudFolderEmpty(db, targetId, data);
      before = { status: 'active' }; after = { status: 'trash' }; title = data.fileName || targetId;
    }
  } else {
    const expectedType = resource === 'skill' ? 'skill' : 'html_tool';
    if (row) assertOwner(req, row);
    if (action === 'create' || action === 'publish_version') {
      const staged = getUpload(db, String(payload.uploadRef || ''), req);
      await validatePublishUpload(resource, staged);
      if (action === 'publish_version' && (!row || row.type !== expectedType)) throw Object.assign(new Error('发布目标不存在或类型不符'), { status: 404 });
      before = row ? { version: Number(queryOne(db, 'SELECT COALESCE(MAX(version_no),0) AS n FROM tool_versions WHERE item_id=?', [targetId])?.n || 0), name: row.name } : {};
      after = { name: String(payload.name || row?.name || staged.file_name).trim(), versionLabel: String(payload.versionLabel || ''), changelog: String(payload.changelog || ''), fileName: staged.file_name, checksum: staged.checksum };
      title = after.name;
    } else {
      if (!row || row.type !== expectedType) throw Object.assign(new Error('内容不存在或类型不符'), { status: 404 });
      assertFields(payload.changes, new Set(['name', 'description', 'category']));
      before = selectFields({ name: row.name, description: row.description || '', category: row.category || '' }, Object.keys(payload.changes));
      after = { ...before, ...payload.changes };
      title = row.name;
    }
  }

  const revision = row ? currentRevision(resource, row, resource === 'project' || resource === 'worklog' || resource === 'clouddrive' ? safeJson(row.data) : null) : '';
  if (row && targetRevision && targetRevision !== revision) throw Object.assign(new Error('目标数据已发生变化，请重新读取后再修改'), { status: 409, currentRevision: revision });
  const diff = diffChanges(before, after);
  if (!diff.length) throw Object.assign(new Error('修改前后内容一致'), { status: 400 });
  return { resource, action, targetId, targetRevision: revision, payload, diff, title };
}

router.get('/openapi.json', (req, res) => {
  const serverUrl = `${req.protocol}://${req.get('host')}/api/agent/v1`;
  res.json({
    openapi: '3.0.3',
    info: { title: 'GCO Link Agent Change API', version: '1.0.0', description: '所有写入必须先 prepare，并在用户二次确认后 commit。' },
    servers: [{ url: serverUrl }],
    components: { securitySchemes: { ApiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' } } },
    security: [{ ApiKeyAuth: [] }],
    paths: {
      '/capabilities': { get: { summary: '查询 Agent 可用资源、动作、字段及确认规则', responses: { 200: { description: 'OK' } } } },
      '/uploads': { post: { summary: '暂存云盘、工具或技能文件', responses: { 201: { description: 'Staged' } } } },
      '/changes/prepare': { post: { summary: '校验并冻结修改，返回供用户确认的差异', responses: { 201: { description: 'Prepared' }, 409: { description: 'Conflict' } } } },
      '/changes/commit': { post: { summary: '用户明确确认后提交冻结的修改', responses: { 200: { description: 'Committed' }, 403: { description: 'Invalid confirmation' }, 409: { description: 'Conflict or expired' } } } },
      '/changes/cancel': { post: { summary: '取消待确认修改', responses: { 200: { description: 'Cancelled' } } } },
      '/changes/{id}': { get: { summary: '查询修改状态', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'OK' } } } },
    },
  });
});

router.get('/capabilities', (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({
    protocol: 'ibd-agent-change/1.0',
    keyMode: 'current-user-key',
    confirmation: { required: true, flow: ['prepare', 'show-native-choice', 'commit'], expiresInSeconds: CHANGE_TTL_MS / 1000 },
    resources: RESOURCE_ACTIONS,
    fields: { project: [...PROJECT_FIELDS], worklog: [...WORKLOG_FIELDS], questionnaire: [...QUESTIONNAIRE_FIELDS] },
    choices: [
      { id: 'confirm', label: '确认修改', recommended: true },
      { id: 'revise', label: '返回修改' },
      { id: 'cancel', label: '取消' },
    ],
  });
});

router.post('/uploads', (req, res) => {
  upload.single('file')(req, res, err => {
    if (err) return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: '缺少上传文件' });
    const db = getDbSync();
    const id = makeId('upl');
    const createdAt = now();
    const expiresAt = new Date(Date.now() + UPLOAD_TTL_MS).toISOString();
    const checksum = sha256(fs.readFileSync(req.file.path));
    db.run('INSERT INTO agent_uploads(id,api_key_id,user_id,file_name,stored_path,file_size,mime_type,checksum,status,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)', [id, req.apiKey.id, req.user.id, cleanName(req.file.originalname), req.file.path, req.file.size, req.file.mimetype || '', checksum, 'staged', createdAt, expiresAt]);
    saveDbImmediate();
    res.status(201).json({ uploadRef: id, fileName: cleanName(req.file.originalname), size: req.file.size, mimeType: req.file.mimetype || '', sha256: checksum, expiresAt });
  });
});

router.post('/changes/prepare', async (req, res) => {
  try {
    const command = req.body || {};
    if (command.protocol !== 'ibd-agent-change/1.0') return res.status(400).json({ error: '协议版本无效' });
    const requestId = String(command.requestId || '').trim();
    const reason = String(command.reason || '').trim();
    if (!requestId || requestId.length > 128) return res.status(400).json({ error: 'requestId 无效' });
    if (!reason) return res.status(400).json({ error: '必须说明修改原因' });
    const db = await getDb();
    const existing = queryOne(db, 'SELECT * FROM agent_changes WHERE request_id=?', [requestId]);
    if (existing) return res.status(409).json({ error: 'requestId 已存在', changeId: existing.id, status: existing.status });
    const prepared = await prepareDescription(db, req, command);
    const id = makeId('chg');
    const preparedAt = now();
    const expiresAt = new Date(Date.now() + CHANGE_TTL_MS).toISOString();
    const frozen = { resource: prepared.resource, action: prepared.action, targetId: prepared.targetId, targetRevision: prepared.targetRevision, payload: prepared.payload };
    const payloadHash = sha256(stable(frozen));
    const token = signToken({ changeId: id, apiKeyId: req.apiKey.id, userId: req.user.id, payloadHash, exp: Date.parse(expiresAt) });
    db.run('INSERT INTO agent_changes(id,request_id,api_key_id,user_id,resource,action,target_id,target_revision,payload_json,diff_json,reason,payload_hash,confirmation_token_hash,status,expires_at,prepared_at,ip,user_agent) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [id, requestId, req.apiKey.id, req.user.id, prepared.resource, prepared.action, prepared.targetId, prepared.targetRevision, JSON.stringify(prepared.payload), JSON.stringify(prepared.diff), reason, payloadHash, sha256(token), 'prepared', expiresAt, preparedAt, req.ip || '', req.headers['user-agent'] || '']);
    saveDbImmediate();
    res.status(201).json({ prepared: true, changeId: id, confirmationToken: token, expiresAt, confirmation: { required: true, title: `确认${prepared.action === 'create' ? '新建' : prepared.action === 'trash' ? '删除' : '修改'}${prepared.resource}`, summary: `${prepared.title}：${prepared.diff.length} 项变更`, riskLevel: prepared.action === 'trash' || prepared.action.includes('publish') ? 'high' : 'normal', items: prepared.diff, options: [{ id: 'confirm', label: '确认修改', recommended: true }, { id: 'revise', label: '返回修改' }, { id: 'cancel', label: '取消' }] } });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || '准备修改失败', currentRevision: error.currentRevision });
  }
});

function consumeUpload(db, uploadRef, req) {
  const row = getUpload(db, uploadRef, req);
  db.run('UPDATE agent_uploads SET status=?,consumed_at=? WHERE id=?', ['consumed', now(), row.id]);
  return row;
}
function saveCloud(db, id, data) { db.run('INSERT OR REPLACE INTO clouddrive_files(id,data) VALUES(?,?)', [id, JSON.stringify(data)]); }
function executePrepared(db, req, change) {
  const payload = safeJson(change.payload_json);
  const resource = change.resource;
  const action = change.action;
  const targetId = change.target_id;
  const current = targetId ? resourceRow(db, resource, targetId) : null;
  if (targetId && !current) throw Object.assign(new Error('目标已不存在'), { status: 409 });
  if (targetId) {
    const revision = currentRevision(resource, current, ['project', 'worklog', 'clouddrive'].includes(resource) ? safeJson(current.data) : null);
    if (String(change.target_revision || '') !== revision) throw Object.assign(new Error('数据在确认期间已被修改，请重新确认'), { status: 409 });
  }
  const timestamp = now();
  if (resource === 'project') {
    const data = safeJson(current.data); const next = { ...data, ...payload.changes, updatedAt: timestamp, _version: Number(data._version || 1) + 1 };
    db.run('UPDATE products SET data=?,updated_at=? WHERE id=?', [JSON.stringify(next), timestamp, targetId]);
    return { targetId, revisionBefore: String(data._version || 1), revisionAfter: String(next._version), changedFields: Object.keys(payload.changes) };
  }
  if (resource === 'worklog') {
    const data = safeJson(current.data); const next = { ...data, ...payload.changes, updatedAt: timestamp };
    db.run('UPDATE entries SET data=?,updated_at=?,week_key=? WHERE id=?', [JSON.stringify(next), timestamp, next.weekKey || null, targetId]);
    if (next.weekKey) db.run('INSERT OR REPLACE INTO entry_snapshots(id,week_key,entry_id,data,created_by,snapshot_at) VALUES(?,?,?,?,?,?)', [`${next.weekKey}:${targetId}`, next.weekKey, targetId, JSON.stringify(next), req.user.id, timestamp]);
    return { targetId, revisionBefore: change.target_revision, revisionAfter: timestamp, changedFields: Object.keys(payload.changes) };
  }
  if (resource === 'questionnaire') {
    if (action === 'create') {
      const id = makeId('questionnaire'); const fields = Array.isArray(payload.fields) ? payload.fields : [];
      db.run('INSERT INTO questionnaires(id,title,description,status,public_token,fields_json,thank_you_message,created_by,created_by_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)', [id, String(payload.title).trim().slice(0, 120), String(payload.description || '').slice(0, 2000), 'draft', crypto.randomBytes(24).toString('base64url'), JSON.stringify(fields), String(payload.thankYouMessage || '').slice(0, 500), req.user.id, req.user.display_name || '', timestamp, timestamp]);
      return { targetId: id, revisionAfter: timestamp, changedFields: Object.keys(payload) };
    }
    const base = publicQuestionnaire(current); const next = { ...base, ...payload.changes };
    db.run('UPDATE questionnaires SET title=?,description=?,status=?,fields_json=?,thank_you_message=?,updated_at=? WHERE id=?', [String(next.title).trim().slice(0, 120), String(next.description || '').slice(0, 2000), next.status || 'draft', JSON.stringify(Array.isArray(next.fields) ? next.fields : []), String(next.thankYouMessage || '').slice(0, 500), timestamp, targetId]);
    return { targetId, revisionBefore: change.target_revision, revisionAfter: timestamp, changedFields: Object.keys(payload.changes) };
  }
  if (resource === 'clouddrive') {
    if (action === 'trash') {
      const data = safeJson(current.data); assertCloudFolderEmpty(db, targetId, data); data.deletedAt = timestamp; data.updatedAt = timestamp; saveCloud(db, targetId, data);
      return { targetId, revisionBefore: change.target_revision, revisionAfter: timestamp, changedFields: ['deletedAt'] };
    }
    if (action === 'create_folder') {
      validateCloudParent(db, String(payload.parentId || ''));
      const id = makeId('folder'); const data = { kind: 'folder', fileName: cleanName(payload.name, '新建文件夹'), fileSize: 0, mimeType: 'application/x-directory', parentId: String(payload.parentId || ''), uploadedBy: req.user.display_name, uploadedById: req.user.id, uploadedAt: timestamp, updatedAt: timestamp, remark: '', projectId: '', projectName: '' }; saveCloud(db, id, data);
      return { targetId: id, revisionAfter: timestamp, changedFields: ['fileName', 'parentId'] };
    }
    const staged = consumeUpload(db, String(payload.uploadRef || ''), req); const id = makeId('file'); const storedName = `${id}${path.extname(staged.file_name).slice(0, 16)}`; const destination = path.join(CLOUD_DIR, storedName); fs.renameSync(staged.stored_path, destination); const data = { kind: 'file', fileName: cleanName(payload.fileName || staged.file_name), fileSize: staged.file_size, mimeType: staged.mime_type || 'application/octet-stream', storedName, parentId: String(payload.parentId || ''), uploadedBy: req.user.display_name, uploadedById: req.user.id, uploadedAt: timestamp, updatedAt: timestamp, remark: String(payload.remark || ''), projectId: '', projectName: '' }; saveCloud(db, id, data);
    return { targetId: id, revisionAfter: timestamp, changedFields: ['fileName', 'parentId', 'remark'] };
  }
  const type = resource === 'skill' ? 'skill' : 'html_tool';
  if (current) assertOwner(req, current);
  if (action === 'update_metadata') {
    const changes = payload.changes || {}; db.run('UPDATE tool_items SET name=?,description=?,category=?,updated_at=? WHERE id=?', [String(changes.name ?? current.name).trim(), String(changes.description ?? current.description ?? '').trim(), String(changes.category ?? current.category ?? '').trim(), timestamp, targetId]);
    return { targetId, revisionBefore: change.target_revision, revisionAfter: timestamp, changedFields: Object.keys(changes) };
  }
  const staged = consumeUpload(db, String(payload.uploadRef || ''), req); const itemId = action === 'create' ? makeId(type === 'skill' ? 'skill' : 'tool') : targetId; const versionNo = Number(queryOne(db, 'SELECT COALESCE(MAX(version_no),0) AS n FROM tool_versions WHERE item_id=?', [itemId])?.n || 0) + 1; const versionId = makeId('ver'); const root = type === 'skill' ? SKILLS_DIR : TOOLS_ROOT_DIR; const versionDir = path.join(root, itemId, `v${versionNo}`); fs.mkdirSync(versionDir, { recursive: true }); const storedName = cleanName(staged.file_name); const destination = path.join(versionDir, storedName); fs.renameSync(staged.stored_path, destination); db.run('INSERT INTO tool_versions(id,item_id,version_no,version_label,file_name,stored_name,stored_path,file_size,mime_type,checksum,changelog,uploaded_by,uploaded_by_name,uploaded_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [versionId, itemId, versionNo, String(payload.versionLabel || `v${versionNo}`), staged.file_name, storedName, destination, staged.file_size, staged.mime_type || '', staged.checksum, String(payload.changelog || ''), req.user.id, req.user.display_name || '', timestamp]);
  if (action === 'create') db.run('INSERT INTO tool_items(id,type,name,description,category,status,visibility,current_version_id,created_by,created_by_name,created_at,updated_at,view_count) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)', [itemId, type, String(payload.name || staged.file_name).trim(), String(payload.description || ''), String(payload.category || ''), 'active', 'internal', versionId, req.user.id, req.user.display_name || '', timestamp, timestamp, 0]); else db.run('UPDATE tool_items SET current_version_id=?,updated_at=? WHERE id=?', [versionId, timestamp, itemId]);
  return { targetId: itemId, revisionBefore: change.target_revision || '', revisionAfter: timestamp, changedFields: ['currentVersion', 'changelog'] };
}

router.post('/changes/commit', async (req, res) => {
  try {
    const changeId = String(req.body?.changeId || ''); const token = String(req.body?.confirmationToken || '');
    if (req.body?.decision !== 'confirm') return res.status(400).json({ error: '必须明确选择确认修改' });
    const db = await getDb(); const change = queryOne(db, 'SELECT * FROM agent_changes WHERE id=? AND api_key_id=? AND user_id=?', [changeId, req.apiKey.id, req.user.id]);
    if (!change) return res.status(404).json({ error: '待确认修改不存在' });
    if (change.status === 'committed') return res.json(safeJson(change.result_json));
    if (change.status !== 'prepared' || Date.parse(change.expires_at) <= Date.now()) return res.status(409).json({ error: '待确认修改已失效', status: change.status });
    const signed = verifyToken(token);
    if (!signed || signed.changeId !== change.id || signed.apiKeyId !== req.apiKey.id || signed.userId !== req.user.id || signed.payloadHash !== change.payload_hash || signed.exp <= Date.now() || sha256(token) !== change.confirmation_token_hash) return res.status(403).json({ error: '确认凭证无效' });
    db.run('BEGIN');
    let result;
    try { result = executePrepared(db, req, change); db.run('COMMIT'); } catch (error) { try { db.run('ROLLBACK'); } catch {} throw error; }
    const response = { success: true, requestId: change.request_id, changeId: change.id, operationId: makeId('op'), resource: change.resource, action: change.action, ...result, executedAt: now(), undoAvailable: false };
    db.run('UPDATE agent_changes SET status=?,committed_at=?,result_json=? WHERE id=?', ['committed', response.executedAt, JSON.stringify(response), change.id]);
    saveDbImmediate();
    logAudit(req.user.id, req.user.display_name, `agent.${change.resource}.${change.action}`, change.resource, response.targetId || change.target_id, change.reason);
    res.json(response);
  } catch (error) { res.status(error.status || 500).json({ error: error.message || '提交修改失败' }); }
});

router.post('/changes/cancel', async (req, res) => {
  const db = await getDb(); const changeId = String(req.body?.changeId || ''); const row = queryOne(db, 'SELECT status FROM agent_changes WHERE id=? AND api_key_id=? AND user_id=?', [changeId, req.apiKey.id, req.user.id]);
  if (!row) return res.status(404).json({ error: '待确认修改不存在' });
  if (row.status === 'prepared') { db.run('UPDATE agent_changes SET status=? WHERE id=?', ['cancelled', changeId]); saveDbImmediate(); }
  res.json({ success: true, changeId, status: row.status === 'prepared' ? 'cancelled' : row.status });
});

router.get('/changes/:id', async (req, res) => {
  const db = await getDb(); const row = queryOne(db, 'SELECT id,request_id,resource,action,target_id,status,expires_at,prepared_at,committed_at,diff_json,result_json FROM agent_changes WHERE id=? AND api_key_id=? AND user_id=?', [req.params.id, req.apiKey.id, req.user.id]);
  if (!row) return res.status(404).json({ error: '修改记录不存在' });
  res.json({ changeId: row.id, requestId: row.request_id, resource: row.resource, action: row.action, targetId: row.target_id, status: row.status, expiresAt: row.expires_at, preparedAt: row.prepared_at, committedAt: row.committed_at || null, diff: safeJson(row.diff_json, []), result: safeJson(row.result_json, null) });
});

module.exports = router;
