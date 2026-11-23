import type { WorkLogEntry } from '../types';
import { exportWorkLogToXLSX } from './csv';
import { chooseXlsxDestination } from './fileSave';

interface ExportManagementWorkLogOptions {
  entries: WorkLogEntry[];
  scopeLabel: string;
}

type ExportColumn = { title: string; field: string };

const NORMAL_TOP_COLS: ExportColumn[] = [
  { title: '正常项目', field: '_classification' },
  { title: '状态', field: 'status' },
  { title: '产品名', field: 'productName' },
  { title: '客户名称/类型', field: 'clientType' },
  { title: '净值/规模情况', field: 'navScale' },
];

const NORMAL_MID_COLS: ExportColumn[] = [
  { title: '成立日/拟成立日', field: 'establishDate' },
  { title: '渠道销售', field: 'channelSales' },
];

const NORMAL_BOTTOM_COLS: ExportColumn[] = [
  { title: '下周工作计划', field: 'nextWeekPlan' },
  { title: 'A角', field: 'personA' },
  { title: 'B角', field: 'personB' },
  { title: '主动/被动', field: 'activePassive' },
  { title: '集合/单一', field: 'collectiveSingle' },
  { title: '投资顾问/管理人', field: 'advisorManager' },
  { title: '产品期限', field: 'productTerm' },
  { title: '特色', field: 'features' },
  { title: '管理报告', field: 'managementReport' },
  { title: '风控报告', field: 'riskReport' },
  { title: '销售端报告', field: 'salesReport' },
];

const NORMAL_EXTRA_COLS: ExportColumn[] = [
  { title: '产品名', field: 'productName' },
  { title: '日期', field: '' },
  { title: '净值', field: 'nav' },
  { title: '年初净值', field: 'yearStartNav' },
  { title: '涨跌幅', field: 'changePercent' },
  { title: '结果', field: '' },
];

const PROBLEM_TOP_COLS: ExportColumn[] = [
  { title: '问题项目', field: '_classification' },
  { title: '项目名称', field: 'productName' },
  { title: '项目情况', field: 'description' },
  { title: '客户名称', field: 'clientType' },
  { title: '项目规模', field: 'navScale' },
];

const PROBLEM_BOTTOM_COLS: ExportColumn[] = [
  { title: '预计最晚化解时间', field: 'deadline' },
  { title: '后续举措', field: 'nextWeekPlan' },
  { title: '进展是否达预期', field: '' },
  { title: '项目经理A', field: 'personA' },
  { title: '项目经理B', field: 'personB' },
  { title: '主动/被动', field: 'activePassive' },
  { title: '集合/单一', field: 'collectiveSingle' },
  { title: '投资顾问/管理人', field: 'advisorManager' },
  { title: '产品期限', field: 'productTerm' },
  { title: '特色', field: 'features' },
  { title: '管理报告', field: 'managementReport' },
  { title: '风控报告', field: 'riskReport' },
  { title: '销售端报告', field: 'salesReport' },
];

function getClassification(activePassive: string, collectiveSingle: string): string {
  if (activePassive === '主动') {
    if (collectiveSingle === '集合') return '资产管理';
    return '资产服务（主动管理）';
  }
  return '资产服务（事务管理）';
}

function getCategory(entry: WorkLogEntry): 'normal' | 'problem' | 'directSales' {
  if (entry.category === '问题项目') return 'problem';
  if (entry.category === '直销产品情况') return 'directSales';
  return 'normal';
}

function buildFlatExportData(
  entries: WorkLogEntry[],
  topCols: ExportColumn[],
  midCols: ExportColumn[],
  bottomCols: ExportColumn[],
  extraCols: ExportColumn[],
) {
  const progressWeeks = new Set<string>();
  entries.forEach(entry => {
    Object.keys(entry.weeklyProgress || {}).forEach(key => progressWeeks.add(key));
  });

  const progressKeys = Array.from(progressWeeks).sort();
  const currentProgressKey = progressKeys.length > 0 ? progressKeys[progressKeys.length - 1] : undefined;
  const dateMMDD = currentProgressKey ? currentProgressKey.slice(-4) : '';
  const allCols = [...topCols, ...midCols, ...bottomCols, ...extraCols];
  let previousClassification = '';

  return {
    topCols,
    midCols,
    bottomCols,
    extraCols,
    currentProgressKey,
    data: entries.map((entry, index) => {
      const row: Record<string, any> = {};

      allCols.forEach(col => {
        if (col.field === '_classification') {
          if (getCategory(entry) === 'problem') {
            row[col.title] = String(index + 1);
          } else {
            const classification = getClassification(entry.activePassive || '', entry.collectiveSingle || '');
            row[col.title] = classification === previousClassification ? '' : classification;
            previousClassification = classification;
          }
          return;
        }

        if (col.field === '') {
          if (col.title === '日期') {
            row[col.title] = dateMMDD ? `2026/${dateMMDD.slice(0, 2)}/${dateMMDD.slice(2)}` : '';
          } else if (col.title === '结果') {
            const nav = entry.nav ?? 0;
            const yearStartNav = entry.yearStartNav ?? 0;
            const pct = yearStartNav > 0 ? (((nav - yearStartNav) / yearStartNav) * 100).toFixed(2) : '0.00';
            row[col.title] = `截止${dateMMDD}净值${nav}(年初${yearStartNav}),较年初净值变动${pct}%`;
          } else {
            row[col.title] = '';
          }
          return;
        }

        row[col.title] = (entry as any)[col.field] ?? '';
      });

      row.weeklyProgress = entry.weeklyProgress;
      return row;
    }),
    progressKeys,
  };
}

