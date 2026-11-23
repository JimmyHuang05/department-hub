import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, X } from 'lucide-react';
import clsx from 'clsx';
import { usePresence } from '../../hooks/usePresence';
import { useMobileViewport } from '../../hooks/useMobileViewport';

type DetailModalSize = 'sm' | 'md' | 'lg' | 'xl';

interface DetailModalProps {
  open: boolean;
  title: string;
  subtitle?: string;
  eyebrow?: string;
  meta?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  size?: DetailModalSize;
  closeOnOverlay?: boolean;
  showClose?: boolean;
  mode?: 'modal' | 'panel';
  headerColor?: string;
}

const sizeClassMap: Record<DetailModalSize, string> = {
  sm: 'max-w-xl',
  md: 'max-w-2xl',
  lg: 'max-w-4xl',
  xl: 'max-w-6xl',
};

interface ContentRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function readableTextColor(background?: string) {
  if (!background || !/^#[0-9a-f]{6}$/i.test(background)) return undefined;
  const red = Number.parseInt(background.slice(1, 3), 16);
  const green = Number.parseInt(background.slice(3, 5), 16);
  const blue = Number.parseInt(background.slice(5, 7), 16);
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
  return luminance > 0.58 ? '#111827' : '#ffffff';
}

export default function DetailModal({
  open,
  title,
  subtitle,
  eyebrow,
  meta,
  children,
  footer,
  onClose,
  size = 'lg',
  closeOnOverlay = true,
  showClose = true,
  mode = 'modal',
  headerColor,
}: DetailModalProps) {
  const [contentRect, setContentRect] = useState<ContentRect | null>(null);
  const presence = usePresence(open, 220);
  const isMobileViewport = useMobileViewport();
  const effectiveMode = mode === 'panel' && isMobileViewport ? 'modal' : mode;

  useLayoutEffect(() => {
    if (!open || effectiveMode === 'panel' || isMobileViewport) {
      setContentRect(null);
      return;
    }

    const measureContent = () => {
      const contentRoot = document.getElementById('app-content-root');
      if (!contentRoot) {
        setContentRect(null);
        return;
      }
      const rect = contentRoot.getBoundingClientRect();
      setContentRect({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      });
    };

    measureContent();
    window.addEventListener('resize', measureContent);
    window.addEventListener('scroll', measureContent, true);

    return () => {
      window.removeEventListener('resize', measureContent);
      window.removeEventListener('scroll', measureContent, true);
    };
  }, [effectiveMode, isMobileViewport, open]);

  useEffect(() => {
    if (!open || effectiveMode === 'panel') return;
    const contentRoot = document.getElementById('app-content-root');

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    const previousOverflow = document.body.style.overflow;
    const previousContentOverflow = contentRoot?.style.overflow;
    document.body.style.overflow = 'hidden';
    if (contentRoot) contentRoot.style.overflow = 'hidden';
    if (isMobileViewport) document.documentElement.classList.add('app-mobile-detail-open');
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      if (contentRoot) contentRoot.style.overflow = previousContentOverflow || '';
      document.documentElement.classList.remove('app-mobile-detail-open');
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [effectiveMode, isMobileViewport, open, onClose]);

  if (!presence.mounted) return null;
  const scopedToContent = Boolean(contentRect);
  const headerTextColor = readableTextColor(headerColor);
  const headerMutedColor = headerTextColor === '#111827' ? 'rgba(17,24,39,.72)' : 'rgba(255,255,255,.85)';

  const panel = (
    <section
      role={effectiveMode === 'modal' ? 'dialog' : 'region'}
      aria-modal={effectiveMode === 'modal' ? true : undefined}
      aria-labelledby="detail-panel-title"
      className={clsx(
        'flex h-full w-full flex-col overflow-hidden rounded-none border border-slate-200 bg-white',
        effectiveMode === 'modal' && 'app-detail-panel',
        effectiveMode === 'panel' && 'app-detail-panel-inline',
        presence.visible && 'is-visible',
        effectiveMode === 'modal' ? 'shadow-2xl shadow-slate-950/15' : 'shadow-sm',
        effectiveMode === 'modal' && (isMobileViewport ? 'max-w-none border-0 shadow-none' : scopedToContent ? 'max-w-none' : sizeClassMap[size]),
      )}
    >
      <header
        className={clsx(
          'relative flex shrink-0 justify-between border-b border-slate-200',
          effectiveMode === 'panel'
            ? 'items-center gap-3 px-4 py-2.5'
            : clsx('items-start gap-4 px-5 py-4', isMobileViewport && 'pt-[calc(1rem+env(safe-area-inset-top))]'),
        )}
        style={headerColor ? {
          backgroundColor: headerColor,
          borderBottomColor: headerColor,
        } : undefined}
      >
        {isMobileViewport && showClose && (
          <button
            type="button"
            onClick={onClose}
            className="app-detail-mobile-back flex h-9 w-9 shrink-0 items-center justify-center text-slate-700"
            aria-label="返回"
          >
            <ChevronLeft size={23} />
          </button>
        )}
        <div className="min-w-0">
          {effectiveMode === 'panel' ? (
            <div className="flex min-w-0 items-center gap-2.5">
              {eyebrow && (
                <span
                  className="shrink-0 text-[11px] font-semibold"
                  style={headerColor ? { color: headerMutedColor } : undefined}
                >
                  {eyebrow}
                </span>
              )}
              <h2
                id="detail-panel-title"
                className={clsx('min-w-0 truncate text-base font-semibold', headerColor ? '' : 'text-slate-950')}
                style={headerColor ? { color: headerTextColor } : undefined}
              >
                {title}
              </h2>
            </div>
          ) : (
            <>
              {eyebrow && (
                <div className="mb-1 text-xs font-semibold text-slate-500" style={headerColor ? { color: headerMutedColor } : undefined}>
                  {eyebrow}
                </div>
              )}
              <h2
                id="detail-panel-title"
                className={clsx('truncate text-base font-semibold', headerColor ? '' : 'text-slate-950')}
                style={headerColor ? { color: headerTextColor } : undefined}
              >
                {title}
              </h2>
            </>
          )}
          {subtitle && (
            <p
              className={clsx(
                'max-w-3xl truncate',
                effectiveMode === 'panel' ? 'mt-0.5 text-xs' : 'mt-1 text-sm',
                headerColor ? '' : 'text-slate-500',
              )}
              style={headerColor ? { color: headerMutedColor } : undefined}
            >
              {subtitle}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {meta}
          {showClose && !isMobileViewport && (
            <button
              type="button"
              onClick={onClose}
              className={clsx(
                'flex items-center justify-center rounded-none border border-slate-200 bg-white text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800',
                effectiveMode === 'panel' ? 'h-8 w-8' : 'h-9 w-9',
              )}
              aria-label="关闭"
            >
              <X size={effectiveMode === 'panel' ? 15 : 17} />
            </button>
          )}
        </div>
      </header>

      <div className={clsx('min-h-0 flex-1 overflow-y-auto px-5 py-4', isMobileViewport && 'pb-[calc(1rem+env(safe-area-inset-bottom))]')}>{children}</div>

      {footer && (
        <footer className={clsx('flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3', isMobileViewport && 'pb-[calc(.75rem+env(safe-area-inset-bottom))]')}>
          {footer}
        </footer>
      )}
    </section>
  );

  if (effectiveMode === 'panel') return panel;

  return createPortal(
    <div
      className={clsx(
        'app-detail-backdrop fixed z-[99999] flex items-stretch justify-center overflow-hidden bg-transparent',
        isMobileViewport ? 'inset-0 p-0' : 'p-4 sm:p-5 lg:p-6',
        presence.visible && 'is-visible',
        scopedToContent || isMobileViewport ? '' : 'inset-0',
      )}
      style={contentRect ? {
        left: contentRect.left,
        top: contentRect.top,
        width: contentRect.width,
        height: contentRect.height,
      } : undefined}
      onMouseDown={event => {
        if (open && closeOnOverlay && event.target === event.currentTarget) onClose();
      }}
      role="presentation"
    >
      {panel}
    </div>,
    document.body,
  );
}

export function DetailSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
        {description && <p className="mt-1 text-xs text-slate-500">{description}</p>}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function DetailGrid({ children, columns = 2 }: { children: ReactNode; columns?: 1 | 2 | 3 }) {
  const columnsClass = {
    1: 'grid-cols-1',
    2: 'grid-cols-1 md:grid-cols-2',
    3: 'grid-cols-1 md:grid-cols-3',
  }[columns];

  return <div className={clsx('grid gap-3', columnsClass)}>{children}</div>;
}

export function DetailField({
  label,
  value,
  span = 1,
}: {
  label: string;
  value?: ReactNode;
  span?: 1 | 2 | 3;
}) {
  const spanClass = {
    1: '',
    2: 'md:col-span-2',
    3: 'md:col-span-3',
  }[span];

  return (
    <div className={clsx('min-w-0 border border-slate-200 bg-slate-50 px-3 py-2', spanClass)}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 min-h-5 truncate text-sm font-medium text-slate-900">{value || '-'}</div>
    </div>
  );
}
