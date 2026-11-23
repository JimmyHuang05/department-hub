/**
 * WebSocket 协作中心
 * 管理连接、房间、用户在线状态、消息路由与冲突检测
 */
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../middleware/auth.cjs');
const { PUBLIC_DEMO_ID, getPublicDemoCredentials } = require('../services/publicDemo.cjs');
const { isSessionActive, touchSession } = require('../services/sessions.cjs');
const { canReceiveEvent } = require('../services/realtimeEvents.cjs');

// 房间映射: roomName → Set<client>
const rooms = new Map();
// 客户端信息: ws → { userId, displayName, room }
const clients = new Map();
const clientsBySession = new Map();
const authenticatedClients = new Set();
const editingLocks = new Map();
// Cell locks are deliberately short-lived: the client refreshes them only while
// an editor is open, and a dropped connection releases the cell quickly.
const EDITING_LOCK_TTL = 15000;

function editingLockKey(recordType, recordId, field) {
  return `${String(recordType || 'record')}:${String(recordId || '')}:${String(field || '')}`;
}

function pruneEditingLocks(now = Date.now()) {
  for (const [key, lock] of editingLocks.entries()) {
    if (lock.expiresAt <= now || lock.ws.readyState !== 1) editingLocks.delete(key);
  }
}

function getEditingLockOwner(recordType, recordId, field) {
  pruneEditingLocks();
  return editingLocks.get(editingLockKey(recordType, recordId, field)) || null;
}

function getEditingLocks(recordType, recordId) {
  pruneEditingLocks();
  const prefix = `${String(recordType || 'record')}:${String(recordId || '')}:`;
  return [...editingLocks.entries()]
    .filter(([key]) => key.startsWith(prefix))
    .map(([, lock]) => lock);
}

const USER_COLORS = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16',
];

function getUserColor(userId) {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash) + userId.charCodeAt(i);
    hash |= 0;
  }
  return USER_COLORS[Math.abs(hash) % USER_COLORS.length];
}

