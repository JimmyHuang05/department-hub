import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ChevronDown, FileWarning, RefreshCw, Search, X } from 'lucide-react';
import Header from '../components/Layout/Header';
import LoadingSpinner from '../components/LoadingSpinner';
import { api } from '../lib/api';
import { useMobileViewport } from '../hooks/useMobileViewport';

interface ErrorEvent {
  incidentId: string;
  errorCode: string;
  timestamp: string;
  status: number;
  method: string;
  path: string;
  userId: string;
  userName: string;
  message: string;
  durationMs: number | null;
  stack?: string;
}

type Level = 'server' | 'client';
const TABLE_COLUMNS = 'minmax(145px,.9fr) minmax(115px,.7fr) minmax(140px,.85fr) minmax(0,1.8fr) minmax(155px,.9fr)';

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value || '-' : date.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function levelOf(event: ErrorEvent): Level {
  return event.status >= 500 ? 'server' : 'client';
}

function DetailLine({ label, value, mono = false }: { label: string; value: unknown; mono?: boolean }) {
  return <div className="grid min-w-0 grid-cols-[132px_minmax(0,1fr)] gap-x-5 border-b border-slate-100 py-3 last:border-b-0">
    <div className="truncate pt-0.5 text-xs font-medium text-slate-400">{label}</div>
    <div className={`min-w-0 whitespace-pre-wrap break-words text-[13px] leading-6 text-slate-700 ${mono ? 'font-mono text-xs' : ''}`}>{String(value ?? '') || '-'}</div>
  </div>;
}

