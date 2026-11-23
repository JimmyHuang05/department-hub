import { WorkLogEntry } from '../types';
import { InvestmentProduct } from '../types';

/**
 * 工作日志重复检测比较字段（排除 id/createdAt/updatedAt/weekKey 等元数据）
 */
export const WORKLOG_COMPARE_FIELDS: readonly (keyof WorkLogEntry)[] = [
  'projectId', 'weekKey', 'category', 'subCategory', 'productName', 'status', 'clientType', 'navScale', 'description',
  'establishDate', 'productTerm', 'personA', 'personB', 'activePassive', 'collectiveSingle',
  'advisorManager', 'channelSales', 'features', 'managementReport', 'riskReport', 'salesReport',
  'nextWeekPlan', 'nav', 'yearStartNav', 'changePercent',
  'weeklyProgress', 'navScaleHistory', 'dynamicFields',
] as const;

/**
 * 产品重复检测比较字段（排除 id/createdAt/updatedAt 等元数据）
 */
export const PRODUCT_COMPARE_FIELDS: readonly (keyof InvestmentProduct)[] = [
  'productName', 'usd', 'rmb', 'feeRate', 'establishDate', 'target', 'client',
  'brokerChannel', 'strategy', 'custodianBank', 'tradingBroker', 'annualIncome', 'thisYearIncome',
  'performanceIncome', 'status', 'trustManager', 'trustManagerB', 'deadline', 'remarks', 'dynamicFields',
] as const;

function normalizeComparableValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim().replace(/\s+/g, ' ');
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return `[${value.map(normalizeComparableValue).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${key}:${normalizeComparableValue(nested)}`)
      .join(',')}}`;
  }
  return String(value);
}

export function normalizeProjectName(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, '').toLocaleLowerCase('zh-CN');
}

export function releasesProjectName(product: Pick<InvestmentProduct, 'status'> | undefined): boolean {
  const status = String(product?.status ?? '').trim().replace(/\s+/g, '');
  return status.includes('中止') || status.includes('终止');
}

export function findProjectNameDuplicate(
  products: readonly InvestmentProduct[],
  productName: unknown,
  currentId?: string | null,
  occupiedStatusNames?: readonly string[],
): InvestmentProduct | undefined {
  const normalizedName = normalizeProjectName(productName);
  if (!normalizedName) return undefined;
  const occupiesName = (product: InvestmentProduct | undefined) => {
    if (!product) return false;
    if (product.projectBackup === true || product.status === '项目备用') return true;
    if (releasesProjectName(product)) return false;
    return occupiedStatusNames
      ? occupiedStatusNames.includes(product.status)
      : true;
  };
  const currentProduct = currentId ? products.find(product => product.id === currentId) : undefined;
  if (currentProduct && !occupiesName(currentProduct)) return undefined;
  return products.find(product => (
    product.id !== currentId
    && occupiesName(product)
    && normalizeProjectName(product.productName) === normalizedName
  ));
}

export function buildDuplicateKey<T>(item: T, compareFields: readonly (keyof T)[]): string {
  return compareFields.map(field => normalizeComparableValue(item[field])).join('|');
}

/**
 * 从一组数据中找出重复组
 * @param items 数据数组
 * @param compareFields 用于比较的字段列表
 * @param sortField 排序字段（默认 productName）
 * @returns { groups, sorted } groups=重复组ID数组, sorted=排序后的数据
 */
export function findDuplicateGroups<T extends { id: string; productName?: string }>(
  items: T[],
  compareFields: readonly (keyof T)[],
  sortField: keyof T = 'productName' as keyof T,
): { groups: string[][]; sorted: T[] } {
  // Some worklog fields contain large weekly-history objects. Build their
  // comparison key once instead of serializing every record again for every
  // other record (the previous implementation was O(n²)).
  const keyedItems = items.map(item => ({ item, key: buildDuplicateKey(item, compareFields) }));

  // 按指定字段排序，使相同条目相邻
  const sortedKeyedItems = [...keyedItems].sort((a, b) => {
    const av = normalizeComparableValue(a.item[sortField]);
    const bv = normalizeComparableValue(b.item[sortField]);
    const cmp = av.localeCompare(bv, 'zh-CN');
    if (cmp !== 0) return cmp;
    return a.item.id.localeCompare(b.item.id);
  });
  const sorted = sortedKeyedItems.map(({ item }) => item);

  // 找出重复组
  const groupMap = new Map<string, string[]>();
  sortedKeyedItems.forEach(({ item, key }) => {
    const group = groupMap.get(key);
    if (group) group.push(item.id);
    else groupMap.set(key, [item.id]);
  });
  const groups = Array.from(groupMap.values()).filter(group => group.length >= 2);

  return { groups, sorted };
}

export function findExactDuplicateGroups<T extends { id: string; productName?: string }>(
  items: T[],
  compareFields: readonly (keyof T)[],
): { groups: string[][]; duplicateIds: Set<string> } {
  const { groups } = findDuplicateGroups(items, compareFields);
  return { groups, duplicateIds: new Set(groups.flat()) };
}

export function hasExactDuplicateRecord<T extends { id: string }>(
  items: T[],
  candidate: T,
  compareFields: readonly (keyof T)[],
  currentId?: string | null,
): boolean {
  const candidateKey = buildDuplicateKey(candidate, compareFields);
  return items.some(item => item.id !== (currentId ?? candidate.id) && buildDuplicateKey(item, compareFields) === candidateKey);
}

/** 计算多余的重复条目总数 */
export function redundantCount(groups: string[][]): number {
  return groups.reduce((sum, g) => sum + g.length - 1, 0);
}
