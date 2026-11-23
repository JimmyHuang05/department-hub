/**
 * 工作日志 Excel 导入工具
 *
 * 严格校验导入的 Excel 必须包含且仅包含三个指定 Sheet：
 *   - 正常项目
 *   - 直销产品情况
 *   - 问题项目
 *
 * 进展列格式：上周进展（YYMMDD）或 上周进展(YYMMDD)
 */
import type { WorkBook } from 'xlsx';
import { WorkLogEntry } from '../types';
import { getWeekKeyForDate } from './week';
import { WORKLOG_HEADER_MAP } from './fieldMaps';

/** 系统要求的三个业务模块 Sheet 名称；工作表出现顺序不影响识别 */
const REQUIRED_SHEETS = ['正常项目', '直销产品情况', '问题项目'];

// 表头中文名 → WorkLogEntry 字段名（使用统一映射表）
const HEADER_MAP = WORKLOG_HEADER_MAP;

export interface WorkLogParseResult {
  rows: Partial<WorkLogEntry>[];
  errors: { row: number; message: string }[];
  totalRows: number;
  successRows: number;
}

/**
 * 严格校验 Sheet 名称是否与三个业务模块一一对应
 * 缺失、多余或名称不匹配都会抛出明确异常
 */
function normalizeLabel(value: unknown): string {
  return String(value ?? '')
    .replace(/\r?\n/g, '')
    .replace(/\s+/g, '')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/／/g, '/')
    .replace(/[：:]+$/g, '')
    .trim();
}

