const express = require('express');
const { authMiddleware } = require('../middleware/auth.cjs');
const { getChangesAfter, enabled } = require('../services/realtimeEvents.cjs');
const { getRealtimeMetrics } = require('../services/realtimeEvents.cjs');
const { getAuthenticatedClientCount } = require('../ws/hub.cjs');

const router = express.Router();
router.use(authMiddleware);

router.get('/changes', (req, res) => {
  if (!enabled('REALTIME_RECOVERY_ENABLED')) {
    return res.json({ events: [], latestSequence: Number(req.query.after) || 0, hasMore: false, requiresFullSync: false, disabled: true });
  }
  const client = {
    userId: req.user.id,
    role: req.user.role,
    department: req.user.department || '',
  };
  res.setHeader('Cache-Control', 'no-store');
  return res.json(getChangesAfter(req.query.after, client, req.query.limit));
});

router.get('/status', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: '仅管理员可查看实时同步状态' });
  return res.json({
    enabled: enabled('REALTIME_DATA_SYNC_ENABLED'),
    recoveryEnabled: enabled('REALTIME_RECOVERY_ENABLED'),
    connectedClients: getAuthenticatedClientCount(),
    ...getRealtimeMetrics(),
  });
});

module.exports = router;
