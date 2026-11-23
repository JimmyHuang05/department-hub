import { useMemo, useState } from 'react';
import { Clock, History, RefreshCw } from 'lucide-react';
import type { InvestmentProduct, WorkLogEntry } from '../types';
import { api } from '../lib/api';
import AppModal from './Layout/AppModal';
import ProjectExcelView, { type ProjectExcelColumn } from './ProjectExcelView';

type WorkLogHistoryEntry = {
  id: string;
  recordId: string;
  field: string;
  oldValue: string;
  newValue: string;
  editedAt: string;
  editedName: string;
};

type WorkLogExcelViewProps = {
  data: WorkLogEntry[];
  weekKey: string;
  readOnly?: boolean;
  onUpdate: (entry: WorkLogEntry, updates: Partial<WorkLogEntry>) => void;
  onOpenDetail?: (entry: WorkLogEntry) => void;
  toolbarHost?: HTMLElement | null;
  statusOptions?: string[];
};

const buildWorkLogColumns = (statusOptions: string[]): ProjectExcelColumn[] => [
  { key: 'category', label: '类别', width: 112, type: 'text' },
  { key: 'subCategory', label: '项目分类', width: 132, type: 'text' },
  { key: 'productName', label: '产品名称', width: 260, type: 'text' },
  { key: 'status', label: '状态', width: 108, type: 'select', options: statusOptions },
  { key: 'clientType', label: '客户名称 / 类型', width: 220, type: 'text' },
  { key: 'navScale', label: '净值 / 规模情况', width: 220, type: 'text' },
  { key: 'weeklyProgressValue', label: '上周进展', width: 300, type: 'text' },
  { key: 'nextWeekPlan', label: '下周工作计划', width: 280, type: 'text' },
  { key: 'personA', label: 'A角', width: 100, type: 'text' },
  { key: 'personB', label: 'B角', width: 100, type: 'text' },
  { key: 'activePassive', label: '主动 / 被动', width: 112, type: 'text' },
  { key: 'collectiveSingle', label: '集合 / 单一', width: 112, type: 'text' },
  { key: 'advisorManager', label: '投资顾问 / 管理人', width: 190, type: 'text' },
  { key: 'establishDate', label: '成立日 / 拟成立日', width: 150, type: 'date' },
  { key: 'channelSales', label: '渠道销售', width: 130, type: 'text' },
  { key: 'productTerm', label: '产品期限', width: 120, type: 'text' },
  { key: 'features', label: '特色', width: 220, type: 'text' },
  { key: 'managementReport', label: '管理报告', width: 140, type: 'text' },
  { key: 'riskReport', label: '风控报告', width: 140, type: 'text' },
  { key: 'salesReport', label: '销售端报告', width: 140, type: 'text' },
];

