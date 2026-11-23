import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, Check, FileSpreadsheet, History, Menu, Pencil, Plus, RefreshCw, X } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import LoadingSpinner from '../components/LoadingSpinner';
import AppModal from '../components/Layout/AppModal';
import { useConfirm } from '../components/Toast';
import { useAuthStore } from '../store/authStore';
import { readCloudDriveEditorState } from '../utils/cloudDriveEditorState';
import { loadPageWithRecovery } from '../utils/dynamicImportRecovery';
import { buildServerErrorMessage } from '../utils/errorCodes';
import { api } from '../lib/api';
import '../styles/sheet-editor.css';

const SheetEditorWorkbook = lazy(() => loadPageWithRecovery(
  () => import('../modules/sheet-editor/SheetEditorWorkbook'),
));

interface SheetEditorSession {
  sessionId: string;
  sessionToken: string;
  mode: 'edit' | 'readonly';
  lock: { ownerName: string; expiresAt: string } | null;
  expiresAt: string;
  sourceUrl: string;
  file: {
    id: string;
    name: string;
    size: number;
    mimeType: string;
    revision: string;
    checksum: string;
  };
}

interface CloudSheetFile {
  id: string;
  fileName: string;
  fileSize: number;
  kind?: 'file' | 'folder';
  deletedAt?: string;
  uploadedAt?: string;
  renamedAt?: string;
}

function sheetTitle(fileName?: string) {
  return String(fileName || '').replace(/\.xlsx$/i, '');
}

class SheetEditorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('独立表格编辑器运行失败', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full items-center justify-center bg-surface-50 p-5" role="alert">
        <div className="w-full max-w-md border border-amber-200 bg-white p-6 text-center shadow-sm">
          <AlertTriangle size={24} className="mx-auto text-amber-600" />
          <h2 className="mt-3 text-base font-semibold text-surface-900">表格编辑器暂时无法加载</h2>
          <p className="mt-2 text-sm leading-6 text-surface-500">故障已与云盘和主业务页面隔离，可以重新加载后再试。</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-5 inline-flex h-10 items-center justify-center gap-2 bg-primary-600 px-4 text-sm font-medium text-white hover:bg-primary-700"
          >
            <RefreshCw size={15} />
            重新加载
          </button>
        </div>
      </div>
    );
  }
}