function excelSerialToISODate(serial: number): string {
  const date = new Date(Math.round((serial - 25569) * 86400 * 1000));
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const NORMALIZED_HEADER_MAP = Object.entries(HEADER_MAP).reduce<Record<string, string>>(
  (result, [label, field]) => {
    result[normalizeLabel(label)] = field;
    return result;
  },
  {},
);

function canonicalSheetName(value: string): string | null {
  const normalized = normalizeLabel(value);
  return REQUIRED_SHEETS.find(name => normalizeLabel(name) === normalized) || null;
}

function resolveSheetNames(sheetNames: string[]): Record<string, string> {
  const unmatched: string[] = [];
  const missing: string[] = [];
  const resolved: Record<string, string> = {};

  for (const s of sheetNames) {
    const canonical = canonicalSheetName(s);
    if (!canonical || resolved[canonical]) {
      unmatched.push(`"${s}"`);
    } else {
      resolved[canonical] = s;
    }
  }
  for (const r of REQUIRED_SHEETS) {
    if (!resolved[r]) {
      missing.push(`"${r}"`);
    }
  }

  const parts: string[] = [];
  if (missing.length > 0) {
    parts.push(`缺少 Sheet: ${missing.join('、')}`);
  }
  if (unmatched.length > 0) {
    parts.push(`无法识别的 Sheet: ${unmatched.join('、')}（系统要求 Sheet 名称必须为 ${REQUIRED_SHEETS.map(s => `"${s}"`).join('、')}）`);
  }
  if (parts.length > 0) {
    throw new Error(`Excel 文件格式校验失败：${parts.join('；')}。请检查文件是否包含正确的三个模块 Sheet。`);
  }
  return resolved;
}

/**
 * 判断一行是否为 Excel 中的分类标题行（如 "3、权益类"）
 */
function isSectionHeader(raw: any[]): boolean {
  const nonEmpty = raw.filter(value => normalizeLabel(value));
  if (nonEmpty.length !== 1) return false;
  const first = nonEmpty[0];
  if (first == null || first === '') return false;
  const s = String(first).trim();
  // 匹配 "数字、XXX" 或 "一、XXX" 格式的标题行
  return /^\d+[、.．\s]/.test(s) || /^[一二三四五六七八九十]+[、.．\s]/.test(s);
}

/**
 * 判断一行是否为重复的表头行（常见于分段式Excel）
 */
function isSubHeaderRow(raw: any[], knownHeaders: string[]): boolean {
  const normalizedKnownHeaders = knownHeaders.map(normalizeLabel);
  const s = normalizeLabel(raw.find(value => normalizeLabel(value)));
  // 如果第一列是已知的列标题或常见"表头文字"，判定为表头行
  if (normalizedKnownHeaders.includes(s)) return true;
  // 多个列包含已知列名文本
  let matchCount = 0;
  for (let i = 0; i < raw.length; i++) {
    const v = normalizeLabel(raw[i]);
    if (normalizedKnownHeaders.includes(v)) matchCount++;
  }
  return matchCount >= 2;
}

// Sheet 特定的表头文本（用于识别子表头行）
const SHEET_SUBHEADER_KEYWORDS: Record<string, string[]> = {
  '直销产品情况': ['财富', '该产品销售渠道', '后续计划', '一周回顾', '销售渠道', '下一步计划'],
};
const SHEET_CATEGORY_MAP: Record<string, string> = {
  '正常项目': '正常项目',
  '直销产品情况': '直销产品情况',
  '问题项目': '问题项目',
};

/**
 * 解析 XLSX 工作日志文件
 * 先严格校验 Sheet 名称，再按固定顺序解析三个模块
 * @param defaultWeekKey 导入时用于记录周次的默认周（如直销产品情况无进展列时使用）
 */
export async function parseWorkLogXLSX(buffer: ArrayBuffer, defaultWeekKey?: string): Promise<WorkLogParseResult> {
  const errors: { row: number; message: string }[] = [];
  const allRows: Partial<WorkLogEntry>[] = [];
  const importedWeekKeys = new Set<string>();
  const normalProgressKeysByColumn = new Map<number, string>();

  // 1. 读取 Excel
  const XLSX = await import('xlsx');
  let workbook: WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'array' });
  } catch (e) {
    return { rows: [], errors: [{ row: 0, message: '文件解析失败：不是有效的 Excel 文件' }], totalRows: 0, successRows: 0 };
  }

  // 2. 严格校验 Sheet 名称
  try {
    const resolvedSheetNames = resolveSheetNames(workbook.SheetNames);
    (workbook as WorkBook & { __resolvedSheetNames?: Record<string, string> }).__resolvedSheetNames = resolvedSheetNames;
  } catch (e) {
    return { rows: [], errors: [{ row: 0, message: e instanceof Error ? e.message : 'Sheet 名称校验失败' }], totalRows: 0, successRows: 0 };
  }

  // 3. 按固定顺序解析三个模块
  const resolvedSheetNames = (workbook as WorkBook & { __resolvedSheetNames?: Record<string, string> }).__resolvedSheetNames || {};
  for (const sheetName of REQUIRED_SHEETS) {
    const ws = workbook.Sheets[resolvedSheetNames[sheetName]];
    const data: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (data.length < 2) {
      errors.push({ row: 0, message: `"${sheetName}" 没有足够的数据行` });
      continue;
    }

    const category = SHEET_CATEGORY_MAP[sheetName];

    if (sheetName === '直销产品情况') {
      const directResult = parseDirectSalesRows(data, defaultWeekKey);
      allRows.push(...directResult.rows);
      errors.push(...directResult.errors);
      continue;
    }

    // 查找真正的表头行。不能依赖固定行号，允许标题、说明和空行出现在表头前。
    let headerRowIndex = -1;
    for (let i = 0; i < Math.min(30, data.length); i++) {
      if (isHeaderRow(data[i])) {
        headerRowIndex = i;
        break;
      }
    }
    if (headerRowIndex < 0) {
      errors.push({ row: 0, message: `[${sheetName}] 未找到可识别的表头` });
      continue;
    }

    let colMap = buildColumnMap(data[headerRowIndex]);
    if (sheetName === '正常项目') {
      rememberProgressColumns(colMap, normalProgressKeysByColumn);
    } else {
      colMap = alignProgressColumnMap(data[headerRowIndex], colMap, normalProgressKeysByColumn);
    }
    rememberImportedWeekKeys(colMap, importedWeekKeys);
    let currentSubCategory = '';

    // 处理数据行
    for (let r = headerRowIndex + 1; r < data.length; r++) {
      const raw = data[r];
      if (!raw.some((cell: any) => cell != null && cell !== '')) continue;

      // 分段表格可能重复出现表头，且列顺序可以不同；遇到时立即重建映射。
      if (isHeaderRow(raw)) {
        colMap = buildColumnMap(raw);
        if (sheetName === '正常项目') {
          rememberProgressColumns(colMap, normalProgressKeysByColumn);
        } else {
          colMap = alignProgressColumnMap(raw, colMap, normalProgressKeysByColumn);
        }
        rememberImportedWeekKeys(colMap, importedWeekKeys);
        continue;
      }
      // 分类标题行（如 "3、权益类"）为后续数据提供子分类。
      if (isSectionHeader(raw)) {
        currentSubCategory = String(raw.find(value => normalizeLabel(value)) || '').trim();
        continue;
      }
      // 跳过子表头行（如 "财富 | 该产品销售渠道 | 后续计划 | 一周回顾"）
      if (isSubHeaderRow(raw, SHEET_SUBHEADER_KEYWORDS[sheetName] || [])) continue;

      try {
        const entry = mapRowToEntry(raw, colMap, category);
        if (!entry.subCategory && currentSubCategory) entry.subCategory = currentSubCategory;
        // 无进展列的模块使用导入时周次作为 weekKey
        if (!entry.weekKey && defaultWeekKey) {
          entry.weekKey = defaultWeekKey;
        }
        if (entry.productName) {
          allRows.push(entry);
        } else {
          errors.push({ row: r + 1, message: `[${sheetName}] 缺少产品名` });
        }
      } catch (e) {
        errors.push({ row: r + 1, message: `[${sheetName}] 解析失败: ${e instanceof Error ? e.message : '未知错误'}` });
      }
    }
  }

  const completedRows = completeImportedWeekCoverage(
    allRows,
    Array.from(importedWeekKeys),
    defaultWeekKey,
  );

  return {
    rows: completedRows,
    errors,
    totalRows: completedRows.length + errors.length,
    successRows: completedRows.length,
  };
}

