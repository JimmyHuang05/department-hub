import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import Sidebar from './Sidebar';
import { useShallow } from 'zustand/react/shallow';
import AppErrorBoundary from '../AppErrorBoundary';
import BirthdayPromptModal from '../Auth/BirthdayPromptModal';

interface ProtectedRouteProps {
  children: React.ReactNode;
  /** 允许的角色列表，不传则不限 */
  roles?: string[];
}

export default function ProtectedRoute({ children, roles }: ProtectedRouteProps) {
  const { isAuthenticated, user } = useAuthStore(useShallow(s => ({ isAuthenticated: s.isAuthenticated, user: s.user })));

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (roles && user && !roles.includes(user.role)) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="flex h-dvh bg-surface-50 text-surface-900 lg:h-screen">
      <button
        type="button"
        onClick={() => {
          const target = document.getElementById('app-content-root');
          target?.focus();
          target?.scrollIntoView({ block: 'start' });
        }}
        className="fixed left-3 top-3 z-[100000] -translate-y-20 bg-primary-600 px-3 py-2 text-sm font-medium text-white shadow-lg transition-transform focus:translate-y-0"
      >
        跳到主要内容
      </button>
      <Sidebar />
      <BirthdayPromptModal />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <main id="app-content-root" tabIndex={-1} className="relative min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain p-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] sm:p-5 sm:pb-[calc(5.75rem+env(safe-area-inset-bottom))] lg:[scrollbar-gutter:stable] lg:p-6">
          <div id="app-page-content" className="app-page-enter min-h-full min-w-0 max-w-full lg:h-full">
            <AppErrorBoundary resetKey="authenticated-page-cache">
              {children}
            </AppErrorBoundary>
          </div>
        </main>
      </div>
    </div>
  );
}
