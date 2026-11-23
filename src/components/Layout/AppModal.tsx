import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import clsx from 'clsx';
import { usePresence } from '../../hooks/usePresence';
import { useMobileViewport } from '../../hooks/useMobileViewport';

type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'half' | 'full';
type ModalPlacement = 'center' | 'right';
type ModalBackdrop = 'dim' | 'none';

interface ContentRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface AppModalProps {
  open: boolean;
  title?: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  headerActions?: ReactNode;
  onClose: () => void;
  size?: ModalSize;
  placement?: ModalPlacement;
  closeOnOverlay?: boolean;
  showClose?: boolean;
  overlay?: boolean;
  backdrop?: ModalBackdrop;
  exitAnimation?: boolean;
  fillContent?: boolean;
  pageMode?: boolean;
  headerClassName?: string;
  bodyClassName?: string;
  panelClassName?: string;
  scopeId?: string;
}

const centerSizeClass: Record<ModalSize, string> = {
  sm: 'max-w-md',
  md: 'max-w-2xl',
  lg: 'max-w-4xl',
  xl: 'max-w-6xl',
  half: 'max-w-[820px]',
  full: 'max-w-[min(1320px,calc(100vw-24px))]',
};

const rightSizeStyle: Record<ModalSize, { width: string; minWidth?: string; maxWidth?: string }> = {
  sm: { width: 'min(100vw, 420px)' },
  md: { width: 'min(100vw, 520px)' },
  lg: { width: 'min(100vw, 640px)' },
  xl: { width: 'min(100vw, 820px)' },
  half: { width: 'min(54vw, 720px)', minWidth: 'min(100vw, 520px)' },
  full: { width: '100vw' },
};

