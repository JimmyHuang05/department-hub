import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface ContextMenuItem {
  key: string;
  label: ReactNode;
  icon?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
  separatorBefore?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
  width?: number;
  ariaLabel?: string;
}

export default function ContextMenu({ x, y, items, onClose, width = 208, ariaLabel = '右键菜单' }: ContextMenuProps) {
  useEffect(() => {
    const closeOnKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    const close = () => onClose();
    window.addEventListener('pointerdown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', closeOnKey);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', closeOnKey);
    };
  }, [onClose]);

  const separators = items.filter(item => item.separatorBefore).length;
  const estimatedHeight = items.length * 36 + separators * 9 + 8;
  const left = Math.max(8, Math.min(x, window.innerWidth - width - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - estimatedHeight - 8));

  return createPortal(
    <div
      role="menu"
      data-app-context-menu
      aria-label={ariaLabel}
      className="project-sheet-context-menu fixed z-[100000] py-1"
      style={{ left, top, width, maxHeight: 'calc(100dvh - 16px)', overflowY: 'auto', overscrollBehavior: 'contain', boxShadow: 'none', filter: 'none' }}
      onPointerDown={event => event.stopPropagation()}
      onContextMenu={event => event.preventDefault()}
    >
      {items.map(item => (
        <div key={item.key}>
          {item.separatorBefore && <div className="my-1 border-t border-slate-200" />}
          <button
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => { if (!item.disabled) { onClose(); item.onSelect(); } }}
            className={`project-sheet-context-menu__item flex h-9 w-full items-center gap-2.5 px-3 text-left text-xs disabled:cursor-not-allowed ${item.danger ? 'project-sheet-context-menu__item--danger' : 'text-slate-700'}`}
          >
            {item.icon}
            <span className="min-w-0 truncate">{item.label}</span>
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
