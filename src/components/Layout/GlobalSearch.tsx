import { useEffect, useMemo, useRef, useState } from 'react';
import { Cloud, FileText, FolderKanban, Search, Settings, SquareCheck, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { useProjectStore } from '../../store/projectStore';
import { useWorkLogStore } from '../../store/workLogStore';
import { useAuthStore } from '../../store/authStore';
import { buildGlobalSearchResults, type GlobalSearchFile, type GlobalSearchResult, type GlobalSearchTask } from '../../utils/globalSearch';

function getToken(): string | null {
  return localStorage.getItem('auth_token');
}

function ResultIcon({ type }: { type: GlobalSearchResult['type'] }) {
  if (type === 'project') return <FolderKanban size={15} />;
  if (type === 'worklog') return <FileText size={15} />;
  if (type === 'file') return <Cloud size={15} />;
  if (type === 'task') return <SquareCheck size={15} />;
  return <Settings size={15} />;
}

export default function GlobalSearch() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [cloudFiles, setCloudFiles] = useState<GlobalSearchFile[]>([]);
  const [cloudLoaded, setCloudLoaded] = useState(false);
  const [tasks, setTasks] = useState<GlobalSearchTask[]>([]);
  const [tasksLoaded, setTasksLoaded] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const { products } = useProjectStore(useShallow(state => ({ products: state.products })));
  const { entries } = useWorkLogStore(useShallow(state => ({ entries: state.entries })));
  const user = useAuthStore(state => state.user);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, []);

  useEffect(() => {
    if (!open || cloudLoaded) return;
    let cancelled = false;
    const loadCloudFiles = async () => {
      try {
        const token = getToken();
        const headers = new Headers();
        if (token) headers.set('Authorization', `Bearer ${token}`);
        const res = await fetch('/api/clouddrive', { headers });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) {
          setCloudFiles(Array.isArray(data.items) ? data.items : []);
          setCloudLoaded(true);
        }
      } catch {
        if (!cancelled) setCloudLoaded(true);
      }
    };
    loadCloudFiles();
    return () => {
      cancelled = true;
    };
  }, [cloudLoaded, open]);

  useEffect(() => {
    if (!open || tasksLoaded) return;
    let cancelled = false;
    const loadTasks = async () => {
      try {
        const token = getToken();
        const headers = new Headers();
        if (token) headers.set('Authorization', `Bearer ${token}`);
        const res = await fetch('/api/tasks/search-index', { headers });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setTasks(Array.isArray(data.items) ? data.items : []);
      } finally {
        if (!cancelled) setTasksLoaded(true);
      }
    };
    void loadTasks();
    return () => { cancelled = true; };
  }, [open, tasksLoaded]);

  const results = useMemo(() => buildGlobalSearchResults({
    query,
    products,
    entries,
    tasks,
    files: cloudFiles,
    user,
    limit: 12,
  }), [cloudFiles, entries, products, query, tasks, user]);

  const goToResult = (result: GlobalSearchResult) => {
    setQuery('');
    setOpen(false);
    navigate(result.href);
  };

  return (
    <div ref={rootRef} className="relative w-full sm:w-80">
      <div className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-600 focus-within:border-slate-300 focus-within:shadow-sm">
        <Search size={16} className="shrink-0 text-slate-400" />
        <input
          value={query}
          onChange={event => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={event => {
            if (event.key === 'Enter' && results[0]) goToResult(results[0]);
            if (event.key === 'Escape') setOpen(false);
          }}
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-slate-400"
          placeholder="全局搜索任务、动态、项目、周报..."
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setOpen(false);
            }}
            className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
            aria-label="清空搜索"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          {results.length === 0 ? (
            <div className="px-4 py-5 text-center text-sm text-slate-500">没有找到相关结果</div>
          ) : (
            <div className="max-h-80 overflow-y-auto py-1">
              {results.map(result => (
                <button
                  key={result.id}
                  type="button"
                  onClick={() => goToResult(result)}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                    <ResultIcon type={result.type} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-slate-900">{result.title}</span>
                    <span className="block truncate text-xs text-slate-500">{result.description}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
