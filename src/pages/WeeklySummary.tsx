import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Check,
  Download,
  FileText,
  History,
  LoaderCircle,
  Plus,
  Trash2,
} from 'lucide-react';
import FeatureInfo from '../components/Guidance/FeatureInfo';
import TableToolbar from '../components/DataTable/TableToolbar';
import Header from '../components/Layout/Header';
import LoadingSpinner from '../components/LoadingSpinner';
import { api } from '../lib/api';
import { _toast } from '../store/toastRef';
import { useConfirm } from '../components/Toast';
import { formatWeekKey } from '../utils/week';
import { getWorkWeekLabelForKey } from '../utils/workWeek';

interface WeeklySummaryNotes {
  highlights: string[];
  qdQuota: string;
  fixedIncomeTeam: string;
  optionTeam: string;
  equityTeam: string;
  serviceTeam: string;
  serviceRules: string[];
}

interface ValidationItem {
  severity: 'error' | 'warning';
  code: string;
  message: string;
}

interface ReportCounts {
  problemProjects: number;
  pipelineProjects: number;
  fixedIncomeProducts: number;
  optionProducts: number;
  equityProducts: number;
  serviceProjects: number;
}

interface DirectSalesItem {
  statusRow: string[];
  weeklyReview: string;
  nextWeekPlan: string;
  salesRow: string[];
}

interface ReportDocument {
  title: string;
  reportDate: string;
  problemProjects: string[][];
  pipelineProjects: string[][];
  directSales: {
    fixedIncome: DirectSalesItem[];
    option: DirectSalesItem[];
    equity: DirectSalesItem[];
  };
  serviceProjects: string[][];
}

interface PreviewResult {
  weekKey: string;
  templateVersion: string;
  counts: ReportCounts;
  validation: ValidationItem[];
  notes: WeeklySummaryNotes;
  document: ReportDocument;
}

interface ReportRun {
  id: string;
  weekKey: string;
  templateVersion: string;
  counts: Partial<ReportCounts>;
  validation: ValidationItem[];
  payloadHash: string;
  fileHash: string;
  fileName: string;
  generatedByName: string;
  generatedAt: string;
}

interface DraftResult {
  weekKey: string;
  notes: WeeklySummaryNotes;
  revision: number;
  updatedAt: string;
  inheritedFromWeekKey?: string;
}

interface WritableTarget {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}

interface SaveFileHandle {
  createWritable(): Promise<WritableTarget>;
}

const EMPTY_NOTES: WeeklySummaryNotes = {
  highlights: [],
  qdQuota: '',
  fixedIncomeTeam: '固收研究组',
  optionTeam: '多资产策略组',
  equityTeam: '权益研究组',
  serviceTeam: '资产服务组',
  serviceRules: [
    '服务频次：每月发送估值表，每半年联系客户次数不少于1次；',
    '上年度未交易或者沟通未反馈的现场次年预约现场拜访不少于一次；',
    '新客户产品成立前后6个月内现场拜访一次；',
    '渠道联系每季度不少于1次；',
  ],
};

const PROBLEM_HEADERS = ['序号', '项目名称', '项目情况', '客户名称', '项目规模', '预计最晚化解时间', '后续举措', '上周进展', '进展是否达预期', '项目经理A', '项目经理B'];
const PIPELINE_HEADERS = ['序号', '项目', '规模（USD）', '规模(rmb)', '费率', '（预计）成立时间', '标的', '委托人', '券商/渠道', '基石/锚定', '年收入', '今年收入', '绩效收入', '进度', 'A角', 'B角'];
const SERVICE_HEADERS = ['正常项目', '状态', '产品名', '客户名称/类型', '净值/规模情况', '成立日/拟成立日', '渠道销售', '上周进展', '下周工作计划', 'A角', 'B角'];
const SALES_HEADERS = ['销售渠道', '渠道对接人', '当周申赎情况', '下一步工作计划'];

const PROBLEM_WIDTHS = [493, 1331, 1941, 1946, 1412, 895, 1271, 1800, 1296, 826, 801];
const PIPELINE_WIDTHS = [716, 1312, 1092, 936, 796, 936, 914, 2088, 1010, 1071, 1092, 932, 1036, 1036, 1036, 1036];
const FIXED_INCOME_WIDTHS = [1900, 2260, 3280, 2780, 1147, 2560];
const OPTION_WIDTHS = [1900, 2260, 1586, 2780, 1860, 1385, 2220];
const SERVICE_WIDTHS = [1129, 851, 2268, 2126, 2552, 1701, 1134, 1701, 1275, 851, 850];

