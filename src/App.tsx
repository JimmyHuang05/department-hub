import {useEffect, useLayoutEffect, useRef, useState, lazy, Suspense} from'react';
import {BrowserRouter as Router, Routes, Route, Navigate, useLocation, type Location} from'react-router-dom';
import {useAuthStore} from'./store/authStore';
import {useSettingsStore} from'./store/settingsStore';
import {useProjectStore} from'./store/projectStore';
import {useWorkLogStore} from'./store/workLogStore';
import {useUiPreferenceStore} from'./store/uiPreferenceStore';
import {readCachedThemePreference, useThemeStore} from'./store/themeStore';
import ProtectedRoute from'./components/Layout/ProtectedRoute';
import FullscreenProtectedRoute from './components/Layout/FullscreenProtectedRoute';
import LoadingSpinner from'./components/LoadingSpinner';
import {injectToastRef} from'./store/toastRef';
import {useToast} from'./components/Toast';
import {useCollaboration} from'./hooks/useCollaboration';
import {wsClient} from'./lib/ws';
import ForcedLogoutModal from './components/Auth/ForcedLogoutModal';
import DemoDataNotice from './components/Auth/DemoDataNotice';
import {applyAnimationsEnabled, readAnimationsEnabled} from './utils/motionPreference';
import {loadPageWithRecovery} from './utils/dynamicImportRecovery';
import {patchPageSnapshot, readPageSnapshot} from './utils/pageSnapshot';

// 懒加载页面组件
const loadLogin = () => loadPageWithRecovery(() => import('./pages/Login'));
const loadDashboard = () => loadPageWithRecovery(() => import('./pages/Dashboard'));
const loadProjectList = () => loadPageWithRecovery(() => import('./pages/ProjectList'));
const loadSettings = () => loadPageWithRecovery(() => import('./pages/Settings'));
const loadWorkLogList = () => loadPageWithRecovery(() => import('./pages/WorkLogList'));
const loadWeeklySummary = () => loadPageWithRecovery(() => import('./pages/WeeklySummary'));
const loadUserManagement = () => loadPageWithRecovery(() => import('./pages/UserManagement'));
const loadProfile = () => loadPageWithRecovery(() => import('./pages/Profile'));
const loadAuditLog = () => loadPageWithRecovery(() => import('./pages/AuditLog'));
const loadEventLog = () => loadPageWithRecovery(() => import('./pages/EventLog'));
const loadBackups = () => loadPageWithRecovery(() => import('./pages/Backups'));
const loadScheduledJobs = () => loadPageWithRecovery(() => import('./pages/ScheduledJobs'));
const loadMessages = () => loadPageWithRecovery(() => import('./pages/Messages'));
const loadDiscussionCenter = () => loadPageWithRecovery(() => import('./pages/DiscussionCenter'));
const loadCloudDrive = () => loadPageWithRecovery(() => import('./pages/CloudDrive'));
const loadToolsCenter = () => loadPageWithRecovery(() => import('./pages/ToolsCenter'));
const loadSkillsCenter = () => loadPageWithRecovery(() => import('./pages/SkillsCenter'));
const loadQuestionnairesCenter = () => loadPageWithRecovery(() => import('./pages/QuestionnairesCenter'));
const loadPublicQuestionnaire = () => loadPageWithRecovery(() => import('./pages/PublicQuestionnaire'));
const loadAppearanceSettings = () => loadPageWithRecovery(() => import('./pages/AppearanceSettings'));
const loadApplications = () => loadPageWithRecovery(() => import('./pages/Applications'));
const loadLaunch = () => loadPageWithRecovery(() => import('./pages/Launch'));
const loadSheetEditor = () => loadPageWithRecovery(() => import('./pages/SheetEditorPage'));
const loadMobileBasePages = () => loadPageWithRecovery(() => import('./pages/MobileBasePages'));

