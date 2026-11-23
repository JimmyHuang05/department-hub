import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, Home, RefreshCw } from 'lucide-react';
import { isDynamicImportError } from '../utils/dynamicImportRecovery';

interface AppErrorBoundaryProps {
  children: ReactNode;
  resetKey?: string;
}

interface AppErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export default class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('页面渲染失败', error, info);
  }

  componentDidUpdate(previousProps: AppErrorBoundaryProps) {
    if (this.state.hasError && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null });
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    const isVersionMismatch = isDynamicImportError(this.state.error);
    const isExternalDomMutation = this.state.error?.name === 'NotFoundError'
      && /insertBefore|removeChild|not a child/i.test(this.state.error.message);
    const title = isVersionMismatch
      ? '系统版本已更新'
      : isExternalDomMutation
        ? '浏览器翻译影响了页面显示'
        : '这个页面暂时没有正常显示';
    const description = isVersionMismatch
      ? '当前页面仍在使用旧版本资源，请重新加载后继续使用。'
      : isExternalDomMutation
        ? 'Chrome 自动翻译或浏览器扩展修改了页面结构。系统已关闭页面翻译，请重新加载后继续使用。'
        : '已保护当前数据不再继续操作。你可以重新加载页面，或先返回工作台。';

    return (
      <div className="flex min-h-[60vh] items-center justify-center p-5" role="alert">
        <div className="w-full max-w-lg border border-surface-200 bg-white p-6 text-center shadow-sm sm:p-8">
          <span className="mx-auto flex h-12 w-12 items-center justify-center bg-danger-50 text-danger-600">
            <AlertTriangle size={23} aria-hidden="true" />
          </span>
          <h1 className="mt-4 text-lg font-semibold text-surface-900">
            {title}
          </h1>
          <p className="mt-2 text-sm leading-6 text-surface-500">
            {description}
          </p>
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={() => window.location.assign('/dashboard')}
              className="inline-flex h-10 items-center justify-center gap-2 border border-surface-200 bg-white px-4 text-sm font-medium text-surface-700 hover:bg-surface-50"
            >
              <Home size={15} aria-hidden="true" />
              返回工作台
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex h-10 items-center justify-center gap-2 bg-primary-600 px-4 text-sm font-medium text-white hover:bg-primary-700"
            >
              <RefreshCw size={15} aria-hidden="true" />
              重新加载
            </button>
          </div>
        </div>
      </div>
    );
  }
}
