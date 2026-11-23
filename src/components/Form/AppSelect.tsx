import { ReactNode, KeyboardEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

export type AppSelectOption = string | {
  value: string;
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  searchText?: string;
};

export interface AppSelectAction {
  label: ReactNode;
  icon?: ReactNode;
  onSelect: () => void;
  tone?: 'primary' | 'muted';
}

interface AppSelectProps {
  value: string | number | null | undefined;
  options: AppSelectOption[];
  onChange?: (value: string) => void;
  selectedValues?: string[];
  onToggle?: (value: string) => void;
  placeholder?: string;
  emptyText?: string;
  clearable?: boolean;
  clearLabel?: string;
  actions?: AppSelectAction[];
  size?: 'sm' | 'md';
  variant?: 'popover' | 'inline' | 'anchored';
  className?: string;
  triggerClassName?: string;
  triggerContent?: ReactNode;
  panelClassName?: string;
  matchTriggerWidth?: boolean;
  optionClassName?: string;
  dataEditing?: boolean;
  autoFocus?: boolean;
  autoOpen?: boolean;
  leading?: ReactNode;
  hideChevron?: boolean;
  hideSelectedCheck?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
}

function normalizeOption(option: AppSelectOption) {
  if (typeof option === 'string') {
    return {
      value: option,
      label: option,
      searchText: option,
      disabled: false,
    };
  }
  return {
    value: option.value,
    label: option.label ?? option.value,
    description: option.description,
    searchText: option.searchText ?? option.value,
    disabled: Boolean(option.disabled),
  };
}

const APP_SELECT_OPEN_EVENT = 'app-select:open';

export default function AppSelect({
  value,
  options,
  onChange,
  selectedValues,
  onToggle,
  placeholder = '请选择',
  emptyText = '暂无选项',
  clearable = false,
  clearLabel = '清空选择',
  actions = [],
  size = 'md',
  variant = 'popover',
  className = '',
  triggerClassName = '',
  triggerContent,
  panelClassName = '',
  matchTriggerWidth = false,
  optionClassName = '',
  dataEditing = false,
  autoFocus = false,
  autoOpen = false,
  leading,
  hideChevron = false,
  hideSelectedCheck = false,
  disabled = false,
  ariaLabel,
  onKeyDown,
}: AppSelectProps) {
  // Auto-open only after the trigger has mounted and its viewport position can
  // be measured. Starting in an open state leaves portal panels at (0, 0) in
  // sheet editors and the first user click then closes an invisible panel.
  const [open, setOpen] = useState(false);
  const [anchoredMaxHeight, setAnchoredMaxHeight] = useState(256);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef(Symbol('app-select'));
  const positionFrameRef = useRef<number | null>(null);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0 });
  const selectedValue = String(value ?? '');
  const selectedValueSet = useMemo(() => new Set(selectedValues || []), [selectedValues]);
  const isMultiple = Array.isArray(selectedValues) && Boolean(onToggle);
  const normalizedOptions = useMemo(() => options.map(normalizeOption), [options]);
  const selectedOption = normalizedOptions.find(option => option.value === selectedValue);
  const displayLabel = (selectedOption?.label ?? selectedValue) || placeholder;
  const enabledOptions = useMemo(() => normalizedOptions.filter(option => !option.disabled), [normalizedOptions]);
  const isInline = variant === 'inline';
  const isAnchored = variant === 'anchored';

  const updateAnchoredLayout = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    let scrollParent = buttonRef.current?.parentElement || null;
    while (scrollParent && scrollParent !== document.body) {
      const style = window.getComputedStyle(scrollParent);
      if (/(auto|scroll|overlay)/.test(style.overflowY) && scrollParent.scrollHeight > scrollParent.clientHeight) break;
      scrollParent = scrollParent.parentElement;
    }
    const boundary = scrollParent && scrollParent !== document.body
      ? scrollParent.getBoundingClientRect()
      : { top: 0, bottom: window.innerHeight };
    const boundaryBottom = Math.min(window.innerHeight - 8, boundary.bottom - 4);
    const roomBelow = Math.max(0, boundaryBottom - rect.bottom - 4);
    const optionCount = normalizedOptions.length + (clearable ? 1 : 0) + actions.length;
    const desiredHeight = Math.min(256, Math.max(72, optionCount * 40 + 8));
    setAnchoredMaxHeight(Math.max(72, Math.min(desiredHeight, roomBelow)));
  };

  const updatePosition = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return false;
    const isVisible = rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
    if (!isVisible) return false;
    const maxPanelHeight = 256;
    const panelWidth = matchTriggerWidth ? rect.width : Math.max(rect.width, 168);
    const roomBelow = window.innerHeight - rect.bottom - 8;
    const shouldOpenUp = roomBelow < Math.min(maxPanelHeight, 180) && rect.top > roomBelow;
    setPosition({
      top: shouldOpenUp ? Math.max(8, rect.top - maxPanelHeight - 4) : rect.bottom + 4,
      left: Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - panelWidth - 8)),
      width: rect.width,
    });
    return true;
  };

  const requestOpen = () => {
    if (disabled) return;
    document.dispatchEvent(new CustomEvent(APP_SELECT_OPEN_EVENT, { detail: instanceRef.current }));
    if (isAnchored) updateAnchoredLayout();
    else if (!isInline && !updatePosition()) return;
    setOpen(true);
  };

  useEffect(() => {
    const closeWhenAnotherSelectOpens = (event: Event) => {
      if ((event as CustomEvent<symbol>).detail !== instanceRef.current) setOpen(false);
    };
    document.addEventListener(APP_SELECT_OPEN_EVENT, closeWhenAnotherSelectOpens);
    return () => document.removeEventListener(APP_SELECT_OPEN_EVENT, closeWhenAnotherSelectOpens);
  }, []);

  useLayoutEffect(() => {
    if (!autoFocus && !autoOpen) return;
    if (autoOpen) requestOpen();
    if (autoFocus) buttonRef.current?.focus();
  }, [autoFocus, autoOpen, isAnchored, isInline]);

  useEffect(() => {
    if (!open) return;
    if (isAnchored) updateAnchoredLayout();
    else if (!isInline) updatePosition();
    const handlePointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const schedulePositionUpdate = () => {
      if (positionFrameRef.current !== null) window.cancelAnimationFrame(positionFrameRef.current);
      positionFrameRef.current = window.requestAnimationFrame(() => {
        positionFrameRef.current = null;
        if (!updatePosition()) setOpen(false);
      });
    };
    const handleScroll = (event: Event) => {
      const target = event.target as Node | null;
      if (target && panelRef.current?.contains(target)) return;
      schedulePositionUpdate();
    };
    if (!isInline && !isAnchored) {
      window.addEventListener('scroll', handleScroll, true);
      window.addEventListener('resize', schedulePositionUpdate);
    } else if (isAnchored) {
      window.addEventListener('resize', updateAnchoredLayout);
    }
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      if (!isInline && !isAnchored) {
        window.removeEventListener('scroll', handleScroll, true);
        window.removeEventListener('resize', schedulePositionUpdate);
      } else if (isAnchored) {
        window.removeEventListener('resize', updateAnchoredLayout);
      }
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
      if (positionFrameRef.current !== null) {
        window.cancelAnimationFrame(positionFrameRef.current);
        positionFrameRef.current = null;
      }
    };
  }, [isAnchored, isInline, open]);

  useEffect(() => {
    if (!open) return;
    const selectedIndex = enabledOptions.findIndex(option => option.value === selectedValue);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [enabledOptions, open, selectedValue]);

  const commit = (nextValue: string) => {
    if (isMultiple) {
      onToggle?.(nextValue);
      return;
    }
    onChange?.(nextValue);
    setOpen(false);
    buttonRef.current?.focus();
  };

  const moveActive = (direction: 1 | -1) => {
    setActiveIndex(index => {
      if (enabledOptions.length === 0) return 0;
      return Math.min(Math.max(index + direction, 0), enabledOptions.length - 1);
    });
  };

  const commitActive = () => {
    const option = enabledOptions[activeIndex];
    if (option) commit(option.value);
  };

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (open) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        moveActive(1);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        moveActive(-1);
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        commitActive();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        return;
      }
    }
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      requestOpen();
      return;
    }
    onKeyDown?.(event);
  };

  const handlePanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveActive(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveActive(-1);
      return;
    }
    if (event.key === 'Enter' && enabledOptions[activeIndex]) {
      event.preventDefault();
      commitActive();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    }
  };

  const panel = (
    <div
      ref={panelRef}
      role="listbox"
      tabIndex={-1}
      className={`app-select-panel project-sheet-context-menu ${isInline ? 'app-select-panel-inline' : ''} ${isAnchored ? 'app-select-panel-anchored' : ''} ${panelClassName}`}
      style={isInline ? undefined : isAnchored ? { maxHeight: anchoredMaxHeight } : {
        top: position.top,
        left: position.left,
        width: matchTriggerWidth ? position.width : Math.max(position.width, 168),
        maxWidth: matchTriggerWidth ? 'calc(100vw - 16px)' : undefined,
      }}
      onKeyDown={handlePanelKeyDown}
      onMouseDown={event => event.stopPropagation()}
    >
      {normalizedOptions.length === 0 ? (
        <div className="app-select-empty">{emptyText}</div>
      ) : (
        <div className="app-select-options">
          {clearable && (
            <button
              type="button"
              role="option"
              aria-selected={!selectedValue}
              className={`app-select-option project-sheet-context-menu__item ${!selectedValue ? 'is-selected' : ''} ${optionClassName}`}
              onMouseDown={event => {
                event.preventDefault();
                commit('');
              }}
            >
              <span className="app-select-option-main">{clearLabel}</span>
              {!hideSelectedCheck && !selectedValue && <Check size={14} className="app-select-check" />}
            </button>
          )}
          {normalizedOptions.map(option => {
            const selected = isMultiple ? selectedValueSet.has(option.value) : option.value === selectedValue;
            const active = enabledOptions[activeIndex]?.value === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selected}
                disabled={option.disabled}
                className={`app-select-option project-sheet-context-menu__item ${selected ? 'is-selected' : ''} ${active ? 'is-active' : ''} ${option.disabled ? 'is-disabled' : ''} ${optionClassName}`}
                title={typeof option.label === 'string' ? option.label : option.value}
                onMouseEnter={() => {
                  const nextIndex = enabledOptions.findIndex(item => item.value === option.value);
                  if (nextIndex >= 0) setActiveIndex(nextIndex);
                }}
                onMouseDown={event => {
                  event.preventDefault();
                  if (!option.disabled) commit(option.value);
                }}
              >
                <span className="app-select-option-content">
                  <span className="app-select-option-main">{option.label}</span>
                  {option.description && <span className="app-select-option-description">{option.description}</span>}
                </span>
                {!hideSelectedCheck && selected && <Check size={14} className="app-select-check" />}
              </button>
            );
          })}
        </div>
      )}

      {actions.length > 0 && (
        <div className="app-select-actions">
          {actions.map((action, index) => (
            <button
              key={index}
              type="button"
              className={`app-select-action ${action.tone === 'primary' ? 'is-primary' : ''}`}
              onMouseDown={event => {
                event.preventDefault();
                setOpen(false);
                action.onSelect();
              }}
            >
              {action.icon && <span className="app-select-action-icon">{action.icon}</span>}
              <span className="truncate">{action.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div ref={rootRef} data-editing={dataEditing ? 'true' : undefined} className={`app-select app-select-${size} app-select-${variant} ${className}`}>
      <button
        ref={buttonRef}
        type="button"
      disabled={disabled}
      onMouseDown={event => event.stopPropagation()}
      onClick={() => {
          if (open) setOpen(false);
          else requestOpen();
        }}
        onKeyDown={handleTriggerKeyDown}
        className={`app-select-trigger ${triggerClassName} ${isMultiple ? (selectedValueSet.size > 0 ? 'has-value' : 'is-empty') : (selectedValue ? 'has-value' : 'is-empty')} ${disabled ? 'cursor-default bg-slate-50 text-slate-500' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        {leading && <span className="app-select-leading">{leading}</span>}
        <span className="app-select-value">{triggerContent ?? displayLabel}</span>
        {!hideChevron && <ChevronDown size={14} className={`app-select-chevron ${open ? 'is-open' : ''}`} />}
      </button>

      {open && (isInline || isAnchored ? panel : createPortal(panel, document.body))}
    </div>
  );
}
