import { readPageSnapshot, writePageSnapshot } from './pageSnapshot';

const STATE_TTL_MS = 2 * 60 * 60 * 1000;

export interface CloudDriveEditorState {
  fileId: string;
  fileName: string;
  folderId: string;
  projectId: string;
  search: string;
  sortKey: 'name' | 'type' | 'size' | 'uploader' | 'updatedAt';
  sortDirection: 'asc' | 'desc';
  sortCriterion: 'name' | 'type' | 'size' | 'uploader' | 'updatedAt' | 'operatedAt';
  viewMode: 'list' | 'grid';
  scrollTop: number;
  windowScrollY: number;
  savedAt: number;
}

function stateKey(userId?: string) {
  return `cloud-drive-editor:${userId || 'anonymous'}`;
}

export function saveCloudDriveEditorState(userId: string | undefined, state: CloudDriveEditorState) {
  try {
    writePageSnapshot(stateKey(userId), userId, state);
  } catch {
    // Navigation must continue even when browser storage is unavailable.
  }
}

export function readCloudDriveEditorState(userId: string | undefined, projectId?: string): CloudDriveEditorState | null {
  try {
    const state = readPageSnapshot<CloudDriveEditorState>(stateKey(userId), userId);
    if (!state.fileId || !state.savedAt || Date.now() - state.savedAt > STATE_TTL_MS) return null;
    if (projectId !== undefined && String(state.projectId || '') !== projectId) return null;
    return {
      fileId: String(state.fileId),
      fileName: String(state.fileName || ''),
      folderId: String(state.folderId || ''),
      projectId: String(state.projectId || ''),
      search: String(state.search || ''),
      sortKey: state.sortKey || 'updatedAt',
      sortDirection: state.sortDirection || 'desc',
      sortCriterion: state.sortCriterion || 'updatedAt',
      viewMode: state.viewMode || 'list',
      scrollTop: Number(state.scrollTop) || 0,
      windowScrollY: Number(state.windowScrollY) || 0,
      savedAt: Number(state.savedAt),
    };
  } catch {
    return null;
  }
}

export function buildCloudDriveReturnUrl(state: CloudDriveEditorState | null, fallbackFileId = '') {
  const params = new URLSearchParams();
  const fileId = state?.fileId || fallbackFileId;
  if (fileId) params.set('fileId', fileId);
  if (state?.projectId) params.set('projectId', state.projectId);
  params.set('fromSheetEditor', '1');
  return `/cloud-drive?${params.toString()}`;
}
