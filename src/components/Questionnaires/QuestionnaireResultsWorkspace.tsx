import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3, ChevronLeft, ChevronRight, ClipboardList, Download, Eye, FileQuestion,
  Inbox, LayoutDashboard, LoaderCircle, RefreshCw, Search, Table2, X,
} from 'lucide-react';
import QuestionnaireStatsModal from './QuestionnaireStatsModal';
import type { Questionnaire, QuestionnaireSubmission, QuestionnaireSubmissionRecord } from '../../types/questionnaire';

type AnalysisView = 'overview' | 'submissions' | 'fields';
type SubmissionStatus = 'all' | 'new' | 'viewed' | 'handled';

const questionnaireStatusLabels = { draft: '草稿', published: '收集中', closed: '已结束' } as const;
const questionnaireStatusClasses = {
  draft: 'bg-slate-100 text-slate-600',
  published: 'bg-emerald-50 text-emerald-700',
  closed: 'bg-amber-50 text-amber-700',
} as const;
const submissionStatusLabels = { new: '新提交', viewed: '已查看', handled: '已处理' } as const;
const submissionStatusClasses = {
  new: 'bg-red-50 text-red-700',
  viewed: 'bg-blue-50 text-blue-700',
  handled: 'bg-emerald-50 text-emerald-700',
} as const;

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
}

function formatCompactDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function answerText(value: QuestionnaireSubmission['answers'][string] | undefined) {
  if (Array.isArray(value)) return value.join('、') || '—';
  if (typeof value === 'object' && value) return value.fileName || '附件';
  if (value === '' || value == null) return '—';
  return String(value);
}

interface QuestionnaireResultsWorkspaceProps {
  items: Questionnaire[];
  loading: boolean;
  submissions: QuestionnaireSubmissionRecord[];
  submissionsLoading: boolean;
  selectedId: string;
  search: string;
  submissionSearch: string;
  submissionStatus: SubmissionStatus;
  onSearchChange: (value: string) => void;
  onSubmissionSearchChange: (value: string) => void;
  onSubmissionStatusChange: (value: SubmissionStatus) => void;
  onSelect: (id: string) => void;
  onClose: () => void;
  onRefreshItems: () => void;
  onRefreshSubmissions: () => void;
  onExport: (questionnaire: Questionnaire) => void;
  onOpenSubmission: (record: QuestionnaireSubmissionRecord) => void;
  onSubmissionContextMenu: (record: QuestionnaireSubmissionRecord, x: number, y: number) => void;
  onDownloadAttachment: (questionnaireId: string, submissionId: string, fieldId: string, fileName: string) => void;
  submissionDetail?: ReactNode;
}