export default function WorkLogExcelView({ data, weekKey, readOnly = false, onUpdate, onOpenDetail, toolbarHost, statusOptions = [] }: WorkLogExcelViewProps) {
  void onOpenDetail;
  const columns = useMemo(() => buildWorkLogColumns(statusOptions), [statusOptions]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyEntries, setHistoryEntries] = useState<WorkLogHistoryEntry[]>([]);
  const sourceById = useMemo(() => new Map(data.map(entry => [entry.id, entry])), [data]);
  const rows = useMemo(() => data.map(entry => ({
    ...entry,
    weeklyProgressValue: entry.weeklyProgress?.[weekKey] || '',
  } as unknown as InvestmentProduct)), [data, weekKey]);
  const entryNames = useMemo(() => new Map(data.map(entry => [entry.id, entry.productName || '未命名周报'])), [data]);
  const fieldLabels = useMemo(() => new Map(columns.map(column => [column.key, column.label])), [columns]);

  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      const recordIds = data.map(entry => entry.id).join(',');
      const result = await api.get<{ entries: WorkLogHistoryEntry[] }>(`/history/records/entry?recordIds=${encodeURIComponent(recordIds)}`);
      setHistoryEntries(result.entries || []);
    } catch {
      setHistoryEntries([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const openHistory = () => {
    setHistoryOpen(true);
    void loadHistory();
  };

  const applyChanges = async (changes: Array<{ id: string; field: string; value: string | number }>) => {
    if (readOnly) return false;
    const grouped = new Map<string, Partial<WorkLogEntry>>();
    changes.forEach(change => {
      const entry = sourceById.get(change.id);
      if (!entry) return;
      const updates = grouped.get(change.id) || {};
      if (change.field === 'weeklyProgressValue') {
        updates.weeklyProgress = { ...(entry.weeklyProgress || {}), [weekKey]: String(change.value) };
      } else {
        (updates as Record<string, unknown>)[change.field] = change.value;
      }
      grouped.set(change.id, updates);
    });
    grouped.forEach((updates, id) => {
      const entry = sourceById.get(id);
      if (entry) onUpdate(entry, updates);
    });
    return true;
  };

  return (
    <>
    <ProjectExcelView
      data={rows}
      columnsOverride={columns}
      projectTransactionsEnabled={false}
      projectRowActionsEnabled={false}
      onShowHistory={openHistory}
      toolbarHost={toolbarHost}
      customColumns={[]}
      statusOptions={statusOptions}
      managerOptions={[]}
      bankOptions={[]}
      columnOrder={columns.map(column => column.key)}
      selectedIds={selectedIds}
      onToggleSelect={id => setSelectedIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])}
      onSetSelectedRows={setSelectedIds}
      onBatchCellEdit={applyChanges}
      onRefresh={async () => undefined}
      onColumnOrderChange={() => undefined}
      onDelete={() => undefined}
      onDuplicateRow={async () => false}
      onAdvance={() => undefined}
      onRetreat={() => undefined}
    />
    <AppModal
      open={historyOpen}
      onClose={() => setHistoryOpen(false)}
      title="管理周报历史记录"
      subtitle="按时间倒序显示当前列表中的字段修改。"
      size="lg"
      footer={<button type="button" onClick={() => setHistoryOpen(false)} className="inline-flex h-10 items-center justify-center border border-slate-200 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50">关闭</button>}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-xs text-slate-400">共 {historyEntries.length} 条修改记录</span>
        <button type="button" onClick={() => void loadHistory()} disabled={historyLoading} className="inline-flex h-8 items-center gap-1.5 border border-slate-200 bg-white px-2.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40">
          <RefreshCw size={13} className={historyLoading ? 'animate-spin' : ''} />刷新
        </button>
      </div>
      <div className="max-h-[58vh] overflow-y-auto border-y border-slate-100">
        {historyLoading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400"><RefreshCw size={16} className="animate-spin" />正在加载历史记录</div>
        ) : historyEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-sm text-slate-400"><History size={28} className="mb-2 text-slate-300" />暂无历史记录</div>
        ) : historyEntries.map(entry => (
          <div key={entry.id} className="grid grid-cols-[minmax(140px,0.8fr)_minmax(120px,0.6fr)_minmax(0,1.8fr)_auto] items-start gap-4 border-b border-slate-100 px-1 py-3 last:border-b-0">
            <div className="min-w-0"><div className="truncate text-sm font-medium text-slate-800">{entryNames.get(entry.recordId) || '管理周报'}</div><div className="mt-1 text-xs text-slate-400">{fieldLabels.get(entry.field) || entry.field}</div></div>
            <div className="min-w-0"><div className="truncate text-sm text-slate-700">{entry.editedName || '未知用户'}</div><div className="mt-1 flex items-center gap-1 text-[11px] text-slate-400"><Clock size={11} />{new Date(entry.editedAt).toLocaleString('zh-CN')}</div></div>
            <div className="min-w-0 text-xs"><div className="truncate text-slate-400 line-through" title={entry.oldValue}>{entry.oldValue || '（空）'}</div><div className="mt-1 truncate text-slate-700" title={entry.newValue}>{entry.newValue || '（空）'}</div></div>
            <span className="mt-0.5 text-[11px] text-slate-400">修改</span>
          </div>
        ))}
      </div>
    </AppModal>
    </>
  );
}
