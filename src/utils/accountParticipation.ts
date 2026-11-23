import type { InvestmentProduct, WorkLogEntry } from '../types';

function participantNames(value: unknown) {
  return String(value || '')
    .split(/[\/／，,、;；&＆\s]+/)
    .map(name => name.trim())
    .filter(Boolean);
}

export function valueIncludesAccountName(value: unknown, accountName: string) {
  const normalizedName = accountName.trim();
  if (!normalizedName) return false;
  return participantNames(value).includes(normalizedName);
}

export function isWorkLogAssignedToAccount(entry: WorkLogEntry, accountName: string) {
  const fields = String(entry.category || '').includes('直销')
    ? [entry.dynamicFields?.channelContact]
    : [entry.personA, entry.personB];
  return fields.some(value => valueIncludesAccountName(value, accountName));
}

export function isProjectAssignedToAccount(product: InvestmentProduct, accountName: string) {
  return valueIncludesAccountName(product.trustManager, accountName)
    || valueIncludesAccountName(product.trustManagerB, accountName);
}
