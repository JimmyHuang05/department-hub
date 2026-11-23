import type { InvestmentProduct, WorkLogEntry } from '../types';

type ImportEntity = {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export interface ImportMergeResult<T> {
  records: T[];
  changes: T[];
  added: number;
  updated: number;
  unchanged: number;
}

type ImportIdentity = string | string[] | null;

function normalizeIdentityPart(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('zh-CN');
}

function hasImportValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some(hasImportValue);
  }
  return true;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function mergeImportObject(
  current: Record<string, unknown>,
  imported: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...current };
  for (const [key, importedValue] of Object.entries(imported)) {
    if (!hasImportValue(importedValue)) continue;
    const currentValue = result[key];
    result[key] = isPlainObject(importedValue)
      ? mergeImportObject(isPlainObject(currentValue) ? currentValue : {}, importedValue)
      : importedValue;
  }
  return result;
}

function comparableRecord(record: Record<string, unknown>): string {
  const { updatedAt: _updatedAt, ...businessFields } = record;
  return JSON.stringify(businessFields);
}

export function projectImportIdentity(
  product: Partial<InvestmentProduct>,
): string | null {
  const name = normalizeIdentityPart(product.productName);
  return name ? `name:${name}` : null;
}

export function workLogImportIdentity(
  entry: Partial<WorkLogEntry>,
): ImportIdentity {
  const keys: string[] = [];
  const projectId = normalizeIdentityPart(entry.projectId);
  if (projectId) keys.push(`project:${projectId}`);
  const name = normalizeIdentityPart(entry.productName);
  if (name) {
    const category = normalizeIdentityPart(entry.category || '正常项目');
    keys.push(`name:${category}:${name}`);
  }
  return keys.length > 0 ? keys : null;
}

function identityKeys(value: ImportIdentity): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export function mergeImportRows<T extends ImportEntity>(
  existing: T[],
  importedRows: Partial<T>[],
  identity: (record: Partial<T>) => ImportIdentity,
  createRecord: (row: Partial<T>) => T,
  now = new Date().toISOString(),
): ImportMergeResult<T> {
  const records = [...existing];
  const changesById = new Map<string, T>();
  const indexByIdentity = new Map<string, number>();

  records.forEach((record, index) => {
    for (const key of identityKeys(identity(record))) {
      if (!indexByIdentity.has(key)) indexByIdentity.set(key, index);
    }
  });

  let added = 0;
  let updated = 0;
  let unchanged = 0;

  for (const importedRow of importedRows) {
    const importedKeys = identityKeys(identity(importedRow));
    const existingIndex = importedKeys
      .map(key => indexByIdentity.get(key))
      .find(index => index !== undefined);

    if (existingIndex === undefined) {
      const created = createRecord(importedRow);
      const newIndex = records.push(created) - 1;
      changesById.set(created.id, created);
      for (const createdKey of identityKeys(identity(created))) {
        if (!indexByIdentity.has(createdKey)) {
          indexByIdentity.set(createdKey, newIndex);
        }
      }
      added += 1;
      continue;
    }

    const current = records[existingIndex];
    const mergedBusinessFields = mergeImportObject(
      current as unknown as Record<string, unknown>,
      importedRow as Record<string, unknown>,
    );
    const merged = {
      ...mergedBusinessFields,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: now,
    } as T;

    if (
      comparableRecord(current as unknown as Record<string, unknown>)
      === comparableRecord(merged as unknown as Record<string, unknown>)
    ) {
      unchanged += 1;
      continue;
    }

    records[existingIndex] = merged;
    changesById.set(merged.id, merged);
    updated += 1;
  }

  return { records, changes: Array.from(changesById.values()), added, updated, unchanged };
}