function handleConnection(ws) {
  let authenticated = false;
  let heartbeatTimer = null;

  const send = (data) => {
    if (ws.readyState === 1) { // WebSocket.OPEN
      ws.send(JSON.stringify(data));
    }
  };

  // 心跳检测
  const startHeartbeat = () => {
    heartbeatTimer = setInterval(() => {
      send({ type: 'ping' });
    }, 25000);
  };

  // 广播给房间内其他人
  const broadcastToRoom = (room, message, excludeWs = null) => {
    const roomClients = rooms.get(room);
    if (!roomClients) return;
    for (const client of roomClients) {
      if (client !== excludeWs && client.readyState === 1) {
        client.send(JSON.stringify(message));
      }
    }
  };

  // 广播房间用户列表
  const broadcastRoomUsers = (room) => {
    const roomClients = rooms.get(room);
    if (!roomClients) return;
    const usersById = new Map();
    for (const client of roomClients) {
      const info = clients.get(client);
      if (info && !usersById.has(info.userId)) {
        usersById.set(info.userId, {
          userId: info.userId,
          displayName: info.displayName,
          color: info.color,
        });
      }
    }
    broadcastToRoom(room, { type: 'users', users: [...usersById.values()] });
  };

  // 加入房间
  const joinRoom = (info) => {
    if (!rooms.has(info.room)) {
      rooms.set(info.room, new Set());
    }
    rooms.get(info.room).add(ws);
    clients.set(ws, info);
    // 通知房间有新用户
    broadcastToRoom(info.room, {
      type: 'user-joined',
      userId: info.userId,
      displayName: info.displayName,
      color: info.color,
    });
    broadcastRoomUsers(info.room);
  };

  // 离开房间
  const leaveRoom = () => {
    const info = clients.get(ws);
    if (!info) return;
    rooms.get(info.room)?.delete(ws);
    if (rooms.get(info.room)?.size === 0) rooms.delete(info.room);
    clients.delete(ws);
    broadcastToRoom(info.room, {
      type: 'user-left',
      userId: info.userId,
      displayName: info.displayName,
    });
    broadcastRoomUsers(info.room);
  };

  const releaseClientLocks = () => {
    const info = clients.get(ws);
    for (const [key, lock] of editingLocks.entries()) {
      if (lock.ws !== ws) continue;
      editingLocks.delete(key);
      if (info?.room) {
        broadcastToRoom(info.room, {
          type: 'editing-presence', action: 'stop', userId: lock.userId,
          displayName: lock.displayName, color: lock.color, recordType: lock.recordType,
          recordId: lock.recordId, field: lock.field, updatedAt: Date.now(), expiresAt: Date.now(),
        }, ws);
      }
    }
  };

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      // 认证消息
      if (msg.type === 'auth') {
        try {
          const decoded = jwt.verify(msg.token, JWT_SECRET);
          if (decoded.id === PUBLIC_DEMO_ID && !getPublicDemoCredentials()) {
            ws.close();
            return;
          }
          if (decoded.sid && !isSessionActive(decoded.sid)) {
            send({ type: 'auth-error', code: 'SESSION_REVOKED', error: '你的账号已在另一台设备登录，本设备已下线。' });
            ws.close();
            return;
          }
          if (decoded.sid) {
            touchSession(decoded.sid);
            if (!clientsBySession.has(decoded.sid)) clientsBySession.set(decoded.sid, new Set());
            clientsBySession.get(decoded.sid).add(ws);
          }
          authenticated = true;
          ws.userId = decoded.id;
          ws.role = decoded.role || 'user';
          ws.department = decoded.department || '';
          ws.sessionId = decoded.sid || '';
          authenticatedClients.add(ws);
          send({ type: 'auth-ok', userId: decoded.id, displayName: decoded.display_name });
          startHeartbeat();
        } catch {
          send({ type: 'auth-error', error: '认证失败' });
          ws.close();
        }
        return;
      }

      if (!authenticated) {
        send({ type: 'error', error: '未认证' });
        return;
      }

      // 加入房间
      if (msg.type === 'join') {
        const info = {
          userId: ws.userId,
          displayName: msg.displayName,
          room: msg.room,
          color: getUserColor(ws.userId),
        };
        // 离开当前房间
        releaseClientLocks();
        leaveRoom();
        joinRoom(info);
        return;
      }

      if (msg.type === 'leave') {
        releaseClientLocks();
        leaveRoom();
        return;
      }

      if (ws.userId === PUBLIC_DEMO_ID) {
        if (msg.type === 'editing-lock') send({ type: 'editing-lock-result', requestId: msg.requestId || '', granted: false });
        return;
      }

      // 单元格编辑广播
      if (msg.type === 'cell-edit') {
        const info = clients.get(ws);
        if (!info || !info.room) return;
        // 广播给房间内其他人（编辑已通过 API 持久化）
        broadcastToRoom(info.room, {
          type: 'cell-edit',
          userId: info.userId,
          displayName: info.displayName,
          recordId: msg.recordId,
          field: msg.field,
          value: msg.value,
          timestamp: Date.now(),
        }, ws);
        return;
      }

      // 游标位置广播
      if (msg.type === 'cursor') {
        const info = clients.get(ws);
        if (!info || !info.room) return;
        broadcastToRoom(info.room, {
          type: 'cursor',
          userId: info.userId,
          displayName: info.displayName,
          color: info.color,
          recordId: msg.recordId,
          field: msg.field == null ? '' : String(msg.field),
          col: msg.col,
          row: msg.row,
        }, ws);
        return;
      }

      if (msg.type === 'editing-lock' || msg.type === 'editing-presence') {
        const info = clients.get(ws);
        if (!info || !info.room) return;
        const now = Date.now();
        pruneEditingLocks(now);
        const action = msg.action === 'stop' || msg.action === 'release' ? 'stop' : 'start';
        const recordType = String(msg.recordType || 'record');
        const recordId = msg.recordId == null ? null : String(msg.recordId);
        const field = msg.field == null ? '' : String(msg.field);
        const key = editingLockKey(recordType, recordId, field);
        const current = editingLocks.get(key);
        if (action === 'start' && current && current.userId !== info.userId) {
          send({
            type: 'editing-lock-result', requestId: msg.requestId || '', granted: false,
            recordType, recordId, field,
            owner: { userId: current.userId, displayName: current.displayName, color: current.color },
          });
          return;
        }
        if (action === 'stop') {
          if (!current || current.userId !== info.userId) return;
          editingLocks.delete(key);
        } else {
          editingLocks.set(key, {
            ws, userId: info.userId, displayName: info.displayName, color: info.color,
            recordType, recordId, field,
            recordLabel: msg.recordLabel == null ? '' : String(msg.recordLabel),
            fieldLabel: msg.fieldLabel == null ? '' : String(msg.fieldLabel),
            location: msg.location == null ? '' : String(msg.location),
            startedAt: current?.startedAt || Number(msg.startedAt) || now,
            updatedAt: now, expiresAt: now + EDITING_LOCK_TTL,
          });
          send({ type: 'editing-lock-result', requestId: msg.requestId || '', granted: true, recordType, recordId, field });
        }
        broadcastToRoom(info.room, {
          type: 'editing-presence',
          action,
          userId: info.userId,
          displayName: info.displayName,
          color: info.color,
          recordType,
          recordId,
          recordLabel: msg.recordLabel == null ? '' : String(msg.recordLabel),
          field,
          fieldLabel: msg.fieldLabel == null ? '' : String(msg.fieldLabel),
          location: msg.location == null ? '' : String(msg.location),
          startedAt: Number(msg.startedAt) || now,
          updatedAt: now,
          expiresAt: action === 'start' ? now + EDITING_LOCK_TTL : now,
        }, ws);
        return;
      }

      // 冲突确认
      if (msg.type === 'conflict-resolve') {
        const info = clients.get(ws);
        if (!info || !info.room) return;
        broadcastToRoom(info.room, {
          type: 'conflict-resolve',
          userId: info.userId,
          displayName: info.displayName,
          recordId: msg.recordId,
          field: msg.field,
          value: msg.value,
          timestamp: Date.now(),
        }, ws);
      }

    } catch (e) {
      console.error('WS消息解析错误:', e.message);
    }
  });

  ws.on('close', () => {
    authenticatedClients.delete(ws);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (ws.sessionId && clientsBySession.has(ws.sessionId)) {
      clientsBySession.get(ws.sessionId).delete(ws);
      if (clientsBySession.get(ws.sessionId).size === 0) clientsBySession.delete(ws.sessionId);
    }
    releaseClientLocks();
    leaveRoom();
  });

  ws.on('error', () => {
    authenticatedClients.delete(ws);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (ws.sessionId && clientsBySession.has(ws.sessionId)) {
      clientsBySession.get(ws.sessionId).delete(ws);
      if (clientsBySession.get(ws.sessionId).size === 0) clientsBySession.delete(ws.sessionId);
    }
    releaseClientLocks();
    leaveRoom();
  });
}

