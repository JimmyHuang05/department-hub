import { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Bell,
  CalendarClock,
  Cloud,
  FileText,
  FolderCog,
  FolderKanban,
  Grid3X3,
  Inbox,
  Lock,
  Palette,
  Search,
  Sparkles,
  SquareCheck,
  User,
  Wrench,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useProjectStore } from '../store/projectStore';
import { useWorkLogStore } from '../store/workLogStore';
import { useAuthStore } from '../store/authStore';
import { api } from '../lib/api';
import {
  buildGlobalSearchResults,
  type GlobalSearchFile,
  type GlobalSearchKind,
  type GlobalSearchResult,
  type GlobalSearchTask,
} from '../utils/globalSearch';
import { MobileBaseAppbar, MobileBaseAppEntry, MobileBaseSettingsRow } from '../components/Mobile';

function SearchResultIcon({ type }: { type: GlobalSearchKind }) {
  if (type === 'project') return <FolderKanban size={20} />;
  if (type === 'worklog') return <FileText size={20} />;
  if (type === 'file') return <Cloud size={20} />;
  if (type === 'task') return <SquareCheck size={20} />;
  return <Grid3X3 size={20} />;
}

function SearchResultRow({ result, query, onClick }: { result: GlobalSearchResult; query: string; onClick: () => void }) {
  const normalizedQuery = query.trim();
  const index = normalizedQuery ? result.title.toLocaleLowerCase('zh-CN').indexOf(normalizedQuery.toLocaleLowerCase('zh-CN')) : -1;
  return (
    <button type="button" className={`mobile-base-search-row is-${result.type}`} onClick={onClick}>
      <span className={`mobile-base-search-row__icon is-${result.type}`}><SearchResultIcon type={result.type} /></span>
      <span className="mobile-base-search-row__copy">
        <strong>
          {index >= 0 ? <>{result.title.slice(0, index)}<mark>{result.title.slice(index, index + normalizedQuery.length)}</mark>{result.title.slice(index + normalizedQuery.length)}</> : result.title}
        </strong>
        <small>{result.description}</small>
      </span>
      <span className="mobile-base-search-row__arrow">›</span>
    </button>
  );
}

export function MobileSearchPage() {
  const navigate = useNavigate();
  const products = useProjectStore(state => state.products);
  const entries = useWorkLogStore(state => state.entries);
  const user = useAuthStore(state => state.user);
  const [query, setQuery] = useState('');
  const [files, setFiles] = useState<GlobalSearchFile[]>([]);
  const [tasks, setTasks] = useState<GlobalSearchTask[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([
      api.get<{ items: GlobalSearchFile[] }>('/clouddrive'),
      api.get<{ items: GlobalSearchTask[] }>('/tasks/search-index'),
    ]).then(([fileResult, taskResult]) => {
      if (cancelled) return;
      if (fileResult.status === 'fulfilled') setFiles(fileResult.value.items || []);
      if (taskResult.status === 'fulfilled') setTasks(taskResult.value.items || []);
    });
    return () => { cancelled = true; };
  }, []);

  const results = useMemo(() => buildGlobalSearchResults({ query, products, entries, tasks, files, user, limit: 40 }), [entries, files, products, query, tasks, user]);
  const groups = [
    { key: 'task', label: '任务', items: results.filter(item => item.type === 'task') },
    { key: 'project', label: '项目', items: results.filter(item => item.type === 'project') },
    { key: 'worklog', label: '周报', items: results.filter(item => item.type === 'worklog') },
    { key: 'file', label: '文件', items: results.filter(item => item.type === 'file') },
    { key: 'page', label: '功能', items: results.filter(item => item.type === 'page') },
  ].filter(group => group.items.length > 0);

  return (
    <div className="mobile-base-page mobile-base-search-page square-ui">
      <section className="mobile-base-search-hero">
        <MobileBaseAppbar title="全局搜索" backLabel="返回" onBack={() => navigate(-1)} />
        <label className="mobile-base-search-input">
          <Search size={21} />
          <input
            aria-label="全局搜索"
            autoFocus
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="搜索任务、项目、周报或文件"
          />
          <button type="button" onClick={() => query ? setQuery('') : navigate(-1)}>取消</button>
        </label>
      </section>
      <main className="mobile-base-search-results">
        {groups.map(group => (
          <section key={group.key} className="mobile-base-result-group">
            <header><span>{group.label}</span><span>{group.items.length} 个结果</span></header>
            <div className="mobile-base-surface">
              {group.items.map(result => <SearchResultRow key={result.id} result={result} query={query} onClick={() => navigate(result.href)} />)}
            </div>
          </section>
        ))}
        {groups.length === 0 && <div className="mobile-base-no-results">没有找到相关结果</div>}
      </main>
    </div>
  );
}

export function MobileMorePage() {
  const navigate = useNavigate();
  const entries = [
    { icon: Inbox, label: '问卷', path: '/questionnaires', background: '#edf3ff', color: '#3370ff' },
    { icon: BarChart3, label: '问卷分析', path: '/questionnaire-results', background: '#eaf9f3', color: '#239568' },
    { icon: Cloud, label: '云盘', path: '/cloud-drive', background: '#fff5e7', color: '#df8a1e' },
    { icon: Wrench, label: '工具', path: '/tools', background: '#f1edff', color: '#7758d7' },
    { icon: Sparkles, label: '技能', path: '/skills', background: '#eaf6ff', color: '#2c86bb' },
    { icon: CalendarClock, label: '定时任务', path: '/admin/scheduled-jobs', background: '#fff0ef', color: '#d95752' },
    { icon: Search, label: '全局搜索', path: '/search', background: '#edf3ff', color: '#3370ff' },
    { icon: FolderCog, label: '产品设置', path: '/settings', background: '#f0f1f2', color: '#646a73' },
  ];
  return (
    <div className="mobile-base-page mobile-base-more-page square-ui">
      <MobileBaseAppbar title="更多功能" />
      <div className="mobile-base-group-title">业务工具</div>
      <section className="mobile-base-surface mobile-base-apps-grid">
        {entries.map(item => <MobileBaseAppEntry key={item.label} {...item} onClick={() => navigate(item.path)} />)}
      </section>
      <div className="mobile-base-group-title">个人与系统</div>
      <section className="mobile-base-settings-group">
        <MobileBaseSettingsRow icon={User} label="个人中心" value="资料、安全与偏好" onClick={() => navigate('/profile')} />
        <MobileBaseSettingsRow icon={Bell} label="通知设置" value="已开启" onClick={() => navigate('/profile?section=preferences')} />
        <MobileBaseSettingsRow icon={Palette} label="外观设置" value="跟随系统" onClick={() => navigate('/appearance')} />
        <MobileBaseSettingsRow icon={Lock} label="权限与隐私" onClick={() => navigate('/profile?section=security')} />
      </section>
    </div>
  );
}
