import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, Check, ChevronDown, Delete, Plus, Search, X } from 'lucide-react';

type WheelOption = { value: string; label: string };

interface MobileBottomSheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  onConfirm: () => void;
  onCancel?: () => void;
  children: ReactNode;
  cancelLabel?: string;
  confirmLabel?: string;
  className?: string;
}

export function MobileBottomSheet({
  open,
  title,
  onClose,
  onConfirm,
  onCancel,
  children,
  cancelLabel = '取消',
  confirmLabel = '完成',
  className = '',
}: MobileBottomSheetProps) {
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open]);

  if (!open) return null;
  return createPortal(
    <div className="mobile-wheel-layer lg:hidden" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="mobile-wheel-backdrop" aria-label="关闭" onClick={onClose} />
      <section className={`mobile-wheel-sheet ${className}`}>
        <div className="mobile-wheel-head">
          <button type="button" onClick={onCancel || onClose}>{cancelLabel}</button>
          <strong>{title}</strong>
          <button type="button" className="is-primary" onClick={onConfirm}>{confirmLabel}</button>
        </div>
        <div className="mobile-sheet-body">{children}</div>
      </section>
    </div>,
    document.body,
  );
}

interface MobileOptionWheelSheetProps {
  open: boolean;
  title: string;
  options: WheelOption[];
  value?: string | null;
  onClose: () => void;
  onChange: (value: string | null) => void;
  clearable?: boolean;
}

export function MobileOptionWheelSheet({ open, title, options, value, onClose, onChange, clearable = true }: MobileOptionWheelSheetProps) {
  const [draft, setDraft] = useState(value || options[0]?.value || '');
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) return;
    setDraft(value || options[0]?.value || '');
    setQuery('');
  }, [open, options, value]);

  const filteredOptions = options.filter(option => option.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));

  return (
    <MobileBottomSheet
      open={open}
      title={title}
      cancelLabel={clearable ? '清空' : '取消'}
      onClose={onClose}
      onCancel={() => { if (clearable) onChange(null); onClose(); }}
      onConfirm={() => { onChange(draft || null); onClose(); }}
    >
      <div className="mobile-option-picker">
        <div className="mobile-option-search-row">
          <label className="mobile-option-search">
            <Search size={19} />
            <input value={query} onChange={event => setQuery(event.target.value)} placeholder="查找选项" />
          </label>
          {query.trim() && !options.some(option => option.label === query.trim())
            ? <button type="button" className="mobile-option-create" aria-label="使用新选项" onClick={() => setDraft(query.trim())}><Plus size={24} /></button>
            : null}
        </div>
        {draft ? <div className="mobile-option-current"><span>{options.find(option => option.value === draft)?.label || draft}<button type="button" aria-label="取消选择" onClick={() => setDraft('')}><X size={14} /></button></span></div> : null}
        <div className="mobile-option-list">
          {filteredOptions.map(option => {
            const active = option.value === draft;
            return <button key={option.value} type="button" className={active ? 'is-active' : ''} onClick={() => setDraft(option.value)}>
              <span className="mobile-option-radio" aria-hidden="true" />
              <span className="mobile-option-label">{option.label}</span>
            </button>;
          })}
          {!filteredOptions.length ? <div className="mobile-option-empty">没有匹配的选项</div> : null}
        </div>
      </div>
    </MobileBottomSheet>
  );
}

interface MobileSelectInputProps {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  title: string;
  className?: string;
  placeholder?: string;
  clearable?: boolean;
}

export function MobileSelectInput({ value, options, onChange, title, className = '', placeholder = '请选择', clearable = true }: MobileSelectInputProps) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={() => setOpen(true)} className={`${className} flex items-center justify-between text-left lg:hidden`}>
      <span className={`min-w-0 truncate ${value ? '' : 'text-surface-400'}`}>{value || placeholder}</span>
      <ChevronDown size={16} className="ml-2 shrink-0 text-surface-400" />
    </button>
    <MobileOptionWheelSheet
      open={open}
      title={title}
      value={value}
      options={options.map(option => ({ value: option, label: option }))}
      clearable={clearable}
      onClose={() => setOpen(false)}
      onChange={nextValue => onChange(nextValue || '')}
    />
  </>;
}

interface MobileDateInputProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  title?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function pad(value: number) { return String(value).padStart(2, '0'); }

export function MobileDateInput({ value, onChange, className = '', title = '选择日期', required, disabled, placeholder = '请选择日期' }: MobileDateInputProps) {
  const today = new Date();
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : today;
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(parsed.getFullYear());
  const [month, setMonth] = useState(parsed.getMonth() + 1);
  const [day, setDay] = useState(parsed.getDate());
  const years = useMemo(() => Array.from({ length: 21 }, (_, index) => today.getFullYear() - 10 + index), [today.getFullYear()]);
  const dayCount = daysInMonth(year, month);
  const wheelsRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (day > dayCount) setDay(dayCount); }, [day, dayCount]);
  useEffect(() => {
    if (!open) return;
    const next = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : today;
    setYear(next.getFullYear()); setMonth(next.getMonth() + 1); setDay(next.getDate());
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => wheelsRef.current?.querySelectorAll('.is-active').forEach(node => node.scrollIntoView({ block: 'center' })));
  }, [open, year, month, day]);

  const commit = () => { onChange(`${year}-${pad(month)}-${pad(day)}`); setOpen(false); };
  return <>
    <input type="date" value={value} onChange={event => onChange(event.target.value)} required={required} disabled={disabled} className={`${className} hidden lg:block`} />
    <button type="button" disabled={disabled} onClick={() => setOpen(true)} className={`${className} flex items-center justify-between text-left lg:hidden`}>
      <span className={value ? '' : 'text-surface-400'}>{value || placeholder}</span><CalendarDays size={17} className="shrink-0 text-surface-400" />
    </button>
    <MobileBottomSheet open={open} title={title} cancelLabel="清空" onClose={() => setOpen(false)} onCancel={() => { onChange(''); setOpen(false); }} onConfirm={commit}>
        <div ref={wheelsRef} className="mobile-date-wheels">
          <div>{years.map(item => <button key={item} type="button" className={item === year ? 'is-active' : ''} onClick={() => setYear(item)}>{item}年</button>)}</div>
          <div>{Array.from({ length: 12 }, (_, index) => index + 1).map(item => <button key={item} type="button" className={item === month ? 'is-active' : ''} onClick={() => setMonth(item)}>{item}月</button>)}</div>
          <div>{Array.from({ length: dayCount }, (_, index) => index + 1).map(item => { const weekday = '日一二三四五六'[new Date(year, month - 1, item).getDay()]; return <button key={item} type="button" className={item === day ? 'is-active' : ''} onClick={() => setDay(item)}>{item}日（周{weekday}）</button>; })}</div>
        </div>
    </MobileBottomSheet>
  </>;
}

