import type ExcelJS from 'exceljs';
import type { InvestmentProduct } from '../types';
import { normalizeRate } from './format';
import { chooseXlsxDestination, saveXlsxBlob, XLSX_MIME } from './fileSave';

export interface BuildProjectProgressWorkbookOptions {
  products: InvestmentProduct[];
  exchangeRate: number;
}

interface ExportProjectProgressOptions extends BuildProjectProgressWorkbookOptions {
  scopeLabel: string;
}

const SHEET_NAME = '服务类信托进度表';
const SOURCE_SHEET_NAME = '数据源';
const FIRST_DATA_ROW = 5;
const TEMPLATE_LAST_DATA_ROW = 110;
const TEMPLATE_NOTE_ROW = 44;
const STATUS_OPTIONS = ['已成立', '已过会', '上会中', '材料收集', '项目中止', '报告撰写'];

const COLORS = {
  estimated: 'FFDEEBF7',
  pending: 'FFFFF2CC',
  establishedSummary: 'FFC6DEB5',
  established: 'FFE2EFDA',
  stopped: 'FFF8BFBE',
  text: 'FF000000',
  border: 'FF000000',
};

const COLUMN_WIDTHS = [
  9, 18.125, 12.5, 17.25, 9.875, 20, 72.125, 18.875,
  21.125, 13.625, 11.875, 13.875, 13.875, 9.875, 8.43, 8.43, 15,
  15, 15, 15,
];

const HEADERS: Array<string | null> = [
  '序号', '项目', '规模（USD）', '规模(rmb)', '费率', '标的',
  '委托人', '券商/渠道', '基石/锚定', '托管行', '年收入', '今年收入', '绩效收入',
  '进度', 'A角', 'B角', '截止时间',
  '项目创建日', '成立/落地日', '项目中止日',
];

const NOTES = [
  '1、进度选择为“已成立”时，当行显示为绿色',
  '2、进度选择为“项目中止”时，当行显示为红色',
  '3、进度显示非1和2的情况时，显示为黄色',
  '4、已成立合计为成立项目的数据合计',
  '5、未成立合计为除了已成立及项目中止的数据合计',
];

const THIN_BORDER = {
  top: { style: 'thin' as const, color: { argb: COLORS.border } },
  left: { style: 'thin' as const, color: { argb: COLORS.border } },
  bottom: { style: 'thin' as const, color: { argb: COLORS.border } },
  right: { style: 'thin' as const, color: { argb: COLORS.border } },
};

function round(value: number, digits = 12): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function parseDate(value?: string): Date | undefined {
  const raw = String(value || '').trim();
  if (!raw) return undefined;

  if (/^\d{1,7}$/.test(raw)) {
    const serial = Number(raw);
    if (serial >= 1 && serial <= 2_958_465) {
      const adjusted = serial > 60 ? serial - 1 : serial;
      return new Date(Date.UTC(1899, 11, 31 + adjusted));
    }
  }

  const parts = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (parts) {
    const date = new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])));
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()));
}

function dayDifference(start?: Date, end?: Date): number {
  if (!start || !end) return 0;
  const startUtc = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const endUtc = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  return Math.max(0, Math.round((endUtc - startUtc) / 86_400_000));
}

function normalizeStatus(status: string): string {
  if (status === '项目备用') return '项目中止';
  const value = String(status || '').trim();
  if (value.includes('中止') || value.includes('终止')) return '项目中止';
  if (value.includes('成立') || value.includes('落地')) return '已成立';
  return value;
}

function statusFillColor(status: unknown): string | undefined {
  const value = normalizeStatus(String(status ?? ''));
  if (value === '已成立') return COLORS.established;
  if (value === '项目中止') return COLORS.stopped;
  if (value) return COLORS.pending;
  return undefined;
}

function textOrNull(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text || null;
}

function resolveAmounts(product: InvestmentProduct, exchangeRate: number) {
  let usd = Number(product.usd) || 0;
  let rmb = Number(product.rmb) || 0;
  const rate = Number(exchangeRate) || 0;
  if (rmb === 0 && usd !== 0 && rate > 0) rmb = usd * rate;
  if (usd === 0 && rmb !== 0 && rate > 0) usd = rmb / rate;
  return { usd: round(usd), rmb: round(rmb) };
}

function applyBaseFontAndHeight(worksheet: ExcelJS.Worksheet, lastRow: number) {
  for (let rowNumber = 1; rowNumber <= lastRow; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    row.height = 13.5;
    row.eachCell({ includeEmpty: true }, cell => {
      cell.font = { name: '宋体', size: 11, bold: false, color: { argb: COLORS.text } };
      cell.alignment = { vertical: 'middle', wrapText: false };
    });
  }
}

function applySummaryStyle(worksheet: ExcelJS.Worksheet, rowNumber: number, color: string) {
  const row = worksheet.getRow(rowNumber);
  for (let column = 1; column <= HEADERS.length; column += 1) {
    const cell = row.getCell(column);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
  }
  row.getCell(1).alignment = { horizontal: 'left', vertical: 'middle', wrapText: false };
  for (const column of [3, 4, 11, 12, 13]) {
    row.getCell(column).numFmt = '#,##0.00_ ';
    row.getCell(column).alignment = { horizontal: 'right', vertical: 'middle', wrapText: false };
  }
}