/**
 * 进展列正则：上周进展（210806）或 上周进展(210806)
 */
const PROGRESS_RE = /上周进展\(?(\d{6})\)?/;
/** 净值历史列正则：净值情况(210806) 或 净值情况（210806） */
const NAV_HISTORY_RE = /净值情况\(?(\d{6})\)?/;

interface ColumnInfo {
  type: 'field' | 'progress' | 'navscale' | 'ignore';
  fieldName?: string;     // 标准字段名
  progressKey?: string;   // 进展/净值周次 key（如 210806）
}

/**
 * 根据表头构建列映射
 */
function buildColumnMap(headers: any[]): ColumnInfo[] {
  return headers.map((h) => {
    if (h == null || h === '') return { type: 'ignore' as const };

    const headerStr = normalizeLabel(h);

    // 1. 检查是否为进展列
    const pMatch = headerStr.match(PROGRESS_RE);
    if (pMatch) {
      return { type: 'progress' as const, progressKey: pMatch[1] };
    }

    // 1b. 检查是否为净值历史列
    const nMatch = headerStr.match(NAV_HISTORY_RE);
    if (nMatch) {
      return { type: 'navscale' as const, progressKey: nMatch[1] };
    }

    // 2. 检查是否为标准字段
    const fieldName = NORMALIZED_HEADER_MAP[headerStr];
    if (fieldName) {
      return { type: 'field' as const, fieldName };
    }

    // 3. 其他列忽略
    return { type: 'ignore' as const };
  });
}

function rememberProgressColumns(
  columnMap: ColumnInfo[],
  progressKeysByColumn: Map<number, string>,
) {
  columnMap.forEach((info, index) => {
    if (info.type === 'progress' && info.progressKey) {
      progressKeysByColumn.set(index, info.progressKey);
    }
  });
}

function rememberImportedWeekKeys(columnMap: ColumnInfo[], weekKeys: Set<string>) {
  columnMap.forEach(info => {
    if (
      (info.type === 'progress' || info.type === 'navscale')
      && info.progressKey
      && parseYYMMDD(info.progressKey)
    ) {
      weekKeys.add(info.progressKey);
    }
  });
}

function alignProgressColumnMap(
  headers: any[],
  columnMap: ColumnInfo[],
  progressKeysByColumn: Map<number, string>,
): ColumnInfo[] {
  const counts = new Map<string, number>();
  columnMap.forEach(info => {
    if (info.type === 'progress' && info.progressKey) {
      counts.set(info.progressKey, (counts.get(info.progressKey) || 0) + 1);
    }
  });
  return columnMap.map((info, index) => {
    const header = normalizeLabel(headers[index]);
    if (!header.startsWith('上周进展')) return info;
    const fallbackKey = progressKeysByColumn.get(index);
    if (!fallbackKey) return info;
    if (info.type !== 'progress' || !info.progressKey || (counts.get(info.progressKey) || 0) > 1) {
      return { type: 'progress', progressKey: fallbackKey };
    }
    return info;
  });
}

