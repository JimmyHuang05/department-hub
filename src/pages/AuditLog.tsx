import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, FileClock, History, RefreshCw, RotateCcw, Search, X } from 'lucide-react';
import Header from '../components/Layout/Header';
import ContextMenu from '../components/Layout/ContextMenu';
import LoadingSpinner from '../components/LoadingSpinner';
import { useConfirm } from '../components/Toast';
import { api } from '../lib/api';
import { useMobileViewport } from '../hooks/useMobileViewport';
import { _toast } from '../store/toastRef';

interface AuditEntry {
  id: string;
  user_id: string;
  user_name: string;
  action: string;
  target_type: string;
  target_id: string;
  detail: string;
  created_at: string;
  field?: string;
  old_value?: string;
  new_value?: string;
  source?: 'audit_log' | 'edit_history' | string;
  can_undo?: boolean;
  undone_at?: string;
  undone_by?: string;
}

const DELETE_ACTIONS = new Set([
  'product.delete', 'product.batch-delete', 'entry.delete', 'entry.batch-delete', 'user.delete',
  'clouddrive.trash', 'clouddrive.permanent', 'notification.archive', 'task.comment.delete', 'task.delete',
]);

const ACTION_LABELS: Record<string, string> = {
  'auth.login': '登录系统',
  'auth.logout': '退出系统',
  'product.create': '新增项目',
  'product.update': '更新项目',
  'product.delete': '删除项目',
  'product.batch-delete': '批量删除项目',
  'product.import': '导入项目',
  'entry.create': '新增周报',
  'entry.update': '更新周报',
  'entry.delete': '删除周报',
  'entry.batch-delete': '批量删除周报',
  'entry.import': '导入周报',
  'user.register': '新增人员',
  'user.update': '更新人员',
  'user.delete': '删除人员',
  'clouddrive.upload': '上传云盘文件',
  'clouddrive.trash': '移入回收站',
  'clouddrive.restore': '恢复云盘文件',
  'clouddrive.permanent': '彻底删除文件',
  'clouddrive.remark': '更新文件备注',
  'clouddrive.rename': '重命名云盘文件',
};

const TABLE_COLUMNS = 'minmax(120px,.75fr) minmax(130px,.75fr) minmax(150px,.9fr) minmax(0,1.7fr) minmax(140px,.8fr)';

type RiskLevel = 'danger' | 'sensitive' | 'normal';
type RiskFilter = 'all' | RiskLevel;
type FilterField = 'person' | 'action' | 'time' | 'detail' | 'target';

const DANGER_ACTIONS = new Set([
  'product.delete',
  'product.batch-delete',
  'product.import',
  'entry.delete',
  'entry.batch-delete',
  'entry.import',
  'user.delete',
  'clouddrive.trash',
  'clouddrive.permanent',
]);

const SENSITIVE_ACTIONS = new Set([
  'product.update',
  'entry.update',
  'user.register',
  'user.update',
  'clouddrive.upload',
  'clouddrive.restore',
  'clouddrive.remark',
  'clouddrive.rename',
]);

const RISK_FILTERS: { key: RiskFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'danger', label: '危险' },
  { key: 'sensitive', label: '敏感' },
  { key: 'normal', label: '普通' },
];

const FILTER_FIELDS: { key: FilterField; label: string }[] = [
  { key: 'person', label: '人物' },
  { key: 'action', label: '操作' },
  { key: 'time', label: '时间' },
  { key: 'detail', label: '说明' },
  { key: 'target', label: '对象' },
];

function formatTime(value: string, withSeconds = false) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: withSeconds ? '2-digit' : undefined,
  });
}

function actionLabel(action: string) {
  return ACTION_LABELS[action] || action || '未知操作';
}

function riskLevel(log: AuditEntry): RiskLevel {
  if (DANGER_ACTIONS.has(log.action)) return 'danger';
  if (SENSITIVE_ACTIONS.has(log.action)) return 'sensitive';
  if (log.source === 'edit_history' || log.field) return 'sensitive';
  return 'normal';
}

