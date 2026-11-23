// Reconstructed from successful pre-encoding-change patches.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowRightToLine,
  ArrowUp,
  CalendarDays,
  Check,
  ChevronDown,
  ClipboardPaste,
  Copy,
  Eraser,
  Filter,
  GripVertical,
  Minus,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  Save,
  Scissors,
  Search,
  History,
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDownUp,
  Bold,
  SearchCheck,
  Underline,
  WrapText,
  Paintbrush,
  PaintBucket,
  Palette,
  RemoveFormatting,
  Redo2,
  Undo2,
  Trash2,
  X,
} from 'lucide-react';
import type { CustomColumn, InvestmentProduct } from '../types';
import AppSelect from './Form/AppSelect';
import AppModal from './Layout/AppModal';
import { useUiPreferenceStore } from '../store/uiPreferenceStore';
import { useCollaborationStore } from '../store/collaborationStore';
import { broadcastCursor, broadcastEditingStart, broadcastEditingStop, requestEditingLock } from '../hooks/useCollaboration';
import { useShallow } from 'zustand/react/shallow';
import { _toast } from '../store/toastRef';
import { api } from '../lib/api';

type CellValue = string | number;
type ColumnType = 'text' | 'number' | 'date' | 'select' | 'readonly' | 'actions';

const PROJECT_EXCEL_FONT_SCALE_STORAGE_KEY = 'project_excel_font_scale_v1';
const PROJECT_EXCEL_FONT_SCALE_EVENT = 'project-excel-font-scale-change';
const DEFAULT_PROJECT_EXCEL_FONT_SCALE = 100;
const MIN_PROJECT_EXCEL_FONT_SCALE = 50;
const MAX_PROJECT_EXCEL_FONT_SCALE = 150;
const PROJECT_EXCEL_FONT_SCALE_STEP = 10;

const readProjectExcelFontScale = () => {
  const stored = localStorage.getItem(PROJECT_EXCEL_FONT_SCALE_STORAGE_KEY);
  if (stored === null || stored.trim() === '') return DEFAULT_PROJECT_EXCEL_FONT_SCALE;
  const saved = Number(stored);
  if (!Number.isFinite(saved)) return DEFAULT_PROJECT_EXCEL_FONT_SCALE;
  return Math.min(MAX_PROJECT_EXCEL_FONT_SCALE, Math.max(MIN_PROJECT_EXCEL_FONT_SCALE, saved));
};

export interface ProjectExcelColumn {
  key: string;
  label: string;
  width: number;
  type: ColumnType;
  options?: string[];
  dynamic?: boolean;
}

type SheetColumn = ProjectExcelColumn;

interface CellPosition {
  row: number;
  col: number;
}

interface EditingCell extends CellPosition {
  value: string;
  selectOnFocus: boolean;
  editorHeight?: number;
}

interface ContextMenuState extends CellPosition {
  x: number;
  y: number;
}

interface FilterMenuState {
  key: string;
  x: number;
  y: number;
}

interface HeaderContextMenuState {
  key: string;
  x: number;
  y: number;
}

interface ValueColumnFilter {
  kind: 'values';
  query: string;
  values: string[] | null;
}

interface RangeColumnFilter {
  kind: 'range';
  min: string;
  max: string;
}

type ColumnFilter = ValueColumnFilter | RangeColumnFilter;

interface CellChange {
  id: string;
  field: string;
  apiField?: string;
  before: CellValue;
  after: CellValue;
}

interface CellFormat {
  numberFormat?: 'general' | 'number' | 'currency' | 'percent';
  decimals?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  horizontalAlign?: 'left' | 'center' | 'right';
  verticalAlign?: 'top' | 'middle' | 'bottom';
  wrap?: boolean;
  fontSize?: number;
  textColor?: string;
  fillColor?: string;
  fontFamily?: 'default' | 'microsoft-yahei' | 'simsun' | 'simhei' | 'arial' | 'times-new-roman';
  borderStyle?: 'none' | 'all' | 'outer' | 'bottom';
  borderColor?: string;
  borderLineStyle?: 'solid' | 'dashed' | 'dotted';
  borderWidth?: 1 | 2 | 3;
  borderTop?: boolean;
  borderRight?: boolean;
  borderBottom?: boolean;
  borderLeft?: boolean;
}

type BorderPreset = 'none' | 'all' | 'outer' | 'inner' | 'inner-horizontal' | 'inner-vertical' | 'top' | 'right' | 'bottom' | 'left';
type FormatToolbarMenu = 'number' | 'font' | 'colors' | 'borders' | 'alignment' | 'tools' | null;

const FONT_FAMILIES: Record<NonNullable<CellFormat['fontFamily']>, string | undefined> = {
  default: undefined,
  'microsoft-yahei': '"Microsoft YaHei", sans-serif',
  simsun: 'SimSun, serif',
  simhei: 'SimHei, sans-serif',
  arial: 'Arial, sans-serif',
  'times-new-roman': '"Times New Roman", serif',
};

function BorderPresetIcon({ preset }: { preset: BorderPreset }) {
  return <span aria-hidden="true" className={`project-sheet-border-icon is-${preset}`}><i /><i /><i /><i /></span>;
}

interface PersistedTransaction {
  id: string;
  label: string;
  changes: Array<{ id: string; field: string; before: CellValue; after: CellValue }>;
  changeCount: number;
  createdAt: string;
  updatedAt: string;
  status: 'applied' | 'undone' | 'superseded';
  createdByName: string;
}

interface SelectionRange {
  anchor: CellPosition;
  focus: CellPosition;
}

interface SortRule {
  key: string;
  direction: 'asc' | 'desc';
}

interface PasteValidationError {
  row: number;
  col: number;
  cell: string;
  field: string;
  value: CellValue;
  message: string;
}

interface PendingPaste {
  changes: CellChange[];
  errors: PasteValidationError[];
}

interface LocalTransaction {
  label: string;
  changes: CellChange[];
}

interface ProjectExcelViewProps {
  data: InvestmentProduct[];
  customColumns: CustomColumn[];
  statusOptions: string[];
  managerOptions: string[];
  bankOptions: string[];
  fieldOptions?: Record<string, string[]>;
  columnOrder: string[];
  focusRowId?: string | null;
  focusField?: string | null;
  selectedIds: string[];
  onToggleSelect: (id: string) => void;
  onSetSelectedRows: (ids: string[]) => void;
  onFilteredRowIdsChange?: (ids: string[]) => void;
  onBatchCellEdit: (changes: Array<{id: string; field: string; lockField?: string; value: CellValue}>, label?: string) => Promise<boolean>;
  onRefresh: () => Promise<void>;
  onColumnOrderChange: (order: string[]) => void;
  onDelete: (id: string) => void;
  onDuplicateRow: (product: InvestmentProduct) => Promise<boolean>;
  onAdvance: (product: InvestmentProduct, nextStatus: string) => void;
  onRetreat: (product: InvestmentProduct, previousStatus: string) => void;
  toolbarHost?: HTMLElement | null;
  columnsOverride?: ProjectExcelColumn[];
  projectTransactionsEnabled?: boolean;
  projectRowActionsEnabled?: boolean;
  onShowHistory?: () => void;
}

function ProjectFormatToolbarPortal({ host, children }: { host?: HTMLElement | null; children: ReactNode }) {
  return host ? createPortal(children, host) : children;
}

const ROW_NUMBER_WIDTH = 52;

const BASE_COLUMNS: Array<Omit<SheetColumn, 'options'>> = [
  { key: 'productName', label: '项目名称', width: 220, type: 'text' },
  { key: 'status', label: '项目进度', width: 132, type: 'select' },
  { key: 'projectCategory', label: '项目分类', width: 190, type: 'select' },
  { key: 'activePassive', label: '主动 / 被动', width: 112, type: 'select' },
  { key: 'collectiveSingle', label: '集合 / 单一', width: 112, type: 'select' },
  { key: 'trustManager', label: 'A角', width: 120, type: 'select' },
  { key: 'trustManagerB', label: 'B角', width: 120, type: 'select' },
  { key: 'deadline', label: '到期日', width: 124, type: 'date' },
  { key: 'usd', label: '美元规模（万美元）', width: 154, type: 'number' },
  { key: 'rmb', label: '人民币规模（万元）', width: 154, type: 'number' },
  { key: 'feeRate', label: '费率', width: 96, type: 'number' },
  { key: 'annualIncome', label: '年化收入（万元）', width: 146, type: 'number' },
  { key: 'thisYearIncome', label: '今年收入（万元）', width: 146, type: 'number' },
  { key: 'performanceIncome', label: '绩效收入（万元）', width: 146, type: 'number' },
  { key: 'client', label: '委托人', width: 170, type: 'text' },
  { key: 'target', label: '标的', width: 170, type: 'text' },
  { key: 'brokerChannel', label: '券商渠道', width: 150, type: 'text' },
  { key: 'custodianBank', label: '托管行', width: 136, type: 'select' },
  { key: 'tradingBroker', label: '交易券商', width: 150, type: 'text' },
  { key: 'strategy', label: '投资策略', width: 180, type: 'text' },
  { key: 'remarks', label: '备注', width: 240, type: 'text' },
  { key: 'projectCreatedDate', label: '项目创建日', width: 124, type: 'date' },
  { key: 'establishDate', label: '成立/落地日', width: 124, type: 'date' },
  { key: 'projectStoppedDate', label: '项目中止日', width: 124, type: 'date' },
];

