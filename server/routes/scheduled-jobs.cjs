const express = require('express');
const { authMiddleware, requireRole } = require('../middleware/auth.cjs');
const { logAudit } = require('../services/audit.cjs');
const {
  listJobRuns,
  listScheduledJobs,
  runScheduledJob,
  updateScheduledJob,
} = require('../services/scheduledJobs.cjs');

const router = express.Router();
router.use(authMiddleware, requireRole('admin'));

router.get('/', (_req, res) => {
  res.json({ jobs: listScheduledJobs(), timezone: 'Asia/Shanghai' });
});

router.put('/:key', (req, res) => {
  try {
    const job = updateScheduledJob(req.params.key, req.body || {}, req.user.display_name || req.user.id);
    logAudit(req.user.id, req.user.display_name, 'scheduled-job.update', 'scheduled-job', req.params.key, `enabled=${job.enabled}`);
    res.json({ job });
  } catch (error) {
    res.status(error.statusCode || 400).json({ error: error.message || '保存定时任务失败' });
  }
});

router.post('/:key/run', async (req, res) => {
  try {
    await runScheduledJob(req.params.key, {
      triggerType: 'manual',
      triggeredBy: req.user.display_name || req.user.id,
    });
    const run = listJobRuns(req.params.key, 1)[0];
    logAudit(req.user.id, req.user.display_name, 'scheduled-job.run', 'scheduled-job', req.params.key, run.status);
    res.json({ run, job: listScheduledJobs().find(job => job.key === req.params.key) });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || '执行定时任务失败' });
  }
});

router.get('/:key/runs', (req, res) => {
  res.json({ runs: listJobRuns(req.params.key, req.query.limit) });
});

module.exports = router;
