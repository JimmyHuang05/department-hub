import type { Cell, CellWithRowAndCol, Sheet } from '@fortune-sheet/core';
import type { CellObject, WorkBook, WorkSheet } from 'xlsx';

const MAX_SHEETS = 64;
const MAX_RANGE_CELLS = 2_000_000;
const MAX_POPULATED_CELLS = 500_000;
const MAX_ROWS = 200_000;
const MAX_COLUMNS = 16_384;

type StyledCell = CellObject & {
  l?: { Target?: string };
  s?: {
    font?: { bold?: boolean; italic?: boolean; color?: { rgb?: string }; sz?: number };
    fill?: { fgColor?: { rgb?: string } };
    alignment?: { horizontal?: string; vertical?: string; wrapText?: boolean };
  };
};

const normalizeColor = (rgb?: string) => {
  if (!rgb) return undefined;
  const value = rgb.replace(/^#/, '');
  return `#${value.length === 8 ? value.slice(2) : value}`;
};

function toFortuneCell(source: StyledCell, date1904: boolean): Cell {
  const display = source.w ?? source.v ?? '';
  const value = source.t === 'd' && source.v instanceof Date
    ? (source.v.getTime() - (date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30))) / 86_400_000
    : source.v ?? '';
  const style = source.s;
  return {
    v: value as Cell['v'],
    m: String(display),
    f: source.f ? (source.f.startsWith('=') ? source.f : `=${source.f}`) : undefined,
    ct: source.z ? { fa: source.z, t: source.t === 'n' ? 'n' : 'g' } : undefined,
    bl: style?.font?.bold ? 1 : undefined,
    it: style?.font?.italic ? 1 : undefined,
    fs: style?.font?.sz,
    fc: normalizeColor(style?.font?.color?.rgb),
    bg: normalizeColor(style?.fill?.fgColor?.rgb),
    ht: style?.alignment?.horizontal === 'center' ? 0 : style?.alignment?.horizontal === 'right' ? 2 : 1,
    vt: style?.alignment?.vertical === 'center' ? 0 : style?.alignment?.vertical === 'bottom' ? 2 : 1,
    tb: style?.alignment?.wrapText ? 2 : undefined,
  } as Cell;
}

function worksheetToSheet(XLSX: typeof import('xlsx'), worksheet: WorkSheet, name: string, index: number, hidden: number, date1904: boolean): Sheet {
  const range = worksheet['!ref'] ? XLSX.utils.decode_range(worksheet['!ref']) : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
  const celldata: CellWithRowAndCol[] = [];
  const hyperlink: NonNullable<Sheet['hyperlink']> = {};
  for (const address of Object.keys(worksheet)) {
    if (address.startsWith('!')) continue;
    const position = XLSX.utils.decode_cell(address);
    const source = worksheet[address] as StyledCell | undefined;
    if (source) {
      celldata.push({ r: position.r, c: position.c, v: toFortuneCell(source, date1904) });
      if (source.l?.Target) {
        hyperlink[`${position.r}_${position.c}`] = {
          linkType: source.l.Target.startsWith('#') ? 'cellrange' : 'webpage',
          linkAddress: source.l.Target,
        };
      }
    }
  }

  const merge = Object.fromEntries((worksheet['!merges'] || []).map(item => {
    const key = `${item.s.r}_${item.s.c}`;
    return [key, { r: item.s.r, c: item.s.c, rs: item.e.r - item.s.r + 1, cs: item.e.c - item.s.c + 1 }];
  }));
  const columnlen = Object.fromEntries((worksheet['!cols'] || []).flatMap((column, columnIndex) => {
    const width = column?.wpx ?? (column?.width ? Math.round(column.width * 7) : 0);
    return width > 0 ? [[columnIndex, width]] : [];
  }));
  const rowlen = Object.fromEntries((worksheet['!rows'] || []).flatMap((row, rowIndex) => {
    const height = row?.hpx ?? (row?.hpt ? Math.round(row.hpt * 96 / 72) : 0);
    return height > 0 ? [[rowIndex, height]] : [];
  }));
  const colhidden = Object.fromEntries((worksheet['!cols'] || []).flatMap((column, index) => column?.hidden ? [[index, 0]] : []));
  const rowhidden = Object.fromEntries((worksheet['!rows'] || []).flatMap((row, index) => row?.hidden ? [[index, 0]] : []));

  return {
    id: `sheet-editor-${index}-${crypto.randomUUID()}`,
    name,
    order: index,
    hide: hidden,
    row: Math.max(range.e.r + 1, 36),
    column: Math.max(range.e.c + 1, 18),
    celldata,
    config: { merge, columnlen, rowlen, colhidden, rowhidden },
    hyperlink,
    showGridLines: true,
  } as Sheet;
}

export async function parseXlsxForFortuneSheet(buffer: ArrayBuffer): Promise<Sheet[]> {
  const XLSX = await import('xlsx');
  const workbook: WorkBook = XLSX.read(buffer, {
    type: 'array',
    cellDates: true,
    cellFormula: true,
    cellStyles: true,
    cellNF: true,
    cellText: true,
  });
  if (!workbook.SheetNames.length) throw new Error('工作簿不包含任何工作表');
  if (workbook.SheetNames.length > MAX_SHEETS) throw new Error('工作表数量不能超过 64 个');
  let rangeCells = 0;
  let populatedCells = 0;
  workbook.SheetNames.forEach(name => {
    const worksheet = workbook.Sheets[name];
    const range = worksheet?.['!ref'] ? XLSX.utils.decode_range(worksheet['!ref']) : null;
    if (range) {
      const rows = range.e.r - range.s.r + 1;
      const columns = range.e.c - range.s.c + 1;
      if (rows > MAX_ROWS || columns > MAX_COLUMNS) throw new Error('工作表行列范围过大');
      rangeCells += rows * columns;
    }
    populatedCells += Object.keys(worksheet || {}).filter(key => !key.startsWith('!')).length;
  });
  if (rangeCells > MAX_RANGE_CELLS) throw new Error('工作簿有效区域不能超过 200 万个单元格');
  if (populatedCells > MAX_POPULATED_CELLS) throw new Error('工作簿实际单元格不能超过 50 万个');
  return workbook.SheetNames.map((name, index) => worksheetToSheet(
    XLSX,
    workbook.Sheets[name],
    name,
    index,
    workbook.Workbook?.Sheets?.[index]?.Hidden || 0,
    Boolean(workbook.Workbook?.WBProps?.date1904),
  ));
}
