const express = require('express');
const { authMiddleware, requireRole } = require('../middleware/auth.cjs');
const { getDb } = require('../db.cjs');
const { ensureUserApiKey, revealUserApiKey } = require('../services/apiKeys.cjs');
const { logAudit } = require('../services/audit.cjs');

const router = express.Router();

router.get('/mine', authMiddleware, async (req, res) => {
  const apiKey = await ensureUserApiKey(req.user.id);
  res.json({ apiKey });
});

router.post('/mine/reveal', authMiddleware, requireRole('user', 'admin'), async (req, res) => {
  await getDb();
  const result = await revealUserApiKey(req.user.id, req.body?.password);
  if (!result.ok) return res.status(400).json({ error: result.error });
  logAudit(req.user.id, req.user.display_name, 'api-key.reveal', 'api-key', req.user.id, '查看专属 API Key');
  res.json({ plainKey: result.plainKey });
});

module.exports = router;
