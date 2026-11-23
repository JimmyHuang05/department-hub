const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { getDb, saveDb, saveDbImmediate } = require('../../../server/db.cjs');
const { broadcastToAuthenticated } = require('./broadcast.cjs');
const { authMiddleware, requireRole, queryOne, JWT_SECRET } = require('../../../server/middleware/auth.cjs');
const { createRateLimiter } = require('../../../server/middleware/rateLimit.cjs');
const { logAudit } = require('../../../server/services/audit.cjs');
const { QUESTIONNAIRE_UPLOAD_DIR } = require('./runtimePaths.cjs');
const { validateCloudFileName } = require('../../../server/services/uploadValidation.cjs');
const { notifyQuestionnaireSubmissionByEmail } = require('../../../server/services/emailNotifications.cjs');
const { buildQuestionnaireSubmissionDocx, safeDocxFilename } = require('./docxExport.cjs');

function fixUploadedFileName(value) {
  const name = String(value || '');
  if (!name || /[\u4e00-\u9fff]/.test(name)) return name;
  try {
    const decoded = Buffer.from(name, 'latin1').toString('utf8');
    return decoded.includes('\uFFFD') ? name : decoded;
  } catch (_) {
    return name;
  }
}

const router = express.Router();
const now = () => new Date().toISOString();
const allowedStatuses = new Set(['draft', 'published', 'closed']);
const allowedSubmissionStatuses = new Set(['new', 'viewed', 'handled']);
const QUESTIONNAIRE_QUOTA_BYTES = 5 * 1024 * 1024 * 1024;
const allowedFieldTypes = new Set([
  'short_text', 'long_text', 'single_choice', 'multiple_choice',
  'number', 'date', 'phone', 'email',
  'attachment', 'rating', 'section_break',
]);

fs.mkdirSync(QUESTIONNAIRE_UPLOAD_DIR, { recursive: true });
const attachmentUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, QUESTIONNAIRE_UPLOAD_DIR),
    filename: (_req, file, callback) => callback(
      null,
      `${crypto.randomUUID().replaceAll('-', '')}${path.extname(file.originalname).toLowerCase()}`,
    ),
  }),
  limits: { fileSize: 20 * 1024 * 1024, files: 10, fields: 3, fieldSize: 256 * 1024, parts: 13 },
  fileFilter(_req, file, callback) {
    file.originalname = fixUploadedFileName(file.originalname);
    const validation = validateCloudFileName(file.originalname);
    if (!validation.ok) return callback(Object.assign(new Error(validation.error), { statusCode: 400 }));
    return callback(null, true);
  },
});

const submitLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 20,
  keyGenerator: req => `${req.ip}:${req.params.token || ''}`,
  message: '提交过于频繁，请稍后再试',
});

function makeId(prefix) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
}

function makeToken() {
  return crypto.randomBytes(18).toString('base64url');
}

