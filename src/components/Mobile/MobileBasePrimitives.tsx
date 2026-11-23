import type { LucideIcon } from 'lucide-react';
import { Check, ChevronLeft, ChevronRight, Plus, Search, SlidersHorizontal, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function MobileBaseAppbar({
  title,
  backLabel,
  onBack,
  action,
}: {
  title: string;
  backLabel?: string;
  onBack?: () => void;
  action?: ReactNode;
}) {
  return (
    <header className="mobile-base-appbar">
      {onBack ? <button type="button" onClick={onBack} aria-label={backLabel || '返回'}><ChevronLeft size={25} /></button> : <span />}
      <h1>{title}</h1>
      <span className="mobile-base-appbar__action">{action}</span>
    </header>
  );
}

export function MobileBaseAppEntry({ icon: Icon, label, color, background, onClick }: {
  icon: LucideIcon;
  label: string;
  color: string;
  background: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="mobile-base-app-entry" onClick={onClick}>
      <span className="mobile-base-app-icon" style={{ color, background }}><Icon size={23} /></span>
      <span>{label}</span>
    </button>
  );
}

export function MobileBaseSettingsRow({ icon: Icon, label, value, danger = false, onClick }: {
  icon?: LucideIcon;
  label: string;
  value?: string;
  danger?: boolean;
  onClick?: () => void;
}) {
  return (
    <button type="button" className={`mobile-base-settings-row${danger ? ' is-danger' : ''}`} onClick={onClick}>
      {Icon && <Icon size={20} />}
      <strong>{label}</strong>
      {!danger && <span>{value}{value ? '　' : ''}<ChevronRight size={15} /></span>}
    </button>
  );
}

export type MobileLibraryFilter = {
  key: string;
  label: string;
  count?: number;
};

export function MobileLibrarySlice({
  title,
  search,
  searchPlaceholder,
  filters,
  activeFilter,
  loading,
  emptyText,
  onSearchChange,
  onFilterChange,
  onCreate,
  children,
}: {
  title: string;
  search: string;
  searchPlaceholder: string;
  filters: MobileLibraryFilter[];
  activeFilter: string;
  loading: boolean;
  emptyText: string;
  onSearchChange: (value: string) => void;
  onFilterChange: (key: string) => void;
  onCreate: () => void;
  children: ReactNode;
}) {
  return (
    <section className="mobile-library-slice lg:hidden">
      <MobileBaseAppbar
        title={title}
        action={<button type="button" onClick={onCreate} aria-label={`新增${title}`}><Plus size={23} /></button>}
      />
      <div className="mobile-library-toolbar">
        <label>
          <Search size={17} />
          <input
            value={search}
            onChange={event => onSearchChange(event.target.value)}
            placeholder={searchPlaceholder}
          />
        </label>
        <button type="button" aria-label="筛选"><SlidersHorizontal size={19} /></button>
      </div>
      <div className="mobile-library-filter-strip">
        {filters.map(filter => (
          <button
            key={filter.key}
            type="button"
            className={filter.key === activeFilter ? 'is-active' : ''}
            onClick={() => onFilterChange(filter.key)}
          >
            {filter.label}{typeof filter.count === 'number' ? ` ${filter.count}` : ''}
          </button>
        ))}
      </div>
      <main className="mobile-library-card-list">
        {loading ? (
          <div className="mobile-library-loading" aria-label="正在加载">
            {Array.from({ length: 4 }, (_, index) => <span key={index} />)}
          </div>
        ) : children || <div className="mobile-library-empty">{emptyText}</div>}
      </main>
      <button type="button" className="mobile-library-fab" onClick={onCreate} aria-label={`新增${title}`}><Plus size={24} /></button>
    </section>
  );
}

export function MobileLibraryCard({
  icon: Icon,
  title,
  description,
  status,
  statusTone = 'blue',
  meta,
  iconColor,
  iconBackground,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  status: string;
  statusTone?: 'blue' | 'green' | 'amber' | 'gray';
  meta: string[];
  iconColor: string;
  iconBackground: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="mobile-library-card" onClick={onClick}>
      <span className="mobile-library-card__icon" style={{ color: iconColor, background: iconBackground }}><Icon size={22} /></span>
      <span className="mobile-library-card__body">
        <span className="mobile-library-card__heading">
          <strong>{title}</strong>
          <i className={`is-${statusTone}`}>{status}</i>
        </span>
        <span className="mobile-library-card__description">{description}</span>
        <span className="mobile-library-card__meta">
          {meta.map((value, index) => <span key={`${value}-${index}`}>{value}</span>)}
        </span>
      </span>
      <ChevronRight className="mobile-library-card__chevron" size={16} />
    </button>
  );
}

export type MobileDetailEditorType = 'text' | 'textarea' | 'number' | 'date' | 'select';

export type MobileDetailEditorField = {
  key: string;
  label: string;
  value: string | number;
  type: MobileDetailEditorType;
  options?: string[];
  unit?: string;
  placeholder?: string;
};

export function MobileDetailSection({ title, hint, children }: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="mobile-record-section">
      <header>
        <h2>{title}</h2>
        {hint && <span>{hint}</span>}
      </header>
      <div className="mobile-record-fields">{children}</div>
    </section>
  );
}

