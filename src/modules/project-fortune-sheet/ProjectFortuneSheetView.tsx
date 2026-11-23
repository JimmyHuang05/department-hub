import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Workbook, type WorkbookInstance } from '@fortune-sheet/react';
import '@fortune-sheet/react/dist/index.css';
import './ProjectFortuneSheetView.css';
import type { Cell, CellWithRowAndCol, Sheet } from '@fortune-sheet/core';
import type { CustomColumn, InvestmentProduct } from '../../types';
import { broadcastCursor, broadcastEditingStart, broadcastEditingStop } from '../../hooks/useCollaboration';
import { useCollaborationStore } from '../../store/collaborationStore';
import { useShallow } from 'zustand/react/shallow';
import { useSaveStatusStore } from '../../store/saveStatusStore';
import { Clipboard, Copy, Eraser, Pin, PinOff, Trash2 } from 'lucide-react';
import ContextMenu, { type ContextMenuItem } from '../../components/Layout/ContextMenu';

export interface ProjectFortuneSheetViewProps {
  data: InvestmentProduct[];
  customColumns: CustomColumn[];
  statusOptions: string[];
  managerOptions: string[];
  bankOptions: string[];
  frozenColumn: number | null;
  onFrozenColumnChange: (column: number | null) => void;
  onCellEdit: (id: string, field: string, value: string | number) => boolean;
  onCreateRow: (field: string, value: string | number) => Promise<boolean>;
  onDeleteRow: (product: InvestmentProduct) => void;
}

type ProjectColumn = {
  key: string;
  label: string;
  width?: number;
  numeric?: boolean;
  date?: boolean;
  options?: string[];
  value: (product: InvestmentProduct, index: number) => string | number;
};

const BASE_COLUMNS: Array<{ field: keyof InvestmentProduct; label: string; width?: number; numeric?: boolean }> = [
  { field: 'productName', label: '项目名称', width: 220 },
  { field: 'usd', label: '美元规模（万美元）', numeric: true },
  { field: 'rmb', label: '人民币规模（万元）', numeric: true },
  { field: 'feeRate', label: '费率', numeric: true },
  { field: 'target', label: '标的', width: 180 },
  { field: 'client', label: '委托人', width: 180 },
  { field: 'brokerChannel', label: '券商渠道', width: 160 },
  { field: 'strategy', label: '投资策略', width: 180 },
  { field: 'custodianBank', label: '托管行' },
  { field: 'annualIncome', label: '年化收入（万元）', numeric: true },
  { field: 'thisYearIncome', label: '今年收入（万元）', numeric: true },
  { field: 'performanceIncome', label: '绩效收入（万元）', numeric: true },
  { field: 'status', label: '项目进度' },
  { field: 'trustManager', label: 'A角' },
  { field: 'trustManagerB', label: 'B角' },
  { field: 'deadline', label: '截止日' },
  { field: 'projectCreatedDate', label: '项目创建日' },
  { field: 'establishDate', label: '成立/落地日' },
  { field: 'projectStoppedDate', label: '项目中止日' },
  { field: 'tradingBroker', label: '交易券商' },
  { field: 'remarks', label: '备注', width: 240 },
];

const displayValue = (value: unknown): string | number => {
  if (value === null || value === undefined) return '';
  return typeof value === 'number' && Number.isFinite(value) ? value : String(value);
};

