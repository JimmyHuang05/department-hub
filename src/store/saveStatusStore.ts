import { create } from 'zustand';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface SaveStatusState {
  status: SaveStatus;
  message: string;
  lastSavedAt: number | null;
  setSaving: () => void;
  setSaved: (message?: string) => void;
  setError: (message?: string) => void;
  setIdle: () => void;
}

export const useSaveStatusStore = create<SaveStatusState>(set => ({
  status: 'idle',
  message: '',
  lastSavedAt: null,
  setSaving: () => set({ status: 'saving', message: '保存中…' }),
  setSaved: (message) => set({
    status: 'saved',
    message: message || '已自动保存',
    lastSavedAt: Date.now(),
  }),
  setError: (message) => set({ status: 'error', message: message || '保存失败' }),
  setIdle: () => set({ status: 'idle', message: '' }),
}));