function applyHeaderAndDataStyle(worksheet: ExcelJS.Worksheet, lastDataRow: number) {
  const header = worksheet.getRow(4);
  for (let column = 1; column <= HEADERS.length; column += 1) {
    const cell = header.getCell(column);
    cell.border = THIN_BORDER;
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: false };
  }

  for (let rowNumber = FIRST_DATA_ROW; rowNumber <= lastDataRow; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const fillColor = statusFillColor(row.getCell(14).value);
    for (let column = 1; column <= HEADERS.length; column += 1) {
      const cell = row.getCell(column);
      cell.border = THIN_BORDER;
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: false };
      if (fillColor) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: fillColor },
          bgColor: { argb: fillColor },
        };
      }
    }
    for (const column of [3, 4, 11, 12, 13]) {
      row.getCell(column).numFmt = '#,##0.00_ ';
      row.getCell(column).alignment = { horizontal: 'right', vertical: 'middle', wrapText: false };
    }
    row.getCell(5).numFmt = '0.00%';
    row.getCell(5).alignment = { horizontal: 'right', vertical: 'middle', wrapText: false };
    for (const column of [17, 18, 19, 20]) {
      row.getCell(column).numFmt = 'm/d/yy';
      row.getCell(column).alignment = { horizontal: 'right', vertical: 'middle', wrapText: false };
    }
    row.getCell(15).alignment = { horizontal: 'left', vertical: 'middle', wrapText: false };
    row.getCell(16).alignment = { horizontal: 'left', vertical: 'middle', wrapText: false };
  }
}

function sumRows(rows: Array<{ status: string; values: number[] }>, predicate: (status: string) => boolean) {
  return rows.reduce((totals, row) => {
    if (!predicate(row.status)) return totals;
    row.values.forEach((value, index) => { totals[index] += value; });
    return totals;
  }, [0, 0, 0, 0, 0]);
}

function setFormula(cell: ExcelJS.Cell, formula: string, result: number) {
  cell.value = { formula, result: round(result) };
}