export default function ProjectFortuneSheetView({ data, customColumns, statusOptions, managerOptions, bankOptions, frozenColumn, onFrozenColumnChange, onCellEdit, onCreateRow, onDeleteRow }: ProjectFortuneSheetViewProps) {
  const workbookRef = useRef<WorkbookInstance | null>(null);
  const creatingRowRef = useRef(false);
  const lastCommittedCellRef = useRef('');
  const workbookChangeTimerRef = useRef<number | null>(null);
  const [selectedColumn, setSelectedColumn] = useState(0);
  const [selectedRow, setSelectedRow] = useState(1);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const initializedSheetsRef = useRef(false);
  const previousPresenceUsersRef = useRef<Array<{ username: string; userId?: string }>>([]);
  const selectedEditingRef = useRef<{
    recordType: string;
    recordId: string;
    recordLabel: string;
    field: string;
    fieldLabel: string;
    location: string;
  } | null>(null);
  const { userId, remoteCursors, activeEditors } = useCollaborationStore(useShallow(state => ({
    userId: state.userId,
    remoteCursors: state.remoteCursors,
    activeEditors: state.activeEditors,
  })));
  const saveStatus = useSaveStatusStore(state => state.status);
  const columns = useMemo<ProjectColumn[]>(() => [
    { key: '__rowNumber', label: '序号', width: 64, numeric: true, value: (_product, index) => index + 1 },
    ...BASE_COLUMNS.map(column => ({
      key: String(column.field),
      label: column.label,
      width: column.width,
      numeric: column.numeric,
      date: ['deadline', 'projectCreatedDate', 'establishDate', 'projectStoppedDate'].includes(String(column.field)),
      options: column.field === 'status'
        ? statusOptions
        : column.field === 'trustManager' || column.field === 'trustManagerB'
          ? managerOptions
          : column.field === 'custodianBank'
            ? bankOptions
            : undefined,
      value: (product: InvestmentProduct) => displayValue(product[column.field]),
    })),
    ...customColumns.map(column => ({
      key: column.key,
      label: column.title,
      width: column.width,
      numeric: column.type === 'number',
      date: column.type === 'date',
      value: (product: InvestmentProduct) => displayValue(product.dynamicFields?.[column.key]),
    })),
  ], [bankOptions, customColumns, managerOptions, statusOptions]);

  const sheets = useMemo<Sheet[]>(() => {
    const header = columns.map<Cell>(column => ({
      v: column.label,
      m: column.label,
      bl: 1,
      bg: '#eef2f7',
      fc: '#475569',
      ht: 0,
      vt: 0,
    }));
    const rows = data.map((product, index) => columns.map<Cell>(column => {
      const value = column.value(product, index);
      return { v: value, m: String(value), vt: 0 };
    }));
    const blankRow = columns.map<Cell>((_column, index) => {
      const value = index === 0 ? data.length + 1 : '';
      return { v: value, m: String(value), vt: 0 };
    });
    const matrix = [header, ...rows, blankRow];
    // FortuneSheet 0.13 initializes a workbook from `celldata`; `data` alone is
    // only consumed by its update API and otherwise produces an empty sheet.
    const celldata: CellWithRowAndCol[] = matrix.flatMap((row, rowIndex) => (
      row.map((cell, columnIndex) => ({ r: rowIndex, c: columnIndex, v: cell }))
    ));
    const columnlen = Object.fromEntries(columns.map((column, index) => [index, column.width ?? 140]));

    return [{
      id: 'project-progress-fs',
      name: '项目进度',
      data: matrix,
      celldata,
      config: { rowReadOnly: [0], columnlen },
      frozen: frozenColumn === null
        ? { type: 'row', range: { row_focus: 0, column_focus: 0 } }
        : { type: 'both', range: { row_focus: 0, column_focus: frozenColumn } },
      showGridLines: true,
    }];
  }, [columns, data, frozenColumn]);

  const commitCellEdit = useCallback(async (row: number, column: number, rawCellValue: unknown) => {
    const product = data[row - 1];
    const field = columns[column];
    if (!field || field.key === '__rowNumber') return;
    const rawValue = typeof rawCellValue === 'object' && rawCellValue !== null && 'v' in rawCellValue
      ? (rawCellValue as { v?: unknown }).v
      : rawCellValue;
    const normalized = String(rawValue ?? '').trim();
    const value = field.numeric && normalized !== ''
      ? Number(normalized.replace(/,/g, ''))
      : String(rawValue ?? '');
    if (field.numeric && !Number.isFinite(value)) return;

    const signature = `${row}:${column}:${JSON.stringify(value)}`;
    if (lastCommittedCellRef.current === signature) return;
    lastCommittedCellRef.current = signature;

    if (!product) {
      if (!normalized || creatingRowRef.current) return;
      creatingRowRef.current = true;
      const created = await onCreateRow(field.key, value as string | number).finally(() => {
        creatingRowRef.current = false;
      });
      if (!created) {
        lastCommittedCellRef.current = '';
      }
      // The newly created project can disappear immediately under filters such
      // as "only mine". Clear the stale draft row in either outcome so the
      // workbook's next onChange cannot submit the same draft a second time.
      workbookRef.current?.updateSheet(structuredClone(sheets));
      return;
    }
    const accepted = onCellEdit(product.id, field.key, value as string | number);
    if (!accepted) {
      lastCommittedCellRef.current = '';
      workbookRef.current?.updateSheet(structuredClone(sheets));
    }
  }, [columns, data, onCellEdit, onCreateRow, sheets]);

  const scheduleCellCommit = useCallback((row: number, column: number, rawValue: unknown) => {
    if (workbookChangeTimerRef.current !== null) window.clearTimeout(workbookChangeTimerRef.current);
    const scalarValue = rawValue ?? '';
    workbookChangeTimerRef.current = window.setTimeout(() => {
      workbookChangeTimerRef.current = null;
      void commitCellEdit(row, column, scalarValue);
    }, 120);
  }, [commitCellEdit]);

  const handleWorkbookChange = useCallback((nextSheets: Sheet[]) => {
    const matrix = nextSheets[0]?.data;
    if (!matrix) return;

    for (let row = 1; row < matrix.length; row += 1) {
      const product = data[row - 1];
      for (let column = 1; column < columns.length; column += 1) {
        const cell = matrix[row]?.[column];
        const rawValue = typeof cell === 'object' && cell !== null && 'v' in cell ? cell.v : cell;
        const normalized = String(rawValue ?? '').trim();
        if (!product) {
          if (normalized) {
            scheduleCellCommit(row, column, rawValue);
            return;
          }
          continue;
        }

        const expectedValue = columns[column].value(product, row - 1);
        const isSame = columns[column].numeric
          ? (normalized === '' && String(expectedValue ?? '').trim() === '')
            || Number(normalized.replace(/,/g, '')) === Number(expectedValue)
          : String(rawValue ?? '') === String(expectedValue ?? '');
        if (!isSame) {
          scheduleCellCommit(row, column, rawValue);
          return;
        }
      }
    }
  }, [columns, data, scheduleCellCommit]);

  const hooks = useMemo(() => ({
    beforeUpdateCell: (row: number, column: number, nextValue: unknown) => {
      if (!(row > 0 && column > 0 && column < columns.length)) return false;
      const product = data[row - 1];
      const field = columns[column];
      const occupied = product && [...activeEditors.values()].some(editor => (
        editor.userId !== userId
        && editor.recordType === 'project'
        && editor.recordId === product?.id
        && editor.field === field?.key
      ));
      if (occupied) return false;
      const rawValue = typeof nextValue === 'object' && nextValue !== null && 'v' in nextValue
        ? (nextValue as { v?: unknown }).v
        : nextValue;
      const normalized = String(rawValue ?? '').trim();
      if (!product && !normalized) return false;
      if (field.key === 'productName' && !normalized) return false;
      if (field.numeric && normalized !== '' && !Number.isFinite(Number(normalized.replace(/,/g, '')))) return false;
      if (field.date && normalized !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return false;
      if (field.options && normalized !== '' && !field.options.includes(normalized)) return false;
      return true;
    },
    afterSelectionChange: (_sheetId: string, selection: { row: number[]; column: number[] }) => {
      const row = selection.row[0];
      const column = selection.column[0];
      const product = data[row - 1];
      const field = columns[column];
      setSelectedRow(row);
      setSelectedColumn(column);
      broadcastCursor(product?.id ?? null, column, row);

      if (selectedEditingRef.current) broadcastEditingStop(selectedEditingRef.current);
      if (product && field && field.key !== '__rowNumber') {
        selectedEditingRef.current = {
          recordType: 'project',
          recordId: product.id,
          recordLabel: product.productName,
          field: field.key,
          fieldLabel: field.label,
          location: '项目进度 · 表格',
        };
        broadcastEditingStart(selectedEditingRef.current);
      } else {
        selectedEditingRef.current = null;
      }
    },
  }), [activeEditors, columns, data, userId]);

  useEffect(() => {
    lastCommittedCellRef.current = '';
  }, [data]);

  useEffect(() => () => {
    if (workbookChangeTimerRef.current !== null) window.clearTimeout(workbookChangeTimerRef.current);
  }, []);

  const selectedRange = () => workbookRef.current?.getSelection()?.[0] ?? null;
  const copySelection = async () => {
    const workbook = workbookRef.current;
    const range = selectedRange();
    if (!workbook || !range) return;
    const values = workbook.getCellsByRange(range)
      .map(row => row.map(cell => String(cell?.m ?? cell?.v ?? '')).join('\t'))
      .join('\n');
    await navigator.clipboard.writeText(values);
  };
  const pasteSelection = async () => {
    const workbook = workbookRef.current;
    const range = selectedRange();
    if (!workbook || !range) return;
    const text = await navigator.clipboard.readText();
    if (!text) return;
    const values = text.replace(/\r/g, '').split('\n').map(row => row.split('\t'));
    const startRow = Math.max(1, range.row[0]);
    const startColumn = Math.max(1, range.column[0]);
    workbook.setCellValuesByRange(values, {
      row: [startRow, startRow + values.length - 1],
      column: [startColumn, startColumn + Math.max(...values.map(row => row.length)) - 1],
    });
  };
  const clearSelection = () => {
    const workbook = workbookRef.current;
    const range = selectedRange();
    if (!workbook || !range) return;
    for (let row = Math.max(1, range.row[0]); row <= range.row[1]; row += 1) {
      for (let column = Math.max(1, range.column[0]); column <= range.column[1]; column += 1) {
        workbook.clearCell(row, column);
      }
    }
  };
  const contextMenuItems: ContextMenuItem[] = [
    { key: 'copy', label: '复制', icon: <Copy size={15} />, onSelect: () => { void copySelection(); } },
    { key: 'paste', label: '粘贴', icon: <Clipboard size={15} />, onSelect: () => { void pasteSelection(); } },
    { key: 'clear', label: '清除内容', icon: <Eraser size={15} />, separatorBefore: true, onSelect: clearSelection },
    {
      key: 'pin',
      label: frozenColumn === selectedColumn ? '取消固定列' : '固定到当前列',
      icon: frozenColumn === selectedColumn ? <PinOff size={15} /> : <Pin size={15} />,
      separatorBefore: true,
      onSelect: () => {
        if (frozenColumn === selectedColumn) {
          workbookRef.current?.freeze('row', { row: 0, column: 0 });
          onFrozenColumnChange(null);
        } else {
          const column = Math.min(selectedColumn, columns.length - 1);
          workbookRef.current?.scroll({ scrollLeft: 0 });
          workbookRef.current?.freeze('both', { row: 0, column });
          onFrozenColumnChange(column);
        }
      },
    },
    ...(data[selectedRow - 1] ? [{
      key: 'delete-row',
      label: '删除此行',
      icon: <Trash2 size={15} />,
      danger: true,
      separatorBefore: true,
      onSelect: () => onDeleteRow(data[selectedRow - 1]),
    }] : []),
  ];

  useEffect(() => {
    const workbook = workbookRef.current;
    if (!workbook) return;
    if (!initializedSheetsRef.current) {
      initializedSheetsRef.current = true;
      return;
    }
    const selection = workbook.getSelection();
    workbook.updateSheet(structuredClone(sheets));
    if (selection && selection.length > 0) workbook.setSelection(selection);
  }, [sheets]);

  useEffect(() => {
    if (saveStatus !== 'error') return;
    workbookRef.current?.updateSheet(structuredClone(sheets));
  }, [saveStatus, sheets]);

  useEffect(() => {
    const workbook = workbookRef.current;
    if (!workbook) return;

    if (previousPresenceUsersRef.current.length > 0) {
      workbook.removePresences(previousPresenceUsersRef.current);
    }

    const presences = [...remoteCursors.values()]
      .filter(cursor => cursor.userId !== userId)
      .map(cursor => {
        const productIndex = cursor.recordId ? data.findIndex(product => product.id === cursor.recordId) : -1;
        const rowIndex = cursor.recordId ? (productIndex < 0 ? -1 : productIndex + 1) : cursor.row;
        return {
          sheetId: 'project-progress-fs',
          username: cursor.displayName,
          userId: cursor.userId,
          color: cursor.color,
          selection: { r: rowIndex, c: cursor.col },
        };
      })
      .filter(presence => presence.selection.r >= 0 && presence.selection.c >= 0);

    if (presences.length > 0) workbook.addPresences(presences);
    previousPresenceUsersRef.current = presences.map(({ username, userId: presenceUserId }) => ({ username, userId: presenceUserId }));
  }, [data, remoteCursors, userId]);

  useEffect(() => {
    const heartbeat = window.setInterval(() => {
      if (selectedEditingRef.current) broadcastEditingStart(selectedEditingRef.current);
    }, 20000);
    return () => {
      window.clearInterval(heartbeat);
      broadcastCursor(null, -1, -1);
      if (selectedEditingRef.current) broadcastEditingStop(selectedEditingRef.current);
      selectedEditingRef.current = null;
    };
  }, []);

  return (
    <div
      className="project-fortune-sheet relative flex h-full min-h-[560px] w-full flex-col overflow-hidden bg-white"
      data-testid="project-fortune-sheet"
      onContextMenu={event => {
        event.preventDefault();
        event.stopPropagation();
        setContextMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      <div className="project-fortune-sheet__pin-actions" aria-label="列固定">
        <button
          type="button"
          onClick={() => {
            const column = Math.min(selectedColumn, columns.length - 1);
            workbookRef.current?.freeze('both', { row: 0, column });
            onFrozenColumnChange(column);
          }}
          title={`固定到当前列：${columns[selectedColumn]?.label ?? ''}`}
        >
          <Pin size={14} aria-hidden="true" />
          固定列
        </button>
        {frozenColumn !== null && (
          <button
            type="button"
            className="project-fortune-sheet__unpin"
            onClick={() => {
              workbookRef.current?.freeze('row', { row: 0, column: 0 });
              onFrozenColumnChange(null);
            }}
            title="取消固定列"
            aria-label="取消固定列"
          >
            <PinOff size={14} aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1">
      <Workbook
        ref={workbookRef}
        data={sheets}
        onChange={handleWorkbookChange}
        allowEdit
        showToolbar
        showFormulaBar
        showSheetTabs={false}
        lang="zh"
        defaultRowHeight={34}
        defaultColWidth={140}
        hooks={hooks}
        toolbarItems={[
          'undo', 'redo', '|', 'currency-format', 'percentage-format', 'number-decrease', 'number-increase',
          'format', 'font-size', '|', 'bold', 'italic', 'underline', '|', 'font-color', 'background', 'border',
          '|', 'horizontal-align', 'vertical-align', 'text-wrap', '|', 'filter', 'search',
        ]}
        cellContextMenu={[]}
      />
      </div>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          ariaLabel="表格单元格菜单"
          items={contextMenuItems}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
