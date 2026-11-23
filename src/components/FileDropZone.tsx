import { useState, type DragEvent, type ReactNode } from 'react';
import { UploadCloud } from 'lucide-react';

export default function FileDropZone({ children, onFiles, disabled = false, message = '松开以上传文件', className = '' }: {
  children: ReactNode;
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  message?: string;
  className?: string;
}) {
  const [dragDepth, setDragDepth] = useState(0);
  const active = !disabled && dragDepth > 0;
  const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer.types).includes('Files');

  return (
    <div
      className={`relative ${className}`}
      onDragEnter={event => {
        if (disabled || !hasFiles(event)) return;
        event.preventDefault();
        setDragDepth(depth => depth + 1);
      }}
      onDragOver={event => {
        if (disabled || !hasFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={event => {
        if (disabled || !hasFiles(event)) return;
        event.preventDefault();
        setDragDepth(depth => Math.max(0, depth - 1));
      }}
      onDrop={event => {
        if (disabled || !hasFiles(event)) return;
        event.preventDefault();
        setDragDepth(0);
        const files = Array.from(event.dataTransfer.files);
        if (files.length) onFiles(files);
      }}
    >
      {children}
      {active && (
        <div className="pointer-events-none absolute inset-0 z-[99998] flex items-center justify-center border-2 border-dashed border-primary-500 bg-primary-50/95 backdrop-blur-sm">
          <div className="text-center text-primary-700">
            <UploadCloud size={40} className="mx-auto" />
            <div className="mt-3 text-base font-semibold">{message}</div>
          </div>
        </div>
      )}
    </div>
  );
}