function riskMeta(level: RiskLevel) {
  if (level === 'danger') {
    return {
      label: '危险',
      rowClassName: 'bg-red-50/80 hover:bg-red-100/70',
      headerClassName: 'border-red-200 bg-red-50',
      iconClassName: 'border-red-200 bg-white text-red-700',
      titleClassName: 'text-red-950',
      mutedClassName: 'text-red-700/70',
    };
  }
  if (level === 'sensitive') {
    return {
      label: '敏感',
      rowClassName: 'bg-amber-50/80 hover:bg-amber-100/70',
      headerClassName: 'border-amber-200 bg-amber-50',
      iconClassName: 'border-amber-200 bg-white text-amber-700',
      titleClassName: 'text-amber-950',
      mutedClassName: 'text-amber-700/70',
    };
  }
  return {
    label: '普通',
    rowClassName: 'hover:bg-slate-50',
    headerClassName: 'border-slate-200 bg-slate-50',
    iconClassName: 'border-slate-200 bg-white text-slate-500',
    titleClassName: 'text-slate-950',
    mutedClassName: 'text-slate-500',
  };
}

function columnValues(log: AuditEntry, field: Exclude<FilterField, 'time'>) {
  const fieldValues: Record<Exclude<FilterField, 'time'>, Array<string | undefined>> = {
    person: [log.user_name, log.user_id],
    action: [actionLabel(log.action), log.action, riskMeta(riskLevel(log)).label],
    detail: [log.detail, log.field, log.old_value, log.new_value, log.source],
    target: [log.target_type, log.target_id],
  };
  return fieldValues[field].filter(Boolean) as string[];
}

function targetGroupLabel(log: AuditEntry) {
  if (log.action.startsWith('product.') || log.target_type === 'product') return '项目进度';
  if (log.action.startsWith('entry.') || log.target_type === 'entry') return '管理周报';
  if (log.action.startsWith('user.') || log.target_type === 'user') return '人员管理';
  if (log.action.startsWith('clouddrive.') || log.target_type === 'clouddrive') return '云盘';
  if (log.action.startsWith('auth.')) return '账号';
  return log.target_type || '其他';
}

function actionGroupLabel(action: string) {
  const suffix = action.split('.').pop() || action;
  const labels: Record<string, string> = {
    login: '登录',
    logout: '退出',
    create: '新增',
    update: '更新',
    delete: '删除',
    'batch-delete': '批量删除',
    import: '导入覆盖',
    register: '新增',
    upload: '上传',
    trash: '移入回收站',
    restore: '恢复',
    permanent: '彻底删除',
    remark: '更新备注',
  };
  return labels[suffix] || actionLabel(action);
}

function detailFilterLabel(log: AuditEntry) {
  return `${actionGroupLabel(log.action)}（${targetGroupLabel(log)}）`;
}

function searchValues(log: AuditEntry) {
  return [
    log.id,
    ...columnValues(log, 'person'),
    ...columnValues(log, 'action'),
    formatTime(log.created_at),
    formatTime(log.created_at, true),
    log.created_at,
    ...columnValues(log, 'detail'),
    ...columnValues(log, 'target'),
  ];
}

function primaryColumnValue(log: AuditEntry, field: Exclude<FilterField, 'time'>) {
  if (field === 'person') return log.user_name || log.user_id || '-';
  if (field === 'action') return actionLabel(log.action);
  if (field === 'detail') return detailFilterLabel(log);
  return log.target_type ? `${log.target_type}${log.target_id ? ` · ${log.target_id.slice(0, 8)}` : ''}` : '-';
}

function valueText(value: unknown) {
  if (value === undefined || value === null || value === '') return '-';
  return String(value);
}

function DetailLine({ label, value, mono = false }: { label: string; value: unknown; mono?: boolean }) {
  const multiline = ['detail', 'old_value', 'new_value'].includes(label);
  return (
    <div className="grid min-w-0 grid-cols-[132px_minmax(0,1fr)] gap-x-5 border-b border-slate-100 py-3 last:border-b-0">
      <div className="truncate pt-0.5 text-xs font-medium text-slate-400" title={label}>{label}</div>
      <div className={`${multiline ? 'whitespace-pre-wrap break-words leading-6' : 'break-words'} min-w-0 text-[13px] leading-6 text-slate-700 ${mono ? 'font-mono text-[12px] tracking-[0.01em]' : ''}`}>
        {valueText(value)}
      </div>
    </div>
  );
}

