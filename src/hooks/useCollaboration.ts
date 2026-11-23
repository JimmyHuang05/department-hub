import { useEffect } from 'react';
import { useAuthStore } from '../store/authStore';
import { useCollaborationStore } from '../store/collaborationStore';
import { wsClient } from '../lib/ws';
import { useShallow } from 'zustand/react/shallow';
import { showRealtimeBrowserNotification } from '../utils/browserNotifications';
import { acceptDataChange, recoverDataChanges, type DataChangeEvent } from '../lib/realtime';
import { useProjectStore } from '../store/projectStore';
import { useWorkLogStore } from '../store/workLogStore';
import { useSettingsStore } from '../store/settingsStore';

interface EditingPresencePayload {
  recordType?: string;
  recordId: string | null;
  recordLabel?: string;
  field: string;
  fieldLabel?: string;
  location?: string;
  startedAt?: number;
}

export function useCollaboration() {
  const { user, isAuthenticated } = useAuthStore(useShallow(s => ({ user: s.user, isAuthenticated: s.isAuthenticated })));
  const {
    setConnected,
    setUserInfo,
    setOnlineUsers,
    addUser,
    removeUser,
    updateCursor,
    addEdit,
    upsertEditing,
    removeEditing,
    clearExpiredEditing,
    clearAll,
  } = useCollaborationStore(useShallow(s => ({
    setConnected: s.setConnected,
    setUserInfo: s.setUserInfo,
    setOnlineUsers: s.setOnlineUsers,
    addUser: s.addUser,
    removeUser: s.removeUser,
    updateCursor: s.updateCursor,
    addEdit: s.addEdit,
    upsertEditing: s.upsertEditing,
    removeEditing: s.removeEditing,
    clearExpiredEditing: s.clearExpiredEditing,
    clearAll: s.clearAll,
  })));

  useEffect(() => {
    if (!isAuthenticated || !user) return;

    const token = localStorage.getItem('auth_token');
    if (!token) return;

    wsClient.connect(token);

    const unsubStatus = wsClient.onConnectionChange(setConnected);

    const unsubReady = wsClient.on('_ready', (msg) => {
      setUserInfo(msg.userId, msg.displayName);
      wsClient.send({
        type: 'join',
        room: 'products',
        displayName: msg.displayName,
      });
      void recoverDataChanges(user.id).catch(error => console.warn('[realtime] recovery failed', error));
    });

    const unsubUsers = wsClient.on('users', (msg) => {
      setOnlineUsers(msg.users || []);
    });

    const unsubJoined = wsClient.on('user-joined', (msg) => {
      addUser({ userId: msg.userId, displayName: msg.displayName, color: msg.color });
    });

    const unsubLeft = wsClient.on('user-left', (msg) => {
      removeUser(msg.userId);
    });

    const unsubEdit = wsClient.on('cell-edit', (msg) => {
      addEdit({
        userId: msg.userId,
        displayName: msg.displayName,
        recordId: msg.recordId,
        field: msg.field,
        value: msg.value,
        timestamp: msg.timestamp,
      });
    });

    const unsubCursor = wsClient.on('cursor', (msg) => {
      updateCursor({
        userId: msg.userId,
        displayName: msg.displayName,
        color: msg.color,
        recordId: msg.recordId,
        field: msg.field,
        col: msg.col,
        row: msg.row,
      });
    });

    const unsubEditing = wsClient.on('editing-presence', (msg) => {
      const base = {
        userId: msg.userId,
        recordType: msg.recordType || 'record',
        recordId: msg.recordId ?? null,
        field: msg.field || '',
      };
      if (msg.action === 'stop') {
        removeEditing(base);
        return;
      }
      upsertEditing({
        ...base,
        displayName: msg.displayName,
        color: msg.color,
        recordLabel: msg.recordLabel || '',
        fieldLabel: msg.fieldLabel || '',
        location: msg.location || '',
        startedAt: Number(msg.startedAt) || Date.now(),
        updatedAt: Number(msg.updatedAt) || Date.now(),
        expiresAt: Number(msg.expiresAt) || Date.now() + 45000,
      });
    });

    const handleForcedLogout = (msg: any) => {
      window.dispatchEvent(new CustomEvent('ibd:forced-logout', { detail: msg }));
    };
    const unsubForceLogout = wsClient.on('force-logout', handleForcedLogout);
    const unsubAuthError = wsClient.on('auth-error', (msg) => {
      if (msg.code === 'SESSION_REVOKED') handleForcedLogout(msg);
    });
    const unsubNotification = wsClient.on('notification-new', (msg) => {
      window.dispatchEvent(new CustomEvent('ibd:notification-new', { detail: msg.notification }));
      void showRealtimeBrowserNotification(user.id, msg.notification || {});
    });
    let refreshTimer = 0;
    const queueGlobalRefresh = (event: DataChangeEvent) => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        if (event.resource === 'project') void useProjectStore.getState().fetchProducts();
        if (event.resource === 'worklog') void useWorkLogStore.getState().fetchEntries();
        if (event.resource === 'settings') void useSettingsStore.getState().reloadSettings();
        if (event.resource === 'user') void useAuthStore.getState().refreshUser();
      }, 120);
    };
    const unsubDataChange = wsClient.on('data-change', (msg) => {
      const event = msg as DataChangeEvent;
      const lastSequence = Number(sessionStorage.getItem(`ibd_realtime_sequence:${user.id}`)) || 0;
      if (lastSequence > 0 && event.sequence > lastSequence + 1) {
        void recoverDataChanges(user.id).then(() => {
          if (acceptDataChange(event, user.id)) queueGlobalRefresh(event);
        }).catch(error => console.warn('[realtime] gap recovery failed', error));
        return;
      }
      if (acceptDataChange(event, user.id)) queueGlobalRefresh(event);
    });
    const recover = () => void recoverDataChanges(user.id).catch(error => console.warn('[realtime] recovery failed', error));
    const recoverWhenVisible = () => { if (document.visibilityState === 'visible') recover(); };
    window.addEventListener('online', recover);
    window.addEventListener('focus', recover);
    document.addEventListener('visibilitychange', recoverWhenVisible);

    const pruneTimer = window.setInterval(() => {
      clearExpiredEditing();
    }, 10000);

    return () => {
      unsubStatus();
      unsubReady();
      unsubUsers();
      unsubJoined();
      unsubLeft();
      unsubEdit();
      unsubCursor();
      unsubEditing();
      unsubForceLogout();
      unsubAuthError();
      unsubNotification();
      unsubDataChange();
      window.clearTimeout(refreshTimer);
      window.removeEventListener('online', recover);
      window.removeEventListener('focus', recover);
      document.removeEventListener('visibilitychange', recoverWhenVisible);
      window.clearInterval(pruneTimer);
      wsClient.close();
      clearAll();
    };
  }, [isAuthenticated, user?.id]);
}