function normalClassificationRank(entry: WorkLogEntry): number {
  if (entry.activePassive === '\u4e3b\u52a8') {
    return entry.collectiveSingle === '\u96c6\u5408' ? 0 : 1;
  }
  return 2;
}

function buildDirectSalesSeries(entries: WorkLogEntry[]) {
  const inferSeriesKey = (entry: WorkLogEntry): string => {
    if (entry.subCategory) return entry.subCategory;
    const name = entry.productName || '';
    if (name.includes('固收')) return '固收系列';
    if (name.includes('含权')) return '含权系列';
    if (name.includes('权益')) return '权益类';
    if (name.includes('跨境') || name.includes('盈泰')) return '含权系列';
    return '其他';
  };

  const groups = new Map<string, WorkLogEntry[]>();
  entries.forEach(entry => {
    const key = inferSeriesKey(entry);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(entry);
  });

  const getStatusConfig = (groupName: string) => {
    const common = ['产品名称', '规模（万）', '目标规模（万）', '净值', '较上周'];
    const extraCols: string[] = [];

    if (groupName.includes('固收')) {
      extraCols.push('持仓超10%的个券细节');
    } else if (groupName.includes('含权')) {
      extraCols.push('权益资产占比', '是否触及预警/平仓线');
    } else if (groupName.includes('权益')) {
      extraCols.push('关注点', '是否触及预警/平仓线');
    }

    return {
      headers: [...common, ...extraCols],
      rowBuilder: (entry: WorkLogEntry) => [
        entry.productName || '',
        entry.navScale || '',
        entry.productTerm || '',
        entry.nav != null ? String(entry.nav) : '',
        entry.changePercent != null ? String(entry.changePercent) : '',
        ...extraCols.map(col => {
          if (col.includes('持仓')) return entry.dynamicFields?.holdingsOver10 || '';
          if (col.includes('权益资产占比')) return entry.dynamicFields?.equityAssetRatio || '';
          if (col.includes('预警')) return entry.dynamicFields?.warningLineStatus || '';
          if (col.includes('关注点')) return entry.dynamicFields?.focusPoint || '';
          return '';
        }),
      ],
    };
  };

  let seriesIndex = 1;
  const series: any[] = [];
  const salesHeaders = ['销售渠道', '渠道对接人', '当周申赎情况', '下一步工作计划'];

  for (const [groupName, groupEntries] of groups) {
    const statusConfig = getStatusConfig(groupName);
    const allOps: string[] = [];
    const allPlans: string[] = [];

    groupEntries.forEach(entry => {
      Object.values(entry.weeklyProgress || {}).forEach(value => {
        if (value && value !== '/' && !allOps.includes(value)) allOps.push(value);
      });
      if (entry.nextWeekPlan && !allPlans.includes(entry.nextWeekPlan)) allPlans.push(entry.nextWeekPlan);
    });

    series.push({
      title: `${seriesIndex}、${groupName}`,
      statusHeaders: statusConfig.headers,
      statusRows: groupEntries.map(entry => statusConfig.rowBuilder(entry)),
      operationItems: [
        { label: '一周回顾', value: groupEntries.map(entry => entry.dynamicFields?.weeklyReview).filter(Boolean).join('；') || allOps.join('；') || '' },
        { label: '后续计划', value: allPlans.join('；') || '' },
      ],
      salesHeaders,
      salesRows: groupEntries.map(entry => [
        entry.channelSales || '',
        entry.dynamicFields?.channelContact || '',
        entry.dynamicFields?.subscriptionRedemption || '',
        entry.dynamicFields?.nextSalesPlan || entry.nextWeekPlan || '',
      ]),
    });

    seriesIndex += 1;
  }

  return series;
}

export async function exportManagementWorkLog({ entries, scopeLabel }: ExportManagementWorkLogOptions) {
  const normalEntries = entries
    .filter(entry => getCategory(entry) === 'normal')
    .map((entry, sourceIndex) => ({ entry, sourceIndex }))
    .sort((left, right) => normalClassificationRank(left.entry) - normalClassificationRank(right.entry)
      || left.sourceIndex - right.sourceIndex)
    .map(item => item.entry);
  const problemEntries = entries.filter(entry => getCategory(entry) === 'problem');
  const directSalesEntries = entries.filter(entry => getCategory(entry) === 'directSales');

  const normalData = normalEntries.length > 0
    ? buildFlatExportData(normalEntries, NORMAL_TOP_COLS, NORMAL_MID_COLS, NORMAL_BOTTOM_COLS, NORMAL_EXTRA_COLS)
    : { topCols: [], midCols: [], bottomCols: [], extraCols: [], data: [], progressKeys: [], currentProgressKey: undefined };

  const problemData = problemEntries.length > 0
    ? buildFlatExportData(problemEntries, PROBLEM_TOP_COLS, [], PROBLEM_BOTTOM_COLS, [])
    : { topCols: [], bottomCols: [], data: [], progressKeys: [] };

  const date = new Date().toISOString().slice(0, 10);
  const filename = `工作日志_${scopeLabel}_${date}.xlsx`;
  const destination = await chooseXlsxDestination(filename);
  if (destination.kind === 'cancelled') return;

  await exportWorkLogToXLSX(
    normalData,
    problemData,
    { entries: directSalesEntries, series: buildDirectSalesSeries(directSalesEntries) },
    filename,
    destination,
  );
}