export default function AppModal({
  open,
  title,
  subtitle,
  icon,
  children,
  footer,
  headerActions,
  onClose,
  size = 'md',
  placement = 'center',
  closeOnOverlay = true,
  showClose = true,
  overlay = true,
  backdrop,
  exitAnimation = true,
  fillContent = false,
  pageMode = false,
  headerClassName,
  bodyClassName,
  panelClassName,
  scopeId,
}: AppModalProps) {
  const [contentRect, setContentRect] = useState<ContentRect | null>(null);
  const presence = usePresence(open, exitAnimation ? 220 : 0);
  const isMobileViewport = useMobileViewport();
  const mobileFullscreen = isMobileViewport && size !== 'sm';

  useLayoutEffect(() => {
    if (!open || placement !== 'center' || mobileFullscreen) {
      setContentRect(null);
      return;
    }

    const contentRoot = document.getElementById('app-content-root');
    const resolveScopeRoot = () => pageMode
      ? document.getElementById('app-page-content')
      : scopeId
      ? document.getElementById(scopeId)
      : fillContent
        ? document.getElementById('app-page-content')
        : contentRoot;

    const measureContent = () => {
      const scopeRoot = resolveScopeRoot();
      if (!scopeRoot) {
        setContentRect(null);
        return;
      }
      const rect = scopeRoot.getBoundingClientRect();
      setContentRect({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      });
    };

    measureContent();
    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(measureContent)
      : null;
    if (resizeObserver) {
      const scopeRoot = resolveScopeRoot();
      if (scopeRoot) resizeObserver.observe(scopeRoot);
      if (scopeRoot !== contentRoot && contentRoot) resizeObserver.observe(contentRoot);
    }
    window.addEventListener('resize', measureContent);
    window.addEventListener('scroll', measureContent, true);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', measureContent);
      window.removeEventListener('scroll', measureContent, true);
    };
  }, [fillContent, mobileFullscreen, open, pageMode, placement, scopeId]);

  useEffect(() => {
    if (!open) return;

    const contentRoot = document.getElementById('app-content-root');
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    const previousContentOverflow = contentRoot?.style.overflow;
    if (placement === 'center' && contentRoot) contentRoot.style.overflow = 'hidden';
    if (mobileFullscreen) document.documentElement.classList.add('app-mobile-detail-open');
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      if (contentRoot) contentRoot.style.overflow = previousContentOverflow || '';
      document.documentElement.classList.remove('app-mobile-detail-open');
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [mobileFullscreen, onClose, open, placement]);

  if (!presence.mounted) return null;

  const isRight = placement === 'right';
  const backdropVisible = backdrop ? backdrop === 'dim' : overlay;
  const scopedToContent = placement === 'center' && (fillContent || pageMode) && Boolean(contentRect);
  const wrapperClass = clsx(
    'app-modal-backdrop fixed z-[99999] flex',
    presence.visible && 'is-visible',
    mobileFullscreen
      ? 'inset-0 items-stretch justify-stretch overflow-hidden p-0'
      : isRight
      ? 'inset-y-0 right-0 justify-end'
      : fillContent || pageMode
        ? 'items-stretch justify-stretch overflow-hidden p-0'
        : 'items-center justify-center overflow-hidden p-4 sm:p-5 lg:p-6',
    !isRight && !scopedToContent && 'inset-0',
    backdropVisible && !pageMode ? 'bg-slate-950/[0.18] backdrop-blur-[2px]' : pageMode ? 'bg-white' : 'bg-transparent',
    !overlay && isRight && 'pointer-events-none',
  );

  const panelClass = clsx(
    'app-modal-panel app-panel pointer-events-auto flex min-h-0 flex-col overflow-hidden',
    !exitAnimation && !open && 'app-modal-panel-no-exit',
    isRight ? 'app-modal-panel-right' : 'app-modal-panel-center',
    presence.visible && 'is-visible',
    mobileFullscreen
      ? 'h-full w-full max-w-none rounded-none border-0'
      : isRight
      ? 'h-full rounded-none border-y-0 border-r-0'
      : fillContent || pageMode
        ? 'h-full max-h-none w-full max-w-none rounded-none'
        : 'max-h-[92vh] w-full rounded-none',
    !mobileFullscreen && !isRight && !fillContent && !pageMode && centerSizeClass[size],
    pageMode && '!border-0 !shadow-none',
    panelClassName,
  );

  const panelStyle = isRight && !mobileFullscreen ? rightSizeStyle[size] : undefined;

  return createPortal(
    <>
    {scopedToContent && backdropVisible && !pageMode && contentRect && contentRect.left > 0 && (
      <div
        className={clsx(
          'app-modal-backdrop fixed inset-y-0 left-0 z-[99999] bg-slate-950/[0.18] backdrop-blur-[2px]',
          presence.visible && 'is-visible',
        )}
        style={{ width: contentRect.left }}
        onMouseDown={() => {
          if (open && closeOnOverlay) onClose();
        }}
        role="presentation"
      />
    )}
    <div
      className={wrapperClass}
      style={scopedToContent && contentRect ? {
        left: contentRect.left,
        top: contentRect.top,
        width: contentRect.width,
        height: contentRect.height,
      } : undefined}
      onMouseDown={event => {
        if (!pageMode && open && closeOnOverlay && event.target === event.currentTarget) onClose();
      }}
      role="presentation"
    >
      <section
        role={pageMode ? 'region' : 'dialog'}
        aria-modal={!pageMode ? true : undefined}
        aria-labelledby={title ? 'app-modal-title' : undefined}
        className={panelClass}
        style={panelStyle}
        onMouseDown={event => event.stopPropagation()}
      >
        {(title || subtitle || showClose) && (
          <header className={clsx('flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-surface-200 px-4 py-4 sm:flex-nowrap sm:px-5', mobileFullscreen && 'pt-[calc(1rem+env(safe-area-inset-top))]', headerClassName)}>
            <div className="flex min-w-0 flex-1 items-start gap-3">
              {icon && <div className="mt-0.5 shrink-0 text-surface-500">{icon}</div>}
              <div className="min-w-0">
                {title && (
                  <h2 id="app-modal-title" className="truncate text-base font-semibold text-surface-900">
                    {title}
                  </h2>
                )}
                {subtitle && <div className="mt-1 break-words text-sm text-surface-500">{subtitle}</div>}
              </div>
            </div>

            <div className="ml-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-2">
            {headerActions}
            {showClose && (
              <button
                type="button"
                onClick={onClose}
                className="app-button-secondary h-10 min-h-0 w-10 shrink-0 !p-0 text-surface-500"
                aria-label="关闭"
              >
                <X size={20} className="shrink-0" />
              </button>
            )}
            </div>
          </header>
        )}

        <div className={clsx('min-h-0 flex-1 overflow-y-auto px-5 py-4', mobileFullscreen && 'pb-[calc(1rem+env(safe-area-inset-bottom))]', bodyClassName)}>{children}</div>

        {footer && (
          <footer className={clsx('flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-surface-200 bg-white px-5 py-4', mobileFullscreen && 'pb-[calc(1rem+env(safe-area-inset-bottom))]')}>
            {footer}
          </footer>
        )}
      </section>
    </div>
    </>,
    document.body,
  );
}