function buildImportedWeekCoverage(sourceWeekKeys: string[], targetWeekKey?: string): string[] {
  const coverage = new Set(
    sourceWeekKeys.filter(key => /^\d{6}$/.test(key) && parseYYMMDD(key)),
  );
  const sortedSource = Array.from(coverage).sort();
  const latestSourceKey = sortedSource.at(-1);
  if (targetWeekKey && /^\d{6}$/.test(targetWeekKey) && parseYYMMDD(targetWeekKey)) {
    if (!latestSourceKey) {
      coverage.add(targetWeekKey);
    } else if (targetWeekKey > latestSourceKey) {
      let cursor = parseYYMMDD(latestSourceKey)!;
      for (let index = 0; index < 520; index += 1) {
        cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 7);
        const nextWeekKey = getWeekKeyForDate(cursor);
        if (nextWeekKey >= targetWeekKey) break;
        coverage.add(nextWeekKey);
      }
      coverage.add(targetWeekKey);
    }
  }
  return Array.from(coverage).sort();
}

function completeImportedWeekCoverage(
  rows: Partial<WorkLogEntry>[],
  sourceWeekKeys: string[],
  targetWeekKey?: string,
): Partial<WorkLogEntry>[] {
  const coverage = buildImportedWeekCoverage(sourceWeekKeys, targetWeekKey);
  if (coverage.length === 0) return rows;
  const latestWeekKey = coverage.at(-1)!;
  return rows.map(row => {
    const weeklyProgress = { ...(row.weeklyProgress || {}) };
    const navScaleHistory = { ...(row.navScaleHistory || {}) };
    let latestProgress = '';
    let latestNavScale = row.navScale || '';
    for (const weekKey of coverage) {
      const progress = String(weeklyProgress[weekKey] ?? '').trim();
      if (progress && progress !== '/') latestProgress = progress;
      else weeklyProgress[weekKey] = latestProgress;

      const navScale = String(navScaleHistory[weekKey] ?? '').trim();
      if (navScale) latestNavScale = navScale;
      else navScaleHistory[weekKey] = latestNavScale;
    }
    return {
      ...row,
      weekKey: latestWeekKey,
      weeklyProgress,
      navScaleHistory,
      navScale: navScaleHistory[latestWeekKey] || row.navScale || '',
    };
  });
}

function isHeaderRow(row: any[]): boolean {
  const columnMap = buildColumnMap(row);
  const recognized = columnMap.filter(info => info.type !== 'ignore');
  const hasIdentityField = recognized.some(
    info => info.type === 'field' && ['productName', 'category', 'status'].includes(info.fieldName || ''),
  );
  return recognized.length >= 2 && hasIdentityField;
}

function isDirectStatusHeader(row: any[]): boolean {
  const map = buildColumnMap(row);
  const fields = map
    .filter(info => info.type === 'field')
    .map(info => info.fieldName);
  return fields.includes('productName') && fields.length >= 2;
}

function isDirectSalesHeader(row: any[]): boolean {
  const fields = buildColumnMap(row)
    .filter(info => info.type === 'field')
    .map(info => info.fieldName || '');
  const salesFields = fields.filter(field => (
    field === 'channelSales'
    || field.startsWith('dynamicFields.channelContact')
    || field.startsWith('dynamicFields.subscriptionRedemption')
    || field.startsWith('dynamicFields.nextSalesPlan')
  ));
  return salesFields.length >= 2;
}

function directOperationValue(row: any[], label: string): string | null {
  const labelIndex = row.findIndex(value => normalizeLabel(value) === normalizeLabel(label));
  if (labelIndex < 0) return null;
  const value = row
    .slice(labelIndex + 1)
    .find(cell => normalizeLabel(cell));
  return value == null ? '' : String(value).trim();
}

function mergeDirectSalesFields(
  target: Partial<WorkLogEntry>,
  source: Partial<WorkLogEntry> | undefined,
) {
  if (!source) return;
  if (source.channelSales) target.channelSales = source.channelSales;
  target.dynamicFields = {
    ...(target.dynamicFields || {}),
    ...(source.dynamicFields || {}),
  };
}