function makeManagerShareToken(questionnaireId, userId, note = '') {
  const normalizedNote = String(note || '').trim().slice(0, 80);
  const payload = Buffer.from(JSON.stringify({ q: questionnaireId, u: userId, ...(normalizedNote ? { n: normalizedNote } : {}) }), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function readManagerShareToken(token, questionnaireId) {
  try {
    const [payload, signature] = String(token || '').split('.');
    if (!payload || !signature) return null;
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(payload).digest('base64url');
    const actualBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return null;
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (decoded.q !== questionnaireId || !decoded.u) return null;
    return { userId: String(decoded.u), note: String(decoded.n || '').trim().slice(0, 80) };
  } catch (_) {
    return null;
  }
}

function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

function normalizeFields(value) {
  if (!Array.isArray(value) || value.length > 50) return null;
  const ids = new Set();
  const result = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index] || {};
    const label = String(item.label || '').trim().slice(0, 100);
    const type = String(item.type || 'short_text');
    if (!label || !allowedFieldTypes.has(type)) return null;
    let id = String(item.id || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
    if (!id || ids.has(id)) id = `field_${index + 1}_${crypto.randomBytes(3).toString('hex')}`;
    ids.add(id);
    const options = ['single_choice', 'multiple_choice'].includes(type)
      ? [...new Set((Array.isArray(item.options) ? item.options : [])
        .map(option => String(option || '').trim().slice(0, 100))
        .filter(Boolean))].slice(0, 30)
      : [];
    if (['single_choice', 'multiple_choice'].includes(type) && options.length === 0) return null;
    const visibilityInput = item.visibility && typeof item.visibility === 'object' ? item.visibility : null;
    const visibilitySource = visibilityInput
      ? result.find(field => field.id === String(visibilityInput.fieldId || '') && !field.hidden && field.type !== 'section_break')
      : null;
    const visibilityValue = String(visibilityInput?.value || '').trim().slice(0, 100);
    if (visibilityInput && (!visibilitySource || !visibilityValue)) return null;
    if (visibilitySource && ['single_choice', 'multiple_choice'].includes(visibilitySource.type) && !visibilitySource.options.includes(visibilityValue)) return null;
    const visibility = visibilitySource && visibilityValue
      ? {
          fieldId: visibilitySource.id,
          operator: visibilityInput.operator === 'not_equals' ? 'not_equals' : 'equals',
          value: visibilityValue,
        }
      : null;
    result.push({
      id,
      label,
      type,
      required: Boolean(item.required),
      placeholder: String(item.placeholder || '').trim().slice(0, 160),
      description: String(item.description || '').trim().slice(0, 500),
      hidden: Boolean(item.hidden),
      defaultValue: String(item.defaultValue || '').trim().slice(0, 500),
      visibility,
      optionDisplay: ['horizontal', 'dropdown'].includes(item.optionDisplay) ? item.optionDisplay : 'vertical',
      options,
      ratingMax: type === 'rating' ? Math.min(10, Math.max(1, Number(item.ratingMax) || 5)) : undefined,
    });
  }
  return result;
}

function conditionMatches(field, source) {
  const rule = field.visibility;
  if (!rule?.fieldId) return true;
  const current = source[rule.fieldId];
  const values = Array.isArray(current) ? current.map(String) : [String(current ?? '')];
  const matches = values.includes(String(rule.value || ''));
  return rule.operator === 'not_equals' ? !matches : matches;
}

function getVisibleFieldIds(fields, source) {
  const visibleFieldIds = new Set();
  for (const field of fields) {
    const dependencyVisible = !field.visibility?.fieldId || visibleFieldIds.has(field.visibility.fieldId);
    if (!field.hidden && dependencyVisible && conditionMatches(field, source)) visibleFieldIds.add(field.id);
  }
  return visibleFieldIds;
}

function questionnaireFromRow(row, count) {
  return {
    id: row.id,
    title: row.title,
    description: row.description || '',
    status: row.status,
    publicToken: row.public_token,
    fields: parseJson(row.fields_json, []),
    thankYouMessage: row.thank_you_message || '',
    createdBy: row.created_by,
    createdByName: row.created_by_name || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    submissionCount: Number(count || 0),
  };
}

function listRows(db, sql, params = []) {
  const result = db.exec(sql, params);
  const columns = result[0]?.columns || [];
  return (result[0]?.values || []).map(values => Object.fromEntries(columns.map((key, index) => [key, values[index]])));
}

function getQuestionnaireUsedBytes(db) {
  const row = queryOne(db, 'SELECT COALESCE(SUM(file_size), 0) AS used FROM questionnaire_attachments');
  return Math.max(0, Number(row?.used || 0));
}

function validateAnswers(fields, input, uploadedAttachments = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const answers = {};
  // Keep server-side visibility in lockstep with the public form. A field whose
  // controlling field is itself hidden must not become visible merely because
  // `not_equals` also matches an empty value.
  const visibleFieldIds = new Set();
  for (const field of fields) {
    const dependencyVisible = !field.visibility?.fieldId || visibleFieldIds.has(field.visibility.fieldId);
    const visible = !field.hidden && dependencyVisible && conditionMatches(field, answers);
    if (visible) visibleFieldIds.add(field.id);
    if (field.type === 'section_break') continue;
    let value = source[field.id];
    if (field.hidden) {
      value = field.defaultValue || '';
    } else if (!visible) {
      value = field.type === 'multiple_choice' ? [] : '';
    } else if (field.type === 'attachment') {
      value = uploadedAttachments[field.id] || '';
    } else if (field.type === 'multiple_choice') {
      value = Array.isArray(value)
        ? [...new Set(value.map(item => String(item || '').trim()).filter(item => field.options.includes(item)))].slice(0, field.options.length)
        : [];
    } else if (field.type === 'number') {
      value = value === '' || value == null ? '' : Number(value);
      if (value !== '' && !Number.isFinite(value)) return { error: `“${field.label}”格式不正确` };
    } else if (field.type === 'rating') {
      const max = field.ratingMax || 5;
      const numeric = value === '' || value == null ? '' : Number(value);
      if (numeric !== '') {
        if (!Number.isInteger(numeric) || numeric < 1 || numeric > max) {
          return { error: `“${field.label}”评分需为 1 到 ${max} 的整数` };
        }
      }
      value = numeric === '' ? '' : String(numeric);
    } else {
      value = value == null ? '' : String(value).trim().slice(0, field.type === 'long_text' ? 5000 : 500);
      if (field.type === 'single_choice' && value && !field.options.includes(value)) {
        return { error: `“${field.label}”选项无效` };
      }
      if (field.type === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        return { error: `“${field.label}”邮箱格式不正确` };
      }
    }
    const empty = Array.isArray(value) ? value.length === 0 : value === '' || value == null;
    if (field.required && visible && empty) return { error: `请填写“${field.label}”` };
    answers[field.id] = value;
  }
  return { answers };
}

function removeUploadedFiles(files) {
  for (const file of files || []) {
    try { if (file?.path && fs.existsSync(file.path)) fs.unlinkSync(file.path); } catch (_) {}
  }
}

function parseRequestAnswers(req) {
  if (typeof req.body?.answers === 'string') return parseJson(req.body.answers, {});
  return req.body?.answers;
}

function uploadAttachments(req, res, next) {
  attachmentUpload.any()(req, res, error => {
    if (!error) return next();
    removeUploadedFiles(req.files);
    return res.status(error.statusCode || (error.code === 'LIMIT_FILE_SIZE' ? 413 : 400)).json({
      error: error.code === 'LIMIT_FILE_SIZE' ? '单个附件不能超过 20MB' : error.message || '附件上传失败',
    });
  });
}

// 公开接口必须位于动态 id 路由之前，并且不使用登录中间件。
router.get('/public/:token', async (req, res) => {
  const db = await getDb();
  const row = queryOne(db, 'SELECT * FROM questionnaires WHERE public_token=?', [req.params.token]);
  if (!row) return res.status(404).json({ error: '问卷不存在' });
  if (row.status !== 'published') {
    return res.status(410).json({ error: row.status === 'closed' ? '问卷已失效' : '问卷尚未发布' });
  }
  const item = questionnaireFromRow(row, 0);
  res.setHeader('Cache-Control', 'no-store');
  return res.json({ questionnaire: {
    title: item.title,
    description: item.description,
    fields: item.fields.filter(field => !field.hidden),
    thankYouMessage: item.thankYouMessage,
  } });
});

// 服务端草稿：跨设备保存/续填（客户端通过 localStorage 生成 clientKey）
router.get('/public/:token/draft', async (req, res) => {
  const db = await getDb();
  const row = queryOne(db, 'SELECT * FROM questionnaires WHERE public_token=?', [req.params.token]);
  if (!row) return res.status(404).json({ error: '问卷不存在' });
  if (row.status !== 'published') return res.status(410).json({ error: row.status === 'closed' ? '问卷已失效' : '问卷尚未发布' });
  const clientKey = String(req.query.clientKey || '').slice(0, 128);
  if (!clientKey) return res.json({ draft: null });
  const draft = queryOne(
    db,
    'SELECT answers_json,updated_at FROM questionnaire_drafts WHERE questionnaire_id=? AND client_key=?',
    [row.id, clientKey],
  );
  if (!draft) return res.json({ draft: null });
  return res.json({ draft: { answers: parseJson(draft.answers_json, {}), updatedAt: draft.updated_at } });
});

router.put('/public/:token/draft', async (req, res) => {
  const db = await getDb();
  const row = queryOne(db, 'SELECT * FROM questionnaires WHERE public_token=?', [req.params.token]);
  if (!row) return res.status(404).json({ error: '问卷不存在' });
  if (row.status !== 'published') return res.status(410).json({ error: row.status === 'closed' ? '问卷已失效' : '问卷尚未发布' });
  const clientKey = String(req.body?.clientKey || '').slice(0, 128);
  if (!clientKey) return res.status(400).json({ error: '缺少客户端标识' });
  const answers = req.body?.answers && typeof req.body.answers === 'object' && !Array.isArray(req.body.answers)
    ? req.body.answers
    : {};
  const updatedAt = now();
  db.run(
    'INSERT OR REPLACE INTO questionnaire_drafts(questionnaire_id,client_key,answers_json,updated_at) VALUES(?,?,?,?)',
    [row.id, clientKey, JSON.stringify(answers), updatedAt],
  );
  saveDb();
  return res.json({ success: true, updatedAt });
});

router.post('/public/:token/submissions', submitLimiter, uploadAttachments, async (req, res) => {
  const db = await getDb();
  const row = queryOne(db, 'SELECT * FROM questionnaires WHERE public_token=?', [req.params.token]);
  if (!row) { removeUploadedFiles(req.files); return res.status(404).json({ error: '问卷不存在' }); }
  if (row.status !== 'published') { removeUploadedFiles(req.files); return res.status(410).json({ error: row.status === 'closed' ? '问卷已失效' : '问卷当前不可提交' }); }

  const incomingAttachmentBytes = (req.files || []).reduce((total, file) => total + Number(file?.size || 0), 0);
  if (getQuestionnaireUsedBytes(db) + incomingAttachmentBytes > QUESTIONNAIRE_QUOTA_BYTES) {
    removeUploadedFiles(req.files);
    return res.status(413).json({ error: '问卷附件空间不足，请联系管理员清理后再提交' });
  }

  // 幂等防重：同一 idempotencyKey 的重复提交直接返回已提交结果，不重复落库
  const idempotencyKey = String(
    req.get('X-Idempotency-Key') || (typeof req.body?.idempotencyKey === 'string' ? req.body.idempotencyKey : ''),
  ).slice(0, 128);
  if (idempotencyKey) {
    const existing = queryOne(
      db,
      'SELECT submission_id FROM questionnaire_idempotency WHERE idempotency_key=? AND questionnaire_id=?',
      [idempotencyKey, row.id],
    );
    if (existing) {
      removeUploadedFiles(req.files);
      return res.status(200).json({ success: true, submissionId: existing.submission_id, duplicate: true });
    }
  }

  const fields = parseJson(row.fields_json, []);
  const attachmentFields = new Map(fields.filter(field => field.type === 'attachment' && !field.hidden).map(field => [field.id, field]));
  const uploadedAttachments = {};
  for (const file of req.files || []) {
    const field = attachmentFields.get(file.fieldname);
    if (!field || uploadedAttachments[file.fieldname]) {
      removeUploadedFiles(req.files);
      return res.status(400).json({ error: '附件字段无效或重复上传' });
    }
    uploadedAttachments[file.fieldname] = {
      fileId: path.basename(file.filename, path.extname(file.filename)),
      fileName: String(file.originalname || '').slice(0, 255),
      fileSize: file.size,
      mimeType: String(file.mimetype || '').slice(0, 120),
      storedName: file.filename,
    };
  }
  const validated = validateAnswers(fields, parseRequestAnswers(req), uploadedAttachments);
  if (validated.error) { removeUploadedFiles(req.files); return res.status(400).json({ error: validated.error }); }
  for (const file of req.files || []) {
    const accepted = validated.answers[file.fieldname];
    if (!accepted || typeof accepted !== 'object') removeUploadedFiles([file]);
  }
  const id = makeId('response');
  const submittedAt = now();
  const shareToken = String(req.body?.shareToken || '').slice(0, 1000);
  const shareIdentity = shareToken ? readManagerShareToken(shareToken, row.id) : null;
  const sourceUserId = shareIdentity?.userId || '';
  const sourceNote = shareIdentity?.note || '';
  if (shareToken && !shareIdentity) {
    removeUploadedFiles(req.files);
    return res.status(400).json({ error: '分享链接身份信息无效，请联系问卷分享人重新获取链接' });
  }
  const sourceUser = sourceUserId
    ? queryOne(db, 'SELECT id,display_name,email,status FROM users WHERE id=?', [sourceUserId])
    : null;
  if (sourceUserId && (!sourceUser || sourceUser.status === 'disabled')) {
    removeUploadedFiles(req.files);
    return res.status(400).json({ error: '分享链接所属账号已失效，请联系管理员' });
  }
  const sourceUserName = sourceUser?.display_name || '';

  // 写入答卷（含幂等键）
  db.run(
    'INSERT INTO questionnaire_submissions(id,questionnaire_id,answers_json,submitted_at,submitter_ip,user_agent,status,updated_at,idempotency_key,source_user_id,source_user_name,source_note) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
    [id, row.id, JSON.stringify(validated.answers), submittedAt, req.ip || '', String(req.get('user-agent') || '').slice(0, 300), 'new', submittedAt, idempotencyKey || null, sourceUserId, sourceUserName, sourceNote],
  );

  // 附件写入独立表，便于检索与清理
  for (const file of req.files || []) {
    const answer = validated.answers[file.fieldname];
    if (!answer || typeof answer !== 'object') continue;
    db.run(
      'INSERT INTO questionnaire_attachments(id,submission_id,questionnaire_id,field_id,file_name,stored_name,file_size,mime_type,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
      [makeId('attach'), id, row.id, file.fieldname, answer.fileName || '', answer.storedName || '', answer.fileSize || 0, answer.mimeType || '', submittedAt],
    );
  }

  if (idempotencyKey) {
    db.run(
      'INSERT INTO questionnaire_idempotency(idempotency_key,questionnaire_id,submission_id,created_at) VALUES(?,?,?,?)',
      [idempotencyKey, row.id, id, submittedAt],
    );
  }

  saveDbImmediate();

  // 实时推送新提交给所有登录的管理端
  try {
    const notification = {
      type: 'questionnaire-submission-new',
      submission: {
        id,
        questionnaireId: row.id,
        questionnaireTitle: row.title,
        submittedAt,
        fieldCount: fields.filter(field => !field.hidden).length,
        sourceUserId,
        sourceUserName,
        sourceNote,
      },
    };
    broadcastToAuthenticated(notification);
  } catch (_) { /* 推送失败不影响主流程 */ }

  if (sourceUserId && sourceUser) {
    void notifyQuestionnaireSubmissionByEmail(
      {
        id,
        questionnaireId: row.id,
        questionnaireTitle: row.title,
        submittedAt,
        attachmentDirectory: QUESTIONNAIRE_UPLOAD_DIR,
        attachments: Object.values(uploadedAttachments),
      },
      { id: sourceUser.id, name: sourceUserName, email: sourceUser.email || '' },
    ).then(result => {
      if (result.enabled && result.failures.length) console.error('[email] 问卷归属经理通知失败:', result.failures[0].message);
    }).catch(error => console.error('[email] 问卷归属经理通知失败:', error.message));
  }

  return res.status(201).json({ success: true, submissionId: id, submittedAt });
});

router.get('/:id/submissions/:submissionId/attachments/:fieldId', authMiddleware, async (req, res) => {
  const db = await getDb();
  const submission = queryOne(
    db,
    'SELECT answers_json FROM questionnaire_submissions WHERE id=? AND questionnaire_id=?',
    [req.params.submissionId, req.params.id],
  );
  if (!submission) return res.status(404).json({ error: '答卷不存在' });
  const answer = parseJson(submission.answers_json, {})[req.params.fieldId];
  const storedName = String(answer?.storedName || '');
  const resolved = path.resolve(QUESTIONNAIRE_UPLOAD_DIR, storedName);
  const base = path.resolve(QUESTIONNAIRE_UPLOAD_DIR);
  if (!storedName || !resolved.startsWith(`${base}${path.sep}`) || !fs.existsSync(resolved)) {
    return res.status(404).json({ error: '附件不存在' });
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.download(resolved, answer.fileName || storedName);
});

router.get('/submissions/all', authMiddleware, async (_req, res) => {
  const db = await getDb();
  const rows = listRows(db, `
    SELECT s.id,s.questionnaire_id,s.answers_json,s.submitted_at,s.status,s.updated_at,s.source_user_id,s.source_user_name,s.source_note,
           q.title,q.fields_json
    FROM questionnaire_submissions s
    JOIN questionnaires q ON q.id=s.questionnaire_id
    ORDER BY s.submitted_at DESC
    LIMIT 2000
  `);
  return res.json({ submissions: rows.map(row => ({
    id: row.id,
    questionnaireId: row.questionnaire_id,
    questionnaireTitle: row.title,
    fields: parseJson(row.fields_json, []),
    answers: parseJson(row.answers_json, {}),
    submittedAt: row.submitted_at,
    status: allowedSubmissionStatuses.has(row.status) ? row.status : 'new',
    updatedAt: row.updated_at || row.submitted_at,
    sourceUserId: row.source_user_id || '',
    sourceUserName: [row.source_user_name, row.source_note].filter(Boolean).join(' · '),
    sourceNote: row.source_note || '',
  })) });
});

router.get('/submissions/:submissionId/export.docx', authMiddleware, async (req, res) => {
  const db = await getDb();
  const row = queryOne(db, `
    SELECT s.id,s.answers_json,s.submitted_at,s.status,s.source_user_name,s.source_note,q.title,q.fields_json
    FROM questionnaire_submissions s
    JOIN questionnaires q ON q.id=s.questionnaire_id
    WHERE s.id=?
  `, [req.params.submissionId]);
  if (!row) return res.status(404).json({ error: '答卷不存在' });

  const filename = safeDocxFilename(row.title, row.submitted_at);
  const buffer = await buildQuestionnaireSubmissionDocx({
    title: row.title,
    fields: parseJson(row.fields_json, []),
    answers: parseJson(row.answers_json, {}),
    submittedAt: row.submitted_at,
    status: allowedSubmissionStatuses.has(row.status) ? row.status : 'new',
    sourceUserName: [row.source_user_name, row.source_note].filter(Boolean).join(' · '),
    submissionId: row.id,
  });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename="questionnaire-response.docx"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.setHeader('Content-Length', buffer.length);
  return res.send(buffer);
});

// 提交记录分页 + 搜索 + 状态筛选（替代全量 LIMIT 2000）
// 查询参数：page(默认1), pageSize(默认50, 上限200), questionnaireId, status, search
router.get('/submissions/paged', authMiddleware, async (req, res) => {
  const db = await getDb();
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));
  const questionnaireId = String(req.query.questionnaireId || '').trim();
  const status = String(req.query.status || '').trim();
  const keyword = String(req.query.search || '').trim().toLocaleLowerCase('zh-CN');

  const where = [];
  const params = [];
  if (questionnaireId && questionnaireId !== 'all') {
    where.push('s.questionnaire_id = ?');
    params.push(questionnaireId);
  }
  if (status && allowedSubmissionStatuses.has(status)) {
    where.push('s.status = ?');
    params.push(status);
  }
  if (keyword) {
    where.push('(LOWER(q.title) LIKE ? OR LOWER(s.answers_json) LIKE ?)');
    const like = `%${keyword}%`;
    params.push(like, like);
  }

  const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';

  const countResult = db.exec(`SELECT COUNT(*) AS c FROM questionnaire_submissions s JOIN questionnaires q ON q.id=s.questionnaire_id${whereSql}`, params);
  const total = Number(countResult[0]?.values?.[0]?.[0]) || 0;

  const offset = (page - 1) * pageSize;
  const rows = listRows(
    db,
    `SELECT s.id,s.questionnaire_id,s.answers_json,s.submitted_at,s.status,s.updated_at,s.source_user_id,s.source_user_name,s.source_note,
            q.title,q.fields_json
     FROM questionnaire_submissions s
     JOIN questionnaires q ON q.id=s.questionnaire_id
     ${whereSql}
     ORDER BY s.submitted_at DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  );

  return res.json({
    submissions: rows.map(row => ({
      id: row.id,
      questionnaireId: row.questionnaire_id,
      questionnaireTitle: row.title,
      fields: parseJson(row.fields_json, []),
      answers: parseJson(row.answers_json, {}),
      submittedAt: row.submitted_at,
      status: allowedSubmissionStatuses.has(row.status) ? row.status : 'new',
      updatedAt: row.updated_at || row.submitted_at,
      sourceUserId: row.source_user_id || '',
      sourceUserName: [row.source_user_name, row.source_note].filter(Boolean).join(' · '),
      sourceNote: row.source_note || '',
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
});

router.get('/:id/share', authMiddleware, async (req, res) => {
  const db = await getDb();
  const questionnaire = queryOne(db, 'SELECT id,public_token FROM questionnaires WHERE id=?', [req.params.id]);
  if (!questionnaire) return res.status(404).json({ error: '问卷不存在' });
  const sourceUserId = String(req.user?.id || '');
  if (!sourceUserId) return res.status(401).json({ error: '未登录' });
  const note = String(req.query?.note || '').trim().slice(0, 80);
  return res.json({
    shareToken: makeManagerShareToken(questionnaire.id, sourceUserId, note),
    sourceUserId,
    sourceUserName: String(req.user?.display_name || ''),
    note,
  });
});

router.get('/:id/share-history', authMiddleware, async (req, res) => {
  const db = await getDb();
  const questionnaire = queryOne(db, 'SELECT id,public_token FROM questionnaires WHERE id=?', [req.params.id]);
  if (!questionnaire) return res.status(404).json({ error: '问卷不存在' });
  const userId = String(req.user?.id || '');
  const rows = listRows(db, `SELECT id,note,created_at,last_used_at,use_count FROM questionnaire_share_history
    WHERE questionnaire_id=? AND user_id=? ORDER BY last_used_at DESC`, [questionnaire.id, userId]);
  return res.json({ history: rows.map(row => ({
    id: row.id,
    note: row.note || '',
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    useCount: Number(row.use_count || 1),
    shareToken: makeManagerShareToken(questionnaire.id, userId, row.note || ''),
  })) });
});

router.post('/:id/share-history', authMiddleware, async (req, res) => {
  const db = await getDb();
  const questionnaire = queryOne(db, 'SELECT id,public_token FROM questionnaires WHERE id=?', [req.params.id]);
  if (!questionnaire) return res.status(404).json({ error: '问卷不存在' });
  const userId = String(req.user?.id || '');
  if (!userId) return res.status(401).json({ error: '未登录' });
  const userName = String(req.user?.display_name || '');
  const note = String(req.body?.note || '').trim().slice(0, 80);
  const usedAt = now();
  const existing = queryOne(db, 'SELECT id,created_at,use_count FROM questionnaire_share_history WHERE questionnaire_id=? AND user_id=? AND note=?', [questionnaire.id, userId, note]);
  const id = existing?.id || makeId('qshare');
  if (existing) {
    db.run('UPDATE questionnaire_share_history SET user_name=?,last_used_at=?,use_count=? WHERE id=?', [userName, usedAt, Number(existing.use_count || 0) + 1, id]);
  } else {
    db.run('INSERT INTO questionnaire_share_history(id,questionnaire_id,user_id,user_name,note,created_at,last_used_at,use_count) VALUES(?,?,?,?,?,?,?,?)', [id, questionnaire.id, userId, userName, note, usedAt, usedAt, 1]);
  }
  saveDb();
  return res.json({ id, note, shareToken: makeManagerShareToken(questionnaire.id, userId, note), lastUsedAt: usedAt });
});

router.put('/submissions/:submissionId/status', authMiddleware, requireRole('user', 'admin'), async (req, res) => {
  const status = String(req.body?.status || '');
  if (!allowedSubmissionStatuses.has(status)) return res.status(400).json({ error: '答卷处理状态无效' });
  const db = await getDb();
  const row = queryOne(db, 'SELECT id,questionnaire_id FROM questionnaire_submissions WHERE id=?', [req.params.submissionId]);
  if (!row) return res.status(404).json({ error: '答卷不存在' });
  const updatedAt = now();
  db.run('UPDATE questionnaire_submissions SET status=?,updated_at=? WHERE id=?', [status, updatedAt, req.params.submissionId]);
  saveDb();
  logAudit(req.user.id, req.user.display_name, 'questionnaire.submission.status', 'questionnaire_submission', req.params.submissionId, status);
  return res.json({ success: true, status, updatedAt });
});

router.delete('/submissions/:submissionId', authMiddleware, requireRole('user', 'admin'), async (req, res) => {
  const db = await getDb();
  const row = queryOne(db, 'SELECT id,questionnaire_id,answers_json FROM questionnaire_submissions WHERE id=?', [req.params.submissionId]);
  if (!row) return res.status(404).json({ error: '答卷不存在' });
  const base = path.resolve(QUESTIONNAIRE_UPLOAD_DIR);
  Object.values(parseJson(row.answers_json, {})).forEach(answer => {
    if (!answer || typeof answer !== 'object' || !answer.storedName) return;
    const resolved = path.resolve(base, answer.storedName);
    try { if (resolved.startsWith(`${base}${path.sep}`) && fs.existsSync(resolved)) fs.unlinkSync(resolved); } catch (_) {}
  });
  db.run('DELETE FROM questionnaire_attachments WHERE submission_id=?', [row.id]);
  db.run('DELETE FROM questionnaire_idempotency WHERE submission_id=?', [row.id]);
  db.run('DELETE FROM questionnaire_submissions WHERE id=?', [row.id]);
  saveDbImmediate();
  logAudit(req.user.id, req.user.display_name, 'questionnaire.submission.delete', 'questionnaire_submission', row.id, row.questionnaire_id);
  return res.json({ success: true });
});

router.get('/', authMiddleware, async (_req, res) => {
  const db = await getDb();
  const rows = listRows(db, `
    SELECT q.*, COUNT(s.id) AS submission_count
    FROM questionnaires q
    LEFT JOIN questionnaire_submissions s ON s.questionnaire_id=q.id
    GROUP BY q.id
    ORDER BY q.updated_at DESC
  `);
  return res.json({ questionnaires: rows.map(row => questionnaireFromRow(row, row.submission_count)) });
});

router.get('/usage', authMiddleware, async (_req, res) => {
  const db = await getDb();
  const used = getQuestionnaireUsedBytes(db);
  return res.json({
    used,
    quota: QUESTIONNAIRE_QUOTA_BYTES,
    usedPercent: Math.round((used / QUESTIONNAIRE_QUOTA_BYTES) * 100),
  });
});

function localDateKey(date) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function weekStartOf(date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const offset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - offset);
  return start;
}

function isoWeekNumber(date) {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNumber = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.ceil((((target - yearStart) / 86400000) + 1) / 7);
}

function buildWeekBuckets(count = 12) {
  const buckets = [];
  const currentWeek = weekStartOf(new Date());
  for (let index = count - 1; index >= 0; index -= 1) {
    const start = new Date(currentWeek);
    start.setDate(start.getDate() - index * 7);
    buckets.push({
      key: localDateKey(start),
      label: `第${isoWeekNumber(start)}周`,
      count: 0,
    });
  }
  return buckets;
}

router.get('/:id/stats', authMiddleware, async (req, res) => {
  const db = await getDb();
  const row = queryOne(db, 'SELECT * FROM questionnaires WHERE id=?', [req.params.id]);
  if (!row) return res.status(404).json({ error: '问卷不存在' });
  const fields = parseJson(row.fields_json, []);

  // 时间筛选：?from=YYYY-MM-DD&to=YYYY-MM-DD（含两端）
  const fromDate = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from || '')) ? `${String(req.query.from)}T00:00:00` : '';
  const toDate = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to || '')) ? `${String(req.query.to)}T23:59:59` : '';
  const timeWhere = [];
  const timeParams = [];
  if (fromDate) { timeWhere.push('submitted_at >= ?'); timeParams.push(fromDate); }
  if (toDate) { timeWhere.push('submitted_at <= ?'); timeParams.push(toDate); }
  const timeSql = timeWhere.length ? ` AND ${timeWhere.join(' AND ')}` : '';

  const submissions = listRows(
    db,
    `SELECT answers_json,submitted_at,status,submitter_ip,user_agent,source_user_name,source_note FROM questionnaire_submissions WHERE questionnaire_id=?${timeSql} ORDER BY submitted_at ASC`,
    [req.params.id, ...timeParams],
  );

  const parsed = submissions.map(item => ({
    answers: parseJson(item.answers_json, {}),
    submittedAt: item.submitted_at,
    status: allowedSubmissionStatuses.has(item.status) ? item.status : 'new',
    key: `${item.submitter_ip || ''}|${item.user_agent || ''}`,
    sourceUserName: [item.source_user_name, item.source_note].filter(Boolean).join(' · ') || '公共链接',
  }));

  // 提交趋势（最近12个自然周，周一至周日）
  const weekBuckets = buildWeekBuckets(12);
  const bucketIndex = new Map(weekBuckets.map((bucket, index) => [bucket.key, index]));
  parsed.forEach(item => {
    const date = new Date(item.submittedAt);
    if (Number.isNaN(date.getTime())) return;
    const key = localDateKey(weekStartOf(date));
    const index = bucketIndex.get(key);
    if (index !== undefined) weekBuckets[index].count += 1;
  });

  // 处理状态分布
  const statusCounts = { new: 0, viewed: 0, handled: 0 };
  parsed.forEach(item => { statusCounts[item.status] += 1; });

  // 分享来源分布（经理专属链接与公共链接）
  const sourceCountMap = new Map();
  parsed.forEach(item => sourceCountMap.set(item.sourceUserName, (sourceCountMap.get(item.sourceUserName) || 0) + 1));
  const sourceCounts = Array.from(sourceCountMap.entries())
    .map(([sourceUserName, count]) => ({ sourceUserName, count }))
    .sort((a, b) => b.count - a.count || a.sourceUserName.localeCompare(b.sourceUserName, 'zh-CN'));

  // 逐题统计（仅统计"可见且非隐藏"字段；hidden 字段用默认值填充，不参与统计；分页标记不参与）
  const visibleFields = fields.filter(field => !field.hidden && field.type !== 'section_break');

  // 计算每个字段的"应显示基数"：有条件显示的字段，只统计源条件满足的答卷；无条件则用全部答卷
  const visibleFieldsBySubmission = parsed.map(item => getVisibleFieldIds(fields, item.answers));
  const fieldDenominator = new Map();
  for (const field of visibleFields) {
    const base = visibleFieldsBySubmission.reduce((count, ids) => count + (ids.has(field.id) ? 1 : 0), 0);
    fieldDenominator.set(field.id, base);
  }

  const fieldStats = visibleFields.map(field => {
    const denominator = fieldDenominator.get(field.id) || 0;
    const perAnswer = parsed.filter((_item, index) => visibleFieldsBySubmission[index].has(field.id));
    let answered = 0;
    const optionCounts = new Map();
    for (const item of perAnswer) {
      const value = item.answers[field.id];
      const empty = Array.isArray(value) ? value.length === 0 : value === '' || value == null;
      if (empty) continue;
      answered += 1;
      const values = Array.isArray(value) ? value : [value];
      for (const entry of values) {
        const text = String(entry);
        optionCounts.set(text, (optionCounts.get(text) || 0) + 1);
      }
    }
    const isChoice = field.type === 'single_choice' || field.type === 'multiple_choice';
    const options = isChoice ? field.options.map(option => ({
      option,
      count: optionCounts.get(option) || 0,
    })) : [];
    const otherCount = isChoice
      ? Math.max(0, answered - options.reduce((sum, item) => sum + item.count, 0))
      : 0;
    return {
      fieldId: field.id,
      label: field.label,
      type: field.type,
      required: field.required,
      answered,
      total: denominator,
      fillRate: denominator > 0 ? Math.round((answered / denominator) * 1000) / 10 : 0,
      isChoice,
      options,
      otherCount,
    };
  });

  // 全部提交数（用于展示当前筛选范围占比/对比）
  const allCountResult = db.exec('SELECT COUNT(*) AS c FROM questionnaire_submissions WHERE questionnaire_id=?', [req.params.id]);
  const allTotal = Number(allCountResult[0]?.values?.[0]?.[0]) || 0;

  // 周均与周峰值（最近12个自然周）
  const countedWeeks = weekBuckets.filter(item => item.count > 0).length;
  const recentWeekTotal = weekBuckets.reduce((sum, item) => sum + item.count, 0);
  const weeklyAvg = countedWeeks > 0 ? Math.round((recentWeekTotal / countedWeeks) * 10) / 10 : 0;
  const weeklyPeak = weekBuckets.reduce((max, item) => Math.max(max, item.count), 0);

  return res.json({
    stats: {
      total: parsed.length,
      allTotal,
      range: { from: fromDate || null, to: toDate || null },
      summary: { weeklyAvg, weeklyPeak, countedWeeks },
      statusCounts,
      sourceCounts,
      weekly: weekBuckets,
      fieldStats,
    },
  });
});

router.get('/:id', authMiddleware, async (req, res) => {
  const db = await getDb();
  const row = queryOne(db, 'SELECT * FROM questionnaires WHERE id=?', [req.params.id]);
  if (!row) return res.status(404).json({ error: '问卷不存在' });
  const submissions = listRows(
    db,
    'SELECT id,answers_json,submitted_at,status,updated_at FROM questionnaire_submissions WHERE questionnaire_id=? ORDER BY submitted_at DESC',
    [req.params.id],
  ).map(item => ({
    id: item.id,
    answers: parseJson(item.answers_json, {}),
    submittedAt: item.submitted_at,
    status: allowedSubmissionStatuses.has(item.status) ? item.status : 'new',
    updatedAt: item.updated_at || item.submitted_at,
  }));
  return res.json({ questionnaire: questionnaireFromRow(row, submissions.length), submissions });
});

router.post('/', authMiddleware, requireRole('user', 'admin'), async (req, res) => {
  const title = String(req.body?.title || '').trim().slice(0, 120);
  const description = String(req.body?.description || '').trim().slice(0, 2000);
  const thankYouMessage = String(req.body?.thankYouMessage || '').trim().slice(0, 500);
  const fields = normalizeFields(req.body?.fields || []);
  if (!title) return res.status(400).json({ error: '问卷名称不能为空' });
  if (!fields) return res.status(400).json({ error: '问卷题目设置无效' });
  const db = await getDb();
  const createdAt = now();
  const item = {
    id: makeId('questionnaire'),
    title,
    description,
    thankYouMessage,
    status: 'draft',
    publicToken: makeToken(),
    fields,
    createdBy: req.user.id,
    createdByName: req.user.display_name || '',
    createdAt,
    updatedAt: createdAt,
    submissionCount: 0,
  };
  db.run(
    'INSERT INTO questionnaires(id,title,description,status,public_token,fields_json,thank_you_message,created_by,created_by_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    [item.id, item.title, item.description, item.status, item.publicToken, JSON.stringify(item.fields), item.thankYouMessage, item.createdBy, item.createdByName, item.createdAt, item.updatedAt],
  );
  saveDb();
  logAudit(req.user.id, req.user.display_name, 'questionnaire.create', 'questionnaire', item.id, item.title);
  return res.status(201).json({ questionnaire: item });
});

router.put('/:id', authMiddleware, requireRole('user', 'admin'), async (req, res) => {
  const db = await getDb();
  const row = queryOne(db, 'SELECT * FROM questionnaires WHERE id=?', [req.params.id]);
  if (!row) return res.status(404).json({ error: '问卷不存在' });
  const title = req.body?.title === undefined ? row.title : String(req.body.title || '').trim().slice(0, 120);
  const description = req.body?.description === undefined ? row.description : String(req.body.description || '').trim().slice(0, 2000);
  const thankYouMessage = req.body?.thankYouMessage === undefined ? (row.thank_you_message || '') : String(req.body.thankYouMessage || '').trim().slice(0, 500);
  const status = req.body?.status === undefined ? row.status : String(req.body.status);
  const fields = req.body?.fields === undefined ? parseJson(row.fields_json, []) : normalizeFields(req.body.fields);
  if (!title) return res.status(400).json({ error: '问卷名称不能为空' });
  if (!allowedStatuses.has(status)) return res.status(400).json({ error: '问卷状态无效' });
  if (!fields) return res.status(400).json({ error: '问卷题目设置无效' });
  if (status === 'published' && fields.length === 0) return res.status(400).json({ error: '至少添加一道题目后才能发布' });
  const statusOnlyRequest = req.body && Object.keys(req.body).every(key => key === 'status');
  const availabilityToggle = statusOnlyRequest && (
    (row.status === 'published' && status === 'closed')
    || (row.status === 'closed' && status === 'published')
  );
  const updatedAt = availabilityToggle ? row.updated_at : now();

  // 发布时保存字段版本快照：历史答卷按提交时的快照渲染，避免字段改动导致错位
  if (!availabilityToggle && status === 'published' && (row.status !== 'published' || JSON.stringify(fields) !== JSON.stringify(parseJson(row.fields_json, [])))) {
    const versionRow = queryOne(db, 'SELECT COALESCE(MAX(version_no),0) AS m FROM questionnaire_versions WHERE questionnaire_id=?', [req.params.id]);
    const nextVersion = Number(versionRow?.m || 0) + 1;
    db.run(
      'INSERT INTO questionnaire_versions(id,questionnaire_id,version_no,fields_json,created_at,created_by,reason) VALUES(?,?,?,?,?,?,?)',
      [makeId('qver'), req.params.id, nextVersion, JSON.stringify(fields), updatedAt, req.user.id || '', row.status === 'published' ? '重新发布' : '首次发布'],
    );
  }

  db.run(
    'UPDATE questionnaires SET title=?,description=?,status=?,fields_json=?,thank_you_message=?,updated_at=? WHERE id=?',
    [title, description, status, JSON.stringify(fields), thankYouMessage, updatedAt, req.params.id],
  );
  saveDb();
  logAudit(req.user.id, req.user.display_name, 'questionnaire.update', 'questionnaire', req.params.id, `${title}: ${status}`);
  return res.json({ questionnaire: questionnaireFromRow({ ...row, title, description, status, fields_json: JSON.stringify(fields), thank_you_message: thankYouMessage, updated_at: updatedAt }, 0) });
});

router.delete('/:id', authMiddleware, requireRole('user', 'admin'), async (req, res) => {
  const db = await getDb();
  const row = queryOne(db, 'SELECT * FROM questionnaires WHERE id=?', [req.params.id]);
  if (!row) return res.status(404).json({ error: '问卷不存在' });
  if (req.user.role !== 'admin' && row.created_by !== req.user.id) {
    return res.status(403).json({ error: '只有创建人或管理员可以删除问卷' });
  }
  const submissionRows = listRows(db, 'SELECT answers_json FROM questionnaire_submissions WHERE questionnaire_id=?', [req.params.id]);
  submissionRows.forEach(submission => {
    const answers = parseJson(submission.answers_json, {});
    Object.values(answers).forEach(answer => {
      const storedName = String(answer?.storedName || '');
      const resolved = path.resolve(QUESTIONNAIRE_UPLOAD_DIR, storedName);
      const base = path.resolve(QUESTIONNAIRE_UPLOAD_DIR);
      try { if (storedName && resolved.startsWith(`${base}${path.sep}`) && fs.existsSync(resolved)) fs.unlinkSync(resolved); } catch (_) {}
    });
  });
  db.run('DELETE FROM questionnaire_submissions WHERE questionnaire_id=?', [req.params.id]);
  db.run('DELETE FROM questionnaire_share_history WHERE questionnaire_id=?', [req.params.id]);
  db.run('DELETE FROM questionnaires WHERE id=?', [req.params.id]);
  saveDbImmediate();
  logAudit(req.user.id, req.user.display_name, 'questionnaire.delete', 'questionnaire', req.params.id, row.title);
  return res.json({ success: true });
});

module.exports = router;
module.exports._test = { normalizeFields, validateAnswers, conditionMatches, getVisibleFieldIds };