const Login = lazy(loadLogin);
const Dashboard = lazy(loadDashboard);
const ProjectList = lazy(loadProjectList);
const Settings = lazy(loadSettings);
const WorkLogList = lazy(loadWorkLogList);
const WeeklySummary = lazy(loadWeeklySummary);
const UserManagement = lazy(loadUserManagement);
const Profile = lazy(loadProfile);
const AuditLog = lazy(loadAuditLog);
const EventLog = lazy(loadEventLog);
const Backups = lazy(loadBackups);
const ScheduledJobs = lazy(loadScheduledJobs);
const Messages = lazy(loadMessages);
const DiscussionCenter = lazy(loadDiscussionCenter);
const CloudDrive = lazy(loadCloudDrive);
const ToolsCenter = lazy(loadToolsCenter);
const SkillsCenter = lazy(loadSkillsCenter);
const QuestionnairesCenter = lazy(loadQuestionnairesCenter);
const PublicQuestionnaire = lazy(loadPublicQuestionnaire);
const AppearanceSettings = lazy(loadAppearanceSettings);
const Applications = lazy(loadApplications);
const Launch = lazy(loadLaunch);
const SheetEditor = lazy(loadSheetEditor);
const MobileSearchPage = lazy(() => loadMobileBasePages().then(module => ({ default: module.MobileSearchPage })));
const MobileMorePage = lazy(() => loadMobileBasePages().then(module => ({ default: module.MobileMorePage })));

const cachedPageConfigs = [
 {key:'dashboard', path:'/dashboard'}, {key:'projects', path:'/projects'},
 {key:'settings', path:'/settings'}, {key:'worklog-summary', path:'/worklog/summary'},
 {key:'worklog', path:'/worklog'}, {key:'profile', path:'/profile'},
 {key:'users', path:'/admin/users', admin:true}, {key:'audit', path:'/audit', developer:true},
 {key:'error-events', path:'/admin/error-events', developer:true}, {key:'backups', path:'/admin/backups', developer:true},
 {key:'scheduled-jobs', path:'/admin/scheduled-jobs', admin:true}, {key:'tasks', path:'/tasks'},
 {key:'discussions', path:'/discussions'},
 {key:'cloud-drive', path:'/cloud-drive'}, {key:'tools', path:'/tools'},
 {key:'skills', path:'/skills'}, {key:'questionnaires', path:'/questionnaires/*'},
 {key:'questionnaire-results', path:'/questionnaire-results'},
 {key:'applications', path:'/applications'},
 {key:'appearance', path:'/appearance'},
 {key:'search', path:'/search'}, {key:'more', path:'/more'},
] as const;

type CachedPageKey = typeof cachedPageConfigs[number]['key'];
const statefulPageKeys = new Set<CachedPageKey>(['dashboard', 'projects', 'worklog']);

function cachedPageElement(key: typeof cachedPageConfigs[number]['key']) {
 switch (key) {
  case 'dashboard': return <Dashboard />; case 'projects': return <ProjectList />;
  case 'settings': return <Settings />; case 'worklog': return <WorkLogList />;
  case 'worklog-summary': return <WeeklySummary />; case 'profile': return <Profile />;
  case 'users': return <UserManagement />; case 'audit': return <AuditLog />;
  case 'error-events': return <EventLog />; case 'backups': return <Backups />;
  case 'scheduled-jobs': return <ScheduledJobs />; case 'tasks': return <Messages />;
  case 'discussions': return <DiscussionCenter />;
  case 'cloud-drive': return <CloudDrive />; case 'tools': return <ToolsCenter />;
  case 'skills': return <SkillsCenter />; case 'questionnaires': return <QuestionnairesCenter mode="design" />;
  case 'questionnaire-results': return <QuestionnairesCenter mode="results" />;
  case 'applications': return <Applications />;
  case 'appearance': return <AppearanceSettings />;
  case 'search': return <MobileSearchPage />; case 'more': return <MobileMorePage />;
 }
}