export async function buildProjectProgressWorkbook({ products, exchangeRate }: BuildProjectProgressWorkbookOptions) {
  const { default: ExcelJSModule } = await import('exceljs');
  const workbook = new ExcelJSModule.Workbook();
  workbook.creator = '全球资本运营部内部系统';
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;

  const worksheet = workbook.addWorksheet(SHEET_NAME, {
    views: [{ showGridLines: true, zoomScale: 90, zoomScaleNormal: 90 }],
    pageSetup: {
      paperSize: 9,
      orientation: 'landscape',
      scale: 53,
      horizontalDpi: 300,
      verticalDpi: 300,
      margins: { left: 0.7, right: 0.7, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 },
    },
  });

  COLUMN_WIDTHS.forEach((width, index) => { worksheet.getColumn(index + 1).width = width; });

  worksheet.getCell('A1').value = '预计合计';
  worksheet.getCell('A2').value = '未成立合计';
  worksheet.getCell('A3').value = '已成立合计';
  worksheet.getRow(4).values = HEADERS;

  const exportRows: Array<{ status: string; values: number[] }> = [];
  products.forEach((product, index) => {
    const rowNumber = FIRST_DATA_ROW + index;
    const row = worksheet.getRow(rowNumber);
    const { usd, rmb } = resolveAmounts(product, exchangeRate);
    const feeRate = normalizeRate(Number(product.feeRate) || 0);
    const establishDate = parseDate(product.establishDate);
    const deadline = parseDate(product.deadline);
    const annualIncome = rmb * feeRate;
    const thisYearIncome = annualIncome * dayDifference(establishDate, deadline) / 365;
    const performanceIncome = thisYearIncome / 1.06;
    const status = normalizeStatus(product.status);

    row.values = [
      index + 1,
      textOrNull(product.productName),
      usd || 0,
      rmb || 0,
      feeRate || 0,
      textOrNull(product.target),
      textOrNull(product.client),
      textOrNull(product.brokerChannel),
      textOrNull(product.strategy),
      textOrNull(product.custodianBank),
      0,
      0,
      0,
      textOrNull(status),
      textOrNull(product.trustManager),
      textOrNull(product.trustManagerB),
      deadline || null,
      parseDate(product.projectCreatedDate || product.progressStartDate) || null,
      establishDate || null,
      parseDate(product.projectStoppedDate) || null,
    ];

    setFormula(row.getCell(11), `D${rowNumber}*E${rowNumber}`, annualIncome);
    setFormula(row.getCell(12), `IF(OR(S${rowNumber}="",Q${rowNumber}=""),0,K${rowNumber}*(Q${rowNumber}-S${rowNumber})/365)`, thisYearIncome);
    setFormula(row.getCell(13), `L${rowNumber}/1.06`, performanceIncome);
    exportRows.push({ status, values: [usd, rmb, annualIncome, thisYearIncome, performanceIncome] });
  });

  const lastDataRow = Math.max(FIRST_DATA_ROW, FIRST_DATA_ROW + products.length - 1);
  const formulaLastRow = Math.max(TEMPLATE_LAST_DATA_ROW, lastDataRow);
  const noteStartRow = Math.max(TEMPLATE_NOTE_ROW, lastDataRow + 2);
  const lastRenderedRow = noteStartRow + NOTES.length - 1;

  const pendingTotals = sumRows(exportRows, status => status !== '已成立' && status !== '项目中止');
  const establishedTotals = sumRows(exportRows, status => status === '已成立');
  const estimatedTotals = pendingTotals.map((value, index) => value + establishedTotals[index]);
  const summaryColumns = ['C', 'D', 'K', 'L', 'M'];
  summaryColumns.forEach((column, index) => {
    setFormula(worksheet.getCell(`${column}1`), `${column}2+${column}3`, estimatedTotals[index]);
    setFormula(
      worksheet.getCell(`${column}2`),
      `SUM(${column}${FIRST_DATA_ROW}:${column}${formulaLastRow})-${column}3-SUMIF($N$${FIRST_DATA_ROW}:$N$${formulaLastRow},"项目中止",${column}${FIRST_DATA_ROW}:${column}${formulaLastRow})`,
      pendingTotals[index],
    );
    setFormula(
      worksheet.getCell(`${column}3`),
      `SUMIF($N$${FIRST_DATA_ROW}:$N$${formulaLastRow},"已成立",${column}${FIRST_DATA_ROW}:${column}${formulaLastRow})`,
      establishedTotals[index],
    );
  });

  NOTES.forEach((note, index) => { worksheet.getCell(`A${noteStartRow + index}`).value = note; });

  applyBaseFontAndHeight(worksheet, lastRenderedRow);
  applySummaryStyle(worksheet, 1, COLORS.estimated);
  applySummaryStyle(worksheet, 2, COLORS.pending);
  applySummaryStyle(worksheet, 3, COLORS.establishedSummary);
  applyHeaderAndDataStyle(worksheet, lastDataRow);

  const conditionalRange = `A${FIRST_DATA_ROW}:T${formulaLastRow}`;
  worksheet.addConditionalFormatting({
    ref: conditionalRange,
    rules: [
      {
        type: 'expression',
        priority: 1,
        formulae: [`$N${FIRST_DATA_ROW}="已成立"`],
        style: { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.established }, bgColor: { argb: COLORS.established } } },
      },
      {
        type: 'expression',
        priority: 2,
        formulae: [`$N${FIRST_DATA_ROW}="项目中止"`],
        style: { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.stopped }, bgColor: { argb: COLORS.stopped } } },
      },
      {
        type: 'expression',
        priority: 3,
        formulae: [`AND($N${FIRST_DATA_ROW}<>"已成立",$N${FIRST_DATA_ROW}<>"项目中止",$N${FIRST_DATA_ROW}<>"")`],
        style: { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.pending }, bgColor: { argb: COLORS.pending } } },
      },
    ],
  });

  for (let rowNumber = FIRST_DATA_ROW; rowNumber <= formulaLastRow; rowNumber += 1) {
    worksheet.getCell(`N${rowNumber}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      showInputMessage: true,
      showErrorMessage: true,
      errorStyle: 'error',
      errorTitle: '无效的项目进度',
      error: '请从下拉列表中选择项目进度。',
      formulae: [`"${STATUS_OPTIONS.join(',')}"`],
    };
  }

  const sourceSheet = workbook.addWorksheet(SOURCE_SHEET_NAME, {
    views: [{ showGridLines: true, zoomScale: 100 }],
    pageSetup: { margins: { left: 0.7, right: 0.7, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 } },
  });
  sourceSheet.getRow(1).values = ['进度', '材料收集', '报告撰写', '上会中', '已过会', '已成立', '项目中止'];
  sourceSheet.getRow(1).height = 13.5;
  sourceSheet.getRow(1).eachCell(cell => {
    cell.font = { name: '宋体', size: 11, bold: false, color: { argb: COLORS.text } };
    cell.alignment = { vertical: 'middle', wrapText: false };
  });

  return workbook;
}

function localDateStamp(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function safeFilenamePart(value: string): string {
  return value.replace(/[<>:"/\\|?*]/g, '_').trim() || '当前视图';
}

export async function exportProjectProgress({ products, scopeLabel, exchangeRate }: ExportProjectProgressOptions) {
  const filename = `项目进度表_${safeFilenamePart(scopeLabel)}_${localDateStamp()}.xlsx`;
  const destination = await chooseXlsxDestination(filename);
  if (destination.kind === 'cancelled') return;

  const workbook = await buildProjectProgressWorkbook({ products, exchangeRate });
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: XLSX_MIME });
  await saveXlsxBlob(blob, filename, destination);
}