export function broadcastCellEdit(recordId: string, field: string, value: any) {
  wsClient.send({ type: 'cell-edit', recordId, field, value });
}

let lastCursorBroadcast = 0;
export function broadcastCursor(recordId: string | null, col: number, row: number, field?: string) {
  const now = Date.now();
  if (now - lastCursorBroadcast < 80) return;
  lastCursorBroadcast = now;
  wsClient.send({ type: 'cursor', recordId, col, row, field });
}

export function broadcastEditingStart(payload: EditingPresencePayload) {
  wsClient.send({
    type: 'editing-lock',
    action: 'acquire',
    recordType: payload.recordType || 'record',
    recordId: payload.recordId,
    recordLabel: payload.recordLabel || '',
    field: payload.field,
    fieldLabel: payload.fieldLabel || '',
    location: payload.location || '',
    startedAt: payload.startedAt || Date.now(),
  });
}

export function broadcastEditingStop(payload: EditingPresencePayload) {
  wsClient.send({
    type: 'editing-lock',
    action: 'release',
    recordType: payload.recordType || 'record',
    recordId: payload.recordId,
    field: payload.field,
  });
}

export function requestEditingLock(payload: EditingPresencePayload): Promise<{ granted: boolean; owner?: string }> {
  if (!wsClient.connected) return Promise.resolve({ granted: false, owner: '协同服务未连接' });
  const requestId = `lock-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return new Promise(resolve => {
    let settled = false;
    const finish = (result: { granted: boolean; owner?: string }) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      unsubscribe();
      resolve(result);
    };
    const unsubscribe = wsClient.on('editing-lock-result', msg => {
      if (msg.requestId !== requestId) return;
      finish({ granted: Boolean(msg.granted), owner: msg.owner?.displayName });
    });
    const timer = window.setTimeout(() => finish({ granted: false, owner: '协同服务响应超时' }), 3000);
    wsClient.send({
      type: 'editing-lock', action: 'acquire', requestId,
      recordType: payload.recordType || 'record', recordId: payload.recordId,
      recordLabel: payload.recordLabel || '', field: payload.field,
      fieldLabel: payload.fieldLabel || '', location: payload.location || '',
      startedAt: payload.startedAt || Date.now(),
    });
  });
}

export function joinRoom(room: string) {
  const store = useCollaborationStore.getState();
  wsClient.send({
    type: 'join',
    room,
    displayName: store.displayName || '',
  });
}
