import { Component, lazy, Suspense, useMemo, useState, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, LayoutGrid, RotateCcw } from 'lucide-react';
import LoadingSpinner from '../../components/LoadingSpinner';
import type { ProjectFortuneSheetViewProps } from './ProjectFortuneSheetView';

interface BoundaryProps {
  children: ReactNode;
  resetKey: number;
  onRetry: () => void;
  onFallback: () => void;
}

class FortuneSheetBoundary extends Component<BoundaryProps, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('FortuneSheet 模块运行失败', error, info); }
  componentDidUpdate(previousProps: BoundaryProps) {
    if (this.state.error && previousProps.resetKey !== this.props.resetKey) this.setState({ error: null });
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full min-h-[520px] items-center justify-center bg-[var(--app-panel)] p-6" role="alert">
        <div className="w-full max-w-md border border-amber-200 bg-amber-50 p-6 text-center">
          <AlertTriangle className="mx-auto text-amber-700" size={24} />
          <h2 className="mt-3 font-semibold text-slate-900">表格模块暂时不可用</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">故障已隔离，不影响卡片视图和系统其他模块。</p>
          <p className="mt-2 break-words font-mono text-xs text-amber-800">{this.state.error.message}</p>
          <div className="mt-5 flex justify-center gap-2">
            <button type="button" onClick={this.props.onFallback} className="inline-flex h-9 items-center gap-2 border border-slate-300 bg-white px-3 text-sm"><LayoutGrid size={15} />卡片模式</button>
            <button type="button" onClick={this.props.onRetry} className="inline-flex h-9 items-center gap-2 bg-primary-600 px-3 text-sm text-white"><RotateCcw size={15} />重试表格</button>
          </div>
        </div>
      </div>
    );
  }
}

export interface ProjectFortuneSheetModuleProps extends ProjectFortuneSheetViewProps {
  onFallbackToCards: () => void;
}

export default function ProjectFortuneSheetModule({ onFallbackToCards, ...props }: ProjectFortuneSheetModuleProps) {
  const [resetKey, setResetKey] = useState(0);
  const View = useMemo(() => lazy(() => import('./ProjectFortuneSheetView')), [resetKey]);
  return (
    <FortuneSheetBoundary resetKey={resetKey} onRetry={() => setResetKey(value => value + 1)} onFallback={onFallbackToCards}>
      <Suspense fallback={<LoadingSpinner fullPage message="正在加载表格..." />}>
        <View key={resetKey} {...props} />
      </Suspense>
    </FortuneSheetBoundary>
  );
}
