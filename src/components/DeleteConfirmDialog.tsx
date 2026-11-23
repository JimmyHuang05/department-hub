import { useEffect, useState, type ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import AppModal from './Layout/AppModal';

interface DeleteConfirmDialogProps {
  open: boolean;
  title?: string;
  targetName?: ReactNode;
  description?: ReactNode;
  cancelText?: string;
  confirmText?: string;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}

/**
 * 通用删除确认弹窗。
 *
 * 仅提供取消和确认两个操作；点击遮罩或按 Esc 等同于取消。
 */
export default function DeleteConfirmDialog({
  open,
  title = '确认删除',
  targetName,
  description,
  cancelText = '取消',
  confirmText = '确认',
  onCancel,
  onConfirm,
}: DeleteConfirmDialogProps) {
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) setSubmitting(false);
  }, [open]);

  const handleConfirm = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onConfirm();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppModal
      open={open}
      onClose={() => {
        if (!submitting) onCancel();
      }}
      title={title}
      icon={(
        <span className="flex h-7 w-7 items-center justify-center bg-red-50 text-red-600">
          <Trash2 size={15} />
        </span>
      )}
      size="sm"
      showClose={false}
      closeOnOverlay={!submitting}
      panelClassName="max-w-[380px] [&>header]:border-b-0 [&>header]:pb-2 [&>footer]:border-t-0 [&>footer]:pt-2"
      bodyClassName="px-5 py-3"
      footer={(
        <div className="flex w-full gap-3">
          <button
            type="button"
            disabled={submitting}
            onClick={onCancel}
            className="app-button-secondary h-10 min-h-0 flex-1 px-4 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            {cancelText}
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => void handleConfirm()}
            className="inline-flex h-10 flex-1 items-center justify-center bg-red-600 px-4 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-red-300"
          >
            {submitting ? '处理中…' : confirmText}
          </button>
        </div>
      )}
    >
      <div className="text-sm leading-6 text-surface-600">
        {description ?? (
          <>
            确定要删除
            {targetName ? <span className="mx-1 font-medium text-surface-900">“{targetName}”</span> : '此条目'}
            吗？删除后无法恢复。
          </>
        )}
      </div>
    </AppModal>
  );
}
