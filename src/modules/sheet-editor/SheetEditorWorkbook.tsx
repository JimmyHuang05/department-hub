import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Workbook } from '@fortune-sheet/react';
import type { Sheet } from '@fortune-sheet/core';
import { LockKeyhole } from 'lucide-react';
import '@fortune-sheet/react/dist/index.css';
import LoadingSpinner from '../../components/LoadingSpinner';
import { useConfirm } from '../../components/Toast';
import { parseXlsxForFortuneSheet } from './xlsxToFortuneSheet';
import { serializeFortuneSheetWorkbook } from './fortuneSheetToXlsx';

interface SheetEditorWorkbookProps {
  fileId: string;
  sourceUrl: string;
  sessionId: string;
  sessionToken: string;
  initialChecksum: string;
  initialRevision: string;
  mode: 'edit' | 'readonly';
  lockOwnerName: string;
  onDirtyChange: (dirty: boolean) => void;
  historyRequest: number;
}

interface SheetVersion {
  id: string;
  checksum: string;
  size: number;
  sourceRevision: string;
  reason: 'auto_save' | 'before_restore' | string;
  createdByName: string;
  createdAt: string;
}

const WORKBOOK_TOOLBAR_ITEMS = [
  'undo', 'redo', 'clear-format', '|', 'currency-format', 'percentage-format',
  'number-decrease', 'number-increase', 'format', 'font-size', '|', 'bold',
  'italic', 'strike-through', 'underline', '|', 'font-color', 'background',
  'border', 'merge-cell', '|', 'horizontal-align', 'vertical-align', 'text-wrap',
  '|', 'freeze', 'filter', 'quick-formula', 'search',
];

