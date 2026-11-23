import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Code2,
  Copy,
  Download,
  ExternalLink,
  Maximize2,
  Pencil,
  Power,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import Header from '../components/Layout/Header';
import ContextMenu from '../components/Layout/ContextMenu';
import AppModal from '../components/Layout/AppModal';
import { useConfirm } from '../components/Toast';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';
import FileDropZone from '../components/FileDropZone';
import { _toast } from '../store/toastRef';
import { buildServerErrorMessage } from '../utils/errorCodes';
import { MobileLibraryCard, MobileLibrarySlice } from '../components/Mobile/MobileBasePrimitives';

type ItemType = string;
type ItemStatus = 'active' | 'draft' | 'disabled' | 'deleted';

interface ToolVersion {
  id: string;
  versionNo: number;
  versionLabel: string;
  fileName: string;
  fileSize: number;
  changelog: string;
  uploadedByName: string;
  uploadedAt: string;
}

interface ToolItem {
  id: string;
  type: ItemType;
  name: string;
  description: string;
  category: string;
  status: ItemStatus;
  currentVersionNo: number;
  currentVersionLabel: string;
  createdByName: string;
  updatedAt: string;
  uploadedAt: string;
  uploadedByName: string;
  fileName: string;
  fileSize: number;
  changelog: string;
  viewCount: number;
  canManage: boolean;
  openUrl: string;
  versions?: ToolVersion[];
}

function getToken() {
  return localStorage.getItem('auth_token');
}