export default function SheetEditorPage() {
  const { confirm: ask, ConfirmDialog } = useConfirm();
  const navigate = useNavigate();
  const { fileId = '' } = useParams<{ fileId: string }>();
  const userId = useAuthStore(state => state.user?.id);
  const rememberedState = readCloudDriveEditorState(userId);
  const matchingState = rememberedState?.fileId === fileId ? rememberedState : null;
  const [session, setSession] = useState<SheetEditorSession | null>(null);
  const [sessionError, setSessionError] = useState('');
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [historyRequest, setHistoryRequest] = useState(0);
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [cloudSheets, setCloudSheets] = useState<CloudSheetFile[]>([]);
  const [fileMenuState, setFileMenuState] = useState<'idle' | 'loading' | 'error' | 'creating'>('idle');
  const [fileMenuError, setFileMenuError] = useState('');
  const [filePickerOpen, setFilePickerOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [renameSaving, setRenameSaving] = useState(false);
  const [renameError, setRenameError] = useState('');
  const fileMenuRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const handleDirtyChange = useCallback((value: boolean) => setDirty(value), []);

  useEffect(() => {
    const previousTitle = document.title;
    const currentFileName = sheetTitle(session?.file.name || matchingState?.fileName);
    document.title = currentFileName ? `${currentFileName}｜GCO Link Excel` : 'GCO Link｜Excel';
    return () => { document.title = previousTitle; };
  }, [matchingState?.fileName, session?.file.name]);
  const openSheetFile = useCallback(async (nextFileId: string) => {
    if (!nextFileId || nextFileId === fileId) {
      setFileMenuOpen(false);
      return;
    }
    if (dirty && !await ask({
      title: '放弃未保存的修改？',
      message: '当前表格仍有修改尚未保存，切换后这些修改可能丢失。',
      confirmText: '放弃并切换',
      tone: 'danger',
    })) return;
    setFileMenuOpen(false);
    navigate(`/sheet-editor/${encodeURIComponent(nextFileId)}`);
  }, [ask, dirty, fileId, navigate]);

  const loadCloudSheets = useCallback(async () => {
    setFileMenuState('loading');
    setFileMenuError('');
    try {
      const result = await api.get<{ items: CloudSheetFile[] }>('/clouddrive');
      const sheets = (result.items || [])
        .filter(item => item.kind !== 'folder' && !item.deletedAt && item.fileName.toLowerCase().endsWith('.xlsx'))
        .sort((left, right) => String(right.renamedAt || right.uploadedAt || '').localeCompare(String(left.renamedAt || left.uploadedAt || '')));
      setCloudSheets(sheets);
      setFileMenuState('idle');
    } catch (error: any) {
      setFileMenuState('error');
      setFileMenuError(error?.message || '读取云盘表格失败');
    }
  }, []);

  const toggleFileMenu = useCallback(() => {
    setFileMenuOpen(current => {
      const next = !current;
      if (next) void loadCloudSheets();
      return next;
    });
  }, [loadCloudSheets]);

  const createBlankSheet = useCallback(async () => {
    if (dirty && !await ask({
      title: '放弃未保存的修改？',
      message: '当前表格仍有修改尚未保存，新建表格后这些修改可能丢失。',
      confirmText: '放弃并新建',
      tone: 'danger',
    })) return;
    setFileMenuState('creating');
    setFileMenuError('');
    try {
      const XLSX = await import('xlsx');
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([[]]), 'Sheet1');
      const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
      const now = new Date();
      const pad = (value: number) => String(value).padStart(2, '0');
      const fileName = `新建表格_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}.xlsx`;
      const form = new FormData();
      form.append('file', new File([buffer], fileName, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      if (matchingState?.folderId) form.append('parentId', matchingState.folderId);
      const token = localStorage.getItem('auth_token');
      const response = await fetch('/api/clouddrive/upload', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(buildServerErrorMessage(result, response.status, '新建表格失败'));
      setFileMenuOpen(false);
      navigate(`/sheet-editor/${encodeURIComponent(result.file.id)}`);
    } catch (error: any) {
      setFileMenuState('error');
      setFileMenuError(error?.message || '新建表格失败');
    }
  }, [ask, dirty, matchingState?.folderId, navigate]);

  const beginRename = useCallback(() => {
    const currentName = session?.file.name || matchingState?.fileName || '';
    if (!currentName) return;
    setRenameValue(currentName);
    setRenameError('');
    setRenaming(true);
    window.setTimeout(() => {
      const input = renameInputRef.current;
      if (!input) return;
      const extensionIndex = currentName.lastIndexOf('.');
      input.focus();
      input.setSelectionRange(0, extensionIndex > 0 ? extensionIndex : currentName.length);
    }, 0);
  }, [matchingState?.fileName, session?.file.name]);

  const cancelRename = useCallback(() => {
    if (renameSaving) return;
    setRenaming(false);
    setRenameValue('');
    setRenameError('');
  }, [renameSaving]);

  const saveRename = useCallback(async () => {
    const currentName = session?.file.name || matchingState?.fileName || '';
    const nextName = renameValue.trim();
    if (!nextName) {
      setRenameError('文件名不能为空');
      return;
    }
    if (nextName === currentName) {
      cancelRename();
      return;
    }
    setRenameSaving(true);
    setRenameError('');
    try {
      const result = await api.put<{ file: CloudSheetFile }>(`/clouddrive/${encodeURIComponent(fileId)}/name`, { fileName: nextName });
      const updatedName = result.file.fileName;
      setSession(current => current ? { ...current, file: { ...current.file, name: updatedName } } : current);
      setCloudSheets(current => current.map(file => file.id === fileId ? { ...file, fileName: updatedName, renamedAt: result.file.renamedAt } : file));
      setRenaming(false);
      setRenameValue('');
    } catch (error: any) {
      setRenameError(error?.message || '重命名失败');
    } finally {
      setRenameSaving(false);
    }
  }, [cancelRename, fileId, matchingState?.fileName, renameValue, session?.file.name]);

  useEffect(() => {
    if (!fileMenuOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!fileMenuRef.current?.contains(event.target as Node)) setFileMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFileMenuOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [fileMenuOpen]);

  useEffect(() => {
    if (!fileId) {
      setSession(null);
      setSessionError('');
      return;
    }
    let disposed = false;
    setSession(null);
    setSessionError('');
    api.post<SheetEditorSession>(`/sheet-editor/${encodeURIComponent(fileId)}/session`, { mode: 'edit' })
      .then(result => { if (!disposed) setSession(result); })
      .catch(error => { if (!disposed) setSessionError(error?.message || '无法建立文件读取会话'); });
    return () => { disposed = true; };
  }, [fileId, loadCloudSheets, sessionAttempt]);

  return (
    <div className="sheet-editor-page flex h-full min-h-0 flex-col bg-surface-50" data-testid="sheet-editor-page">
      <header className="sheet-editor-page__header flex h-14 shrink-0 items-center gap-3 border-b border-surface-200 bg-white px-3 sm:h-16 sm:px-3">
        <div ref={fileMenuRef} className="relative shrink-0">
          <button
            type="button"
            onClick={toggleFileMenu}
            className={`inline-flex h-10 w-10 items-center justify-center transition-colors ${fileMenuOpen ? 'bg-primary-50 text-primary-700' : 'text-surface-500 hover:bg-primary-50 hover:text-primary-700'}`}
            aria-label="表格菜单"
            title="表格菜单"
            aria-haspopup="menu"
            aria-expanded={fileMenuOpen}
          >
            <Menu size={19} />
          </button>
          {fileMenuOpen && (
            <div className="sheet-editor-page__file-menu absolute left-0 top-11 z-50 w-[min(340px,calc(100vw-16px))] border border-surface-200 bg-white py-1 shadow-xl" role="menu">
              <button type="button" onClick={() => void createBlankSheet()} disabled={fileMenuState === 'creating'} className="flex min-h-10 w-full items-center gap-2.5 px-3 text-left text-sm text-surface-800 hover:bg-surface-50 disabled:opacity-50" role="menuitem">
                <Plus size={16} className="text-primary-600" />
                <span>{fileMenuState === 'creating' ? '正在新建表格...' : '新建表格'}</span>
              </button>
              <div className="my-1 border-t border-surface-200" role="separator" />
              <div className="px-3 py-1.5 text-[11px] font-medium text-surface-400">可编辑表格</div>
              <div className="sheet-editor-page__file-menu-list max-h-72 overflow-y-auto">
                {fileMenuState === 'loading' && <p className="px-3 py-4 text-center text-xs text-surface-400">正在读取云盘...</p>}
                {fileMenuError && <p className="px-3 py-2 text-xs leading-5 text-red-600">{fileMenuError}</p>}
                {fileMenuState !== 'loading' && !fileMenuError && cloudSheets.length === 0 && <p className="px-3 py-4 text-center text-xs text-surface-400">云盘中暂无可编辑表格</p>}
                {cloudSheets.map(file => (
                  <button key={file.id} type="button" onClick={() => openSheetFile(file.id)} className={`flex min-h-11 w-full items-center gap-2.5 px-3 text-left hover:bg-surface-50 ${file.id === fileId ? 'bg-primary-50 text-primary-700' : 'text-surface-700'}`} role="menuitem">
                    <FileSpreadsheet size={16} className="shrink-0 text-emerald-600" />
                    <span className="min-w-0 flex-1 truncate text-sm">{file.fileName}</span>
                    {file.id === fileId && <span className="shrink-0 text-[11px] text-primary-600">当前</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <span className="sheet-editor-page__file-icon flex h-9 w-9 shrink-0 items-center justify-center bg-emerald-50 text-emerald-700">
          <FileSpreadsheet size={18} />
        </span>
        <div className="min-w-0 flex-1">
          {renaming ? (
            <div className="flex min-w-0 items-center gap-1.5">
              <input
                ref={renameInputRef}
                value={renameValue}
                disabled={renameSaving}
                onChange={event => setRenameValue(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') void saveRename();
                  if (event.key === 'Escape') cancelRename();
                }}
                maxLength={180}
                aria-label="文件名"
                className="h-8 min-w-0 max-w-xl flex-1 border border-primary-300 bg-white px-2 text-sm font-semibold text-surface-900 outline-none focus:border-primary-600 disabled:opacity-60"
              />
              <button type="button" onClick={() => void saveRename()} disabled={renameSaving || !renameValue.trim()} className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-primary-700 hover:bg-primary-50 disabled:opacity-40" title="确认重命名" aria-label="确认重命名"><Check size={16} /></button>
              <button type="button" onClick={cancelRename} disabled={renameSaving} className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-surface-500 hover:bg-surface-100 disabled:opacity-40" title="取消重命名" aria-label="取消重命名"><X size={16} /></button>
            </div>
          ) : (
            <div className="group flex min-w-0 items-center gap-1.5">
              <h1 className="truncate text-sm font-semibold text-surface-900">{sheetTitle(session?.file.name || matchingState?.fileName) || '在线表格编辑器'}</h1>
              <button type="button" onClick={beginRename} disabled={!session} className="inline-flex h-7 w-7 shrink-0 items-center justify-center text-surface-400 opacity-70 hover:bg-surface-100 hover:text-primary-700 group-hover:opacity-100 disabled:hidden" title="重命名文件" aria-label="重命名文件"><Pencil size={14} /></button>
            </div>
          )}
          <p className={`sheet-editor-page__file-meta truncate text-xs ${sessionError ? 'text-red-600' : session?.mode === 'readonly' ? 'text-amber-700' : 'text-surface-400'}`}>
            {renameError
              ? renameError
              : sessionError
              ? sessionError
              : session?.mode === 'readonly'
                ? `只读查看 · ${session.lock?.ownerName || '其他用户'} 正在编辑此文件`
                : session
                  ? `文件标识：${fileId || '未指定'} · ${(session.file.size / 1024).toFixed(1)} KB`
                  : '正在连接云盘文件...'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setHistoryRequest(value => value + 1)}
          disabled={!session}
          className="sheet-editor-page__history-trigger inline-flex h-9 shrink-0 items-center justify-center gap-1.5 border border-surface-200 bg-white px-2.5 text-xs text-surface-700 transition-colors hover:bg-surface-50 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="历史版本"
          title="历史版本"
        >
          <History size={15} />
          <span className="hidden sm:inline">历史版本</span>
        </button>
      </header>

      <section className="min-h-0 flex-1 overflow-hidden bg-white">
        <SheetEditorBoundary>
          {!fileId ? (
            <div className="flex h-full items-center justify-center overflow-y-auto bg-surface-50 p-5">
              <div className="w-full max-w-2xl border border-surface-200 bg-white p-6 shadow-sm sm:p-8">
                <div className="text-center">
                  <span className="mx-auto flex h-14 w-14 items-center justify-center bg-emerald-50 text-emerald-700"><FileSpreadsheet size={27} /></span>
                  <h2 className="mt-4 text-lg font-semibold text-surface-900">在线表格编辑器</h2>
                  <p className="mt-2 text-sm text-surface-500">新建一张表格，或从云盘选取表格继续编辑。</p>
                  <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                    <button type="button" onClick={() => void createBlankSheet()} disabled={fileMenuState === 'creating'} className="inline-flex h-10 min-w-32 items-center justify-center gap-2 bg-primary-600 px-5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"><Plus size={16} />{fileMenuState === 'creating' ? '正在新建…' : '新建表格'}</button>
                    <button type="button" onClick={() => { setFilePickerOpen(true); void loadCloudSheets(); }} className="inline-flex h-10 min-w-32 items-center justify-center gap-2 border border-surface-200 bg-white px-5 text-sm font-medium text-surface-700 hover:bg-surface-50"><FileSpreadsheet size={16} />选取表格</button>
                  </div>
                </div>
              </div>
            </div>
          ) : sessionError ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-surface-500">
              <span>请确认网络和文件状态后重试。</span>
              <button type="button" onClick={() => setSessionAttempt(value => value + 1)} className="h-9 bg-primary-600 px-4 text-xs font-medium text-white">重新连接</button>
            </div>
          ) : !session ? (
            <LoadingSpinner fullPage message="正在建立安全读取会话..." />
          ) : (
            <Suspense fallback={<LoadingSpinner fullPage message="正在加载表格编辑器..." />}>
              <SheetEditorWorkbook
                fileId={fileId}
                sourceUrl={session.sourceUrl}
                sessionId={session.sessionId}
                sessionToken={session.sessionToken}
                initialChecksum={session.file.checksum}
                initialRevision={session.file.revision}
                mode={session.mode}
                lockOwnerName={session.lock?.ownerName || ''}
                onDirtyChange={handleDirtyChange}
                historyRequest={historyRequest}
              />
            </Suspense>
          )}
        </SheetEditorBoundary>
      </section>
      <AppModal open={filePickerOpen} onClose={() => setFilePickerOpen(false)} title="选取云盘表格" icon={<FileSpreadsheet size={18} />} size="sm">
        <div className="max-h-[60vh] overflow-y-auto border-y border-surface-100">
          {fileMenuState === 'loading' && <p className="py-8 text-center text-sm text-surface-400">正在读取云盘...</p>}
          {fileMenuError && <div className="py-6 text-center"><p className="text-sm text-red-600">{fileMenuError}</p><button type="button" onClick={() => void loadCloudSheets()} className="mt-3 text-sm text-primary-700 hover:underline">重新加载</button></div>}
          {fileMenuState !== 'loading' && !fileMenuError && cloudSheets.length === 0 && <p className="py-8 text-center text-sm text-surface-400">云盘中暂无可编辑表格</p>}
          {cloudSheets.map(file => <button key={file.id} type="button" onClick={() => { setFilePickerOpen(false); openSheetFile(file.id); }} className="flex min-h-12 w-full items-center gap-3 border-b border-surface-100 px-2 text-left text-surface-700 last:border-b-0 hover:bg-surface-50"><FileSpreadsheet size={17} className="shrink-0 text-emerald-600" /><span className="min-w-0 flex-1 truncate text-sm">{file.fileName}</span><span className="shrink-0 text-xs text-surface-400">{(file.fileSize / 1024).toFixed(1)} KB</span></button>)}
        </div>
      </AppModal>
      {ConfirmDialog}
    </div>
  );
}
