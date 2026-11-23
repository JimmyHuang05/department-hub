const express = require('express');
const adapter = express.Router();
let moduleRouter = null;

adapter.use((req, res, next) => {
  try {
    const { initialize } = require('../../modules/questionnaire/server/schema.cjs');
    if (!initialize()) return res.status(503).json({ error: '问卷模块正在初始化' });
    moduleRouter ||= require('../../modules/questionnaire/server/router.cjs');
    return moduleRouter(req, res, next);
  } catch (error) {
    console.error('[questionnaire-module] isolated failure:', error);
    return res.status(503).json({ error: '问卷模块暂不可用，主系统未受影响' });
  }
});

module.exports = adapter;
