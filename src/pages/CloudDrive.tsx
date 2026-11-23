import { useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent } from 'react';
import {
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronLeft,
  Download,
  File,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderInput,
  FolderPlus,
  HardDrive,
  Grid3X3,
  List,
  MoreHorizontal,
  Pencil,
  Presentation,
  RefreshCw,
  RotateCcw,
  Search,
  Share2,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { buildServerErrorMessage } from '../utils/errorCodes';
import Header from '../components/Layout/Header';
import FeatureInfo from '../components/Guidance/FeatureInfo';
import AppModal from '../components/Layout/AppModal';
import ContextMenu from '../components/Layout/ContextMenu';
import { useConfirm } from '../components/Toast';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';
import { useMobileViewport } from '../hooks/useMobileViewport';
import FileDropZone from '../components/FileDropZone';
import { _toast } from '../store/toastRef';
import { useAuthStore } from '../store/authStore';
import { readCloudDriveEditorState, saveCloudDriveEditorState } from '../utils/cloudDriveEditorState';
import { useSearchParams } from 'react-router-dom';

type SortKey = 'name' | 'type' | 'size' | 'uploader' | 'updatedAt';
type SortDirection = 'asc' | 'desc';
type SortCriterion = SortKey | 'operatedAt';
type ViewMode = 'list' | 'grid';
type PreviewKind = 'image' | 'pdf' | 'text' | 'office' | 'unsupported';

const CLOUD_DRIVE_PREVIEW_VISIBLE = false;

interface CloudDriveItem {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType?: string;
  uploadedBy?: string;
  uploadedAt?: string;
  renamedAt?: string;
  deletedAt?: string;
  remark?: string;
  projectId?: string;
  projectName?: string;
  kind?: 'file' | 'folder';
  parentId?: string;
}

interface DisplayFile {
  id: string;
  name: string;
  type: string;
  size: string;
  sizeBytes: number;
  uploader: string;
  updatedAt: string;
  updatedAtRaw?: string;
  deletedAt?: string;
  mimeType?: string;
  remark?: string;
  projectId?: string;
  projectName?: string;
  kind: 'file' | 'folder';
  parentId: string;
}

const TABLE_COLUMNS = 'minmax(300px,1.8fr) minmax(100px,.5fr) minmax(110px,.55fr) minmax(120px,.7fr) minmax(160px,.85fr) 96px';
const QUARK_LIST_COLUMNS = 'minmax(320px,1.8fr) minmax(150px,.7fr) minmax(90px,.45fr) minmax(110px,.55fr) minmax(170px,.8fr)';

const SORT_COLUMNS: Array<{ key: SortKey; label: string }> = [
  { key: 'name', label: '文件名' },
  { key: 'size', label: '大小' },
  { key: 'type', label: '文件类型' },
  { key: 'uploader', label: '上传人' },
  { key: 'updatedAt', label: '更新时间' },
];

function getToken(): string | null {
  return localStorage.getItem('auth_token');
}

async function cloudRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(options.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`/api/clouddrive${path}`, { ...options, headers });
  if (res.status === 401) {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    window.location.href = '/login';
    throw new Error('登录已过期');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(buildServerErrorMessage(body, res.status));
  }
  return res.json();
}

function formatSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function formatDateTime(value?: string) {
  if (!value) return '未记录';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function getExtension(name: string) {
  return name.split('.').pop()?.toLowerCase() || '';
}

function inferType(item: CloudDriveItem) {
  if (item.kind === 'folder') return '文件夹';
  const mime = item.mimeType || '';
  const ext = getExtension(item.fileName);
  if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return '图片';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '压缩包';
  if (ext === 'pdf') return 'PDF';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return '表格';
  if (['doc', 'docx', 'txt', 'md'].includes(ext)) return '文档';
  if (['ppt', 'pptx'].includes(ext)) return '演示';
  return '文件';
}

function getPreviewKind(file?: DisplayFile | null): PreviewKind {
  if (!file) return 'unsupported';
  const mime = file.mimeType || '';
  const ext = getExtension(file.name);
  if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'image';
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (mime.startsWith('text/') || ['txt', 'md', 'csv', 'json', 'log'].includes(ext)) return 'text';
  if (['doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx'].includes(ext)) return 'office';
  return 'unsupported';
}

function toDisplayFile(item: CloudDriveItem): DisplayFile {
  const displayTime = item.deletedAt || item.renamedAt || item.uploadedAt;
  return {
    id: item.id,
    name: item.fileName,
    type: inferType(item),
    size: formatSize(item.fileSize),
    sizeBytes: item.fileSize || 0,
    uploader: item.uploadedBy || '未知',
    updatedAt: formatDateTime(displayTime),
    updatedAtRaw: displayTime,
    deletedAt: item.deletedAt,
    mimeType: item.mimeType,
    remark: item.remark,
    projectId: item.projectId,
    projectName: item.projectName,
    kind: item.kind === 'folder' ? 'folder' : 'file',
    parentId: item.parentId || '',
  };
}

function FileIcon({ type, size = 16 }: { type: string; size?: number }) {
  const iconProps = { size, strokeWidth: 1.5 };
  if (type === '文件夹') return <Folder {...iconProps} className="fill-sky-50 text-sky-500" />;
  if (type === '图片') return <FileImage {...iconProps} className="text-violet-500" />;
  if (type === '压缩包') return <FileArchive {...iconProps} className="text-amber-500" />;
  if (type === '表格') return <FileSpreadsheet {...iconProps} className="text-emerald-600" />;
  if (type === '演示') return <Presentation {...iconProps} className="text-orange-500" />;
  if (type === '文档') return <FileText {...iconProps} className="text-blue-500" />;
  return <File {...iconProps} className="text-surface-400" />;
}

function SortIcon({ active, direction }: { active: boolean; direction: SortDirection }) {
  if (!active) return <ArrowUpDown size={13} className="text-slate-300" />;
  return direction === 'asc'
    ? <ArrowUp size={13} className="text-slate-700" />
    : <ArrowDown size={13} className="text-slate-700" />;
}

function PreviewPane({
  file,
  showTrash,
  previewUrl,
  previewText,
  loading,
  error,
}: {
  file: DisplayFile | null;
  showTrash: boolean;
  previewUrl: string | null;
  previewText: string;
  loading: boolean;
  error: string;
}) {
  const kind = getPreviewKind(file);

  return (
    <aside className="flex min-h-0 flex-col overflow-hidden border border-slate-200 bg-white">
      <div key={`${file?.id || 'empty'}-${showTrash ? 'trash' : kind}-${loading ? 'loading' : 'ready'}`} className="app-cloud-preview min-h-0 flex-1 overflow-hidden">
        {!file ? (
          <div className="flex h-full min-h-[360px] flex-col items-center justify-center border-l-4 border-l-slate-100 px-8 text-center">
            <span className="mb-4 flex h-14 w-14 items-center justify-center border border-slate-200 bg-slate-50 text-slate-400">
              <FileText size={24} />
            </span>
            <div className="text-sm font-semibold text-slate-800">选择文件查看预览</div>
            <div className="mt-2 max-w-[240px] text-xs leading-5 text-slate-500">支持图片、PDF、Office 与文本文件，文件详情会在这里保持展示。</div>
          </div>
        ) : showTrash ? (
          <div className="flex h-full min-h-[360px] flex-col items-center justify-center px-6 text-center text-sm text-slate-500">
            <Trash2 size={32} className="mb-3 text-slate-300" />
            回收站文件暂不预览，请先恢复文件。
          </div>
        ) : loading ? (
          <div className="flex h-full min-h-[360px] flex-col items-center justify-center text-sm text-slate-500">
            <div className="mb-4 h-32 w-24 animate-pulse border border-slate-200 bg-slate-50" />
            {kind === 'office' ? '正在转换 Office 文件...' : '正在生成预览...'}
          </div>
        ) : error ? (
          <div className="flex h-full min-h-[360px] flex-col items-center justify-center px-6 text-center text-sm text-red-500">
            <FileText size={32} className="mb-3 text-red-300" />
            {error}
          </div>
        ) : kind === 'image' && previewUrl ? (
          <div className="flex h-full min-h-[360px] items-center justify-center overflow-auto bg-slate-50 p-4">
            <img src={previewUrl} alt={file.name} className="max-h-full max-w-full border border-slate-200 bg-white object-contain" />
          </div>
        ) : (kind === 'pdf' || kind === 'office') && previewUrl ? (
          <iframe title={file.name} src={previewUrl} className="h-full min-h-[520px] w-full bg-white" />
        ) : kind === 'text' ? (
          <pre className="h-full min-h-[520px] overflow-auto bg-slate-950 p-4 text-xs leading-5 text-slate-100">
            {previewText || '文本内容为空'}
          </pre>
        ) : (
          <div className="flex h-full min-h-[360px] items-center justify-center px-6 text-center text-sm text-slate-500">
            此文件类型暂不支持网页预览。
          </div>
        )}
      </div>
    </aside>
  );
}

export default function CloudDrive() {
  const isMobileViewport = useMobileViewport();
  const [searchParams, setSearchParams] = useSearchParams();
  const routeFileId = searchParams.get('fileId');
  const routeProjectId = searchParams.get('projectId');
  const userId = useAuthStore(state => state.user?.id);
  const rememberedStateRef = useRef(readCloudDriveEditorState(userId, routeProjectId || ''));
  const rememberedState = rememberedStateRef.current;
  const [files, setFiles] = useState<DisplayFile[]>([]);
  const [usage, setUsage] = useState<{ used: number; quota: number; usedPercent: number } | null>(null);
  const [search, setSearch] = useState(rememberedState?.search || '');
  const [sortKey, setSortKey] = useState<SortKey>(rememberedState?.sortKey || 'updatedAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>(rememberedState?.sortDirection || 'desc');
  const [sortCriterion, setSortCriterion] = useState<SortCriterion>(rememberedState?.sortCriterion || 'updatedAt');
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>(rememberedState?.viewMode || 'list');
  const effectiveViewMode: ViewMode = viewMode;
  const [currentFolderId, setCurrentFolderId] = useState(rememberedState?.folderId || '');
  const [folderModalOpen, setFolderModalOpen] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(routeFileId || rememberedState?.fileId || null);
  const [mobilePreviewOpen, setMobilePreviewOpen] = useState(Boolean(routeFileId));
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewText, setPreviewText] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [renamingFileId, setRenamingFileId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [draggingFileId, setDraggingFileId] = useState<string | null>(null);
  const [dropFolderId, setDropFolderId] = useState<string | null>(null);
  const [movingFileId, setMovingFileId] = useState<string | null>(null);
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [moveModalOpen, setMoveModalOpen] = useState(false);
  const [moveTargetFolderId, setMoveTargetFolderId] = useState('');
  const [batchMoving, setBatchMoving] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ fileId: string; x: number; y: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  const restoredScrollRef = useRef(false);
  const sortMenuRef = useRef<HTMLDivElement | null>(null);
  const { confirm: ask, ConfirmDialog } = useConfirm();

  useEffect(() => {
    if (!selectedFileId) return;
    saveCloudDriveEditorState(userId, {
      fileId: selectedFileId,
      fileName: files.find(file => file.id === selectedFileId)?.name || '',
      folderId: currentFolderId,
      projectId: routeProjectId || '',
      search,
      sortKey,
      sortDirection,
      sortCriterion,
      viewMode,
      scrollTop: listScrollRef.current?.scrollTop || 0,
      windowScrollY: window.scrollY,
      savedAt: Date.now(),
    });
  }, [currentFolderId, files, routeProjectId, search, selectedFileId, sortCriterion, sortDirection, sortKey, userId, viewMode]);

  useEffect(() => () => {
    if (!selectedFileId) return;
    saveCloudDriveEditorState(userId, {
      fileId: selectedFileId,
      fileName: files.find(file => file.id === selectedFileId)?.name || '',
      folderId: currentFolderId,
      projectId: routeProjectId || '',
      search, sortKey, sortDirection, sortCriterion, viewMode,
      scrollTop: listScrollRef.current?.scrollTop || 0,
      windowScrollY: window.scrollY,
      savedAt: Date.now(),
    });
  }, [currentFolderId, files, routeProjectId, search, selectedFileId, sortCriterion, sortDirection, sortKey, userId, viewMode]);

  const fetchFiles = async (trash = showTrash) => {
    setLoading(true);
    try {
      const [listRes, usageRes] = await Promise.all([
        cloudRequest<{ items: CloudDriveItem[] }>(trash ? '/trash' : (routeProjectId ? `?projectId=${encodeURIComponent(routeProjectId)}` : '')),
        cloudRequest<{ used: number; quota: number; usedPercent: number }>('/usage'),
      ]);
      const nextFiles = (listRes.items || []).map(toDisplayFile);
      setFiles(nextFiles);
      setSelectedFileId(current => {
        if (routeFileId && nextFiles.some(file => file.id === routeFileId)) return routeFileId;
        return current && nextFiles.some(file => file.id === current) ? current : nextFiles[0]?.id || null;
      });
      setUsage(usageRes);
    } catch (err: any) {
      _toast.error?.(err.message || '获取云盘文件失败');
    } finally {
      setLoading(false);
    }
  };
  useRealtimeRefresh(['cloud-file'], () => fetchFiles(showTrash));

  useEffect(() => {
    fetchFiles(showTrash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showTrash]);

  useEffect(() => {
    if (loading || restoredScrollRef.current || !rememberedState) return;
    restoredScrollRef.current = true;
    const frame = window.requestAnimationFrame(() => {
      if (listScrollRef.current) listScrollRef.current.scrollTop = rememberedState.scrollTop;
      if (rememberedState.windowScrollY > 0) window.scrollTo({ top: rememberedState.windowScrollY });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loading, rememberedState]);

  useEffect(() => {
    if (showTrash) setCurrentFolderId('');
  }, [showTrash]);

  useEffect(() => {
    if (!contextMenu) return;
    const closeMenu = (event: Event) => {
      const target = event.target;
      if (target instanceof Element && target.closest('[data-cloud-drive-context-menu]')) return;
      setContextMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('pointerdown', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('pointerdown', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!sortMenuOpen) return;
    const closeSortMenu = (event: PointerEvent) => {
      if (sortMenuRef.current?.contains(event.target as Node)) return;
      setSortMenuOpen(false);
    };
    window.addEventListener('pointerdown', closeSortMenu);
    return () => window.removeEventListener('pointerdown', closeSortMenu);
  }, [sortMenuOpen]);

  const handleSort = (key: SortKey) => {
    setSortCriterion(key);
    if (sortKey === key) {
      setSortDirection(direction => direction === 'asc' ? 'desc' : 'asc');
      return;
    }
    setSortKey(key);
    setSortDirection('asc');
  };

  const filteredFiles = useMemo(() => {
    const query = search.trim().toLowerCase();
    const directoryFiles = files.filter(file => file.parentId === currentFolderId);
    const filtered = query
      ? directoryFiles.filter(file =>
          [file.name, file.type, file.uploader].some(value => value.toLowerCase().includes(query))
        )
      : directoryFiles;

    return [...filtered].sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
      let result = 0;
      if (sortKey === 'size') {
        result = a.sizeBytes - b.sizeBytes;
      } else if (sortKey === 'updatedAt') {
        result = new Date(a.updatedAtRaw || a.updatedAt).getTime() - new Date(b.updatedAtRaw || b.updatedAt).getTime();
      } else {
        result = String(a[sortKey]).localeCompare(String(b[sortKey]), 'zh-CN', { numeric: true, sensitivity: 'base' });
      }
      return sortDirection === 'asc' ? result : -result;
    });
  }, [currentFolderId, files, search, sortDirection, sortKey]);

  const folderTrail = useMemo(() => {
    const trail: DisplayFile[] = [];
    let cursor = currentFolderId;
    const visited = new Set<string>();
    while (cursor && !visited.has(cursor)) {
      visited.add(cursor);
      const folder = files.find(item => item.id === cursor && item.kind === 'folder');
      if (!folder) break;
      trail.unshift(folder);
      cursor = folder.parentId;
    }
    return trail;
  }, [currentFolderId, files]);

  const selectedFile = useMemo(
    () => filteredFiles.find(file => file.id === selectedFileId) || filteredFiles[0] || null,
    [filteredFiles, selectedFileId]
  );

  useEffect(() => {
    setSelectedFileId(current => current && filteredFiles.some(file => file.id === current) ? current : filteredFiles[0]?.id || null);
  }, [filteredFiles]);

  useEffect(() => {
    if (!routeFileId) return;
    if (files.some(file => file.id === routeFileId)) {
      setSelectedFileId(routeFileId);
      setShowTrash(false);
    }
  }, [files, routeFileId]);

  useEffect(() => {
    let disposed = false;
    let objectUrl: string | null = null;

    if (!CLOUD_DRIVE_PREVIEW_VISIBLE) {
      setPreviewUrl(null);
      setPreviewText('');
      setPreviewError('');
      setPreviewLoading(false);
      return () => {};
    }

    const file = selectedFile;
    const kind = getPreviewKind(file);

    setPreviewUrl(null);
    setPreviewText('');
    setPreviewError('');

    if (!file || showTrash || kind === 'unsupported') {
      setPreviewLoading(false);
      return () => {};
    }

    const loadPreview = async () => {
      setPreviewLoading(true);
      try {
        const token = getToken();
        if (kind === 'office') {
          const endpoint = `/api/clouddrive/preview/${encodeURIComponent(file.id)}`;
          const tokenParam = token ? `${endpoint.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}` : '';
          setPreviewUrl(`${endpoint}${tokenParam}`);
          setPreviewLoading(false);
          return;
        }

        const headers = new Headers();
        if (token) headers.set('Authorization', `Bearer ${token}`);
        const endpoint = `/api/clouddrive/download/${encodeURIComponent(file.id)}`;
        const res = await fetch(endpoint, { headers });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(buildServerErrorMessage(body, res.status, '预览读取失败'));
        }
        const responseBlob = await res.blob();
        const blob = kind === 'pdf' && responseBlob.type !== 'application/pdf'
          ? new Blob([responseBlob], { type: 'application/pdf' })
          : responseBlob;
        if (disposed) return;
        if (kind === 'text') {
          const text = await blob.text();
          if (!disposed) setPreviewText(text.slice(0, 200000));
        } else {
          objectUrl = URL.createObjectURL(blob);
          setPreviewUrl(objectUrl);
        }
      } catch (err: any) {
        if (!disposed) setPreviewError(err.message || '预览失败');
      } finally {
        if (!disposed) setPreviewLoading(false);
      }
    };

    loadPreview();

    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [selectedFile?.id, showTrash]);

  const handleUpload = async (fileList: FileList | File[] | null) => {
    const file = fileList?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      if (routeProjectId) form.append('projectId', routeProjectId);
      if (currentFolderId) form.append('parentId', currentFolderId);
      const token = getToken();
      const headers = new Headers();
      if (token) headers.set('Authorization', `Bearer ${token}`);

      const res = await fetch('/api/clouddrive/upload', {
        method: 'POST',
        headers,
        body: form,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(buildServerErrorMessage(body, res.status, '上传失败'));
      }
      _toast.success?.('文件已上传');
      await fetchFiles(false);
      setShowTrash(false);
    } catch (err: any) {
      _toast.error?.(err.message || '上传失败');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleCreateFolder = async () => {
    const name = folderName.trim();
    if (!name) return;
    setCreatingFolder(true);
    try {
      const result = await cloudRequest<{ folder: CloudDriveItem }>('/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, parentId: currentFolderId }),
      });
      setFiles(current => [...current, toDisplayFile(result.folder)]);
      setFolderModalOpen(false);
      setFolderName('');
      _toast.success?.('文件夹已创建');
    } catch (err: any) {
      _toast.error?.(err.message || '新建文件夹失败');
    } finally {
      setCreatingFolder(false);
    }
  };

  const handleDownload = async (file: DisplayFile) => {
    try {
      const token = getToken();
      const headers = new Headers();
      if (token) headers.set('Authorization', `Bearer ${token}`);
      const res = await fetch(`/api/clouddrive/download/${encodeURIComponent(file.id)}`, { headers });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(buildServerErrorMessage(body, res.status, '下载失败'));
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      _toast.error?.(err.message || '下载失败');
    }
  };

  const canEditOnline = (file: DisplayFile) => (
    !showTrash && file.kind === 'file' && file.name.toLowerCase().endsWith('.xlsx')
  );

  const openSheetEditor = (file: DisplayFile) => {
    if (!canEditOnline(file)) return;
    saveCloudDriveEditorState(userId, {
      fileId: file.id,
      fileName: file.name,
      folderId: currentFolderId,
      projectId: routeProjectId || '',
      search,
      sortKey,
      sortDirection,
      sortCriterion,
      viewMode,
      scrollTop: listScrollRef.current?.scrollTop || 0,
      windowScrollY: window.scrollY,
      savedAt: Date.now(),
    });
    setSelectedFileId(file.id);
    setContextMenu(null);
    window.open(`/sheet-editor/${encodeURIComponent(file.id)}`, '_blank', 'noopener,noreferrer');
  };

  const handleShare = async (file: DisplayFile) => {
    try {
      const result = await cloudRequest<{ url: string }>(`/${encodeURIComponent(file.id)}/share`, { method: 'POST' });
      await navigator.clipboard.writeText(new URL(result.url, window.location.origin).toString());
      _toast.success?.('分享链接已复制，打开链接即可下载');
    } catch (err: any) {
      _toast.error?.(err.message || '复制分享链接失败');
    }
  };

  const handleTrash = async (file: DisplayFile) => {
    const ok = await ask(`确定将「${file.name}」移入回收站吗？文件会保留 7 天，之后自动彻底删除。`);
    if (!ok) return;
    try {
      await cloudRequest(`/${encodeURIComponent(file.id)}`, { method: 'DELETE' });
      _toast.success?.('文件已移入回收站，7 天后自动彻底删除');
      await fetchFiles(false);
    } catch (err: any) {
      _toast.error?.(err.message || '删除失败');
    }
  };

  const handleRestore = async (file: DisplayFile) => {
    try {
      await cloudRequest(`/${encodeURIComponent(file.id)}/restore`, { method: 'POST' });
      _toast.success?.('文件已恢复');
      await fetchFiles(true);
    } catch (err: any) {
      _toast.error?.(err.message || '恢复失败');
    }
  };

  const handlePermanentDelete = async (file: DisplayFile) => {
    const ok = await ask(`确定永久删除「${file.name}」吗？此操作不可恢复。`);
    if (!ok) return;
    try {
      await cloudRequest(`/${encodeURIComponent(file.id)}/permanent`, { method: 'DELETE' });
      _toast.success?.('文件已永久删除');
      await fetchFiles(true);
    } catch (err: any) {
      _toast.error?.(err.message || '永久删除失败');
    }
  };

  const beginRename = (file: DisplayFile) => {
    if (showTrash || renaming) return;
    setContextMenu(null);
    setSelectedFileId(file.id);
    setRenamingFileId(file.id);
    setRenameValue(file.name);
  };

  const openFileContextMenu = (event: ReactMouseEvent, file: DisplayFile) => {
    event.preventDefault();
    event.stopPropagation();
    if (showTrash || renaming) return;
    setSelectedFileId(file.id);
    setSelectedFileIds(current => current.includes(file.id) ? current : [file.id]);
    setContextMenu({
      fileId: file.id,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 184)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 56)),
    });
  };

  const handleItemClick = (event: ReactMouseEvent, file: DisplayFile) => {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      setSelectedFileIds(current => current.includes(file.id) ? current.filter(id => id !== file.id) : [...current, file.id]);
      setSelectedFileId(file.id);
      return;
    }
    setSelectedFileIds([file.id]);
    if (file.kind === 'folder') {
      setCurrentFolderId(file.id);
      setSearch('');
      setSelectedFileIds([]);
    } else {
      setSelectedFileId(file.id);
    }
  };

  const cancelRename = () => {
    if (renaming) return;
    setRenamingFileId(null);
    setRenameValue('');
  };

  const handleRename = async (file: DisplayFile) => {
    const nextName = renameValue.trim();
    if (!nextName) {
      _toast.error?.('文件名不能为空');
      return;
    }
    if (nextName === file.name) {
      cancelRename();
      return;
    }

    setRenaming(true);
    try {
      const result = await cloudRequest<{ file: CloudDriveItem }>(`/${encodeURIComponent(file.id)}/name`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: nextName }),
      });
      const renamedFile = toDisplayFile(result.file);
      setFiles(current => current.map(item => item.id === file.id ? renamedFile : item));
      setRenamingFileId(null);
      setRenameValue('');
      _toast.success?.('文件已重命名');
    } catch (err: any) {
      _toast.error?.(err.message || '重命名失败');
    } finally {
      setRenaming(false);
    }
  };

  const handleDragStart = (event: ReactDragEvent<HTMLElement>, file: DisplayFile) => {
    if (showTrash || renamingFileId === file.id || movingFileId) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', file.id);
    setDraggingFileId(file.id);
    setDropFolderId(null);
  };

  const handleDragEnd = () => {
    setDraggingFileId(null);
    setDropFolderId(null);
  };

  const handleFolderDragOver = (event: ReactDragEvent<HTMLElement>, folder: DisplayFile) => {
    if (!draggingFileId || draggingFileId === folder.id || showTrash) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    if (dropFolderId !== folder.id) setDropFolderId(folder.id);
  };

  const handleMoveToFolder = async (event: ReactDragEvent<HTMLElement>, folder: DisplayFile) => {
    event.preventDefault();
    event.stopPropagation();
    const sourceId = draggingFileId || event.dataTransfer.getData('text/plain');
    setDraggingFileId(null);
    setDropFolderId(null);
    if (!sourceId || sourceId === folder.id || movingFileId) return;
    const source = files.find(file => file.id === sourceId);
    if (!source || source.parentId === folder.id) return;

    setMovingFileId(sourceId);
    try {
      const result = await cloudRequest<{ file: CloudDriveItem }>(`/${encodeURIComponent(sourceId)}/move`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentId: folder.id }),
      });
      const movedFile = toDisplayFile(result.file);
      setFiles(current => current.map(file => file.id === sourceId ? movedFile : file));
      if (selectedFileId === sourceId) setSelectedFileId(null);
      _toast.success?.(`已将“${source.name}”移动到“${folder.name}”`);
    } catch (error: any) {
      _toast.error?.(error?.message || '移动失败');
    } finally {
      setMovingFileId(null);
    }
  };

  const selectedMoveFiles = files.filter(file => selectedFileIds.includes(file.id) && !file.deletedAt);
  const isFolderInsideSelected = (folderId: string) => {
    let cursor = folderId;
    const visited = new Set<string>();
    while (cursor && !visited.has(cursor)) {
      if (selectedFileIds.includes(cursor)) return true;
      visited.add(cursor);
      cursor = files.find(file => file.id === cursor)?.parentId || '';
    }
    return false;
  };
  const moveFolderOptions = files
    .filter(file => file.kind === 'folder' && !file.deletedAt && !isFolderInsideSelected(file.id))
    .map(folder => {
      const names = [folder.name];
      let cursor = folder.parentId;
      const visited = new Set<string>();
      while (cursor && !visited.has(cursor)) {
        visited.add(cursor);
        const parent = files.find(file => file.id === cursor && file.kind === 'folder');
        if (!parent) break;
        names.unshift(parent.name);
        cursor = parent.parentId;
      }
      return { folder, path: names.join(' / ') };
    })
    .sort((left, right) => left.path.localeCompare(right.path, 'zh-CN'));

  const openMoveModal = () => {
    if (!selectedMoveFiles.length) return;
    setMoveTargetFolderId('');
    setMoveModalOpen(true);
  };

  const handleBatchMove = async () => {
    if (!moveTargetFolderId || !selectedMoveFiles.length || batchMoving) return;
    const target = files.find(file => file.id === moveTargetFolderId && file.kind === 'folder');
    if (!target) return;
    setBatchMoving(true);
    try {
      const moved = await Promise.all(selectedMoveFiles.map(file => cloudRequest<{ file: CloudDriveItem }>(`/${encodeURIComponent(file.id)}/move`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentId: target.id }),
      })));
      const movedMap = new Map(moved.map(result => [result.file.id, toDisplayFile(result.file)]));
      setFiles(current => current.map(file => movedMap.get(file.id) || file));
      setSelectedFileIds([]);
      setSelectedFileId(null);
      setMoveModalOpen(false);
      _toast.success?.(`已将 ${moved.length} 项移动到“${target.name}”`);
    } catch (error: any) {
      _toast.error?.(error?.message || '移动失败');
      await fetchFiles(showTrash);
    } finally {
      setBatchMoving(false);
    }
  };

  const contextFile = contextMenu ? files.find(file => file.id === contextMenu.fileId) || null : null;

  const mobileFolders = filteredFiles.filter(file => file.kind === 'folder').slice(0, 2);
  const mobileRecentFiles = filteredFiles.filter(file => file.kind !== 'folder').slice(0, 8);
  const mobileUsed = usage?.used ?? files.reduce((total, file) => total + (file.kind === 'file' && !file.deletedAt ? file.sizeBytes : 0), 0);
  const mobileQuota = usage?.quota || 20 * 1024 * 1024 * 1024;
  const mobileUsedPercent = Math.min(100, Math.max(0, usage?.usedPercent ?? Math.round((mobileUsed / mobileQuota) * 100)));
  const openMobileFile = (file: DisplayFile) => {
    if (file.kind === 'folder') {
      setCurrentFolderId(file.id);
      setSearch('');
      setMobilePreviewOpen(false);
      return;
    }
    setSelectedFileId(file.id);
    setMobilePreviewOpen(true);
    setSearchParams(params => {
      const next = new URLSearchParams(params);
      next.set('fileId', file.id);
      return next;
    });
  };
  const closeMobilePreview = () => {
    setMobilePreviewOpen(false);
    setSearchParams(params => {
      const next = new URLSearchParams(params);
      next.delete('fileId');
      return next;
    });
  };

  if (isMobileViewport) {
    const mobileContextMenu = contextMenu && contextFile ? (
      <ContextMenu x={contextMenu.x} y={contextMenu.y} width={176} ariaLabel={`${contextFile.name} 文件菜单`} onClose={() => setContextMenu(null)} items={[
        ...(canEditOnline(contextFile) ? [{ key: 'online-edit', label: '在线编辑', icon: <FileSpreadsheet size={14} />, onSelect: () => openSheetEditor(contextFile) }] : []),
        ...(contextFile.kind !== 'folder' ? [{ key: 'share', label: '复制分享链接', icon: <Share2 size={14} />, onSelect: () => void handleShare(contextFile) }] : []),
        { key: 'move', label: selectedMoveFiles.length > 1 ? `移动 ${selectedMoveFiles.length} 项` : '移动到文件夹', icon: <FolderInput size={14} />, onSelect: openMoveModal },
        { key: 'rename', label: '重命名', icon: <Pencil size={14} />, onSelect: () => beginRename(contextFile) },
        { key: 'delete', label: '删除', icon: <Trash2 size={14} />, danger: true, separatorBefore: true, onSelect: () => void handleTrash(contextFile) },
      ]} />
    ) : null;

    if (mobilePreviewOpen && selectedFile && selectedFile.kind !== 'folder') {
      const previewHeading = selectedFile.name.replace(/\.[^.]+$/, '');
      return (
        <div className="mobile-cloud-preview square-ui">
          <header className="mobile-cloud-appbar">
            <button type="button" onClick={closeMobilePreview} aria-label="返回云盘"><ChevronLeft size={25} /></button>
            <h1>文件预览</h1>
            <button type="button" onClick={event => openFileContextMenu(event, selectedFile)} aria-label="更多文件操作"><MoreHorizontal size={22} /></button>
          </header>
          <section className="mobile-cloud-preview-area">
            <div className="mobile-cloud-document-page">
              <h2>{previewHeading}</h2>
              {Array.from({ length: 12 }, (_, index) => <span key={index} className={index % 3 === 2 ? 'is-short' : ''} />)}
            </div>
          </section>
          <section className="mobile-cloud-preview-info">
            <h2>{selectedFile.name}</h2>
            <p>{selectedFile.size} · {selectedFile.uploader} · {selectedFile.updatedAt} 更新</p>
            <div className="mobile-cloud-preview-actions">
              <button type="button" onClick={() => void handleShare(selectedFile)}><Share2 size={20} /><span>分享</span></button>
              <button type="button" onClick={() => void handleDownload(selectedFile)}><Download size={20} /><span>下载</span></button>
              <button type="button" onClick={event => openFileContextMenu(event, selectedFile)}><FolderInput size={20} /><span>关联项目</span></button>
            </div>
          </section>
          {ConfirmDialog}
          {mobileContextMenu}
        </div>
      );
    }

    return (
      <FileDropZone className="h-full w-full" disabled={uploading || showTrash} onFiles={handleUpload} message="松开以上传到云盘">
        <div className="mobile-cloud-list square-ui">
          <input ref={fileInputRef} type="file" className="hidden" onChange={event => handleUpload(event.target.files)} />
          <header className="mobile-cloud-appbar">
            <span />
            <h1>云盘</h1>
            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading} aria-label="上传文件"><Upload size={22} /></button>
          </header>
          <div className="mobile-cloud-toolbar">
            <label>
              <Search size={18} />
              <input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索文件或文件夹" />
            </label>
            <button type="button" onClick={() => setSortMenuOpen(value => !value)} aria-label="更多筛选"><MoreHorizontal size={20} /></button>
          </div>
          <main className="mobile-cloud-content">
            <section className="mobile-cloud-summary">
              <div><strong>部门云盘</strong><span>已使用 {formatSize(mobileUsed)} / {formatSize(mobileQuota)}</span></div>
              <span className="mobile-cloud-storage-ring" style={{ '--cloud-usage': `${mobileUsedPercent * 3.6}deg` } as React.CSSProperties}>{mobileUsedPercent}%</span>
            </section>

            <header className="mobile-cloud-section-head is-folder-head">
              <div><h2>{currentFolderId ? folderTrail[folderTrail.length - 1]?.name || '当前文件夹' : '常用文件夹'}</h2></div>
              <button type="button" onClick={() => { setCurrentFolderId(''); setSearch(''); }}>全部</button>
            </header>
            {mobileFolders.length > 0 && (
              <div className="mobile-cloud-folder-grid">
                {mobileFolders.map(folder => (
                  <button key={folder.id} type="button" className="mobile-cloud-folder-card" onClick={() => openMobileFile(folder)} data-mobile-cloud-id={folder.id}>
                    <Folder size={23} />
                    <strong>{folder.name}</strong>
                    <span>{files.filter(file => file.parentId === folder.id).length} 项</span>
                  </button>
                ))}
              </div>
            )}

            <section className="mobile-cloud-surface">
              <header className="mobile-cloud-section-head">
                <div><h2>最近文件</h2><p>按最近操作时间排序</p></div>
              </header>
              {loading && <div className="mobile-cloud-empty">正在读取文件…</div>}
              {!loading && mobileRecentFiles.length === 0 && <div className="mobile-cloud-empty">暂无文件</div>}
              {!loading && mobileRecentFiles.map(file => (
                <article key={file.id} className="mobile-cloud-file-row" onClick={() => openMobileFile(file)} data-mobile-cloud-id={file.id}>
                  <span className="mobile-cloud-row-icon"><FileIcon type={file.type} size={21} /></span>
                  <span className="mobile-cloud-file-copy"><strong>{file.name}</strong><small>{file.size} · {file.updatedAt}</small></span>
                  <button type="button" onClick={event => openFileContextMenu(event, file)} aria-label={`${file.name} 更多操作`}><MoreHorizontal size={18} /></button>
                </article>
              ))}
            </section>
          </main>
          <button type="button" className="mobile-cloud-fab" onClick={() => fileInputRef.current?.click()} disabled={uploading} aria-label="上传文件"><Upload size={24} /></button>
          {ConfirmDialog}
          {mobileContextMenu}
        </div>
      </FileDropZone>
    );
  }

  return (
    <FileDropZone className="h-full w-full" disabled={uploading || showTrash} onFiles={handleUpload} message="松开以上传到云盘">
    <div className="mobile-system-page mobile-cloud-page square-ui flex min-h-full w-full flex-col gap-5 overflow-visible lg:h-full lg:overflow-hidden">
      <Header
        title="云盘"
        info={<FeatureInfo label="云盘功能说明">上传、整理和分享文件，右键查看更多操作。</FeatureInfo>}
        subtitle={showTrash ? '查看和处理已删除文件，文件将在 7 天后自动清除。' : '集中管理部门文件、文件夹与共享内容。'}
      >
        {showTrash && selectedFile && (
          <button
            type="button"
            onClick={() => handlePermanentDelete(selectedFile)}
            className="inline-flex h-10 items-center justify-center gap-2 border border-red-200 bg-white px-4 text-sm font-medium text-red-600 hover:bg-red-50"
          >
            <Trash2 size={16} />
            永久删除
          </button>
        )}
        <button
          type="button"
          onClick={() => setShowTrash(value => !value)}
          className={`inline-flex h-10 items-center justify-center gap-2 px-4 text-sm font-medium ${
            showTrash
              ? 'bg-slate-950 text-white hover:bg-slate-800'
              : 'bg-white text-slate-700 hover:bg-slate-50'
          }`}
        >
          <Trash2 size={16} />
          回收站
        </button>
      </Header>

      <div className="hidden border border-slate-200 bg-white p-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full min-w-0 lg:w-1/2 lg:flex-none">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="搜索文件名、类型或上传人"
              className="h-10 w-full border border-slate-200 bg-white pl-9 pr-9 text-sm text-slate-700 outline-none transition-colors placeholder:text-slate-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-end lg:w-auto">
            {usage && (
              <div className="flex h-10 min-w-[260px] items-center gap-2 border border-slate-200 bg-slate-50 px-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center border border-slate-200 bg-white text-slate-600">
                  <HardDrive size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-medium text-slate-500">剩余空间</span>
                    <span className="font-mono text-xs font-semibold text-slate-900">
                      {formatSize(Math.max(0, usage.quota - usage.used))}
                    </span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden bg-slate-200">
                    <div className="h-full bg-slate-950" style={{ width: `${Math.min(100, usage.usedPercent)}%` }} />
                  </div>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() => fetchFiles(showTrash)}
              disabled={loading}
              className="inline-flex h-10 shrink-0 items-center justify-center gap-2 border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              刷新
            </button>

            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={event => handleUpload(event.target.files)}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || showTrash}
              className="inline-flex h-10 shrink-0 items-center justify-center gap-2 border border-primary-600 bg-primary-600 px-4 text-sm font-medium text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Upload size={16} />
              {uploading ? '上传中' : '上传'}
            </button>
          </div>
        </div>
      </div>

      <section className={`hidden min-h-0 flex-1 gap-5 overflow-hidden ${
        CLOUD_DRIVE_PREVIEW_VISIBLE ? 'lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]' : 'grid-cols-1'
      }`}>
        <div className="flex h-full min-h-0 flex-col overflow-hidden border border-slate-200 bg-white">
          <div
            className="grid min-h-10 shrink-0 items-center gap-3 border-b border-slate-200 bg-slate-50 px-4 text-xs font-semibold text-slate-500"
            style={{ gridTemplateColumns: TABLE_COLUMNS }}
          >
            {SORT_COLUMNS.map(column => (
              <button
                key={column.key}
                type="button"
                onClick={() => handleSort(column.key)}
                className="flex min-w-0 items-center gap-1.5 text-left font-semibold text-slate-500 hover:text-slate-900"
              >
                <span className="truncate">{showTrash && column.key === 'updatedAt' ? '删除时间' : column.label}</span>
                <SortIcon active={sortKey === column.key} direction={sortDirection} />
              </button>
            ))}
            <div className="text-right">操作</div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {loading && (
              <div className="space-y-px bg-slate-100" aria-label="正在读取文件">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div key={index} className="grid min-h-[54px] animate-pulse items-center gap-3 bg-white px-4" style={{ gridTemplateColumns: TABLE_COLUMNS }}>
                    <div className="h-3 bg-slate-100" /><div className="h-3 bg-slate-100" /><div className="h-3 bg-slate-100" />
                    <div className="h-3 bg-slate-100" /><div className="h-3 bg-slate-100" /><div className="h-3 bg-slate-100" />
                  </div>
                ))}
              </div>
            )}

            {!loading && filteredFiles.length === 0 && (
              <div className="flex h-full min-h-[420px] flex-col items-center justify-center px-6 text-center">
                <span className="mb-4 flex h-14 w-14 items-center justify-center border border-slate-200 bg-slate-50 text-slate-400">
                  {showTrash ? <Trash2 size={24} /> : <Upload size={24} />}
                </span>
                <div className="text-sm font-semibold text-slate-800">{showTrash ? '回收站是空的' : '还没有部门文件'}</div>
                <div className="mt-2 text-xs leading-5 text-slate-500">
                  {showTrash ? '移入回收站的文件会在这里保留 7 天。' : '上传第一份文件，建立统一的部门资料入口。'}
                </div>
                {!showTrash && (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="mt-5 inline-flex h-10 items-center justify-center gap-2 bg-primary-700 px-4 text-sm font-medium text-white hover:bg-primary-800"
                  >
                    <Upload size={16} />
                    上传第一份文件
                  </button>
                )}
              </div>
            )}

            {!loading && filteredFiles.map(file => (
              <article
                key={file.id}
                onContextMenu={event => openFileContextMenu(event, file)}
                onClick={() => {
                  setSelectedFileId(file.id);
                  setSearchParams(params => {
                    const next = new URLSearchParams(params);
                    next.set('fileId', file.id);
                    return next;
                  });
                }}
                className={`app-file-row grid min-h-[54px] cursor-pointer items-center gap-3 border-b border-slate-100 px-4 py-2.5 text-sm text-slate-600 last:border-b-0 hover:bg-slate-50 ${selectedFile?.id === file.id ? 'app-selected-border relative z-10' : ''}`}
                style={{ gridTemplateColumns: TABLE_COLUMNS }}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center border border-slate-200 bg-slate-50">
                    <FileIcon type={file.type} />
                  </span>
                  {renamingFileId === file.id ? (
                    <input
                      autoFocus
                      value={renameValue}
                      disabled={renaming}
                      onClick={event => event.stopPropagation()}
                      onChange={event => setRenameValue(event.target.value)}
                      onFocus={event => {
                        const dot = event.currentTarget.value.lastIndexOf('.');
                        event.currentTarget.setSelectionRange(0, dot > 0 ? dot : event.currentTarget.value.length);
                      }}
                      onKeyDown={event => {
                        event.stopPropagation();
                        if (event.key === 'Enter') handleRename(file);
                        if (event.key === 'Escape') cancelRename();
                      }}
                      aria-label={`重命名 ${file.name}`}
                      className="cloud-drive-rename-input h-8 min-w-0 flex-1 bg-white px-2 font-semibold text-slate-900 disabled:opacity-60"
                    />
                  ) : (
                    <span
                      className="truncate font-semibold text-slate-900"
                      title={file.name}
                    >
                      {file.name}
                    </span>
                  )}
                </div>
                <div className="truncate text-slate-500">{file.type}</div>
                <div className="truncate font-mono text-xs text-slate-500">{file.size}</div>
                <div className="truncate text-slate-700">{file.uploader}</div>
                <div className="truncate font-mono text-xs text-slate-500">{file.updatedAt}</div>
                <div className="flex items-center justify-end gap-1">
                  {!showTrash && (
                    <>
                      {renamingFileId === file.id ? (
                        <>
                          <button type="button" disabled={renaming} onClick={(event) => { event.stopPropagation(); handleRename(file); }} className="p-1.5 text-primary-600 hover:bg-primary-50 disabled:opacity-50" title="保存名称">
                            <Check size={14} />
                          </button>
                          <button type="button" disabled={renaming} onClick={(event) => { event.stopPropagation(); cancelRename(); }} className="p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50" title="取消重命名">
                            <X size={14} />
                          </button>
                        </>
                      ) : (
                        null
                      )}
                      <button type="button" onClick={(event) => { event.stopPropagation(); handleDownload(file); }} className="p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="离线下载">
                        <Download size={14} />
                      </button>
                      <button type="button" onClick={(event) => { event.stopPropagation(); handleTrash(file); }} className="p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-600" title="移入回收站">
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                  {showTrash && (
                    <>
                      <button type="button" onClick={(event) => { event.stopPropagation(); handleRestore(file); }} className="p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="恢复">
                        <RotateCcw size={14} />
                      </button>
                      <button type="button" onClick={(event) => { event.stopPropagation(); handlePermanentDelete(file); }} className="p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-600" title="永久删除">
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                  <button type="button" className="p-1.5 text-slate-300" title="更多">
                    <MoreHorizontal size={14} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>

        {CLOUD_DRIVE_PREVIEW_VISIBLE && (
          <PreviewPane
            file={selectedFile}
            showTrash={showTrash}
            previewUrl={previewUrl}
            previewText={previewText}
            loading={previewLoading}
            error={previewError}
          />
        )}
      </section>

      <section className="flex min-h-0 flex-1 flex-col overflow-visible bg-white lg:overflow-hidden">
        <input ref={fileInputRef} type="file" className="hidden" onChange={event => handleUpload(event.target.files)} />

        <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 py-4 sm:px-5">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || showTrash}
            className="inline-flex h-10 items-center justify-center gap-2 bg-slate-950 px-4 text-sm font-medium text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Upload size={17} />
            {uploading ? '上传中' : '上传文件'}
          </button>
          <button
            type="button"
            onClick={() => { setFolderName(''); setFolderModalOpen(true); }}
            disabled={showTrash}
            className="inline-flex h-10 items-center justify-center gap-2 border border-surface-200 bg-white px-4 text-sm font-medium text-surface-700 hover:bg-surface-50 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <FolderPlus size={17} />
            新建文件夹
          </button>
          <div className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-2 sm:ml-auto sm:flex sm:w-auto sm:justify-end">
            <div className="col-span-full flex min-w-0 items-center gap-2 sm:w-auto sm:flex-none">
              <button type="button" onClick={() => window.open('/sheet-editor', '_blank', 'noopener,noreferrer')} className="flex h-10 w-10 shrink-0 items-center justify-center border border-surface-200 bg-white text-emerald-700 transition-colors hover:border-emerald-200 hover:bg-emerald-50" title="在新网页打开表格编辑器" aria-label="在新网页打开表格编辑器"><FileSpreadsheet size={18} /></button>
              <div className="relative min-w-0 flex-1 sm:w-72 sm:flex-none">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
                <input
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                  placeholder="搜索文件"
                  className="h-10 w-full border border-surface-200 bg-surface-50 pl-9 pr-9 text-sm text-surface-800 outline-none transition-colors placeholder:text-surface-400 focus:border-primary-400 focus:bg-white"
                />
                {search && (
                  <button type="button" onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-surface-400 hover:text-surface-700" aria-label="清空搜索">
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>
            <div ref={sortMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setSortMenuOpen(value => !value)}
                className={`flex h-10 w-10 items-center justify-center border text-surface-600 transition-colors ${sortMenuOpen ? 'border-surface-300 bg-surface-100 text-surface-900' : 'border-surface-200 bg-white hover:bg-surface-50'}`}
                title="排序"
                aria-label="排序"
                aria-expanded={sortMenuOpen}
              >
                <ArrowDownUp size={17} />
              </button>
              {sortMenuOpen && (
                <div className="absolute right-0 top-12 z-50 w-56 border border-surface-200 bg-white p-2 shadow-xl shadow-surface-900/10">
                  {([
                    ['name', '按文件名'],
                    ['type', '按文件类型'],
                    ['updatedAt', '按修改时间'],
                    ['size', '按文件大小'],
                    ['operatedAt', '按操作时间'],
                  ] as Array<[SortCriterion, string]>).map(([criterion, label]) => {
                    const selected = sortCriterion === criterion;
                    return (
                      <button key={criterion} type="button" onClick={() => { setSortCriterion(criterion); setSortKey(criterion === 'operatedAt' ? 'updatedAt' : criterion); setSortMenuOpen(false); }} className="flex h-10 w-full items-center justify-between px-3 text-left text-sm text-surface-700 hover:bg-surface-50 hover:text-surface-950">
                        <span>{label}</span>
                        {selected && <Check size={16} className="text-surface-900" />}
                      </button>
                    );
                  })}
                  <div className="my-2 border-t border-surface-100" />
                  {(['asc', 'desc'] as SortDirection[]).map(direction => (
                    <button key={direction} type="button" onClick={() => { setSortDirection(direction); setSortMenuOpen(false); }} className="flex h-10 w-full items-center justify-between px-3 text-left text-sm text-surface-700 hover:bg-surface-50 hover:text-surface-950">
                      <span>{direction === 'asc' ? '正序' : '倒序'}</span>
                      {sortDirection === direction && <Check size={16} className="text-surface-900" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex h-10 items-center border border-surface-200 bg-surface-100 p-0.5" aria-label="视图切换">
              <button type="button" onClick={() => setViewMode('list')} className={`flex h-9 w-9 items-center justify-center ${viewMode === 'list' ? 'bg-white text-surface-900 shadow-sm' : 'text-surface-400 hover:text-surface-700'}`} aria-label="列表视图" aria-pressed={viewMode === 'list'}><List size={17} /></button>
              <button type="button" onClick={() => setViewMode('grid')} className={`flex h-9 w-9 items-center justify-center ${viewMode === 'grid' ? 'bg-white text-surface-900 shadow-sm' : 'text-surface-400 hover:text-surface-700'}`} aria-label="宫格视图" aria-pressed={viewMode === 'grid'}><Grid3X3 size={17} /></button>
            </div>
            <button type="button" onClick={() => fetchFiles(showTrash)} disabled={loading} className="flex h-10 w-10 items-center justify-center border border-surface-200 bg-white text-surface-500 hover:bg-surface-50 hover:text-surface-900 disabled:opacity-50" title="刷新" aria-label="刷新文件">
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        <div className="hidden">
          <div className="min-w-0">
            <div className="flex items-center gap-1 text-base font-semibold text-surface-900">
              <button type="button" onClick={() => setCurrentFolderId('')} className="hover:text-primary-700">{showTrash ? '回收站' : routeProjectId ? '项目文件' : '全部文件'}</button>
              {!showTrash && folderTrail.map(folder => (
                <span key={folder.id} className="flex items-center gap-1">
                  <span className="text-surface-300">/</span>
                  <button type="button" onClick={() => setCurrentFolderId(folder.id)} className="max-w-40 truncate hover:text-primary-700">{folder.name}</button>
                </span>
              ))}
            </div>
            <div className="mt-0.5 text-xs text-surface-400">{filteredFiles.length} 项{search ? ` · 搜索“${search}”` : ''}</div>
          </div>
          <div className="hidden">
            <div className="relative">
              <button
                type="button"
                onClick={() => setSortMenuOpen(value => !value)}
                className={`flex h-9 w-9 items-center justify-center border text-surface-600 transition-colors ${sortMenuOpen ? 'border-surface-300 bg-surface-100 text-surface-900' : 'border-surface-200 bg-white hover:bg-surface-50'}`}
                title="排序"
                aria-label="排序"
                aria-expanded={sortMenuOpen}
              >
                <ArrowDownUp size={17} />
              </button>
              {sortMenuOpen && (
                <div className="absolute right-0 top-11 z-50 w-56 border border-surface-200 bg-white p-2 shadow-xl shadow-surface-900/10">
                  {([
                    ['name', '按文件名'],
                    ['type', '按文件类型'],
                    ['updatedAt', '按修改时间'],
                    ['size', '按文件大小'],
                    ['operatedAt', '按操作时间'],
                  ] as Array<[SortCriterion, string]>).map(([criterion, label]) => {
                    const selected = sortCriterion === criterion;
                    return (
                      <button
                        key={criterion}
                        type="button"
                        onClick={() => {
                          setSortCriterion(criterion);
                          setSortKey(criterion === 'operatedAt' ? 'updatedAt' : criterion);
                          setSortMenuOpen(false);
                        }}
                        className="flex h-10 w-full items-center justify-between px-3 text-left text-sm text-surface-700 hover:bg-surface-50 hover:text-surface-950"
                      >
                        <span>{label}</span>
                        {selected && <Check size={16} className="text-surface-900" />}
                      </button>
                    );
                  })}
                  <div className="my-2 border-t border-surface-100" />
                  {(['asc', 'desc'] as SortDirection[]).map(direction => (
                    <button
                      key={direction}
                      type="button"
                      onClick={() => { setSortDirection(direction); setSortMenuOpen(false); }}
                      className="flex h-10 w-full items-center justify-between px-3 text-left text-sm text-surface-700 hover:bg-surface-50 hover:text-surface-950"
                    >
                      <span>{direction === 'asc' ? '正序' : '倒序'}</span>
                      {sortDirection === direction && <Check size={16} className="text-surface-900" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="hidden h-9 items-center border border-surface-200 bg-surface-100 p-0.5 lg:flex" aria-label="视图切换">
              <button type="button" onClick={() => setViewMode('list')} className={`flex h-8 w-9 items-center justify-center ${viewMode === 'list' ? 'bg-white text-surface-900 shadow-sm' : 'text-surface-400 hover:text-surface-700'}`} aria-label="列表视图" aria-pressed={viewMode === 'list'}>
                <List size={17} />
              </button>
              <button type="button" onClick={() => setViewMode('grid')} className={`flex h-8 w-9 items-center justify-center ${viewMode === 'grid' ? 'bg-white text-surface-900 shadow-sm' : 'text-surface-400 hover:text-surface-700'}`} aria-label="宫格视图" aria-pressed={viewMode === 'grid'}>
                <Grid3X3 size={17} />
              </button>
            </div>
            <button type="button" onClick={() => fetchFiles(showTrash)} disabled={loading} className="flex h-9 w-9 items-center justify-center border border-surface-200 bg-white text-surface-500 hover:bg-surface-50 hover:text-surface-900 disabled:opacity-50" title="刷新" aria-label="刷新文件">
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        <div ref={listScrollRef} className="min-h-0 flex-1 overflow-visible px-4 pb-4 lg:overflow-auto lg:px-5">
          {loading && (
            <div className="space-y-2 py-3" aria-label="正在读取文件">
              {Array.from({ length: 7 }).map((_, index) => <div key={index} className="h-14 animate-pulse bg-surface-100" />)}
            </div>
          )}

          {!loading && filteredFiles.length === 0 && (
            <div className="flex h-full min-h-[360px] flex-col items-center justify-center text-center">
              <span className="mb-4 flex h-16 w-16 items-center justify-center bg-primary-50 text-primary-500">{showTrash ? <Trash2 size={26} /> : <HardDrive size={26} />}</span>
              <div className="text-sm font-semibold text-surface-800">{showTrash ? '回收站是空的' : search ? '没有匹配的文件' : '还没有部门文件'}</div>
              <div className="mt-2 text-xs text-surface-400">{showTrash ? '移入回收站的文件会保留 7 天。' : search ? '换个关键词试试。' : '上传第一份文件，开始沉淀部门资料。'}</div>
            </div>
          )}

          {!loading && filteredFiles.length > 0 && effectiveViewMode === 'list' && (
            <>
            <div className="divide-y divide-surface-100 lg:hidden">
              {filteredFiles.map(file => (
                <article
                  key={file.id}
                  draggable={!showTrash && !movingFileId && renamingFileId !== file.id}
                  onDragStart={event => handleDragStart(event, file)}
                  onDragEnd={handleDragEnd}
                  onDragOver={file.kind === 'folder' ? event => handleFolderDragOver(event, file) : undefined}
                  onDragLeave={file.kind === 'folder' ? event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropFolderId(current => current === file.id ? null : current); } : undefined}
                  onDrop={file.kind === 'folder' ? event => void handleMoveToFolder(event, file) : undefined}
                  onClick={event => handleItemClick(event, file)}
                  className={`flex min-h-[68px] cursor-pointer items-center gap-3 py-2.5 transition-colors ${dropFolderId === file.id || selectedFileIds.includes(file.id) ? 'bg-primary-50 text-primary-700 ring-1 ring-inset ring-primary-300' : ''} ${draggingFileId === file.id ? 'opacity-45' : ''}`}
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center"><FileIcon type={file.type} size={32} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-surface-900" title={file.name}>{file.name}</div>
                    <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-surface-400">
                      <span className="shrink-0">{file.kind === 'folder' ? '文件夹' : file.type}</span>
                      {file.kind !== 'folder' && <><span>·</span><span className="shrink-0">{file.size}</span></>}
                      <span>·</span><span className="min-w-0 truncate font-mono">{file.updatedAt}</span>
                    </div>
                  </div>
                  <button type="button" onClick={event => openFileContextMenu(event, file)} className="flex h-10 w-10 shrink-0 items-center justify-center text-surface-400" aria-label={`${file.name} 更多操作`}><MoreHorizontal size={18} /></button>
                </article>
              ))}
            </div>
            <div className="hidden min-w-[900px] lg:block">
              <div className="grid h-11 items-center gap-4 px-3 text-xs font-medium text-surface-500" style={{ gridTemplateColumns: QUARK_LIST_COLUMNS }}>
                <button type="button" onClick={() => handleSort('name')} className="flex items-center gap-1.5 text-left hover:text-surface-900">文件名<SortIcon active={sortKey === 'name'} direction={sortDirection} /></button>
                <span />
                <button type="button" onClick={() => handleSort('size')} className="flex items-center gap-1.5 text-left hover:text-surface-900">大小<SortIcon active={sortKey === 'size'} direction={sortDirection} /></button>
                <button type="button" onClick={() => handleSort('type')} className="flex items-center gap-1.5 text-left hover:text-surface-900">文件类型<SortIcon active={sortKey === 'type'} direction={sortDirection} /></button>
                <button type="button" onClick={() => handleSort('updatedAt')} className="flex items-center gap-1.5 text-left hover:text-surface-900">{showTrash ? '删除时间' : '修改时间'}<SortIcon active={sortKey === 'updatedAt'} direction={sortDirection} /></button>
              </div>
              {filteredFiles.map(file => (
                <article
                  key={file.id}
                  draggable={!showTrash && !movingFileId && renamingFileId !== file.id}
                  onDragStart={event => handleDragStart(event, file)}
                  onDragEnd={handleDragEnd}
                  onDragOver={file.kind === 'folder' ? event => handleFolderDragOver(event, file) : undefined}
                  onDragLeave={file.kind === 'folder' ? event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropFolderId(current => current === file.id ? null : current); } : undefined}
                  onDrop={file.kind === 'folder' ? event => void handleMoveToFolder(event, file) : undefined}
                  onContextMenu={event => openFileContextMenu(event, file)}
                  onClick={event => handleItemClick(event, file)}
                  className={`group grid min-h-[56px] cursor-pointer items-center gap-4 rounded-lg px-3 text-sm transition-colors ${dropFolderId === file.id || selectedFileIds.includes(file.id) ? 'bg-primary-50 text-primary-700 ring-1 ring-inset ring-primary-300' : 'hover:bg-surface-100'} ${draggingFileId === file.id ? 'opacity-45' : ''}`}
                  style={{ gridTemplateColumns: QUARK_LIST_COLUMNS }}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center"><FileIcon type={file.type} size={28} /></span>
                    {renamingFileId === file.id ? (
                      <input autoFocus value={renameValue} disabled={renaming} onClick={event => event.stopPropagation()} onChange={event => setRenameValue(event.target.value)} onKeyDown={event => { event.stopPropagation(); if (event.key === 'Enter') handleRename(file); if (event.key === 'Escape') cancelRename(); }} aria-label={`重命名 ${file.name}`} className="h-8 min-w-0 flex-1 border border-primary-300 bg-white px-2 text-sm text-surface-900" />
                    ) : <span className="truncate font-medium text-surface-900" title={file.name}>{file.name}</span>}
                  </div>
                  <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                    {showTrash ? (
                      <>
                        <button type="button" onClick={event => { event.stopPropagation(); handleRestore(file); }} className="p-2 text-surface-500 hover:bg-white hover:text-primary-700" title="恢复"><RotateCcw size={15} /></button>
                        <button type="button" onClick={event => { event.stopPropagation(); handlePermanentDelete(file); }} className="p-2 text-surface-500 hover:bg-white hover:text-red-600" title="永久删除"><Trash2 size={15} /></button>
                      </>
                    ) : (
                      <>
                        {canEditOnline(file) && <button type="button" onClick={event => { event.stopPropagation(); openSheetEditor(file); }} className="p-2 text-surface-500 hover:bg-white hover:text-emerald-700" title="在线编辑"><FileSpreadsheet size={15} /></button>}
                        {file.kind !== 'folder' && <button type="button" onClick={event => { event.stopPropagation(); handleDownload(file); }} className="p-2 text-surface-500 hover:bg-white hover:text-primary-700" title="离线下载"><Download size={15} /></button>}
                        <button type="button" onClick={event => { event.stopPropagation(); handleTrash(file); }} className="p-2 text-surface-500 hover:bg-white hover:text-red-600" title="移入回收站"><Trash2 size={15} /></button>
                      </>
                    )}
                    <button type="button" onClick={event => { event.stopPropagation(); openFileContextMenu(event, file); }} className="p-2 text-surface-500 hover:bg-white hover:text-surface-900" title="更多"><MoreHorizontal size={16} /></button>
                  </div>
                  <div className="text-sm text-surface-400">{file.kind === 'folder' ? '-' : file.size}</div>
                  <div className="text-sm text-surface-400">{file.type}</div>
                  <div className="font-mono text-sm text-surface-400">{file.updatedAt}</div>
                </article>
              ))}
            </div>
            </>
          )}

          {!loading && filteredFiles.length > 0 && effectiveViewMode === 'grid' && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-x-3 gap-y-4 py-2">
              {filteredFiles.map(file => (
                <article
                  key={file.id}
                  draggable={!showTrash && !movingFileId && renamingFileId !== file.id}
                  onDragStart={event => handleDragStart(event, file)}
                  onDragEnd={handleDragEnd}
                  onDragOver={file.kind === 'folder' ? event => handleFolderDragOver(event, file) : undefined}
                  onDragLeave={file.kind === 'folder' ? event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropFolderId(current => current === file.id ? null : current); } : undefined}
                  onDrop={file.kind === 'folder' ? event => void handleMoveToFolder(event, file) : undefined}
                  onContextMenu={event => openFileContextMenu(event, file)}
                  onClick={event => handleItemClick(event, file)}
                  className={`group relative flex aspect-square cursor-pointer flex-col p-2 text-surface-800 transition-colors ${dropFolderId === file.id || selectedFileIds.includes(file.id) ? 'bg-primary-50 text-primary-700 ring-2 ring-inset ring-primary-300' : 'hover:text-primary-700'} ${draggingFileId === file.id ? 'opacity-45' : ''}`}
                >
                  <button type="button" onClick={event => openFileContextMenu(event, file)} className="absolute right-2 top-2 p-1.5 text-surface-300 opacity-0 hover:bg-white hover:text-surface-700 group-hover:opacity-100" aria-label={`${file.name} 更多操作`}><MoreHorizontal size={15} /></button>
                  <div className="flex min-h-0 flex-1 items-center justify-center"><FileIcon type={file.type} size={40} /></div>
                  <div className="mt-1 line-clamp-2 min-h-8 shrink-0 text-center text-xs font-medium leading-4" title={file.name}>{file.name}</div>
                </article>
              ))}
            </div>
          )}
        </div>

        {!loading && filteredFiles.length > 0 && (
          <div className="flex h-10 shrink-0 items-center justify-center text-xs text-surface-400">
            共 {filteredFiles.length} 项{usage ? ` · 剩余可用空间 ${formatSize(Math.max(0, usage.quota - usage.used))}` : ''}
          </div>
        )}
      </section>

      <AppModal
        open={folderModalOpen}
        onClose={() => { if (!creatingFolder) setFolderModalOpen(false); }}
        title="新建文件夹"
        subtitle={currentFolderId ? `将在“${folderTrail[folderTrail.length - 1]?.name || '当前目录'}”中新建` : '将在全部文件中创建'}
        icon={<FolderPlus size={18} />}
        size="sm"
        footer={(
          <>
            <button type="button" onClick={() => setFolderModalOpen(false)} disabled={creatingFolder} className="h-10 border border-surface-200 bg-white px-4 text-sm font-medium text-surface-700 hover:bg-surface-50 disabled:opacity-50">取消</button>
            <button type="button" onClick={handleCreateFolder} disabled={creatingFolder || !folderName.trim()} className="h-10 bg-primary-700 px-4 text-sm font-medium text-white hover:bg-primary-800 disabled:cursor-not-allowed disabled:opacity-45">{creatingFolder ? '创建中…' : '创建'}</button>
          </>
        )}
      >
        <label className="block text-sm font-medium text-surface-700" htmlFor="cloud-folder-name">文件夹名称</label>
        <input
          id="cloud-folder-name"
          autoFocus
          value={folderName}
          onChange={event => setFolderName(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter') void handleCreateFolder(); }}
          maxLength={255}
          placeholder="请输入文件夹名称"
          className="mt-2 h-11 w-full border border-surface-200 bg-white px-3 text-sm text-surface-900 outline-none focus:border-primary-500"
        />
      </AppModal>

      <AppModal
        open={moveModalOpen}
        onClose={() => { if (!batchMoving) setMoveModalOpen(false); }}
        title="移动到文件夹"
        subtitle={`已选择 ${selectedMoveFiles.length} 项`}
        icon={<FolderInput size={18} />}
        size="sm"
        footer={<><button type="button" onClick={() => setMoveModalOpen(false)} disabled={batchMoving} className="app-button-secondary h-10 px-4 disabled:opacity-50">取消</button><button type="button" onClick={() => void handleBatchMove()} disabled={batchMoving || !moveTargetFolderId} className="app-button-primary h-10 px-4 disabled:opacity-45">{batchMoving ? '移动中…' : '移动'}</button></>}
      >
        <div className="max-h-80 overflow-y-auto border-y border-surface-100">
          {moveFolderOptions.length === 0 && <p className="py-8 text-center text-sm text-surface-400">暂无可移动到的文件夹</p>}
          {moveFolderOptions.map(({ folder, path }) => (
            <button key={folder.id} type="button" onClick={() => setMoveTargetFolderId(folder.id)} className={`flex min-h-12 w-full items-center gap-3 border-b border-surface-100 px-2 text-left last:border-b-0 ${moveTargetFolderId === folder.id ? 'bg-primary-50 text-primary-700' : 'text-surface-700 hover:bg-surface-50'}`}>
              <Folder size={19} className="shrink-0 text-sky-500" />
              <span className="min-w-0 flex-1 truncate text-sm" title={path}>{path}</span>
              {moveTargetFolderId === folder.id && <Check size={16} className="shrink-0" />}
            </button>
          ))}
        </div>
      </AppModal>

      {ConfirmDialog}
      {contextMenu && contextFile && <ContextMenu x={contextMenu.x} y={contextMenu.y} width={176} ariaLabel={`${contextFile.name} 文件菜单`} onClose={() => setContextMenu(null)} items={[
        ...(canEditOnline(contextFile) ? [{ key: 'online-edit', label: '在线编辑', icon: <FileSpreadsheet size={14} />, onSelect: () => openSheetEditor(contextFile) }] : []),
        ...(contextFile.kind !== 'folder' ? [{ key: 'share', label: '复制分享链接', icon: <Share2 size={14} />, onSelect: () => void handleShare(contextFile) }] : []),
        { key: 'move', label: selectedMoveFiles.length > 1 ? `移动 ${selectedMoveFiles.length} 项` : '移动到文件夹', icon: <FolderInput size={14} />, onSelect: openMoveModal },
        { key: 'rename', label: '重命名', icon: <Pencil size={14} />, onSelect: () => beginRename(contextFile) },
        { key: 'delete', label: '删除', icon: <Trash2 size={14} />, danger: true, separatorBefore: true, onSelect: () => void handleTrash(contextFile) },
      ]} />}
    </div>
    </FileDropZone>
  );
}