export default function SheetEditorWorkbook({ fileId, sourceUrl, sessionId, sessionToken, initialChecksum, initialRevision, mode, lockOwnerName, onDirtyChange, historyRequest }: SheetEditorWorkbookProps) {
  const { confirm: ask, ConfirmDialog } = useConfirm();
  const [sheets, setSheets] = useState<Sheet[] | null>(null);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error' | 'conflict'>('idle');
  const [saveMessage, setSaveMessage] = useState('');
  const [lockLost, setLockLost] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [versions, setVersions] = useState<SheetVersion[]>([]);
  const [historyState, setHistoryState] = useState<'idle' | 'loading' | 'error' | 'restoring'>('idle');
  const [historyError, setHistoryError] = useState('');
  const readOnly = mode === 'readonly' || lockLost || sessionExpired;
  const versionRef = useRef({ checksum: initialChecksum, revision: initialRevision });
  const draftSheetsRef = useRef<Sheet[]>([]);
  const dirtyRef = useRef(false);
  const editGenerationRef = useRef(0);
  const saveInFlightRef = useRef(false);
  const conflictRef = useRef(false);
  const autoSaveTimerRef = useRef<number | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const historyRequestRef = useRef(historyRequest);
  const saveRef = useRef<(reason: 'manual' | 'auto' | 'retry') => Promise<void>>(async () => {});
  const clearSaveTimers = useCallback(() => {
    if (autoSaveTimerRef.current !== null) window.clearTimeout(autoSaveTimerRef.current);
    if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current);
    autoSaveTimerRef.current = null;
    retryTimerRef.current = null;
  }, []);
  const scheduleAutoSave = useCallback((delay = 4000) => {
    if (autoSaveTimerRef.current !== null) window.clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = null;
      void saveRef.current('auto');
    }, delay);
  }, []);
  const markDirty = useCallback(() => {
    if (readOnly) return;
    dirtyRef.current = true;
    editGenerationRef.current += 1;
    setDirty(true);
    setSaveState('idle');
    setSaveMessage(navigator.onLine === false ? '当前离线，修改将在恢复网络后自动保存' : '');
    onDirtyChange(true);
    if (!conflictRef.current) scheduleAutoSave();
  }, [onDirtyChange, readOnly, scheduleAutoSave]);
  const handleWorkbookChange = useCallback((nextSheets: Sheet[]) => {
    draftSheetsRef.current = nextSheets;
  }, []);
  const handleWorkbookOp = useCallback((operations: unknown[]) => {
    if (operations.length > 0) markDirty();
  }, [markDirty]);
  const workbookHooks = useMemo(() => ({
    afterAddSheet: markDirty,
    afterDeleteSheet: markDirty,
    afterUpdateSheetName: markDirty,
  }), [markDirty]);

  useEffect(() => {
    const controller = new AbortController();
    setSheets(null);
    setError('');
    setDirty(false);
    setSaveState('idle');
    setSaveMessage('');
    setLockLost(false);
    setSessionExpired(false);
    clearSaveTimers();
    dirtyRef.current = false;
    editGenerationRef.current = 0;
    saveInFlightRef.current = false;
    conflictRef.current = false;
    versionRef.current = { checksum: initialChecksum, revision: initialRevision };
    onDirtyChange(false);
    if (!sourceUrl.startsWith('/api/sheet-editor/')) {
      setError('文件读取地址无效');
      return () => controller.abort();
    }
    const token = localStorage.getItem('auth_token');
    fetch(sourceUrl, {
      signal: controller.signal,
      cache: 'no-store',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'X-Sheet-Session-Id': sessionId,
        'X-Sheet-Session-Token': sessionToken,
      },
    })
      .then(async response => {
        if (!response.ok) {
          const detail = await response.json().catch(() => ({}));
          throw new Error(detail.error || `读取文件失败 (${response.status})`);
        }
        return response.arrayBuffer();
      })
      .then(parseXlsxForFortuneSheet)
      .then(result => {
        if (!controller.signal.aborted) {
          draftSheetsRef.current = result;
          setSheets(result);
        }
      })
      .catch(cause => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '无法解析工作簿');
      });
    return () => {
      controller.abort();
      clearSaveTimers();
    };
  }, [clearSaveTimers, fileId, initialChecksum, initialRevision, onDirtyChange, sessionId, sessionToken, sourceUrl]);

  const save = useCallback(async (_reason: 'manual' | 'auto' | 'retry' = 'manual') => {
    if (readOnly || !dirtyRef.current || saveInFlightRef.current || conflictRef.current) return;
    if (navigator.onLine === false) {
      setSaveState('error');
      setSaveMessage('当前离线，修改仍保留在页面中；联网后将自动重试');
      return;
    }
    clearSaveTimers();
    saveInFlightRef.current = true;
    setSaveState('saving');
    setSaveMessage('');
    const savingGeneration = editGenerationRef.current;
    const savingSheets = structuredClone(draftSheetsRef.current);
    try {
      const buffer = await serializeFortuneSheetWorkbook(savingSheets);
      const token = localStorage.getItem('auth_token');
      const response = await fetch(`/api/sheet-editor/${encodeURIComponent(fileId)}/content`, {
        method: 'PUT',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'X-Sheet-Session-Id': sessionId,
          'X-Sheet-Session-Token': sessionToken,
          'X-Sheet-Expected-Checksum': versionRef.current.checksum,
          'X-Sheet-Expected-Revision': versionRef.current.revision,
        },
        body: buffer,
      });
      const result = await response.json().catch(() => ({}));
      if (response.status === 401 || response.status === 403) {
        conflictRef.current = true;
        setSessionExpired(true);
        setSaveState('conflict');
        setSaveMessage('');
        return;
      }
      if (response.status === 409) {
        conflictRef.current = true;
        setSaveState('conflict');
        setSaveMessage(result.error || '源文件已有新版本，请重新加载后再编辑');
        return;
      }
      if (response.status === 423) {
        conflictRef.current = true;
        setLockLost(true);
        setSaveState('conflict');
        setSaveMessage(result.error || '编辑锁已失效，页面已转为只读');
        return;
      }
      if (!response.ok) throw new Error(result.error || `保存失败 (${response.status})`);
      versionRef.current = { checksum: result.checksum, revision: result.revision };
      if (editGenerationRef.current === savingGeneration) {
        dirtyRef.current = false;
        setDirty(false);
        onDirtyChange(false);
        setSaveState('saved');
        setSaveMessage('');
      } else {
        setSaveState('idle');
        setSaveMessage('');
        scheduleAutoSave(1000);
      }
    } catch (cause) {
      setSaveState('error');
      setSaveMessage(`${cause instanceof Error ? cause.message : '保存失败'}；10 秒后自动重试`);
      retryTimerRef.current = window.setTimeout(() => {
        retryTimerRef.current = null;
        void saveRef.current('retry');
      }, 10000);
    } finally {
      saveInFlightRef.current = false;
    }
  }, [clearSaveTimers, fileId, onDirtyChange, readOnly, scheduleAutoSave, sessionId, sessionToken]);

  useEffect(() => { saveRef.current = save; }, [save]);

  useEffect(() => {
    const handleOnline = () => {
      if (dirtyRef.current && !conflictRef.current) {
        setSaveMessage('');
        void saveRef.current('retry');
      }
    };
    const handleOffline = () => {
      if (dirtyRef.current) setSaveMessage('当前离线，修改仍保留在页面中');
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const sessionHeaders = useCallback(() => {
    const token = localStorage.getItem('auth_token');
    return {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'X-Sheet-Session-Id': sessionId,
      'X-Sheet-Session-Token': sessionToken,
    };
  }, [sessionId, sessionToken]);

  const loadVersions = useCallback(async () => {
    setHistoryState('loading');
    setHistoryError('');
    try {
      const response = await fetch(`/api/sheet-editor/${encodeURIComponent(fileId)}/versions?limit=50`, {
        cache: 'no-store',
        headers: sessionHeaders(),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || '读取历史版本失败');
      setVersions(result.versions || []);
      setHistoryState('idle');
    } catch (cause) {
      setHistoryState('error');
      setHistoryError(cause instanceof Error ? cause.message : '读取历史版本失败');
    }
  }, [fileId, sessionHeaders]);

  useEffect(() => {
    if (historyRequest === historyRequestRef.current) return;
    historyRequestRef.current = historyRequest;
    setShowHistory(current => {
      const next = !current;
      if (next) void loadVersions();
      return next;
    });
  }, [historyRequest, loadVersions]);

  const downloadVersion = useCallback(async (version: SheetVersion) => {
    try {
      const response = await fetch(`/api/sheet-editor/${encodeURIComponent(fileId)}/versions/${encodeURIComponent(version.id)}/download`, {
        cache: 'no-store',
        headers: sessionHeaders(),
      });
      if (!response.ok) throw new Error('下载历史版本失败');
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `历史版本_${new Date(version.createdAt).toISOString().replace(/[:.]/g, '-')}.xlsx`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setHistoryError(cause instanceof Error ? cause.message : '下载历史版本失败');
    }
  }, [fileId, sessionHeaders]);

  const restoreVersion = useCallback(async (version: SheetVersion) => {
    if (readOnly || dirtyRef.current || !await ask({
      title: '确认恢复历史版本',
      message: `将恢复 ${new Date(version.createdAt).toLocaleString('zh-CN')} 的版本，当前版本会先自动备份。`,
      confirmText: '恢复此版本',
      tone: 'warning',
    })) return;
    setHistoryState('restoring');
    setHistoryError('');
    try {
      const response = await fetch(`/api/sheet-editor/${encodeURIComponent(fileId)}/versions/${encodeURIComponent(version.id)}/restore`, {
        method: 'POST',
        cache: 'no-store',
        headers: {
          ...sessionHeaders(),
          'X-Sheet-Expected-Checksum': versionRef.current.checksum,
          'X-Sheet-Expected-Revision': versionRef.current.revision,
        },
      });
      const result = await response.json().catch(() => ({}));
      if (response.status === 409 || response.status === 423) {
        conflictRef.current = true;
        if (response.status === 423) setLockLost(true);
        throw new Error(result.error || '当前状态已变化，请重新加载');
      }
      if (!response.ok) throw new Error(result.error || '恢复历史版本失败');
      dirtyRef.current = false;
      onDirtyChange(false);
      window.location.reload();
    } catch (cause) {
      setHistoryState('error');
      setHistoryError(cause instanceof Error ? cause.message : '恢复历史版本失败');
    }
  }, [ask, fileId, onDirtyChange, readOnly, sessionHeaders]);

  useEffect(() => {
    if (mode !== 'edit') return;
    let disposed = false;
    const token = localStorage.getItem('auth_token');
    const lockHeaders = {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'X-Sheet-Session-Id': sessionId,
      'X-Sheet-Session-Token': sessionToken,
    };
    const heartbeat = async () => {
      try {
        const response = await fetch(`/api/sheet-editor/${encodeURIComponent(fileId)}/lock/heartbeat`, {
          method: 'POST',
          cache: 'no-store',
          headers: lockHeaders,
        });
        if (!disposed && [401, 403, 423].includes(response.status)) {
          conflictRef.current = true;
          clearSaveTimers();
          setSaveState('conflict');
          if (response.status === 401 || response.status === 403) {
            setSessionExpired(true);
            setSaveMessage('');
          } else {
            setLockLost(true);
            setSaveMessage('编辑锁已失效，页面已转为只读；请重新加载后再继续');
          }
        }
      } catch {
        // A transient heartbeat failure does not immediately discard the lease;
        // the save endpoint remains the final lock authority.
      }
    };
    const release = () => {
      void fetch(`/api/sheet-editor/${encodeURIComponent(fileId)}/lock`, {
        method: 'DELETE',
        cache: 'no-store',
        keepalive: true,
        headers: lockHeaders,
      }).catch(() => {});
    };
    void heartbeat();
    const timer = window.setInterval(() => void heartbeat(), 25000);
    window.addEventListener('pagehide', release);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener('pagehide', release);
      release();
    };
  }, [clearSaveTimers, fileId, mode, sessionId, sessionToken]);

  useEffect(() => {
    const protectUnsavedChanges = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current && !saveInFlightRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', protectUnsavedChanges);
    return () => window.removeEventListener('beforeunload', protectUnsavedChanges);
  }, []);

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-red-600" role="alert">
        <span>{error}</span>
        <button type="button" onClick={() => window.location.reload()} className="h-9 bg-primary-600 px-4 text-xs font-medium text-white">重新加载</button>
      </div>
    );
  }
  if (!sheets) return <LoadingSpinner fullPage message="正在读取并解析工作簿..." />;

  const showActionBar = !sessionExpired && (readOnly || Boolean(saveMessage));

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col bg-white" data-testid="sheet-editor-workbook">
      {showActionBar && (
        <div className="sheet-editor-workbook__actions flex min-h-11 shrink-0 items-center justify-end gap-3 border-b border-surface-200 bg-white px-3">
          {readOnly && <span className="sheet-editor-workbook__readonly mr-auto truncate text-xs text-amber-700">只读模式{lockOwnerName ? ` · ${lockOwnerName} 正在编辑` : ''}</span>}
          {saveMessage && <span className={`mr-auto truncate text-xs ${saveState === 'error' || saveState === 'conflict' ? 'text-red-600' : 'text-surface-500'}`}>{saveMessage}</span>}
        </div>
      )}
      {showHistory && (
        <aside className={`sheet-editor-workbook__history absolute right-3 ${showActionBar ? 'top-12' : 'top-3'} z-30 w-[min(360px,calc(100vw-24px))] border border-surface-200 bg-white shadow-xl`} aria-label="历史版本">
          <div className="flex h-11 items-center justify-between border-b border-surface-200 px-3">
            <strong className="text-sm text-surface-900">历史版本</strong>
            <button type="button" onClick={() => setShowHistory(false)} className="text-xs text-surface-500">关闭</button>
          </div>
          <div className="sheet-editor-workbook__history-list max-h-80 overflow-y-auto p-2">
            {historyState === 'loading' && <p className="p-4 text-center text-xs text-surface-500">正在读取...</p>}
            {historyError && <p className="p-3 text-xs text-red-600">{historyError}</p>}
            {historyState !== 'loading' && versions.length === 0 && !historyError && <p className="p-4 text-center text-xs text-surface-500">尚无历史版本</p>}
            {versions.map(version => (
              <div key={version.id} className="border-b border-surface-100 px-2 py-3 last:border-b-0">
                <p className="text-xs font-medium text-surface-800">{new Date(version.createdAt).toLocaleString('zh-CN')}</p>
                <p className="mt-1 text-[11px] text-surface-400">{version.reason === 'before_restore' ? '恢复前备份' : '自动保存前备份'} · {version.createdByName || '未知用户'} · {(version.size / 1024).toFixed(1)} KB</p>
                <div className="mt-2 flex gap-2">
                  <button type="button" onClick={() => void downloadVersion(version)} className="text-xs text-primary-600">下载</button>
                  {!readOnly && <button type="button" disabled={dirty || historyState === 'restoring'} onClick={() => void restoreVersion(version)} className="text-xs text-primary-600 disabled:text-surface-300">恢复</button>}
                </div>
              </div>
            ))}
          </div>
        </aside>
      )}
      <div className="min-h-0 flex-1">
      <Workbook
        key={`${fileId}:${sessionId}`}
        data={sheets}
        onChange={handleWorkbookChange}
        onOp={handleWorkbookOp}
        hooks={workbookHooks}
        allowEdit={!readOnly}
        showToolbar={!readOnly}
        showFormulaBar
        showSheetTabs
        forceCalculation
        lang="zh"
        defaultRowHeight={28}
        defaultColWidth={100}
        toolbarItems={WORKBOOK_TOOLBAR_ITEMS}
      />
      </div>
      {sessionExpired && (
        <div className="sheet-editor-workbook__expired absolute inset-0 z-40 flex items-center justify-center bg-surface-200/90 backdrop-grayscale" role="alert" aria-label="编辑会话已过期" title="编辑会话已过期">
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-surface-300 text-surface-600 shadow-sm">
            <LockKeyhole size={36} strokeWidth={1.6} />
          </span>
        </div>
      )}
      {ConfirmDialog}
    </div>
  );
}
