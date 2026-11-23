// CSV / Excel 文件导出与解析
import type ExcelJS from 'exceljs';
import { PRODUCT_HEADER_MAP } from './fieldMaps';

// ============================================================
// 样式常量 — 匹配导入模板（参考/工作日志.xlsx）风格
// ============================================================
const BORDER_THIN = {
  top: { style: 'thin' as const, color: { argb: 'FF000000' } },
  left: { style: 'thin' as const, color: { argb: 'FF000000' } },
  bottom: { style: 'thin' as const, color: { argb: 'FF000000' } },
  right: { style: 'thin' as const, color: { argb: 'FF000000' } },
};

const TEMPLATE_STYLE = {
  // 表头行：9pt 宋体 加粗 居中 无填色 细边框
  header: {
    font: { name: '宋体', bold: true, size: 9 },
    alignment: { horizontal: 'center' as const, vertical: 'middle' as const, wrapText: true },
    border: BORDER_THIN,
  },
  // 数据行：9pt 宋体 左对齐 无填色 细边框
  data: {
    font: { name: '宋体', size: 9 },
    alignment: { horizontal: 'left' as const, vertical: 'middle' as const, wrapText: true },
    border: BORDER_THIN,
  },
  // 数据数值列：9pt Times New Roman 左对齐
  dataNumeric: {
    font: { name: 'Times New Roman', size: 9 },
    alignment: { horizontal: 'left' as const, vertical: 'middle' as const, wrapText: true },
    border: BORDER_THIN,
  },
  // 表头数值列：9pt Times New Roman 加粗 居中
  headerNumeric: {
    font: { name: 'Times New Roman', bold: true, size: 9 },
    alignment: { horizontal: 'center' as const, vertical: 'middle' as const, wrapText: true },
    border: BORDER_THIN,
  },
  // 直销表头：宋体 9pt 加粗 居中 白底（无填充）
  directSalesHeader: {
    font: { name: '宋体', bold: true, size: 9 },
    alignment: { horizontal: 'center' as const, vertical: 'middle' as const, wrapText: true },
    border: BORDER_THIN,
  },
  // 分类标题行（如"1、固收系列"）：黄色底 + 加粗
  sectionHeader: {
    font: { name: '宋体', bold: true, size: 9 },
    fill: { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFFFFF00' } },
    alignment: { horizontal: 'center' as const, vertical: 'middle' as const, wrapText: true },
    border: BORDER_THIN,
  },
  // 操作项标签（"一周回顾"、"后续计划"）：加粗居中
  opLabel: {
    font: { name: '宋体', bold: true, size: 9 },
    alignment: { horizontal: 'center' as const, vertical: 'middle' as const, wrapText: true },
    border: BORDER_THIN,
  },
  // 操作项内容：左对齐
  opValue: {
    font: { name: 'Times New Roman', size: 9 },
    alignment: { horizontal: 'left' as const, vertical: 'middle' as const, wrapText: true },
    border: BORDER_THIN,
  },
};

// ============================================================
// 列宽映射 — 严格匹配参考模板（工作日志.xlsx）
// ============================================================

// 固定列宽度（标题 → 宽度），按模板提取
const COL_WIDTH_MAP: Record<string, number> = {
  '正常项目': 16,
  '状态': 19,
  '产品名': 30,
  '客户名称/类型': 31,
  '净值/规模情况': 29,
  '成立日/拟成立日': 18,
  '渠道销售': 18,
  '下周工作计划': 23,
  '后续举措': 23,
  'A角': 14,
  'B角': 22,
  '主动/被动': 24,
  '集合/单一': 22,
  '投资顾问/管理人': 26,
  '产品期限': 15,
  '特色': 26,
  '管理报告': 26,
  '风控报告': 22,
  '销售端报告': 24,
  '日期': 5,
  '净值': 10,
  '年初净值': 12,
  '涨跌幅': 11,
  '结果': 28,
  '问题项目': 16,
  '项目名称': 30,
  '项目情况': 31,
  '客户名称': 31,
  '项目规模': 29,
  '（万）': 16,
  '规模（万）': 16,
  '目标规模（万）': 16,
  '较上周': 11,
  '销售渠道': 22,
  '渠道对接人': 16,
  '当周申赎情况': 24,
  '下一步工作计划': 22,
  '分类': 16,
  '预计最晚化解时间': 18,
  '进展是否达预期': 18,
  '持仓超10%的个券细节': 26,
  '权益资产占比': 16,
  '是否触及预警/平仓线': 20,
  '关注点': 18,
  '项目经理A': 14,
  '项目经理B': 22,
  '净值/规模情况历史': 20,
};
// 进展列宽度（上周进展(...)）
const PROGRESS_COL_WIDTH = 24;
// 分隔行高
const ROW_HEIGHT_SEPARATOR = 11.65;

// 正常项目表头灰色（theme=0, tint=-0.25 → ~#D9D9D9）
const FILL_HEADER_GRAY = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFD9D9D9' } };
// 正常项目数据区浅绿底（theme=9, tint=0.6 → #C6E0B4）
const FILL_LIGHT_GREEN = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFC6E0B4' } };
// 问题项目表头/A列橙色底（Accent 1 #C65911）
const FILL_PROBLEM_HEADER = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFC65911' } };
// 净值列黄色底
const FILL_YELLOW = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFFFFF00' } };

// ============================================================
// 通用导出函数（匹配导入模板风格）
// ============================================================

/**
 * 导出工作日志 Excel，风格严格匹配导入模板
 * - 正常项目：最新进展列前置
 *   列顺序：top → 最新周进展 → mid(成立日/渠道) → bottom → extra(净值记录) → 其余历史进展
 *   配色：表头全部灰色、数据A列白底、数据B+列浅绿底
 * - 问题项目：全部进展列居中
 *   列顺序：top → 全部进展列 → bottom
 *   配色：表头和A列蓝色灰底、B+列无填色
 * - 直销产品情况：三段嵌套结构（系列标题→现状表→运作表→销售表）
 */
export async function exportWorkLogToXLSX(
  normalData: {
    topCols: { title: string; field: string }[];
    midCols: { title: string; field: string }[];
    bottomCols: { title: string; field: string }[];
    extraCols: { title: string; field: string }[];
    data: Record<string, any>[];
    progressKeys: string[];
    currentProgressKey?: string;
  },
  problemData: {
    topCols: { title: string; field: string }[];
    bottomCols: { title: string; field: string }[];
    data: Record<string, any>[];
    progressKeys: string[];
  },
  directSalesData: { entries: any[]; series: DirectSalesSeries[] },
  filename: string,
  destination?: import('./fileSave').SaveDestination,
) {
  const { default: ExcelJSModule } = await import('exceljs');
  const wb = new ExcelJSModule.Workbook();
  wb.creator = '国际部工作日志系统';
  wb.created = new Date();

  // ===== Sheet 1: 正常项目（最新进展列前置） =====
  if (normalData.data.length > 0) {
    const ws = wb.addWorksheet('正常项目', {
      pageSetup: { orientation: 'landscape', fitToPage: true },
    });
    writeFlatSheet(ws, normalData.topCols, normalData.midCols, normalData.bottomCols, normalData.extraCols,
      normalData.data, normalData.progressKeys, 'normal', normalData.currentProgressKey);
  }

  // ===== Sheet 2: 问题项目 =====
  if (problemData.data.length > 0) {
    const ws = wb.addWorksheet('问题项目', {
      pageSetup: { orientation: 'landscape', fitToPage: true },
    });
    // 问题项目用 writeFlatSheet，variant='problem', bottomCols 传入
    writeFlatSheet(ws, problemData.topCols, [], problemData.bottomCols ?? [], [], problemData.data, problemData.progressKeys, 'problem');
  }

  // ===== Sheet 3: 直销产品情况（三段嵌套结构） =====
  if (directSalesData.entries.length > 0 || directSalesData.series.length > 0) {
    const ws = wb.addWorksheet('直销产品情况', {
      pageSetup: { orientation: 'landscape', fitToPage: true },
    });
    writeDirectSalesSheet(ws, directSalesData.series, directSalesData.entries);
  }

  // ---------- 生成并下载 ----------
  const buffer = await wb.xlsx.writeBuffer();
  const { saveXlsxBlob, XLSX_MIME } = await import('./fileSave');
  const blob = new Blob([buffer], { type: XLSX_MIME });
  await saveXlsxBlob(blob, filename, destination ?? { kind: 'download' });
}

// ============================================================
// 直销产品情况 Series 接口
// ============================================================

/**
 * 直销产品情况的系列数据
 */
interface DirectSalesSeries {
  title: string;                   // 系列标题（如"1、固收系列"）
  statusHeaders: string[];         // 现状表头
  statusRows: string[][];          // 现状数据行
  operationItems: { label: string; value: string }[];  // 运作项（一周回顾/后续计划）
  salesHeaders: string[];          // 销售表头
  salesRows: string[][];           // 销售数据行
}

// 数值列标题识别（匹配模板：数值用 Times New Roman，文本用宋体）
const NUMERIC_TITLES = new Set(['净值', '年初净值', '涨跌幅', '较上周']);

/**
 * 写入扁平表格（正常项目 / 问题项目）
 *
 * 正常项目列序：top → [当前进展] → mid(成立日/渠道) → bottom(下周~销售端) → extra(净值记录6列) → 其余历史进展
 * 问题项目列序：top → 全部进展列 → bottom
 *
 * 配色差异：
 *   normal:  表头全部灰色(#D9D9D9)、数据A白底、数据B+浅绿底(#C6E0B4)
 *   problem: 表头+A列橙色底(#C65911)、进展列空白格黄色底、其余白底
 */
function writeFlatSheet(
  ws: ExcelJS.Worksheet,
  topCols: { title: string; field: string }[],
  midCols: { title: string; field: string }[],
  bottomCols: { title: string; field: string }[],
  extraCols: { title: string; field: string }[],
  data: Record<string, any>[],
  progressKeys: string[],
  variant: 'normal' | 'problem' = 'normal',
  currentProgressKey?: string,
) {
  // 构建表头列表
  let headers: string[];
  if (variant === 'normal') {
    headers = [
      ...topCols.map(c => c.title),
      ...(currentProgressKey ? [`上周进展(${currentProgressKey})`] : []),
      ...midCols.map(c => c.title),
      ...bottomCols.map(c => c.title),
      ...extraCols.map(c => c.title),
      ...progressKeys.filter(k => k !== currentProgressKey).map(k => `上周进展(${k})`),
    ];
  } else {
    // problem: 全部进展列夹在 top 和 bottom 之间
    headers = [
      ...topCols.map(c => c.title),
      ...progressKeys.map(k => `上周进展(${k})`),
      ...bottomCols.map(c => c.title),
    ];
  }

  const headerFill = variant === 'normal' ? FILL_HEADER_GRAY : FILL_PROBLEM_HEADER;

  // ---------- 写入表头 ----------
  const headerRow = ws.addRow(headers);
  headerRow.height = 27;  // 匹配模板表头行高
  headers.forEach((_, idx) => {
    const cell = headerRow.getCell(idx + 1);
    // 问题项目表头蓝底白字，正常项目表头灰底黑字
    if (variant === 'problem') {
      cell.font = { ...TEMPLATE_STYLE.header.font, color: { argb: 'FFFFFFFF' } };
    } else if (NUMERIC_TITLES.has(headers[idx])) {
      // 数值列表头用 Times New Roman（匹配模板）
      cell.font = TEMPLATE_STYLE.headerNumeric.font;
    } else {
      cell.font = TEMPLATE_STYLE.header.font;
    }
    cell.alignment = TEMPLATE_STYLE.header.alignment;
    cell.border = TEMPLATE_STYLE.header.border;
    cell.fill = headerFill;  // 所有表头同一个颜色
  });

  // ---------- 写入数据行 ----------
  data.forEach(row => {
    const values = headers.map(h => {
      if (h.startsWith('上周进展(')) {
        const key = h.replace('上周进展(', '').replace(')', '');
        return row.weeklyProgress?.[key] || '';
      }
      return row[h] ?? '';
    });
    const excelRow = ws.addRow(values);

    headers.forEach((_header, colIdx) => {
      const cell = excelRow.getCell(colIdx + 1);

      // 配色逻辑
      if (variant === 'normal') {
        // 正常项目：A列白底，B+列浅绿底
        // 净值记录区（extra 列）：产品名/日期/年初净值/涨跌幅/结果白底，净值列黄色底
        if (colIdx > 0) {
          const extraStart = topCols.length + (currentProgressKey ? 1 : 0) + midCols.length + bottomCols.length;
          const extraEnd = extraStart + extraCols.length;
          const isExtra = colIdx >= extraStart && colIdx < extraEnd;
          if (isExtra) {
            // 净值记录区
            if (headers[colIdx] === '净值') {
              cell.fill = FILL_YELLOW;
            }
            // 其余 extra 列白底（无 fill）
          } else if (colIdx < extraStart) {
            // 主数据区（B+ 到 extra 前）：浅绿底
            cell.fill = FILL_LIGHT_GREEN;
          }
          // extra 之后的进展列：白底
        }
      } else {
        // 问题项目：A列橙色底白字
        if (colIdx === 0) {
          cell.fill = FILL_PROBLEM_HEADER;
          cell.font = { ...TEMPLATE_STYLE.data.font, color: { argb: 'FFFFFFFF' } };
          return;  // 已设字体，跳过通用字体设置
        }
        // 上周进展列：空白格子黄色底，有内容白底
        if (headers[colIdx].startsWith('上周进展(')) {
          const isEmpty = cell.value === null || cell.value === '' || cell.value === undefined;
          if (isEmpty) {
            cell.fill = FILL_YELLOW;
          }
          // 有内容的格子保持白底
        }
      }

      // 数值列用 Times New Roman，文本列用宋体
      cell.font = NUMERIC_TITLES.has(headers[colIdx])
        ? TEMPLATE_STYLE.dataNumeric.font
        : TEMPLATE_STYLE.data.font;
      cell.alignment = TEMPLATE_STYLE.data.alignment;
      cell.border = TEMPLATE_STYLE.data.border;
    });
  });

  // ---------- 按列标题设置列宽（匹配模板） ----------
  headers.forEach((h, idx) => {
    const col = ws.getColumn(idx + 1);
    if (h.startsWith('上周进展(')) {
      col.width = PROGRESS_COL_WIDTH;
    } else if (h === '产品名' && idx > 15) {
      // extra 区的净值记录部分：产品名列稍窄
      col.width = 28;
    } else {
      col.width = COL_WIDTH_MAP[h] ?? 16;
    }
  });
}

/**
 * 写入直销产品情况 Sheet（三段嵌套结构）
 * 严格匹配模板格式：
 *   系列标题（黄色底）
 *   现状表头 + 数据行
 *   一周回顾 + 内容（合并单元格）
 *   后续计划 + 内容（合并单元格）
 *   销售表头 + 数据行
 *   (系列间分隔行)
 */
function writeDirectSalesSheet(
  ws: ExcelJS.Worksheet,
  series: DirectSalesSeries[],
  fallbackEntries: any[],
) {
  // 确定最大列数
  let maxCols = 7; // 模板默认7列

  if (series.length === 0) {
    // 无系列数据时，用退路模式输出扁平表格
    const topCols = [
      { title: '产品名称', field: 'productName' },
      { title: '规模（万）', field: 'navScale' },
      { title: '目标规模（万）', field: 'productTerm' },
      { title: '净值', field: 'nav' },
      { title: '较上周', field: 'changePercent' },
    ];
    writeFlatSheet(ws, topCols, [], [], [], fallbackEntries, [], 'normal');
    return;
  }

  for (let si = 0; si < series.length; si++) {
    const s = series[si];

    // 1) 系列标题行（黄色底）
    const titleRow = ws.addRow([s.title]);
    titleRow.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = TEMPLATE_STYLE.sectionHeader.font;
      cell.fill = TEMPLATE_STYLE.sectionHeader.fill!;
      cell.alignment = TEMPLATE_STYLE.sectionHeader.alignment;
      cell.border = TEMPLATE_STYLE.sectionHeader.border;
    });

    // 2) 现状表头（白底，模板无填充色）
    const statusHeaderRow = ws.addRow(s.statusHeaders);
    s.statusHeaders.forEach((_, idx) => {
      const cell = statusHeaderRow.getCell(idx + 1);
      cell.font = TEMPLATE_STYLE.directSalesHeader.font;
      cell.alignment = TEMPLATE_STYLE.directSalesHeader.alignment;
      cell.border = TEMPLATE_STYLE.directSalesHeader.border;
    });
    maxCols = Math.max(maxCols, s.statusHeaders.length);

    // 3) 现状数据行（居中，数值列 Times New Roman）
    s.statusRows.forEach(row => {
      const dataRow = ws.addRow(row);
      row.forEach((_, idx) => {
        const cell = dataRow.getCell(idx + 1);
        const colName = s.statusHeaders[idx] || '';
        cell.font = NUMERIC_TITLES.has(colName)
          ? TEMPLATE_STYLE.dataNumeric.font
          : TEMPLATE_STYLE.data.font;
        cell.alignment = { horizontal: 'center' as const, vertical: 'middle' as const, wrapText: true };
        cell.border = TEMPLATE_STYLE.data.border;
      });
      maxCols = Math.max(maxCols, row.length);
    });

    // 4) 运作项（一周回顾 / 后续计划）— 标签在A列，内容合并B到最后一列
    s.operationItems.forEach(item => {
      // 先填充整行空值，再设置具体值
      const row = new Array(maxCols).fill('');
      row[0] = item.label;
      row[1] = item.value;
      const dataRow = ws.addRow(row);
      dataRow.height = ROW_HEIGHT_SEPARATOR;  // 匹配模板矮行高

      // 标签列（A列）
      const labelCell = dataRow.getCell(1);
      labelCell.font = TEMPLATE_STYLE.opLabel.font;
      labelCell.alignment = TEMPLATE_STYLE.opLabel.alignment;
      labelCell.border = TEMPLATE_STYLE.opLabel.border;

      // 内容列（B列到最后一列）合并
      if (maxCols > 1) {
        ws.mergeCells(dataRow.number, 2, dataRow.number, maxCols);
      }
      const valueCell = dataRow.getCell(2);
      valueCell.font = TEMPLATE_STYLE.opValue.font;
      valueCell.alignment = TEMPLATE_STYLE.opValue.alignment;
      valueCell.border = TEMPLATE_STYLE.opValue.border;
    });

    // 5) 销售表头（白底，模板无填充色）
    if (s.salesHeaders.length > 0) {
      const salesHeaderRow = ws.addRow(s.salesHeaders);
      s.salesHeaders.forEach((_, idx) => {
        const cell = salesHeaderRow.getCell(idx + 1);
        cell.font = TEMPLATE_STYLE.directSalesHeader.font;
        cell.alignment = TEMPLATE_STYLE.directSalesHeader.alignment;
        cell.border = TEMPLATE_STYLE.directSalesHeader.border;
      });
      maxCols = Math.max(maxCols, s.salesHeaders.length);
    }

    // 6) 销售数据行（居中，数值列 Times New Roman）
    s.salesRows.forEach(row => {
      const dataRow = ws.addRow(row);
      row.forEach((_, idx) => {
        const cell = dataRow.getCell(idx + 1);
        const colName = s.salesHeaders[idx] || '';
        cell.font = NUMERIC_TITLES.has(colName)
          ? TEMPLATE_STYLE.dataNumeric.font
          : TEMPLATE_STYLE.data.font;
        cell.alignment = { horizontal: 'center' as const, vertical: 'middle' as const, wrapText: true };
        cell.border = TEMPLATE_STYLE.data.border;
      });
      maxCols = Math.max(maxCols, row.length);
    });

    // 7) 系列间分隔行（最后一个系列后不加）
    if (si < series.length - 1) {
      const sepRow = ws.addRow([]);
      sepRow.height = ROW_HEIGHT_SEPARATOR;
    }
  }

  // 按列标题设置宽度（直销表：现状表头+销售表头混合）
  for (let i = 1; i <= maxCols; i++) {
    ws.getColumn(i).width = 16;
  }
}

