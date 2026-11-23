// 导入工具（CSV/XLSX 解析、模板生成、派生字段计算）
import {SystemSettings, InvestmentProduct, ParseResult} from'../types';
import {parseCSVLine, mergeMultiLineRows, stripBOM, downloadBlob} from'./csvCore';
import { parseProjectSheets } from './project-import-core';
import {
  calculateDerivedFields as calculateProjectDerivedFields,
  computeIncome as computeProjectIncome,
} from './investmentCalculations';

/**
 * 生成导入模板（只有标题行的 CSV）
 */
export function generateImportTemplate(settings: SystemSettings) {const headers = ['产品名称','USD','RMB','费率','成立时间','标的','委托人','券商渠道','策略','托管行','交易券商','年度收益','今年收益','业绩报酬','状态','A角','B角','期限','备注',
 ];
 settings.customColumns.forEach(col => headers.push(col.title));

 const csvLine = headers.map(h => {if (h.includes(',') || h.includes('"') || h.includes('\n')) {return`"${h.replace(/"/g,'""')}"`;}
 return h;}).join(',');

 downloadBlob(csvLine +'\n','导入模板_投资产品.csv');}

/**
 * 解析 CSV 文本
 */
export function parseCSV(text: string, settings: SystemSettings): ParseResult {const cleaned = stripBOM(text).replace(/\r\n/g,'\n').replace(/\r/g,'\n');
 const rawLines = cleaned.split('\n').filter(line => line.trim() !=='');
 if (rawLines.length === 0) {return {rows: [], errors: [{row: 0, message:'文件为空'}], totalRows: 0, successRows: 0};}

 const mergedLines = mergeMultiLineRows(rawLines);
 if (mergedLines.length < 1) {return {rows: [], errors: [{row: 0, message:'文件为空'}], totalRows: 0, successRows: 0};}
 return parseProjectSheets(
  [{name: 'CSV', rows: mergedLines.map(line => parseCSVLine(line))}],
  settings,
 );}

/**
 * 解析 XLSX 文件
 */
export async function parseXLSX(buffer: ArrayBuffer, settings: SystemSettings): Promise<ParseResult> {const XLSX = await import('xlsx');
 const workbook = XLSX.read(buffer, {type:'array', cellDates: true});
 const sheets = workbook.SheetNames.map(name => ({
  name,
  rows: XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], {
   header: 1,
   defval: '',
   raw: true,
   blankrows: true,
  }) as unknown[][],
 }));
 return parseProjectSheets(sheets, settings);}

/**
 * 通用收入计算：根据 RMB、费率、成立日计算年化收入、今年收入、绩效收入
 */
export function computeIncome(
 rmb: number,
 feeRate: number,
 establishDate?: string,
 deadline?: string,
): {annualIncome: number; thisYearIncome: number; performanceIncome: number} {
 return computeProjectIncome(rmb, feeRate, establishDate, deadline);
}

/**
 * 自动计算派生字段（兼容旧接口，内部使用 computeIncome）
 */
export function calculateDerivedFields(row: Partial<InvestmentProduct>, exchangeRate: number): Partial<InvestmentProduct> {
 return calculateProjectDerivedFields(row, exchangeRate);
}