export default function AuditLog() {
  const isMobileViewport = useMobileViewport();
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [riskFilter, setRiskFilter] = useState<RiskFilter>('all');
  const [openFilter, setOpenFilter] = useState<FilterField | null>(null);
  const [columnFilters, setColumnFilters] = useState<Record<Exclude<FilterField, 'time'>, string[]>>({
    person: [],
    action: [],
    detail: [],
    target: [],
  });
  const [timeFilter, setTimeFilter] = useState({ start: '', end: '' });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ log: AuditEntry; x: number; y: number } | null>(null);
  const [undoingId, setUndoingId] = useState('');
  const { confirm: ask, ConfirmDialog } = useConfirm();

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const res = await api.get<AuditEntry[]>('/audit?limit=500');
      const nextLogs = Array.isArray(res) ? res : [];
      setLogs(nextLogs);
      setSelectedId(prev => prev && nextLogs.some(log => log.id === prev) ? prev : nextLogs[0]?.id || null);
    } catch {
      setLogs([]);
      setSelectedId(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const undoDelete = async (log: AuditEntry) => {
    if (!log.can_undo || undoingId) return;
    const confirmed = await ask({
      title: '撤回删除',
      message: `确定恢复“${log.detail || actionLabel(log.action)}”吗？恢复时不会覆盖当前已有数据。`,
      confirmText: '确认恢复',
    });
    if (!confirmed) return;
    setUndoingId(log.id);
    try {
      await api.post(`/audit/${log.id}/undo`, {});
      _toast.success?.('删除已撤回');
      await fetchLogs();
    } catch (error) {
      _toast.error?.(error instanceof Error ? error.message : '撤回删除失败');
    } finally {
      setUndoingId('');
    }
  };

  const filteredLogs = useMemo(() => {
    const query = search.trim().toLowerCase();
    return logs.filter(log => {
      if (riskFilter !== 'all' && riskLevel(log) !== riskFilter) return false;
      if (columnFilters.person.length && !columnFilters.person.includes(primaryColumnValue(log, 'person'))) return false;
      if (columnFilters.action.length && !columnFilters.action.includes(primaryColumnValue(log, 'action'))) return false;
      if (columnFilters.detail.length && !columnFilters.detail.includes(primaryColumnValue(log, 'detail'))) return false;
      if (columnFilters.target.length && !columnFilters.target.includes(primaryColumnValue(log, 'target'))) return false;
      const logTime = new Date(log.created_at).getTime();
      if (timeFilter.start && (!Number.isFinite(logTime) || logTime < new Date(timeFilter.start).getTime())) return false;
      if (timeFilter.end && (!Number.isFinite(logTime) || logTime > new Date(timeFilter.end).getTime())) return false;
      if (!query) return true;
      return searchValues(log).some(value => (value || '').toLowerCase().includes(query));
    });
  }, [columnFilters, logs, riskFilter, search, timeFilter]);

  const selectedLog = useMemo(() => {
    if (!filteredLogs.length) return null;
    return filteredLogs.find(log => log.id === selectedId) || (isMobileViewport ? undefined : filteredLogs[0]);
  }, [filteredLogs, isMobileViewport, selectedId]);

  const riskCounts = useMemo(() => ({
    danger: logs.filter(log => riskLevel(log) === 'danger').length,
    sensitive: logs.filter(log => riskLevel(log) === 'sensitive').length,
    normal: logs.filter(log => riskLevel(log) === 'normal').length,
  }), [logs]);

  const filterOptions = useMemo(() => {
    const build = (field: Exclude<FilterField, 'time'>) => Array.from(new Set(logs.map(log => primaryColumnValue(log, field))))
      .sort((a, b) => a.localeCompare(b, 'zh-CN'));
    return {
      person: build('person'),
      action: build('action'),
      detail: build('detail'),
      target: build('target'),
      time: [],
    };
  }, [logs]);

  const toggleColumnFilter = (field: FilterField, value: string) => {
    if (field === 'time') return;
    setColumnFilters(prev => {
      const exists = prev[field].includes(value);
      return {
        ...prev,
        [field]: exists ? prev[field].filter(item => item !== value) : [...prev[field], value],
      };
    });
  };

  const clearColumnFilter = (field: FilterField) => {
    if (field === 'time') return;
    setColumnFilters(prev => ({ ...prev, [field]: [] }));
  };

  const columnFilterCount = (field: FilterField) => {
    if (field === 'time') return Number(Boolean(timeFilter.start)) + Number(Boolean(timeFilter.end));
    return columnFilters[field].length;
  };

  const columnFilterValues = (field: FilterField) => field === 'time' ? [] : columnFilters[field];

  const selectedParams = (selectedLog ? [
    ['id', selectedLog.id],
    ['source', selectedLog.source],
    ['user_id', selectedLog.user_id],
    ['user_name', selectedLog.user_name],
    ['action', selectedLog.action],
    ['action_label', actionLabel(selectedLog.action)],
    ['risk_level', riskMeta(riskLevel(selectedLog)).label],
    ['target_type', selectedLog.target_type],
    ['target_id', selectedLog.target_id],
    ['detail', selectedLog.detail],
    ['created_at', selectedLog.created_at],
    ['created_at_formatted', formatTime(selectedLog.created_at, true)],
    ['field', selectedLog.field],
    ['old_value', selectedLog.old_value],
    ['new_value', selectedLog.new_value],
  ] : []).filter(([, value]) => value !== undefined && value !== null && value !== '');

  return (
    <div className="square-ui flex min-h-full w-full flex-col gap-5 overflow-visible lg:h-full lg:overflow-hidden">
      <Header title="操作日志" subtitle="集中查看关键操作、执行人员与发生时间。">
        <button
          type="button"
          onClick={fetchLogs}
          className="inline-flex h-10 items-center justify-center gap-2 border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          刷新
        </button>
      </Header>

      <section
        className="grid min-h-0 flex-1 grid-cols-1 gap-5 overflow-visible lg:overflow-hidden"
        style={isMobileViewport ? undefined : { gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)' }}
      >
        <div className="flex min-h-0 flex-col overflow-visible bg-white lg:overflow-hidden">
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-white p-3">
            <div className="relative w-full min-w-0 sm:w-[260px] sm:flex-none">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="搜索日志"
                className="block h-10 w-full border border-slate-200 bg-white pl-9 pr-9 text-sm text-slate-700 outline-none transition-colors placeholder:text-slate-400 focus:border-slate-300 focus:ring-2 focus:ring-slate-100"
              />
              {search && (
                <button type="button" onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600" aria-label="清空搜索">
                  <X size={14} />
                </button>
              )}
            </div>

            <div className="flex w-full min-w-0 items-center gap-1 overflow-x-auto sm:ml-auto sm:w-auto">
              {RISK_FILTERS.map(filter => {
                const active = riskFilter === filter.key;
                const count = filter.key === 'all' ? logs.length : riskCounts[filter.key];
                const countColor = filter.key === 'danger'
                  ? 'text-red-600'
                  : filter.key === 'sensitive'
                    ? 'text-amber-600'
                    : 'text-slate-700';
                return (
                  <button
                    key={filter.key}
                    type="button"
                    onClick={() => setRiskFilter(filter.key)}
                    className={`group flex h-8 items-center gap-1.5 px-2.5 text-xs font-medium transition-colors ${active ? 'bg-primary-600 text-white' : 'text-slate-500 hover:text-slate-900'}`}
                  >
                    <span>{filter.label}</span>
                    <span className={`min-w-4 text-center font-semibold tabular-nums ${active ? 'text-white/90' : countColor}`}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-visible lg:overflow-y-auto">
          {loading ? (
            <LoadingSpinner fullPage message="加载操作日志..." />
          ) : filteredLogs.length === 0 ? (
            <div className="flex h-full min-h-[420px] flex-col items-center justify-center bg-white text-slate-400">
              <History size={34} className="mb-3 text-slate-300" />
              <div className="text-sm">暂无操作日志</div>
            </div>
          ) : (
            <>
              <div
                className="sticky top-0 z-40 hidden min-h-10 items-center gap-3 bg-white px-4 text-xs font-semibold text-slate-500 lg:grid"
                style={{ gridTemplateColumns: TABLE_COLUMNS }}
              >
                {FILTER_FIELDS.map(field => {
                  const active = openFilter === field.key;
                  const count = columnFilterCount(field.key);
                  return (
                    <div key={field.key} className="relative flex h-10 items-center">
                      <button
                        type="button"
                        onClick={() => setOpenFilter(active ? null : field.key)}
                        className={`inline-flex h-8 items-center gap-1 text-left text-xs font-semibold transition-colors ${
                          count ? 'text-primary-700' : 'text-slate-500 hover:text-slate-800'
                        }`}
                        title={`筛选${field.label}`}
                      >
                        <span>{field.label}</span>
                        {count > 0 && <span className="text-[10px] tabular-nums">({count})</span>}
                        <ChevronDown size={13} className={active ? 'rotate-180 transition-transform' : 'transition-transform'} />
                      </button>

                      {active && field.key !== 'time' && (
                        <div className="absolute left-0 top-9 z-50 w-64 border border-slate-200 bg-white p-3 text-slate-700 shadow-xl shadow-slate-900/10">
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <div className="text-xs font-semibold text-slate-900">筛选{field.label}</div>
                            <button type="button" onClick={() => clearColumnFilter(field.key)} className="text-xs text-slate-500 hover:text-primary-700">清除</button>
                          </div>
                          <div className="max-h-64 overflow-y-auto">
                            {filterOptions[field.key].map(option => (
                              <label key={option} className="flex min-h-8 cursor-pointer items-center gap-2 px-1 text-xs hover:bg-slate-50">
                                <input
                                  type="checkbox"
                                  checked={columnFilterValues(field.key).includes(option)}
                                  onChange={() => toggleColumnFilter(field.key, option)}
                                  className="h-3.5 w-3.5 rounded border-slate-300 text-primary-600 focus:ring-primary-600/20"
                                />
                                <span className="min-w-0 flex-1 truncate" title={option}>{option}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}

                      {active && field.key === 'time' && (
                        <div className="absolute left-0 top-9 z-50 w-72 border border-slate-200 bg-white p-3 text-slate-700 shadow-xl shadow-slate-900/10">
                          <div className="mb-3 flex items-center justify-between gap-2">
                            <div className="text-xs font-semibold text-slate-900">筛选时间</div>
                            <button type="button" onClick={() => setTimeFilter({ start: '', end: '' })} className="text-xs text-slate-500 hover:text-primary-700">清除</button>
                          </div>
                          <label className="block text-xs text-slate-500">
                            开始时间
                            <input
                              type="datetime-local"
                              value={timeFilter.start}
                              onChange={event => setTimeFilter(prev => ({ ...prev, start: event.target.value }))}
                              className="mt-1 h-9 w-full border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-primary-600"
                            />
                          </label>
                          <label className="mt-3 block text-xs text-slate-500">
                            结束时间
                            <input
                              type="datetime-local"
                              value={timeFilter.end}
                              onChange={event => setTimeFilter(prev => ({ ...prev, end: event.target.value }))}
                              className="mt-1 h-9 w-full border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-primary-600"
                            />
                          </label>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {filteredLogs.map(log => {
                const level = riskLevel(log);
                const meta = riskMeta(level);
                return (
                  <button
                    key={log.id}
                    type="button"
                    onClick={() => setSelectedId(log.id)}
                    onContextMenu={event => {
                      if (!DELETE_ACTIONS.has(log.action)) return;
                      event.preventDefault();
                      setSelectedId(log.id);
                      setContextMenu({ log, x: event.clientX, y: event.clientY });
                    }}
                    className={`grid min-h-[72px] w-full grid-cols-1 items-center gap-1 border-b border-slate-100 px-4 py-3 text-left text-sm text-slate-600 last:border-b-0 lg:min-h-[48px] lg:gap-3 lg:py-2.5 ${meta.rowClassName} ${
                      selectedLog?.id === log.id ? 'app-selected-border relative z-10' : ''
                    }`}
                    style={isMobileViewport ? undefined : { gridTemplateColumns: TABLE_COLUMNS }}
                  >
                    <div className="truncate font-semibold text-slate-900" title={log.user_name || log.user_id}>
                      {log.user_name || log.user_id || '-'}
                    </div>
                    <div className="truncate font-medium text-slate-700" title={`${actionLabel(log.action)} · ${meta.label}`}>
                      {actionLabel(log.action)}
                    </div>
                    <div className="truncate font-mono text-xs text-slate-500" title={formatTime(log.created_at)}>
                      {formatTime(log.created_at)}
                    </div>
                    <div className="truncate text-slate-500" title={log.detail || '-'}>
                      {log.detail || '-'}
                    </div>
                    <div className="truncate font-mono text-xs text-slate-400" title={log.target_id || log.target_type || '-'}>
                      {log.target_type || '-'}
                      {log.target_id ? ` · ${log.target_id.slice(0, 8)}` : ''}
                    </div>
                  </button>
                );
              })}
            </>
          )}
          </div>
        </div>

        <aside className={`${selectedLog ? 'fixed inset-0 z-[60] flex' : 'hidden'} min-h-0 flex-col overflow-hidden border-l border-slate-200 bg-white lg:static lg:flex`}>
          {selectedLog ? (
            <>
              {(() => {
                const meta = riskMeta(riskLevel(selectedLog));
                return (
                  <div className={`relative shrink-0 px-5 pb-4 pt-[calc(1.25rem+env(safe-area-inset-top))] ${meta.headerClassName}`}>
                    <button type="button" onClick={() => setSelectedId(null)} className={`absolute right-4 top-[calc(1rem+env(safe-area-inset-top))] flex h-9 w-9 items-center justify-center ${meta.mutedClassName} lg:hidden`} aria-label="关闭日志详情"><X size={18} /></button>
                    <div className={`flex items-center gap-2 text-xs font-medium ${meta.mutedClassName}`}>
                      <span className={`flex h-6 w-6 items-center justify-center ${meta.mutedClassName}`}>
                        <FileClock size={15} />
                      </span>
                      参数详情
                    </div>
                    <h2 className={`mt-2 truncate text-lg font-semibold ${meta.titleClassName}`}>{actionLabel(selectedLog.action)}</h2>
                    <div className={`mt-1 font-mono text-xs ${meta.mutedClassName}`}>{selectedLog.id}</div>
                  </div>
                );
              })()}

              <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
                <div className="grid gap-0">
                  {selectedParams.map(([label, value]) => (
                    <DetailLine key={label || '-'} label={label || '-'} value={value} mono={Boolean(label && ['id', 'user_id', 'target_id', 'created_at'].includes(label))} />
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="flex h-full min-h-[360px] flex-col items-center justify-center p-6 text-center">
              <History size={30} className="text-slate-300" />
              <div className="mt-3 text-sm font-semibold text-slate-800">选择日志查看参数</div>
              <div className="mt-2 max-w-[240px] text-xs leading-5 text-slate-500">
                右侧会逐项展示这条日志的原始参数。
              </div>
            </div>
          )}
        </aside>
      </section>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          ariaLabel="删除操作菜单"
          items={[{
            key: 'undo-delete',
            label: contextMenu.log.undone_at
              ? '已撤回'
              : contextMenu.log.can_undo
                ? '撤回删除'
                : '无法撤回（无历史快照）',
            icon: <RotateCcw size={15} />,
            disabled: !contextMenu.log.can_undo || undoingId === contextMenu.log.id,
            onSelect: () => undoDelete(contextMenu.log),
          }]}
        />
      )}
      {ConfirmDialog}
    </div>
  );
}