export function MobileDetailFieldRow({ label, value, unit, readOnly = false, onClick }: {
  label: string;
  value: ReactNode;
  unit?: string;
  readOnly?: boolean;
  onClick?: () => void;
}) {
  const hasValue = value !== '' && value !== null && value !== undefined;
  const content = (
    <>
      <span className="mobile-record-field__label">{label}</span>
      <span className="mobile-record-field__value">{hasValue ? value : '未填写'}{unit && hasValue ? <small>{unit}</small> : null}</span>
      <span className="mobile-record-field__action">{readOnly ? <small>自动计算</small> : <ChevronRight size={16} />}</span>
    </>
  );
  return onClick && !readOnly
    ? <button type="button" className="mobile-record-field" onClick={onClick}>{content}</button>
    : <div className="mobile-record-field is-readonly">{content}</div>;
}

export function MobileDetailEditorSheet({ field, onClose, onSave }: {
  field: MobileDetailEditorField | null;
  onClose: () => void;
  onSave: (value: string) => void;
}) {
  const [draft, setDraft] = useState('');

  useEffect(() => {
    setDraft(field == null ? '' : String(field.value ?? ''));
  }, [field]);

  useEffect(() => {
    if (!field) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [field, onClose]);

  if (!field) return null;

  const submit = () => {
    onSave(draft);
    onClose();
  };

  return createPortal((
    <div className="mobile-editor-layer" role="presentation">
      <button type="button" className="mobile-editor-backdrop" onClick={onClose} aria-label="关闭编辑面板" />
      <section className={`mobile-editor-sheet is-${field.type}`} role="dialog" aria-modal="true" aria-label={`编辑${field.label}`}>
        <i className="mobile-editor-sheet__handle" />
        <header className="mobile-editor-sheet__header">
          <button type="button" onClick={onClose} aria-label="取消"><X size={20} /></button>
          <div><strong>{field.label}</strong><span>{field.type === 'select' ? '选择一个选项' : field.type === 'number' ? '请输入数值' : field.type === 'date' ? '选择日期' : '编辑内容'}</span></div>
          <button type="button" className="is-save" onClick={submit}>保存</button>
        </header>
        <div className="mobile-editor-sheet__body">
          {field.type === 'select' ? (
            <div className="mobile-editor-options">
              {[...new Set((field.options || []).filter(Boolean))].map(option => (
                <button key={option} type="button" className={draft === option ? 'is-selected' : ''} onClick={() => setDraft(option)}>
                  <span>{option}</span>{draft === option && <Check size={19} />}
                </button>
              ))}
              {(field.options || []).length === 0 && <p>暂无可选项</p>}
            </div>
          ) : field.type === 'textarea' ? (
            <label className="mobile-editor-textarea">
              <textarea autoFocus value={draft} onChange={event => setDraft(event.target.value)} placeholder={field.placeholder || `请输入${field.label}`} />
              <span>{draft.length} 字</span>
            </label>
          ) : field.type === 'number' ? (
            <label className="mobile-editor-number">
              <input autoFocus type="number" inputMode="decimal" value={draft} onChange={event => setDraft(event.target.value)} placeholder="0" />
              {field.unit && <span>{field.unit}</span>}
            </label>
          ) : field.type === 'date' ? (
            <label className="mobile-editor-date">
              <span>日期</span>
              <input autoFocus type="date" value={draft} onChange={event => setDraft(event.target.value)} />
            </label>
          ) : (
            <label className="mobile-editor-text">
              <input autoFocus value={draft} onChange={event => setDraft(event.target.value)} placeholder={field.placeholder || `请输入${field.label}`} />
              {draft && <button type="button" onClick={() => setDraft('')} aria-label="清空"><X size={16} /></button>}
            </label>
          )}
        </div>
      </section>
    </div>
  ), document.getElementById('root') || document.body);
}