async function toolsRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(options.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(`/api/tools${path}`, { ...options, headers });
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
  return `${index === 0 || value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function formatDateTime(value?: string) {
  if (!value) return '未记录';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function statusText(status: ItemStatus) {
  if (status === 'active') return '已启用';
  if (status === 'draft') return '草稿';
  if (status === 'disabled') return '已下架';
  return '已删除';
}

function statusClass(status: ItemStatus) {
  if (status === 'active') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (status === 'draft') return 'border-amber-200 bg-amber-50 text-amber-700';
  if (status === 'disabled') return 'border-slate-200 bg-slate-100 text-slate-600';
  return 'border-red-200 bg-red-50 text-red-600';
}

interface ToolsCenterProps {
  mode?: 'tools' | 'questionnaires';
}

export default function ToolsCenter({ mode = 'tools' }: ToolsCenterProps) {
  const isQuestionnaire = mode === 'questionnaires';
  const itemLabel = isQuestionnaire ? '问卷' : '工具';
  const [items, setItems] = useState<ToolItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadMode, setUploadMode] = useState<'create' | 'version'>('create');
  const [runnerOpen, setRunnerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [mobileFilter, setMobileFilter] = useState<'all' | 'active' | 'mine'>('all');
  const [expandedItem, setExpandedItem] = useState<ToolItem | null>(null);
  const [contextMenu, setContextMenu] = useState<{ item: ToolItem; x: number; y: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { confirm: ask, ConfirmDialog } = useConfirm();

  const fetchItems = async () => {
    setLoading(true);
    try {
      const res = await toolsRequest<{ items: ToolItem[] }>('?type=html_tool');
      const nextItems = (res.items || []).filter(item => isQuestionnaire
        ? item.category === 'questionnaire'
        : item.category !== 'questionnaire');
      setItems(nextItems);
      setSelectedId(current => current && nextItems.some(item => item.id === current) ? current : nextItems[0]?.id || null);
    } catch (err: any) {
      _toast.error?.(err.message || `获取${itemLabel}列表失败`);
    } finally {
      setLoading(false);
    }
  };
  useRealtimeRefresh(['tool'], fetchItems);

  useEffect(() => {
    fetchItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredItems = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return [...items]
      .filter(item => !keyword || [item.name, item.description, item.category, item.fileName, item.createdByName, item.uploadedByName]
        .some(value => String(value || '').toLowerCase().includes(keyword)))
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  }, [items, search]);

  const selected = useMemo(
    () => filteredItems.find(item => item.id === selectedId) || filteredItems[0] || null,
    [filteredItems, selectedId]
  );

  const mobileItems = useMemo(() => filteredItems.filter(item => {
    if (mobileFilter === 'active') return item.status === 'active';
    if (mobileFilter === 'mine') return item.canManage;
    return true;
  }), [filteredItems, mobileFilter]);

  const openUpload = (mode: 'create' | 'version') => {
    setUploadMode(mode);
    setUploadOpen(true);
  };

  const closeUpload = () => {
    setUploadOpen(false);
    setUploading(false);
    setUploadFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const submitUpload = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const file = uploadFile || form.get('file') as File | null;
    if (!file || !file.name) {
      _toast.warning?.('请选择文件');
      return;
    }
    if (uploadMode === 'version' && !selected) return;

    setUploading(true);
    try {
      form.set('file', file);
      form.set('type', 'html_tool');
      if (isQuestionnaire) form.set('category', 'questionnaire');
      const token = getToken();
      const headers = new Headers();
      if (token) headers.set('Authorization', `Bearer ${token}`);
      const endpoint = uploadMode === 'create'
        ? '/api/tools/upload'
        : `/api/tools/${encodeURIComponent(selected!.id)}/version`;
      const res = await fetch(endpoint, { method: 'POST', headers, body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(buildServerErrorMessage(body, res.status, '上传失败'));
      }
      _toast.success?.(uploadMode === 'create' ? '已上传' : '已更新版本');
      closeUpload();
      await fetchItems();
    } catch (err: any) {
      _toast.error?.(err.message || '上传失败');
      setUploading(false);
    }
  };

  const changeStatus = async (item: ToolItem, next: 'active' | 'disabled' | 'deleted') => {
    const label = next === 'deleted' ? '删除' : next === 'disabled' ? '下架' : '启用';
    if (next === 'deleted') {
      const ok = await ask(`确定删除“${item.name}”吗？此操作会从列表中移除。`);
      if (!ok) return;
    }
    try {
      const path = next === 'deleted'
        ? `/${encodeURIComponent(item.id)}`
        : `/${encodeURIComponent(item.id)}/${next === 'active' ? 'enable' : 'disable'}`;
      await toolsRequest(path, { method: next === 'deleted' ? 'DELETE' : 'POST' });
      _toast.success?.(`已${label}`);
      await fetchItems();
    } catch (err: any) {
      _toast.error?.(err.message || `${label}失败`);
    }
  };

  const beginRename = (item: ToolItem) => {
    setContextMenu(null);
    setSelectedId(item.id);
    setRenamingId(item.id);
    setRenameValue(item.name);
  };

  const saveRename = async (item: ToolItem) => {
    const name = renameValue.trim();
    if (!name || renaming) return;
    setRenaming(true);
    try {
      await toolsRequest(`/${encodeURIComponent(item.id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      setRenamingId(null);
      await fetchItems();
      _toast.success?.(`${itemLabel}已重命名`);
    } catch (err: any) {
      _toast.error?.(err.message || '重命名失败');
    } finally {
      setRenaming(false);
    }
  };

  const copyLink = async (item: ToolItem) => {
    if (!item.openUrl) return;
    const url = `${window.location.origin}${item.openUrl}`;
    try {
      await navigator.clipboard.writeText(url);
      _toast.success?.('链接已复制');
    } catch {
      _toast.error?.('复制失败');
    }
  };

  const download = async (item: ToolItem) => {
    try {
      const token = getToken();
      const headers = new Headers();
      if (token) headers.set('Authorization', `Bearer ${token}`);
      const res = await fetch(`/api/tools/${encodeURIComponent(item.id)}/download`, { headers });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(buildServerErrorMessage(body, res.status, '下载失败'));
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = item.fileName || item.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      _toast.error?.(err.message || '下载失败');
    }
  };

  const handleDroppedFiles = (files: File[]) => {
    const file = files[0];
    if (!file?.name.toLowerCase().endsWith('.html')) {
      _toast.warning?.(`${itemLabel}仅支持 .html 文件`);
      return;
    }
    setUploadFile(file);
    openUpload('create');
  };

  return (
    <FileDropZone className="h-full w-full" disabled={uploading} onFiles={handleDroppedFiles} message={`松开以上传 HTML ${itemLabel}`}>
    <div className="mobile-library-page square-ui flex min-h-full w-full flex-col gap-5 overflow-visible lg:h-full lg:overflow-hidden">
      <MobileLibrarySlice
        title={itemLabel}
        search={search}
        searchPlaceholder={`搜索${itemLabel}名称或分类`}
        filters={[
          { key: 'all', label: '全部', count: filteredItems.length },
          { key: 'active', label: '已启用', count: filteredItems.filter(item => item.status === 'active').length },
          { key: 'mine', label: '我管理的', count: filteredItems.filter(item => item.canManage).length },
        ]}
        activeFilter={mobileFilter}
        loading={loading}
        emptyText={search ? `没有匹配的${itemLabel}` : `还没有${itemLabel}`}
        onSearchChange={setSearch}
        onFilterChange={key => setMobileFilter(key as 'all' | 'active' | 'mine')}
        onCreate={() => openUpload('create')}
      >
        {mobileItems.map(item => (
          <MobileLibraryCard
            key={item.id}
            icon={Code2}
            title={item.name}
            description={item.description || '暂无说明'}
            status={statusText(item.status)}
            statusTone={item.status === 'active' ? 'green' : item.status === 'draft' ? 'amber' : 'gray'}
            meta={[item.category || '未分类', item.currentVersionLabel || '当前版本', formatDateTime(item.updatedAt)]}
            iconColor="#7758d7"
            iconBackground="#f1edff"
            onClick={() => { setSelectedId(item.id); setExpandedItem(item); }}
          />
        ))}
      </MobileLibrarySlice>
      <Header title={itemLabel} subtitle={isQuestionnaire ? '集中管理部门问卷、填写入口与预览内容。' : '集中管理和使用部门内部业务工具。'}>
        <button
          type="button"
          onClick={() => fetchItems()}
          disabled={loading}
          className="hidden"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          刷新
        </button>
        <button
          type="button"
          onClick={() => openUpload('create')}
          className="hidden"
        >
          <Upload size={16} />
          上传
        </button>
      </Header>

      <section className="grid min-h-0 flex-1 gap-5 overflow-visible lg:overflow-hidden xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="flex min-h-0 flex-col overflow-visible bg-white lg:overflow-hidden">
        <div className="flex shrink-0 flex-wrap items-center gap-2 px-5 py-4">
          <button type="button" onClick={() => openUpload('create')} className="hidden h-10 items-center justify-center gap-2 bg-slate-950 px-4 text-sm font-medium text-white shadow-sm hover:bg-slate-800 lg:inline-flex">
            <Upload size={17} />上传{itemLabel}
          </button>
          <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2">
            <div className="relative w-full min-w-0 max-w-72">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
              <input value={search} onChange={event => setSearch(event.target.value)} placeholder={`搜索${itemLabel}`} className="h-10 w-full border border-surface-200 bg-surface-50 pl-9 pr-9 text-sm text-surface-800 outline-none transition-colors placeholder:text-surface-400 focus:border-primary-400 focus:bg-white" />
              {search && <button type="button" onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-surface-400 hover:text-surface-700" aria-label="清空搜索"><X size={14} /></button>}
            </div>
            <button type="button" onClick={() => fetchItems()} disabled={loading} className="flex h-10 w-10 shrink-0 items-center justify-center border border-surface-200 bg-white text-surface-500 hover:bg-surface-50 hover:text-surface-900 disabled:opacity-50" title="刷新" aria-label={`刷新${itemLabel}`}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-visible px-4 pb-4 lg:overflow-auto lg:px-5">
          {loading && <div className="space-y-2 py-3">{Array.from({ length: 7 }).map((_, index) => <div key={index} className="h-14 animate-pulse bg-surface-100" />)}</div>}
          {!loading && filteredItems.length === 0 && <div className="flex h-full min-h-[360px] flex-col items-center justify-center text-center"><span className="mb-4 flex h-16 w-16 items-center justify-center bg-primary-50 text-primary-500"><Code2 size={26} /></span><div className="text-sm font-semibold text-surface-800">{search ? `没有匹配的${itemLabel}` : `还没有${itemLabel}`}</div><div className="mt-2 text-xs text-surface-400">{search ? '换个关键词试试。' : `上传第一个 HTML ${itemLabel}。`}</div></div>}
          {!loading && filteredItems.length > 0 && (
            <div className="min-w-0">
              <div className="grid h-11 grid-cols-[minmax(0,1fr)_88px_132px] items-center gap-3 px-3 text-xs font-medium text-surface-500"><span>{itemLabel}名</span><span>创建人</span><span>更新日期</span></div>
              {filteredItems.map(item => (
                <article key={item.id} onContextMenu={event => { event.preventDefault(); if (!item.canManage) return; setSelectedId(item.id); setContextMenu({ item, x: Math.max(8, Math.min(event.clientX, window.innerWidth - 184)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 96)) }); }} onClick={() => setSelectedId(item.id)} className={`group relative grid min-h-[56px] min-w-0 cursor-pointer grid-cols-[minmax(0,1fr)_88px_132px] items-center gap-3 rounded-lg px-3 text-sm transition-colors hover:bg-surface-100 ${selected?.id === item.id ? 'bg-surface-100' : ''}`}>
                  <div className="flex min-w-0 items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center text-primary-600"><Code2 size={25} /></span>{renamingId === item.id ? <input autoFocus disabled={renaming} value={renameValue} onClick={event => event.stopPropagation()} onChange={event => setRenameValue(event.target.value)} onKeyDown={event => { event.stopPropagation(); if (event.key === 'Enter') void saveRename(item); if (event.key === 'Escape') setRenamingId(null); }} onBlur={() => { if (!renaming) void saveRename(item); }} className="h-8 min-w-0 flex-1 border border-primary-300 bg-white px-2 text-sm text-surface-900 outline-none" /> : <div className="min-w-0 truncate font-medium text-surface-900">{item.name}</div>}</div>
                  <div className="truncate text-sm text-surface-400">{item.createdByName || item.uploadedByName || '未知'}</div><div className="truncate font-mono text-xs text-surface-400">{formatDateTime(item.updatedAt)}</div>
                </article>
              ))}
            </div>
          )}
        </div>
        {!loading && filteredItems.length > 0 && <div className="flex h-10 shrink-0 items-center justify-center text-xs text-surface-400">共 {filteredItems.length} 项</div>}
        </div>
        <aside className={`${selected ? 'fixed inset-0 z-[60] flex' : 'hidden'} relative min-h-0 flex-col overflow-hidden bg-white lg:static lg:flex`}>
          {selected && <button type="button" onClick={() => setSelectedId(null)} className="absolute right-3 top-3 z-20 flex h-10 w-10 items-center justify-center bg-white text-surface-500 shadow-sm lg:hidden" aria-label="返回列表"><X size={18} /></button>}
          {!selected ? (
            <div className="flex h-full min-h-[360px] flex-col items-center justify-center text-center"><span className="mb-4 flex h-16 w-16 items-center justify-center bg-primary-50 text-primary-500"><Code2 size={26} /></span><div className="text-sm font-semibold text-surface-800">选择一个{itemLabel}</div><div className="mt-2 text-xs text-surface-400">右侧将显示对应的 HTML {itemLabel}。</div></div>
          ) : (
            <><div className="flex h-16 shrink-0 items-center justify-between gap-5 border-b border-surface-100 px-5"><div className="min-w-0"><div className="truncate text-[13px] font-medium leading-5 text-surface-900">{selected.name}</div><div className="mt-1.5 flex min-w-0 items-center gap-2 text-[11px] leading-none text-surface-400"><span className="truncate">{selected.currentVersionLabel || '当前版本'}</span><span className="h-0.5 w-0.5 shrink-0 rounded-full bg-surface-300" /><span className="shrink-0 tracking-wide">HTML 预览</span></div></div><div className="flex shrink-0 items-center gap-1"><button type="button" onClick={() => download(selected)} className="p-2 text-surface-500 hover:text-primary-700" title="下载"><Download size={16} /></button>{selected.canManage && <button type="button" onClick={() => openUpload('version')} className="p-2 text-surface-500 hover:text-primary-700" title="更新"><Upload size={16} /></button>}{selected.openUrl && <button type="button" onClick={() => window.open(selected.openUrl, '_blank', 'noopener,noreferrer')} className="p-2 text-surface-500 hover:text-primary-700" title="新窗口打开"><ExternalLink size={16} /></button>}{selected.canManage && <button type="button" onClick={() => changeStatus(selected, 'deleted')} className="p-2 text-surface-500 hover:text-red-600" title="删除"><Trash2 size={16} /></button>}</div></div><div className="min-h-0 flex-1 overflow-hidden">{selected.openUrl && selected.status === 'active' ? <iframe key={selected.id} title={selected.name} src={selected.openUrl} sandbox="allow-scripts allow-forms allow-popups" className="h-full w-full bg-white" /> : <div className="flex h-full items-center justify-center px-6 text-center text-sm text-surface-400">该{itemLabel}当前未启用，无法加载 HTML 预览。</div>}</div></>
          )}
        </aside>
      </section>

      <section className="hidden min-h-0 flex-1 gap-5 overflow-hidden xl:grid-cols-[minmax(300px,.62fr)_minmax(680px,1.38fr)]">
        <div className="flex min-h-0 flex-col overflow-hidden border border-slate-200 bg-white">
          <div className="grid min-h-10 grid-cols-[minmax(0,1.45fr)_minmax(48px,.55fr)_minmax(58px,.7fr)_minmax(88px,.8fr)] items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-500">
            <div>名称</div>
            <div>分类</div>
            <div>上传者</div>
            <div>更新时间</div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {loading && (
              <div className="flex h-28 items-center justify-center text-sm text-slate-500">正在读取...</div>
            )}

            {!loading && filteredItems.length === 0 && (
              <div className="flex h-full min-h-[420px] flex-col items-center justify-center px-6 text-center text-sm text-slate-500">
                <Code2 size={30} className="mb-2 text-slate-300" />
                暂无内容
              </div>
            )}

            {!loading && filteredItems.map(item => (
              <article
                key={item.id}
                onClick={() => {
                  setSelectedId(item.id);
                  setExpandedItem(item);
                }}
                className={`grid min-h-[66px] min-w-0 cursor-pointer grid-cols-[minmax(0,1.45fr)_minmax(48px,.55fr)_minmax(58px,.7fr)_minmax(88px,.8fr)] items-center gap-2 overflow-hidden border-b border-slate-100 px-3 py-3 text-sm text-slate-600 last:border-b-0 hover:bg-slate-50 ${selected?.id === item.id ? 'app-selected-border relative z-10 bg-white' : ''}`}
              >
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center border border-slate-200 bg-slate-50 text-slate-600">
                      <Code2 size={15} />
                    </span>
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-slate-900">{item.name}</div>
                      <div className="mt-0.5 truncate text-xs text-slate-500">{item.description || item.fileName}</div>
                    </div>
                  </div>
                </div>
                <div className="truncate">{item.category || '未分类'}</div>
                <div className="truncate">{item.createdByName || item.uploadedByName || '未知'}</div>
                <div className="truncate font-mono text-xs">{formatDateTime(item.updatedAt)}</div>
                {expandedItem?.id === item.id && (
                  <div className="col-span-full min-w-0 overflow-hidden border-t border-slate-100 bg-slate-50 px-3 py-3 text-xs leading-5 text-slate-600">
                    <div className="grid min-w-0 gap-x-4 gap-y-2 sm:grid-cols-2">
                      <div className="min-w-0">版本：<span className="font-mono text-slate-900">{item.currentVersionLabel || '-'}</span></div>
                      <div className="min-w-0">大小：<span className="font-mono text-slate-900">{formatSize(item.fileSize)}</span></div>
                      <div className="min-w-0">文件：<span className="break-all font-mono text-slate-900">{item.fileName || '-'}</span></div>
                      <div className="min-w-0">更新：<span className="font-mono text-slate-900">{formatDateTime(item.updatedAt)}</span></div>
                      <div className="min-w-0 sm:col-span-2">说明：<span className="break-words text-slate-900">{item.changelog || item.description || '暂无说明'}</span></div>
                    </div>
                    <div className="mt-3 min-w-0 overflow-hidden border border-slate-200 bg-white">
                      <div className="border-b border-slate-100 px-2 py-1 font-semibold text-slate-500">版本记录</div>
                      {(item.versions || []).slice(0, 3).map(version => (
                        <div key={version.id} className="grid min-w-0 gap-2 border-b border-slate-100 px-2 py-1 last:border-b-0 sm:grid-cols-[64px_minmax(0,1fr)_72px]">
                          <span className="min-w-0 font-mono text-slate-900">{version.versionLabel}</span>
                          <span className="min-w-0 truncate">{version.changelog || version.fileName}</span>
                          <span className="min-w-0 text-right font-mono">{formatSize(version.fileSize)}</span>
                        </div>
                      ))}
                      {(!item.versions || item.versions.length === 0) && (
                        <div className="px-2 py-2 text-slate-500">暂无版本记录</div>
                      )}
                    </div>
                  </div>
                )}
              </article>
            ))}
          </div>
        </div>

        <aside className="flex min-h-0 flex-col overflow-hidden border border-slate-200 bg-white">
          {!selected ? (
            <div className="flex h-full min-h-[420px] items-center justify-center text-sm text-slate-500">请选择一项</div>
          ) : selected.type === 'html_tool' ? (
            <>
              <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center border border-slate-200 bg-slate-50 text-slate-600">
                    <Code2 size={14} />
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-900">{selected.name}</div>
                    <div className="truncate text-xs text-slate-500">{selected.currentVersionLabel || '当前版本'} · 右侧直接使用</div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button type="button" onClick={() => setRunnerOpen(true)} disabled={selected.status !== 'active'} className="inline-flex h-8 items-center gap-1.5 border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50" title="全屏使用">
                    <Maximize2 size={14} />
                    全屏
                  </button>
                  {selected.openUrl && (
                    <button type="button" onClick={() => copyLink(selected)} className="inline-flex h-8 items-center justify-center border border-slate-200 bg-white px-2 text-slate-700 hover:bg-slate-50" title="复制链接">
                      <Copy size={14} />
                    </button>
                  )}
                  {selected.openUrl && (
                    <button type="button" onClick={() => window.open(selected.openUrl, '_blank', 'noopener,noreferrer')} className="inline-flex h-8 items-center justify-center border border-slate-200 bg-white px-2 text-slate-700 hover:bg-slate-50" title="新窗口打开">
                      <ExternalLink size={14} />
                    </button>
                  )}
                  {selected.canManage && (
                    <button type="button" onClick={() => openUpload('version')} className="inline-flex h-8 items-center justify-center border border-primary-600 bg-primary-600 px-2 text-white hover:bg-primary-700" title="更新">
                      <Upload size={14} />
                    </button>
                  )}
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden bg-white">
                {selected.openUrl && selected.status === 'active' ? (
                  <iframe
                    key={selected.id}
                    title={selected.name}
                    src={selected.openUrl}
                    sandbox="allow-scripts allow-forms allow-popups"
                    className="h-full min-h-[680px] w-full bg-white"
                  />
                ) : (
                  <div className="flex h-full min-h-[420px] items-center justify-center px-6 text-center text-sm text-slate-500">
                    这个工具当前未启用，不能在右侧加载使用。
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="shrink-0 border-b border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-400">
                      {selected.type === 'html_tool' ? '工具运行区' : 'Skill 预览'}
                    </div>
                    <h2 className="mt-1 truncate text-lg font-semibold text-slate-900">{selected.name}</h2>
                    <p className="mt-1 line-clamp-1 text-sm text-slate-500">{selected.description || '暂无简介'}</p>
                  </div>
                  <span className={`shrink-0 border px-2 py-1 text-xs font-medium ${statusClass(selected.status)}`}>{statusText(selected.status)}</span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-500">
                  <div>版本：<span className="font-mono text-slate-800">{selected.currentVersionLabel || '-'}</span></div>
                  <div>大小：<span className="font-mono text-slate-800">{formatSize(selected.fileSize)}</span></div>
                  <div>分类：<span className="text-slate-800">{selected.category || '未分类'}</span></div>
                  <div>访问：<span className="font-mono text-slate-800">{selected.viewCount || 0}</span></div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {selected.type === 'html_tool' && selected.openUrl && (
                    <>
                      <button type="button" onClick={() => setRunnerOpen(true)} disabled={selected.status !== 'active'} className="inline-flex h-9 items-center gap-2 border border-slate-200 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
                        <Maximize2 size={15} />
                        全屏使用
                      </button>
                      <button type="button" onClick={() => copyLink(selected)} className="inline-flex h-9 items-center gap-2 border border-slate-200 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50">
                        <Copy size={15} />
                        复制链接
                      </button>
                      <button type="button" onClick={() => window.open(selected.openUrl, '_blank', 'noopener,noreferrer')} className="inline-flex h-9 items-center gap-2 border border-slate-200 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50">
                        <ExternalLink size={15} />
                        新窗口
                      </button>
                    </>
                  )}
                  <button type="button" onClick={() => download(selected)} className="inline-flex h-9 items-center gap-2 border border-slate-200 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50">
                    <Download size={15} />
                    离线下载
                  </button>
                  {selected.canManage && (
                    <>
                      <button type="button" onClick={() => openUpload('version')} className="inline-flex h-9 items-center gap-2 border border-primary-600 bg-primary-600 px-3 text-sm text-white hover:bg-primary-700">
                        <Upload size={15} />
                        更新
                      </button>
                      <button type="button" onClick={() => changeStatus(selected, selected.status === 'active' ? 'disabled' : 'active')} className="inline-flex h-9 items-center gap-2 border border-slate-200 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50">
                        <Power size={15} />
                        {selected.status === 'active' ? '下架' : '启用'}
                      </button>
                      <button type="button" onClick={() => changeStatus(selected, 'deleted')} className="inline-flex h-9 items-center gap-2 border border-slate-200 bg-white px-3 text-sm text-slate-500 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600">
                        <Trash2 size={15} />
                        删除
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-hidden bg-slate-50">
                {selected.type === 'html_tool' ? (
                  selected.openUrl && selected.status === 'active' ? (
                    <iframe
                      title={selected.name}
                      src={selected.openUrl}
                      sandbox="allow-scripts allow-forms allow-popups"
                      className="h-full min-h-[620px] w-full bg-white"
                    />
                  ) : (
                    <div className="flex h-full min-h-[420px] items-center justify-center px-6 text-center text-sm text-slate-500">
                      已下架或未启用的 HTML 工具不提供预览。
                    </div>
                  )
                ) : (
                  <pre className="h-full min-h-[520px] overflow-auto bg-slate-950 p-4 text-xs leading-5 text-slate-100">
                    工具中心当前仅显示 HTML 工具。
                  </pre>
                )}
              </div>
            </>
          )}
        </aside>
      </section>

      {runnerOpen && selected?.type === 'html_tool' && selected.openUrl && (
        <div className="fixed inset-0 z-[99998] flex flex-col bg-white">
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-slate-900">{selected.name}</div>
              <div className="truncate text-xs text-slate-500">{selected.currentVersionLabel || '当前版本'} · sandbox 隔离运行</div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => window.open(selected.openUrl, '_blank', 'noopener,noreferrer')}
                className="inline-flex h-9 items-center gap-2 border border-slate-200 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50"
              >
                <ExternalLink size={15} />
                新窗口
              </button>
              <button
                type="button"
                onClick={() => setRunnerOpen(false)}
                className="inline-flex h-9 items-center gap-2 border border-slate-200 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50"
              >
                <X size={15} />
                关闭
              </button>
            </div>
          </div>
          <iframe
            title={`${selected.name} 全屏使用`}
            src={selected.openUrl}
            sandbox="allow-scripts allow-forms allow-popups"
            className="min-h-0 flex-1 bg-white"
          />
        </div>
      )}

      {expandedItem && (
        <div className="mobile-library-detail-overlay fixed inset-0 z-[99999] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm">
          <div className="mobile-library-detail-panel flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden border border-slate-200 bg-white shadow-xl">
            <div className="mobile-library-detail-header flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 p-5">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-slate-400">工具详情</div>
                <h3 className="mt-1 truncate text-lg font-semibold text-slate-900">{expandedItem.name}</h3>
                <p className="mt-1 text-sm text-slate-500">{expandedItem.description || '暂无简介'}</p>
              </div>
              <button type="button" onClick={() => setExpandedItem(null)} className="p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                <X size={18} />
              </button>
            </div>

            <div className="mobile-library-detail-body min-h-0 flex-1 overflow-auto p-5">
              <div className="grid gap-3 text-sm sm:grid-cols-2">
                <div className="border border-slate-200 bg-slate-50 p-3">
                  <div className="text-xs font-semibold text-slate-400">分类</div>
                  <div className="mt-1 text-slate-900">{expandedItem.category || '未分类'}</div>
                </div>
                <div className="border border-slate-200 bg-slate-50 p-3">
                  <div className="text-xs font-semibold text-slate-400">状态</div>
                  <div className="mt-1"><span className={`inline-flex border px-2 py-1 text-xs font-medium ${statusClass(expandedItem.status)}`}>{statusText(expandedItem.status)}</span></div>
                </div>
                <div className="border border-slate-200 bg-slate-50 p-3">
                  <div className="text-xs font-semibold text-slate-400">当前版本</div>
                  <div className="mt-1 font-mono text-slate-900">{expandedItem.currentVersionLabel || '-'}</div>
                </div>
                <div className="border border-slate-200 bg-slate-50 p-3">
                  <div className="text-xs font-semibold text-slate-400">文件大小</div>
                  <div className="mt-1 font-mono text-slate-900">{formatSize(expandedItem.fileSize)}</div>
                </div>
                <div className="border border-slate-200 bg-slate-50 p-3">
                  <div className="text-xs font-semibold text-slate-400">上传者</div>
                  <div className="mt-1 text-slate-900">{expandedItem.createdByName || expandedItem.uploadedByName || '未知'}</div>
                </div>
                <div className="border border-slate-200 bg-slate-50 p-3">
                  <div className="text-xs font-semibold text-slate-400">更新时间</div>
                  <div className="mt-1 font-mono text-slate-900">{formatDateTime(expandedItem.updatedAt)}</div>
                </div>
              </div>

              <div className="mt-4 border border-slate-200">
                <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500">版本记录</div>
                <div className="divide-y divide-slate-100">
                  {(expandedItem.versions || []).map(version => (
                    <div key={version.id} className="grid gap-2 px-3 py-2 text-sm text-slate-600 sm:grid-cols-[80px_1fr_120px_150px]">
                      <div className="font-mono text-slate-900">{version.versionLabel}</div>
                      <div className="truncate">{version.changelog || version.fileName}</div>
                      <div className="font-mono text-xs">{formatSize(version.fileSize)}</div>
                      <div className="font-mono text-xs">{formatDateTime(version.uploadedAt)}</div>
                    </div>
                  ))}
                  {(!expandedItem.versions || expandedItem.versions.length === 0) && (
                    <div className="px-3 py-5 text-center text-sm text-slate-500">暂无版本记录</div>
                  )}
                </div>
              </div>
            </div>

            <div className="mobile-library-detail-actions flex shrink-0 flex-wrap justify-end gap-2 border-t border-slate-200 p-4">
              {expandedItem.openUrl && (
                <button type="button" onClick={() => copyLink(expandedItem)} className="inline-flex h-9 items-center gap-2 border border-slate-200 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50">
                  <Copy size={15} />
                  复制链接
                </button>
              )}
              <button type="button" onClick={() => download(expandedItem)} className="inline-flex h-9 items-center gap-2 border border-slate-200 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50">
                <Download size={15} />
                离线下载
              </button>
              {expandedItem.openUrl && (
                <button type="button" onClick={() => window.open(expandedItem.openUrl, '_blank', 'noopener,noreferrer')} className="inline-flex h-9 items-center gap-2 border border-slate-200 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50">
                  <ExternalLink size={15} />
                  新窗口
                </button>
              )}
              {expandedItem.canManage && (
                <button type="button" onClick={() => { setSelectedId(expandedItem.id); setExpandedItem(null); openUpload('version'); }} className="inline-flex h-9 items-center gap-2 border border-primary-600 bg-primary-600 px-3 text-sm text-white hover:bg-primary-700">
                  <Upload size={15} />
                  更新
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <AppModal
        open={uploadOpen}
        onClose={() => { if (!uploading) closeUpload(); }}
        closeOnOverlay={!uploading}
        title={uploadMode === 'create' ? `上传${itemLabel}` : `更新${itemLabel}版本`}
        subtitle={`${itemLabel}支持单个 .html 文件。`}
        icon={<Upload size={18} />}
        size="sm"
        backdrop="dim"
        panelClassName="!max-w-lg"
        footer={<>
          <button type="button" disabled={uploading} onClick={closeUpload} className="h-10 border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">取消</button>
          <button type="submit" form="tool-upload-form" disabled={uploading} className="h-10 border border-primary-600 bg-primary-600 px-4 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60">{uploading ? '处理中...' : '提交'}</button>
        </>}
      >
          <form id="tool-upload-form" onSubmit={submitUpload} className="space-y-3">
              {uploadMode === 'create' && (
                <>
                  <label className="block">
                    <span className="mb-1 block text-sm font-medium text-slate-700">名称</span>
                    <input name="name" required className="h-10 w-full border border-slate-200 px-3 text-sm outline-none focus:border-slate-400" />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-sm font-medium text-slate-700">简介</span>
                    <textarea name="description" rows={3} className="w-full resize-none border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400" />
                  </label>
                  {!isQuestionnaire && (
                    <label className="block">
                      <span className="mb-1 block text-sm font-medium text-slate-700">分类</span>
                      <input name="category" placeholder="例如：测算、报表、提示词" className="h-10 w-full border border-slate-200 px-3 text-sm outline-none focus:border-slate-400" />
                    </label>
                  )}
                </>
              )}
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-700">文件</span>
                <input
                  ref={fileInputRef}
                  name="file"
                  type="file"
                  accept=".html,text/html"
                  onChange={event => setUploadFile(event.target.files?.[0] || null)}
                  className="block w-full border border-slate-200 bg-white text-sm text-slate-700 file:mr-3 file:h-10 file:border-0 file:bg-slate-100 file:px-3 file:text-sm file:font-medium file:text-slate-700"
                />
                {uploadFile && <span className="mt-1 block truncate text-xs text-slate-500">已选择：{uploadFile.name}</span>}
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-700">更新说明</span>
                <textarea name="changelog" rows={3} placeholder="这次上传或更新了什么" className="w-full resize-none border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400" />
              </label>
          </form>
      </AppModal>

      {contextMenu && <ContextMenu x={contextMenu.x} y={contextMenu.y} width={176} onClose={() => setContextMenu(null)} items={[
        { key: 'rename', label: '重命名', icon: <Pencil size={14} />, onSelect: () => beginRename(contextMenu.item) },
        { key: 'delete', label: '删除', icon: <Trash2 size={14} />, danger: true, separatorBefore: true, onSelect: () => void changeStatus(contextMenu.item, 'deleted') },
      ]} />}
      {ConfirmDialog}
    </div>
    </FileDropZone>
  );
}
