import { useState, useEffect, useCallback, createContext, useContext, type ReactNode } from 'react';
import { X, AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { formatErrorForDisplay } from '../utils/errorCodes';
import AppModal from './Layout/AppModal';
import DeleteConfirmDialog from './DeleteConfirmDialog';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: number;
  type: ToastType;
  message: string;
  duration?: number;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType, duration?: number) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  warning: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let toastId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const addToast = useCallback((message: string, type: ToastType = 'info', duration = 3500) => {
    if (type !== 'error') return;
    const id = ++toastId;
    setToasts(prev => [...prev, { id, type, message: formatErrorForDisplay(message), duration }]);
  }, []);

  const toast: ToastContextValue['toast'] = useCallback((message, type, duration) => {
    addToast(message, type, duration);
  }, [addToast]);

  const success = useCallback((message: string) => addToast(message, 'success', 3000), [addToast]);
  const error = useCallback((message: string) => addToast(message, 'error', 5000), [addToast]);
  const warning = useCallback((message: string) => addToast(message, 'warning', 4000), [addToast]);
  const info = useCallback((message: string) => addToast(message, 'info', 3000), [addToast]);

  const iconMap: Record<ToastType, ReactNode> = {
    success: <CheckCircle2 size={18} className="text-emerald-600" />,
    error: <AlertCircle size={18} className="text-red-500" />,
    warning: <AlertTriangle size={18} className="text-amber-600" />,
    info: <Info size={18} className="text-blue-600" />,
  };

  const bgMap: Record<ToastType, string> = {
    success: 'bg-emerald-50 border-emerald-200',
    error: 'bg-red-50 border-red-200',
    warning: 'bg-amber-50 border-amber-200', info: 'bg-blue-50 border-blue-200',
  };

  return (
    <ToastContext.Provider value={{ toast, success, error, warning, info }}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-[99999] flex max-w-[calc(100vw-2rem)] flex-col gap-2.5" aria-live="assertive" aria-relevant="additions">
        {toasts.map(t => (
          <ToastItem
            key={t.id}
            toast={t}
            icon={iconMap[t.type]}
            bgClass={bgMap[t.type]}
            onRemove={removeToast}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast: t, icon, bgClass, onRemove }: { toast: Toast; icon: ReactNode; bgClass: string; onRemove: (id: number) => void }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // 触发入场动画
    const showTimer = setTimeout(() => setVisible(true), 10);
    // 自动关闭
    const autoTimer = setTimeout(() => {
      setVisible(false);
      setTimeout(() => onRemove(t.id), 300);
    }, t.duration || 3500);
    return () => { clearTimeout(showTimer); clearTimeout(autoTimer); };
  }, [t.id, t.duration, onRemove]);

  return (
    <div
      role={t.type === 'error' ? 'alert' : 'status'}
      aria-atomic="true"
      className={`pointer-events-auto flex w-[calc(100vw-2rem)] items-start gap-3 border border-slate-200 px-4 py-3.5 shadow-lg shadow-slate-900/10 transition-all duration-200 sm:w-auto ${bgClass} ${
        visible ? 'translate-x-0 opacity-100 scale-100' : 'translate-x-12 opacity-0 scale-95'
      }`}
      style={{ maxWidth: 440 }}
    >
      <div className="mt-0.5 flex-shrink-0">{icon}</div>
      <div className={`flex-1 whitespace-pre-line text-sm font-medium leading-5 ${
        t.type === 'error' ? 'text-red-700' : t.type === 'warning' ? 'text-amber-800' : t.type === 'success' ? 'text-emerald-800' : 'text-blue-800'
      }`}>{t.message}</div>
      <button
        onClick={() => { setVisible(false); setTimeout(() => onRemove(t.id), 300); }}
        className="flex-shrink-0 p-0.5 hover:bg-black/5 transition-colors text-slate-400 hover:text-slate-600"
        aria-label="关闭提示"
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}

interface ConfirmOptions {
  message: string;
  title?: string;
  confirmText?: string;
  tone?: 'warning' | 'danger';
}

// 统一确认弹窗函数。保留字符串参数兼容已有调用，并允许危险操作定制标题与按钮。
export function useConfirm() {
  const [state, setState] = useState<{
    options: ConfirmOptions;
    resolve: (v: boolean) => void;
  } | null>(null);

  const confirm = useCallback((input: string | ConfirmOptions): Promise<boolean> => {
    return new Promise(resolve => {
      const options = typeof input === 'string' ? {message: input} : input;
      setState({ options, resolve });
    });
  }, []);

  const finish = (value: boolean) => {
    if (!state) return;
    state.resolve(value);
    setState(null);
  };
  const danger = state?.options.tone === 'danger'
    || Boolean(state && /删除|覆盖|清除|不可撤销/.test(state.options.message));
  const ConfirmDialog = state && danger ? (
    <DeleteConfirmDialog
      open
      title={state.options.title || '确认删除'}
      description={state.options.message}
      confirmText={state.options.confirmText || '删除'}
      onCancel={() => finish(false)}
      onConfirm={() => finish(true)}
    />
  ) : state ? (
    <AppModal
      open
      title={state.options.title || (danger ? '确认危险操作' : '确认操作')}
      icon={<span className={`flex h-7 w-7 items-center justify-center ${danger ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'}`}><AlertTriangle size={16} /></span>}
      onClose={() => finish(false)}
      size="sm"
      showClose={false}
      panelClassName="max-w-[420px] [&>header]:border-b-0 [&>header]:pb-2 [&>footer]:border-t-0 [&>footer]:pt-2"
      bodyClassName="px-5 py-3"
      footer={<div className="flex w-full gap-3"><button type="button" onClick={() => finish(false)} className="app-button-secondary h-10 min-h-0 flex-1 px-4 text-sm">取消</button><button type="button" autoFocus onClick={() => finish(true)} className={`inline-flex h-10 flex-1 items-center justify-center px-4 text-sm font-medium text-white ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-600 hover:bg-amber-700'}`}>{state.options.confirmText || '确定'}</button></div>}
    >
      <p className="text-sm leading-6 text-surface-600">{state.options.message}</p>
    </AppModal>
  ) : null;

  return { confirm, ConfirmDialog };
}
