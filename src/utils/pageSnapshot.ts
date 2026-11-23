const PAGE_SNAPSHOT_PREFIX = 'ibd:page-snapshot:v1';

export type PageSnapshotValue = string | number | boolean | null | undefined | PageSnapshotValue[] | { [key: string]: PageSnapshotValue };

function key(pageKey: string, userId?: string) {
  return `${PAGE_SNAPSHOT_PREFIX}:${userId || 'anonymous'}:${pageKey}`;
}

export function readPageSnapshot<T extends object>(pageKey: string, userId?: string): Partial<T> {
  if (typeof window === 'undefined') return {};
  try {
    const value = JSON.parse(window.sessionStorage.getItem(key(pageKey, userId)) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Partial<T> : {};
  } catch {
    return {};
  }
}

export function writePageSnapshot<T extends object>(pageKey: string, userId: string | undefined, value: T) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(key(pageKey, userId), JSON.stringify(value));
  } catch {
    // 页面状态恢复不能阻断正常操作。
  }
}

export function patchPageSnapshot<T extends object>(pageKey: string, userId: string | undefined, patch: Partial<T>) {
  writePageSnapshot(pageKey, userId, { ...readPageSnapshot<T>(pageKey, userId), ...patch });
}

export function clearPageSnapshot(pageKey: string, userId?: string) {
  if (typeof window === 'undefined') return;
  try { window.sessionStorage.removeItem(key(pageKey, userId)); } catch { /* ignore */ }
}

export function restoreElementScroll(element: HTMLElement | null, value?: number) {
  if (!element || !Number.isFinite(Number(value))) return;
  element.scrollTop = Math.max(0, Number(value) || 0);
}