// ============================================================
// CSV 导出（保持不变）
// ============================================================

/**
 * 将数据导出为 CSV 文件并触发下载（CSV 不支持样式，保持简洁）
 */
export function exportToCSV(data: any[], filename: string = 'export.csv') {
  if (!data.length) return;

  const headers = Object.keys(data[0]);
  const csvContent = [
    headers.join(','),
    ...data.map(row =>
      headers.map(header => {
        const value = row[header];
        const stringValue = String(value ?? '');
        if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
          return `"${stringValue.replace(/"/g, '""')}"`;
        }
        return stringValue;
      }).join(',')
    )
  ].join('\n');

  const blob = new Blob(['﻿' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * 下载 Blob 辅助函数
 */
export function downloadBlob(content: string, filename: string, mime: string = 'text/csv;charset=utf-8;') {
  const blob = new Blob(['﻿' + content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ============================================================
// 中文标题 → 字段名映射
// ============================================================
// 导入时使用统一的产品字段映射表（保持向后兼容的导出名）
const HEADER_MAP = PRODUCT_HEADER_MAP;
export { HEADER_MAP };

// ============================================================
// CSV 解析工具（导入用）
// ============================================================

/** CSV 行解析器（状态机） */
export function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
  }
  result.push(current);
  return result;
}

/** 合并跨行字段 */
export function mergeMultiLineRows(rawLines: string[]): string[] {
  const merged: string[] = [];
  let buffer = '';
  let inQuotes = false;
  for (const line of rawLines) {
    if (buffer) {
      buffer += '\n' + line;
    } else {
      buffer = line;
    }
    for (const ch of line) {
      if (ch === '"') inQuotes = !inQuotes;
    }
    if (!inQuotes) {
      merged.push(buffer);
      buffer = '';
    }
  }
  if (buffer) merged.push(buffer);
  return merged;
}

/** 去除 BOM */
export function stripBOM(text: string): string {
  if (text.charCodeAt(0) === 0xFEFF) return text.slice(1);
  return text;
}
