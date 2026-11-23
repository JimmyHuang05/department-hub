import type { InvestmentProduct, ParseResult, SystemSettings } from '../types';
import { normalizeRate } from './format';

type Matrix = unknown[][];

interface ProjectSheet {
  name: string;
  rows: Matrix;
}

interface TableMatch {
  sheet: ProjectSheet;
  headerRowIndex: number;
  fieldMap: Array<string | null>;
  score: number;
}

const NUMBER_FIELDS = new Set([
  'usd',
  'rmb',
  'feeRate',
  'annualIncome',
  'thisYearIncome',
  'performanceIncome',
]);

const DATE_FIELDS = new Set([
  'projectCreatedDate',
  'progressStartDate',
  'establishDate',
  'projectStoppedDate',
  'deadline',
]);

const FIELD_ALIASES: Record<string, string[]> = {
  productName: ['产品名称', '产品名', '项目', '项目名称'],
  usd: ['USD', '规模USD', 'USD规模', '美元规模'],
  rmb: ['RMB', '规模RMB', 'RMB规模', '人民币规模'],
  feeRate: ['费率', '管理费率', '信托报酬率'],
  projectCreatedDate: [
    '项目创建日',
    '项目创建时间',
    '项目创建日期',
    '创建日期',
    '创建时间',
    '立项日期',
    '项目发起日期',
  ],
  progressStartDate: [
    '开始推进日',
    '开始推进时间',
    '推进中时间',
    '推进日期',
    '进入推进时间',
    '实际推进时间',
  ],
  establishDate: [
    '成立/落地日',
    '成立落地日',
    '成立日期',
    '成立时间',
    '落地日期',
    '落地时间',
    '实际成立时间',
    '实际落地时间',
    '预计成立时间',
    '拟成立时间',
    '成立日',
    '预计成立日',
    '拟成立日',
  ],
  projectStoppedDate: [
    '项目中止日',
    '项目中止时间',
    '中止日期',
    '中止时间',
    '终止日期',
    '终止时间',
    '实际中止时间',
    '实际终止时间',
  ],
  target: ['标的', '投资标的'],
  client: ['委托人', '客户', '客户名称'],
  brokerChannel: ['券商渠道', '券商/渠道', '渠道/券商'],
  strategy: ['策略', '基石/锚定', '基石锚定'],
  custodianBank: ['托管行', '托管银行'],
  tradingBroker: ['交易券商'],
  annualIncome: ['年度收益', '年收入', '年化收入', '年度收入'],
  thisYearIncome: ['今年收益', '今年收入', '本年收入'],
  performanceIncome: ['业绩报酬', '绩效收入', '业绩收入'],
  status: ['状态', '进度', '项目进度'],
  trustManager: ['信托经理A角', '信托经理A', 'A角', '信托经理', '项目经理'],
  trustManagerB: ['信托经理B角', '信托经理B', 'B角'],
  deadline: ['期限', '截止时间', '截止日期'],
  remarks: ['备注', '说明'],
};

const COMMON_STATUS_HEADERS = [
  '材料收集',
  '报告撰写',
  '上会中',
  '已过会',
  '已成立',
  '已落地',
  '项目中止',
  '项目终止',
];

export function normalizeProjectHeader(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[()[\]【】（）:：,，、/_-]/g, '');
}

function buildAliasMap(settings: SystemSettings): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const [field, titles] of Object.entries(FIELD_ALIASES)) {
    for (const title of titles) aliases.set(normalizeProjectHeader(title), field);
  }
  for (const status of [
    ...COMMON_STATUS_HEADERS,
    ...settings.statusConfigs.map(item => item.name),
  ]) {
    const normalized = normalizeProjectHeader(status);
    if (normalized) aliases.set(normalized, 'status');
  }
  for (const column of settings.customColumns) {
    const normalized = normalizeProjectHeader(column.title);
    if (normalized && !aliases.has(normalized)) aliases.set(normalized, column.key);
  }
  return aliases;
}

export function buildProjectFieldMap(
  headers: unknown[],
  settings: SystemSettings,
): Array<string | null> {
  const aliases = buildAliasMap(settings);
  return headers.map(header => aliases.get(normalizeProjectHeader(header)) ?? null);
}

function scoreFieldMap(fieldMap: Array<string | null>): number {
  const fields = new Set(fieldMap.filter((field): field is string => Boolean(field)));
  if (!fields.has('productName') || fields.size < 2) return 0;
  return fields.size + 5;
}