function broadcastToAuthenticated(message) {
  const payload = JSON.stringify(message);
  for (const socket of authenticatedClients) {
    if (socket.readyState === 1) socket.send(payload);
  }
}

function broadcastDataChange(message) {
  const payload = JSON.stringify(message);
  for (const socket of authenticatedClients) {
    if (socket.readyState === 1 && canReceiveEvent(socket, message)) socket.send(payload);
  }
}

function getAuthenticatedClientCount() { return authenticatedClients.size; }

function broadcastToUser(userId, message) {
  const target = String(userId || '');
  if (!target) return;
  const payload = JSON.stringify(message);
  for (const socket of authenticatedClients) {
    if (String(socket.userId || '') === target && socket.readyState === 1) socket.send(payload);
  }
}

function notifySessionRevoked(sessionId, payload = {}) {
  const sockets = clientsBySession.get(sessionId);
  if (!sockets) return;
  for (const socket of Array.from(sockets)) {
    if (socket.readyState === 1) {
      socket.send(JSON.stringify({
        type: 'force-logout',
        reason: payload.reason || 'same_device_type_login',
        message: payload.message || '你的账号已在另一台设备登录，本设备已下线。',
        deviceType: payload.deviceType || '',
        deviceName: payload.deviceName || '',
        loginAt: payload.loginAt || new Date().toISOString(),
      }));
    }
    socket.close();
  }
  clientsBySession.delete(sessionId);
}

module.exports = { handleConnection, notifySessionRevoked, broadcastToAuthenticated, broadcastToUser, broadcastDataChange, getAuthenticatedClientCount, getEditingLockOwner, getEditingLocks };