export default function QuestionnaireResultsWorkspace({
  items, loading, submissions, submissionsLoading, selectedId, search, submissionSearch, submissionStatus,
  onSearchChange, onSubmissionSearchChange, onSubmissionStatusChange, onSelect, onClose,
  onRefreshItems, onRefreshSubmissions, onExport, onOpenSubmission, onSubmissionContextMenu, onDownloadAttachment, submissionDetail,
}: QuestionnaireResultsWorkspaceProps) {
  const [view, setView] = useState<AnalysisView>('submissions');
  const tableRef = useRef<HTMLDivElement>(null);

  const counts = useMemo(() => {
    const result = new Map<string, { total: number; fresh: number; latest: string }>();
    submissions.forEach(record => {
      const current = result.get(record.questionnaireId) || { total: 0, fresh: 0, latest: '' };
      current.total += 1;
      if ((record.status || 'new') === 'new') current.fresh += 1;
      if (!current.latest || new Date(record.submittedAt).getTime() > new Date(current.latest).getTime()) current.latest = record.submittedAt;
      result.set(record.questionnaireId, current);
    });
    return result;
  }, [submissions]);

  const visibleItems = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase('zh-CN');
    return [...items]
      .filter(item => !keyword || [item.title, item.description, item.createdByName].some(value => String(value || '').toLocaleLowerCase('zh-CN').includes(keyword)))
      .sort((a, b) => {
        const aDate = counts.get(a.id)?.latest || a.updatedAt;
        const bDate = counts.get(b.id)?.latest || b.updatedAt;
        return new Date(bDate).getTime() - new Date(aDate).getTime();
      });
  }, [counts, items, search]);

  const selected = useMemo(() => items.find(item => item.id === selectedId) || null, [items, selectedId]);
  const filteredSubmissions = useMemo(() => {
    if (!selected) return [];
    const keyword = submissionSearch.trim().toLocaleLowerCase('zh-CN');
    return submissions.filter(record => {
      if (record.questionnaireId !== selected.id) return false;
      if (submissionStatus !== 'all' && (record.status || 'new') !== submissionStatus) return false;
      if (!keyword) return true;
      return [record.sourceUserName, ...record.fields.map(field => field.label), ...Object.values(record.answers).map(answerText)]
        .join(' ').toLocaleLowerCase('zh-CN').includes(keyword);
    });
  }, [selected, submissionSearch, submissionStatus, submissions]);

  useEffect(() => {
    if (!selected) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const index = visibleItems.findIndex(item => item.id === selected.id);
      if (index < 0) return;
      const nextIndex = event.key === 'ArrowUp' ? Math.max(0, index - 1) : Math.min(visibleItems.length - 1, index + 1);
      if (nextIndex === index) return;
      event.preventDefault();
      onSelect(visibleItems[nextIndex].id);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onSelect, selected, visibleItems]);

  useEffect(() => { setView('submissions'); }, [selectedId]);

  const scrollTable = (direction: -1 | 1) => {
    tableRef.current?.scrollBy({ left: direction * Math.max(360, tableRef.current.clientWidth * 0.65), behavior: 'smooth' });
  };

  const directory = (
    <div className="flex min-h-0 min-w-0 flex-col bg-white">
      <div className="app-content-toolbar flex shrink-0 items-center gap-2 border-b border-slate-200 px-4">
        <label className="relative min-w-0 flex-1"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={search} onChange={event => onSearchChange(event.target.value)} placeholder="搜索问卷" className="h-10 w-full border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-700 outline-none" /></label>
        <button type="button" onClick={onRefreshItems} disabled={loading} className="flex h-10 w-10 shrink-0 items-center justify-center border border-slate-200 text-slate-500 hover:text-slate-900 disabled:opacity-50" aria-label="刷新问卷"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {loading ? <div className="space-y-px p-4">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-24 animate-pulse bg-slate-100" />)}</div> : visibleItems.length === 0 ? <div className="flex h-full min-h-80 flex-col items-center justify-center text-center"><ClipboardList size={32} className="text-slate-300" /><div className="mt-4 text-sm font-semibold text-slate-800">{search ? '没有匹配的问卷' : '还没有问卷'}</div></div> : <div>{visibleItems.map(item => {
          const summary = counts.get(item.id) || { total: item.submissionCount || 0, fresh: 0, latest: '' };
          const active = selected?.id === item.id;
          return <button key={item.id} type="button" onClick={() => onSelect(item.id)} className={`task-directory-item group relative grid w-full grid-cols-[40px_minmax(0,1fr)_auto] gap-x-3 border-b border-slate-100 px-5 py-4 text-left transition-colors hover:bg-slate-50 ${active ? 'app-selected-border task-directory-item-active z-10' : ''}`}>
            <span className="flex h-10 w-10 items-center justify-center bg-slate-50 text-slate-400 group-hover:text-primary-700"><FileQuestion size={20} /></span>
            <span className="min-w-0"><span className={`block truncate text-sm font-semibold ${active ? 'text-primary-700' : 'text-slate-900'}`}>{item.title}</span><span className="mt-1.5 flex min-w-0 items-center gap-2 text-xs text-slate-400"><span className={`shrink-0 px-1.5 py-0.5 ${questionnaireStatusClasses[item.status]}`}>{questionnaireStatusLabels[item.status]}</span><span className="truncate">{item.createdByName || '未知创建人'}</span></span><span className="mt-2 block truncate text-xs text-slate-500">{item.description || '未填写问卷说明'}</span></span>
            <span className="flex flex-col items-end"><span className="text-sm font-semibold tabular-nums text-slate-700">{summary.total}</span><span className="mt-0.5 text-[11px] text-slate-400">份答卷</span>{summary.fresh > 0 && <span className="mt-2 bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-600">{summary.fresh} 条新提交</span>}{summary.latest && <span className="mt-2 whitespace-nowrap text-[10px] tabular-nums text-slate-400">{formatCompactDate(summary.latest)}</span>}</span>
          </button>;
        })}</div>}
      </div>
      <div className="flex h-10 shrink-0 items-center px-5 text-xs text-slate-400">共 {visibleItems.length} 份问卷</div>
    </div>
  );

  return (
    <section id="questionnaire-content-scope" className={`grid min-h-0 flex-1 overflow-hidden bg-white ${selected ? 'lg:grid-cols-[minmax(320px,1fr)_minmax(0,2fr)]' : 'grid-cols-1'}`}>
      {directory}
      {selected && <aside className="task-detail-panel-in fixed inset-0 z-[60] flex min-h-0 min-w-0 flex-col bg-white lg:relative lg:inset-auto lg:z-auto lg:border-l lg:border-slate-200">
        <div className="app-content-toolbar flex shrink-0 items-center justify-between gap-5 border-b border-slate-200 px-5 lg:px-6">
          <div className="min-w-0"><h2 className="truncate text-lg font-semibold tracking-tight text-slate-950">{selected.title}</h2><div className="mt-1.5 flex min-w-0 items-center gap-2 text-xs text-slate-400"><span>{questionnaireStatusLabels[selected.status]}</span><span className="h-1 w-1 bg-slate-300" /><span>{selected.fields.length} 道题</span><span className="h-1 w-1 bg-slate-300" /><span>{counts.get(selected.id)?.total || selected.submissionCount || 0} 份答卷</span>{counts.get(selected.id)?.latest && <><span className="h-1 w-1 bg-slate-300" /><span className="truncate">最近提交 {formatDateTime(counts.get(selected.id)!.latest)}</span></>}</div></div>
          <button type="button" onClick={onClose} className="flex h-10 w-10 shrink-0 items-center justify-center text-slate-400 hover:bg-slate-50 hover:text-slate-800" aria-label="关闭详情"><X size={20} /></button>
        </div>

        <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 lg:px-6">
          <div className="flex h-full min-w-0 items-center gap-1 overflow-x-auto">
            {([
              ['overview', LayoutDashboard, '数据概览'],
              ['submissions', Table2, '答卷明细'],
              ['fields', BarChart3, '逐题分析'],
            ] as const).map(([key, Icon, label]) => <button key={key} type="button" onClick={() => setView(key)} className={`relative inline-flex h-full shrink-0 items-center gap-2 px-3 text-sm font-medium after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 ${view === key ? 'text-primary-700 after:bg-primary-700' : 'text-slate-500 after:bg-transparent hover:text-slate-900'}`}><Icon size={15} />{label}</button>)}
          </div>
          {view === 'submissions' && <div className="hidden shrink-0 items-center gap-1 xl:flex"><button type="button" onClick={() => scrollTable(-1)} className="flex h-8 w-8 items-center justify-center text-slate-400 hover:bg-slate-50 hover:text-slate-900" aria-label="向左浏览字段"><ChevronLeft size={16} /></button><button type="button" onClick={() => scrollTable(1)} className="flex h-8 w-8 items-center justify-center text-slate-400 hover:bg-slate-50 hover:text-slate-900" aria-label="向右浏览字段"><ChevronRight size={16} /></button></div>}
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          {view === 'overview' && <QuestionnaireStatsModal open questionnaire={selected} section="overview" />}
          {view === 'fields' && <QuestionnaireStatsModal open questionnaire={selected} section="fields" />}
          {view === 'submissions' && <div className="flex h-full min-h-0 flex-col">
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-100 p-3 lg:px-5">
              <label className="relative min-w-52 flex-1"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={submissionSearch} onChange={event => onSubmissionSearchChange(event.target.value)} placeholder="搜索回答、来源或字段" className="h-9 w-full border border-slate-200 pl-9 pr-3 text-sm outline-none" /></label>
              <select value={submissionStatus} onChange={event => onSubmissionStatusChange(event.target.value as SubmissionStatus)} className="h-9 border border-slate-200 bg-white px-2 text-sm text-slate-600"><option value="all">全部状态</option><option value="new">新提交</option><option value="viewed">已查看</option><option value="handled">已处理</option></select>
              <button type="button" onClick={() => onExport(selected)} disabled={!submissions.some(record => record.questionnaireId === selected.id)} className="inline-flex h-9 items-center gap-1.5 px-2.5 text-xs text-slate-500 hover:bg-slate-50 hover:text-primary-700 disabled:opacity-40"><Download size={15} />下载 Excel</button>
              <button type="button" onClick={onRefreshSubmissions} disabled={submissionsLoading} className="flex h-9 w-9 items-center justify-center text-slate-500 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-40" aria-label="刷新答卷"><RefreshCw size={15} className={submissionsLoading ? 'animate-spin' : ''} /></button>
            </div>
            <div ref={tableRef} className="questionnaire-submission-scroll min-h-0 min-w-0 flex-1 overflow-auto">
              {submissionsLoading ? <div className="flex h-full items-center justify-center text-sm text-slate-400"><LoaderCircle size={17} className="mr-2 animate-spin" />加载答卷...</div> : filteredSubmissions.length === 0 ? <div className="flex h-full flex-col items-center justify-center text-sm text-slate-400"><Inbox size={30} className="mb-3 text-slate-300" />没有符合条件的答卷</div> : <table className="w-max min-w-full border-collapse text-left text-sm"><thead className="sticky top-0 z-20 bg-slate-50 text-xs text-slate-500"><tr><th className="sticky left-0 z-30 min-w-40 border-b border-r border-slate-200 bg-slate-50 px-3 py-3">提交时间</th><th className="min-w-28 border-b border-r border-slate-200 px-3 py-3">来源</th>{selected.fields.map(field => <th key={field.id} className={`border-b border-r border-slate-200 px-3 py-3 ${field.type === 'long_text' ? 'min-w-64' : 'min-w-40'}`}>{field.label}{field.hidden && <span className="ml-1.5 bg-white px-1.5 py-0.5 text-[10px]">内部</span>}</th>)}<th className="sticky right-20 z-30 min-w-24 border-b border-l border-slate-200 bg-slate-50 px-3 py-3">状态</th><th className="sticky right-0 z-30 min-w-20 border-b border-l border-slate-200 bg-slate-50 px-3 py-3 text-center">操作</th></tr></thead><tbody>{filteredSubmissions.map(record => { const status = record.status || 'new'; return <tr key={record.id} onDoubleClick={() => onOpenSubmission(record)} onContextMenu={event => { event.preventDefault(); onSubmissionContextMenu(record, event.clientX, event.clientY); }} className="hover:bg-slate-50"><td className="sticky left-0 z-10 whitespace-nowrap border-b border-r border-slate-100 bg-white px-3 py-3 text-xs tabular-nums text-slate-500">{formatDateTime(record.submittedAt)}</td><td className="whitespace-nowrap border-b border-r border-slate-100 px-3 py-3 text-slate-600">{record.sourceUserName || '公共链接'}</td>{selected.fields.map(field => { const answer = record.answers[field.id]; const attachment = answer && typeof answer === 'object' && !Array.isArray(answer) ? answer : null; return <td key={field.id} className="max-w-80 border-b border-r border-slate-100 px-3 py-3 align-top text-slate-700"><div className={field.type === 'long_text' ? 'line-clamp-3 whitespace-pre-wrap break-words' : 'truncate'} title={attachment ? attachment.fileName : answerText(answer)}>{attachment ? <button type="button" onClick={() => onDownloadAttachment(record.questionnaireId, record.id, field.id, attachment.fileName)} className="inline-flex max-w-full items-center gap-1.5 text-primary-700 hover:underline"><Download size={14} /><span className="truncate">{attachment.fileName}</span></button> : answerText(answer)}</div></td>; })}<td className="sticky right-20 z-10 whitespace-nowrap border-b border-l border-slate-100 bg-white px-3 py-3"><span className={`px-2 py-1 text-xs ${submissionStatusClasses[status]}`}>{submissionStatusLabels[status]}</span></td><td className="sticky right-0 z-10 border-b border-l border-slate-100 bg-white px-3 py-3 text-center"><button type="button" onClick={() => onOpenSubmission(record)} className="inline-flex h-8 items-center gap-1 text-xs text-slate-600 hover:text-primary-700"><Eye size={14} />查看</button></td></tr>; })}</tbody></table>}
            </div>
            <div className="flex h-10 shrink-0 items-center border-t border-slate-100 px-4 text-xs text-slate-400">共 {filteredSubmissions.length} 条记录</div>
          </div>}
        </div>
        {submissionDetail && <div className="absolute inset-0 z-40 flex min-h-0 flex-col bg-white">{submissionDetail}</div>}
      </aside>}
    </section>
  );
}