interface MobileNumberInputProps {
  value: string | number;
  onChange: (value: string) => void;
  onCommit?: (value: string) => void;
  className?: string;
  title?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  prefix?: string;
  suffix?: string;
  step?: string;
}

export function MobileNumberInput({ value, onChange, onCommit, className = '', title = '数字', required, disabled, placeholder = '请输入数字', prefix = '', suffix = '', step }: MobileNumberInputProps) {
  const normalized = String(value ?? '');
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(normalized);

  useEffect(() => {
    if (!open) return;
    setDraft(normalized);
  }, [open, normalized]);

  const append = (key: string) => {
    if (key === '.') {
      if (draft.includes('.')) return;
      setDraft(current => current ? `${current}.` : '0.');
      return;
    }
    if (key === '±') {
      setDraft(current => current.startsWith('-') ? current.slice(1) : current ? `-${current}` : '-');
      return;
    }
    setDraft(current => current === '0' ? key : `${current}${key}`);
  };
  const commit = () => { (onCommit || onChange)(draft === '-' ? '' : draft); setOpen(false); };

  return <>
    <input type="number" step={step} value={normalized} onChange={event => onChange(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && onCommit) { event.preventDefault(); onCommit(event.currentTarget.value); } }} required={required} disabled={disabled} placeholder={placeholder} className={`${className} hidden lg:block`} />
    <button type="button" disabled={disabled} onClick={() => setOpen(true)} className={`${className} flex items-center text-left lg:hidden`}>
      <span className={normalized ? '' : 'text-surface-400'}>{normalized ? `${prefix}${normalized}${suffix}` : placeholder}</span>
    </button>
    <MobileBottomSheet open={open} title={title} onClose={() => setOpen(false)} onConfirm={commit} className="mobile-number-sheet">
        <div className="mobile-number-value">{prefix}<span>{draft || '0'}</span>{suffix}</div>
        <div className="mobile-number-pad">
          <div className="mobile-number-digits">{['7','8','9','4','5','6','1','2','3','.','0','±'].map(key => <button key={key} type="button" onClick={() => append(key)}>{key}</button>)}</div>
          <div className="mobile-number-actions"><button type="button" aria-label="退格" onClick={() => setDraft(current => current.slice(0, -1))}><Delete size={23} /></button><button type="button" className="is-confirm" aria-label="确认" onClick={commit}><Check size={28} /></button></div>
        </div>
    </MobileBottomSheet>
  </>;
}

interface MobileTextInputProps {
  value: string | number;
  onChange: (value: string) => void;
  onCommit?: (value: string) => void;
  className?: string;
  title?: string;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  placeholder?: string;
  multiline?: boolean;
}

export function MobileTextInput({ value, onChange, onCommit, className = '', title = '编辑内容', required, disabled, readOnly, placeholder = '请输入内容', multiline = false }: MobileTextInputProps) {
  const normalized = String(value ?? '');
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(normalized);

  useEffect(() => {
    if (!open) return;
    setDraft(normalized);
  }, [open, normalized]);

  const commit = () => { (onCommit || onChange)(draft); setOpen(false); };
  const desktopClassName = `${className} hidden lg:block`;
  return <>
    {multiline
      ? <textarea value={normalized} onChange={event => onChange(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && event.ctrlKey && onCommit) { event.preventDefault(); onCommit(event.currentTarget.value); } }} required={required} disabled={disabled} readOnly={readOnly} placeholder={placeholder} className={desktopClassName} />
      : <input value={normalized} onChange={event => onChange(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && onCommit) { event.preventDefault(); onCommit(event.currentTarget.value); } }} required={required} disabled={disabled} readOnly={readOnly} placeholder={placeholder} className={desktopClassName} />}
    <button type="button" disabled={disabled || readOnly} onClick={() => setOpen(true)} className={`${className} flex items-center text-left lg:hidden`}>
      <span className={`min-w-0 ${multiline ? 'line-clamp-3' : 'truncate'} ${normalized ? '' : 'text-surface-400'}`}>{normalized || placeholder}</span>
    </button>
    <MobileBottomSheet open={open} title={title} onClose={() => setOpen(false)} onConfirm={commit} className="mobile-text-sheet">
        <div className="mobile-text-editor">
          {multiline
            ? <textarea autoFocus value={draft} onChange={event => setDraft(event.target.value)} placeholder={placeholder} />
            : <input autoFocus value={draft} onChange={event => setDraft(event.target.value)} placeholder={placeholder} onKeyDown={event => { if (event.key === 'Enter') commit(); }} />}
        </div>
    </MobileBottomSheet>
  </>;
}
