import { create } from 'zustand';

export interface RemoteCursor {
  userId: string;
  displayName: string;
  color: string;
  recordId: string | null;
  field?: string;
  col: number;
  row: number;
}

export interface OnlineUser {
  userId: string;
  displayName: string;
  color: string;
}

export interface EditingPresence {
  userId: string;
  displayName: string;
  color: string;
  recordType: string;
  recordId: string | null;
  recordLabel: string;
  field: string;
  fieldLabel: string;
  location: string;
  startedAt: number;
  updatedAt: number;
  expiresAt: number;
}

interface CollaborationState {
  connected: boolean;
  userId: string | null;
  displayName: string | null;
  onlineUsers: OnlineUser[];
  remoteCursors: Map<string, RemoteCursor>;
  activeEditors: Map<string, EditingPresence>;
  edits: Array<{ userId: string; displayName: string; recordId: string; field: string; value: any; timestamp: number }>;

  setConnected: (connected: boolean) => void;
  setUserInfo: (userId: string, displayName: string) => void;
  setOnlineUsers: (users: OnlineUser[]) => void;
  addUser: (user: OnlineUser) => void;
  removeUser: (userId: string) => void;
  updateCursor: (cursor: RemoteCursor) => void;
  removeCursorsByUser: (userId: string) => void;
  addEdit: (edit: { userId: string; displayName: string; recordId: string; field: string; value: any; timestamp: number }) => void;
  upsertEditing: (editing: EditingPresence) => void;
  removeEditing: (editing: Pick<EditingPresence, 'userId' | 'recordType' | 'recordId' | 'field'>) => void;
  removeEditingByUser: (userId: string) => void;
  clearExpiredEditing: (now?: number) => void;
  clearAll: () => void;
}

function editingKey(editing: Pick<EditingPresence, 'userId' | 'recordType' | 'recordId' | 'field'>) {
  return `${editing.userId}:${editing.recordType}:${editing.recordId || '__global__'}:${editing.field}`;
}

function dedupeOnlineUsers(users: OnlineUser[]) {
  const map = new Map<string, OnlineUser>();
  users.forEach(user => {
    if (!user?.userId || map.has(user.userId)) return;
    map.set(user.userId, user);
  });
  return [...map.values()];
}

export const useCollaborationStore = create<CollaborationState>((set, get) => ({
  connected: false,
  userId: null,
  displayName: null,
  onlineUsers: [],
  remoteCursors: new Map(),
  activeEditors: new Map(),
  edits: [],

  setConnected: (connected) => set({ connected }),

  setUserInfo: (userId, displayName) => set({ userId, displayName }),

  setOnlineUsers: (users) => set({ onlineUsers: dedupeOnlineUsers(users) }),

  addUser: (user) => {
    const { onlineUsers } = get();
    if (onlineUsers.some(u => u.userId === user.userId)) return;
    set({ onlineUsers: [...onlineUsers, user] });
  },

  removeUser: (userId) => {
    const { onlineUsers, remoteCursors, activeEditors } = get();
    set({
      onlineUsers: onlineUsers.filter(u => u.userId !== userId),
      remoteCursors: new Map(
        [...remoteCursors.entries()].filter(([key]) => !key.startsWith(userId + ':'))
      ),
      activeEditors: new Map(
        [...activeEditors.entries()].filter(([key]) => !key.startsWith(userId + ':'))
      ),
    });
  },

  updateCursor: (cursor) => {
    const key = `${cursor.userId}:${cursor.recordId || '__global__'}`;
    const newCursors = new Map(
      [...get().remoteCursors.entries()].filter(([existingKey]) => !existingKey.startsWith(`${cursor.userId}:`))
    );
    if (cursor.col === -1 && cursor.row === -1) {
      newCursors.delete(key);
    } else {
      newCursors.set(key, cursor);
    }
    set({ remoteCursors: newCursors });
  },

  removeCursorsByUser: (userId) => {
    const newCursors = new Map(
      [...get().remoteCursors.entries()].filter(([key]) => !key.startsWith(userId + ':'))
    );
    set({ remoteCursors: newCursors });
  },

  addEdit: (edit) => {
    const edits = [...get().edits, edit].slice(-200);
    set({ edits });
  },

  upsertEditing: (editing) => {
    const activeEditors = new Map(get().activeEditors);
    activeEditors.set(editingKey(editing), editing);
    set({ activeEditors });
  },

  removeEditing: (editing) => {
    const activeEditors = new Map(get().activeEditors);
    activeEditors.delete(editingKey(editing));
    set({ activeEditors });
  },

  removeEditingByUser: (userId) => {
    const activeEditors = new Map(
      [...get().activeEditors.entries()].filter(([key]) => !key.startsWith(userId + ':'))
    );
    set({ activeEditors });
  },

  clearExpiredEditing: (now = Date.now()) => {
    const current = get().activeEditors;
    const activeEditors = new Map(
      [...current.entries()].filter(([, editing]) => editing.expiresAt > now)
    );
    if (activeEditors.size !== current.size) {
      set({ activeEditors });
    }
  },

  clearAll: () => {
    set({ onlineUsers: [], remoteCursors: new Map(), activeEditors: new Map(), edits: [] });
  },
}));
