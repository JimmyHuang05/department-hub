import { useEffect, useState } from 'react';
import type { EditingPresence } from '../../store/collaborationStore';
import { getAvatarInitial, getAvatarUrl } from '../../utils/avatar';

interface EditingLockOverlayProps {
  editor: EditingPresence;
}

export default function EditingLockOverlay({ editor }: EditingLockOverlayProps) {
  const [avatarSrc, setAvatarSrc] = useState(getAvatarUrl(editor));
  const name = editor.displayName || editor.userId;

  useEffect(() => {
    setAvatarSrc(getAvatarUrl(editor));
  }, [editor.userId, editor.displayName]);

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-slate-100/70 backdrop-blur-[1px]">
      <div className="flex max-w-[min(320px,calc(100%-24px))] items-center gap-3 border border-slate-300 bg-white px-4 py-2.5 shadow-lg">
        <div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden bg-slate-900 text-sm font-semibold text-white ring-2 ring-white">
          {avatarSrc ? (
            <img
              src={avatarSrc}
              alt={name}
              className="h-full w-full object-cover"
              onError={() => setAvatarSrc('')}
            />
          ) : (
            <span>{getAvatarInitial(editor)}</span>
          )}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-950">{name}</div>
          <div className="mt-0.5 text-xs font-medium text-slate-500">正在编辑</div>
        </div>
      </div>
    </div>
  );
}