const EDITOR_FIELD = 'w-full resize-none border border-transparent bg-white px-1 py-0.5 text-[12px] leading-5 text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-slate-300';
const TEAM_FIELD = 'min-w-[180px] border border-transparent bg-white px-1 py-0.5 text-[12px] text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-slate-300';

function cloneNotes(notes: WeeklySummaryNotes): WeeklySummaryNotes {
  return {
    ...notes,
    highlights: [...notes.highlights],
    serviceRules: [...notes.serviceRules],
  };
}

function formatGeneratedAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN');
}

function AutoGrowTextarea({
  value,
  onChange,
  placeholder,
  className,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className: string;
  ariaLabel: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.max(26, element.scrollHeight)}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={event => onChange(event.target.value)}
      rows={1}
      placeholder={placeholder}
      className={className}
      aria-label={ariaLabel}
      style={{ overflow: 'hidden' }}
    />
  );
}

function suggestedFileName(weekKey: string) {
  const date = weekKey.length === 6 ? `20${weekKey}` : '';
  return `${date.slice(0, 4) || new Date().getFullYear()}年度全球资本运营部周工作小结${date}.docx`;
}

async function chooseSaveTarget(fileName: string): Promise<SaveFileHandle | null | undefined> {
  const picker = (window as Window & {
    showSaveFilePicker?: (options: {
      suggestedName: string;
      types: Array<{ description: string; accept: Record<string, string[]> }>;
    }) => Promise<SaveFileHandle>;
  }).showSaveFilePicker;
  if (!picker) return null;
  try {
    return await picker({
      suggestedName: fileName,
      types: [{
        description: 'Word 文档',
        accept: {
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
        },
      }],
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return undefined;
    throw error;
  }
}

async function downloadReport(run: Pick<ReportRun, 'id' | 'fileName'>, saveTarget: SaveFileHandle | null) {
  const token = localStorage.getItem('auth_token');
  const response = await fetch(`/api/weekly-reports/runs/${encodeURIComponent(run.id)}/download`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || '下载工作小结失败');
  }
  const blob = await response.blob();
  if (saveTarget) {
    const writable = await saveTarget.createWritable();
    await writable.write(blob);
    await writable.close();
    return;
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = run.fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function ReportTable({
  headers,
  rows,
  emptyText,
  columnWidths,
  headerClassName = 'bg-white text-black',
  bodyClassName = 'bg-white text-black',
  mergeFirstColumn = false,
}: {
  headers: string[];
  rows: string[][];
  emptyText: string;
  columnWidths?: number[];
  headerClassName?: string;
  bodyClassName?: string;
  mergeFirstColumn?: boolean;
}) {
  const widthTotal = columnWidths?.reduce((sum, width) => sum + width, 0) || 0;
  return (
    <div className="mt-2 overflow-hidden border border-black">
      <table className="w-full table-fixed border-collapse font-serif text-[9px] leading-[1.35] text-black">
        {columnWidths && widthTotal > 0 && (
          <colgroup>
            {columnWidths.map((width, index) => (
              <col key={index} style={{ width: `${(width / widthTotal) * 100}%` }} />
            ))}
          </colgroup>
        )}
        <thead>
          <tr className={headerClassName}>
            {headers.map(header => (
              <th key={header} className="border-r border-b border-black px-1 py-1.5 text-center font-semibold last:border-r-0">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length > 0 ? rows.map((row, rowIndex) => (
            <tr key={rowIndex} className={`${bodyClassName} align-middle`}>
              {headers.map((_, cellIndex) => {
                if (mergeFirstColumn && cellIndex === 0 && !row[0] && rowIndex > 0) return null;
                const rowSpan = mergeFirstColumn && cellIndex === 0
                  ? 1 + rows.slice(rowIndex + 1).findIndex(nextRow => Boolean(nextRow[0]))
                  : 1;
                const effectiveRowSpan = mergeFirstColumn && cellIndex === 0 && rowSpan === 0
                  ? rows.length - rowIndex
                  : rowSpan;
                return (
                  <td
                    key={cellIndex}
                    rowSpan={effectiveRowSpan}
                    className="break-words border-r border-b border-black px-1 py-1.5 last:border-r-0"
                  >
                    {row[cellIndex] || ''}
                  </td>
                );
              })}
            </tr>
          )) : (
            <tr>
              <td colSpan={headers.length} className={`${bodyClassName} px-3 py-4 text-center text-slate-600`}>
                {emptyText}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function DirectSalesSection({
  title,
  team,
  onTeamChange,
  items,
  statusHeaders,
  statusWidths,
}: {
  title: string;
  team: string;
  onTeamChange: (value: string) => void;
  items: DirectSalesItem[];
  statusHeaders: string[];
  statusWidths: number[];
}) {
  const statusRows = items.map(item => item.statusRow);
  const salesRows = items.map(item => item.salesRow);
  const weeklyReview = [...new Set(items.map(item => item.weeklyReview).filter(Boolean))].join('；');
  const nextWeekPlan = [...new Set(items.map(item => item.nextWeekPlan).filter(Boolean))].join('；');
  return (
    <section className="mt-5 break-inside-avoid font-serif">
      <h3 className="font-serif text-[15px] font-bold">{title}</h3>
      <label className="mt-1 flex items-center gap-1 text-[12px]">
        <span>团队：</span>
        <input value={team} onChange={event => onTeamChange(event.target.value)} className={TEAM_FIELD} aria-label={`${title}团队`} />
      </label>
      <ReportTable
        headers={statusHeaders}
        rows={statusRows}
        emptyText="暂无产品"
        columnWidths={statusWidths}
        headerClassName="bg-[#4472c4] text-white"
      />
      <div className="grid grid-cols-[110px_1fr] border-x border-b border-black text-[10px]">
        <div className="border-r border-black bg-white px-2 py-1.5 text-center font-semibold">一周回顾</div>
        <div className="bg-white px-2 py-1.5">{weeklyReview || '—'}</div>
        <div className="border-r border-t border-black bg-white px-2 py-1.5 text-center font-semibold">后续计划</div>
        <div className="border-t border-black bg-white px-2 py-1.5">{nextWeekPlan || '—'}</div>
      </div>
      <ReportTable
        headers={SALES_HEADERS}
        rows={salesRows}
        emptyText="暂无销售记录"
        headerClassName="bg-[#4472c4] text-white"
      />
    </section>
  );
}

export default function WeeklySummary() {
  const navigate = useNavigate();
  const { confirm: ask, ConfirmDialog } = useConfirm();
  const [weekKeys, setWeekKeys] = useState<string[]>([]);
  const [selectedWeek, setSelectedWeek] = useState('');
  const [notes, setNotes] = useState<WeeklySummaryNotes>(cloneNotes(EMPTY_NOTES));
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [runs, setRuns] = useState<ReportRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [downloadingId, setDownloadingId] = useState('');
  const [draftReady, setDraftReady] = useState(false);
  const [inheritedFromWeek, setInheritedFromWeek] = useState('');

  const loadRuns = useCallback(async () => {
    const result = await api.get<{ runs: ReportRun[] }>('/weekly-reports/runs');
    setRuns(result.runs || []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get<{ weekKeys: string[]; templateVersion: string }>('/weekly-reports/weeks'),
      api.get<{ runs: ReportRun[] }>('/weekly-reports/runs'),
    ]).then(([weeksResult, runsResult]) => {
      if (cancelled) return;
      setWeekKeys(weeksResult.weekKeys || []);
      setSelectedWeek(weeksResult.weekKeys?.[0] || '');
      setRuns(runsResult.runs || []);
    }).catch((error: any) => {
      _toast.error?.(error.message || '读取工作小结数据失败');
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!selectedWeek) {
      setPreview(null);
      setDraftReady(false);
      setInheritedFromWeek('');
      return;
    }
    let cancelled = false;
    setPreviewing(true);
    setDraftReady(false);
    api.get<DraftResult>(`/weekly-reports/drafts/${selectedWeek}`)
      .then(async draft => {
        if (cancelled) return;
        const draftNotes = cloneNotes(draft.notes || EMPTY_NOTES);
        setInheritedFromWeek(draft.inheritedFromWeekKey || '');
        setNotes(draftNotes);
        const result = await api.post<PreviewResult>('/weekly-reports/preview', {
          weekKey: selectedWeek,
          notes: draftNotes,
        });
        if (cancelled) return;
        setPreview(result);
        setDraftReady(true);
      })
      .catch((error: any) => {
        if (!cancelled) _toast.error?.(error.message || '读取周次文档失败');
      })
      .finally(() => {
        if (!cancelled) setPreviewing(false);
      });
    return () => { cancelled = true; };
  }, [selectedWeek]);

  useEffect(() => {
    if (!selectedWeek || !draftReady) return;
    const timer = window.setTimeout(() => {
      api.put<DraftResult>(`/weekly-reports/drafts/${selectedWeek}`, { notes })
        .catch(() => undefined);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [draftReady, notes, selectedWeek]);

  const saveDraftNow = useCallback(async () => {
    if (!selectedWeek || !draftReady) return;
    await api.put<DraftResult>(`/weekly-reports/drafts/${selectedWeek}`, { notes });
  }, [draftReady, notes, selectedWeek]);

  const generateReport = async () => {
    if (!selectedWeek) return;
    let saveTarget: SaveFileHandle | null | undefined;
    try {
      saveTarget = await chooseSaveTarget(suggestedFileName(selectedWeek));
      if (saveTarget === undefined) return;
    } catch (error: any) {
      _toast.error?.(error.message || '无法打开文件保存窗口');
      return;
    }
    setGenerating(true);
    try {
      await saveDraftNow();
      const checked = await api.post<PreviewResult>('/weekly-reports/preview', {
        weekKey: selectedWeek,
        notes,
      });
      setPreview(checked);
      if (checked.validation.some(item => item.severity === 'error')) {
        throw new Error('存在阻止下载的数据问题，请先处理后再下载');
      }
      const result = await api.post<{ run: ReportRun }>('/weekly-reports/generate', {
        weekKey: selectedWeek,
        notes,
      });
      await downloadReport(result.run, saveTarget);
      await loadRuns();
      _toast.success?.(saveTarget ? 'Word 已保存到所选位置' : 'Word 已下载');
    } catch (error: any) {
      _toast.error?.(error.message || '下载工作小结失败');
    } finally {
      setGenerating(false);
    }
  };

  const handleDownload = async (run: ReportRun) => {
    let saveTarget: SaveFileHandle | null | undefined;
    try {
      saveTarget = await chooseSaveTarget(run.fileName);
      if (saveTarget === undefined) return;
      setDownloadingId(run.id);
      await downloadReport(run, saveTarget);
      _toast.success?.(saveTarget ? 'Word 已保存到所选位置' : 'Word 已下载');
    } catch (error: any) {
      _toast.error?.(error.message || '下载工作小结失败');
    } finally {
      setDownloadingId('');
    }
  };

  const blockingIssues = useMemo(
    () => preview?.validation.filter(item => item.severity === 'error') || [],
    [preview],
  );

  const updateHighlight = (index: number, value: string) => {
    setNotes(current => {
      const highlights = [...current.highlights];
      highlights[index] = value;
      return { ...current, highlights };
    });
  };

  const addHighlight = () => {
    setNotes(current => ({ ...current, highlights: [...current.highlights, ''] }));
  };

  const removeHighlight = async (index: number) => {
    const confirmed = await ask({
      title: '删除重点事项',
      message: `确定删除第 ${index + 1} 条重点工作进展吗？删除后会自动保存到本周草稿。`,
      confirmText: '删除',
      tone: 'danger',
    });
    if (!confirmed) return;
    setNotes(current => ({ ...current, highlights: current.highlights.filter((_, itemIndex) => itemIndex !== index) }));
  };

  const moveHighlight = (index: number, direction: -1 | 1) => {
    setNotes(current => {
      const target = index + direction;
      if (target < 0 || target >= current.highlights.length) return current;
      const highlights = [...current.highlights];
      [highlights[index], highlights[target]] = [highlights[target], highlights[index]];
      return { ...current, highlights };
    });
  };

  const updateServiceRule = (index: number, value: string) => {
    setNotes(current => {
      const serviceRules = [...current.serviceRules];
      serviceRules[index] = value;
      return { ...current, serviceRules };
    });
  };

  if (loading) return <LoadingSpinner fullPage message="正在打开工作小结..." />;

  const document = preview?.document;
  const weekOptions = weekKeys.map(key => ({ key, label: getWorkWeekLabelForKey(key) }));
  const workWeekLabel = getWorkWeekLabelForKey(selectedWeek);

  return (
    <div className="square-ui flex min-h-full w-full min-w-0 flex-col gap-5 overflow-visible lg:h-full lg:min-h-0 lg:overflow-hidden">
      <Header
        title="管理周报"
        info={<FeatureInfo label="管理周报功能说明">按周维护记录，工作小结用于汇总并导出本周内容。</FeatureInfo>}
        subtitle="按周记录项目进展、待办问题与直销产品情况。"
      />

      {weekKeys.length === 0 ? (
        <section className="border border-dashed border-slate-300 bg-white px-5 py-16 text-center">
          <FileText size={28} className="mx-auto text-slate-300" />
          <div className="mt-3 text-sm font-medium text-slate-700">暂无可编辑的周次</div>
          <div className="mt-1 text-xs text-slate-500">请先在“管理周报”中录入或导入工作日志。</div>
        </section>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_328px]">
          <main className="min-h-0 min-w-0 overflow-x-hidden overflow-y-visible bg-white lg:overflow-y-auto">
            {previewing || !document ? (
              <div className="flex min-h-[520px] items-center justify-center"><LoadingSpinner message="正在排版工作小结..." /></div>
            ) : (
              <article
                className="weekly-summary-document mx-auto min-h-[794px] w-full max-w-[1120px] bg-white px-[8.55%] pb-[10.7%] pt-[10.7%] text-black"
                style={{ fontFamily: "'SimSun', '宋体', 'Times New Roman', serif" }}
              >
                <div className="text-center font-serif">
                  <h1 className="text-[20px] font-bold tracking-wide">{document.title}</h1>
                  <p className="mt-2 text-[12px]">日期： {document.reportDate}</p>
                </div>

                <section className="mt-7 font-serif">
                  <h2 className="text-[15px] font-bold">➢　问题项目推进进展</h2>
                  <ReportTable
                    headers={PROBLEM_HEADERS.map((value, index) => index === 7 ? `上周进展（${selectedWeek}）` : value)}
                    rows={document.problemProjects}
                    emptyText="本周无问题项目"
                    columnWidths={PROBLEM_WIDTHS}
                    headerClassName="bg-[#c65911] text-white"
                  />
                </section>

                <section className="mt-7 font-serif">
                  <div className="flex items-center justify-between gap-4">
                    <h2 className="text-[15px] font-bold">➢　近期拟推进的重点工作进展：</h2>
                    <button type="button" onClick={addHighlight} className="inline-flex h-7 shrink-0 items-center gap-1 border border-slate-300 px-2 text-[11px] font-sans text-slate-700 hover:bg-slate-50"><Plus size={13} />新增一条</button>
                  </div>
                  {inheritedFromWeek && <div className="mt-2 border-l-2 border-primary-400 bg-primary-50 px-3 py-2 font-sans text-[11px] text-primary-700">已自动沿用 {getWorkWeekLabelForKey(inheritedFromWeek)} 的内容，本周修改不会影响历史记录。</div>}
                  <div className="mt-2 space-y-1">
                    {notes.highlights.map((value, index) => (
                      <div key={index} className="group grid grid-cols-[22px_minmax(0,1fr)_72px] items-start gap-1">
                        <span className="pt-1 text-[12px]">{index + 1}.</span>
                        <AutoGrowTextarea
                          value={value}
                          onChange={nextValue => updateHighlight(index, nextValue)}
                          placeholder="点击这里填写本周重点工作进展"
                          className={EDITOR_FIELD}
                          ariaLabel={`重点事项 ${index + 1}`}
                        />
                        <div className="flex items-center justify-end gap-0.5 pt-0.5 font-sans opacity-50 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                          <button type="button" disabled={index === 0} onClick={() => moveHighlight(index, -1)} className="flex h-6 w-6 items-center justify-center text-slate-500 hover:bg-slate-100 disabled:opacity-25" aria-label={`上移重点事项 ${index + 1}`}><ChevronUp size={13} /></button>
                          <button type="button" disabled={index === notes.highlights.length - 1} onClick={() => moveHighlight(index, 1)} className="flex h-6 w-6 items-center justify-center text-slate-500 hover:bg-slate-100 disabled:opacity-25" aria-label={`下移重点事项 ${index + 1}`}><ChevronDown size={13} /></button>
                          <button type="button" onClick={() => void removeHighlight(index)} className="flex h-6 w-6 items-center justify-center text-red-500 hover:bg-red-50" aria-label={`删除重点事项 ${index + 1}`}><Trash2 size={13} /></button>
                        </div>
                      </div>
                    ))}
                    {notes.highlights.length === 0 && <button type="button" onClick={addHighlight} className="flex w-full items-center justify-center gap-1 border border-dashed border-slate-300 py-3 font-sans text-[11px] text-slate-500 hover:border-primary-300 hover:text-primary-700"><Plus size={13} />添加第一条重点工作进展</button>}
                    <label className="grid grid-cols-[22px_150px_1fr] items-center text-[12px]">
                      <span>{notes.highlights.length + 1}.</span>
                      <span>QD 额度使用情况：</span>
                      <input
                        value={notes.qdQuota}
                        onChange={event => setNotes(current => ({ ...current, qdQuota: event.target.value }))}
                        placeholder="点击填写额度及使用比例"
                        className={TEAM_FIELD}
                        aria-label="QD 额度使用情况"
                      />
                    </label>
                    <div className="grid grid-cols-[22px_1fr] items-center text-[12px]">
                      <span>{notes.highlights.length + 2}.</span>
                      <span>相关单一项目推进情况：</span>
                    </div>
                  </div>
                  <ReportTable
                    headers={PIPELINE_HEADERS}
                    rows={document.pipelineProjects}
                    emptyText="暂无储备项目"
                    columnWidths={PIPELINE_WIDTHS}
                    bodyClassName="bg-[#fff2cc] text-black"
                  />
                </section>

                <section className="mt-7 font-serif">
                  <h2 className="text-[15px] font-bold">➢　部门日常工作进展：</h2>
                  <h2 className="mt-3 text-[15px] font-bold">一、产品系列</h2>
                  <DirectSalesSection
                    title="1、固收系列"
                    team={notes.fixedIncomeTeam}
                    onTeamChange={value => setNotes(current => ({ ...current, fixedIncomeTeam: value }))}
                    items={document.directSales.fixedIncome}
                    statusHeaders={['产品名称', '规模（万）', '目标规模（万）', '净值', '较上周', '持仓超过10%的个券明细']}
                    statusWidths={FIXED_INCOME_WIDTHS}
                  />
                  <DirectSalesSection
                    title="2、含权系列"
                    team={notes.optionTeam}
                    onTeamChange={value => setNotes(current => ({ ...current, optionTeam: value }))}
                    items={document.directSales.option}
                    statusHeaders={['产品名称', '规模（万）', '目标规模（万）', '净值', '较上周', '权益资产占比', '是否触及预警、平仓线']}
                    statusWidths={OPTION_WIDTHS}
                  />
                  <DirectSalesSection
                    title="3、权益类"
                    team={notes.equityTeam}
                    onTeamChange={value => setNotes(current => ({ ...current, equityTeam: value }))}
                    items={document.directSales.equity}
                    statusHeaders={['产品名称', '规模（万）', '目标规模（万）', '净值', '较上周', '权益资产占比', '是否触及预警、平仓线']}
                    statusWidths={OPTION_WIDTHS}
                  />
                </section>

                <section className="mt-8 font-serif">
                  <h2 className="text-[15px] font-bold">二、服务类</h2>
                  <label className="mt-1 flex items-center gap-1 text-[12px]">
                    <span>团队：</span>
                    <input
                      value={notes.serviceTeam}
                      onChange={event => setNotes(current => ({ ...current, serviceTeam: event.target.value }))}
                      className={TEAM_FIELD}
                      aria-label="服务类团队"
                    />
                  </label>
                  <div className="mt-3 space-y-1">
                    {notes.serviceRules.map((value, index) => (
                      <div key={index} className="grid grid-cols-[22px_1fr] items-start">
                        <span className="pt-1 text-[12px]">{index + 1}.</span>
                        <AutoGrowTextarea
                          value={value}
                          onChange={nextValue => updateServiceRule(index, nextValue)}
                          className={EDITOR_FIELD}
                          ariaLabel={`服务规则 ${index + 1}`}
                        />
                      </div>
                    ))}
                  </div>
                  <ReportTable
                    headers={SERVICE_HEADERS.map((value, index) => index === 7 ? `上周进展（${selectedWeek}）` : value)}
                    rows={document.serviceProjects}
                    emptyText="暂无服务项目"
                    columnWidths={SERVICE_WIDTHS}
                    headerClassName="bg-[#bfbfbf] text-black"
                    bodyClassName="bg-[#c6e0b4] text-black"
                    mergeFirstColumn
                  />
                </section>
              </article>
            )}
          </main>

          <aside className="min-h-0 space-y-4 overflow-y-auto">
            <section className="app-module-frame border border-zinc-200 bg-white p-3">
              <div className="[&>div>div:last-child]:!flex-nowrap">
                <TableToolbar
                  hideSearch
                  searchQuery=""
                  onSearchChange={() => undefined}
                  selectedCount={0}
                  onExport={() => void generateReport()}
                  exportLabel="下载 Word"
                  exportDisabled={!selectedWeek || previewing || generating || blockingIssues.length > 0}
                  hideExportAction
                  menuActions={[
                    {
                      label: '返回',
                      icon: <ArrowLeft size={15} />,
                      onClick: () => navigate('/worklog'),
                    },
                  ]}
                  weekLeadingContent={(
                    <button
                      type="button"
                      onClick={() => void generateReport()}
                      disabled={!selectedWeek || previewing || generating || blockingIssues.length > 0}
                      aria-label="保存"
                      title="保存"
                      className="app-button-secondary h-10 w-10 !p-0 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {generating
                        ? <LoaderCircle size={17} className="animate-spin" />
                        : <Download size={17} strokeWidth={1.8} />}
                    </button>
                  )}
                  weekDateLabel={workWeekLabel}
                  weekOptions={weekOptions}
                  selectedWeekKey={selectedWeek}
                  onWeekChange={key => key && setSelectedWeek(key)}
                />
              </div>
            </section>

            <section className="border border-slate-200 bg-white">
              <div className="border-b border-slate-200 px-4 py-3">
                <h2 className="text-sm font-semibold text-slate-900">文档检查</h2>
                <p className="mt-1 text-xs text-slate-500">提示不会打断编辑，红色问题会阻止下载。</p>
              </div>
              <div className="space-y-2 p-3">
                {preview?.validation.length ? preview.validation.map(item => (
                  <div
                    key={`${item.code}-${item.message}`}
                    className={`flex gap-2 border px-2.5 py-2 text-xs ${
                      item.severity === 'error'
                        ? 'border-red-200 bg-red-50 text-red-800'
                        : 'border-amber-200 bg-amber-50 text-amber-800'
                    }`}
                  >
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <span>{item.message}</span>
                  </div>
                )) : (
                  <div className="flex items-center gap-2 border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                    <Check size={14} /> 当前数据检查通过
                  </div>
                )}
              </div>
            </section>

            <section className="border border-slate-200 bg-white">
              <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
                <History size={15} className="text-slate-400" />
                <h2 className="text-sm font-semibold text-slate-900">历史下载</h2>
              </div>
              {runs.length === 0 ? (
                <div className="px-4 py-8 text-center text-xs text-slate-500">尚未下载过工作小结</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {runs.slice(0, 12).map(run => (
                    <div key={run.id} className="px-4 py-3">
                      <div className="text-xs font-medium text-slate-800">{formatWeekKey(run.weekKey)}</div>
                      <div className="mt-1 truncate text-[11px] text-slate-500" title={run.fileName}>{run.fileName}</div>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-[10px] text-slate-400">{formatGeneratedAt(run.generatedAt)}</span>
                        <button
                          type="button"
                          onClick={() => handleDownload(run)}
                          disabled={downloadingId === run.id}
                          className="inline-flex items-center gap-1 text-xs font-medium text-primary-700 disabled:opacity-50"
                        >
                          {downloadingId === run.id ? <LoaderCircle size={12} className="animate-spin" /> : <Download size={12} />}
                          下载
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </aside>
        </div>
      )}
      {ConfirmDialog}
    </div>
  );
}