function CachedAuthenticatedPages() {
 const location = useLocation();
 const role = useAuthStore(state => state.user?.role);
 const businessRole = useAuthStore(state => state.user?.business_role);
 const userId = useAuthStore(state => state.user?.id);
 const activeConfig = cachedPageConfigs.find(config => config.path.endsWith('/*')
  ? location.pathname === config.path.slice(0, -2) || location.pathname.startsWith(`${config.path.slice(0, -2)}/`)
  : config.path === location.pathname);
 const [visitedKeys, setVisitedKeys] = useState<CachedPageKey[]>([]);
 const frozenLocations = useRef(new Map<string, Location>());
 const scrollPositions = useRef(new Map<string, number>());
 const activeKey = activeConfig?.key;
 if (activeKey) frozenLocations.current.set(activeKey, location);

 useEffect(() => {
  if (!activeKey) return;
  if (!statefulPageKeys.has(activeKey)) return;
  setVisitedKeys(current => current.includes(activeKey) ? current : [...current, activeKey]);
 }, [activeKey]);

 useLayoutEffect(() => {
  if (!activeKey) return undefined;
  const main = document.getElementById('app-content-root');
  if (!main) return undefined;
  const remembered = readPageSnapshot<{appScrollTop: number}>(activeKey, userId);
  main.scrollTop = scrollPositions.current.get(activeKey) ?? Number(remembered.appScrollTop || 0);
  return () => {
   scrollPositions.current.set(activeKey, main.scrollTop);
   patchPageSnapshot(activeKey, userId, {appScrollTop: main.scrollTop});
  };
 }, [activeKey, userId]);

 if (!activeConfig) return <Navigate to="/dashboard" replace />;
 if ('admin' in activeConfig && activeConfig.admin && role !== 'admin') return <Navigate to="/dashboard" replace />;
 if ('developer' in activeConfig && activeConfig.developer && businessRole !== 'developer') return <Navigate to="/dashboard" replace />;

 const confirmedActiveKey = activeConfig.key;
 const renderedKeys = statefulPageKeys.has(confirmedActiveKey)
  ? (visitedKeys.includes(confirmedActiveKey) ? visitedKeys : [...visitedKeys, confirmedActiveKey])
  : [...visitedKeys, confirmedActiveKey];
 return <>{renderedKeys.map(key => {
  const config = cachedPageConfigs.find(item => item.key === key);
  const frozenLocation = frozenLocations.current.get(key);
  if (!config || !frozenLocation) return null;
  const active = key === activeConfig.key;
  return <section key={key} hidden={!active} aria-hidden={!active} className="min-h-full min-w-0 max-w-full lg:h-full">
   <Routes location={frozenLocation}><Route path={config.path} element={cachedPageElement(config.key)} /></Routes>
  </section>;
 })}</>;
}

const idlePageLoaders = [loadProjectList, loadWorkLogList];

