import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, DatabaseBackup, Download, HardDrive, Loader2, RefreshCw, RotateCcw, Star } from 'lucide-react';
import Header from '../components/Layout/Header';
import LoadingSpinner from '../components/LoadingSpinner';
import { useConfirm } from '../components/Toast';
import { api } from '../lib/api';
import { _toast } from '../store/toastRef';

interface BackupItem {
  name: string;
  dataDate: string;
  size: number;
  createdAt: string;
  starred: boolean;
}

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function Backups() {
  const [backups, setBackups] = useState<BackupItem[]>([]);
  const [maxBackups, setMaxBackups] = useState(7);
  const [maxBackupOptions, setMaxBackupOptions] = useState<number[]>([0, 3, 7, 14, 30]);
  const [savingSettings, setSavingSettings] = useState(false);
  const [schedule, setSchedule] = useState('00:00');
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState('');
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [applying, setApplying] = useState('');
  const [creating, setCreating] = useState(false);
  const [starring, setStarring] = useState('');
  const { confirm: ask, ConfirmDialog } = useConfirm();

  const loadBackups = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<{ backups: BackupItem[]; maxBackups: number; maxBackupOptions: number[]; schedule: string }>('/backups');
      setBackups(result.backups);
      setMaxBackups(result.maxBackups);
      setMaxBackupOptions(result.maxBackupOptions || [0, 3, 7, 14, 30]);
      setSchedule(result.schedule);
    } catch (error: unknown) {
      _toast.error?.(errorMessage(error, '获取备份列表失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadBackups(); }, [loadBackups]);

  const createBackup = async () => {
    setCreating(true);
    try {
      await api.post('/backups/create', {});
      await loadBackups();
      _toast.success?.('项目进度与管理周报已备份');
    } catch (error: unknown) {
      _toast.error?.(errorMessage(error, '创建数据备份失败'));
    } finally {
      setCreating(false);
    }
  };

  const changeMaxBackups = async (value: number) => {
    setSavingSettings(true);
    try {
      const result = await api.put<{ maxBackups: number }>('/backups/settings', { maxBackups: value });
      setMaxBackups(result.maxBackups);
      await loadBackups();
      _toast.success?.(result.maxBackups === 0 ? '自动备份已关闭，已有备份继续保留' : `备份保留上限已改为 ${result.maxBackups} 天`);
    } catch (error: unknown) {
      _toast.error?.(errorMessage(error, '保存备份设置失败'));
    } finally {
      setSavingSettings(false);
    }
  };

  const downloadBackup = async (backup: BackupItem) => {
    setDownloading(backup.name);
    setDownloadProgress(null);
    try {
      const token = localStorage.getItem('auth_token');
      const response = await fetch(`/api/backups/${encodeURIComponent(backup.name)}/download`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `下载备份失败 (${response.status})`);
      }

      const totalBytes = Number(response.headers.get('Content-Length')) || backup.size || 0;
      let blob: Blob;
      if (response.body) {
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let receivedBytes = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          receivedBytes += value.byteLength;
          if (totalBytes > 0) {
            setDownloadProgress(Math.min(99, Math.round((receivedBytes / totalBytes) * 100)));
          }
        }
        blob = new Blob(chunks, { type: response.headers.get('Content-Type') || 'application/octet-stream' });
      } else {
        blob = await response.blob();
      }

      setDownloadProgress(100);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = backup.name;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      _toast.success?.('备份已准备完成，浏览器正在保存文件');
    } catch (error: unknown) {
      _toast.error?.(errorMessage(error, '下载备份失败'));
    } finally {
      setDownloading('');
      setDownloadProgress(null);
    }
  };

  const applyBackup = async (backup: BackupItem) => {
    const label = backup.dataDate || backup.name;
    const confirmed = await ask(`确定应用 ${label} 的数据备份吗？当前项目进度、管理周报及周报历史将被覆盖；账号、权限、邮箱、任务中心和系统密钥不会改变。完成后页面将重新加载。`);
    if (!confirmed) return;
    setApplying(backup.name);
    try {
      await api.post(`/backups/${encodeURIComponent(backup.name)}/apply`, {});
      _toast.success?.('备份应用成功，正在重新加载数据');
      window.setTimeout(() => window.location.reload(), 800);
    } catch (error: unknown) {
      _toast.error?.(errorMessage(error, '应用备份失败'));
      setApplying('');
    }
  };

  const toggleStar = async (backup: BackupItem) => {
    setStarring(backup.name);
    try {
      const result = await api.put<{ starred: boolean }>(
        `/backups/${encodeURIComponent(backup.name)}/star`,
        { starred: !backup.starred },
      );
      await loadBackups();
      _toast.success?.(result.starred ? '已星标，自动清理将跳过此备份' : '已取消星标');
    } catch (error: unknown) {
      _toast.error?.(errorMessage(error, '星标设置失败'));
    } finally {
      setStarring('');
    }
  };

  return (
    <div className="square-ui flex min-h-full min-w-0 w-full flex-col gap-5 overflow-visible lg:h-full lg:min-h-0 lg:overflow-hidden">
      <Header title="数据备份" subtitle={maxBackups === 0 ? '管理项目与周报数据备份，当前自动备份已关闭。' : '按照当前计划自动备份项目与周报数据，并依据保留策略定期清理。'} eyebrow="后端服务">
        <label className="inline-flex h-9 items-center gap-2 border border-slate-200 bg-white px-3 text-sm text-slate-600">
          <span>保留</span>
          <select value={maxBackups} onChange={event => changeMaxBackups(Number(event.target.value))} disabled={savingSettings || loading} className="bg-transparent font-medium text-slate-900 outline-none disabled:opacity-50">
            {maxBackupOptions.map(option => <option key={option} value={option}>{option === 0 ? '不备份' : `${option} 天`}</option>)}
          </select>
        </label>
        <button type="button" onClick={createBackup} disabled={creating || loading} className="inline-flex h-9 items-center gap-2 border border-primary-700 bg-primary-700 px-3 text-sm font-medium text-white hover:bg-primary-800 disabled:opacity-50">
          {creating ? <Loader2 size={15} className="animate-spin" /> : <DatabaseBackup size={15} />}{creating ? '备份中' : '立即备份'}
        </button>
        <button type="button" onClick={loadBackups} disabled={loading} className="inline-flex h-9 items-center gap-2 border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />刷新
        </button>
      </Header>

      <section className="grid shrink-0 gap-4 sm:grid-cols-3 lg:gap-5">
        <div className="bg-white p-4"><CalendarClock size={18} className="text-primary-600" /><div className="mt-3 text-xs text-slate-500">执行时间</div><div className="mt-1 text-lg font-semibold text-slate-900">{maxBackups === 0 ? '已关闭' : `每日 ${schedule}`}</div></div>
        <div className="bg-white p-4"><DatabaseBackup size={18} className="text-primary-600" /><div className="mt-3 text-xs text-slate-500">现有备份</div><div className="mt-1 text-lg font-semibold text-slate-900">{backups.length} 份</div></div>
        <div className="bg-white p-4"><HardDrive size={18} className="text-primary-600" /><div className="mt-3 text-xs text-slate-500">保留上限</div><div className="mt-1 text-lg font-semibold text-slate-900">{maxBackups === 0 ? '不备份' : `${maxBackups} 天`}</div></div>
      </section>

      <section className="min-h-0 min-w-0 flex-1 overflow-x-auto bg-white lg:flex lg:flex-col lg:overflow-hidden">
        <div className="grid min-w-[690px] shrink-0 grid-cols-[40px_minmax(120px,1fr)_minmax(160px,1fr)_120px_170px] border-b border-slate-100 bg-white px-4 py-3 text-xs font-medium text-slate-500 lg:min-w-0">
          <span>保留</span><span>文件名</span><span>备份时间</span><span>文件大小</span><span className="text-right">操作</span>
        </div>
        <div className="min-h-0 min-w-[690px] flex-1 overflow-y-visible lg:min-w-0 lg:overflow-y-auto">
          {loading ? <LoadingSpinner message="正在读取备份..." /> : backups.length === 0 ? (
            <div className="px-4 py-14 text-center text-sm text-slate-500">暂无数据备份，可立即备份或等待下一个 00:00 自动生成。</div>
          ) : backups.map(backup => (
          <div key={backup.name} className="group grid min-h-14 grid-cols-[40px_minmax(120px,1fr)_minmax(160px,1fr)_120px_170px] items-center border-b border-slate-100 px-4 py-2.5 text-sm transition-colors last:border-b-0 hover:bg-slate-50/50">
            <button
              type="button"
              onClick={() => toggleStar(backup)}
              disabled={starring === backup.name}
              className={`inline-flex h-8 w-8 items-center justify-center disabled:opacity-50 ${
                backup.starred ? 'text-amber-500' : 'text-slate-300 hover:text-amber-500'
              }`}
              title={backup.starred ? '取消星标，重新参与自动清理' : '星标并长期保留'}
              aria-label={backup.starred ? '取消星标' : '添加星标'}
            >
              <Star size={17} fill={backup.starred ? 'currentColor' : 'none'} />
            </button>
            <span className="truncate font-mono font-medium text-slate-800" title={backup.name}>{backup.name.replace(/\.ibd-business\.json$/i, '')}</span>
            <span className="text-slate-500">{new Date(backup.createdAt).toLocaleString('zh-CN')}</span>
            <span className="text-slate-500">{formatSize(backup.size)}</span>
            <span className="ml-auto flex items-center justify-end gap-1">
              <button type="button" onClick={() => downloadBackup(backup)} disabled={Boolean(applying) || Boolean(downloading)} className="inline-flex h-8 min-w-[64px] items-center justify-center gap-1.5 px-2 text-slate-500 transition-colors hover:text-primary-700 disabled:opacity-70">
                {downloading === backup.name ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                {downloading === backup.name
                  ? downloadProgress === null ? '准备中' : downloadProgress >= 100 ? '保存中' : `${downloadProgress}%`
                  : '下载'}
              </button>
              <button type="button" onClick={() => applyBackup(backup)} disabled={Boolean(applying) || Boolean(downloading)} className="inline-flex h-8 items-center gap-1.5 px-2 text-slate-500 transition-colors hover:text-red-600 disabled:opacity-50">
                <RotateCcw size={14} className={applying === backup.name ? 'animate-spin' : ''} />应用覆盖
              </button>
            </span>
          </div>
          ))}
        </div>
      </section>
      {ConfirmDialog}
    </div>
  );
}