function columnLetter(index: number) {
  let value = index + 1;
  let result = '';
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function fieldValue(product: InvestmentProduct, column: SheetColumn): CellValue {
  if (column.dynamic) return String(product.dynamicFields?.[column.key] ?? '');
  if (column.key === 'projectCreatedDate') {
    return product.projectCreatedDate || product.progressStartDate || '';
  }
  const value = product[column.key as keyof InvestmentProduct];
  return typeof value === 'number' || typeof value === 'string' ? value : '';
}

function displayValue(value: CellValue, column: SheetColumn, format?: CellFormat) {
  if (value === '' || value == null) return '';
  const numeric = Number(value);
  if (format?.numberFormat === 'currency' && Number.isFinite(numeric)) {
    return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', minimumFractionDigits: format.decimals ?? 2, maximumFractionDigits: format.decimals ?? 2 }).format(numeric);
  }
  if (format?.numberFormat === 'percent' && Number.isFinite(numeric)) {
    return new Intl.NumberFormat('zh-CN', { style: 'percent', minimumFractionDigits: format.decimals ?? 2, maximumFractionDigits: format.decimals ?? 2 }).format(numeric);
  }
  if (column.type === 'number' || column.type === 'readonly') {
    if (Number.isFinite(numeric)) {
      const decimals = format?.decimals;
      return new Intl.NumberFormat('zh-CN', decimals == null ? { maximumFractionDigits: 4 } : { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(numeric);
    }
  }
  return String(value);
}

function rawFilterValue(product: InvestmentProduct, column: SheetColumn) {
  const value = fieldValue(product, column);
  return value == null ? '' : String(value).trim();
}

function isRangeColumn(column: SheetColumn) {
  return column.type === 'number' || column.type === 'date' || column.type === 'readonly';
}

function isValidIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function emptyFilterFor(column: SheetColumn): ColumnFilter {
  return isRangeColumn(column)
    ? { kind: 'range', min: '', max: '' }
    : { kind: 'values', query: '', values: null };
}

function filterIsActive(filter: ColumnFilter | undefined) {
  if (!filter) return false;
  if (filter.kind === 'range') return Boolean(filter.min || filter.max);
  return Boolean(filter.query.trim() || filter.values !== null);
}

function rowMatchesFilter(product: InvestmentProduct, column: SheetColumn, filter: ColumnFilter) {
  const rawValue = rawFilterValue(product, column);
  if (filter.kind === 'values') {
    if (filter.query.trim() && !rawValue.toLocaleLowerCase('zh-CN').includes(filter.query.trim().toLocaleLowerCase('zh-CN'))) {
      return false;
    }
    return filter.values === null || filter.values.includes(rawValue);
  }

  if (!filter.min && !filter.max) return true;
  if (!rawValue) return false;

  if (column.type === 'date') {
    const value = Date.parse(rawValue);
    const min = filter.min ? Date.parse(filter.min) : Number.NEGATIVE_INFINITY;
    const max = filter.max ? Date.parse(filter.max) : Number.POSITIVE_INFINITY;
    return Number.isFinite(value) && value >= min && value <= max;
  }

  const value = Number(rawValue);
  const min = filter.min === '' ? Number.NEGATIVE_INFINITY : Number(filter.min);
  const max = filter.max === '' ? Number.POSITIVE_INFINITY : Number(filter.max);
  return Number.isFinite(value) && value >= min && value <= max;
}

export type ProjectExcelToolPanel = 'shortcuts' | 'settings' | null;

export function ProjectExcelShortcutHelp({
  panel,
  onClose,
}: {
  panel: ProjectExcelToolPanel;
  onClose: () => void;
}) {
  const savedFontScale = useUiPreferenceStore(state => state.preferences.projectExcelFontScale);
  const updatePreferences = useUiPreferenceStore(state => state.updatePreferences);
  const [fontScale, setFontScale] = useState(savedFontScale || readProjectExcelFontScale());

  useEffect(() => setFontScale(savedFontScale), [savedFontScale]);

  const updateFontScale = (nextScale: number) => {
    const normalized = Math.min(
      MAX_PROJECT_EXCEL_FONT_SCALE,
      Math.max(MIN_PROJECT_EXCEL_FONT_SCALE, nextScale),
    );
    setFontScale(normalized);
    localStorage.setItem(PROJECT_EXCEL_FONT_SCALE_STORAGE_KEY, String(normalized));
    window.dispatchEvent(new CustomEvent(PROJECT_EXCEL_FONT_SCALE_EVENT, { detail: normalized }));
    void updatePreferences({ projectExcelFontScale: normalized }, '表格字体偏好保存失败');
  };

  return (
    <AppModal
      open={panel !== null}
      onClose={onClose}
      size="sm"
      title={panel === 'settings' ? '表格设置' : '表格快捷键'}
      subtitle={panel === 'settings' ? '调整项目进度表格的显示效果。' : '先选中单元格，再使用对应快捷键。'}
    >
      {panel === 'shortcuts' ? (
        <div>
          <div className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
            {[
              ['F2 / 双击', '编辑单元格'],
              ['Enter / Tab', '移动到下一单元格'],
              ['方向键 / Shift + 方向键', '移动 / 扩展矩形选择'],
              ['Ctrl + Z / Y', '撤销 / 重做'],
              ['Ctrl + C / X / V', '复制 / 剪切 / 粘贴选区'],
              ['Ctrl + D / R', '向下 / 向右批量填充'],
              ['Delete', '清空选区'],
              ['Shift + 点击列头', '追加多列排序'],
            ].map(([key, description]) => (
              <div key={key} className="flex items-center justify-between gap-3 border-b border-slate-100 py-1.5">
                <span className="font-medium text-slate-700">{key}</span>
                <span className="text-slate-400">{description}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-4 border-t border-slate-100 pt-3 text-xs text-slate-400">
            <span className="inline-flex items-center gap-1"><Copy size={12} />支持系统剪贴板</span>
            <span className="inline-flex items-center gap-1"><Scissors size={12} />修改后自动保存</span>
          </div>
        </div>
      ) : panel === 'settings' ? (
        <div className="py-1">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-slate-800">表格字体大小</div>
                <div className="mt-0.5 text-[10px] text-slate-400">仅调整表格标题和单元格文字</div>
              </div>
              <button
                type="button"
                onClick={() => updateFontScale(DEFAULT_PROJECT_EXCEL_FONT_SCALE)}
                disabled={fontScale === DEFAULT_PROJECT_EXCEL_FONT_SCALE}
                className="inline-flex h-7 items-center gap-1 px-2 text-[11px] text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:cursor-default disabled:opacity-40"
              >
                <RotateCcw size={12} />
                默认
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => updateFontScale(fontScale - PROJECT_EXCEL_FONT_SCALE_STEP)}
                disabled={fontScale <= MIN_PROJECT_EXCEL_FONT_SCALE}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center border border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35"
                aria-label="减小表格字体"
              >
                <Minus size={14} />
              </button>
              <input
                type="range"
                min={MIN_PROJECT_EXCEL_FONT_SCALE}
                max={MAX_PROJECT_EXCEL_FONT_SCALE}
                step={PROJECT_EXCEL_FONT_SCALE_STEP}
                value={fontScale}
                onChange={event => updateFontScale(Number(event.target.value))}
                className="project-font-scale-range min-w-0 flex-1 cursor-pointer"
                style={{
                  '--project-range-progress': `${((fontScale - MIN_PROJECT_EXCEL_FONT_SCALE) / (MAX_PROJECT_EXCEL_FONT_SCALE - MIN_PROJECT_EXCEL_FONT_SCALE)) * 100}%`,
                } as CSSProperties}
                aria-label="表格字体缩放比例"
              />
              <button
                type="button"
                onClick={() => updateFontScale(fontScale + PROJECT_EXCEL_FONT_SCALE_STEP)}
                disabled={fontScale >= MAX_PROJECT_EXCEL_FONT_SCALE}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center border border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35"
                aria-label="增大表格字体"
              >
                <Plus size={14} />
              </button>
              <span className="w-10 shrink-0 text-right text-xs font-semibold tabular-nums text-primary-700">
                {fontScale}%
              </span>
            </div>
        </div>
      ) : null}
    </AppModal>
  );
}

export default function ProjectExcelView({
  data,
  customColumns,
  statusOptions,
  managerOptions,
  bankOptions,
  fieldOptions = {},
  columnOrder,
  focusRowId,
  focusField,
  selectedIds,
  onToggleSelect,
  onSetSelectedRows,
  onFilteredRowIdsChange,
  onBatchCellEdit,
  onRefresh,
  onColumnOrderChange,
  onDelete,
  onDuplicateRow,
  onAdvance,
  onRetreat,
  toolbarHost,
  columnsOverride,
  projectTransactionsEnabled = true,
  projectRowActionsEnabled = true,
  onShowHistory,
}: ProjectExcelViewProps) {
  const savedColumnWidths = useUiPreferenceStore(state => state.preferences.projectExcelColumnWidths);
  const savedPersonalColumnOrder = useUiPreferenceStore(state => state.preferences.projectExcelColumnOrder);
  const savedPinnedColumns = useUiPreferenceStore(state => state.preferences.projectExcelPinnedColumns);
  const savedFontScale = useUiPreferenceStore(state => state.preferences.projectExcelFontScale);
  const showFormulaBar = useUiPreferenceStore(state => state.preferences.projectExcelShowFormulaBar);
  const showCoordinates = useUiPreferenceStore(state => state.preferences.projectExcelShowCoordinates);
  const showShortcutHints = useUiPreferenceStore(state => state.preferences.showShortcutHints);
  const uiPreferencesLoaded = useUiPreferenceStore(state => state.loaded);
  const updatePreferences = useUiPreferenceStore(state => state.updatePreferences);
  const preferenceSaveTimerRef = useRef<number | null>(null);
  const [active, setActive] = useState<CellPosition | null>(null);
  const [selection, setSelection] = useState<SelectionRange | null>(null);
  const [editing, setEditing] = useState<EditingCell | null>(null);
  const [transactionPanel, setTransactionPanel] = useState(false);
  const [transactions, setTransactions] = useState<PersistedTransaction[]>([]);
  const [localUndoStack, setLocalUndoStack] = useState<LocalTransaction[]>([]);
  const [localRedoStack, setLocalRedoStack] = useState<LocalTransaction[]>([]);
  const [transactionBusy, setTransactionBusy] = useState(false);
  const [cellFormats, setCellFormats] = useState<Record<string, CellFormat>>({});
  const [sheetTypography, setSheetTypography] = useState<{ fontFamily: NonNullable<CellFormat['fontFamily']>; fontSize: number }>({ fontFamily: 'default', fontSize: 13 });
  const [formulaValue, setFormulaValue] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchIndex, setSearchIndex] = useState(-1);
  const [formatClipboard, setFormatClipboard] = useState<CellFormat | null>(null);
  const [formatPainter, setFormatPainter] = useState<CellFormat | null>(null);
  const [formatToolbarMenu, setFormatToolbarMenu] = useState<FormatToolbarMenu>(null);
  const formatPainterArmedSelectionRef = useRef('');
  const [sortRules, setSortRules] = useState<SortRule[]>([]);
  const [pendingPaste, setPendingPaste] = useState<PendingPaste | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [headerContextMenu, setHeaderContextMenu] = useState<HeaderContextMenuState | null>(null);
  const [filterMenu, setFilterMenu] = useState<FilterMenuState | null>(null);
  const [columnFilters, setColumnFilters] = useState<Record<string, ColumnFilter>>({});
  const [filterDraft, setFilterDraft] = useState<ColumnFilter | null>(null);
  const [draggedColumnKey, setDraggedColumnKey] = useState<string | null>(null);
  const [personalColumnOrder, setPersonalColumnOrder] = useState<string[]>(savedPersonalColumnOrder);
  const [columnDropTarget, setColumnDropTarget] = useState<{ key: string; side: 'before' | 'after' } | null>(null);
  const [pinnedColumnKeys, setPinnedColumnKeys] = useState<string[]>(() => {
    if (savedPinnedColumns.length > 0) return savedPinnedColumns;
    try {
      const saved = JSON.parse(localStorage.getItem('project_excel_pinned_columns_v1') || 'null');
      return Array.isArray(saved) ? saved.filter(item => typeof item === 'string') : ['productName'];
    } catch {
      return ['productName'];
    }
  });
  const [fontScale, setFontScale] = useState(savedFontScale || readProjectExcelFontScale());
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
    if (Object.keys(savedColumnWidths).length > 0) return savedColumnWidths;
    try {
      return JSON.parse(localStorage.getItem('project_excel_column_widths_v1') || '{}');
    } catch {
      return {};
    }
  });
  const cellRefs = useRef<Record<string, HTMLTableCellElement | null>>({});
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const rowSelectionAnchorRef = useRef<number | null>(null);
  const selectingRef = useRef(false);
  const selectionPointerRef = useRef<{ x: number; y: number } | null>(null);
  const selectionScrollFrameRef = useRef<number | null>(null);
  const fillDragRef = useRef<{
    source: { top: number; bottom: number; left: number; right: number };
    target: CellPosition;
  } | null>(null);
  const activeLockRef = useRef<{ recordId: string; field: string } | null>(null);
  const { collaborationUserId, remoteCursors, activeEditors } = useCollaborationStore(useShallow(state => ({
    collaborationUserId: state.userId,
    remoteCursors: state.remoteCursors,
    activeEditors: state.activeEditors,
  })));

  useEffect(() => {
    if (!uiPreferencesLoaded) return;
    setPinnedColumnKeys(savedPinnedColumns);
    setColumnWidths(savedColumnWidths);
    setPersonalColumnOrder(savedPersonalColumnOrder);
    setFontScale(savedFontScale);
  }, [savedColumnWidths, savedFontScale, savedPersonalColumnOrder, savedPinnedColumns, uiPreferencesLoaded]);

  const columns = useMemo<SheetColumn[]>(() => {
    if (columnsOverride) return columnsOverride;
    const base = BASE_COLUMNS.map(column => ({
      ...column,
      options: fieldOptions[column.key]
        ?? (column.key === 'status'
          ? statusOptions
          : column.key === 'trustManager' || column.key === 'trustManagerB'
            ? managerOptions
            : column.key === 'custodianBank'
              ? bankOptions
              : undefined),
    }));
    const dynamic = customColumns.map(column => ({
      key: column.key,
      label: column.title,
      width: column.width || 150,
      type: column.type === 'number' ? 'number' as const : column.type === 'date' ? 'date' as const : 'text' as const,
      dynamic: true,
    }));
    const dataColumns = [...base, ...dynamic];
    const byKey = new Map(dataColumns.map(column => [column.key, column]));
    const effectiveColumnOrder = personalColumnOrder.length > 0 ? personalColumnOrder : columnOrder;
    const ordered = effectiveColumnOrder
      .filter(key => key !== 'actions')
      .map(key => byKey.get(key))
      .filter(Boolean) as SheetColumn[];
    const orderedKeys = new Set(ordered.map(column => column.key));
    return [
      ...ordered,
      ...dataColumns.filter(column => !orderedKeys.has(column.key)),
    ];
  }, [bankOptions, columnOrder, columnsOverride, customColumns, fieldOptions, managerOptions, personalColumnOrder, statusOptions]);

  const pageStart = 0;
  const activeFilterEntries = useMemo(
    () => Object.entries(columnFilters).filter(([, filter]) => filterIsActive(filter)),
    [columnFilters],
  );
  const pageRows = useMemo(() => {
    const columnMap = new Map(columns.map(column => [column.key, column]));
    const filtered = activeFilterEntries.length === 0 ? [...data] : data.filter(product => activeFilterEntries.every(([key, filter]) => {
      const column = columnMap.get(key);
      return !column || rowMatchesFilter(product, column, filter);
    }));
    if (sortRules.length === 0) return filtered;
    return filtered
      .map((product, index) => ({ product, index }))
      .sort((left, right) => {
        for (const rule of sortRules) {
          const column = columnMap.get(rule.key);
          if (!column) continue;
          const leftValue = fieldValue(left.product, column);
          const rightValue = fieldValue(right.product, column);
          const leftBlank = leftValue === '' || leftValue == null;
          const rightBlank = rightValue === '' || rightValue == null;
          let comparison = 0;
          if (leftBlank !== rightBlank) comparison = leftBlank ? 1 : -1;
          else if (!leftBlank && !rightBlank) {
            if (column.type === 'number' || column.type === 'readonly') {
              comparison = Number(leftValue) - Number(rightValue);
            } else if (column.type === 'date') {
              comparison = Date.parse(String(leftValue)) - Date.parse(String(rightValue));
            } else if (column.options?.length) {
              const leftIndex = column.options.indexOf(String(leftValue));
              const rightIndex = column.options.indexOf(String(rightValue));
              comparison = (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex)
                - (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex);
            } else {
              comparison = String(leftValue).localeCompare(String(rightValue), 'zh-CN', { numeric: true, sensitivity: 'base' });
            }
          }
          if (comparison !== 0) return rule.direction === 'asc' ? comparison : -comparison;
        }
        return left.index - right.index;
      })
      .map(item => item.product);
  }, [activeFilterEntries, columns, data, sortRules]);
  const selectionBounds = selection ? {
    top: Math.min(selection.anchor.row, selection.focus.row),
    bottom: Math.max(selection.anchor.row, selection.focus.row),
    left: Math.min(selection.anchor.col, selection.focus.col),
    right: Math.max(selection.anchor.col, selection.focus.col),
  } : null;
  const rowNumberWidth = showCoordinates ? ROW_NUMBER_WIDTH : 0;
  const tableWidth = rowNumberWidth + columns.reduce((sum, column) => sum + (columnWidths[column.key] || column.width), 0);
  const pinnedColumns = columns.filter(column => column.type !== 'actions' && pinnedColumnKeys.includes(column.key));
  const pinnedOffsets = new Map<string, number>();
  let nextPinnedOffset = rowNumberWidth;
  pinnedColumns.forEach(column => {
    pinnedOffsets.set(column.key, nextPinnedOffset);
    nextPinnedOffset += columnWidths[column.key] || column.width;
  });
  const lastPinnedColumnKey = pinnedColumns[pinnedColumns.length - 1]?.key;
  const activeProduct = active ? pageRows[active.row] : null;
  const activeColumn = active ? columns[active.col] : null;
  const activeCellAddress = active
    ? selectionBounds && (selectionBounds.top !== selectionBounds.bottom || selectionBounds.left !== selectionBounds.right)
      ? `${columnLetter(selectionBounds.left)}${selectionBounds.top + 1}:${columnLetter(selectionBounds.right)}${selectionBounds.bottom + 1}`
      : `${columnLetter(active.col)}${active.row + 1}`
    : '';
  const formatKey = (productId: string, field: string) => `${productId}:${field}`;
  const activeFormat = activeProduct && activeColumn ? cellFormats[formatKey(activeProduct.id, activeColumn.key)] || {} : {};
  const selectedFormats = useMemo(() => {
    if (!selectionBounds) return activeProduct && activeColumn ? [activeFormat] : [];
    const formats: CellFormat[] = [];
    for (let row = selectionBounds.top; row <= selectionBounds.bottom; row += 1) {
      for (let col = selectionBounds.left; col <= selectionBounds.right; col += 1) {
        const product = pageRows[row]; const column = columns[col];
        if (product && column && column.type !== 'actions') formats.push(cellFormats[formatKey(product.id, column.key)] || {});
      }
    }
    return formats;
  }, [activeColumn, activeFormat, activeProduct, cellFormats, columns, pageRows, selectionBounds]);
  const formatState = <K extends keyof CellFormat>(key: K): CellFormat[K] | 'mixed' | undefined => {
    if (selectedFormats.length === 0) return undefined;
    const first = selectedFormats[0][key];
    return selectedFormats.every(format => format[key] === first) ? first : 'mixed';
  };
  const booleanFormatActive = (key: 'bold' | 'italic' | 'underline' | 'wrap') => formatState(key) === true;
  const booleanFormatMixed = (key: 'bold' | 'italic' | 'underline' | 'wrap') => formatState(key) === 'mixed';
  const selectionIdentity = selection
    ? `${selection.anchor.row}:${selection.anchor.col}:${selection.focus.row}:${selection.focus.col}`
    : '';
  const searchMatches = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase('zh-CN');
    if (!query) return [] as CellPosition[];
    const matches: CellPosition[] = [];
    pageRows.forEach((product, row) => columns.forEach((column, col) => {
      if (column.type === 'actions') return;
      if (String(fieldValue(product, column)).toLocaleLowerCase('zh-CN').includes(query)) matches.push({ row, col });
    }));
    return matches;
  }, [columns, pageRows, searchQuery]);

  const filterColumn = filterMenu ? columns.find(column => column.key === filterMenu.key) ?? null : null;
  const filterColumnValues = useMemo(() => {
    if (!filterColumn || isRangeColumn(filterColumn)) return [];
    return Array.from(new Set(data.map(product => rawFilterValue(product, filterColumn))))
      .sort((a, b) => {
        if (!a) return 1;
        if (!b) return -1;
        return a.localeCompare(b, 'zh-CN', { numeric: true, sensitivity: 'base' });
      });
  }, [data, filterColumn]);
  const visibleFilterValues = useMemo(() => {
    if (!filterDraft || filterDraft.kind !== 'values') return filterColumnValues;
    const query = filterDraft.query.trim().toLocaleLowerCase('zh-CN');
    if (!query) return filterColumnValues;
    return filterColumnValues.filter(value => value.toLocaleLowerCase('zh-CN').includes(query));
  }, [filterColumnValues, filterDraft]);
  const filteredRowIdsKey = useMemo(() => pageRows.map(row => row.id).join('\u001f'), [pageRows]);
  const allVisibleRowsSelected = pageRows.length > 0 && pageRows.every(row => selectedIds.includes(row.id));

  useEffect(() => {
    if (!allVisibleRowsSelected) return;
    const clearSelectAll = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('[data-project-select-all]')) return;
      onSetSelectedRows([]);
      setSelection(null);
      setActive(null);
      setEditing(null);
      rowSelectionAnchorRef.current = null;
    };
    window.addEventListener('pointerdown', clearSelectAll, true);
    return () => window.removeEventListener('pointerdown', clearSelectAll, true);
  }, [allVisibleRowsSelected, onSetSelectedRows]);

  useEffect(() => {
    if (!focusRowId || !data.some(product => product.id === focusRowId)) return;
    if (pageRows.some(product => product.id === focusRowId)) return;
    setColumnFilters({});
  }, [data, focusRowId, pageRows]);

  useEffect(() => {
    if (!focusRowId) return;
    const row = pageRows.findIndex(product => product.id === focusRowId);
    if (row < 0) return;
    const requestedColumn = focusField ? columns.findIndex(column => column.key === focusField) : -1;
    const col = requestedColumn >= 0
      ? requestedColumn
      : Math.max(0, columns.findIndex(column => column.key === 'productName'));
    const position = { row, col };
    setEditing(null);
    setActive(position);
    setSelection({ anchor: position, focus: position });
    const timer = window.setTimeout(() => {
      const cell = cellRefs.current[`${row}-${col}`];
      cell?.focus({ preventScroll: true });
      cell?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [columns, focusField, focusRowId, pageRows]);

  const startSelectionAutoScroll = () => {
    if (selectionScrollFrameRef.current !== null) return;
    const edgeSize = 72;
    const maxSpeed = 26;
    const edgeSpeed = (coordinate: number, start: number, end: number) => {
      if (coordinate < start + edgeSize) return -maxSpeed * Math.min(1, (start + edgeSize - coordinate) / edgeSize);
      if (coordinate > end - edgeSize) return maxSpeed * Math.min(1, (coordinate - (end - edgeSize)) / edgeSize);
      return 0;
    };
    const tick = () => {
      selectionScrollFrameRef.current = null;
      if (!selectingRef.current) return;
      const viewport = viewportRef.current;
      const pointer = selectionPointerRef.current;
      if (!viewport || !pointer) {
        selectionScrollFrameRef.current = window.requestAnimationFrame(tick);
        return;
      }
      const rect = viewport.getBoundingClientRect();
      const speedX = edgeSpeed(pointer.x, rect.left, rect.right);
      const speedY = edgeSpeed(pointer.y, rect.top, rect.bottom);
      if (speedX || speedY) viewport.scrollBy({ left: speedX, top: speedY });

      const hitX = Math.min(rect.right - 2, Math.max(rect.left + rowNumberWidth + 2, pointer.x));
      const hitY = Math.min(rect.bottom - 2, Math.max(rect.top + (showCoordinates ? 48 : 36), pointer.y));
      const hit = document.elementFromPoint(hitX, hitY)?.closest<HTMLTableCellElement>('[data-sheet-row][data-sheet-field]');
      if (hit) {
        const row = Number(hit.dataset.sheetRow);
        const field = hit.dataset.sheetField;
        const col = columns.findIndex(column => column.key === field);
        if (Number.isInteger(row) && row >= 0 && row < pageRows.length && col >= 0) {
          const position = { row, col };
          setActive(current => current?.row === row && current.col === col ? current : position);
          setSelection(current => current
            ? current.focus.row === row && current.focus.col === col ? current : { ...current, focus: position }
            : { anchor: position, focus: position });
        }
      }
      selectionScrollFrameRef.current = window.requestAnimationFrame(tick);
    };
    selectionScrollFrameRef.current = window.requestAnimationFrame(tick);
  };

  useEffect(() => {
    localStorage.setItem('project_excel_column_widths_v1', JSON.stringify(columnWidths));
    if (!uiPreferencesLoaded) return;
    if (JSON.stringify(columnWidths) === JSON.stringify(savedColumnWidths)) return;
    if (preferenceSaveTimerRef.current !== null) window.clearTimeout(preferenceSaveTimerRef.current);
    preferenceSaveTimerRef.current = window.setTimeout(() => {
      void updatePreferences({ projectExcelColumnWidths: columnWidths }, '旧表格列宽偏好保存失败');
      preferenceSaveTimerRef.current = null;
    }, 500);
  }, [columnWidths, savedColumnWidths, uiPreferencesLoaded, updatePreferences]);

  useEffect(() => {
    if (!uiPreferencesLoaded) return;
    if (JSON.stringify(personalColumnOrder) === JSON.stringify(savedPersonalColumnOrder)) return;
    void updatePreferences({ projectExcelColumnOrder: personalColumnOrder }, '个人列顺序保存失败');
  }, [personalColumnOrder, savedPersonalColumnOrder, uiPreferencesLoaded, updatePreferences]);

  useEffect(() => {
    localStorage.setItem('project_excel_pinned_columns_v1', JSON.stringify(pinnedColumnKeys));
    if (uiPreferencesLoaded && JSON.stringify(pinnedColumnKeys) !== JSON.stringify(savedPinnedColumns)) {
      void updatePreferences({ projectExcelPinnedColumns: pinnedColumnKeys }, '旧表格固定列偏好保存失败');
    }
  }, [pinnedColumnKeys, savedPinnedColumns, uiPreferencesLoaded, updatePreferences]);

  useEffect(() => () => {
    if (preferenceSaveTimerRef.current !== null) window.clearTimeout(preferenceSaveTimerRef.current);
  }, []);

  useEffect(() => {
    const handleFontScaleChange = (event: Event) => {
      const nextScale = (event as CustomEvent<number>).detail;
      if (typeof nextScale === 'number') setFontScale(nextScale);
    };
    window.addEventListener(PROJECT_EXCEL_FONT_SCALE_EVENT, handleFontScaleChange);
    return () => window.removeEventListener(PROJECT_EXCEL_FONT_SCALE_EVENT, handleFontScaleChange);
  }, []);

  useEffect(() => {
    onFilteredRowIdsChange?.(filteredRowIdsKey ? filteredRowIdsKey.split('\u001f') : []);
  }, [filteredRowIdsKey, onFilteredRowIdsChange]);

  useEffect(() => {
    const stopSelectionScroll = () => {
      selectingRef.current = false;
      selectionPointerRef.current = null;
      if (selectionScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(selectionScrollFrameRef.current);
        selectionScrollFrameRef.current = null;
      }
    };
    const trackSelectionPointer = (event: globalThis.MouseEvent) => {
      if (!selectingRef.current) return;
      selectionPointerRef.current = { x: event.clientX, y: event.clientY };
    };
    window.addEventListener('mousemove', trackSelectionPointer);
    window.addEventListener('pointerup', stopSelectionScroll);
    window.addEventListener('blur', stopSelectionScroll);
    return () => {
      window.removeEventListener('mousemove', trackSelectionPointer);
      window.removeEventListener('pointerup', stopSelectionScroll);
      window.removeEventListener('blur', stopSelectionScroll);
      stopSelectionScroll();
    };
  }, []);

  useEffect(() => {
    if (!active) {
      broadcastCursor(null, -1, -1);
      return;
    }
    const product = pageRows[active.row];
    broadcastCursor(product?.id ?? null, active.col, active.row, columns[active.col]?.key);
  }, [active, columns, pageRows]);

  useEffect(() => {
    const heartbeat = window.setInterval(() => {
      const lock = activeLockRef.current;
      if (!lock) return;
      broadcastEditingStart({
        recordType: 'project', recordId: lock.recordId,
        field: lock.field, location: '项目进度 · 表格',
      });
    }, 5000);
    return () => {
      window.clearInterval(heartbeat);
      const lock = activeLockRef.current;
      if (lock) broadcastEditingStop({ recordType: 'project', recordId: lock.recordId, field: lock.field });
      activeLockRef.current = null;
      broadcastCursor(null, -1, -1);
    };
  }, []);

  useEffect(() => {
    if (pageRows.length === 0 || columns.length === 0) {
      setActive(null);
      setSelection(null);
      return;
    }
    setActive(current => current ? {
      row: Math.min(current.row, pageRows.length - 1),
      col: Math.min(current.col, columns.length - 1),
    } : current);
    setSelection(current => current ? {
      anchor: {
        row: Math.min(current.anchor.row, pageRows.length - 1),
        col: Math.min(current.anchor.col, columns.length - 1),
      },
      focus: {
        row: Math.min(current.focus.row, pageRows.length - 1),
        col: Math.min(current.focus.col, columns.length - 1),
      },
    } : current);
  }, [columns.length, pageRows.length]);

  useEffect(() => {
    if (!editing || !editorRef.current) return;
    editorRef.current.focus();
    if ((editorRef.current instanceof HTMLTextAreaElement)
      || (editorRef.current instanceof HTMLInputElement && editorRef.current.type === 'text')) {
      if (editing.selectOnFocus) editorRef.current.select();
      else {
        const offset = editorRef.current.value.length;
        editorRef.current.setSelectionRange(offset, offset);
      }
    }
  }, [editing]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const handleOutsideInteraction = (event: Event) => {
      const target = event.target;
      if (target instanceof Element && target.closest('[data-project-sheet-context-menu]')) return;
      close();
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', handleOutsideInteraction, true);
    window.addEventListener('click', handleOutsideInteraction, true);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handleOutsideInteraction, true);
      window.removeEventListener('click', handleOutsideInteraction, true);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!headerContextMenu) return;
    const close = () => setHeaderContextMenu(null);
    const handleOutsideInteraction = (event: Event) => {
      const target = event.target;
      if (target instanceof Element && target.closest('[data-project-sheet-header-context-menu]')) return;
      close();
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', handleOutsideInteraction, true);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handleOutsideInteraction, true);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [headerContextMenu]);

  useEffect(() => {
    if (!filterMenu) return;
    const close = () => {
      setFilterMenu(null);
      setFilterDraft(null);
    };
    const handleOutsideInteraction = (event: Event) => {
      const target = event.target;
      if (target instanceof Element && (
        target.closest('[data-project-sheet-filter-menu]')
        || target.closest('[data-project-sheet-filter-trigger]')
      )) return;
      close();
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    const handleScroll = (event: Event) => {
      const target = event.target;
      if (target instanceof Element && target.closest('[data-project-sheet-filter-menu]')) return;
      close();
    };
    window.addEventListener('pointerdown', handleOutsideInteraction, true);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handleOutsideInteraction, true);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [filterMenu]);

  const columnWidth = (column: SheetColumn) => columnWidths[column.key] || column.width;
  const isEditable = (column: SheetColumn) => !['readonly', 'actions'].includes(column.type);
  const cellLock = (productId: string, field: string) => [...activeEditors.values()].find(editor => (
    editor.userId !== collaborationUserId
    && editor.recordType === 'project'
    && editor.recordId === productId
    && editor.field === field
  ));

  const releaseActiveLock = () => {
    const lock = activeLockRef.current;
    if (!lock) return;
    broadcastEditingStop({ recordType: 'project', recordId: lock.recordId, field: lock.field });
    activeLockRef.current = null;
  };

  // Selection and navigation never own a lock. Any path that closes the actual
  // cell editor (including filters, sorting and context menus) releases it.
  useEffect(() => {
    if (!editing) releaseActiveLock();
  }, [editing]);

  const showFilterMenu = (column: SheetColumn, x: number, y: number) => {
    const current = columnFilters[column.key] ?? emptyFilterFor(column);
    setFilterDraft(current.kind === 'range'
      ? { ...current }
      : { ...current, values: current.values ? [...current.values] : null });
    setFilterMenu({
      key: column.key,
      x: Math.max(8, Math.min(x, window.innerWidth - 296)),
      y: Math.max(8, Math.min(y, window.innerHeight - 420)),
    });
  };

  const closeFilterMenu = () => {
    setFilterMenu(null);
    setFilterDraft(null);
  };

  const applyFilterDraft = () => {
    if (!filterColumn || !filterDraft) return;
    const nextDraft = filterDraft.kind === 'values' && filterDraft.values?.length === filterColumnValues.length
      ? { ...filterDraft, values: null }
      : filterDraft;
    setColumnFilters(current => {
      const next = { ...current };
      if (filterIsActive(nextDraft)) next[filterColumn.key] = nextDraft;
      else delete next[filterColumn.key];
      return next;
    });
    setActive(null);
    setEditing(null);
    closeFilterMenu();
  };

  const clearColumnFilter = (key: string) => {
    setColumnFilters(current => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setActive(null);
    setEditing(null);
    closeFilterMenu();
  };

  const toggleSort = (key: string, additive: boolean) => {
    setSortRules(current => {
      const existing = current.find(rule => rule.key === key);
      if (!additive) {
        if (!existing || current.length > 1) return [{ key, direction: 'asc' }];
        if (existing.direction === 'asc') return [{ key, direction: 'desc' }];
        return [];
      }
      if (!existing) return [...current, { key, direction: 'asc' }];
      if (existing.direction === 'asc') {
        return current.map(rule => rule.key === key ? { ...rule, direction: 'desc' } : rule);
      }
      return current.filter(rule => rule.key !== key);
    });
    setActive(null);
    setSelection(null);
    setEditing(null);
  };

  const toggleDraftValue = (value: string) => {
    if (!filterDraft || filterDraft.kind !== 'values') return;
    const selected = filterDraft.values === null ? [...filterColumnValues] : [...filterDraft.values];
    const nextValues = selected.includes(value)
      ? selected.filter(item => item !== value)
      : [...selected, value];
    setFilterDraft({ ...filterDraft, values: nextValues });
  };

  const openHeaderContextMenu = (event: MouseEvent<HTMLTableCellElement>, column: SheetColumn) => {
    if (column.type === 'actions') return;
    event.preventDefault();
    event.stopPropagation();
    setContextMenu(null);
    closeFilterMenu();
    setHeaderContextMenu({
      key: column.key,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 216)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 288)),
    });
  };

  const moveColumn = (key: string, direction: -1 | 1) => {
    const movableKeys = columns.filter(column => column.type !== 'actions').map(column => column.key);
    const index = movableKeys.indexOf(key);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= movableKeys.length) return;
    const nextOrder = [...movableKeys];
    [nextOrder[index], nextOrder[targetIndex]] = [nextOrder[targetIndex], nextOrder[index]];
    setPersonalColumnOrder([...nextOrder, 'actions']);
    setActive(null);
    setEditing(null);
  };

  const resetColumnWidth = (key: string) => {
    setColumnWidths(current => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const togglePinnedColumn = (key: string) => {
    setPinnedColumnKeys(current => current.includes(key)
      ? current.filter(item => item !== key)
      : [...current, key]);
  };

  const clearColumnDrag = () => {
    setDraggedColumnKey(null);
    setColumnDropTarget(null);
  };

  const handleColumnDragStart = (event: DragEvent<HTMLElement>, column: SheetColumn) => {
    if (column.type === 'actions') {
      event.preventDefault();
      return;
    }
    setDraggedColumnKey(column.key);
    setColumnDropTarget(null);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', column.key);
  };

  const handleColumnDragOver = (event: DragEvent<HTMLTableCellElement>, column: SheetColumn) => {
    if (!draggedColumnKey || column.key === draggedColumnKey) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const rect = event.currentTarget.getBoundingClientRect();
    const side = column.type === 'actions' || event.clientX < rect.left + rect.width / 2
      ? 'before'
      : 'after';
    setColumnDropTarget({ key: column.key, side });
  };

  const handleColumnDrop = (event: DragEvent<HTMLTableCellElement>, target: SheetColumn) => {
    event.preventDefault();
    const sourceKey = draggedColumnKey || event.dataTransfer.getData('text/plain');
    if (!sourceKey || sourceKey === target.key) {
      clearColumnDrag();
      return;
    }
    const movableKeys = columns.filter(column => column.type !== 'actions').map(column => column.key);
    const nextOrder = movableKeys.filter(key => key !== sourceKey);
    const targetIndex = target.type === 'actions' ? nextOrder.length : nextOrder.indexOf(target.key);
    if (targetIndex < 0) {
      clearColumnDrag();
      return;
    }
    const side = target.type === 'actions' ? 'before' : (columnDropTarget?.side || 'before');
    nextOrder.splice(targetIndex + (side === 'after' ? 1 : 0), 0, sourceKey);
    setPersonalColumnOrder([...nextOrder, 'actions']);
    setActive(null);
    setEditing(null);
    setContextMenu(null);
    clearColumnDrag();
  };

  const applyPersonalOrderToSource = () => {
    const nextOrder = columns.map(column => column.key);
    onColumnOrderChange(nextOrder);
    setPersonalColumnOrder([]);
  };

  const resetPersonalColumnOrder = () => {
    setPersonalColumnOrder([]);
    setActive(null);
    setEditing(null);
  };

  const focusCell = (row: number, col: number, extendSelection = false) => {
    const nextRow = Math.max(0, Math.min(pageRows.length - 1, row));
    const nextCol = Math.max(0, Math.min(columns.length - 1, col));
    const next = { row: nextRow, col: nextCol };
    setActive(next);
    setSelection(current => extendSelection && current
      ? { ...current, focus: next }
      : { anchor: next, focus: next });
    window.setTimeout(() => {
      cellRefs.current[`${nextRow}-${nextCol}`]?.focus();
      cellRefs.current[`${nextRow}-${nextCol}`]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }, 0);
  };

  const beginEdit = async (row: number, col: number, initial?: string, selectOnFocus = false) => {
    const product = pageRows[row];
    const column = columns[col];
    if (!product || !column || !isEditable(column)) return;
    const occupied = cellLock(product.id, column.key);
    if (occupied) {
      _toast.warning?.(`“${occupied.displayName}”正在编辑${column.label}`);
      return;
    }
    if (activeLockRef.current?.recordId !== product.id || activeLockRef.current?.field !== column.key) {
      releaseActiveLock();
      const lockResult = await requestEditingLock({
        recordType: 'project', recordId: product.id, recordLabel: product.productName,
        field: column.key, fieldLabel: column.label, location: '项目进度 · 表格',
      });
      if (!lockResult.granted) {
        _toast.warning?.(lockResult.owner === '协同服务未连接'
          ? '协同服务未连接，暂时不能编辑表格'
          : `“${lockResult.owner || '其他用户'}”正在编辑${column.label}`);
        return;
      }
      activeLockRef.current = { recordId: product.id, field: column.key };
    }
    const position = { row, col };
    setActive(position);
    setSelection({ anchor: position, focus: position });
    setEditing({
      row,
      col,
      value: initial ?? String(fieldValue(product, column)),
      selectOnFocus,
      editorHeight: cellRefs.current[`${row}-${col}`]?.getBoundingClientRect().height,
    });
  };

  const buildChange = (row: number, col: number, rawValue: CellValue): CellChange | null => {
    const product = pageRows[row];
    const column = columns[col];
    if (!product || !column || !isEditable(column)) return null;
    const before = fieldValue(product, column);
    let after: CellValue = rawValue;
    if (column.type === 'number') {
      const normalized = String(rawValue).replace(/,/g, '').trim();
      if (normalized !== '' && !Number.isFinite(Number(normalized))) return null;
      after = normalized === '' ? 0 : Number(normalized);
    } else {
      after = String(rawValue);
      if (column.type === 'date' && after !== '' && !isValidIsoDate(after)) return null;
      if (column.type === 'select' && after !== '' && column.options && !column.options.includes(after)) return null;
    }
    if (String(before) === String(after)) return null;
    return { id: product.id, field: column.key, apiField: column.dynamic ? `dynamicFields.${column.key}` : column.key, before, after };
  };

  const validatePastedCell = (row: number, col: number, rawValue: CellValue): string | null => {
    const product = pageRows[row];
    const column = columns[col];
    if (!product || !column) return '超出当前表格范围';
    if (!isEditable(column)) return '该字段不可编辑';
    const occupied = cellLock(product.id, column.key);
    if (occupied) return `“${occupied.displayName}”正在编辑`;
    const normalized = String(rawValue).trim();
    if (column.type === 'number' && normalized !== '' && !Number.isFinite(Number(normalized.replace(/,/g, '')))) return '应输入有效数字';
    if (column.type === 'date' && normalized !== '' && !isValidIsoDate(normalized)) return '日期无效，应为 YYYY-MM-DD';
    if (column.type === 'select' && normalized !== '' && column.options && !column.options.includes(normalized)) return '不在允许的选项中';
    if (column.key === 'productName' && normalized === '') return '项目名称不能为空';
    return null;
  };

  const transactionActionLabel = (changes: CellChange[], preferred?: string) => {
    if (preferred) return preferred;
    if (changes.length === 1) {
      const change = changes[0];
      const column = columns.find(item => item.key === change.field);
      return `编辑${column?.label || change.field}`;
    }
    return `批量修改 ${changes.length} 个单元格`;
  };

  const loadTransactions = async () => {
    if (!projectTransactionsEnabled) return;
    try {
      const result = await api.get<{ transactions: PersistedTransaction[] }>('/products/transactions?limit=100');
      setTransactions(result.transactions || []);
    } catch (error) {
      _toast.error?.(error instanceof Error ? error.message : '读取事务历史失败');
    }
  };

  const loadCellFormats = async () => {
    try {
      const result = await api.get<{ formats: Record<string, CellFormat> }>('/products/cell-formats');
      setCellFormats(result.formats || {});
    } catch (error) {
      _toast.error?.(error instanceof Error ? error.message : '读取单元格格式失败');
    }
  };

  const loadSheetTypography = async () => {
    try {
      const result = await api.get<{ typography: { fontFamily: NonNullable<CellFormat['fontFamily']>; fontSize: number } }>('/products/sheet-typography');
      if (result.typography) setSheetTypography(result.typography);
    } catch (error) {
      _toast.error?.(error instanceof Error ? error.message : '读取全表字体失败');
    }
  };

  const updateSheetTypography = async (patch: Partial<typeof sheetTypography>) => {
    const previous = sheetTypography;
    const next = { ...previous, ...patch };
    setSheetTypography(next);
    try {
      await api.put('/products/sheet-typography', next);
    } catch (error) {
      setSheetTypography(previous);
      _toast.error?.(error instanceof Error ? error.message : '保存全表字体失败');
    }
  };

  const replayPersistedTransaction = async (transaction: PersistedTransaction, action: 'undo' | 'redo') => {
    if (!projectTransactionsEnabled) return;
    setTransactionBusy(true);
    try {
      await api.post(`/products/transactions/${encodeURIComponent(transaction.id)}/${action}`, {});
      await Promise.all([onRefresh(), loadTransactions(), loadCellFormats()]);
      _toast.success?.(action === 'undo' ? '事务已撤销' : '事务已重做');
    } catch (error) {
      _toast.error?.(error instanceof Error ? error.message : action === 'undo' ? '撤销失败' : '重做失败');
      await loadTransactions();
    } finally {
      setTransactionBusy(false);
    }
  };

  useEffect(() => {
    if (projectTransactionsEnabled) void loadTransactions();
    void loadCellFormats();
    void loadSheetTypography();
  }, [projectTransactionsEnabled]);

  useEffect(() => {
    if (editing) return;
    setFormulaValue(activeProduct && activeColumn && activeColumn.type !== 'actions'
      ? String(fieldValue(activeProduct, activeColumn))
      : '');
  }, [activeProduct, activeColumn, editing]);

  const selectedCellCoordinates = () => {
    const bounds = boundsForSelection();
    if (!bounds) return [] as Array<{ product: InvestmentProduct; column: SheetColumn }>;
    const cells: Array<{ product: InvestmentProduct; column: SheetColumn }> = [];
    for (let row = bounds.top; row <= bounds.bottom; row += 1) {
      for (let col = bounds.left; col <= bounds.right; col += 1) {
        const product = pageRows[row];
        const column = columns[col];
        if (product && column && column.type !== 'actions') cells.push({ product, column });
      }
    }
    return cells;
  };

  const applyFormatPatch = async (patch: Partial<CellFormat>, label: string) => {
    const cells = selectedCellCoordinates();
    if (cells.length === 0) return;
    const changes = cells.map(({ product, column }) => {
      const key = formatKey(product.id, column.key);
      const next = { ...(cellFormats[key] || {}), ...patch };
      Object.keys(next).forEach(keyName => {
        if (next[keyName as keyof CellFormat] === undefined) delete next[keyName as keyof CellFormat];
      });
      return { id: product.id, field: column.key, format: next };
    });
    const previousFormats = cellFormats;
    setCellFormats(current => {
      const next = { ...current };
      changes.forEach(change => { next[formatKey(change.id, change.field)] = change.format; });
      return next;
    });
    setTransactionBusy(true);
    try {
      await api.put('/products/cell-formats', { changes, label });
      await Promise.all([loadCellFormats(), loadTransactions()]);
    } catch (error) {
      setCellFormats(previousFormats);
      _toast.error?.(error instanceof Error ? error.message : '保存单元格格式失败');
    } finally {
      setTransactionBusy(false);
    }
  };

  const replaceSelectedFormats = async (format: CellFormat, label: string) => {
    const cells = selectedCellCoordinates();
    if (cells.length === 0) return;
    setTransactionBusy(true);
    try {
      await api.put('/products/cell-formats', { changes: cells.map(({ product, column }) => ({ id: product.id, field: column.key, format })), label });
      await Promise.all([loadCellFormats(), loadTransactions()]);
    } catch (error) {
      _toast.error?.(error instanceof Error ? error.message : '保存单元格格式失败');
    } finally { setTransactionBusy(false); }
  };

  const applyBorderPreset = async (preset: BorderPreset) => {
    const bounds = boundsForSelection();
    if (!bounds) return;
    const color = activeFormat.borderColor || '#94a3b8';
    const width = activeFormat.borderWidth || 1;
    const lineStyle = activeFormat.borderLineStyle || 'solid';
    const changes: Array<{ id: string; field: string; format: CellFormat }> = [];
    for (let row = bounds.top; row <= bounds.bottom; row += 1) {
      for (let col = bounds.left; col <= bounds.right; col += 1) {
        const product = pageRows[row]; const column = columns[col];
        if (!product || !column || column.type === 'actions') continue;
        const previous = cellFormats[formatKey(product.id, column.key)] || {};
        const next: CellFormat = { ...previous, borderColor: color, borderWidth: width, borderLineStyle: lineStyle };
        delete next.borderStyle;
        if (preset === 'none') {
          delete next.borderTop; delete next.borderRight; delete next.borderBottom; delete next.borderLeft;
          delete next.borderColor; delete next.borderWidth; delete next.borderLineStyle;
        } else if (preset === 'all') {
          next.borderTop = true; next.borderRight = true; next.borderBottom = true; next.borderLeft = true;
        } else if (preset === 'outer') {
          next.borderTop = row === bounds.top; next.borderRight = col === bounds.right;
          next.borderBottom = row === bounds.bottom; next.borderLeft = col === bounds.left;
        } else if (preset === 'inner') {
          next.borderTop = row > bounds.top; next.borderRight = col < bounds.right;
          next.borderBottom = row < bounds.bottom; next.borderLeft = col > bounds.left;
        } else if (preset === 'inner-horizontal') {
          next.borderTop = row > bounds.top; next.borderBottom = row < bounds.bottom;
        } else if (preset === 'inner-vertical') {
          next.borderRight = col < bounds.right; next.borderLeft = col > bounds.left;
        } else {
          const side = `border${preset[0].toUpperCase()}${preset.slice(1)}` as 'borderTop' | 'borderRight' | 'borderBottom' | 'borderLeft';
          next[side] = true;
        }
        changes.push({ id: product.id, field: column.key, format: next });
      }
    }
    setTransactionBusy(true);
    try {
      await api.put('/products/cell-formats', { changes, label: `设置${preset === 'outer' ? '外' : preset === 'inner' ? '内部' : ''}边框` });
      await Promise.all([loadCellFormats(), loadTransactions()]);
    } catch (error) { _toast.error?.(error instanceof Error ? error.message : '保存边框失败'); }
    finally { setTransactionBusy(false); }
  };

  const clearSelectedFormats = () => void replaceSelectedFormats({}, '清除格式');
  const copySelectedFormat = () => {
    if (!activeProduct || !activeColumn) return;
    setFormatClipboard({ ...activeFormat });
    _toast.success?.('格式已复制');
  };
  const pasteSelectedFormat = () => {
    if (formatClipboard) void replaceSelectedFormats(formatClipboard, '粘贴格式');
  };
  const activateFormatPainter = () => {
    if (!activeProduct || !activeColumn) return;
    setFormatPainter({ ...activeFormat });
    formatPainterArmedSelectionRef.current = selectionIdentity;
    _toast.success?.('格式刷已启用，请选择目标单元格或区域');
  };

  useEffect(() => {
    if (!formatPainter || !selection || selectionIdentity === formatPainterArmedSelectionRef.current) return;
    const timer = window.setTimeout(() => {
      void replaceSelectedFormats(formatPainter, '格式刷');
      setFormatPainter(null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [selectionIdentity, formatPainter]);

  const commitFormulaValue = async () => {
    if (!active) return;
    const change = buildChange(active.row, active.col, formulaValue);
    if (change) await applyTransaction([change], true, `编辑${activeColumn?.label || '单元格'}`);
  };

  const navigateSearch = (direction = 1) => {
    if (searchMatches.length === 0) return;
    const next = (searchIndex + direction + searchMatches.length) % searchMatches.length;
    setSearchIndex(next);
    focusCell(searchMatches[next].row, searchMatches[next].col);
  };

  useEffect(() => {
    if (!formatToolbarMenu) return;
    const close = (event: Event) => {
      const target = event.target;
      if (target instanceof Element && target.closest('[data-project-format-toolbar]')) return;
      setFormatToolbarMenu(null);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setFormatToolbarMenu(null);
    };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', escape);
    };
  }, [formatToolbarMenu]);

  useEffect(() => {
    if (!searchOpen) return;
    const close = (event: Event) => {
      const target = event.target;
      if (target instanceof Element && target.closest('[data-project-format-toolbar]')) return;
      setSearchOpen(false);
    };
    window.addEventListener('pointerdown', close, true);
    return () => window.removeEventListener('pointerdown', close, true);
  }, [searchOpen]);

  const toggleFormatToolbarMenu = (menu: Exclude<FormatToolbarMenu, null>) => {
    setSearchOpen(false);
    setFormatToolbarMenu(current => current === menu ? null : menu);
  };

  const applyTransaction = async (changes: CellChange[], recordHistory = true, label?: string) => {
    if (changes.length === 0) return false;
    const blocked = changes.find(change => cellLock(change.id, change.field));
    if (blocked) {
      const owner = cellLock(blocked.id, blocked.field);
      _toast.warning?.(`“${owner?.displayName || '其他用户'}”正在编辑选区中的单元格`);
      return false;
    }
    const saved = await onBatchCellEdit(
      changes.map(change => ({ id: change.id, field: change.apiField || change.field, lockField: change.field, value: change.after })),
      transactionActionLabel(changes, label),
    );
    if (!saved) return false;
    if (projectTransactionsEnabled) {
      void loadTransactions();
    } else if (recordHistory) {
      const transaction = { label: transactionActionLabel(changes, label), changes: changes.map(change => ({ ...change })) };
      setLocalUndoStack(current => [...current.slice(-99), transaction]);
      setLocalRedoStack([]);
    }
    return true;
  };

  const boundsForSelection = () => selectionBounds ?? (active ? {
    top: active.row,
    bottom: active.row,
    left: active.col,
    right: active.col,
  } : null);

  const commitEdit = async (direction?: 'down' | 'right' | 'left') => {
    if (!editing) return;
    const current = editing;
    const change = buildChange(current.row, current.col, current.value);
    if (change) await applyTransaction([change]);
    setEditing(null);
    releaseActiveLock();
    if (direction === 'down') focusCell(current.row + 1, current.col);
    if (direction === 'right') focusCell(current.row, current.col + 1);
    if (direction === 'left') focusCell(current.row, current.col - 1);
  };

  const undo = async () => {
    if (!projectTransactionsEnabled) {
      const transaction = localUndoStack[localUndoStack.length - 1];
      if (!transaction) return;
      const reversed = transaction.changes.map(change => ({ ...change, before: change.after, after: change.before }));
      if (await applyTransaction(reversed, false, `撤销：${transaction.label}`)) {
        setLocalUndoStack(current => current.slice(0, -1));
        setLocalRedoStack(current => [...current, transaction]);
      }
      return;
    }
    const transaction = transactions
      .filter(item => item.status === 'applied')
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0];
    if (!transaction) return;
    await replayPersistedTransaction(transaction, 'undo');
  };

  const redo = async () => {
    if (!projectTransactionsEnabled) {
      const transaction = localRedoStack[localRedoStack.length - 1];
      if (!transaction) return;
      if (await applyTransaction(transaction.changes, false, `重做：${transaction.label}`)) {
        setLocalRedoStack(current => current.slice(0, -1));
        setLocalUndoStack(current => [...current, transaction]);
      }
      return;
    }
    const transaction = transactions
      .filter(item => item.status === 'undone')
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0];
    if (!transaction) return;
    await replayPersistedTransaction(transaction, 'redo');
  };

  const clearSelected = () => {
    const bounds = boundsForSelection();
    if (!bounds) return;
    const changes: CellChange[] = [];
    for (let row = bounds.top; row <= bounds.bottom; row += 1) {
      for (let col = bounds.left; col <= bounds.right; col += 1) {
        const change = buildChange(row, col, '');
        if (change) changes.push(change);
      }
    }
    void applyTransaction(changes, true, `清空 ${changes.length} 个单元格`);
  };

  const copySelected = async (cut = false) => {
    const bounds = boundsForSelection();
    if (!bounds) return;
    const text = Array.from({ length: bounds.bottom - bounds.top + 1 }, (_, rowOffset) => (
      Array.from({ length: bounds.right - bounds.left + 1 }, (_, colOffset) => {
        const product = pageRows[bounds.top + rowOffset];
        const column = columns[bounds.left + colOffset];
        return product && column && column.type !== 'actions' ? String(fieldValue(product, column)) : '';
      }).join('\t')
    )).join('\n');
    await navigator.clipboard.writeText(text);
    if (cut) clearSelected();
  };

  const pasteSelected = async () => {
    const bounds = boundsForSelection();
    if (!bounds) return;
    const text = await navigator.clipboard.readText();
    if (!text) return;
    const values = text.replace(/\r/g, '').split('\n').map(row => row.split('\t'));
    if (values.length > 1 && values[values.length - 1].length === 1 && values[values.length - 1][0] === '') values.pop();
    if (values.length === 0) return;
    const repeatToSelection = values.length === 1 && values[0].length === 1
      && (bounds.bottom > bounds.top || bounds.right > bounds.left);
    const rowCount = repeatToSelection ? bounds.bottom - bounds.top + 1 : values.length;
    const colCount = repeatToSelection
      ? bounds.right - bounds.left + 1
      : Math.max(0, ...values.map(valueRow => valueRow.length));
    let changes: CellChange[] = [];
    const errors: PasteValidationError[] = [];
    for (let rowOffset = 0; rowOffset < rowCount; rowOffset += 1) {
      for (let colOffset = 0; colOffset < colCount; colOffset += 1) {
        const sourceRow = values[rowOffset % values.length];
        const rawValue = sourceRow?.[colOffset % sourceRow.length];
        if (rawValue === undefined) continue;
        const row = bounds.top + rowOffset;
        const col = bounds.left + colOffset;
        const message = validatePastedCell(row, col, rawValue);
        if (message) {
          errors.push({ row, col, cell: `${columnLetter(col)}${row + 1}`, field: columns[col]?.label || '未知字段', value: rawValue, message });
          continue;
        }
        const change = buildChange(row, col, rawValue);
        if (change) changes.push(change);
      }
    }
    const productNameChanges = new Map(
      changes.filter(change => change.field === 'productName').map(change => [change.id, String(change.after).trim()]),
    );
    if (productNameChanges.size > 0) {
      const idsByName = new Map<string, string[]>();
      data.forEach(product => {
        const name = productNameChanges.get(product.id) ?? product.productName;
        const key = String(name || '').trim().replace(/\s+/g, '').toLocaleLowerCase('zh-CN');
        if (!key) return;
        idsByName.set(key, [...(idsByName.get(key) || []), product.id]);
      });
      const duplicateIds = new Set(
        [...idsByName.values()].filter(ids => ids.length > 1).flat(),
      );
      for (const change of changes.filter(item => item.field === 'productName' && duplicateIds.has(item.id))) {
        const row = pageRows.findIndex(product => product.id === change.id);
        const col = columns.findIndex(column => column.key === 'productName');
        errors.push({ row, col, cell: `${columnLetter(col)}${row + 1}`, field: '项目名称', value: change.after, message: '项目名称已存在' });
      }
      changes = changes.filter(change => !(change.field === 'productName' && duplicateIds.has(change.id)));
    }
    if (errors.length > 0) {
      setPendingPaste({ changes, errors });
      return;
    }
    void applyTransaction(changes, true, `粘贴 ${changes.length} 个单元格`);
  };

  const fillSelected = (direction: 'down' | 'right') => {
    const bounds = boundsForSelection();
    if (!bounds) return;
    const changes: CellChange[] = [];
    if (direction === 'down') {
      const sourceRow = bounds.bottom > bounds.top ? bounds.top : bounds.top - 1;
      if (sourceRow < 0) return;
      const targetStart = bounds.bottom > bounds.top ? bounds.top + 1 : bounds.top;
      for (let row = targetStart; row <= bounds.bottom; row += 1) {
        for (let col = bounds.left; col <= bounds.right; col += 1) {
          const sourceProduct = pageRows[sourceRow];
          const column = columns[col];
          if (!sourceProduct || !column) continue;
          const change = buildChange(row, col, fieldValue(sourceProduct, column));
          if (change) changes.push(change);
        }
      }
    } else {
      const sourceCol = bounds.right > bounds.left ? bounds.left : bounds.left - 1;
      if (sourceCol < 0) return;
      const targetStart = bounds.right > bounds.left ? bounds.left + 1 : bounds.left;
      for (let row = bounds.top; row <= bounds.bottom; row += 1) {
        const sourceProduct = pageRows[row];
        const sourceColumn = columns[sourceCol];
        if (!sourceProduct || !sourceColumn) continue;
        const sourceValue = fieldValue(sourceProduct, sourceColumn);
        for (let col = targetStart; col <= bounds.right; col += 1) {
          const change = buildChange(row, col, sourceValue);
          if (change) changes.push(change);
        }
      }
    }
    void applyTransaction(changes, true, direction === 'down' ? `向下填充 ${changes.length} 个单元格` : `向右填充 ${changes.length} 个单元格`);
  };

  const completeFillDrag = () => {
    const drag = fillDragRef.current;
    fillDragRef.current = null;
    if (!drag) return;
    const { source, target } = drag;
    const changes: CellChange[] = [];
    if (target.row > source.bottom) {
      const sourceHeight = source.bottom - source.top + 1;
      for (let row = source.bottom + 1; row <= target.row; row += 1) {
        const sourceRow = source.top + ((row - source.bottom - 1) % sourceHeight);
        for (let col = source.left; col <= source.right; col += 1) {
          const sourceProduct = pageRows[sourceRow];
          const column = columns[col];
          if (!sourceProduct || !column) continue;
          const change = buildChange(row, col, fieldValue(sourceProduct, column));
          if (change) changes.push(change);
        }
      }
    } else if (target.col > source.right) {
      const sourceWidth = source.right - source.left + 1;
      for (let row = source.top; row <= source.bottom; row += 1) {
        const product = pageRows[row];
        if (!product) continue;
        for (let col = source.right + 1; col <= target.col; col += 1) {
          const sourceCol = source.left + ((col - source.right - 1) % sourceWidth);
          const sourceColumn = columns[sourceCol];
          if (!sourceColumn) continue;
          const change = buildChange(row, col, fieldValue(product, sourceColumn));
          if (change) changes.push(change);
        }
      }
    }
    void applyTransaction(changes);
  };

  const copyCell = async (_row: number, _col: number, cut = false) => copySelected(cut);
  const pasteCell = async (_row: number, _col: number) => pasteSelected();

  const copyWholeRow = async (product: InvestmentProduct) => {
    const text = columns
      .filter(column => column.type !== 'actions')
      .map(column => String(fieldValue(product, column)))
      .join('\t');
    await navigator.clipboard.writeText(text);
    _toast.success?.('整行数据已复制');
  };

  const handleCellKeyDown = (event: KeyboardEvent<HTMLTableCellElement>, row: number, col: number) => {
    const control = event.ctrlKey || event.metaKey;
    if (event.key === 'Escape' && formatPainter) {
      event.preventDefault();
      setFormatPainter(null);
      return;
    }
    if (control && event.shiftKey && event.key.toLowerCase() === 'c') {
      event.preventDefault();
      copySelectedFormat();
      return;
    }
    if (control && event.shiftKey && event.key.toLowerCase() === 'v') {
      event.preventDefault();
      pasteSelectedFormat();
      return;
    }
    if (control && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if (control && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      redo();
      return;
    }
    if (control && event.key.toLowerCase() === 'c') {
      event.preventDefault();
      void copySelected();
      return;
    }
    if (control && event.key.toLowerCase() === 'x') {
      event.preventDefault();
      void copySelected(true);
      return;
    }
    if (control && event.key.toLowerCase() === 'v') {
      event.preventDefault();
      void pasteSelected();
      return;
    }
    if (control && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      fillSelected('down');
      return;
    }
    if (control && event.key.toLowerCase() === 'r') {
      event.preventDefault();
      fillSelected('right');
      return;
    }

    switch (event.key) {
      case 'F2':
        event.preventDefault();
        beginEdit(row, col);
        break;
      case 'Enter':
        event.preventDefault();
        focusCell(row + 1, col, event.shiftKey);
        break;
      case 'Tab':
        event.preventDefault();
        focusCell(row, col + (event.shiftKey ? -1 : 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusCell(row - 1, col, event.shiftKey);
        break;
      case 'ArrowDown':
        event.preventDefault();
        focusCell(row + 1, col);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        focusCell(row, col - 1, event.shiftKey);
        break;
      case 'ArrowRight':
        event.preventDefault();
        focusCell(row, col + 1, event.shiftKey);
        break;
      case 'Delete':
      case 'Backspace':
        event.preventDefault();
        clearSelected();
        break;
      default:
        if (!control && !event.altKey && event.key.length === 1) {
          event.preventDefault();
          beginEdit(row, col, event.key);
        }
    }
  };

  const startResize = (event: MouseEvent<HTMLDivElement>, column: SheetColumn) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = columnWidth(column);
    const move = (moveEvent: globalThis.MouseEvent) => {
      setColumnWidths(current => ({
        ...current,
        [column.key]: Math.max(84, startWidth + moveEvent.clientX - startX),
      }));
    };
    const end = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', end);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
  };

  const openContextMenu = (event: MouseEvent<HTMLTableCellElement>, row: number, col: number) => {
    event.preventDefault();
    const insideSelection = selectionBounds
      && row >= selectionBounds.top && row <= selectionBounds.bottom
      && col >= selectionBounds.left && col <= selectionBounds.right;
    const position = { row, col };
    setActive(position);
    if (!insideSelection) setSelection({ anchor: position, focus: position });
    setEditing(null);
    setContextMenu({ row, col, x: event.clientX, y: event.clientY });
  };

  const runContextAction = (action: () => void | Promise<void>) => {
    setContextMenu(null);
    void action();
  };

  const renderEditor = (column: SheetColumn) => {
    if (!editing) return null;
    const commonKeyDown = (event: KeyboardEvent<HTMLElement>) => {
      // The editor owns text-entry keys. Without stopping propagation, the
      // parent cell treats every digit/backspace as a new sheet shortcut.
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        setEditing(null);
        releaseActiveLock();
        focusCell(editing.row, editing.col);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        commitEdit('down');
      } else if (event.key === 'Tab') {
        event.preventDefault();
        commitEdit(event.shiftKey ? 'left' : 'right');
      }
    };

    if (column.type === 'select') {
      return (
        <div
          className="h-full w-full"
          onBlurCapture={event => {
            const nextTarget = event.relatedTarget;
            if (event.currentTarget.contains(nextTarget as Node | null)) return;
            if (nextTarget instanceof Element && nextTarget.closest('.project-sheet-select-panel')) return;
            commitEdit();
          }}
        >
          <AppSelect
            value={editing.value}
            options={column.options || []}
            onChange={value => {
              const current = editing;
              const change = buildChange(current.row, current.col, value);
              if (change) void applyTransaction([change], true, `编辑${column.label}`);
              setEditing(null);
              releaseActiveLock();
              focusCell(current.row, current.col);
            }}
            placeholder="请选择"
            clearable
            clearLabel="清空"
            size="sm"
            autoFocus
            autoOpen
            dataEditing
            leading={column.key === 'status' && editing.value
              ? <span className="block h-1.5 w-1.5 bg-primary-600" />
              : undefined}
            hideChevron
            onKeyDown={commonKeyDown}
            className="h-full w-full"
            triggerClassName="project-sheet-select-trigger h-full"
            panelClassName="project-sheet-select-panel"
            matchTriggerWidth
            optionClassName="text-xs"
          />
        </div>
      );
    }

    if (column.type !== 'date' && column.type !== 'number') {
      return (
        <textarea
          ref={editorRef as React.RefObject<HTMLTextAreaElement>}
          value={editing.value}
          onChange={event => {
            event.currentTarget.style.height = 'auto';
            event.currentTarget.style.height = `${Math.max(editing.editorHeight || 40, event.currentTarget.scrollHeight)}px`;
            setEditing(current => current ? { ...current, value: event.target.value } : null);
          }}
          onBlur={() => commitEdit()}
          onKeyDown={event => {
            event.stopPropagation();
            if (event.key === 'Escape') {
              event.preventDefault();
              setEditing(null);
              releaseActiveLock();
              focusCell(editing.row, editing.col);
            } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              commitEdit('down');
            } else if (event.key === 'Tab') {
              event.preventDefault();
              commitEdit(event.shiftKey ? 'left' : 'right');
            }
          }}
          rows={1}
          style={{ height: editing.editorHeight ? `${editing.editorHeight}px` : undefined }}
          className="project-sheet__editor block min-h-10 w-full resize-none select-text overflow-hidden whitespace-pre-wrap border-0 px-2 py-2 text-[13px] leading-5 outline-none"
        />
      );
    }

    return (
      <input
        ref={editorRef as React.RefObject<HTMLInputElement>}
        type={column.type === 'date' ? 'date' : column.type === 'number' ? 'number' : 'text'}
        value={editing.value}
        onChange={event => setEditing(current => current ? { ...current, value: event.target.value } : null)}
        onBlur={() => commitEdit()}
        onKeyDown={commonKeyDown}
        className="project-sheet__editor h-full w-full select-text border-0 px-2 text-[13px] outline-none"
      />
    );
  };

  const contextProduct = contextMenu ? pageRows[contextMenu.row] : null;
  const contextColumn = contextMenu ? columns[contextMenu.col] : null;
  const contextEditable = Boolean(contextColumn && isEditable(contextColumn));
  const contextStatusIndex = contextProduct ? statusOptions.indexOf(String(contextProduct.status || '')) : -1;
  const contextPreviousStatus = contextStatusIndex > 0 ? statusOptions[contextStatusIndex - 1] : '';
  const contextNextStatus = contextStatusIndex >= 0 && contextStatusIndex < statusOptions.length - 1 ? statusOptions[contextStatusIndex + 1] : '';
  const contextMenuButtonClass = 'project-sheet-context-menu__item flex h-8 w-full items-center gap-2.5 px-3 text-left text-xs disabled:cursor-not-allowed';
  const headerContextColumn = headerContextMenu
    ? columns.find(column => column.key === headerContextMenu.key) ?? null
    : null;
  const headerContextColumnIndex = headerContextColumn
    ? columns.filter(column => column.type !== 'actions').findIndex(column => column.key === headerContextColumn.key)
    : -1;
  const movableColumnCount = columns.filter(column => column.type !== 'actions').length;
  const runHeaderContextAction = (action: () => void) => {
    action();
    setHeaderContextMenu(null);
  };

  return (
    <section
      className="project-sheet flex h-full min-h-[480px] flex-col overflow-hidden lg:min-h-0"
      style={{ '--project-sheet-font-scale': fontScale / 100 } as CSSProperties}
    >
      <div className="project-sheet-toolbar shrink-0 border-b border-slate-200 bg-white">
        <ProjectFormatToolbarPortal host={toolbarHost}>
        <div data-project-format-toolbar className="flex h-10 w-full items-center gap-1 bg-white px-1 text-slate-600">
          <button type="button" disabled={transactionBusy || (projectTransactionsEnabled ? !transactions.some(item => item.status === 'applied') : localUndoStack.length === 0)} onClick={() => void undo()} className="project-sheet-toolbar__button" title={showShortcutHints ? '撤销（Ctrl+Z）' : '撤销'}><Undo2 size={17} /></button>
          <button type="button" disabled={transactionBusy || (projectTransactionsEnabled ? !transactions.some(item => item.status === 'undone') : localRedoStack.length === 0)} onClick={() => void redo()} className="project-sheet-toolbar__button" title={showShortcutHints ? '重做（Ctrl+Y）' : '重做'}><Redo2 size={17} /></button>
          <span className="project-sheet-toolbar__divider" />
          <div data-toolbar-collapse="compact" className="project-sheet-toolbar__group"><button type="button" onClick={() => toggleFormatToolbarMenu('number')} className={`project-sheet-toolbar__trigger ${formatToolbarMenu === 'number' ? 'is-active' : ''}`} title="数字格式"><span>{activeFormat.numberFormat === 'currency' ? '￥' : activeFormat.numberFormat === 'percent' ? '%' : activeFormat.numberFormat === 'number' ? '数字' : '自动'}</span><ChevronDown size={13} /></button>{formatToolbarMenu === 'number' && <div className="project-sheet-toolbar__menu w-52"><div className="grid grid-cols-2 gap-1">{(['general','number','currency','percent'] as const).map(value => <button key={value} type="button" onClick={() => { void applyFormatPatch({ numberFormat: value }, '设置数字格式'); setFormatToolbarMenu(null); }} className={`project-sheet-toolbar__menu-button ${activeFormat.numberFormat === value || (!activeFormat.numberFormat && value === 'general') ? 'is-active' : ''}`}>{value === 'general' ? '自动' : value === 'number' ? '数字' : value === 'currency' ? '货币 ￥' : '百分比 %'}</button>)}</div><div className="mt-2 flex border-t border-slate-100 pt-2"><button type="button" onClick={() => void applyFormatPatch({ decimals: Math.max(0, (activeFormat.decimals ?? 2) - 1) }, '减少小数位')} className="project-sheet-toolbar__menu-button flex-1">.0← 减少</button><button type="button" onClick={() => void applyFormatPatch({ decimals: Math.min(8, (activeFormat.decimals ?? 2) + 1) }, '增加小数位')} className="project-sheet-toolbar__menu-button flex-1">.00→ 增加</button></div></div>}</div>
          <div data-toolbar-collapse="medium" className="project-sheet-toolbar__group"><button type="button" onClick={() => toggleFormatToolbarMenu('font')} className={`project-sheet-toolbar__trigger ${formatToolbarMenu === 'font' ? 'is-active' : ''}`} title="全表字体和字号"><span className="max-w-20 truncate">{sheetTypography.fontFamily === 'simsun' ? '宋体' : sheetTypography.fontFamily === 'simhei' ? '黑体' : sheetTypography.fontFamily === 'arial' ? 'Arial' : sheetTypography.fontFamily === 'times-new-roman' ? 'Times' : sheetTypography.fontFamily === 'microsoft-yahei' ? '微软雅黑' : '自动'} · {sheetTypography.fontSize}</span><ChevronDown size={13} /></button>{formatToolbarMenu === 'font' && <div className="project-sheet-toolbar__menu w-64"><label className="project-sheet-toolbar__menu-label">字体<select value={sheetTypography.fontFamily} onChange={event => void updateSheetTypography({ fontFamily: event.target.value as NonNullable<CellFormat['fontFamily']> })} className="project-sheet-toolbar__menu-select"><option value="default">自动</option><option value="microsoft-yahei">微软雅黑</option><option value="simsun">宋体</option><option value="simhei">黑体</option><option value="arial">Arial</option><option value="times-new-roman">Times New Roman</option></select></label><label className="project-sheet-toolbar__menu-label mt-2">字号<select value={String(sheetTypography.fontSize)} onChange={event => void updateSheetTypography({ fontSize: Number(event.target.value) })} className="project-sheet-toolbar__menu-select">{[10,11,12,13,14,16,18,20,24].map(size => <option key={size} value={size}>{size}</option>)}</select></label></div>}</div>
          <span data-toolbar-collapse="medium" className="project-sheet-toolbar__divider" />
          <button type="button" aria-pressed={booleanFormatMixed('bold') ? 'mixed' : booleanFormatActive('bold')} onClick={() => void applyFormatPatch({ bold: !booleanFormatActive('bold') }, booleanFormatActive('bold') ? '取消加粗' : '加粗')} className={`project-sheet-toolbar__button ${booleanFormatActive('bold') ? 'is-active' : ''} ${booleanFormatMixed('bold') ? 'is-mixed' : ''}`} title="加粗"><Bold size={17} /></button>
          <button type="button" aria-pressed={booleanFormatMixed('underline') ? 'mixed' : booleanFormatActive('underline')} onClick={() => void applyFormatPatch({ underline: !booleanFormatActive('underline') }, booleanFormatActive('underline') ? '取消下划线' : '下划线')} className={`project-sheet-toolbar__button ${booleanFormatActive('underline') ? 'is-active' : ''} ${booleanFormatMixed('underline') ? 'is-mixed' : ''}`} title="下划线"><Underline size={17} /></button>
          <div className="project-sheet-toolbar__group"><button type="button" onClick={() => toggleFormatToolbarMenu('colors')} className={`project-sheet-toolbar__trigger is-icon ${formatToolbarMenu === 'colors' ? 'is-active' : ''}`} title="文字和填充颜色"><Palette size={17} /><ChevronDown size={12} /></button>{formatToolbarMenu === 'colors' && <div className="project-sheet-toolbar__menu w-52"><label className="project-sheet-toolbar__color-row"><span><Palette size={15} />字体颜色</span><input type="color" value={activeFormat.textColor || '#1e293b'} onChange={event => void applyFormatPatch({ textColor: event.target.value }, '设置字体颜色')} /></label><label className="project-sheet-toolbar__color-row"><span><PaintBucket size={15} />填充颜色</span><input type="color" value={activeFormat.fillColor || '#ffffff'} onChange={event => void applyFormatPatch({ fillColor: event.target.value }, '设置填充颜色')} /></label></div>}</div>
          <div data-toolbar-collapse="medium" className="project-sheet-toolbar__group"><button type="button" onClick={() => toggleFormatToolbarMenu('borders')} className={`project-sheet-toolbar__trigger ${formatToolbarMenu === 'borders' ? 'is-active' : ''}`} title="边框"><span>边框</span><ChevronDown size={13} /></button>{formatToolbarMenu === 'borders' && <div className="project-sheet-toolbar__menu project-sheet-border-menu"><div className="project-sheet-border-presets">{([['top','上框线'],['bottom','下框线'],['left','左框线'],['right','右框线'],['none','无'],['all','所有'],['outer','外侧'],['inner','内侧'],['inner-horizontal','内侧横线'],['inner-vertical','内侧竖线']] as Array<[BorderPreset,string]>).map(([value,label], index) => <button key={value} type="button" onClick={() => void applyBorderPreset(value)} className={`project-sheet-border-preset ${index === 4 || index === 7 ? 'has-separator' : ''}`}><span>{label}</span><BorderPresetIcon preset={value} /></button>)}</div><div className="project-sheet-border-options"><label><span>颜色</span><input type="color" value={activeFormat.borderColor || '#94a3b8'} onChange={event => void applyFormatPatch({ borderColor: event.target.value }, '设置边框颜色')} /></label><label><span>粗细</span><select value={formatState('borderWidth') === 'mixed' ? '' : String(activeFormat.borderWidth || 1)} onChange={event => void applyFormatPatch({ borderWidth: Number(event.target.value) as CellFormat['borderWidth'] }, '设置边框粗细')}><option value="">混合</option><option value="1">细</option><option value="2">中</option><option value="3">粗</option></select></label><label><span>线型</span><select value={formatState('borderLineStyle') === 'mixed' ? '' : activeFormat.borderLineStyle || 'solid'} onChange={event => void applyFormatPatch({ borderLineStyle: event.target.value as CellFormat['borderLineStyle'] }, '设置边框线型')}><option value="">混合</option><option value="solid">实线</option><option value="dashed">虚线</option><option value="dotted">点线</option></select></label></div></div>}</div>
          <span data-toolbar-collapse="medium" className="project-sheet-toolbar__divider" />
          <div className="project-sheet-toolbar__group"><button type="button" onClick={() => toggleFormatToolbarMenu('alignment')} className={`project-sheet-toolbar__trigger is-icon ${formatToolbarMenu === 'alignment' ? 'is-active' : ''}`} title="对齐与换行">{activeFormat.horizontalAlign === 'center' ? <AlignCenter size={17} /> : activeFormat.horizontalAlign === 'right' ? <AlignRight size={17} /> : <AlignLeft size={17} />}<ChevronDown size={12} /></button>{formatToolbarMenu === 'alignment' && <div className="project-sheet-toolbar__menu w-56"><div className="grid grid-cols-3 gap-1"><button type="button" onClick={() => void applyFormatPatch({ horizontalAlign: 'left' }, '左对齐')} className="project-sheet-toolbar__menu-button"><AlignLeft size={15} />左</button><button type="button" onClick={() => void applyFormatPatch({ horizontalAlign: 'center' }, '居中对齐')} className="project-sheet-toolbar__menu-button"><AlignCenter size={15} />中</button><button type="button" onClick={() => void applyFormatPatch({ horizontalAlign: 'right' }, '右对齐')} className="project-sheet-toolbar__menu-button"><AlignRight size={15} />右</button></div><label className="project-sheet-toolbar__menu-label mt-2">垂直对齐<select value={formatState('verticalAlign') === 'mixed' ? '' : activeFormat.verticalAlign || 'middle'} onChange={event => void applyFormatPatch({ verticalAlign: event.target.value as CellFormat['verticalAlign'] }, '设置垂直对齐')} className="project-sheet-toolbar__menu-select"><option value="">混合</option><option value="top">顶端</option><option value="middle">居中</option><option value="bottom">底端</option></select></label><button type="button" onClick={() => void applyFormatPatch({ wrap: !booleanFormatActive('wrap') }, booleanFormatActive('wrap') ? '取消换行' : '自动换行')} className={`project-sheet-toolbar__menu-button mt-2 w-full ${booleanFormatActive('wrap') ? 'is-active' : ''}`}><WrapText size={15} />自动换行</button></div>}</div>
          <div data-toolbar-collapse="compact" className="project-sheet-toolbar__group"><button type="button" onClick={() => toggleFormatToolbarMenu('tools')} className={`project-sheet-toolbar__trigger is-icon ${formatToolbarMenu === 'tools' || formatPainter ? 'is-active' : ''}`} title="格式工具"><Paintbrush size={17} /><ChevronDown size={12} /></button>{formatToolbarMenu === 'tools' && <div className="project-sheet-toolbar__menu project-sheet-toolbar__menu--tools"><button type="button" onClick={() => { activateFormatPainter(); setFormatToolbarMenu(null); }} className="project-sheet-toolbar__menu-button w-full"><Paintbrush size={15} />格式刷</button><button type="button" onClick={copySelectedFormat} className="project-sheet-toolbar__menu-button w-full"><Copy size={15} />复制格式</button><button type="button" disabled={!formatClipboard} onClick={pasteSelectedFormat} className="project-sheet-toolbar__menu-button w-full"><ClipboardPaste size={15} />粘贴格式</button><button type="button" onClick={clearSelectedFormats} className="project-sheet-toolbar__menu-button w-full"><RemoveFormatting size={15} />清除格式</button></div>}</div>
          <span data-toolbar-collapse="compact" className="project-sheet-toolbar__divider" />
          <div className="project-sheet-toolbar__group">
            <button
              type="button"
              onClick={() => {
                setFormatToolbarMenu(null);
                setSearchOpen(value => !value);
              }}
              className={`project-sheet-toolbar__button ${searchOpen ? 'is-active' : ''}`}
              title="表内搜索"
              aria-expanded={searchOpen}
              aria-haspopup="dialog"
            ><Search size={17} /></button>
            {searchOpen && <div className="project-sheet-toolbar__menu project-sheet-toolbar__menu--search" role="dialog" aria-label="表内搜索">
              <div className="flex items-center gap-2 px-2 py-1">
                <SearchCheck size={15} className="shrink-0 text-slate-400" />
                <input autoFocus value={searchQuery} onChange={event => { setSearchQuery(event.target.value); setSearchIndex(-1); }} onKeyDown={event => { if (event.key === 'Enter') navigateSearch(event.shiftKey ? -1 : 1); if (event.key === 'Escape') setSearchOpen(false); }} className="h-8 min-w-0 flex-1 border border-slate-200 px-2 text-xs outline-none focus:border-primary-400" placeholder="在表格中搜索，Enter 定位下一项" />
                <span className="shrink-0 text-xs tabular-nums text-slate-400">{searchMatches.length ? `${Math.max(searchIndex + 1, 0)} / ${searchMatches.length}` : '无匹配'}</span>
                <button type="button" onClick={() => navigateSearch(1)} className="project-sheet-toolbar__button" title="下一项"><ArrowDownUp size={14} /></button>
                <button type="button" onClick={() => setSearchOpen(false)} className="project-sheet-toolbar__button" title="关闭"><X size={14} /></button>
              </div>
            </div>}
          </div>
          {projectTransactionsEnabled ? <button type="button" onClick={() => { setTransactionPanel(true); void loadTransactions(); }} className="project-sheet-toolbar__button ml-auto" title="事务历史"><History size={16} /></button> : onShowHistory ? <button type="button" onClick={onShowHistory} className="project-sheet-toolbar__button ml-auto" title="历史记录"><History size={16} /></button> : null}
        </div>
        </ProjectFormatToolbarPortal>
        {showFormulaBar && <div className="flex h-10 items-center border-t border-slate-100 text-xs"><div className="flex h-full w-28 shrink-0 items-center justify-center border-r border-slate-200 font-mono text-slate-600">{activeCellAddress || '—'}</div><div className="flex h-full w-11 shrink-0 items-center justify-center border-r border-slate-200 font-serif text-lg italic text-slate-700">fx</div><input value={formulaValue} disabled={!activeColumn || activeColumn.type === 'actions' || !isEditable(activeColumn)} onChange={event => setFormulaValue(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void commitFormulaValue(); } if (event.key === 'Escape') setFormulaValue(activeProduct && activeColumn ? String(fieldValue(activeProduct, activeColumn)) : ''); }} onBlur={() => void commitFormulaValue()} className="project-sheet-formula-input h-full min-w-0 flex-1 border-0 bg-white px-3 text-sm text-slate-800 outline-none disabled:bg-slate-50 disabled:text-slate-400" aria-label="单元格内容编辑栏" placeholder="选择一个单元格后在此编辑完整内容" /></div>}
      </div>
      <div ref={viewportRef} className="project-sheet__viewport min-h-0 flex-1 overflow-auto">
        <table className="project-sheet__table border-separate border-spacing-0 table-fixed" style={{ width: tableWidth }}>
          <colgroup>
            {showCoordinates && <col style={{ width: ROW_NUMBER_WIDTH }} />}
            {columns.map(column => <col key={column.key} style={{ width: columnWidth(column) }} />)}
          </colgroup>
          <thead className="sticky top-0 z-30">
            {showCoordinates && <tr className="project-sheet__coordinate-row">
              <th className="project-sheet__corner sticky left-0 z-50 h-6 p-0 text-center">
                <button
                  type="button"
                  data-project-select-all
                  className="project-sheet__coordinate-button h-full w-full"
                  aria-label="全选表格"
                  onClick={() => {
                    if (!pageRows.length || !columns.length) return;
                    const anchor = { row: 0, col: 0 };
                    const focus = { row: pageRows.length - 1, col: columns.length - 1 };
                    setActive(anchor);
                    setSelection({ anchor, focus });
                    onSetSelectedRows(pageRows.map(row => row.id));
                  }}
                >
                  <span className="project-sheet__select-all-corner" />
                </button>
              </th>
              {columns.map((column, index) => {
                const pinnedLeft = pinnedOffsets.get(column.key);
                const pinned = pinnedLeft !== undefined;
                const columnSelected = Boolean(selectionBounds
                  && selectionBounds.left === index
                  && selectionBounds.right === index
                  && selectionBounds.top === 0
                  && selectionBounds.bottom === pageRows.length - 1);
                return (
                  <th
                    key={`coordinate-${column.key}`}
                    className={`project-sheet__coordinate-header h-6 p-0 text-center ${pinned ? 'sticky z-40' : 'z-30'} ${columnSelected ? 'is-selected' : ''}`}
                    style={pinned ? { left: pinnedLeft } : undefined}
                  >
                    <button
                      type="button"
                      className="project-sheet__coordinate-button h-full w-full"
                      aria-label={`选择 ${columnLetter(index)} 列`}
                      onClick={() => {
                        if (!pageRows.length) return;
                        const anchor = { row: 0, col: index };
                        const focus = { row: pageRows.length - 1, col: index };
                        setEditing(null);
                        setActive(anchor);
                        setSelection({ anchor, focus });
                      }}
                    >
                      {columnLetter(index)}
                    </button>
                  </th>
                );
              })}
            </tr>}
            <tr className="project-sheet__label-row">
              {showCoordinates && <th className="project-sheet__corner project-sheet__label-corner sticky left-0 z-50 h-9 p-0" />}
              {columns.map(column => {
                const pinnedLeft = pinnedOffsets.get(column.key);
                const pinned = pinnedLeft !== undefined;
                const sortIndex = sortRules.findIndex(rule => rule.key === column.key);
                const sortRule = sortIndex >= 0 ? sortRules[sortIndex] : null;
                return (
                  <th
                    key={column.key}
                    onClick={event => {
                      if (column.type === 'actions') return;
                      const target = event.target;
                      if (target instanceof Element && target.closest('[draggable="true"], .project-sheet__resize-handle')) return;
                      toggleSort(column.key, event.shiftKey);
                    }}
                    onContextMenu={event => openHeaderContextMenu(event, column)}
                    onDragOver={event => handleColumnDragOver(event, column)}
                    onDrop={event => handleColumnDrop(event, column)}
                    className={`project-sheet__column-header relative h-9 px-2 text-left ${
                      pinned ? `sticky z-40 ${column.key === lastPinnedColumnKey ? 'is-frozen' : ''}` : 'z-30'
                    } ${draggedColumnKey === column.key ? 'opacity-50' : ''} ${
                      columnDropTarget?.key === column.key && columnDropTarget.side === 'before'
                        ? 'before:absolute before:inset-y-0 before:left-0 before:z-50 before:w-0.5 before:bg-brand-500'
                        : ''
                    } ${
                      columnDropTarget?.key === column.key && columnDropTarget.side === 'after'
                        ? 'after:absolute after:inset-y-0 after:right-0 after:z-50 after:w-0.5 after:bg-brand-500'
                        : ''
                    }`}
                    style={pinned ? { left: pinnedLeft } : undefined}
                  >
                    <div className="flex min-w-0 items-center gap-1">
                      <div className="flex min-w-0 flex-1 items-center gap-1">
                        <div className="project-sheet__column-label truncate text-[13px] font-semibold">{column.label}</div>
                        {pinned && <Pin size={10} className="shrink-0 text-slate-400" aria-label="已锁定" />}
                        {sortRule && (
                          <span className="inline-flex shrink-0 items-center gap-0.5 text-primary-600" title={`第 ${sortIndex + 1} 排序：${sortRule.direction === 'asc' ? '升序' : '降序'}`}>
                            <span>{sortIndex + 1}</span>
                            {sortRule.direction === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />}
                          </span>
                        )}
                      </div>
                      {column.type !== 'actions' && (
                        <span
                          draggable
                          onClick={event => event.stopPropagation()}
                          onDragStart={event => handleColumnDragStart(event, column)}
                          onDragEnd={clearColumnDrag}
                          className="flex h-8 w-5 shrink-0 cursor-grab items-center justify-center text-slate-300 hover:text-slate-500 active:cursor-grabbing"
                          title="拖拽调整列顺序"
                          aria-label={`拖拽调整${column.label}列顺序`}
                        >
                          <GripVertical size={14} />
                        </span>
                      )}
                    </div>
                    <div
                      onMouseDown={event => startResize(event, column)}
                      className="project-sheet__resize-handle absolute inset-y-0 right-0 w-1 cursor-col-resize"
                    />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((product, rowIndex) => {
              const selected = selectedIds.includes(product.id);
              return (
                <tr key={product.id} className={`project-sheet__row ${selected ? 'is-selected' : ''}`}>
                  {showCoordinates && <th className={`project-sheet__row-header sticky left-0 z-20 h-10 p-0 text-center ${selected ? 'is-selected' : ''}`}>
                    <button
                      type="button"
                      className="project-sheet__row-number h-full w-full text-[11px] font-medium tabular-nums"
                      aria-label={`选择第 ${pageStart + rowIndex + 1} 行`}
                      onClick={event => {
                        const lastColumn = Math.max(0, columns.length - 1);
                        setEditing(null);
                        setActive({ row: rowIndex, col: 0 });
                        setSelection({ anchor: { row: rowIndex, col: 0 }, focus: { row: rowIndex, col: lastColumn } });
                        if (event.shiftKey && rowSelectionAnchorRef.current !== null) {
                          const start = Math.min(rowSelectionAnchorRef.current, rowIndex);
                          const end = Math.max(rowSelectionAnchorRef.current, rowIndex);
                          onSetSelectedRows(pageRows.slice(start, end + 1).map(row => row.id));
                        } else if (event.ctrlKey || event.metaKey) {
                          onToggleSelect(product.id);
                          rowSelectionAnchorRef.current = rowIndex;
                        } else {
                          onSetSelectedRows([product.id]);
                          rowSelectionAnchorRef.current = rowIndex;
                        }
                      }}
                    >
                      {pageStart + rowIndex + 1}
                    </button>
                  </th>}
                  {columns.map((column, colIndex) => {
                    const value = fieldValue(product, column);
                    const cellFormat = cellFormats[formatKey(product.id, column.key)] || {};
                    const isActive = active?.row === rowIndex && active?.col === colIndex;
                    const isEditing = editing?.row === rowIndex && editing?.col === colIndex;
                    const pinnedLeft = pinnedOffsets.get(column.key);
                    const pinned = pinnedLeft !== undefined;
                    const hasFunctionIndicator = column.type === 'select' || column.type === 'date';
                    const locked = cellLock(product.id, column.key);
                    const remoteCursor = [...remoteCursors.values()].find(cursor => (
                      cursor.userId !== collaborationUserId
                      && cursor.recordId === product.id
                      && (cursor.field ? cursor.field === column.key : cursor.col === colIndex)
                    ));
                    const isInRange = Boolean(selectionBounds
                      && rowIndex >= selectionBounds.top && rowIndex <= selectionBounds.bottom
                      && colIndex >= selectionBounds.left && colIndex <= selectionBounds.right);
                    const isRangeTop = isInRange && rowIndex === selectionBounds?.top;
                    const isRangeBottom = isInRange && rowIndex === selectionBounds?.bottom;
                    const isRangeLeft = isInRange && colIndex === selectionBounds?.left;
                    const isRangeRight = isInRange && colIndex === selectionBounds?.right;

                    return (
                      <td
                        key={column.key}
                        data-sheet-row={rowIndex}
                        data-sheet-field={column.key}
                        ref={element => { cellRefs.current[`${rowIndex}-${colIndex}`] = element; }}
                        tabIndex={0}
                        onFocus={() => {
                          if (selectingRef.current) return;
                          const position = { row: rowIndex, col: colIndex };
                          setActive(position);
                          if (!selectionBounds || !isInRange) setSelection({ anchor: position, focus: position });
                        }}
                        onMouseDown={event => {
                          if (event.button !== 0) return;
                          // Keep native pointer behavior inside the active
                          // editor so a click repositions the text caret.
                          if (isEditing) return;
                          event.preventDefault();
                          selectingRef.current = true;
                          selectionPointerRef.current = { x: event.clientX, y: event.clientY };
                          startSelectionAutoScroll();
                          const position = { row: rowIndex, col: colIndex };
                          setActive(position);
                          setSelection(current => event.shiftKey && current
                            ? { ...current, focus: position }
                            : { anchor: position, focus: position });
                          event.currentTarget.focus();
                        }}
                        onMouseEnter={() => {
                          if (!selectingRef.current) return;
                          const position = { row: rowIndex, col: colIndex };
                          setActive(position);
                          setSelection(current => current ? { ...current, focus: position } : { anchor: position, focus: position });
                        }}
                        onDoubleClick={event => {
                          if (isEditing) return;
                          event.preventDefault();
                          event.stopPropagation();
                          void beginEdit(rowIndex, colIndex);
                        }}
                        onContextMenu={event => openContextMenu(event, rowIndex, colIndex)}
                        onKeyDown={event => handleCellKeyDown(event, rowIndex, colIndex)}
                        className={`project-sheet__cell relative h-10 select-none overflow-hidden p-0 text-[13px] outline-none ${
                          pinned ? `sticky z-10 ${column.key === lastPinnedColumnKey ? 'is-frozen' : ''}` : ''
                        } ${selected ? 'is-selected-row' : ''} ${remoteCursor ? 'is-remote-cursor' : ''} ${locked ? 'is-remote-locked' : ''} ${isInRange ? 'is-range-selected' : ''} ${isRangeTop ? 'is-range-top' : ''} ${isRangeBottom ? 'is-range-bottom' : ''} ${isRangeLeft ? 'is-range-left' : ''} ${isRangeRight ? 'is-range-right' : ''} ${isActive ? `is-active ${pinned ? 'z-30' : 'z-20'}` : ''} ${
                          isEditable(column) ? 'is-editable cursor-cell' : 'is-readonly'
                        }`}
                        style={{
                          ...(pinned ? { left: pinnedLeft } : {}),
                          ...(remoteCursor || locked ? { '--project-remote-color': remoteCursor?.color || locked?.color } as CSSProperties : {}),
                          fontWeight: cellFormat.bold ? 700 : undefined,
                          fontStyle: cellFormat.italic ? 'italic' : undefined,
                          textDecoration: cellFormat.underline ? 'underline' : undefined,
                          verticalAlign: cellFormat.verticalAlign || undefined,
                          fontSize: `${sheetTypography.fontSize}px`,
                          fontFamily: FONT_FAMILIES[sheetTypography.fontFamily],
                          ...({
                            '--project-cell-font-family': FONT_FAMILIES[sheetTypography.fontFamily] || 'var(--font-family-ui)',
                            '--project-cell-font-style': cellFormat.italic ? 'italic' : 'normal',
                            '--project-cell-font-weight': cellFormat.bold ? 700 : 'inherit',
                            '--project-cell-text-decoration': cellFormat.underline ? 'underline' : 'none',
                          } as CSSProperties),
                          color: cellFormat.textColor || undefined,
                          backgroundColor: cellFormat.fillColor || undefined,
                          ...((cellFormat.borderTop || cellFormat.borderStyle === 'all') ? { borderTop: `${cellFormat.borderWidth || 1}px ${cellFormat.borderLineStyle || 'solid'} ${cellFormat.borderColor || '#94a3b8'}` } : {}),
                          ...((cellFormat.borderRight || cellFormat.borderStyle === 'all') ? { borderRight: `${cellFormat.borderWidth || 1}px ${cellFormat.borderLineStyle || 'solid'} ${cellFormat.borderColor || '#94a3b8'}` } : {}),
                          ...((cellFormat.borderBottom || cellFormat.borderStyle === 'all' || cellFormat.borderStyle === 'bottom') ? { borderBottom: `${cellFormat.borderWidth || 1}px ${cellFormat.borderLineStyle || 'solid'} ${cellFormat.borderColor || '#94a3b8'}` } : {}),
                          ...((cellFormat.borderLeft || cellFormat.borderStyle === 'all') ? { borderLeft: `${cellFormat.borderWidth || 1}px ${cellFormat.borderLineStyle || 'solid'} ${cellFormat.borderColor || '#94a3b8'}` } : {}),
                        }}
                        title={locked ? `“${locked.displayName}”正在编辑${column.label}` : undefined}
                      >
                        {isEditing ? renderEditor(column) : column.type === 'actions' ? (
                          <div className="flex h-full items-center justify-center">
                            <button
                              type="button"
                              onClick={event => {
                                event.stopPropagation();
                                onDelete(product.id);
                              }}
                              className="project-sheet__delete flex h-7 w-7 items-center justify-center"
                              title="删除项目"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ) : column.key === 'status' && value ? (
                          <div className={`project-sheet__status flex min-h-10 items-center gap-1.5 px-2 py-2 ${cellFormat.horizontalAlign === 'center' ? 'justify-center text-center' : cellFormat.horizontalAlign === 'right' ? 'justify-end text-right' : ''} ${isActive && hasFunctionIndicator ? 'pr-9' : ''}`}>
                            <span className="project-sheet__status-dot h-1.5 w-1.5 shrink-0" />
                            <span className="min-w-0 whitespace-normal break-words font-medium leading-5">{String(value)}</span>
                          </div>
                        ) : (
                          <div className={`project-sheet__value min-h-10 px-2 py-2 leading-5 ${cellFormat.wrap === false ? 'truncate whitespace-nowrap' : 'whitespace-pre-wrap break-words'} ${isActive && hasFunctionIndicator ? 'pr-9' : ''} ${value === '' ? 'is-empty' : ''} ${column.type === 'number' || column.type === 'readonly' ? 'is-numeric tabular-nums' : ''} ${cellFormat.horizontalAlign === 'center' ? 'text-center' : cellFormat.horizontalAlign === 'right' ? 'text-right' : cellFormat.horizontalAlign === 'left' ? 'text-left' : column.type === 'number' || column.type === 'readonly' ? 'text-right' : 'text-left'}`}>
                            {displayValue(value, column, cellFormat) || '—'}
                          </div>
                        )}
                        {isActive && !isEditing && hasFunctionIndicator && (
                          <button
                            type="button"
                            data-sheet-function={column.type}
                            onMouseDown={event => {
                              event.preventDefault();
                              event.stopPropagation();
                            }}
                            onClick={event => {
                              event.preventDefault();
                              event.stopPropagation();
                              beginEdit(rowIndex, colIndex);
                            }}
                            className="absolute right-1 top-1/2 z-30 flex h-6 w-6 -translate-y-1/2 items-center justify-center bg-white text-primary-600 hover:bg-primary-50"
                            aria-label={column.type === 'select' ? `打开${column.label}下拉选项` : `打开${column.label}日期选择`}
                            title={column.type === 'select' ? '打开下拉选项' : '打开日期选择'}
                          >
                            {column.type === 'select' ? <ChevronDown size={14} /> : <CalendarDays size={14} />}
                          </button>
                        )}
                        {remoteCursor && (
                          <span className="project-sheet__remote-label pointer-events-none absolute right-0 top-0 z-40 max-w-24 truncate px-1 text-[9px] leading-4 text-white">
                            {remoteCursor.displayName}
                          </span>
                        )}
                        {isRangeBottom && isRangeRight && isEditable(column) && (
                          <span
                            role="button"
                            aria-label="拖拽填充选区"
                            title="拖拽填充"
                            className="project-sheet__fill-handle absolute -bottom-1 -right-1 z-50 h-2.5 w-2.5 cursor-crosshair"
                            onPointerDown={event => {
                              event.preventDefault();
                              event.stopPropagation();
                              if (!selectionBounds) return;
                              event.currentTarget.setPointerCapture(event.pointerId);
                              fillDragRef.current = { source: { ...selectionBounds }, target: { row: rowIndex, col: colIndex } };
                            }}
                            onPointerMove={event => {
                              const drag = fillDragRef.current;
                              if (!drag) return;
                              const element = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-sheet-row][data-sheet-field]');
                              if (!element) return;
                              const targetRow = Number(element.dataset.sheetRow);
                              const targetCol = columns.findIndex(item => item.key === element.dataset.sheetField);
                              if (!Number.isInteger(targetRow) || targetCol < 0) return;
                              const verticalDistance = Math.max(0, targetRow - drag.source.bottom);
                              const horizontalDistance = Math.max(0, targetCol - drag.source.right);
                              const target = verticalDistance >= horizontalDistance
                                ? { row: Math.max(drag.source.bottom, targetRow), col: drag.source.right }
                                : { row: drag.source.bottom, col: Math.max(drag.source.right, targetCol) };
                              drag.target = target;
                              setSelection(current => current ? { ...current, focus: target } : current);
                            }}
                            onPointerUp={event => {
                              event.preventDefault();
                              event.stopPropagation();
                              completeFillDrag();
                            }}
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>

        {pageRows.length === 0 && (
          <div className="project-sheet__empty flex min-h-80 items-center justify-center text-sm">
            暂无符合条件的项目
          </div>
        )}
      </div>

      {headerContextMenu && headerContextColumn && createPortal(
        <div
          role="menu"
          data-project-sheet-header-context-menu
          className="project-sheet-context-menu fixed z-[100000] w-52 py-1"
          style={{ left: headerContextMenu.x, top: headerContextMenu.y }}
        >
          <div className="border-b border-slate-100 px-3 py-2">
            <div className="truncate text-xs font-semibold text-slate-900">{headerContextColumn.label}</div>
            <div className="mt-0.5 text-[10px] text-slate-400">列标题操作</div>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => runHeaderContextAction(() => showFilterMenu(
              headerContextColumn,
              headerContextMenu.x,
              headerContextMenu.y,
            ))}
            className={contextMenuButtonClass}
          >
            <Filter size={14} className="text-primary-600" />
            {filterIsActive(columnFilters[headerContextColumn.key]) ? '修改此列筛选' : '筛选此列'}
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!filterIsActive(columnFilters[headerContextColumn.key])}
            onClick={() => runHeaderContextAction(() => clearColumnFilter(headerContextColumn.key))}
            className={contextMenuButtonClass}
          >
            <X size={14} />
            清除此列筛选
          </button>
          <div className="my-1 border-t border-slate-200" />
          <button
            type="button"
            role="menuitem"
            onClick={() => runHeaderContextAction(() => togglePinnedColumn(headerContextColumn.key))}
            className={contextMenuButtonClass}
          >
            {pinnedColumnKeys.includes(headerContextColumn.key)
              ? <PinOff size={14} className="text-amber-600" />
              : <Pin size={14} className="text-primary-600" />}
            {pinnedColumnKeys.includes(headerContextColumn.key) ? '取消锁定此列' : '锁定此列'}
          </button>
          <div className="my-1 border-t border-slate-200" />
          <button
            type="button"
            role="menuitem"
            disabled={headerContextColumnIndex <= 0}
            onClick={() => runHeaderContextAction(() => moveColumn(headerContextColumn.key, -1))}
            className={contextMenuButtonClass}
          >
            <ArrowLeft size={14} />
            向左移动
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={headerContextColumnIndex < 0 || headerContextColumnIndex >= movableColumnCount - 1}
            onClick={() => runHeaderContextAction(() => moveColumn(headerContextColumn.key, 1))}
            className={contextMenuButtonClass}
          >
            <ArrowRight size={14} />
            向右移动
          </button>
          <div className="my-1 border-t border-slate-200" />
          <button
            type="button"
            role="menuitem"
            disabled={personalColumnOrder.length === 0}
            onClick={() => runHeaderContextAction(applyPersonalOrderToSource)}
            className={contextMenuButtonClass}
            title="把当前个人列顺序设为所有用户看到的原表结构"
          >
            <Save size={14} className="text-primary-600" />
            应用为原表结构
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={personalColumnOrder.length === 0}
            onClick={() => runHeaderContextAction(resetPersonalColumnOrder)}
            className={contextMenuButtonClass}
          >
            <RotateCcw size={14} />
            恢复原表列顺序
          </button>
          <div className="my-1 border-t border-slate-200" />
          <button
            type="button"
            role="menuitem"
            onClick={() => runHeaderContextAction(() => resetColumnWidth(headerContextColumn.key))}
            className={contextMenuButtonClass}
          >
            <RotateCcw size={14} />
            恢复默认列宽
          </button>
        </div>,
        document.body,
      )}

      {filterMenu && filterColumn && filterDraft && createPortal(
        <div
          data-project-sheet-filter-menu
          className="project-sheet-filter-menu fixed z-[100000] w-72 border border-slate-200 bg-white shadow-2xl"
          style={{ left: filterMenu.x, top: filterMenu.y }}
        >
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-3 py-2.5">
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold text-slate-900">筛选：{filterColumn.label}</div>
              <div className="mt-0.5 text-[10px] text-slate-400">
                {filterDraft.kind === 'range'
                  ? filterColumn.type === 'date' ? '设置日期范围，包含起止日期' : '设置数值范围，包含边界值'
                  : '输入关键词或勾选需要保留的值'}
              </div>
            </div>
            <button type="button" onClick={closeFilterMenu} className="p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
              <X size={14} />
            </button>
          </div>

          {filterDraft.kind === 'range' ? (
            <div className="space-y-3 p-3">
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-slate-600">
                  {filterColumn.type === 'date' ? '开始日期' : '最小值'}
                </span>
                <input
                  type={filterColumn.type === 'date' ? 'date' : 'number'}
                  value={filterDraft.min}
                  onChange={event => setFilterDraft({ ...filterDraft, min: event.target.value })}
                  className="h-9 w-full border border-slate-200 bg-white px-2.5 text-xs text-slate-800 outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-slate-600">
                  {filterColumn.type === 'date' ? '结束日期' : '最大值'}
                </span>
                <input
                  type={filterColumn.type === 'date' ? 'date' : 'number'}
                  value={filterDraft.max}
                  onChange={event => setFilterDraft({ ...filterDraft, max: event.target.value })}
                  className="h-9 w-full border border-slate-200 bg-white px-2.5 text-xs text-slate-800 outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
                />
              </label>
            </div>
          ) : (
            <>
              <div className="p-3 pb-2">
                <label className="relative block">
                  <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={filterDraft.query}
                    onChange={event => setFilterDraft({ ...filterDraft, query: event.target.value })}
                    placeholder="搜索值..."
                    className="h-9 w-full border border-slate-200 bg-white pl-8 pr-2.5 text-xs text-slate-800 outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
                    autoFocus
                  />
                </label>
                <div className="mt-2 flex items-center justify-between text-[11px]">
                  <button
                    type="button"
                    onClick={() => setFilterDraft({ ...filterDraft, values: null })}
                    className="font-medium text-primary-700 hover:text-primary-900"
                  >
                    全选
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterDraft({ ...filterDraft, values: [] })}
                    className="font-medium text-slate-500 hover:text-slate-800"
                  >
                    清空选择
                  </button>
                </div>
              </div>
              <div className="max-h-56 overflow-y-auto border-y border-slate-100 py-1">
                {visibleFilterValues.length > 0 ? visibleFilterValues.map(value => {
                  const checked = filterDraft.values === null || filterDraft.values.includes(value);
                  return (
                    <button
                      key={value || '__blank__'}
                      type="button"
                      onClick={() => toggleDraftValue(value)}
                      className="flex min-h-8 w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
                    >
                      <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center border ${
                        checked ? 'border-primary-600 bg-primary-600 text-white' : 'border-slate-300 bg-white text-transparent'
                      }`}>
                        <Check size={10} strokeWidth={3} />
                      </span>
                      <span className={`min-w-0 flex-1 truncate ${value ? '' : 'italic text-slate-400'}`}>
                        {value || '（空白）'}
                      </span>
                    </button>
                  );
                }) : (
                  <div className="px-3 py-8 text-center text-xs text-slate-400">没有匹配的值</div>
                )}
              </div>
            </>
          )}

          <div className="flex items-center justify-between gap-3 bg-slate-50 px-3 py-2.5">
            <button
              type="button"
              onClick={() => clearColumnFilter(filterColumn.key)}
              disabled={!filterIsActive(columnFilters[filterColumn.key])}
              className="text-xs font-medium text-slate-500 hover:text-slate-800 disabled:cursor-not-allowed disabled:text-slate-300"
            >
              清除此列
            </button>
            <div className="flex items-center gap-2">
              <button type="button" onClick={closeFilterMenu} className="h-8 border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 hover:bg-slate-100">
                取消
              </button>
              <button type="button" onClick={applyFilterDraft} className="h-8 bg-primary-600 px-3 text-xs font-medium text-white hover:bg-primary-700">
                应用筛选
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {contextMenu && contextProduct && contextColumn && createPortal(
        <div
          role="menu"
          data-project-sheet-context-menu
          className="project-sheet-context-menu fixed z-[100000] w-52 py-1"
          style={{
            left: Math.max(8, Math.min(contextMenu.x, window.innerWidth - 216)),
            top: Math.max(8, Math.min(contextMenu.y, window.innerHeight - 560)),
            maxHeight: 'calc(100dvh - 16px)',
            overflowY: 'auto',
            overscrollBehavior: 'contain',
          }}
        >
          {contextEditable && (
            <button type="button" role="menuitem" onClick={() => runContextAction(() => beginEdit(contextMenu.row, contextMenu.col))} className={contextMenuButtonClass}>
              <Pencil size={14} className="text-primary-600" />编辑单元格
              {showShortcutHints && <span className="ml-auto text-[10px] text-slate-400">F2</span>}
            </button>
          )}
          {contextColumn.type !== 'actions' && (
            <button type="button" role="menuitem" onClick={() => runContextAction(() => copyCell(contextMenu.row, contextMenu.col))} className={contextMenuButtonClass}>
              <Copy size={14} />复制
              {showShortcutHints && <span className="ml-auto text-[10px] text-slate-400">Ctrl+C</span>}
            </button>
          )}
          {contextEditable && (
            <>
              <button type="button" role="menuitem" onClick={() => runContextAction(() => copyCell(contextMenu.row, contextMenu.col, true))} className={contextMenuButtonClass}>
                <Scissors size={14} />剪切
                {showShortcutHints && <span className="ml-auto text-[10px] text-slate-400">Ctrl+X</span>}
              </button>
              <button type="button" role="menuitem" onClick={() => runContextAction(() => pasteCell(contextMenu.row, contextMenu.col))} className={contextMenuButtonClass}>
                <ClipboardPaste size={14} />粘贴
                {showShortcutHints && <span className="ml-auto text-[10px] text-slate-400">Ctrl+V</span>}
              </button>
              <button type="button" role="menuitem" onClick={() => runContextAction(clearSelected)} className={contextMenuButtonClass}>
                <Eraser size={14} />清空内容
                {showShortcutHints && <span className="ml-auto text-[10px] text-slate-400">Delete</span>}
              </button>
              <div className="my-1 border-t border-slate-200" />
              <button
                type="button"
                role="menuitem"
                disabled={(selectionBounds?.top ?? contextMenu.row) === 0 && (selectionBounds?.bottom ?? contextMenu.row) === (selectionBounds?.top ?? contextMenu.row)}
                onClick={() => runContextAction(() => fillSelected('down'))}
                className={contextMenuButtonClass}
              >
                <ArrowDownToLine size={14} />从上方填充
                {showShortcutHints && <span className="ml-auto text-[10px] text-slate-400">Ctrl+D</span>}
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={(selectionBounds?.left ?? contextMenu.col) === 0 && (selectionBounds?.right ?? contextMenu.col) === (selectionBounds?.left ?? contextMenu.col)}
                onClick={() => runContextAction(() => fillSelected('right'))}
                className={contextMenuButtonClass}
              >
                <ArrowRightToLine size={14} />从左侧填充
                {showShortcutHints && <span className="ml-auto text-[10px] text-slate-400">Ctrl+R</span>}
              </button>
            </>
          )}
          {projectRowActionsEnabled && <><div className="my-1 border-t border-slate-200" />
          <button type="button" role="menuitem" disabled={!contextNextStatus} onClick={() => contextNextStatus && runContextAction(() => onAdvance(contextProduct, contextNextStatus))} className={contextMenuButtonClass}>
            <ArrowRight size={14} />推进到下一阶段
          </button></>}
          {projectRowActionsEnabled && <button type="button" role="menuitem" disabled={!contextPreviousStatus} onClick={() => contextPreviousStatus && runContextAction(() => onRetreat(contextProduct, contextPreviousStatus))} className={contextMenuButtonClass}>
            <ArrowLeft size={14} />返回上一阶段
          </button>}
          <div className="my-1 border-t border-slate-200" />
          <button type="button" role="menuitem" onClick={() => runContextAction(() => onToggleSelect(contextProduct.id))} className={contextMenuButtonClass}>
            <Check size={14} />
            {selectedIds.includes(contextProduct.id) ? '取消选择此行' : '选择此行'}
          </button>
          <button type="button" role="menuitem" onClick={() => runContextAction(() => { void copyWholeRow(contextProduct); })} className={contextMenuButtonClass}>
            <Copy size={14} />复制整行数据
          </button>
          {projectRowActionsEnabled && <button type="button" role="menuitem" onClick={() => runContextAction(() => { void onDuplicateRow(contextProduct); })} className={contextMenuButtonClass}>
            <Plus size={14} />复制为新项目
          </button>}
          {projectRowActionsEnabled && <button
            type="button"
            role="menuitem"
            onClick={() => runContextAction(() => onDelete(contextProduct.id))}
            className={`${contextMenuButtonClass} text-red-600 hover:bg-red-50`}
          >
            <Trash2 size={14} />删除此行
          </button>}
        </div>,
        document.body,
      )}

      <AppModal
        open={transactionPanel}
        onClose={() => setTransactionPanel(false)}
        size="lg"
        title="表格事务历史"
        subtitle="每次粘贴、填充、清空或编辑作为一个完整事务保存。"
      >
        <div className="max-h-[520px] space-y-2 overflow-auto">
          {transactions.length === 0 && <div className="py-16 text-center text-sm text-slate-400">暂无事务记录</div>}
          {transactions.map(transaction => (
            <details key={transaction.id} className="border border-slate-200 bg-white">
              <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3">
                <span className={`h-2 w-2 shrink-0 rounded-full ${transaction.status === 'applied' ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-slate-800">{transaction.label}</span><span className="mt-0.5 block text-[11px] text-slate-400">{new Date(transaction.createdAt).toLocaleString('zh-CN')} · {transaction.createdByName} · {transaction.changeCount} 项</span></span>
                <span className="text-[11px] text-slate-500">{transaction.status === 'applied' ? '已应用' : transaction.status === 'undone' ? '已撤销' : '分支已失效'}</span>
                {transaction.status !== 'superseded' && <button type="button" disabled={transactionBusy} onClick={event => { event.preventDefault(); void replayPersistedTransaction(transaction, transaction.status === 'applied' ? 'undo' : 'redo'); }} className="h-7 border border-slate-200 px-2 text-xs text-primary-700 hover:bg-primary-50 disabled:opacity-40">{transaction.status === 'applied' ? '撤销' : '重做'}</button>}
              </summary>
              <div className="border-t border-slate-100 px-4 py-2">
                {transaction.changes.slice(0, 200).map((change, index) => (
                  <div key={`${change.id}-${change.field}-${index}`} className="grid grid-cols-[minmax(100px,1fr)_minmax(80px,140px)_minmax(0,1fr)_20px_minmax(0,1fr)] gap-2 border-b border-slate-50 py-1.5 text-[11px] last:border-0">
                    <span className="truncate text-slate-500" title={change.id}>{data.find(item => item.id === change.id)?.productName || change.id}</span><span className="truncate text-slate-600">{columns.find(item => (item.dynamic ? `dynamicFields.${item.key}` : item.key) === change.field)?.label || change.field}</span><span className="truncate text-slate-500" title={String(change.before)}>{String(change.before) || '（空白）'}</span><span className="text-center text-slate-300">→</span><span className="truncate text-slate-800" title={String(change.after)}>{String(change.after) || '（空白）'}</span>
                  </div>
                ))}
              </div>
            </details>
          ))}
        </div>
      </AppModal>

      <AppModal
        open={pendingPaste !== null}
        onClose={() => setPendingPaste(null)}
        size="lg"
        title="粘贴内容需要检查"
        subtitle={`发现 ${pendingPaste?.errors.length || 0} 个无法应用的单元格，整批数据尚未保存。`}
        footer={(
          <div className="flex w-full items-center justify-end gap-2">
            <button type="button" onClick={() => setPendingPaste(null)} className="h-9 border border-slate-200 bg-white px-4 text-sm text-slate-600 hover:bg-slate-50">
              取消粘贴
            </button>
            <button
              type="button"
              disabled={!pendingPaste?.changes.length}
              onClick={() => {
                const validChanges = pendingPaste?.changes || [];
                setPendingPaste(null);
                void applyTransaction(validChanges);
              }}
              className="h-9 bg-primary-600 px-4 text-sm font-medium text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              仅应用合法项（{pendingPaste?.changes.length || 0}）
            </button>
          </div>
        )}
      >
        <div className="max-h-[420px] overflow-auto border border-slate-200">
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
              <tr><th className="px-3 py-2">位置</th><th className="px-3 py-2">字段</th><th className="px-3 py-2">粘贴值</th><th className="px-3 py-2">问题</th></tr>
            </thead>
            <tbody>
              {pendingPaste?.errors.map((error, index) => (
                <tr key={`${error.cell}-${index}`} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium text-slate-700">{error.cell}</td>
                  <td className="px-3 py-2 text-slate-600">{error.field}</td>
                  <td className="max-w-56 truncate px-3 py-2 text-slate-700" title={String(error.value)}>{String(error.value) || '（空白）'}</td>
                  <td className="px-3 py-2 text-red-600">{error.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </AppModal>

    </section>
  );
}

