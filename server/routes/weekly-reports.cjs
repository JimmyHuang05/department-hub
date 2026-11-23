const express = require('express');
const fs = require('fs');
const path = require('path');
const { getDb, saveDbImmediate } = require('../db.cjs');
const { authMiddleware, requireRole, queryOne } = require('../middleware/auth.cjs');
const { logAudit } = require('../services/audit.cjs');
const { WEEKLY_REPORT_DIR } = require('../paths.cjs');
const {
  TEMPLATE_VERSION,
  buildWeeklyReportModel,
  createWeeklyReportRun,
  listAvailableWeeks,
  loadDraft,
  loadInitialNotes,
  loadLatestNotes,
  loadReportSource,
  normalizeNotes,
  renderWeeklySummary,
  saveDraft,
} = require('../services/weeklySummary.cjs');

const router = express.Router();
const WEEK_KEY_PATTERN = /^\d{6}$/;

router.use(authMiddleware, requireRole('user', 'admin'));

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function validateWeekKey(value) {
  return WEEK_KEY_PATTERN.test(String(value || ''));
}

router.get('/weeks', async (req, res) => {
  const db = await getDb();
  res.json({ weekKeys: listAvailableWeeks(db), templateVersion: TEMPLATE_VERSION });
});

router.get('/drafts/:weekKey', async (req, res) => {
  const weekKey = String(req.params.weekKey || '');
  if (!validateWeekKey(weekKey)) return res.status(400).json({ error: '周次格式无效' });
  const db = await getDb();
  const draft = loadDraft(db, weekKey, req.user.id);
  const initial = draft ? null : loadInitialNotes(db, weekKey, req.user.id);
  res.json({
    weekKey,
    notes: draft?.notes || initial.notes,
    revision: draft?.revision || 0,
    updatedAt: draft?.updatedAt || '',
    inheritedFromWeekKey: initial?.inheritedFromWeekKey || '',
  });
});

router.put('/drafts/:weekKey', async (req, res) => {
  const weekKey = String(req.params.weekKey || '');
  if (!validateWeekKey(weekKey)) return res.status(400).json({ error: '周次格式无效' });
  const db = await getDb();
  const draft = saveDraft(db, weekKey, req.user.id, req.body.notes);
  saveDbImmediate();
  res.json({ success: true, weekKey, ...draft });
});

router.post('/preview', async (req, res) => {
  const weekKey = String(req.body.weekKey || '');
  if (!validateWeekKey(weekKey)) return res.status(400).json({ error: '周次格式无效' });
  const db = await getDb();
  const source = loadReportSource(db, weekKey);
  const hasNotes = req.body.notes && typeof req.body.notes === 'object';
  const notes = hasNotes
    ? normalizeNotes(req.body.notes)
    : (loadDraft(db, weekKey, req.user.id)?.notes || loadLatestNotes(db, weekKey));
  const model = buildWeeklyReportModel({ weekKey, ...source, notes });
  res.json({
    weekKey,
    templateVersion: TEMPLATE_VERSION,
    counts: model.counts,
    validation: model.validation,
    notes: model.notes,
    sample: {
      problemProjects: model.problemProjects.slice(0, 4).map(row => row[1]),
      pipelineProjects: model.pipelineProjects.slice(0, 8).map(row => row[1]),
      serviceProjects: model.serviceProjects.slice(0, 8).map(row => row[2]),
    },
    document: {
      title: model.title,
      reportDate: model.reportDate,
      problemProjects: model.problemProjects,
      pipelineProjects: model.pipelineProjects,
      directSales: model.directSales,
      serviceProjects: model.serviceProjects,
    },
  });
});

router.post('/generate', async (req, res) => {
  const weekKey = String(req.body.weekKey || '');
  if (!validateWeekKey(weekKey)) return res.status(400).json({ error: '周次格式无效' });
  try {
    const db = await getDb();
    const run = await createWeeklyReportRun(db, {
      weekKey,
      notes: normalizeNotes(req.body.notes),
      user: req.user,
    });
    saveDraft(db, weekKey, req.user.id, req.body.notes);
    saveDbImmediate();
    logAudit(
      req.user.id,
      req.user.display_name,
      'weekly-report.generate',
      'weekly-report',
      run.id,
      `${weekKey} · ${run.fileName} · 模板 ${run.templateVersion}`,
    );
    return res.json({ success: true, run });
  } catch (error) {
    if (error.code === 'REPORT_VALIDATION_FAILED') {
      return res.status(422).json({ error: error.message, validation: error.validation });
    }
    console.error('weekly report generation failed:', error);
    return res.status(500).json({ error: error.message || '工作小结生成失败' });
  }
});

router.get('/runs', async (req, res) => {
  const db = await getDb();
  const result = db.exec(
    `SELECT id,week_key,template_version,
      CASE WHEN json_valid(source_payload) THEN json_extract(source_payload, '$.model.counts') END AS counts,
      validation_result,payload_hash,file_hash,
      file_name,generated_by_name,generated_at
     FROM weekly_report_runs ORDER BY generated_at DESC LIMIT 100`,
  );
  const runs = (result[0]?.values || []).map(row => {
    return {
      id: row[0],
      weekKey: row[1],
      templateVersion: row[2],
      counts: parseJson(row[3], {}) || {},
      validation: parseJson(row[4], []),
      payloadHash: row[5],
      fileHash: row[6],
      fileName: row[7],
      generatedByName: row[8],
      generatedAt: row[9],
    };
  });
  res.json({ runs });
});

router.get('/runs/:id/download', async (req, res) => {
  const db = await getDb();
  const run = queryOne(
    db,
    'SELECT id,source_payload,file_name,stored_path,file_hash FROM weekly_report_runs WHERE id=?',
    [req.params.id],
  );
  if (!run) return res.status(404).json({ error: '生成记录不存在' });

  const reportsRoot = path.resolve(WEEKLY_REPORT_DIR);
  let storedPath = path.resolve(String(run.stored_path || ''));
  if (!storedPath.startsWith(`${reportsRoot}${path.sep}`)) {
    return res.status(400).json({ error: '生成文件路径无效' });
  }

  if (!fs.existsSync(storedPath)) {
    const source = parseJson(run.source_payload, {});
    if (!source.model) return res.status(410).json({ error: '生成文件已丢失，且缺少可复现数据快照' });
    const buffer = await renderWeeklySummary(source.model);
    fs.mkdirSync(WEEKLY_REPORT_DIR, { recursive: true });
    fs.writeFileSync(storedPath, buffer);
  }

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(run.file_name)}`);
  return res.sendFile(storedPath);
});

module.exports = router;
