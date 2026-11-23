import { AlertCircle, Check, Loader2 } from 'lucide-react';
import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSaveStatusStore } from '../store/saveStatusStore';

export default function SaveStatusIndicator() {
  const { status, message, setIdle } = useSaveStatusStore(useShallow(state => ({
    status: state.status,
    message: state.message,
    setIdle: state.setIdle,
  })));

  useEffect(() => {
    if (status !== 'saved') return;
    const timer = window.setTimeout(setIdle, 2200);
    return () => window.clearTimeout(timer);
  }, [setIdle, status]);

  const visible = status !== 'idle';
  const label = message || (status === 'saving' ? '保存中...' : status === 'saved' ? '已保存' : '保存失败');

  return (
    <span
      className={`app-save-status ${visible ? 'is-visible' : ''} ${status === 'error' ? 'is-error' : ''}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {status === 'saving' && <Loader2 size={12} className="animate-spin" aria-hidden="true" />}
      {status === 'saved' && <Check size={12} className="app-save-check" aria-hidden="true" />}
      {status === 'error' && <AlertCircle size={12} aria-hidden="true" />}
      <span>{visible ? label : '状态已同步'}</span>
    </span>
  );
}