function scheduleIdlePagePreload() {
  const preload = () => void Promise.allSettled(idlePageLoaders.map(loader => loader())).then(results => {
    results.forEach(result => {
      if (result.status === 'rejected') {
        console.error('页面预加载失败', result.reason);
      }
    });
  });
  const idleWindow = window as Window & {
    requestIdleCallback?: (callback: () => void, options?: {timeout: number}) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (typeof idleWindow.requestIdleCallback === 'function') {
    const id = idleWindow.requestIdleCallback(preload, {timeout: 5000});
    return () => idleWindow.cancelIdleCallback?.(id);
  }
  const id = globalThis.setTimeout(preload, 1500);
  return () => globalThis.clearTimeout(id);
}

function PageLoading({
 message = '\u9875\u9762\u52a0\u8f7d\u4e2d...',
 showProgress = false,
 progressComplete = false,
 onProgressComplete,
}: {
 message?: string;
 showProgress?: boolean;
 progressComplete?: boolean;
 onProgressComplete?: () => void;
}) {return <LoadingSpinner fullPage message={message} showProgress={showProgress} progressComplete={progressComplete} onProgressComplete={onProgressComplete}/>;}

function CollaborationProvider({children}: {children: React.ReactNode}) {const isAuthenticated = useAuthStore(s => s.isAuthenticated);
 useCollaboration();

 // 将 wsClient 挂到全局以便 stores 访问（仅用于广播编辑，不用于敏感操作）
 useEffect(() => {(window as any).__collab = isAuthenticated ? wsClient : null;
 return () => {(window as any).__collab = null;};}, [isAuthenticated]);

 return <>{children}</>;}

export default function App() {const isAuthenticated = useAuthStore(s => s.isAuthenticated);
 const userId = useAuthStore(s => s.user?.id);
 const isPublicLaunch = window.location.pathname === '/launch' || window.location.pathname.startsWith('/launch/');
 const isPublicQuestionnaire = window.location.pathname.startsWith('/questionnaire/');
 const toast = useToast();
 const [ready, setReady] = useState(false);
 const [isInitializingSession, setIsInitializingSession] = useState(false);
 const [hasInitializedSession, setHasInitializedSession] = useState(false);
 const [hasLoginProgressFinished, setHasLoginProgressFinished] = useState(false);
 const loadTheme = useThemeStore(s => s.loadTheme);
 const applyDefaultTheme = useThemeStore(s => s.applyPreference);

 // 注入 toast 引用到 store（让 zustand 也能调用）
 useEffect(() => {injectToastRef(toast);
 setReady(true);}, [toast]);

 useEffect(() => {
   const handleForcedLogout = (event: Event) => {
     const detail = (event as CustomEvent).detail || {};
     wsClient.close();
     useAuthStore.getState().forceLogout(detail);
   };
   window.addEventListener('ibd:forced-logout', handleForcedLogout);
   return () => window.removeEventListener('ibd:forced-logout', handleForcedLogout);
 }, []);

  // Load session data after sign-in.
  useEffect(() => {
    if (!ready || !isAuthenticated || isPublicLaunch) {
      setIsInitializingSession(false);
      setHasInitializedSession(false);
      setHasLoginProgressFinished(false);
      return;
    }
    let cancelled = false;
    const init = async () => {
      setIsInitializingSession(true);
      setHasLoginProgressFinished(false);
      try {
        await useAuthStore.getState().refreshUser();
        if (cancelled || !useAuthStore.getState().isAuthenticated) return;
        const loadBusinessData = async () => {
          // The list stores detect name templates using the loaded settings.
          await useSettingsStore.getState().reloadSettings();
          if (cancelled) return;
          await Promise.all([
            useProjectStore.getState().fetchProducts(),
            useWorkLogStore.getState().fetchEntries(),
          ]);
        };
        await Promise.all([
          loadTheme(),
          useUiPreferenceStore.getState().loadPreferences(),
          loadBusinessData(),
        ]);
        if (cancelled) return;
        if (useAuthStore.getState().user?.role === 'admin') {
          const {products} = useProjectStore.getState();
          const {entries} = useWorkLogStore.getState();
          useSettingsStore.getState().scanAllFieldOptions(entries, products);
        }
      } finally {
        if (!cancelled) {
          setHasInitializedSession(true);
          setIsInitializingSession(false);
        }
      }
    };
    init();
    return () => {
      cancelled = true;
    };
  }, [loadTheme, ready, isAuthenticated, isPublicLaunch]);

 useEffect(() => {
   if (!ready || !isAuthenticated || !hasInitializedSession) return undefined;
   return scheduleIdlePagePreload();
 }, [hasInitializedSession, isAuthenticated, ready]);

 useEffect(() => {
   if (!isAuthenticated) {
     applyDefaultTheme(readCachedThemePreference());
   }
 }, [applyDefaultTheme, isAuthenticated]);

 useEffect(() => {
   applyAnimationsEnabled(isAuthenticated ? readAnimationsEnabled(userId) : true);
 }, [isAuthenticated, userId]);

 if (!ready) return <PageLoading />;
 if (isPublicLaunch || isPublicQuestionnaire) return (
  <Router>
   <Suspense fallback={<PageLoading />}>
    <Routes>
     <Route path="/launch/*" element={<Launch />} />
     <Route path="/questionnaire/:token" element={<PublicQuestionnaire />} />
    </Routes>
   </Suspense>
  </Router>
 );
 if (isAuthenticated && (!hasInitializedSession || isInitializingSession || !hasLoginProgressFinished)) return (
  <PageLoading
   message={'\u6b63\u5728\u8fdb\u5165\u7cfb\u7edf...'}
   showProgress
   progressComplete={hasInitializedSession && !isInitializingSession}
   onProgressComplete={() => setHasLoginProgressFinished(true)}
  />
 );

 return (
 <Router>
 <CollaborationProvider>
 <Suspense fallback={isAuthenticated ? <PageLoading message="正在进入系统..." showProgress progressComplete /> : <PageLoading />}>
 <Routes>
 <Route path="/launch" element={<Launch />} />
 <Route
  path="/sheet-editor/:fileId"
  element={<FullscreenProtectedRoute><SheetEditor /></FullscreenProtectedRoute>}
 />
 <Route
  path="/sheet-editor"
  element={<FullscreenProtectedRoute><SheetEditor /></FullscreenProtectedRoute>}
 />
 <Route
  path="/questionnaires/new"
  element={<FullscreenProtectedRoute><QuestionnairesCenter mode="design" standaloneEditor /></FullscreenProtectedRoute>}
 />
 <Route
  path="/questionnaires/:questionnaireId/edit"
  element={<FullscreenProtectedRoute><QuestionnairesCenter mode="design" standaloneEditor /></FullscreenProtectedRoute>}
 />
 <Route
 path="/login"element={isAuthenticated ? <Navigate to="/dashboard"replace /> : <Login />}
 />
 <Route
 path="/"element={<Navigate to="/dashboard"replace />}
 />
<Route path="/*" element={<ProtectedRoute><CachedAuthenticatedPages /></ProtectedRoute>} />
 </Routes>
 {isAuthenticated && <DemoDataNotice key={userId} />}
 <ForcedLogoutModal />
 </Suspense>
 </CollaborationProvider>
 </Router>
 );}
