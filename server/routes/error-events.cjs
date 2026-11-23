const express = require('express');
const { authMiddleware, requireBusinessRole } = require('../middleware/auth.cjs');
const { readErrorEvents } = require('../services/errorEvents.cjs');

const router = express.Router();

router.get('/', authMiddleware, requireBusinessRole('developer'), (req, res) => {
  res.json(readErrorEvents(req.query.limit));
});

module.exports = router;
