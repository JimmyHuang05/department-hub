import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, ArrowUpDown, Trash2, ChevronLeft, ChevronRight, Copy, FilePlus, FileText, Trash, ArrowUpToLine, ArrowDownToLine, Users as UsersIcon, EyeOff, Eye, ChevronDown, Plus, Pencil, Search, RotateCcw } from 'lucide-react';
import { generateId } from '../../utils/id';
import AppSelect from '../Form/AppSelect';
import { useCollaborationStore } from '../../store/collaborationStore';
import { broadcastEditingStart, broadcastEditingStop } from '../../hooks/useCollaboration';
import { useConfirm } from '../Toast';

/* ── 自定义下拉组件（fixed 定位，避免被 overflow:hidden 裁剪）─ */
function CustomSelect({ value, options, onChange, onAddOption, onEditOption, onKeyDown, placeholder = '请选择', className = '' }: {
  value: string; options: string[]; onChange: (v: string) => void;
  onAddOption?: () => void; onEditOption?: () => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  placeholder?: string; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });

  // 打开时计算 fixed 定位坐标
  useEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 4, left: r.left, width: r.width });
  }, [open]);

  // 窗口滚动/缩放时更新坐标
  useEffect(() => {
    if (!open) return;
    const update = () => {
      if (btnRef.current) {
        const r = btnRef.current.getBoundingClientRect();
        setPos({ top: r.bottom + 4, left: r.left, width: r.width });
      }
    };
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open]);

  // 点击外部关闭（同时检查触发器容器和 Portal 面板）
  useEffect(() => {
    if (!open) return;
    const cb = (e: MouseEvent) => {
      const target = e.target as Node;
      const outTrigger = ref.current && !ref.current.contains(target);
      const outPanel = !panelRef.current || !panelRef.current.contains(target);
      if (outTrigger && outPanel) setOpen(false);
    };
    document.addEventListener('mousedown', cb);
    return () => document.removeEventListener('mousedown', cb);
  }, [open]);

  // ESC 关闭
  useEffect(() => {
    if (!open) return;
    const cb = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', cb);
    return () => document.removeEventListener('keydown', cb);
  }, [open]);

  const selLabel = value || placeholder;

  return (
    <div ref={ref} data-editing="true" className={`relative ${className}`}>
      {/* 触发器按钮 */}
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => onKeyDown?.(e)}
        className={`
          w-full flex items-center justify-between gap-1
          px-2.5 py-1.5 text-sm
          bg-white border border-surface-200
          rounded-lg
          hover:border-brand-400
          focus:outline-none focus:ring-2 focus:ring-brand-500/25 focus:border-brand-500
          transition-all duration-150
          ${value ? 'text-slate-800' : 'text-slate-400'}
        `}
      >
        <span className="truncate">{selLabel}</span>
        <ChevronDown size={14} className={`text-surface-400 flex-shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* 下拉面板 — 使用 Portal 渲染到 body，避免表格 overflow/层级约束 */}
      {open && createPortal(
        <div ref={panelRef}
          className="fixed z-[99999] bg-white border border-surface-200 rounded-xl shadow-lg animate-scale-in origin-top max-h-64 overflow-y-auto"
          style={{ top: pos.top, left: pos.left, width: Math.max(pos.width, 160) }}
        >
          {options.length === 0 && (
            <div className="px-3 py-3 text-sm text-slate-400 text-center">暂无选项</div>
          )}
          {options.map(opt => (
            <button
              key={opt}
              type="button"
              className={`
                w-full text-left px-3 py-2.5 text-sm
                transition-colors duration-100
                ${opt === value
                  ? 'bg-brand-50 text-brand-800 font-medium'
                  : 'text-slate-700 hover:bg-surface-50'
                }
              `}
              onMouseDown={e => { e.preventDefault(); onChange(opt); setOpen(false); }}
            >
              {opt}
            </button>
          ))}

          {/* 分隔线 */}
          {(onAddOption || onEditOption) && options.length > 0 && (
            <div className="mx-2 my-1 border-t border-surface-150" />
          )}

          {/* 底部操作区 */}
          <div className="py-1">
            {onAddOption && (
              <button
                type="button"
                className="w-full text-left px-3 py-2.5 text-sm text-brand-600 hover:bg-brand-50 transition-colors duration-100 flex items-center gap-2"
                onMouseDown={e => { e.preventDefault(); onAddOption(); setOpen(false); }}
              >
                <Plus size={14} className="flex-shrink-0" />
                <span>新增选项</span>
              </button>
            )}
            {onEditOption && (
              <button
                type="button"
                className="w-full text-left px-3 py-2.5 text-sm text-slate-500 hover:bg-surface-50 transition-colors duration-100 flex items-center gap-2"
                onMouseDown={e => { e.preventDefault(); onEditOption(); setOpen(false); }}
              >
                <Pencil size={14} className="flex-shrink-0" />
                <span>编辑选项</span>
              </button>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

/* ── 自定义联想输入组件（样式与 CustomSelect 统一）─ */
void CustomSelect;

function AutocompleteDropdown({ value, options, onChange, onCommit, onKeyDown, placeholder = '' }: {
  value: string; options: string[]; onChange: (v: string) => void;
  onCommit?: (v: string) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [inputVal, setInputVal] = useState(value || '');
  const [filter, setFilter] = useState('');
  const [selIdx, setSelIdx] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const btnRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });

  const filtered = useMemo(() => {
    if (!filter) return options;
    return options.filter(o => o.toLowerCase().includes(filter.toLowerCase()));
  }, [options, filter]);

  // 同步外部 value
  useEffect(() => { setInputVal(value || ''); }, [value]);

  // 坐标计算
  const updatePos = useCallback(() => {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left, width: r.width });
    }
  }, []);
  useEffect(() => { if (open) updatePos(); }, [open, updatePos]);
  useEffect(() => {
    if (!open) return;
    window.addEventListener('scroll', updatePos, true);
    window.addEventListener('resize', updatePos);
    return () => { window.removeEventListener('scroll', updatePos, true); window.removeEventListener('resize', updatePos); };
  }, [open, updatePos]);

  // 点击外部关闭（同时检查触发器容器和 Portal 面板）
  useEffect(() => {
    if (!open) return;
    const cb = (e: MouseEvent) => {
      const target = e.target as Node;
      const outTrigger = ref.current && !ref.current.contains(target);
      const outPanel = !panelRef.current || !panelRef.current.contains(target);
      if (outTrigger && outPanel) setOpen(false);
    };
    document.addEventListener('mousedown', cb);
    return () => document.removeEventListener('mousedown', cb);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const cb = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', cb);
    return () => document.removeEventListener('keydown', cb);
  }, [open]);

  const commit = (v: string) => {
    setInputVal(v);
    onChange(v);
    onCommit?.(v);
    setOpen(false);
    setFilter('');
  };

  return (
    <div ref={ref} data-editing="true" className="relative">
      <div ref={btnRef} className="flex items-center border border-brand-500 rounded-lg bg-white focus-within:ring-2 focus-within:ring-brand-500/25 transition-all">
        <input
          ref={inputRef}
          value={inputVal}
          placeholder={placeholder}
          onChange={e => {
            const v = e.target.value;
            setInputVal(v);
            onChange(v); // 同步更新父级 editingCell.value
            setFilter(v);
            setOpen(true);
            setSelIdx(-1);
          }}
          onFocus={() => { setFilter(inputVal); setOpen(true); }}
          onBlur={() => {
            setTimeout(() => { setOpen(false); onCommit?.(inputVal); }, 120);
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (selIdx >= 0 && filtered[selIdx]) commit(filtered[selIdx]);
              else commit(inputVal);
            } else if (e.key === 'Escape') {
              setOpen(false);
            } else if (e.key === 'ArrowDown') {
              e.preventDefault(); setSelIdx(i => Math.min(i + 1, filtered.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault(); setSelIdx(i => Math.max(i - 1, 0));
            } else if (e.key === 'Tab') {
              if (selIdx >= 0 && filtered[selIdx]) commit(filtered[selIdx]);
              onKeyDown?.(e);
            } else {
              onKeyDown?.(e);
            }
          }}
          className="flex-1 px-2.5 py-1.5 text-sm outline-none bg-transparent rounded-lg text-slate-800 placeholder:text-slate-400"
        />
        <Search size={14} className="text-surface-400 mr-2 flex-shrink-0" />
      </div>

      {open && filtered.length > 0 && createPortal(
        <div ref={panelRef}
          className="fixed z-[99999] bg-white border border-surface-200 rounded-xl shadow-lg animate-scale-in origin-top max-h-52 overflow-y-auto"
          style={{ top: pos.top, left: pos.left, width: Math.max(pos.width, 160) }}
        >
          {filtered.map((opt, i) => (
            <button
              key={opt}
              type="button"
              className={`w-full text-left px-3 py-2.5 text-sm transition-colors duration-100 ${
                i === selIdx
                  ? 'bg-brand-100 text-brand-800 font-medium'
                  : 'text-slate-700 hover:bg-surface-50'
              }`}
              onMouseDown={e => { e.preventDefault(); commit(opt); }}
              onMouseEnter={() => setSelIdx(i)}
            >
              {opt}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

export interface DataTableColumn { key: string; title: string; width?: number; sortable?: boolean; editable?: boolean; type?: 'text' | 'number' | 'date' | 'select' | 'autocomplete'; }
interface EditingCell { id: string; field: string; value: any; }
interface UndoEntry { id: string; field: string; prevValue: any; }
interface ContextMenu { x: number; y: number; itemId?: string; rowIndex: number; field?: string; colIndex?: number; isHeader?: boolean; }
const UNDO_MAX = 50;

interface DataTableProps<T extends { id: string }> {
  data: T[]; columns: DataTableColumn[]; selectedIds: string[]; isLoading?: boolean; emptyMessage?: string;
  onDelete: (id: string) => void; onCellEdit: (id: string, field: string, value: any) => void;
  onToggleSelect: (id: string) => void; onToggleSelectAll: () => void;
  onInsertAt?: (index: number, item: T) => void; onMoveItem?: (id: string, toIndex: number) => void; onAddBlank?: () => T;
  columnWidthsKey: string; defaultColumnWidths: Record<string, number>;
  renderCell?: (item: T, column: DataTableColumn, rowIndex: number) => React.ReactNode;
  getFieldOptions?: (field: string) => string[]; getFieldSuggestions?: (field: string) => string[]; numericFields?: string[];
  onAddFieldOption?: (field: string, value: string) => void;
  onDeleteFieldOption?: (field: string, value: string) => void;
  onRenameFieldOption?: (field: string, oldValue: string, newValue: string) => void;
  extraToolbarContent?: React.ReactNode; collabEnabled?: boolean;
  collabRecordType?: string; collabLocation?: string;
  onShowVersionHistory?: (recordId: string) => void;
  /** 检测重复的字段：如果指定，保存后自动检查这些字段值是否与其他行完全一致 */
  duplicateKeyFields?: string[];
  /** 重复组 ID 列表：数组的每个元素是一组重复记录的 ID 数组，用于标红和组标头 */
  duplicateGroupIds?: string[][];
}

export default function DataTable<T extends { id: string }>({
  data, columns, selectedIds, isLoading, emptyMessage = '暂无数据',
  onDelete, onCellEdit, onToggleSelect, onToggleSelectAll,
  onInsertAt, onMoveItem, onAddBlank,
  columnWidthsKey, defaultColumnWidths,
  renderCell, getFieldOptions, getFieldSuggestions, numericFields = [],
  onAddFieldOption, onDeleteFieldOption, onRenameFieldOption,
  extraToolbarContent, collabEnabled, collabRecordType = 'record', collabLocation = '',
  onShowVersionHistory,
  duplicateKeyFields, duplicateGroupIds,
}: DataTableProps<T>) {
  const { confirm: ask, ConfirmDialog } = useConfirm();
  const readOnly = false;
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [pageSize, setPageSize] = useState(1000);
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [activeCell, setActiveCell] = useState<{ row: number; col: number } | null>(null);
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    try { const s = localStorage.getItem(columnWidthsKey); if (s) { const p = JSON.parse(s); for (const k of Object.keys(defaultColumnWidths)) { p[k] = Math.max(p[k] || 0, defaultColumnWidths[k]); } return p; } } catch {}
    return defaultColumnWidths;
  });
  // 列宽持久化到 localStorage，且每次保存时清理旧的窄缓存（用默认宽度兜底）
  useEffect(() => {
    const toSave = { ...colWidths };
    for (const k of Object.keys(defaultColumnWidths)) {
      toSave[k] = Math.max(toSave[k] || 0, defaultColumnWidths[k]);
    }
    localStorage.setItem(columnWidthsKey, JSON.stringify(toSave));
  }, [colWidths, columnWidthsKey]);
  const [undo, setUndo] = useState<UndoEntry[]>([]);
  const [redo, setRedo] = useState<UndoEntry[]>([]);
  const [lastIdx, setLastIdx] = useState<number | null>(null);
  const [ctx, setCtx] = useState<ContextMenu | null>(null);
  const [sel, setSel] = useState<{ r1: number; c1: number; r2: number; c2: number } | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [cutBuf, setCutBuf] = useState<{ id: string; field: string; value: any } | null>(null);
  const [pg, setPg] = useState(1);
  const [ncs, setNcs] = useState<Set<string>>(new Set());
  // 新增选项弹窗状态
  const [addingOption, setAddingOption] = useState<{ field: string; input: string } | null>(null);
  // 编辑选项弹窗状态
  const [editingOption, setEditingOption] = useState<{ field: string; renameTarget: string; renameInput: string } | null>(null);
  // 重复条目提醒
  const [dupAlert, setDupAlert] = useState<{ ids: string[]; currentId: string } | null>(null);
  const drag = useRef(false);
  const dStart = useRef<{ row: number; col: number } | null>(null);
  const ir = useRef<HTMLInputElement | HTMLSelectElement | null>(null);
  const cr = useRef<{ [k: string]: HTMLTableCellElement | null }>({});
  const dr = useRef<{ ci: number; sx: number; sw: number } | null>(null);
  const tr = useRef<HTMLDivElement>(null);
  const sr = useRef<HTMLDivElement>(null);
  const crm = useRef<HTMLDivElement>(null);
  const lc = useRef(0);
  const editingPresenceRef = useRef<{
    recordType: string;
    recordId: string | null;
    recordLabel: string;
    field: string;
    fieldLabel: string;
    location: string;
    startedAt: number;
  } | null>(null);
  const vis = useMemo(() => columns.filter(c => !hidden.has(c.key)), [columns, hidden]);

  useEffect(() => { const t = tr.current, s = sr.current; if (!t||!s) return; const a = () => { s.scrollLeft = t.scrollLeft; }; const b = () => { t.scrollLeft = s.scrollLeft; }; t.addEventListener('scroll', a); s.addEventListener('scroll', b); return () => { t.removeEventListener('scroll', a); s.removeEventListener('scroll', b); }; }, []);
  useEffect(() => { if (!ctx) return; const c = () => setCtx(null); document.addEventListener('mousedown', c); document.addEventListener('scroll', c, true); return () => { document.removeEventListener('mousedown', c); document.removeEventListener('scroll', c, true); }; }, [ctx]);
  useEffect(() => { if (editingCell && ir.current) { ir.current.focus(); if (ir.current instanceof HTMLInputElement && ir.current.type !== 'date') ir.current.setSelectionRange(ir.current.value.length, ir.current.value.length); } }, [editingCell]);
  // 模态框防卡死：全局 ESC 兜底关闭
  useEffect(() => {
    if (!addingOption && !editingOption && !dupAlert) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (addingOption) setAddingOption(null);
        if (editingOption) setEditingOption(null);
        if (dupAlert) setDupAlert(null);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [addingOption, editingOption, dupAlert]);

  const nums = useMemo(() => new Set(numericFields), [numericFields]);
  const dupSet = useMemo(() => new Set(duplicateGroupIds?.flat() || []), [duplicateGroupIds]);
  const dupStartSet = useMemo(() => {
    if (!duplicateGroupIds) return new Set<string>();
    return new Set(duplicateGroupIds.map(g => g[0]).filter(Boolean));
  }, [duplicateGroupIds]);
  const sorted = useMemo(() => {
    if (!sortColumn) return data;
    return [...data].sort((a, b) => { const av = (a as any)[sortColumn], bv = (b as any)[sortColumn]; if (av === bv) return 0; if (av == null) return 1; if (bv == null) return -1; const c = nums.has(sortColumn) ? Number(av) - Number(bv) : String(av).localeCompare(String(bv), 'zh-CN'); return sortDirection === 'asc' ? c : -c; });
  }, [data, sortColumn, sortDirection, nums]);
  const total = Math.ceil(sorted.length / pageSize);
  const handleSort = (key: string) => {
    if (sortColumn === key) { setSortDirection(d => d === 'asc' ? 'desc' : 'asc'); }
    else { setSortColumn(key); setSortDirection('asc'); }
  };
  const pd = sorted.slice((pg - 1) * pageSize, pg * pageSize);
  const inR = (r: number, c: number) => sel ? r >= Math.min(sel.r1, sel.r2) && r <= Math.max(sel.r1, sel.r2) && c >= Math.min(sel.c1, sel.c2) && c <= Math.max(sel.c1, sel.c2) : false;

  useEffect(() => {
    if (!collabEnabled || !activeCell) return;
    const rid = pd[activeCell.row]?.id || null; const c = (window as any).__collab; if (!c) return; const n = Date.now(); if (n - lc.current < 80) return; lc.current = n;
    c.send({ type: 'cursor', recordId: rid, col: activeCell.col, row: activeCell.row });
  }, [activeCell, collabEnabled, pd]);
  const collaborationState = useCollaborationStore();
  const { remoteCursors: cc, userId: mu } = collabEnabled
    ? collaborationState
    : { remoteCursors: new Map(), userId: null };
  const rcm = useMemo(() => { const m = new Map(); cc.forEach((cur: any) => { if (cur.userId !== mu && cur.recordId && cur.col >= 0) m.set(`${cur.recordId}:${vis[cur.col]?.key||''}`, { name: cur.displayName, color: cur.color }); }); return m; }, [cc, mu, vis, collabEnabled]);

  const stopEditingPresence = useCallback(() => {
    if (!collabEnabled || !editingPresenceRef.current) return;
    broadcastEditingStop(editingPresenceRef.current);
    editingPresenceRef.current = null;
  }, [collabEnabled]);

  const startEditingPresence = useCallback((item: T, field: string, colIndex: number) => {
    if (!collabEnabled) return;
    stopEditingPresence();
    const recordLabel =
      String((item as any).productName || (item as any).name || (item as any).title || item.id || '');
    const payload = {
      recordType: collabRecordType,
      recordId: item.id,
      recordLabel,
      field,
      fieldLabel: vis[colIndex]?.title || field,
      location: collabLocation,
      startedAt: Date.now(),
    };
    editingPresenceRef.current = payload;
    broadcastEditingStart(payload);
  }, [collabEnabled, collabRecordType, collabLocation, stopEditingPresence, vis]);

  useEffect(() => {
    if (!collabEnabled || !editingCell) return;
    const timer = window.setInterval(() => {
      if (editingPresenceRef.current) {
        broadcastEditingStart(editingPresenceRef.current);
      }
    }, 15000);
    return () => window.clearInterval(timer);
  }, [collabEnabled, editingCell]);

  useEffect(() => () => {
    stopEditingPresence();
  }, [stopEditingPresence]);

  const autoSum = () => {
    if (!activeCell) return; const col = vis[activeCell.col]; if (!col || !numericFields.includes(col.key)) return;
    let sum = 0; for (let r = 0; r <= activeCell.row; r++) { const v = Number((pd[r] as any)[col.key]); if (!isNaN(v)) sum += v; }
    const item = pd[activeCell.row]; if (item) { pu(item, col.key); onCellEdit(item.id, col.key, Math.round(sum * 100) / 100); }
  };
  const asel = pd.length > 0 && pd.every(p => selectedIds.includes(p.id));
  const se = (item: T, f: string, ri: number, ci: number, ic?: string) => { const v = (item as any)[f]; startEditingPresence(item, f, ci); setEditingCell({ id: item.id, field: f, value: ic !== undefined ? ic : (v ?? '') }); setActiveCell({ row: ri, col: ci }); setTimeout(() => { if (ir.current) { ir.current.focus(); if (ir.current instanceof HTMLInputElement) ir.current.select(); } }, 50); };
  const pu = useCallback((item: T, f: string) => { setUndo(p => [...p.slice(-(UNDO_MAX-1)), { id: item.id, field: f, prevValue: (item as any)[f] }]); setRedo([]); }, []);

  // 自动添加选项：值重复出现 ≥2 次时自动加入选项列表
  const autoAddOption = useCallback((field: string, value: any) => {
    if (!onAddFieldOption || !value || typeof value !== 'string' || !value.trim()) return;
    const v = value.trim();
    const existing = getFieldOptions?.(field) || [];
    if (existing.includes(v)) return;
    // 统计所有数据中该字段的值出现次数
    let count = 0;
    for (const row of data) {
      const rv = (row as any)[field];
      if (rv === v || String(rv ?? '') === v) count++;
      if (count >= 2) break;
    }
    if (count >= 2) {
      onAddFieldOption(field, v);
    }
  }, [data, onAddFieldOption, getFieldOptions]);

  const save = (fv?: any) => {
    if (!editingCell) return;
    try {
      let v = fv !== undefined ? fv : editingCell.value;
      const c = vis.find(x => x.key === editingCell.field); if (c?.type === 'number' && typeof v === 'string') { const n = parseFloat(v); v = isNaN(n) ? 0 : n; }
      const item = data.find(p => p.id === editingCell.id); if (item) pu(item, editingCell.field);
      onCellEdit(editingCell.id, editingCell.field, v);
      autoAddOption(editingCell.field, v);
      // 检查重复（用新值 v 做比较，因为父级 data 可能还未更新）
      if (duplicateKeyFields && duplicateKeyFields.length > 0) {
        const currentRow = data.find(r => r.id === editingCell.id);
        if (currentRow) {
          const currentVals: Record<string, string> = {};
          for (const f of duplicateKeyFields) {
            currentVals[f] = String(f === editingCell.field ? v : (currentRow as any)[f] ?? '');
          }
          const ids = data.filter(r => {
            if (r.id === editingCell.id) return false;
            return duplicateKeyFields.every(f => String((r as any)[f] ?? '') === currentVals[f]);
          }).map(r => r.id);
          if (ids.length > 0) setDupAlert({ ids, currentId: editingCell.id });
        }
      }
    } catch (err) {
      console.error('[save] error:', err);
    } finally {
      stopEditingPresence();
      setEditingCell(null);
      setTimeout(() => { if (activeCell) cr.current[`${activeCell.row}-${activeCell.col}`]?.focus(); }, 0);
    }
  };
  const can = () => { stopEditingPresence(); setEditingCell(null); setTimeout(() => { if (activeCell) cr.current[`${activeCell.row}-${activeCell.col}`]?.focus(); }, 0); };
  const nav = (d: 'up'|'down'|'left'|'right') => {
    if (!activeCell || !pd.length) return; let r = activeCell.row, c = activeCell.col;
    if (d === 'up') r = Math.max(0, r - 1); else if (d === 'down') r = Math.min(pd.length - 1, r + 1); else if (d === 'left') c = Math.max(0, c - 1); else c = Math.min(vis.length - 1, c + 1);
    stopEditingPresence(); setEditingCell(null); setActiveCell({ row: r, col: c }); setTimeout(() => cr.current[`${r}-${c}`]?.focus(), 0);
  };

  const autoFitWidth = (ci: number) => {
    const colKey = vis[ci]?.key; if (!colKey) return;
    let maxW = colKey.length * 8;
    for (const row of pd) { const v = String((row as any)[colKey] ?? ''); maxW = Math.max(maxW, v.length * 7 + 10); }
    setColWidths(p => ({ ...p, [colKey]: Math.min(Math.max(maxW, 60), 300) }));
  };
  const hcr = (e: React.MouseEvent, ci: number) => {
    e.preventDefault(); const h = tr.current?.querySelectorAll('th'); let sw = 100; if (h && h[ci + 1]) sw = h[ci + 1].getBoundingClientRect().width; dr.current = { ci, sx: e.clientX, sw };
    const mm = (ev: MouseEvent) => { if (!dr.current) return; const dc = dr.current; setColWidths(p => ({ ...p, [vis[dc.ci].key]: Math.min(Math.max(60, dc.sw + ev.clientX - dc.sx), 500) })); };
    const mu = () => { dr.current = null; document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); document.body.style.cursor = ''; document.body.style.userSelect = ''; };
    document.addEventListener('mousemove', mm); document.addEventListener('mouseup', mu); document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
  };

  const hmd = (ri: number, ci: number, e: React.MouseEvent) => {
    if (editingCell) {
      // 点击正在编辑的控件本身（如下拉框箭头/自定义下拉）时不退出编辑
      const target = e.target as Node;
      if (ir.current && (ir.current === target || ir.current.contains(target))) return;
      // 也检查是否有 data-editing 属性的元素（自定义下拉组件）
      let el = target as HTMLElement | null;
      while (el) {
        if (el.getAttribute?.('data-editing') === 'true') return;
        el = el.parentElement;
      }
      // 如果点击的是同一个正在编辑的单元格，不退出编辑（防止双击编辑时闪烁消失）
      const clickedItem = pd[ri];
      if (clickedItem && clickedItem.id === editingCell.id && vis[ci]?.key === editingCell.field) return;
      save();
    }
    const key = `${ri}-${ci}`;
    if (e.ctrlKey || e.metaKey) { setNcs(p => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n; }); setActiveCell({ row: ri, col: ci }); return; }
    setNcs(new Set()); setActiveCell({ row: ri, col: ci }); drag.current = true; dStart.current = { row: ri, col: ci }; setSel({ r1: ri, c1: ci, r2: ri, c2: ci });
  };
  useEffect(() => {
    const mm = (e: MouseEvent) => { if (!drag.current || !dStart.current) return; const td = (document.elementFromPoint(e.clientX, e.clientY))?.closest('td'); if (!td) return; const key = Object.entries(cr.current).find(([, v]) => v === td)?.[0]; if (!key) return; const [r, c] = key.split('-').map(Number); if (isNaN(r) || isNaN(c)) return; setSel({ r1: dStart.current.row, c1: dStart.current.col, r2: r, c2: c }); };
    const mu = () => { drag.current = false; dStart.current = null; };
    document.addEventListener('mousemove', mm); document.addEventListener('mouseup', mu); return () => { document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); };
  }, []);

  const hk = (e: React.KeyboardEvent, item: T, f: string, ri: number, ci: number) => {
    if (editingCell) { switch (e.key) { case 'Enter': e.preventDefault(); save(); setTimeout(() => nav('down'), 0); break; case 'Escape': can(); break; case 'Tab': e.preventDefault(); save(); setTimeout(() => nav(e.shiftKey ? 'left' : 'right'), 0); break; } return; }
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key === 'a') { e.preventDefault(); onToggleSelectAll(); return; }
    if (ctrl && e.key === 'z') { e.preventDefault(); if (undo.length) { const en = undo[undo.length - 1]; setUndo(p => p.slice(0, -1)); setRedo(p => [...p, en]); onCellEdit(en.id, en.field, en.prevValue); const ri2 = pd.findIndex(p => p.id === en.id); if (ri2 >= 0) { const ci2 = vis.findIndex(c => c.key === en.field); if (ci2 >= 0) setActiveCell({ row: ri2, col: ci2 }); } } return; }
    if (ctrl && e.key === 'y') { e.preventDefault(); if (redo.length) { const en = redo[redo.length - 1]; setRedo(p => p.slice(0, -1)); setUndo(p => [...p, en]); const item2 = data.find(p => p.id === en.id); onCellEdit(en.id, en.field, item2 ? (item2 as any)[en.field] : en.prevValue); const ri2 = pd.findIndex(p => p.id === en.id); if (ri2 >= 0) { const ci2 = vis.findIndex(c => c.key === en.field); if (ci2 >= 0) setActiveCell({ row: ri2, col: ci2 }); } } return; }
    if (ctrl && e.key === 'x') { e.preventDefault(); const val = (item as any)[f]; navigator.clipboard.writeText(val != null ? String(val) : '').catch(() => {}); setCutBuf({ id: item.id, field: f, value: val }); setSel(null); return; }
    if (ctrl && e.key === 'c') { e.preventDefault(); if (sel) { const r1 = Math.min(sel.r1, sel.r2), r2 = Math.max(sel.r1, sel.r2), c1 = Math.min(sel.c1, sel.c2), c2 = Math.max(sel.c1, sel.c2); const lines: string[] = []; for (let r = r1; r <= r2; r++) { const row = pd[r]; if (!row) continue; const vals: string[] = []; for (let c = c1; c <= c2; c++) { const v = (row as any)[vis[c]?.key]; vals.push(v != null ? String(v) : ''); } lines.push(vals.join('\t')); } navigator.clipboard.writeText(lines.join('\n')).catch(() => {}); } else { navigator.clipboard.writeText(String((item as any)[f] ?? '')).catch(() => {}); } setCutBuf(null); return; }
    if (ctrl && e.key === 'v') { e.preventDefault(); const col = vis[ci]; if (!col?.editable) return; navigator.clipboard.readText().then(t => { onCellEdit(item.id, f, t); autoAddOption(f, t); if (cutBuf && cutBuf.id !== item.id) onCellEdit(cutBuf.id, cutBuf.field, ''); setCutBuf(null); }).catch(() => {}); return; }
    if (ctrl && e.key === 'd') { e.preventDefault(); if (ri > 0) { const above = pd[ri - 1]; const av = (above as any)[f]; if (above) onCellEdit(item.id, f, av); autoAddOption(f, av); } return; }
    if (ctrl && e.key === 'r') { e.preventDefault(); if (ci > 0) { const rv = (item as any)[vis[ci - 1]?.key]; onCellEdit(item.id, f, rv); autoAddOption(f, rv); } return; }
    if (ctrl && e.shiftKey && e.key === '=') { e.preventDefault(); const b = onAddBlank?.(); if (b) { const ai = data.findIndex(p => p.id === item.id); onInsertAt?.(ai >= 0 ? ai + 1 : data.length, b); } return; }
    if (ctrl && !e.shiftKey && e.key === '=') { e.preventDefault(); autoSum(); return; }
    switch (e.key) {
      case 'Enter': e.preventDefault(); setSel(null); nav('down'); break;
      case 'F2': e.preventDefault(); { const col = vis[ci]; if (col?.editable) se(item, f, ri, ci); } break;
      case 'ArrowUp': e.preventDefault(); setSel(null); ctrl ? (setActiveCell({ row: 0, col: activeCell?.col??0 }), setTimeout(() => cr.current[`0-${activeCell?.col??0}`]?.focus(), 0)) : nav('up'); break;
      case 'ArrowDown': e.preventDefault(); setSel(null); ctrl ? (setActiveCell({ row: pd.length-1, col: activeCell?.col??0 }), setTimeout(() => cr.current[`${pd.length-1}-${activeCell?.col??0}`]?.focus(), 0)) : nav('down'); break;
      case 'ArrowLeft': e.preventDefault(); setSel(null); ctrl ? (setActiveCell({ row: activeCell?.row??0, col: 0 }), setTimeout(() => cr.current[`${activeCell?.row??0}-0`]?.focus(), 0)) : nav('left'); break;
      case 'ArrowRight': e.preventDefault(); setSel(null); ctrl ? (setActiveCell({ row: activeCell?.row??0, col: vis.length-1 }), setTimeout(() => cr.current[`${activeCell?.row??0}-${vis.length-1}`]?.focus(), 0)) : nav('right'); break;
      case 'Home': e.preventDefault(); if (activeCell) { setActiveCell({ row: activeCell.row, col: 0 }); setTimeout(() => cr.current[`${activeCell.row}-0`]?.focus(), 0); } break;
      case 'End': e.preventDefault(); if (activeCell) { setActiveCell({ row: activeCell.row, col: vis.length-1 }); setTimeout(() => cr.current[`${activeCell.row}-${vis.length-1}`]?.focus(), 0); } break;
      case 'PageUp': e.preventDefault(); if (activeCell) { const r = Math.max(0, activeCell.row - 10); setActiveCell({ row: r, col: activeCell.col }); setTimeout(() => cr.current[`${r}-${activeCell.col}`]?.focus(), 0); } break;
      case 'PageDown': e.preventDefault(); if (activeCell) { const r = Math.min(pd.length-1, activeCell.row + 10); setActiveCell({ row: r, col: activeCell.col }); setTimeout(() => cr.current[`${r}-${activeCell.col}`]?.focus(), 0); } break;
      default: if (e.key.length === 1 && !ctrl && !e.altKey) { const col = vis[ci]; if (col?.editable) { e.preventDefault(); se(item, f, ri, ci, e.key); } }
    }
  };

  const hr = (id: string, idx: number, e: React.MouseEvent) => {
    if (e.shiftKey && lastIdx !== null && lastIdx !== idx) { const s = Math.min(lastIdx, idx), en = Math.max(lastIdx, idx); const cur = new Set(selectedIds); for (let i = s; i <= en; i++) { const pid = pd[i].id; if (!cur.has(pid)) onToggleSelect(pid); } }
    else { setLastIdx(idx); onToggleSelect(id); }
  };
  const hc = (e: React.MouseEvent, id: string, ri: number, f?: string) => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, itemId: id, rowIndex: ri, field: f }); };
  const hhc = (e: React.MouseEvent, ci: number) => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, rowIndex: -1, colIndex: ci, isHeader: true }); };
  const cf = { item: () => data.find(p => p.id === ctx?.itemId), idx: () => { if (!ctx) return -1; return data.findIndex(p => p.id === ctx.itemId); } };
  const rIn = (col: DataTableColumn, ri: number, ci: number, item: T) =>
    col.type === 'select'
      ? <AppSelect
          value={editingCell?.value||''}
          options={getFieldOptions?.(col.key)||[]}
          onChange={v => { setEditingCell(p => p ? {...p, value: v} : null); save(v); }}
          actions={[
            ...(onAddFieldOption ? [{
              label: '新增选项',
              icon: <Plus size={14} />,
              tone: 'primary' as const,
              onSelect: () => setAddingOption({ field: col.key, input: '' }),
            }] : []),
            ...((onDeleteFieldOption || onRenameFieldOption) ? [{
              label: '编辑选项',
              icon: <Pencil size={14} />,
              onSelect: () => setEditingOption({ field: col.key, renameTarget: '', renameInput: '' }),
            }] : []),
          ]}
          onKeyDown={e => hk(e, item, col.key, ri, ci)}
          size="sm"
          dataEditing
          placeholder="请选择"
        />
      : col.type === 'date'
        ? <input type="date" ref={ir as any} value={editingCell?.value||''} onChange={e => setEditingCell(p => p ? {...p, value: e.target.value} : null)} onBlur={() => save()} onKeyDown={e => hk(e, item, col.key, ri, ci)} className="w-full px-2 py-1 border border-brand-500 rounded focus:ring-2 focus:ring-brand-500/30 outline-none text-sm" />
        : col.type === 'autocomplete'
          ? <AutocompleteDropdown
              value={editingCell?.value==null?'':String(editingCell.value)}
              options={getFieldSuggestions?.(col.key)||[]}
              onChange={v => setEditingCell(p => p ? {...p, value: v} : null)}
              onCommit={save}
              onKeyDown={e => hk(e, item, col.key, ri, ci)}
              placeholder=""
            />
          : <textarea ref={ir as any} value={editingCell?.value==null?'':String(editingCell.value)} onChange={e => setEditingCell(p => p ? {...p, value: e.target.value} : null)} onBlur={() => save()} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.stopPropagation(); } else if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); e.stopPropagation(); save(); setTimeout(() => nav('down'), 0); } else if (e.key === 'Escape') { e.stopPropagation(); can(); } else if (e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); save(); setTimeout(() => nav(e.shiftKey ? 'left' : 'right'), 0); } else { hk(e, item, col.key, ri, ci); } }} className="w-full min-h-[56px] px-2 py-1 border border-brand-500 rounded focus:ring-2 focus:ring-brand-500/30 outline-none text-sm resize-none" rows={2} />;
  const dc = (item: T, col: DataTableColumn) => {
    if (col.key === 'actions') return <div className="flex items-center justify-center gap-0.5">{!readOnly && onShowVersionHistory && <button onClick={e => { e.stopPropagation(); onShowVersionHistory(item.id); }} className="p-1 hover:bg-brand-50 rounded text-slate-400 hover:text-brand-600" title="历史"><FileText size={14} /></button>}{!readOnly && <button onClick={async event => { event.stopPropagation(); if (await ask({ title: '删除记录', message: '确定要删除这条记录吗？删除后无法恢复。', confirmText: '删除', tone: 'danger' })) onDelete(item.id); }} className="p-1 hover:bg-red-50 rounded text-slate-500 hover:text-red-600" title="删除"><Trash2 size={16} /></button>}</div>;
    const v = (item as any)[col.key]; const sv = v != null && v !== '' && typeof v !== 'object' ? String(v) : '-'; return <span className="block truncate" title={sv !== '-' ? sv : undefined}>{sv}</span>;
  };

  return (<>
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden h-full flex flex-col">
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto" ref={tr}>
        <table className="table-fixed" style={{ width: Object.values(colWidths).reduce((a,b)=>a+b,0)+(readOnly?0:40) }}>
          <colgroup>{!readOnly && <col style={{ width: 40 }} />}{vis.map(c => <col key={c.key} style={{ width: colWidths[c.key]||80, minWidth: colWidths[c.key]||80 }} />)}</colgroup>
          <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10"><tr>
            {!readOnly && <th className="w-10 px-2 py-2 sticky left-0 bg-slate-50 z-10 border-r border-slate-200 text-center align-middle"><input type="checkbox" checked={asel} onChange={onToggleSelectAll} className="w-3.5 h-3.5 rounded border-slate-300 text-brand-600 focus:ring-brand-500/30" /></th>}
            {vis.map((col, ci) => <th key={col.key} className={`px-2 py-2 text-xs font-semibold text-slate-600 uppercase tracking-wider ${col.sortable ? 'cursor-pointer hover:bg-slate-100 select-none' : ''} sticky top-0 bg-slate-50 ${ci === 0 ? 'border-r border-slate-200' : ''} relative text-center border-r border-slate-100`} style={{ minWidth: colWidths[col.key]||80, width: colWidths[col.key]||80 }} onContextMenu={e => hhc(e, ci)} onClick={() => col.sortable && handleSort(col.key)}>
              <div className="flex items-center justify-center gap-0.5"><span>{col.title}</span>{col.sortable && sortColumn === col.key && <ArrowUpDown size={11} className="text-brand-500 flex-shrink-0" />}</div>
              <div className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-brand-400 active:bg-brand-600 z-10" onMouseDown={e => { e.stopPropagation(); hcr(e, ci); }} onDoubleClick={() => autoFitWidth(ci)} />
            </th>)}
          </tr></thead>
          <tbody>{pd.flatMap((item, ri) => {
            const isDup = dupSet.has(item.id);
            const isDupStart = dupStartSet.has(item.id);
            const dupGroup = isDupStart && duplicateGroupIds?.find(g => g[0] === item.id);
            const rows: React.ReactNode[] = [];

            // 组标头行
            if (dupGroup && dupGroup.length > 1) {
              rows.push(
                <tr key={`dh-${item.id}`} className="bg-red-50">
                  <td colSpan={vis.length + 1} className="px-3 py-1 text-[11px] text-red-600 font-medium border-t-2 border-red-400 select-none">
                    <span className="inline-flex items-center gap-1.5">
                      <AlertCircle size={10} />
                      重复组 · {dupGroup.length} 条完全相同
                    </span>
                  </td>
                </tr>
              );
            }

            // 数据行
            rows.push(
            <tr key={item.id} className={`transition-colors ${selectedIds.includes(item.id) ? 'bg-brand-50' : ''} ${isDup ? 'bg-red-50/70' : (ri % 2 === 0 ? 'bg-white' : 'bg-slate-50/50')} ${isDup ? '' : 'hover:bg-slate-50'} ${isDup ? 'divide-x-0' : 'divide-y divide-slate-200'}`}>
              {!readOnly && <td className={`px-1.5 sticky left-0 z-10 border-r border-slate-200 text-center align-middle ${selectedIds.includes(item.id) ? 'bg-brand-50' : (isDup ? 'bg-red-50/70' : (ri % 2 === 0 ? 'bg-white' : 'bg-slate-50'))} ${isDup ? 'py-0.5' : 'py-1'}`}><input type="checkbox" checked={selectedIds.includes(item.id)} readOnly onClick={e => { e.stopPropagation(); hr(item.id, ri, e); }} className="w-3.5 h-3.5 rounded border-slate-300 text-brand-600 focus:ring-brand-500/30" /></td>}
              {vis.map((col, ci) => { const ia = activeCell?.row === ri && activeCell?.col === ci; const ie = editingCell?.id === item.id && editingCell?.field === col.key; const cu = rcm.get(`${item.id}:${col.key}`); const hasCur = !!cu; const ir2 = inR(ri, ci);
                return <td key={col.key} ref={el => { cr.current[`${ri}-${ci}`] = el; }} tabIndex={0}
                  className={`relative text-sm outline-none text-center border-r border-slate-100 overflow-hidden ${col.editable && !readOnly ? 'cursor-cell' : ''} ${ia ? 'bg-brand-100' : ''} ${(ir2||ncs.has(`${ri}-${ci}`))&&!ia?'bg-brand-50':''} ${ci === 0 ? 'border-r border-slate-200' : ''} ${ci === 0&&!ia?(selectedIds.includes(item.id)?'bg-brand-50':(isDup?'bg-red-50/70':(ri%2===0?'bg-white':'bg-slate-50'))):''} ${isDup ? 'text-red-700 py-0.5' : 'text-slate-700 py-1'} select-none`}
                  style={{ minWidth: colWidths[col.key]||80, width: colWidths[col.key]||80, ...(ia ? { boxShadow: 'inset 0 0 0 2px #6366f1' } : {}), ...(hasCur ? { borderLeft: `3px solid ${cu.color}` } : {}), ...((ir2||ncs.has(`${ri}-${ci}`))&&!ia ? { boxShadow: 'inset 0 0 0 1px rgba(99, 102, 241, 0.35)' } : {}), ...(isDup && !ia && !hasCur && !ir2 && !ncs.has(`${ri}-${ci}`) ? {} : {}) }}
                  title={hasCur ? `${cu.name} 在此编辑` : undefined} onMouseDown={e => hmd(ri, ci, e)} onContextMenu={e => hc(e, item.id, ri, col.key)}
                  onDoubleClick={e => { if (!readOnly && col.editable) { e.preventDefault(); se(item, col.key, ri, ci); } }} onKeyDown={e => { if (!readOnly) hk(e, item, col.key, ri, ci); }}>
                  {ie ? rIn(col, ri, ci, item) : (renderCell ? renderCell(item, col, ri) : dc(item, col))}
                  {hasCur && <div className="absolute top-0 right-0 z-10" title={`${cu.name} 在此编辑`}><UsersIcon size={10} style={{ color: cu.color }} /></div>}
                </td>;
              })}
            </tr>);

            return rows;
          })}</tbody>
        </table>
      </div>
      {pd.length === 0 && !isLoading && (
        <div className="flex min-h-[360px] items-center justify-center text-center text-sm text-slate-500">
          {emptyMessage}
        </div>
      )}

      {ctx && <div ref={crm} className="fixed z-[9999] bg-white rounded-lg shadow-xl border border-slate-200 py-1 min-w-[180px]" style={{ left: ctx.x, top: ctx.y }}>
        {ctx.isHeader ? (<>
          <button onClick={() => { setHidden(p => new Set([...p, columns[ctx.colIndex!].key])); setCtx(null); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"><EyeOff size={14} /><span>隐藏列</span></button>
          {hidden.size > 0 && <button onClick={() => { setHidden(new Set()); setCtx(null); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"><Eye size={14} /><span>显示所有隐藏列</span></button>}
          <button onClick={() => { setColWidths({ ...defaultColumnWidths }); localStorage.setItem(columnWidthsKey, ''); setCtx(null); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"><RotateCcw size={14} /><span>重置列宽</span></button>
        </>) : (<>
          <button onClick={() => { const v = cf.item(); if (v && ctx.field) { navigator.clipboard.writeText(String((v as any)[ctx.field] ?? '')).catch(() => {}); setCutBuf(null); } setCtx(null); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"><Copy size={14} /><span>复制</span></button>
          {!readOnly && (<>
          <button onClick={() => { const v = cf.item(); if (v && ctx.field) { navigator.clipboard.writeText(String((v as any)[ctx.field] ?? '')).catch(() => {}); setCutBuf({ id: ctx.itemId!, field: ctx.field, value: (v as any)[ctx.field] }); } setCtx(null); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"><Copy size={14} /><span>剪切</span></button>
          <button onClick={async () => { if (ctx?.field && await ask('确定要清空该单元格吗？')) onCellEdit(ctx.itemId!, ctx.field, ''); setCtx(null); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"><Trash size={14} /><span>清空</span></button>
          <div className="border-t border-slate-100 my-1" />
          <button onClick={() => { const s = cf.item(); if (s) { const n = { ...s, id: generateId(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), productName: '' } as T; const ai = cf.idx(); if (ai >= 0) onInsertAt?.(ai + 1, n); } setCtx(null); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"><Copy size={14} /><span>复制到下一行</span></button>
          <button onClick={() => { const b = onAddBlank?.(); if (b) { const ai = cf.idx(); onInsertAt?.(ai >= 0 ? ai + 1 : data.length, b); } setCtx(null); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"><FilePlus size={14} /><span>在下方插入行</span></button>
          <button onClick={() => { const b = onAddBlank?.(); if (b) { const ai = cf.idx(); onInsertAt?.(ai >= 0 ? ai : data.length, b); } setCtx(null); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"><FilePlus size={14} /><span>在上方插入行</span></button>
          <div className="border-t border-slate-100 my-1" />
          <button onClick={() => { const idx = cf.idx(); if (idx > 0) onMoveItem?.(ctx!.itemId!, 0); setCtx(null); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"><ArrowUpToLine size={14} /><span>移到顶部</span></button>
          <button onClick={() => { const idx = cf.idx(); if (idx >= 0 && idx < data.length - 1) onMoveItem?.(ctx!.itemId!, data.length - 1); setCtx(null); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"><ArrowDownToLine size={14} /><span>移到底部</span></button>
          <div className="border-t border-slate-100 my-1" />
          <button onClick={async () => { if (await ask('确定删除这条记录吗？')) onDelete(ctx!.itemId!); setCtx(null); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50"><Trash size={14} /><span>删除行</span></button>
          </>)}
        </>)}
      </div>}

      {/* 新增选项弹窗 */}
      {addingOption && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/30"
          onClick={() => setAddingOption(null)}>
          <div className="bg-white rounded-2xl shadow-xl border border-slate-100 p-5 w-80"
            onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-slate-800 mb-3">新增选项</h3>
            <input
              value={addingOption.input}
              onChange={e => setAddingOption(p => p ? {...p, input: e.target.value} : null)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  const val = addingOption.input.trim();
                  if (val) {
                    onAddFieldOption?.(addingOption.field, val);
                    setAddingOption(null);
                  }
                }
                if (e.key === 'Escape') setAddingOption(null);
              }}
              placeholder="输入选项名称..."
              className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-400/40 focus:border-slate-400 outline-none text-sm placeholder:text-slate-400"
              autoFocus
            />
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setAddingOption(null)}
                className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg transition-colors">取消</button>
              <button onClick={() => {
                const val = addingOption.input.trim();
                if (val) {
                  onAddFieldOption?.(addingOption.field, val);
                  setAddingOption(null);
                }
              }} className="px-4 py-2 text-sm font-medium text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors">确认添加</button>
            </div>
          </div>
        </div>
      )}

      {/* 编辑选项弹窗 */}
      {editingOption && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/30"
          onClick={() => setEditingOption(null)}>
          <div className="bg-white rounded-2xl shadow-xl border border-slate-100 p-5 w-96"
            onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-slate-800 mb-4">编辑选项</h3>
            <div className="max-h-64 overflow-y-auto space-y-1.5">
              {(getFieldOptions?.(editingOption.field) || []).map(opt => (
                <div key={opt} className="flex items-center gap-2 p-2.5 rounded-xl hover:bg-slate-50 group border border-slate-100 transition-colors">
                  {editingOption.renameTarget === opt ? (
                    <>
                      <input
                        value={editingOption.renameInput}
                        onChange={e => setEditingOption(p => p ? {...p, renameInput: e.target.value} : null)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && editingOption.renameInput.trim()) {
                            onRenameFieldOption?.(editingOption.field, opt, editingOption.renameInput.trim());
                            setEditingOption(p => p ? {...p, renameTarget: '', renameInput: ''} : null);
                          }
                          if (e.key === 'Escape') setEditingOption(p => p ? {...p, renameTarget: '', renameInput: ''} : null);
                        }}
                        className="flex-1 px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-400/40 focus:border-slate-400 outline-none"
                        autoFocus
                      />
                      <button onClick={() => setEditingOption(p => p ? {...p, renameTarget: '', renameInput: ''} : null)}
                        className="px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100 rounded-lg transition-colors">取消</button>
                      <button onClick={() => {
                        if (editingOption.renameInput.trim()) {
                          onRenameFieldOption?.(editingOption.field, opt, editingOption.renameInput.trim());
                          setEditingOption(p => p ? {...p, renameTarget: '', renameInput: ''} : null);
                        }
                      }} className="px-3 py-1.5 text-xs font-medium text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors">保存</button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 text-sm text-slate-700">{opt}</span>
                      <button onClick={() => setEditingOption(p => p ? {...p, renameTarget: opt, renameInput: opt} : null)}
                        className="opacity-0 group-hover:opacity-100 px-2 py-1 text-xs text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-all">重命名</button>
                      <button onClick={async () => {
                        if (await ask(`确定删除 "${opt}" 吗？`)) {
                          onDeleteFieldOption?.(editingOption!.field, opt);
                        }
                      }} className="opacity-0 group-hover:opacity-100 px-2 py-1 text-xs text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all">删除</button>
                    </>
                  )}
                </div>
              ))}
              {(getFieldOptions?.(editingOption.field) || []).length === 0 && (
                <p className="text-sm text-slate-400 text-center py-6">暂无选项</p>
              )}
            </div>
            <div className="flex justify-end mt-4 pt-3 border-t border-slate-100">
              <button onClick={() => setEditingOption(null)}
                className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg transition-colors">关闭</button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row items-center justify-between gap-2 px-3 py-1.5 border-t border-slate-200 text-xs">
        <div className="text-sm text-slate-500">显示 {(pg-1)*pageSize+1}-{Math.min(pg*pageSize, sorted.length)}，共 {sorted.length} 条{hidden.size > 0 && <span className="ml-2 text-amber-500">（{hidden.size} 列已隐藏）</span>}</div>
        <div className="flex items-center gap-2">
          <AppSelect
            value={pageSize}
            onChange={value => { setPageSize(Number(value)); setPg(1); }}
            options={[
              { value: '1000', label: '全部' },
              { value: '5', label: '5条/页' },
              { value: '10', label: '10条/页' },
              { value: '20', label: '20条/页' },
              { value: '50', label: '50条/页' },
            ]}
            size="sm"
            className="w-24"
          />
          <div className="flex items-center gap-0.5">
            <button onClick={() => setPg(p => Math.max(1, p-1))} disabled={pg===1} className="p-1 rounded hover:bg-slate-100 disabled:opacity-50"><ChevronLeft size={16} /></button>
            {Array.from({ length: Math.min(5, total) }, (_, i) => { let p = i+1; if (total > 5) { if (pg <= 3) p = i+1; else if (pg >= total-2) p = total-4+i; else p = pg-2+i; } return <button key={p} onClick={() => setPg(p)} className={`w-7 h-7 rounded text-xs font-medium transition-colors ${pg===p?'bg-brand-500 text-white':'hover:bg-slate-100 text-slate-700'}`}>{p}</button>; })}
            <button onClick={() => setPg(p => Math.min(total, p+1))} disabled={pg===total} className="p-1 rounded hover:bg-slate-100 disabled:opacity-50"><ChevronRight size={16} /></button>
          </div>
        </div>
      </div>

      {/* 重复条目提醒 */}
      {dupAlert && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/30"
          onClick={() => setDupAlert(null)}>
          <div className="bg-white rounded-2xl shadow-xl border border-slate-100 p-5 w-96"
            onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-slate-800 mb-2">⚠️ 检测到重复条目</h3>
            <p className="text-sm text-slate-600 mb-4">
              发现 <strong className="text-slate-800">{dupAlert.ids.length}</strong> 条内容完全相同的记录，是否删除重复项？
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDupAlert(null)}
                className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg transition-colors">保留</button>
              <button onClick={() => {
                dupAlert.ids.forEach(id => onDelete(id));
                setDupAlert(null);
              }} className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors">
                删除 {dupAlert.ids.length} 条重复
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 确认弹窗（替换浏览器原生 confirm） */}
      {ConfirmDialog}

      <div className="px-3 py-1 bg-slate-50 border-t border-slate-200 text-xs text-slate-500 flex items-center justify-between">
        <span>💡 单击 · F2编辑 · Enter/Tab · 方向键 · Ctrl+Z/Y撤销重做 · Ctrl+X/C/V剪切复制粘贴 · Ctrl+D/R填充 · 框选 · 右键 · 列头右键隐藏</span>
        {extraToolbarContent}
      </div>
    </div>
    <div ref={sr} className="overflow-x-auto overflow-y-hidden" style={{ height: '10px', cursor: 'pointer' }}><div style={{ minWidth: Object.values(colWidths).reduce((a,b)=>a+b,0)+40, height: '1px' }} /></div>
  </>);
}
