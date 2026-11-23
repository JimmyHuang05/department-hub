import { useEffect, useMemo, useState } from 'react';
import { Line } from 'react-chartjs-2';
import {
  CategoryScale, Chart as ChartJS, Filler, LinearScale, LineElement, PointElement, Tooltip,
  type ChartOptions,
} from 'chart.js';
import { BarChart3, ClipboardCheck, Inbox, ListChecks, LoaderCircle, TrendingUp, Users } from 'lucide-react';
import { api } from '../../lib/api';
import { _toast } from '../../store/toastRef';
import type { Questionnaire, QuestionnaireStats } from '../../types/questionnaire';

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Tooltip, Filler);

interface QuestionnaireStatsModalProps {
  open: boolean;
  questionnaire: Questionnaire | null;
  section?: 'all' | 'overview' | 'fields';
}

function emptyWeeklyTrend() {
  const current = new Date();
  const day = current.getDay() || 7;
  current.setHours(0, 0, 0, 0);
  current.setDate(current.getDate() - day + 1);
  return Array.from({ length: 12 }, (_, index) => {
    const week = new Date(current);
    week.setDate(current.getDate() - (11 - index) * 7);
    return { label: `${week.getMonth() + 1}/${week.getDate()}`, count: 0 };
  });
}

const fieldTypeLabels: Record<string, string> = {
  short_text: '单行文字',
  long_text: '多行文字',
  single_choice: '单选',
  multiple_choice: '多选',
  number: '数字',
  date: '日期',
  phone: '电话号码',
  email: '电子邮箱',
  file: '文件上传',
  rating: '评分',
};

const baseLineOptions: ChartOptions<'line'> = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { intersect: false, mode: 'index' },
  plugins: {
    legend: { display: false },
    tooltip: {
      displayColors: false,
      callbacks: { label: context => `${context.parsed.y} 份答卷` },
    },
  },
  scales: {
    y: {
      beginAtZero: true,
      ticks: { stepSize: 1, color: '#94a3b8', precision: 0 },
      border: { display: false },
      grid: { color: 'rgba(148,163,184,0.14)' },
    },
    x: {
      ticks: { color: '#94a3b8', maxTicksLimit: 8, maxRotation: 0 },
      border: { display: false },
      grid: { display: false },
    },
  },
};

