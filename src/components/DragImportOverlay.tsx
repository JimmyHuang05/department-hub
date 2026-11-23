import { useState, useRef, useEffect, useCallback } from 'react';
import { Upload, FileSpreadsheet } from 'lucide-react';

interface DragImportOverlayProps {
  enabled: boolean;
  onFileDrop: (file: File) => void;
}

export default function DragImportOverlay({ enabled, onFileDrop }: DragImportOverlayProps) {
  const [dragging, setDragging] = useState(false);
  const dragCount = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const handleDragEnter = useCallback((e: DragEvent) => {
    if (!enabled) return;
    e.preventDefault();
    e.stopPropagation();
    dragCount.current++;
    if (dragCount.current === 1) {
      setDragging(true);
    }
  }, [enabled]);

  const handleDragLeave = useCallback((e: DragEvent) => {
    if (!enabled) return;
    e.preventDefault();
    e.stopPropagation();
    dragCount.current--;
    if (dragCount.current <= 0) {
      dragCount.current = 0;
      setDragging(false);
    }
  }, [enabled]);

  const handleDragOver = useCallback((e: DragEvent) => {
    if (!enabled) return;
    e.preventDefault();
    e.stopPropagation();
  }, [enabled]);

  const handleDrop = useCallback((e: DragEvent) => {
    if (!enabled) return;
    e.preventDefault();
    e.stopPropagation();
    dragCount.current = 0;
    setDragging(false);

    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    const ext = file.name.toLowerCase().split('.').pop();
    if (ext !== 'xlsx' && ext !== 'xls') {
      return; // Let the page-level handler show an error
    }

    onFileDrop(file);
  }, [enabled, onFileDrop]);

  useEffect(() => {
    if (!enabled) return;

    document.addEventListener('dragenter', handleDragEnter);
    document.addEventListener('dragleave', handleDragLeave);
    document.addEventListener('dragover', handleDragOver);
    document.addEventListener('drop', handleDrop);

    return () => {
      document.removeEventListener('dragenter', handleDragEnter);
      document.removeEventListener('dragleave', handleDragLeave);
      document.removeEventListener('dragover', handleDragOver);
      document.removeEventListener('drop', handleDrop);
      clearTimeout(timerRef.current);
    };
  }, [enabled, handleDragEnter, handleDragLeave, handleDragOver, handleDrop]);

  if (!dragging) return null;

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center pointer-events-none">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-brand-500/10 backdrop-blur-sm" />

      {/* Drop zone card */}
      <div className="relative bg-white rounded-2xl shadow-2xl border-2 border-dashed border-brand-400 p-10 flex flex-col items-center gap-4 animate-bounce-in">
        <div className="w-16 h-16 rounded-full bg-brand-50 flex items-center justify-center">
          <Upload size={32} className="text-brand-500" />
        </div>
        <div className="text-center">
          <div className="text-lg font-semibold text-slate-800">松开导入 Excel 文件</div>
          <div className="text-sm text-slate-500 mt-1">支持 .xlsx / .xls 格式</div>
        </div>
        <FileSpreadsheet size={48} className="text-green-500 opacity-60" />
      </div>
    </div>
  );
}
