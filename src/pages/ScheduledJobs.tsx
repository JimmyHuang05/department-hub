import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  History,
  Loader2,
  Play,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import Header from '../components/Layout/Header';
import { api } from '../lib/api';
import { _toast } from '../store/toastRef';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';
import { MobileBaseAppbar } from '../components/Mobile/MobileBasePrimitives';

type JobStatus = 'never' | 'running' | 'success' | 'failed' | 'skipped';
type JobSchedule =
  | { kind: 'daily'; time: string }
  | { kind: 'weekly'; weekday: number; time: string }
  | { kind: 'interval'; minutes: number };

interface ScheduledJob {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  schedule: JobSchedule;
  nextRunAt: string;
  lastRunAt: string;
  lastStatus: JobStatus;
  lastError: string;
  running: boolean;
  updatedBy: string;
  updatedAt: string;
}

interface JobRun {
  id: string;
  jobKey: string;
  triggerType: 'manual' | 'scheduled';
  scheduledAt: string;
  startedAt: string;
  finishedAt: string;
  status: JobStatus;
  result: { count?: number; message?: string };
  error: string;
  triggeredBy: string;
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function formatDateTime(value: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

function scheduleLabel(schedule: JobSchedule) {
  if (schedule.kind === 'daily') return `每天 ${schedule.time}`;
  if (schedule.kind === 'weekly') return `每${WEEKDAYS[schedule.weekday]} ${schedule.time}`;
  return `每 ${schedule.minutes} 分钟`;
}

function statusView(status: JobStatus) {
  if (status === 'success') return { label: '成功', className: 'text-emerald-700', dotClassName: 'bg-emerald-500', icon: CheckCircle2 };
  if (status === 'failed') return { label: '失败', className: 'text-red-700', dotClassName: 'bg-red-500', icon: XCircle };
  if (status === 'running') return { label: '执行中', className: 'text-blue-700', dotClassName: 'bg-blue-500', icon: Loader2 };
  if (status === 'skipped') return { label: '已跳过', className: 'text-amber-700', dotClassName: 'bg-amber-500', icon: Clock3 };
  return { label: '未执行', className: 'text-slate-500', dotClassName: 'bg-slate-300', icon: Clock3 };
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function ScheduledJobs() {
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [timezone, setTimezone] = useState('Asia/Shanghai');
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState('');
  const [runningKey, setRunningKey] = useState('');
  const [expandedKey, setExpandedKey] = useState('');
  const [runsByKey, setRunsByKey] = useState<Record<string, JobRun[]>>({});
  const [runsLoadingKey, setRunsLoadingKey] = useState('');

  const loadJobs = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<{ jobs: ScheduledJob[]; timezone: string }>('/scheduled-jobs');
      setJobs(result.jobs || []);
      setTimezone(result.timezone || 'Asia/Shanghai');
    } catch (error) {
      _toast.error?.(errorMessage(error, '读取定时任务失败'));
    } finally {
      setLoading(false);
    }
  }, []);
  useRealtimeRefresh(['settings'], loadJobs);

  useEffect(() => { loadJobs(); }, [loadJobs]);

  const enabledCount = useMemo(() => jobs.filter(job => job.enabled).length, [jobs]);

  const saveJob = async (job: ScheduledJob, updates: Partial<Pick<ScheduledJob, 'enabled' | 'schedule'>>) => {
    setSavingKey(job.key);
    try {
      const result = await api.put<{ job: ScheduledJob }>(`/scheduled-jobs/${encodeURIComponent(job.key)}`, updates);
      setJobs(current => current.map(item => item.key === job.key ? result.job : item));
      _toast.success?.(result.job.enabled ? '定时任务设置已保存' : '定时任务已关闭');
    } catch (error) {
      _toast.error?.(errorMessage(error, '保存定时任务失败'));
    } finally {
      setSavingKey('');
    }
  };

  const runNow = async (job: ScheduledJob) => {
    setRunningKey(job.key);
    try {
      const result = await api.post<{ job: ScheduledJob; run: JobRun }>(`/scheduled-jobs/${encodeURIComponent(job.key)}/run`, {});
      setJobs(current => current.map(item => item.key === job.key && result.job ? result.job : item));
      setRunsByKey(current => ({ ...current, [job.key]: [result.run, ...(current[job.key] || [])].slice(0, 30) }));
      _toast.success?.(result.run.result?.message || '任务执行完成');
    } catch (error) {
      _toast.error?.(errorMessage(error, '执行定时任务失败'));
      await loadJobs();
    } finally {
      setRunningKey('');
    }
  };