function readThemeColor(name: string, fallback: string) {
  if (typeof window === 'undefined') return fallback;
  return window.getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function withAlpha(color: string, alpha: number) {
  const value = color.trim();
  const shortHex = value.match(/^#([\da-f])([\da-f])([\da-f])$/i);
  const hex = value.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
  if (shortHex) {
    const [, r, g, b] = shortHex;
    return `rgba(${parseInt(r + r, 16)}, ${parseInt(g + g, 16)}, ${parseInt(b + b, 16)}, ${alpha})`;
  }
  if (hex) {
    return `rgba(${parseInt(hex[1], 16)}, ${parseInt(hex[2], 16)}, ${parseInt(hex[3], 16)}, ${alpha})`;
  }
  return value;
}

export default function QuestionnaireStatsModal({ open, questionnaire, section = 'all' }: QuestionnaireStatsModalProps) {
  const [stats, setStats] = useState<QuestionnaireStats | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !questionnaire) return;
    let active = true;
    setLoading(true);
    setStats(null);
    api.get<{ stats: QuestionnaireStats }>(`/questionnaires/${questionnaire.id}/stats`)
      .then(result => { if (active) setStats(result.stats); })
      .catch(error => { if (active) _toast.error?.(error instanceof Error ? error.message : '统计数据加载失败'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, questionnaire]);

  const chartPalette = useMemo(() => ({
    primary: readThemeColor('--app-primary', '#2754d7'),
    muted: readThemeColor('--app-faint', '#94a3b8'),
    border: readThemeColor('--app-border', '#cbd5e1'),
  }), [open, stats]);

  const chartOptions = useMemo<ChartOptions<'line'>>(() => ({
    ...baseLineOptions,
    scales: {
      y: {
        ...baseLineOptions.scales?.y,
        ticks: { stepSize: 1, color: chartPalette.muted, precision: 0 },
        border: { display: false },
        grid: { color: withAlpha(chartPalette.border, 0.5) },
      },
      x: {
        ...baseLineOptions.scales?.x,
        ticks: { color: chartPalette.muted, maxTicksLimit: 8, maxRotation: 0 },
        border: { display: false },
        grid: { display: false },
      },
    },
  }), [chartPalette]);

  const trendData = useMemo(() => {
    const weekly = stats?.weekly || [];
    const items = weekly.length > 0 ? weekly : emptyWeeklyTrend();
    return {
      labels: items.map(item => item.label),
      datasets: [{
        label: '提交量',
        data: items.map(item => Number.isFinite(Number(item.count)) ? Number(item.count) : 0),
        borderColor: chartPalette.primary,
        backgroundColor: withAlpha(chartPalette.primary, 0.1),
        borderWidth: 2,
        fill: true,
        spanGaps: true,
        tension: 0.32,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointBackgroundColor: chartPalette.primary,
      }],
    };
  }, [chartPalette, stats]);

  const total = stats?.total || 0;
  const sourceCounts = stats?.sourceCounts || [];
  const sourceMax = Math.max(...sourceCounts.map(item => item.count), 1);

  if (loading || !stats) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-white text-sm text-slate-400">
        <LoaderCircle className="mb-3 animate-spin" size={22} />
        {loading ? '统计数据加载中…' : '暂无统计数据'}
      </div>
    );
  }

  if (total === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-white text-center">
        <BarChart3 size={36} className="text-slate-300" />
        <h3 className="mt-4 text-sm font-semibold text-slate-800">还没有答卷数据</h3>
        <p className="mt-1 text-xs text-slate-400">客户提交问卷后，这里会自动生成分析结果。</p>
      </div>
    );
  }

  const handledRate = total > 0 ? Math.round((stats.statusCounts.handled / total) * 100) : 0;
  const metrics = [
    { label: '回收答卷', value: total, suffix: '份', color: 'text-slate-950' },
    { label: '新提交', value: stats.statusCounts.new, suffix: '份', color: 'text-red-600' },
    { label: '已处理', value: stats.statusCounts.handled, suffix: '份', color: 'text-emerald-700' },
    { label: '处理率', value: handledRate, suffix: '%', color: 'text-primary-700' },
  ];

  return (
    <div className="h-full overflow-y-auto bg-white">
      <div className="space-y-8 px-5 py-6 lg:px-7">
        {section !== 'fields' && <section>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><ClipboardCheck size={15} className="text-slate-400" />答卷概览</h3>
          <div className="mt-4 grid grid-cols-2 border-y border-slate-100 md:grid-cols-4 md:divide-x md:divide-slate-100">
            {metrics.map(metric => (
              <div key={metric.label} className="px-4 py-4">
                <div className="text-xs text-slate-400">{metric.label}</div>
                <div className={`mt-2 text-2xl font-semibold tabular-nums ${metric.color}`}>{metric.value}<span className="ml-1 text-xs font-normal text-slate-400">{metric.suffix}</span></div>
              </div>
            ))}
          </div>
          {stats.allTotal > stats.total && <div className="mt-3 text-xs text-slate-400">全部时间共 {stats.allTotal} 份答卷，当前范围显示 {stats.total} 份。</div>}
        </section>}

        {section !== 'fields' && <div className="grid gap-8 xl:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
          <section className="min-w-0">
            <div className="flex items-end justify-between gap-4">
              <div><h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><TrendingUp size={15} className="text-slate-400" />回收趋势</h3><p className="mt-1 text-xs text-slate-400">最近 12 个自然周的提交变化</p></div>
              <div className="text-right"><div className="text-xs text-slate-400">周均</div><div className="mt-1 text-sm font-semibold tabular-nums text-slate-800">{stats.summary.weeklyAvg} 份</div></div>
            </div>
            <div className="mt-5 h-60"><Line data={trendData} options={chartOptions} /></div>
          </section>

          <div className="space-y-7 xl:border-l xl:border-slate-100 xl:pl-7">
            <section>
              <div className="flex items-center gap-2"><Users size={15} className="text-slate-400" /><h3 className="text-sm font-semibold text-slate-900">来源经理</h3></div>
              <p className="mt-1 text-xs text-slate-400">按专属分享链接识别</p>
              <div className="mt-4 space-y-3">
                {sourceCounts.length ? sourceCounts.map(item => {
                  const percent = total > 0 ? Math.round((item.count / total) * 100) : 0;
                  return <div key={item.sourceUserName}><div className="flex items-center justify-between gap-3 text-xs"><span className="truncate text-slate-600">{item.sourceUserName}</span><span className="shrink-0 tabular-nums text-slate-400">{item.count} · {percent}%</span></div><div className="mt-1.5 h-1.5 bg-slate-100"><div className="h-full bg-primary-600" style={{ width: `${(item.count / sourceMax) * 100}%` }} /></div></div>;
                }) : <div className="flex items-center gap-2 py-4 text-xs text-slate-400"><Inbox size={15} />暂无来源信息</div>}
              </div>
            </section>

          </div>
        </div>}

        {section !== 'overview' && <section>
          <div className="flex items-end justify-between gap-4 border-b border-slate-100 pb-4"><div><h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><ListChecks size={15} className="text-slate-400" />逐题分析</h3><p className="mt-1 text-xs text-slate-400">查看每道题的填写情况与选项分布</p></div><span className="text-xs text-slate-400">共 {stats.fieldStats.length} 道题</span></div>
          <div className="divide-y divide-slate-100">
            {stats.fieldStats.map((field, index) => (
              <article key={field.fieldId} className="py-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0"><div className="flex items-center gap-2"><span className="font-mono text-xs text-slate-300">{String(index + 1).padStart(2, '0')}</span><h4 className="truncate text-sm font-medium text-slate-800" title={field.label}>{field.label}</h4>{field.required && <span className="text-xs text-red-500">必填</span>}</div><div className="mt-1 pl-7 text-xs text-slate-400">{fieldTypeLabels[field.type] || field.type}</div></div>
                  <div className="shrink-0 text-right"><div className="text-sm font-semibold tabular-nums text-slate-800">{field.fillRate}%</div><div className="mt-0.5 text-xs text-slate-400">{field.answered}/{field.total} 份填写</div></div>
                </div>
                <div className="mt-3 ml-7 h-1.5 bg-slate-100"><div className="h-full bg-primary-600" style={{ width: `${Math.max(0, Math.min(100, field.fillRate))}%` }} /></div>
                {field.isChoice && <div className="mt-5 ml-7 grid gap-x-8 gap-y-3 md:grid-cols-2">{[...field.options, ...(field.otherCount > 0 ? [{ option: '其他', count: field.otherCount }] : [])].map(option => {
                  const percent = field.answered > 0 ? Math.round((option.count / field.answered) * 100) : 0;
                  return <div key={option.option}><div className="flex items-center justify-between gap-3 text-xs"><span className="truncate text-slate-600" title={option.option}>{option.option}</span><span className="shrink-0 tabular-nums text-slate-400">{option.count} · {percent}%</span></div><div className="mt-1.5 h-1.5 bg-slate-100"><div className="h-full bg-slate-500" style={{ width: `${Math.min(100, percent)}%` }} /></div></div>;
                })}</div>}
              </article>
            ))}
          </div>
        </section>}
      </div>
    </div>
  );
}
