import { Info } from 'lucide-react';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface FeatureInfoProps {
  label: string;
  children: React.ReactNode;
}

export default function FeatureInfo({ label, children }: FeatureInfoProps) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const visible = open || hovered;

  const updatePosition = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const tooltipWidth = 256;
    const viewportGap = 8;
    setPosition({
      left: Math.max(viewportGap, Math.min(rect.left + rect.width / 2 - tooltipWidth / 2, window.innerWidth - tooltipWidth - viewportGap)),
      top: rect.bottom + 8,
    });
  }, []);

  useLayoutEffect(() => {
    if (!visible) return;
    const anchor = buttonRef.current?.getBoundingClientRect();
    const tooltip = tooltipRef.current?.getBoundingClientRect();
    if (!anchor || !tooltip) return;
    const viewportGap = 8;
    const left = Math.max(
      viewportGap,
      Math.min(anchor.left + anchor.width / 2 - tooltip.width / 2, window.innerWidth - tooltip.width - viewportGap),
    );
    const below = anchor.bottom + 8;
    const top = below + tooltip.height <= window.innerHeight - viewportGap
      ? below
      : Math.max(viewportGap, anchor.top - tooltip.height - 8);
    setPosition(current => current.left === left && current.top === top ? current : { left, top });
  }, [visible, children]);

  return (
    <span
      className="relative inline-flex shrink-0 align-middle"
      onMouseEnter={() => {
        updatePosition();
        setHovered(true);
      }}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={event => {
          event.stopPropagation();
          updatePosition();
          setOpen(value => !value);
        }}
        onFocus={() => {
          updatePosition();
          setHovered(true);
        }}
        onBlur={() => {
          setOpen(false);
          setHovered(false);
        }}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-surface-400 transition-colors hover:bg-primary-50 hover:text-primary-700 focus-visible:bg-primary-50 focus-visible:text-primary-700"
      >
        <Info size={15} aria-hidden="true" />
      </button>
      {visible && createPortal(
        <span
          ref={tooltipRef}
          role="tooltip"
          style={{ left: position.left, top: position.top }}
          className="pointer-events-none fixed z-[1000] max-h-[calc(100dvh-1rem)] w-[min(16rem,calc(100vw-1rem))] overflow-y-auto border border-surface-200 bg-white px-3 py-2.5 text-left text-xs font-normal leading-5 text-surface-700 shadow-lg"
        >
          {children}
        </span>,
        document.body,
      )}
    </span>
  );
}
