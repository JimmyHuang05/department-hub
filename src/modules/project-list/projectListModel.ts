import type { InvestmentProduct, WorkLogEntry } from '../../types';
import { normalizeRate } from '../../utils/format';

export const FIELD_LABELS: Record<string, string> = {
  productName: '项目名称', usd: '美元规模（万美元）', rmb: '人民币规模（万元）', feeRate: '费率',
  projectCreatedDate: '项目创建日', establishDate: '成立/落地日', projectStoppedDate: '项目中止日',
  target: '标的', brokerChannel: '销售渠道', strategy: '投资策略', custodianBank: '托管行',
  tradingBroker: '交易券商', annualIncome: '年化收入（万元）', thisYearIncome: '今年收入（万元）',
  performanceIncome: '绩效收入（万元）', status: '项目进度', deadline: '截止日', remarks: '备注',
};

export const projectRelationKey = (value?: string) => String(value || '').trim().toLocaleLowerCase('zh-CN');

export function feeRateToPercentInput(value: string | number | undefined): string | number {
  if (value === '' || value === undefined) return '';
  const rate = normalizeRate(Number(value));
  return Math.round(rate * 100_000_000) / 1_000_000;
}

export function percentInputToFeeRate(value: string): string {
  if (value.trim() === '') return '';
  const percent = Number(value);
  return Number.isFinite(percent) ? String(percent / 100) : '';
}

export function projectSeriesKey(value?: string) {
  return projectRelationKey(value).match(/跨境投资\s*\d+号/)?.[0].replace(/\s+/g, '') || '';
}

export function relationPartyKey(value?: string) {
  return projectRelationKey(value)
    .replace(/[（）()【】\[\]“”"'，,。.、\s]/g, '')
    .replace(/有限责任公司|股份有限公司|集团有限公司|有限公司|合伙企业|基金管理人|基金|集团|股份/g, '');
}

function partiesMatch(left?: string, right?: string) {
  const leftKey = relationPartyKey(left);
  const rightKey = relationPartyKey(right);
  return Boolean(leftKey && rightKey && (leftKey.includes(rightKey) || rightKey.includes(leftKey)));
}

export function isRelatedWorkLog(product: InvestmentProduct, entry: WorkLogEntry, products: InvestmentProduct[]) {
  if (entry.projectId) return entry.projectId === product.id;
  if (projectRelationKey(product.productName) === projectRelationKey(entry.productName)) return true;
  const seriesKey = projectSeriesKey(product.productName);
  if (!seriesKey || seriesKey !== projectSeriesKey(entry.productName)) return false;
  const sameSeriesProducts = products.filter(item => projectSeriesKey(item.productName) === seriesKey);
  return sameSeriesProducts.length === 1 || partiesMatch(product.client, entry.clientType);
}

export function formatWorkspaceTime(value?: string) {
  if (!value) return '未记录';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'});
}

export function formatWorkspaceFileSize(value?: number) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function latestWorkLogProgress(entry: WorkLogEntry, preferredWeekKey?: string | null) {
  const keys = Object.keys(entry.weeklyProgress || {}).sort().reverse();
  const preferredKey = preferredWeekKey && preferredWeekKey !== '__legacy__' ? preferredWeekKey : '';
  const key = preferredKey && (entry.weekKey === preferredKey || Object.prototype.hasOwnProperty.call(entry.weeklyProgress || {}, preferredKey))
    ? preferredKey
    : keys.find(item => String(entry.weeklyProgress?.[item] || '').trim()) || entry.weekKey || '';
  return {weekKey: key, progress: key ? String(entry.weeklyProgress?.[key] || '').trim() : ''};
}

export const mergeSelectOptions = (...groups: Array<Array<string | null | undefined>>) =>
  Array.from(new Set(groups.flat().map(value => String(value || '').trim()).filter(Boolean)));

export const PROJECT_STATUS_COLORS: Record<string, string> = {
  材料收集: '#94a3b8', 报告撰写: '#60a5fa', 上会中: '#f59e0b', 已过会: '#84cc16',
  已成立: '#16a34a', 项目中止: '#dc2626', 项目备用: '#64748b', 未填写: '#d1d5db',
};

export const PROJECT_BACKUP_STATUS_CONFIG = {id: 'project-backup-status', name: '项目备用', color: '#64748b'};