function parseDirectSalesRows(
  data: any[][],
  defaultWeekKey?: string,
): { rows: Partial<WorkLogEntry>[]; errors: { row: number; message: string }[] } {
  const rows: Partial<WorkLogEntry>[] = [];
  const errors: { row: number; message: string }[] = [];
  let currentSubCategory = '';
  let cursor = 0;

  while (cursor < data.length) {
    const raw = data[cursor] || [];
    if (isSectionHeader(raw)) {
      currentSubCategory = String(raw.find(value => normalizeLabel(value)) || '').trim();
      cursor += 1;
      continue;
    }
    if (!isDirectStatusHeader(raw)) {
      cursor += 1;
      continue;
    }

    let blockEnd = cursor + 1;
    while (blockEnd < data.length) {
      if (isSectionHeader(data[blockEnd]) || isDirectStatusHeader(data[blockEnd])) break;
      blockEnd += 1;
    }

    const statusColumnMap = buildColumnMap(raw);
    const blockEntries: Partial<WorkLogEntry>[] = [];
    let firstOperationRow = blockEnd;
    let salesHeaderRow = -1;
    let weeklyReview = '';
    let nextWeekPlan = '';

    for (let rowIndex = cursor + 1; rowIndex < blockEnd; rowIndex += 1) {
      const blockRow = data[rowIndex] || [];
      const review = directOperationValue(blockRow, '一周回顾');
      const plan = directOperationValue(blockRow, '后续计划');
      if (review !== null) {
        weeklyReview = review;
        firstOperationRow = Math.min(firstOperationRow, rowIndex);
      }
      if (plan !== null) {
        nextWeekPlan = plan;
        firstOperationRow = Math.min(firstOperationRow, rowIndex);
      }
      if (isDirectSalesHeader(blockRow)) {
        salesHeaderRow = rowIndex;
        firstOperationRow = Math.min(firstOperationRow, rowIndex);
      }
    }

    for (let rowIndex = cursor + 1; rowIndex < firstOperationRow; rowIndex += 1) {
      const blockRow = data[rowIndex] || [];
      if (!blockRow.some(cell => normalizeLabel(cell))) continue;
      const entry = mapRowToEntry(blockRow, statusColumnMap, '直销产品情况');
      if (!entry.productName) continue;
      entry.subCategory = entry.subCategory || currentSubCategory;
      if (defaultWeekKey) {
        entry.weekKey = defaultWeekKey;
        if (entry.navScale) {
          entry.navScaleHistory = {
            ...(entry.navScaleHistory || {}),
            [defaultWeekKey]: entry.navScale,
          };
        }
      }
      blockEntries.push(entry);
    }

    const salesEntries: Partial<WorkLogEntry>[] = [];
    if (salesHeaderRow >= 0) {
      const salesColumnMap = buildColumnMap(data[salesHeaderRow]);
      for (let rowIndex = salesHeaderRow + 1; rowIndex < blockEnd; rowIndex += 1) {
        const salesRow = data[rowIndex] || [];
        if (!salesRow.some(cell => normalizeLabel(cell))) continue;
        const salesEntry = mapRowToEntry(salesRow, salesColumnMap, '直销产品情况');
        if (salesEntry.channelSales || Object.keys(salesEntry.dynamicFields || {}).length > 0) {
          salesEntries.push(salesEntry);
        }
      }
    }

    blockEntries.forEach((entry, index) => {
      entry.nextWeekPlan = nextWeekPlan || entry.nextWeekPlan || '';
      entry.dynamicFields = {
        ...(entry.dynamicFields || {}),
        weeklyReview,
      };
      if (defaultWeekKey && weeklyReview) {
        entry.weeklyProgress = {
          ...(entry.weeklyProgress || {}),
          [defaultWeekKey]: weeklyReview,
        };
      }
      mergeDirectSalesFields(entry, salesEntries[index] || (blockEntries.length === 1 ? salesEntries[0] : undefined));
      rows.push(entry);
    });

    if (blockEntries.length === 0) {
      errors.push({ row: cursor + 1, message: '[直销产品情况] 产品现状分段未识别到产品数据' });
    }
    cursor = blockEnd;
  }

  if (rows.length === 0) {
    errors.push({ row: 0, message: '[直销产品情况] 未识别到直销产品分段' });
  }
  return { rows, errors };
}

