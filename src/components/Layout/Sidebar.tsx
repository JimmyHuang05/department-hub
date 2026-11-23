import { Link, useLocation } from 'react-router-dom';
import {
  ChevronDown,
  ChevronLeft,
  CalendarClock,
  Bell,
  BarChart3,
  ClipboardList,
  Cloud,
  DatabaseBackup,
  FileText,
  FileWarning,
  FolderCog,
  Folder,
  FolderKanban,
  Grid2X2,
  History,
  House,
  LayoutDashboard,
  MessageSquare,
  Palette,
  Search,
  Sparkles,
  SquareCheck,
  User,
  Users,
  WifiOff,
  Wrench,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { useAuthStore } from '../../store/authStore';
import { useCollaborationStore } from '../../store/collaborationStore';
import { useProjectStore } from '../../store/projectStore';
import { useUiPreferenceStore } from '../../store/uiPreferenceStore';
import { useWorkLogStore } from '../../store/workLogStore';
import UserProfileAvatar from '../UserProfileAvatar';
import { buildGlobalSearchResults, type GlobalSearchFile, type GlobalSearchResult, type GlobalSearchTask } from '../../utils/globalSearch';
import { api } from '../../lib/api';
import { _toast } from '../../store/toastRef';
import { clearRecentVisits, readRecentVisits, recordRecentVisit, type RecentVisit } from '../../utils/recentVisits';
import { getCurrentWeekKey } from '../../utils/week';
import { useMobileViewport } from '../../hooks/useMobileViewport';
import {
  clearWeeklyTodoSearch,
  notifyWeeklyTodoHandled,
  OPEN_WEEKLY_TODO_SEARCH_EVENT,
  readWeeklyTodoSearch,
  saveWeeklyTodoSearch,
  WEEKLY_TODO_SEARCH_QUERY,
  weeklyTodoBadgeClass,
  weeklyTodoToneClass,
  type WeeklyTodoSearchDetail,
  type WeeklyTodoSearchResult,
} from '../../utils/weeklyTodoSearch';

function escapeSearchToken(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function HighlightedSearchText({ text, query }: { text: string; query: string }) {
  const tokens = Array.from(new Set(
    query.trim().split(/\s+/).map(token => token.toLocaleLowerCase('zh-CN')).filter(Boolean),
  )).sort((left, right) => right.length - left.length);
  if (tokens.length === 0 || !text) return <>{text}</>;

  const tokenSet = new Set(tokens);
  const pattern = new RegExp(`(${tokens.map(escapeSearchToken).join('|')})`, 'gi');
  return (
    <>
      {text.split(pattern).map((part, index) => (
        tokenSet.has(part.toLocaleLowerCase('zh-CN')) ? (
          <mark key={`${part}-${index}`} className="rounded-sm bg-amber-200 px-0.5 text-inherit">
            {part}
          </mark>
        ) : part
      ))}
    </>
  );
}

function MobileGlobalSearchIcon({ type }: { type: GlobalSearchResult['type'] }) {
  if (type === 'project') return <FolderKanban size={18} />;
  if (type === 'worklog') return <FileText size={18} />;
  if (type === 'task') return <SquareCheck size={18} />;
  if (type === 'file') return <Cloud size={18} />;
  return <Grid2X2 size={18} />;
}

interface MenuItem {
  key: string;
  label: string;
  icon: typeof LayoutDashboard;
  path: string;
  children?: Array<{
    key: string;
    label: string;
    path: string;
    icon: typeof LayoutDashboard;
  }>;
}

interface MenuGroup {
  title?: string;
  items: MenuItem[];
}

function OnlineAvatar({
  userId,
  displayName,
  color,
}: {
  userId: string;
  displayName: string;
  color: string;
}) {
  return (
    <UserProfileAvatar
      userId={userId}
      displayName={displayName}
      className="h-7 w-7 border-2 border-white text-xs shadow-sm"
      style={{ backgroundColor: color || '#334155' }}
    />
  );
}

function uniqueUsers<T extends { userId: string }>(users: T[]) {
  const map = new Map<string, T>();
  users.forEach(user => {
    if (!user?.userId || map.has(user.userId)) return;
    map.set(user.userId, user);
  });
  return [...map.values()];
}

function ConnectionInfo({ collapsed }: { collapsed?: boolean }) {
  const { connected, onlineUsers } = useCollaborationStore(useShallow(s => ({
    connected: s.connected,
    onlineUsers: s.onlineUsers,
  })));
  const displayUsers = useMemo(() => uniqueUsers(onlineUsers), [onlineUsers]);
  const visibleUsers = displayUsers.slice(0, collapsed ? 2 : 6);

  if (collapsed) {
    return (
      <div
        title={connected ? '在线人员' : '未连接'}
        className="app-collapsed-action flex h-10 w-10 items-center justify-center text-surface-400"
      >
        {!connected ? (
          <WifiOff size={16} className="text-danger-500" />
        ) : visibleUsers.length > 0 ? (
          <span className="flex -space-x-2">
            {visibleUsers.map(user => (
              <OnlineAvatar key={user.userId} {...user} />
            ))}
          </span>
        ) : (
          <Users size={16} />
        )}
      </div>
    );
  }

  return (
    <div
      title="在线人员"
      className="flex h-10 w-full items-center gap-2 rounded-none pl-[17.5px] pr-3 text-xs text-surface-500"
    >
      {!connected ? (
        <>
          <WifiOff size={16} className="shrink-0 text-danger-500" />
          <span className="min-w-0 flex-1 truncate">未连接</span>
        </>
      ) : (
        <>
          <span className="flex -space-x-2">
            {visibleUsers.length > 0 ? (
              visibleUsers.map(user => (
                <OnlineAvatar key={user.userId} {...user} />
              ))
            ) : (
              <span className="flex h-7 w-7 items-center justify-center border-2 border-white bg-surface-200 text-surface-500">
                <Users size={14} />
              </span>
            )}
          </span>
          <span className="min-w-0 flex-1" />
        </>
      )}
    </div>
  );
}

export default function Sidebar({ mobileOnly = false }: { mobileOnly?: boolean }) {
  const location = useLocation();
  const showOnlineUsers = useUiPreferenceStore(state => state.preferences.showOnlineUsers);
  const preferredSidebarExpanded = useUiPreferenceStore(state => state.preferences.sidebarExpanded);
  const uiPreferencesLoaded = useUiPreferenceStore(state => state.loaded);
  const updateUiPreferences = useUiPreferenceStore(state => state.updatePreferences);
  const navigate = useNavigate();
  const user = useAuthStore(s => s.user);
  const products = useProjectStore(s => s.products);
  const entries = useWorkLogStore(s => s.entries);
  const isAdvancedUser = user?.role === 'admin';
  const isDeveloper = user?.business_role === 'developer';
  const initialWeeklyTodoSearch = useMemo(() => readWeeklyTodoSearch(), []);
  const [isMobileOpen, setIsMobileOpen] = useState(() => (
    Boolean(initialWeeklyTodoSearch) && window.matchMedia('(max-width: 1023px)').matches
  ));
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const [searchActive, setSearchActive] = useState(Boolean(initialWeeklyTodoSearch));
  const [globalSearch, setGlobalSearch] = useState(initialWeeklyTodoSearch ? WEEKLY_TODO_SEARCH_QUERY : '');
  const [weeklyTodoResults, setWeeklyTodoResults] = useState<WeeklyTodoSearchResult[] | null>(
    initialWeeklyTodoSearch?.results || null,
  );
  const [weeklyTodoWeekKey, setWeeklyTodoWeekKey] = useState(
    initialWeeklyTodoSearch?.weekKey || getCurrentWeekKey(),
  );
  const [handlingWeeklyTodoIds, setHandlingWeeklyTodoIds] = useState<Set<string>>(() => new Set());
  const [mobileKeyboardOpen, setMobileKeyboardOpen] = useState(false);
  const [mobileUnreadCount, setMobileUnreadCount] = useState(0);
  const isMobileViewport = useMobileViewport();
  const [selectedSearchIndex, setSelectedSearchIndex] = useState(0);
  const [recentVisits, setRecentVisits] = useState<RecentVisit[]>([]);
  const [cloudFiles, setCloudFiles] = useState<GlobalSearchFile[]>([]);
  const [cloudFilesLoaded, setCloudFilesLoaded] = useState(false);
  const [searchTasks, setSearchTasks] = useState<GlobalSearchTask[]>([]);
  const [searchTasksLoaded, setSearchTasksLoaded] = useState(false);
  const [expandedMenus, setExpandedMenus] = useState<Record<string, boolean>>({});
  const searchInputRef = useRef<HTMLInputElement>(null);
  const handlingWeeklyTodoIdsRef = useRef(new Set<string>());
  const collapsed = !isMobileOpen && !sidebarExpanded && !searchActive;

  useEffect(() => {
    if (uiPreferencesLoaded) setSidebarExpanded(preferredSidebarExpanded);
  }, [preferredSidebarExpanded, uiPreferencesLoaded]);

  useEffect(() => {
    if (!isMobileViewport || !window.visualViewport) {
      setMobileKeyboardOpen(false);
      return;
    }
    const viewport = window.visualViewport;
    const update = () => setMobileKeyboardOpen(viewport.height < window.innerHeight * 0.78);
    update();
    viewport.addEventListener('resize', update);
    return () => viewport.removeEventListener('resize', update);
  }, [isMobileViewport]);

  useEffect(() => {
    if (!isMobileViewport) return;
    let cancelled = false;
    api.get<{ counts?: { unread?: number } }>('/notifications?filter=unread')
      .then(result => { if (!cancelled) setMobileUnreadCount(Math.max(0, Number(result.counts?.unread || 0))); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [isMobileViewport, location.pathname]);

  const menuGroups: MenuGroup[] = [
    {
      items: [
        { key: 'dashboard', label: '工作台', icon: LayoutDashboard, path: '/dashboard' },
        { key: 'tasks', label: '消息', icon: Bell, path: '/tasks' },
        { key: 'discussions', label: '任务', icon: SquareCheck, path: '/discussions' },
      ],
    },
    {
      title: '数据分析',
      items: [
        { key: 'worklog', label: '管理周报', icon: FileText, path: '/worklog' },
        { key: 'projects', label: '项目进度', icon: FolderKanban, path: '/projects' },
        { key: 'questionnaire-results', label: '问卷分析', icon: BarChart3, path: '/questionnaire-results' },
      ],
    },
    {
      title: '工具集',
      items: [
        { key: 'cloud-drive', label: '云盘', icon: Cloud, path: '/cloud-drive' },
        { key: 'tools', label: '工具', icon: Wrench, path: '/tools' },
        { key: 'skills', label: '技能', icon: Sparkles, path: '/skills' },
        { key: 'questionnaires', label: '问卷', icon: ClipboardList, path: '/questionnaires' },
      ],
    },
    {
      title: '应用',
      items: [
        { key: 'applications', label: '应用中心', icon: Grid2X2, path: '/applications' },
      ],
    },
    {
      title: '系统设置',
      items: [
        { key: 'settings', label: '产品设置', icon: FolderCog, path: '/settings' },
        { key: 'appearance', label: '外观设置', icon: Palette, path: '/appearance' },
      ],
    },
    ...(isAdvancedUser || isDeveloper
      ? [{
          title: '后端服务',
          items: [
            ...(isAdvancedUser ? [
              { key: 'user-management', label: '人员管理', icon: Users, path: '/admin/users' },
              { key: 'scheduled-jobs', label: '定时任务', icon: CalendarClock, path: '/admin/scheduled-jobs' },
            ] : []),
            ...(isDeveloper ? [
              { key: 'backups', label: '数据备份', icon: DatabaseBackup, path: '/admin/backups' },
              { key: 'audit-log', label: '操作日志', icon: History, path: '/audit' },
              { key: 'event-log', label: '事件日志', icon: FileWarning, path: '/admin/error-events' },
            ] : []),
          ],
        }]
      : []),
  ];

  const searchResults = useMemo(() => {
    const results = buildGlobalSearchResults({
      query: globalSearch,
      products,
      entries,
      tasks: searchTasks,
      files: cloudFiles,
      user,
      limit: 10,
    });
    if (!isMobileViewport) return results;
    const mobilePagePaths = new Set(['/dashboard', '/tasks', '/discussions', '/worklog', '/projects', '/questionnaire-results', '/cloud-drive', '/questionnaires', '/profile']);
    return results.filter(result => result.type !== 'page' || mobilePagePaths.has(result.href));
  }, [cloudFiles, entries, globalSearch, isMobileViewport, products, searchTasks, user]);

  useEffect(() => {
    if (!searchActive || cloudFilesLoaded) return;
    let cancelled = false;
    api.get<{ items: GlobalSearchFile[] }>('/clouddrive')
      .then(result => { if (!cancelled) setCloudFiles(result.items || []); })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setCloudFilesLoaded(true); });
    return () => { cancelled = true; };
  }, [cloudFilesLoaded, searchActive]);

  useEffect(() => {
    if (!searchActive || searchTasksLoaded) return;
    let cancelled = false;
    api.get<{ items: GlobalSearchTask[] }>('/tasks/search-index')
      .then(result => { if (!cancelled) setSearchTasks(result.items || []); })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setSearchTasksLoaded(true); });
    return () => { cancelled = true; };
  }, [searchActive, searchTasksLoaded]);

  const rememberVisit = useCallback((result: GlobalSearchResult) => {
    if (!user?.id || (result.type !== 'project' && result.type !== 'worklog')) return;
    setRecentVisits(recordRecentVisit(user.id, result));
  }, [user?.id]);

  useEffect(() => {
    setRecentVisits(readRecentVisits(user?.id));
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    const params = new URLSearchParams(location.search);
    const href = `${location.pathname}${location.search}`;
    const projectId = params.get('projectId') || params.get('tableRow');
    if (location.pathname === '/projects' && projectId) {
      const product = products.find(item => item.id === projectId);
      if (product) {
        rememberVisit({
          id: `project-${product.id}`,
          title: product.productName || '未命名项目',
          description: [product.status, product.trustManager, product.trustManagerB, product.client].filter(Boolean).join(' · '),
          type: 'project',
          href,
        });
      }
      return;
    }
    const entryId = params.get('entryId');
    if (location.pathname === '/worklog' && entryId) {
      const entry = entries.find(item => item.id === entryId);
      if (entry) {
        rememberVisit({
          id: `worklog-${entry.id}`,
          title: entry.productName || '未命名周报',
          description: [entry.category, entry.status, [entry.personA, entry.personB].filter(Boolean).join(' / ')].filter(Boolean).join(' · '),
          type: 'worklog',
          href,
        });
      }
    }
  }, [entries, location.pathname, location.search, products, rememberVisit, user?.id]);

  const hasSearchQuery = Boolean(globalSearch.trim());
  const isWeeklyTodoSearch = globalSearch.trim() === WEEKLY_TODO_SEARCH_QUERY && weeklyTodoResults !== null;
  const displaySearchResults = useMemo(() => {
    if (isWeeklyTodoSearch) return weeklyTodoResults;
    if (hasSearchQuery || recentVisits.length === 0) return searchResults;
    const recentIds = new Set(recentVisits.map(item => item.id));
    return [...recentVisits, ...searchResults.filter(item => !recentIds.has(item.id))].slice(0, 10);
  }, [hasSearchQuery, isWeeklyTodoSearch, recentVisits, searchResults, weeklyTodoResults]);
  const recentVisitIds = useMemo(() => new Set(recentVisits.map(item => item.id)), [recentVisits]);

  const isActivePath = (path: string) => {
    if (path === '/dashboard') return location.pathname === path;
    return location.pathname === path || location.pathname.startsWith(`${path}/`);
  };

  const navItemClass = (active: boolean) => collapsed
    ? `app-nav-item app-collapsed-nav-item group mx-auto flex h-10 w-10 items-center justify-center transition-colors ${
        active ? 'is-active text-primary-700' : 'text-surface-500 hover:text-primary-700'
      }`
    : `app-nav-item group flex h-10 items-center gap-3 pl-[16.5px] pr-3 text-sm transition-colors ${
        active ? 'is-active text-white shadow-sm shadow-primary-600/20' : 'text-surface-600 hover:bg-primary-50 hover:text-surface-900'
      }`;

  const openSearch = () => {
    setSearchActive(true);
    window.setTimeout(() => searchInputRef.current?.focus(), collapsed ? 180 : 0);
  };

  const closeSearch = () => {
    setSearchActive(false);
    setGlobalSearch('');
    setWeeklyTodoResults(null);
    clearWeeklyTodoSearch();
    setSelectedSearchIndex(0);
    searchInputRef.current?.blur();
  };

  const collapseSidebar = () => {
    if (searchActive) closeSearch();
    setSidebarExpanded(false);
    void updateUiPreferences({ sidebarExpanded: false }, '侧栏偏好保存失败');
  };

  const expandSidebar = () => {
    setSidebarExpanded(true);
    void updateUiPreferences({ sidebarExpanded: true }, '侧栏偏好保存失败');
  };

  const removeWeeklyTodoResult = useCallback((itemId: string) => {
    setWeeklyTodoResults(current => {
      if (!current) return current;
      const next = current.filter(item => item.id !== itemId);
      saveWeeklyTodoSearch(next, weeklyTodoWeekKey);
      return next;
    });
    setSelectedSearchIndex(current => Math.max(current - 1, 0));
  }, [weeklyTodoWeekKey]);

  const completeWeeklyTodo = useCallback(async (
    result: WeeklyTodoSearchResult,
    announceNoChange = false,
  ) => {
    if (handlingWeeklyTodoIdsRef.current.has(result.id)) return;
    handlingWeeklyTodoIdsRef.current.add(result.id);
    setHandlingWeeklyTodoIds(current => new Set(current).add(result.id));
    try {
      await api.post('/preferences/todo-snoozes', {
        weekKey: weeklyTodoWeekKey,
        itemId: result.id,
      });
      removeWeeklyTodoResult(result.id);
      notifyWeeklyTodoHandled(result.id);
      if (announceNoChange) _toast.success?.(`“${result.title}”已标记为本周无改动`);
    } catch (error: any) {
      _toast.error?.(error.message || '更新本周待办失败');
    } finally {
      handlingWeeklyTodoIdsRef.current.delete(result.id);
      setHandlingWeeklyTodoIds(current => {
        const next = new Set(current);
        next.delete(result.id);
        return next;
      });
    }
  }, [removeWeeklyTodoResult, weeklyTodoWeekKey]);

  useEffect(() => {
    if (!weeklyTodoResults?.length) return;
    weeklyTodoResults.forEach(result => {
      if (!result.sourceUpdatedAt) return;
      const sourceId = result.id.replace(/^(worklog|project)-/, '');
      const source = result.type === 'worklog'
        ? entries.find(entry => entry.id === sourceId)
        : result.type === 'project'
          ? products.find(product => product.id === sourceId)
          : undefined;
      if (source?.updatedAt && source.updatedAt !== result.sourceUpdatedAt) {
        void completeWeeklyTodo(result);
      }
    });
  }, [completeWeeklyTodo, entries, products, weeklyTodoResults]);

  useEffect(() => {
    const handleOpenWeeklyTodoSearch = (event: Event) => {
      const detail = (event as CustomEvent<WeeklyTodoSearchDetail>).detail;
      const results = detail?.results || [];
      const weekKey = detail?.weekKey || getCurrentWeekKey();
      saveWeeklyTodoSearch(results, weekKey);
      setWeeklyTodoResults(results);
      setWeeklyTodoWeekKey(weekKey);
      setGlobalSearch(WEEKLY_TODO_SEARCH_QUERY);
      setSelectedSearchIndex(0);
      if (window.matchMedia('(max-width: 1023px)').matches) setIsMobileOpen(true);
      setSearchActive(true);
      window.setTimeout(() => searchInputRef.current?.focus(), collapsed ? 180 : 0);
    };
    window.addEventListener(OPEN_WEEKLY_TODO_SEARCH_EVENT, handleOpenWeeklyTodoSearch);
    return () => window.removeEventListener(OPEN_WEEKLY_TODO_SEARCH_EVENT, handleOpenWeeklyTodoSearch);
  }, [collapsed]);

  useEffect(() => {
    setSelectedSearchIndex(current => Math.min(current, Math.max(displaySearchResults.length - 1, 0)));
  }, [displaySearchResults.length]);

  useEffect(() => {
    const handleGlobalSearchKeys = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (window.matchMedia('(max-width: 1023px)').matches) setIsMobileOpen(true);
        setSearchActive(true);
        window.setTimeout(() => searchInputRef.current?.focus(), collapsed ? 180 : 0);
        return;
      }
      if (!searchActive) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelectedSearchIndex(current => Math.min(current + 1, Math.max(displaySearchResults.length - 1, 0)));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelectedSearchIndex(current => Math.max(current - 1, 0));
      } else if (event.key === 'Enter' && displaySearchResults[selectedSearchIndex]) {
        event.preventDefault();
        const target = displaySearchResults[selectedSearchIndex];
        rememberVisit(target);
        if (!isWeeklyTodoSearch) {
          setSearchActive(false);
          setGlobalSearch('');
          setWeeklyTodoResults(null);
          setSelectedSearchIndex(0);
          setIsMobileOpen(false);
        }
        navigate(target.href);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        if (isWeeklyTodoSearch) {
          searchInputRef.current?.focus();
          return;
        }
        setSearchActive(false);
        setGlobalSearch('');
        setWeeklyTodoResults(null);
        setSelectedSearchIndex(0);
        searchInputRef.current?.blur();
      }
    };
    window.addEventListener('keydown', handleGlobalSearchKeys);
    return () => window.removeEventListener('keydown', handleGlobalSearchKeys);
  }, [collapsed, displaySearchResults, isWeeklyTodoSearch, navigate, rememberVisit, searchActive, selectedSearchIndex]);

  const resultTypeLabels = {
    project: '项目',
    worklog: '周报',
    task: '任务',
    file: '文件',
    page: '功能',
  } as const;

  const renderMenuItem = (item: MenuItem) => {
    const Icon = item.icon;
    const active = isActivePath(item.path);
    if (item.children?.length && !collapsed) {
      const expanded = expandedMenus[item.key] ?? active;
      return (
        <div key={item.key}>
          <button
            type="button"
            onClick={() => setExpandedMenus(current => ({ ...current, [item.key]: !expanded }))}
            className={`${navItemClass(active)} w-full`}
            aria-expanded={expanded}
          >
            <Icon size={18} className={`app-nav-icon shrink-0 ${active ? 'text-white' : 'text-surface-400 group-hover:text-primary-600'}`} />
            <span className="app-nav-label min-w-0 flex-1 truncate text-left">{item.label}</span>
            <ChevronDown size={15} className={`shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
          {expanded && (
            <div className="ml-5 mt-1 space-y-1 border-l border-surface-200 pl-2">
              {item.children.map(child => {
                const ChildIcon = child.icon;
                const childActive = location.pathname === child.path;
                return (
                  <Link
                    key={child.key}
                    to={child.path}
                    onClick={() => setIsMobileOpen(false)}
                    className={`group flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                      childActive
                        ? 'bg-primary-50 font-medium text-primary-700'
                        : 'text-surface-500 hover:bg-primary-50 hover:text-surface-900'
                    }`}
                  >
                    <ChildIcon size={16} className={childActive ? 'text-primary-600' : 'text-surface-400'} />
                    <span className="truncate">{child.label}</span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      );
    }

    return (
      <Link
        key={item.key}
        to={item.path}
        onClick={() => setIsMobileOpen(false)}
        title={collapsed ? item.label : undefined}
        className={navItemClass(active)}
      >
        <Icon size={18} className={`app-nav-icon shrink-0 ${
          active
            ? collapsed ? 'text-primary-700' : 'text-white'
            : 'text-surface-400 group-hover:text-primary-600'
        }`} />
        {!collapsed && <span className="app-nav-label truncate">{item.label}</span>}
      </Link>
    );
  };

  const normalSidebarBody = (
    <div className="flex h-full flex-col">
      <nav className={`app-sidebar-scroll-hidden flex-1 overflow-y-auto ${collapsed ? 'app-sidebar-collapsed-nav px-0 py-1' : 'px-2.5 py-1'}`}>
        {menuGroups.map((group, index) => {
          if (group.items.length === 0) return null;
          return (
            <div
              key={group.title || `main-${index}`}
              className={index === 0 ? '' : collapsed ? 'app-collapsed-nav-group mt-2' : 'mt-2'}
            >
              {group.title && (
                <div className={`mb-2 h-4 text-xs font-medium leading-4 tracking-normal text-surface-400 ${collapsed ? 'invisible' : 'px-3'}`}>
                  {group.title}
                </div>
              )}
              <div className="space-y-1">
                {group.items.map(renderMenuItem)}
              </div>
            </div>
          );
        })}
      </nav>

      <div className={`border-t border-surface-100 ${
        collapsed
          ? 'flex flex-col items-center gap-1 bg-white px-0 py-2.5'
          : 'space-y-1 px-2.5 py-2.5'
      }`}>
        {showOnlineUsers && <ConnectionInfo collapsed={collapsed} />}
        <Link
          to="/profile"
          onClick={() => setIsMobileOpen(false)}
          title={collapsed ? '个人中心' : undefined}
          className={navItemClass(location.pathname === '/profile')}
        >
          <User
            size={18}
            className={`app-nav-icon shrink-0 ${
              location.pathname === '/profile'
                ? collapsed ? 'text-primary-700' : 'text-white'
                : 'text-surface-400 group-hover:text-primary-600'
            }`}
          />
          {!collapsed && <span>个人中心</span>}
        </Link>
      </div>
    </div>
  );

  const sidebarContent = (
    <aside
      className={`app-sidebar flex h-full flex-col bg-white text-surface-700 transition-all duration-200 ${isMobileViewport && searchActive ? 'mobile-global-search-panel' : ''} ${
        isMobileViewport && searchActive ? 'w-full' : collapsed ? 'app-sidebar--collapsed w-[72px]' : 'w-56'
      }`}
    >
      {isMobileViewport && searchActive ? (
        <div className="mobile-global-search-appbar flex h-16 shrink-0 items-center justify-between border-b border-surface-100 px-4 pt-[env(safe-area-inset-top)]">
          <div>
            <h1 className="text-lg font-semibold text-surface-900">全局搜索</h1>
            <p className="text-xs text-surface-400">快速查找项目、周报和功能</p>
          </div>
          <button type="button" onClick={() => { closeSearch(); setIsMobileOpen(false); }} className="flex h-10 w-10 items-center justify-center text-surface-400 hover:text-surface-900" aria-label="关闭搜索">
            <X size={20} />
          </button>
        </div>
      ) : <div className={`flex h-16 shrink-0 items-center ${collapsed ? 'justify-center px-0' : 'px-[17.5px]'}`}>
        {!collapsed ? (
          <>
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden">
                <img src="/lianheng-mark.png" alt="" className="h-full w-full object-contain" />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-sm font-medium text-surface-900">全球资本运营部</h1>
                <p className="truncate text-xs text-surface-400">GCO Link</p>
              </div>
            </div>
            <button
              type="button"
              onClick={collapseSidebar}
              className="hidden h-8 w-8 shrink-0 items-center justify-center text-surface-400 transition-colors hover:bg-primary-50 hover:text-primary-600 lg:inline-flex"
              title="收起侧栏"
              aria-label="收起侧栏"
            >
              <ChevronLeft size={16} strokeWidth={1.8} />
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={expandSidebar}
            className="app-collapsed-brand relative flex h-11 w-11 items-center justify-center border-0 bg-transparent p-0"
            title="展开侧栏"
            aria-label="展开侧栏"
          >
            <div className="flex h-9 w-9 items-center justify-center overflow-hidden">
              <img src="/lianheng-mark.png" alt="" className="h-full w-full object-contain" />
            </div>
            <span className="absolute right-0 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center bg-transparent text-primary-600">
              <ChevronLeft size={10} className="rotate-180" />
            </span>
          </button>
        )}
      </div>}

      <div className={isMobileViewport && searchActive ? 'mobile-global-search-box-wrap h-16 shrink-0 px-4 py-3' : collapsed ? 'h-12 px-0 pb-2' : 'h-12 px-2.5 pb-2'}>
        {collapsed ? (
          <button
            type="button"
            onClick={openSearch}
            className="app-collapsed-search mx-auto flex h-10 w-10 items-center justify-center text-surface-500 hover:bg-primary-50 hover:text-primary-700"
            title="全局搜索"
          >
            <Search size={18} />
          </button>
        ) : (
          <div className="relative">
            <Search size={18} className="absolute left-[16.5px] top-1/2 -translate-y-1/2 text-surface-400" />
            <input
              ref={searchInputRef}
              value={globalSearch}
              onFocus={openSearch}
              onClick={openSearch}
              onChange={event => {
                const value = event.target.value;
                setGlobalSearch(value);
                setSelectedSearchIndex(0);
                if (weeklyTodoResults !== null && !value.trim()) {
                  setWeeklyTodoResults(null);
                  clearWeeklyTodoSearch();
                  setSearchActive(false);
                }
              }}
              placeholder={isMobileViewport ? '搜索任务、动态、项目或周报' : '搜索任务、动态、项目'}
              className={`app-global-search-input w-full appearance-none rounded-none border border-surface-200 bg-white pl-10 pr-9 text-sm text-surface-700 placeholder:text-surface-400 transition-colors focus:border-primary-600 ${isMobileViewport && searchActive ? 'h-11' : 'h-10'}`}
              aria-label="全局搜索"
              aria-expanded={searchActive}
              aria-controls="global-search-results"
            />
            <button
              type="button"
              onClick={closeSearch}
              className={`absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center text-surface-400 transition-opacity hover:text-primary-600 ${
                searchActive ? 'opacity-100' : 'pointer-events-none opacity-0'
              }`}
              aria-label="关闭搜索"
            >
              <X size={14} />
            </button>
          </div>
        )}
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div
          className={`absolute inset-0 transition-all duration-300 ease-out ${
            searchActive && !collapsed ? 'pointer-events-none translate-y-3 opacity-0' : 'translate-y-0 opacity-100'
          }`}
        >
          {normalSidebarBody}
        </div>

        <div
          className={`mobile-global-search-content absolute inset-0 bg-white transition-all duration-300 ease-out ${
            searchActive && !collapsed ? 'translate-y-0 opacity-100' : 'pointer-events-none -translate-y-4 opacity-0'
          }`}
        >
          <div className="flex h-full flex-col border-t border-surface-100">
            <div className={isMobileViewport ? 'mobile-global-search-meta px-4 py-3 sm:px-5' : 'px-4 py-3'}>
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-medium text-surface-400">
                  {isWeeklyTodoSearch ? '本周待办' : hasSearchQuery ? '搜索结果' : recentVisits.length > 0 ? '最近访问' : '快捷入口'}
                </div>
                <div className="flex items-center gap-2">
                  {!hasSearchQuery && recentVisits.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        clearRecentVisits(user?.id);
                        setRecentVisits([]);
                        setSelectedSearchIndex(0);
                      }}
                      className="text-xs text-surface-400 hover:text-danger-600"
                    >
                      清空记录
                    </button>
                  )}
                  {!isMobileViewport && <kbd className="border border-surface-200 bg-surface-50 px-1.5 py-0.5 text-xs text-surface-400">Ctrl K</kbd>}
                </div>
              </div>
              <div className="mt-1 text-xs text-surface-500">
                {isWeeklyTodoSearch
                  ? '修改后自动移除；无变化时可标记“本周无改动”。'
                  : hasSearchQuery
                  ? '项目、周报、客户和负责人均可直接定位。'
                  : recentVisits.length > 0
                    ? '最近打开的项目和周报仅保存在当前账号的本机。'
                    : '输入关键词，快速定位项目、周报和具体字段。'}
              </div>
            </div>
            <div id="global-search-results" className={`app-sidebar-scroll-hidden flex-1 overflow-y-auto overscroll-y-contain pb-[calc(1rem+env(safe-area-inset-bottom))] ${isMobileViewport ? 'mobile-global-search-results px-4 sm:px-5' : 'px-2.5'}`}>
              {displaySearchResults.length > 0 ? (
                <div className={isWeeklyTodoSearch ? 'mobile-global-search-list is-todo space-y-2' : 'mobile-global-search-list space-y-1'}>
                  {displaySearchResults.map((result, index) => {
                    if (isWeeklyTodoSearch) {
                      const todo = result as WeeklyTodoSearchResult;
                      return (
                        <div
                          key={todo.id}
                          onMouseEnter={() => setSelectedSearchIndex(index)}
                          className={`min-w-0 border p-3 transition hover:shadow-md ${weeklyTodoToneClass[todo.tone]} ${
                            index === selectedSearchIndex ? 'shadow-sm' : ''
                          }`}
                        >
                          <Link
                            to={todo.href}
                            onClick={() => {
                              rememberVisit(todo);
                              if (isMobileViewport) {
                                setIsMobileOpen(false);
                                closeSearch();
                              }
                            }}
                            className="block min-w-0"
                          >
                            <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
                              <span className={`shrink-0 px-2 py-1 text-xs font-medium ${weeklyTodoBadgeClass[todo.tone]}`}>
                                {todo.tone === 'danger' ? '紧急' : todo.actionLabel}
                              </span>
                              <span className="min-w-0 truncate text-right text-xs text-surface-500">
                                <HighlightedSearchText text={todo.meta} query={globalSearch} />
                              </span>
                            </div>
                            <div className="truncate text-sm font-normal">
                              <HighlightedSearchText text={todo.title} query={globalSearch} />
                            </div>
                            <div className="mt-1.5 line-clamp-2 text-xs leading-5 text-surface-600">
                              <HighlightedSearchText text={todo.description} query={globalSearch} />
                            </div>
                          </Link>
                          <div className="mt-2 flex items-center justify-between gap-2 border-t border-current/10 pt-2">
                            <button
                              type="button"
                              disabled={handlingWeeklyTodoIds.has(todo.id)}
                              onClick={() => void completeWeeklyTodo(todo, true)}
                              className="h-7 border border-current/20 bg-white/70 px-2 text-xs font-medium opacity-75 hover:bg-white hover:opacity-100 disabled:cursor-wait disabled:opacity-40"
                            >
                              {handlingWeeklyTodoIds.has(todo.id) ? '处理中…' : '本周无改动'}
                            </button>
                            <Link
                              to={todo.href}
                              onClick={() => {
                                rememberVisit(todo);
                                if (isMobileViewport) {
                                  setIsMobileOpen(false);
                                  closeSearch();
                                }
                              }}
                              className="text-xs font-medium opacity-70 hover:opacity-100"
                            >
                              处理
                            </Link>
                          </div>
                        </div>
                      );
                    }
                    return (
                      <Link
                        key={result.id}
                        to={result.href}
                        onMouseEnter={() => setSelectedSearchIndex(index)}
                        onClick={() => {
                          rememberVisit(result);
                          setIsMobileOpen(false);
                          closeSearch();
                        }}
                        className={`mobile-global-search-result block rounded-none border px-3 py-2.5 transition-colors is-${result.type} ${
                          index === selectedSearchIndex && !isMobileViewport
                            ? 'border-primary-200 bg-primary-50'
                            : 'border-transparent hover:border-surface-200 hover:bg-primary-50'
                        }`}
                      >
                        {isMobileViewport && <span className="mobile-global-search-result__icon"><MobileGlobalSearchIcon type={result.type} /></span>}
                        <span className="mobile-global-search-result__body block min-w-0">
                          <span className="mobile-global-search-result__top flex items-center gap-2">
                            <span className="mobile-global-search-result__title min-w-0 flex-1 truncate text-sm font-medium text-surface-900">
                              <HighlightedSearchText text={result.title} query={globalSearch} />
                            </span>
                            <span className="mobile-global-search-result__badge shrink-0 rounded bg-surface-100 px-1.5 py-0.5 text-xs text-surface-500">
                              {!hasSearchQuery && recentVisitIds.has(result.id) ? '最近' : resultTypeLabels[result.type]}
                            </span>
                          </span>
                          <span className="mobile-global-search-result__description mt-1 block truncate text-xs text-surface-500">
                            <HighlightedSearchText text={result.description} query={globalSearch} />
                          </span>
                        </span>
                        {isMobileViewport && <span className="mobile-global-search-result__chevron">›</span>}
                      </Link>
                    );
                  })}
                </div>
              ) : (
                <div className="mobile-global-search-empty border border-dashed border-surface-200 px-3 py-5 text-center text-sm text-surface-400">
                  <Search size={28} /><strong>没有找到相关内容</strong><span>换个关键词试试</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );

  const mobileMorePaths = ['/more', '/profile', '/questionnaires', '/questionnaire-results', '/cloud-drive', '/tools', '/skills', '/settings', '/appearance', '/admin/scheduled-jobs'];
  const mobileNavItems = [
    { key: 'dashboard', label: '工作台', icon: House, path: '/dashboard', active: location.pathname === '/dashboard' || location.pathname === '/search' },
    { key: 'discussions', label: '协作', icon: MessageSquare, path: '/discussions', active: location.pathname === '/discussions' || location.pathname === '/tasks', badge: mobileUnreadCount },
    { key: 'projects', label: '项目', icon: Folder, path: '/projects', active: location.pathname === '/projects' },
    { key: 'worklog', label: '周报', icon: FileText, path: '/worklog', active: location.pathname === '/worklog' || location.pathname === '/worklog/summary' },
    { key: 'more', label: '更多', icon: Grid2X2, path: '/more', active: mobileMorePaths.some(path => location.pathname === path || location.pathname.startsWith(`${path}/`)) },
  ];

  return (
    <>
      {!mobileOnly && <div
        className={`relative hidden shrink-0 transition-[width] duration-200 lg:block ${
          collapsed ? 'w-[72px]' : 'w-56'
        }`}
      >
        <div className="absolute inset-y-0 left-0 z-30">{sidebarContent}</div>
      </div>}

      <nav
        className={`app-mobile-bottom-nav fixed inset-x-0 bottom-0 z-50 border-t border-surface-200 bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_rgba(15,23,42,0.06)] backdrop-blur transition-transform duration-200 lg:hidden ${mobileKeyboardOpen || (isMobileOpen && searchActive) ? 'translate-y-full pointer-events-none' : ''}`}
        aria-label="手机主导航"
      >
        <div className="grid h-16 grid-cols-5 px-1">
          {mobileNavItems.map(item => {
            const Icon = item.icon;
            return (
              <Link
                key={item.key}
                to={item.path}
                onClick={() => {
                  setSearchActive(false);
                  setIsMobileOpen(false);
                }}
                className={`mobile-nav-item flex min-w-0 flex-col items-center justify-center ${item.active ? 'is-active text-primary-700' : 'text-surface-400'}`}
                aria-label={item.label}
                title={item.label}
                aria-current={item.active ? 'page' : undefined}
              >
                <Icon className="mobile-nav-icon" size={21} strokeWidth={item.active ? 2.1 : 1.8} />
                {item.badge ? <span className="mobile-nav-badge" aria-label={`${item.badge} 条未读`}>{item.badge > 99 ? '99+' : item.badge}</span> : null}
                <span className="mobile-nav-label">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {isMobileOpen && searchActive && (
        <div className="mobile-global-search-overlay fixed inset-0 z-[100003] lg:hidden">
          <div className="absolute inset-0">{sidebarContent}</div>
        </div>
      )}

    </>
  );
}
