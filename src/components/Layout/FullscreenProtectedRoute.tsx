import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import AppErrorBoundary from '../AppErrorBoundary';
import Sidebar from './Sidebar';

interface FullscreenProtectedRouteProps {
  children: React.ReactNode;
}

/** Authenticated page shell for focused tools that must not render the app sidebar. */
export default function FullscreenProtectedRoute({ children }: FullscreenProtectedRouteProps) {
  const location = useLocation();
  const isAuthenticated = useAuthStore(state => state.isAuthenticated);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-surface-50 text-surface-900">
      <main className="min-h-0 flex-1 overflow-hidden pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0">
        <AppErrorBoundary resetKey={`${location.pathname}${location.search}`}>
          {children}
        </AppErrorBoundary>
      </main>
      <Sidebar mobileOnly />
    </div>
  );
}