/**
 * 将一行原始数据映射为 WorkLogEntry
 */
function mapRowToEntry(raw: any[], colMap: ColumnInfo[], category: string): Partial<WorkLogEntry> {
  const entry: Record<string, any> = {
    category,
    subCategory: '',
    weeklyProgress: {},
    navScaleHistory: {},
    dynamicFields: {},
  };

  const progressColumns = colMap
    .map((info, index) => ({ info, index, date: info.progressKey ? parseYYMMDD(info.progressKey) : null }))
    .filter(item => item.info.type === 'progress' && item.info.progressKey && item.date)
    .sort((left, right) => right.date!.getTime() - left.date!.getTime());

  colMap.forEach((info, idx) => {
    const val = raw[idx];
    if (val == null || val === '') return;

    if (info.type === 'field' && info.fieldName) {
      const fieldName = info.fieldName;

      if (fieldName.startsWith('dynamicFields.')) {
        entry.dynamicFields[fieldName.slice('dynamicFields.'.length)] = String(val).trim();
        return;
      }

      // 数值字段
      if (['nav', 'yearStartNav', 'changePercent'].includes(fieldName)) {
        const num = Number(val);
        entry[fieldName] = isNaN(num) ? 0 : num;
    } else {
      // 日期字段：处理 Excel 序列号
      if (['establishDate', 'deadline'].includes(fieldName) && typeof val === 'number') {
        // Excel 序列号 → YYYY-MM-DD
        const serial = val;
        if (serial >= 1 && serial <= 2958465) {
          entry[fieldName] = excelSerialToISODate(serial);
        } else {
          entry[fieldName] = String(val).trim();
        }
      } else {
        entry[fieldName] = String(val).trim();
      }
    }
    } else if (info.type === 'progress' && info.progressKey) {
      const text = String(val).trim();
      if (text && text !== '/') {
        entry.weeklyProgress[info.progressKey] = text;
      }
    } else if (info.type === 'navscale' && info.progressKey) {
      const text = String(val).trim();
      if (text) {
        entry.navScaleHistory[info.progressKey] = text;
      }
    }
  });

  // 最新的“上周进展”为空时，按日期向前查找同一行最近一次非空内容并继承。
  // 历史列原值仍完整保留，只补齐最新目标周。
  if (progressColumns.length > 0) {
    const latest = progressColumns[0];
    const latestKey = latest.info.progressKey!;
    const latestText = String(raw[latest.index] ?? '').trim();
    if (!latestText || latestText === '/') {
      const fallback = progressColumns
        .slice(1)
        .map(item => ({
          key: item.info.progressKey!,
          text: String(raw[item.index] ?? '').trim(),
        }))
        .find(item => item.text && item.text !== '/');
      if (fallback) entry.weeklyProgress[latestKey] = fallback.text;
    }
  }

  // 如果没有 category 则使用 sheet 默认分类
  if (!entry.category || entry.category === '') {
    entry.category = category;
  }

  // 确定 weekKey：取最新进展日期的周五
  if (progressColumns.length > 0) {
    const latestDate = progressColumns[0].date!;
    entry.weekKey = getWeekKeyForDate(latestDate);

    // 将当前净值/规模情况记录到该周的 navScaleHistory
    if (entry.navScale) {
      entry.navScaleHistory[entry.weekKey] = entry.navScale;
    }
  }

  return entry as Partial<WorkLogEntry>;
}

/**
 * 将 YYMMDD 解析为 Date
 */
function parseYYMMDD(key: string): Date | null {
  if (!key || key.length !== 6) return null;
  const year = 2000 + parseInt(key.substring(0, 2), 10);
  const month = parseInt(key.substring(2, 4), 10) - 1;
  const day = parseInt(key.substring(4, 6), 10);
  if (isNaN(year) || isNaN(month) || isNaN(day)) return null;
  return new Date(year, month, day);
}

/** 仅供解析器单元测试使用，业务代码请调用 parseWorkLogXLSX。 */
export const workLogImportInternals = {
  resolveSheetNames,
  buildColumnMap,
  alignProgressColumnMap,
  buildImportedWeekCoverage,
  completeImportedWeekCoverage,
  mapRowToEntry,
  parseDirectSalesRows,
  excelSerialToISODate,
};