export function findBestProjectTable(
  sheets: ProjectSheet[],
  settings: SystemSettings,
): TableMatch | null {
  let best: TableMatch | null = null;
  for (const sheet of sheets) {
    const searchRows = Math.min(sheet.rows.length, 30);
    for (let rowIndex = 0; rowIndex < searchRows; rowIndex += 1) {
      const fieldMap = buildProjectFieldMap(sheet.rows[rowIndex] ?? [], settings);
      const score = scoreFieldMap(fieldMap);
      if (score > 0 && (!best || score > best.score)) {
        best = { sheet, headerRowIndex: rowIndex, fieldMap, score };
      }
    }
  }
  return best;
}

function hasValue(value: unknown): boolean {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function valueToText(value: unknown): string {
  if (value instanceof Date) return formatDateValue(value);
  return String(value ?? '').trim();
}

function parseNumberValue(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = valueToText(value)
    .replace(/[,，]/g, '')
    .replace(/%$/, '');
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDateValue(value: unknown): string {
  if (!hasValue(value)) return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  let date: Date | null = null;
  if (typeof value === 'number' && value >= 1 && value <= 2_958_465) {
    date = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86_400_000);
  } else {
    const text = valueToText(value);
    const match = text.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?/);
    if (match) {
      date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    } else {
      const parsed = new Date(text);
      if (!Number.isNaN(parsed.getTime())) date = parsed;
    }
  }
  if (!date || Number.isNaN(date.getTime())) return valueToText(value);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function createProduct(row: Record<string, unknown>, dynamicFields: Record<string, string | number>) {
  return {
    ...row,
    productName: valueToText(row.productName),
    ...(Object.keys(dynamicFields).length > 0 ? { dynamicFields } : {}),
  } satisfies Partial<InvestmentProduct>;
}

export function parseProjectSheets(
  sheets: ProjectSheet[],
  settings: SystemSettings,
): ParseResult {
  const match = findBestProjectTable(sheets, settings);
  if (!match) {
    return {
      rows: [],
      errors: [{ row: 0, message: '未找到可识别的项目进度表头，请确认文件中包含“项目/产品名称”等字段' }],
      totalRows: 0,
      successRows: 0,
    };
  }

  const rows: Partial<InvestmentProduct>[] = [];
  const errors: ParseResult['errors'] = [];
  let candidateRows = 0;
  let fieldMap = match.fieldMap;

  for (
    let rowIndex = match.headerRowIndex + 1;
    rowIndex < match.sheet.rows.length;
    rowIndex += 1
  ) {
    const values = match.sheet.rows[rowIndex] ?? [];
    const possibleHeaderMap = buildProjectFieldMap(values, settings);
    if (scoreFieldMap(possibleHeaderMap) > 0) {
      fieldMap = possibleHeaderMap;
      continue;
    }

    const mappedValueCount = fieldMap.reduce((count, field, columnIndex) => (
      field && hasValue(values[columnIndex]) ? count + 1 : count
    ), 0);
    if (mappedValueCount === 0) continue;
    candidateRows += 1;

    const row: Record<string, unknown> = {};
    const dynamicFields: Record<string, string | number> = {};
    fieldMap.forEach((field, columnIndex) => {
      if (!field || !hasValue(values[columnIndex]) || row[field] !== undefined) return;
      const value = values[columnIndex];
      const customColumn = settings.customColumns.find(column => column.key === field);
      if (customColumn) {
        if (customColumn.type === 'number') {
          dynamicFields[field] = parseNumberValue(value) ?? 0;
        } else if (customColumn.type === 'date') {
          dynamicFields[field] = formatDateValue(value);
        } else {
          dynamicFields[field] = valueToText(value);
        }
        return;
      }
      if (NUMBER_FIELDS.has(field)) {
        const parsed = parseNumberValue(value);
        if (parsed === null) {
          errors.push({ row: rowIndex + 1, message: `${valueToText(value)} 不是有效数字，已按 0 处理` });
          row[field] = 0;
        } else {
          row[field] = field === 'feeRate' ? normalizeRate(parsed) : parsed;
        }
      } else if (DATE_FIELDS.has(field)) {
        row[field] = formatDateValue(value);
      } else {
        row[field] = valueToText(value);
      }
    });

    if (!row.projectCreatedDate && row.progressStartDate) {
      row.projectCreatedDate = row.progressStartDate;
    }
    delete row.progressStartDate;
    rows.push(createProduct(row, dynamicFields));
  }

  return {
    rows,
    errors,
    totalRows: candidateRows,
    successRows: rows.length,
  };
}

export const projectImportInternals = {
  buildProjectFieldMap,
  findBestProjectTable,
  normalizeProjectHeader,
  parseProjectSheets,
};
