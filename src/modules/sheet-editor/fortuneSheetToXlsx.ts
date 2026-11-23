import type { Cell, Sheet } from '@fortune-sheet/core';
import type { WorkSheet } from 'xlsx';

function cellMatrix(sheet: Sheet): Array<Array<Cell | null>> {
  if (sheet.data) return sheet.data;
  const matrix: Array<Array<Cell | null>> = [];
  for (const item of sheet.celldata || []) {
    if (!matrix[item.r]) matrix[item.r] = [];
    matrix[item.r][item.c] = item.v;
  }
  return matrix;
}

export async function serializeFortuneSheetWorkbook(sheets: Sheet[]): Promise<ArrayBuffer> {
  if (!sheets.length) throw new Error('工作簿至少需要一个工作表');
  const XLSX = await import('xlsx');
  const workbook = XLSX.utils.book_new();
  const visibility: Array<{ Hidden: 0 | 1 | 2 }> = [];

  sheets.forEach((sheet, sheetIndex) => {
    const matrix = cellMatrix(sheet);
    const worksheet = XLSX.utils.aoa_to_sheet(matrix.map(row => (row || []).map(cell => cell?.v ?? null))) as WorkSheet;
    matrix.forEach((row, rowIndex) => (row || []).forEach((cell, columnIndex) => {
      if (!cell) return;
      const address = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
      const target = worksheet[address] || { t: typeof cell.v === 'number' ? 'n' : typeof cell.v === 'boolean' ? 'b' : 's', v: cell.v ?? '' };
      if (cell.f) target.f = cell.f.replace(/^=/, '');
      if (cell.ct?.fa) target.z = cell.ct.fa;
      target.s = {
        font: { bold: cell.bl === 1, italic: cell.it === 1, sz: cell.fs, color: cell.fc ? { rgb: cell.fc.replace('#', '') } : undefined },
        fill: cell.bg ? { patternType: 'solid', fgColor: { rgb: cell.bg.replace('#', '') } } : undefined,
        alignment: {
          horizontal: cell.ht === 0 ? 'center' : cell.ht === 2 ? 'right' : 'left',
          vertical: cell.vt === 0 ? 'center' : cell.vt === 2 ? 'bottom' : 'top',
          wrapText: cell.tb === '2',
        },
      };
      worksheet[address] = target;
    }));

    worksheet['!merges'] = Object.values(sheet.config?.merge || {}).map(merge => ({
      s: { r: merge.r, c: merge.c },
      e: { r: merge.r + merge.rs - 1, c: merge.c + merge.cs - 1 },
    }));
    const maxColumn = Math.max(sheet.column || 0, ...Object.keys(sheet.config?.columnlen || {}).map(Number), 0);
    worksheet['!cols'] = Array.from({ length: maxColumn + 1 }, (_, index) => ({
      wpx: sheet.config?.columnlen?.[index],
      hidden: Object.prototype.hasOwnProperty.call(sheet.config?.colhidden || {}, index),
    }));
    const maxRow = Math.max(sheet.row || 0, ...Object.keys(sheet.config?.rowlen || {}).map(Number), 0);
    worksheet['!rows'] = Array.from({ length: maxRow + 1 }, (_, index) => ({
      hpx: sheet.config?.rowlen?.[index],
      hidden: Object.prototype.hasOwnProperty.call(sheet.config?.rowhidden || {}, index),
    }));
    Object.entries(sheet.hyperlink || {}).forEach(([position, link]) => {
      const [row, column] = position.split('_').map(Number);
      const address = XLSX.utils.encode_cell({ r: row, c: column });
      if (worksheet[address]) worksheet[address].l = { Target: link.linkAddress };
    });

    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name || `Sheet${sheetIndex + 1}`);
    visibility.push({ Hidden: sheet.hide === 1 || sheet.hide === 2 ? sheet.hide : 0 });
  });
  workbook.Workbook = { ...workbook.Workbook, Sheets: visibility };
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx', cellStyles: true }) as ArrayBuffer;
}
