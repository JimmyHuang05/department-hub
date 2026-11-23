// 模块广播采用可降级设计；主系统未提供广播能力时不影响提交。
function broadcastToAuthenticated(message) {
  try {
    const hub = require('../../../server/ws/hub.cjs');
    if (typeof hub.broadcastToAuthenticated === 'function') hub.broadcastToAuthenticated(message);
  } catch (_) { /* 问卷实时通知故障不影响主流程 */ }
}
function broadcastToUser(userId, message) {
  try {
    const hub = require('../../../server/ws/hub.cjs');
    if (typeof hub.broadcastToUser === 'function') hub.broadcastToUser(userId, message);
  } catch (_) { /* 问卷实时通知故障不影响主流程 */ }
}
module.exports = { broadcastToAuthenticated, broadcastToUser };