  const toggleRuns = async (job: ScheduledJob) => {
    if (expandedKey === job.key) {
      setExpandedKey('');
      return;
    }
    setExpandedKey(job.key);
    setRunsLoadingKey(job.key);
    try {
      const result = await api.get<{ runs: JobRun[] }>(`/scheduled-jobs/${encodeURIComponent(job.key)}/runs?limit=30`);
      setRunsByKey(current => ({ ...current, [job.key]: result.runs || [] }));
    } catch (error) {
      _toast.error?.(errorMessage(error, '读取运行记录失败'));
    } finally {
      setRunsLoadingKey('');
    }
  };

  const updateLocalSchedule = (jobKey: string, schedule: JobSchedule) => {
    setJobs(current => current.map(job => job.key === jobKey ? { ...job, schedule } : job));
  };

  return (
    <div className="mobile-scheduled-jobs square-ui flex h-full w-full flex-col gap-5 overflow-auto">
      <section className="mobile-scheduled-slice lg:hidden">
        <MobileBaseAppbar
          title="定时任务"
          action={(
            <button type="button" onClick={loadJobs} disabled={loading} aria-label="刷新定时任务">
              <RefreshCw size={19} className={loading ? 'animate-spin' : ''} />
            </button>
          )}
        />
        <div className="mobile-scheduled-summary">
          <div><span>运行时区</span><strong>{timezone}</strong></div>
          <div><span>已开启</span><strong><b>{enabledCount}</b> / {jobs.length}</strong></div>
        </div>
        <main className="mobile-scheduled-list">
          {loading && jobs.length === 0 && <div className="mobile-scheduled-empty"><Loader2 size={20} className="animate-spin" />正在读取任务配置...</div>}
          {!loading && jobs.length === 0 && <div className="mobile-scheduled-empty"><CalendarClock size={25} />暂无定时任务</div>}
          {jobs.map(job => {
            const status = statusView(job.running ? 'running' : job.lastStatus);
            const busy = savingKey === job.key || runningKey === job.key || job.running;
            const runs = runsByKey[job.key] || [];
            return (
              <article key={job.key} className="mobile-scheduled-card">
                <header>
                  <span className="mobile-scheduled-card__icon"><CalendarClock size={21} /></span>
                  <div><h2>{job.name}</h2><p><i className={status.dotClassName} />{status.label} · {scheduleLabel(job.schedule)}</p></div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={job.enabled}
                    disabled={busy}
                    onClick={() => saveJob(job, { enabled: !job.enabled })}
                    className={`mobile-scheduled-switch${job.enabled ? ' is-on' : ''}`}
                    aria-label={job.enabled ? '关闭任务' : '开启任务'}
                  ><span /></button>
                </header>
                <p className="mobile-scheduled-description">{job.description}</p>
                <div className="mobile-scheduled-times">
                  <span>下次执行<strong>{job.enabled ? formatDateTime(job.nextRunAt) : '已停用'}</strong></span>
                  <span>上次执行<strong>{formatDateTime(job.lastRunAt)}</strong></span>
                </div>
                <div className="mobile-scheduled-plan">
                  <span><Clock3 size={14} />执行计划</span>
                  {job.schedule.kind === 'weekly' && (
                    <select
                      value={job.schedule.weekday}
                      disabled={busy}
                      onChange={event => updateLocalSchedule(job.key, { kind: 'weekly', weekday: Number(event.target.value), time: job.schedule.kind === 'weekly' ? job.schedule.time : '00:00' })}
                      onBlur={() => saveJob(job, { schedule: job.schedule })}
                    >{WEEKDAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}</select>
                  )}
                  {(job.schedule.kind === 'daily' || job.schedule.kind === 'weekly') && (
                    <input
                      type="time"
                      value={job.schedule.time}
                      disabled={busy}
                      onChange={event => updateLocalSchedule(job.key, job.schedule.kind === 'daily'
                        ? { kind: 'daily', time: event.target.value }
                        : { kind: 'weekly', weekday: job.schedule.kind === 'weekly' ? job.schedule.weekday : 1, time: event.target.value })}
                      onBlur={() => saveJob(job, { schedule: job.schedule })}
                    />
                  )}
                  {job.schedule.kind === 'interval' && (
                    <label>每<input type="number" min="5" max="10080" value={job.schedule.minutes} disabled={busy} onChange={event => updateLocalSchedule(job.key, { kind: 'interval', minutes: Number(event.target.value) })} onBlur={() => saveJob(job, { schedule: job.schedule })} />分钟</label>
                  )}
                </div>
                {job.lastError && <div className="mobile-scheduled-error">{job.lastError}</div>}
                <footer>
                  <button type="button" onClick={() => runNow(job)} disabled={busy}>{runningKey === job.key || job.running ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}立即执行</button>
                  <button type="button" onClick={() => toggleRuns(job)} className={expandedKey === job.key ? 'is-active' : ''}><History size={15} />运行记录{expandedKey === job.key ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button>
                </footer>
                {expandedKey === job.key && (
                  <div className="mobile-scheduled-runs">
                    {runsLoadingKey === job.key ? <span><Loader2 size={14} className="animate-spin" />读取运行记录...</span> : runs.length === 0 ? <span>暂无运行记录</span> : runs.slice(0, 6).map(run => {
                      const runStatus = statusView(run.status);
                      return <div key={run.id}><i className={runStatus.dotClassName} /><strong>{runStatus.label}</strong><span>{formatDateTime(run.startedAt)}</span><p>{run.error || run.result?.message || '执行完成'}</p></div>;
                    })}
                  </div>
                )}
              </article>
            );
          })}
        </main>
      </section>
      <Header title="定时任务" subtitle="集中管理后台任务的执行时间、启用状态与运行记录。" eyebrow="后端服务">
        <div className="flex items-center gap-2">
          <span className="hidden h-9 items-center border border-slate-200 bg-white px-3 text-xs text-slate-500 sm:inline-flex">
            {timezone} · 已开启 {enabledCount}/{jobs.length}
          </span>
          <button type="button" onClick={loadJobs} disabled={loading} className="inline-flex h-9 items-center gap-2 border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />刷新
          </button>
        </div>
      </Header>

      <section>
        {loading && jobs.length === 0 && (
          <div className="flex min-h-64 items-center justify-center gap-2 border border-slate-200 bg-white text-sm text-slate-500"><Loader2 size={18} className="animate-spin" />正在读取任务配置...</div>
        )}

        {!loading && jobs.length === 0 && (
          <div className="flex min-h-64 flex-col items-center justify-center border border-slate-200 bg-white text-slate-400">
            <CalendarClock size={24} strokeWidth={1.5} />
            <span className="mt-3 text-sm">暂无定时任务</span>
          </div>
        )}

        <div className="grid gap-3">
          {jobs.map(job => {
            const status = statusView(job.running ? 'running' : job.lastStatus);
            const busy = savingKey === job.key || runningKey === job.key || job.running;
            const runs = runsByKey[job.key] || [];
            return (
              <article key={job.key} className="scheduled-job-card bg-white">
                <div className="flex flex-col gap-4 px-4 py-4 lg:flex-row lg:items-start lg:justify-between lg:px-5">
                  <div className="flex min-w-0 gap-3">
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center bg-slate-50 text-slate-500"><CalendarClock size={17} /></span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                        <h2 className="font-semibold text-slate-950">{job.name}</h2>
                        <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${status.className}`}>
                          <span className={`h-1.5 w-1.5 ${status.dotClassName}`} />
                          {status.label}
                        </span>
                      </div>
                      <p className="mt-1.5 max-w-3xl text-sm leading-6 text-slate-500">{job.description}</p>
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">
                    <span className="mr-1 text-xs text-slate-400">{job.enabled ? '已启用' : '已停用'}</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={job.enabled}
                      disabled={busy}
                      onClick={() => saveJob(job, { enabled: !job.enabled })}
                      className={`inline-flex h-7 w-12 shrink-0 items-center border p-[3px] outline-none transition-colors focus:outline-none focus-visible:outline-none disabled:opacity-50 ${job.enabled ? 'justify-end border-primary-700 bg-primary-700' : 'justify-start border-slate-300 bg-white'}`}
                      title={job.enabled ? '关闭任务' : '开启任务'}
                    >
                      <span aria-hidden="true" className={`block h-5 w-5 shrink-0 shadow-sm ${job.enabled ? 'bg-white' : 'bg-slate-300'}`} />
                    </button>
                    <span className="mx-1 hidden h-5 w-px bg-slate-200 sm:block" />
                    <button type="button" onClick={() => runNow(job)} disabled={busy} className="inline-flex h-9 items-center gap-1.5 border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50">
                      {runningKey === job.key || job.running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}立即执行
                    </button>
                    <button type="button" onClick={() => toggleRuns(job)} className={`inline-flex h-9 items-center gap-1.5 border px-3 text-sm hover:bg-slate-50 ${expandedKey === job.key ? 'border-slate-300 bg-slate-50 text-slate-900' : 'border-slate-200 bg-white text-slate-600'}`}>
                      <History size={14} />运行记录{expandedKey === job.key ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                  </div>
                </div>

                <div className="grid gap-4 border-t border-slate-100 px-4 py-3 lg:grid-cols-[minmax(280px,1fr)_180px_180px] lg:items-center lg:px-5">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="mr-1 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500"><Clock3 size={13} />执行计划</span>
                    {job.schedule.kind === 'weekly' && (
                      <select
                        value={job.schedule.weekday}
                        disabled={busy}
                        onChange={event => updateLocalSchedule(job.key, { kind: 'weekly', weekday: Number(event.target.value), time: job.schedule.kind === 'weekly' ? job.schedule.time : '00:00' })}
                        onBlur={() => saveJob(job, { schedule: job.schedule })}
                        className="scheduled-job-control h-8 border border-slate-200 bg-white px-2.5 text-xs text-slate-700 disabled:opacity-50"
                      >
                        {WEEKDAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}
                      </select>
                    )}
                    {(job.schedule.kind === 'daily' || job.schedule.kind === 'weekly') && (
                      <input
                        type="time"
                        value={job.schedule.time}
                        disabled={busy}
                        onChange={event => updateLocalSchedule(job.key, job.schedule.kind === 'daily'
                          ? { kind: 'daily', time: event.target.value }
                          : { kind: 'weekly', weekday: job.schedule.kind === 'weekly' ? job.schedule.weekday : 1, time: event.target.value })}
                        onBlur={() => saveJob(job, { schedule: job.schedule })}
                        className="scheduled-job-control h-8 border border-slate-200 bg-white px-2.5 text-xs text-slate-700 disabled:opacity-50"
                      />
                    )}
                    {job.schedule.kind === 'interval' && (
                      <label className="flex h-8 items-center border border-slate-200 bg-white text-xs text-slate-600">
                        <span className="px-2.5">每</span>
                        <input
                          type="number"
                          min="5"
                          max="10080"
                          value={job.schedule.minutes}
                          disabled={busy}
                          onChange={event => updateLocalSchedule(job.key, { kind: 'interval', minutes: Number(event.target.value) })}
                          onBlur={() => saveJob(job, { schedule: job.schedule })}
                          className="scheduled-job-control h-full w-24 border-x border-slate-200 px-2 text-center"
                        />
                        <span className="px-2.5">分钟</span>
                      </label>
                    )}
                    <span className="text-xs text-slate-400">{scheduleLabel(job.schedule)}</span>
                  </div>

                  <div className="text-xs"><div className="text-slate-400">下次执行</div><div className="mt-1 font-medium text-slate-700">{job.enabled ? formatDateTime(job.nextRunAt) : '已停用'}</div></div>
                  <div className="text-xs"><div className="text-slate-400">上次执行</div><div className="mt-1 font-medium text-slate-700">{formatDateTime(job.lastRunAt)}</div></div>
                </div>

                {job.lastError && <div className="border-t border-red-100 bg-red-50 px-4 py-2.5 text-xs text-red-700 lg:px-5">{job.lastError}</div>}

                {expandedKey === job.key && (
                  <div className="border-t border-slate-200 bg-slate-50/60">
                    {runsLoadingKey === job.key ? (
                      <div className="flex h-20 items-center justify-center gap-2 text-sm text-slate-500"><Loader2 size={15} className="animate-spin" />读取运行记录...</div>
                    ) : runs.length === 0 ? (
                      <div className="py-8 text-center text-sm text-slate-500">暂无运行记录</div>
                    ) : (
                      <div className="divide-y divide-slate-200">
                        {runs.map(run => {
                          const runStatus = statusView(run.status);
                          return (
                            <div key={run.id} className="grid gap-2 px-4 py-2.5 text-xs sm:grid-cols-[130px_90px_1fr_auto] sm:items-center lg:px-5">
                              <span className="font-mono text-slate-600">{formatDateTime(run.startedAt)}</span>
                              <span className={`inline-flex w-fit items-center gap-1.5 font-medium ${runStatus.className}`}><span className={`h-1.5 w-1.5 ${runStatus.dotClassName}`} />{runStatus.label}</span>
                              <span className="truncate text-slate-600">{run.error || run.result?.message || '执行完成'}</span>
                              <span className="text-slate-400">{run.triggerType === 'manual' ? `手动 · ${run.triggeredBy || '高级用户'}` : '定时触发'}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
