import { useEffect } from 'react';

interface LoadingSpinnerProps {
  message?: string;
  fullPage?: boolean;
  showProgress?: boolean;
  progressComplete?: boolean;
  onProgressComplete?: () => void;
}

export default function LoadingSpinner({ message, fullPage, showProgress, progressComplete, onProgressComplete }: LoadingSpinnerProps) {
  useEffect(() => {
    if (!showProgress || !progressComplete) return;
    const timer = window.setTimeout(() => {
      onProgressComplete?.();
    }, 220);

    return () => window.clearTimeout(timer);
  }, [onProgressComplete, progressComplete, showProgress]);

  if (fullPage) {
    return (
      <div className="flex min-h-screen items-center justify-center" role="status" aria-live="polite" aria-label={message || '页面加载中'}>
        <div className="w-full max-w-[280px] px-6 text-center">
          <div className="app-square-spinner relative mx-auto mb-4 h-10 w-10">
            <svg viewBox="0 0 40 40" className="h-10 w-10" aria-hidden="true">
              <rect x="3" y="3" width="34" height="34" fill="none" strokeWidth="4" className="app-square-spinner-track" />
              <rect x="3" y="3" width="34" height="34" fill="none" strokeWidth="4" strokeDasharray="24 112" className="app-square-spinner-segment" />
            </svg>
          </div>
          {message && (
            <p className="text-sm text-slate-500">{message}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center p-8" role="status" aria-live="polite" aria-label={message || '内容加载中'}>
      <div className="app-square-spinner relative h-5 w-5">
        <svg viewBox="0 0 40 40" className="h-5 w-5" aria-hidden="true">
        <rect x="3" y="3" width="34" height="34" fill="none" strokeWidth="4" className="app-square-spinner-track" />
          <rect x="3" y="3" width="34" height="34" fill="none" strokeWidth="4" strokeDasharray="24 112" className="app-square-spinner-segment" />
        </svg>
      </div>
      {message && (
        <p className="ml-3 text-sm text-slate-500">{message}</p>
      )}
    </div>
  );
}