export default function EventLog() {
  const isMobileViewport = useMobileViewport();
  const [events, setEvents] = useState<ErrorEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [level, setLevel] = useState<'all' | Level>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const fetchEvents = async () => {
    setLoading(true);
    try {
      const result = await api.get<ErrorEvent[]>('/error-events?limit=500');
      setEvents(Array.isArray(result) ? result : []);
      setSelectedId(current => current && result.some(item => item.incidentId === current) ? current : result[0]?.incidentId || null);
    } catch {
      setEvents([]);
      setSelectedId(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchEvents(); }, []);

  const filteredEvents = useMemo(() => {
    const query = search.trim().toLowerCase();
    return events.filter(event => {
      if (level !== 'all' && levelOf(event) !== level) return false;
      if (!query) return true;
      return [event.incidentId, event.errorCode, event.userName, event.userId, event.method, event.path, event.message, event.status]
        .some(value => String(value || '').toLowerCase().includes(query));
    });
  }, [events, level, search]);

  const selected = filteredEvents.find(event => event.incidentId === selectedId) || (isMobileViewport ? undefined : filteredEvents[0]);
  const serverCount = events.filter(event => event.status >= 500).length;
  const clientCount = events.length - serverCount;
  const filters = [
    { key: 'all' as const, label: '全部', count: events.length },
    { key: 'server' as const, label: '服务器错误', count: serverCount },
    { key: 'client' as const, label: '请求错误', count: clientCount },
  ];

  return <div className="square-ui flex min-h-full w-full flex-col gap-5 overflow-visible lg:h-full lg:overflow-hidden">
    <Header title="事件日志" subtitle="按事件编号查询系统错误、接口状态与发生时间。">
      <button type="button" onClick={() => void fetchEvents()} className="inline-flex h-10 items-center justify-center gap-2 border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
        <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />刷新
      </button>
    </Header>

    <section className="grid min-h-0 flex-1 grid-cols-1 gap-5 overflow-visible lg:overflow-hidden" style={isMobileViewport ? undefined : { gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)' }}>
      <div className="flex min-h-0 flex-col overflow-visible bg-white lg:overflow-hidden">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-white p-3">
          <div className="relative w-full min-w-0 sm:w-[300px] sm:flex-none">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索事件编号、错误码、用户或接口" className="block h-10 w-full border border-slate-200 bg-white pl-9 pr-9 text-sm text-slate-700 outline-none focus:border-slate-300 focus:ring-2 focus:ring-slate-100" />
            {search && <button type="button" onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400" aria-label="清空搜索"><X size={14} /></button>}
          </div>
          <div className="flex w-full items-center gap-1 overflow-x-auto sm:ml-auto sm:w-auto">
            {filters.map(filter => <button key={filter.key} type="button" onClick={() => setLevel(filter.key)} className={`flex h-8 items-center gap-1.5 px-2.5 text-xs font-medium ${level === filter.key ? 'bg-primary-600 text-white' : 'text-slate-500 hover:text-slate-900'}`}>
              {filter.label}<span className="font-semibold tabular-nums">{filter.count}</span>
            </button>)}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-visible lg:overflow-y-auto">
          {loading ? <LoadingSpinner fullPage message="加载事件日志..." /> : filteredEvents.length === 0 ? <div className="flex h-full min-h-[420px] flex-col items-center justify-center text-slate-400"><FileWarning size={34} className="mb-3 text-slate-300" /><div className="text-sm">暂无事件日志</div></div> : <>
            <div className="sticky top-0 z-40 hidden min-h-10 items-center gap-3 bg-white px-4 text-xs font-semibold text-slate-500 lg:grid" style={{ gridTemplateColumns: TABLE_COLUMNS }}>
              {['事件编号', '错误码', '时间', '错误信息', '接口'].map(label => <div key={label} className="flex h-10 items-center gap-1">{label}<ChevronDown size={13} className="text-slate-300" /></div>)}
            </div>
            {filteredEvents.map(event => {
              const serverError = event.status >= 500;
              return <button key={event.incidentId} type="button" onClick={() => setSelectedId(event.incidentId)} className={`grid min-h-[72px] w-full grid-cols-1 items-center gap-1 border-b border-slate-100 px-4 py-3 text-left text-sm lg:min-h-[48px] lg:gap-3 lg:py-2.5 ${serverError ? 'bg-red-50/80 hover:bg-red-100/70' : 'bg-amber-50/70 hover:bg-amber-100/60'} ${selected?.incidentId === event.incidentId ? 'app-selected-border relative z-10' : ''}`} style={isMobileViewport ? undefined : { gridTemplateColumns: TABLE_COLUMNS }}>
                <div className="truncate font-mono text-xs font-semibold text-slate-900">{event.incidentId}</div>
                <div className="truncate font-mono text-xs text-slate-700">{event.errorCode}</div>
                <div className="truncate font-mono text-xs text-slate-500">{formatTime(event.timestamp)}</div>
                <div className="truncate text-slate-600" title={event.message}>{event.message || '-'}</div>
                <div className="truncate font-mono text-xs text-slate-500" title={event.path}>{event.method} · {event.path}</div>
              </button>;
            })}
          </>}
        </div>
      </div>

      <aside className={`${selected ? 'fixed inset-0 z-[60] flex' : 'hidden'} min-h-0 flex-col overflow-hidden border-l border-slate-200 bg-white lg:static lg:flex`}>
        {selected ? <>
          <div className={`relative shrink-0 px-5 pb-4 pt-[calc(1.25rem+env(safe-area-inset-top))] ${selected.status >= 500 ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}`}>
            <button type="button" onClick={() => setSelectedId(null)} className="absolute right-4 top-[calc(1rem+env(safe-area-inset-top))] flex h-9 w-9 items-center justify-center text-slate-500 lg:hidden"><X size={18} /></button>
            <div className="flex items-center gap-2 text-xs font-medium text-slate-500"><AlertCircle size={15} />事件详情</div>
            <h2 className="mt-2 truncate text-lg font-semibold text-slate-950">{selected.errorCode}</h2>
            <div className="mt-1 font-mono text-xs text-slate-500">{selected.incidentId}</div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
            <DetailLine label="incident_id" value={selected.incidentId} mono />
            <DetailLine label="error_code" value={selected.errorCode} mono />
            <DetailLine label="status" value={selected.status} mono />
            <DetailLine label="time" value={formatTime(selected.timestamp)} mono />
            <DetailLine label="user" value={selected.userName || selected.userId} />
            <DetailLine label="method" value={selected.method} mono />
            <DetailLine label="path" value={selected.path} mono />
            <DetailLine label="duration_ms" value={selected.durationMs} mono />
            <DetailLine label="message" value={selected.message} />
            {selected.stack && <DetailLine label="stack" value={selected.stack} mono />}
          </div>
        </> : <div className="flex h-full min-h-[360px] flex-col items-center justify-center p-6 text-center"><FileWarning size={30} className="text-slate-300" /><div className="mt-3 text-sm font-semibold text-slate-800">选择事件查看详情</div></div>}
      </aside>
    </section>
  </div>;
}
