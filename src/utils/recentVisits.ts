import type { GlobalSearchResult } from './globalSearch';

export interface RecentVisit extends GlobalSearchResult {
  visitedAt: string;
}

const MAX_RECENT_VISITS = 6;

function storageKey(userId: string) {
  return `ibd_recent_visits_${userId}`;
}

function isRecentVisit(value: unknown): value is RecentVisit {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<RecentVisit>;
  return typeof item.id === 'string'
    && typeof item.title === 'string'
    && typeof item.description === 'string'
    && typeof item.href === 'string'
    && typeof item.visitedAt === 'string'
    && (item.type === 'project' || item.type === 'worklog');
}

export function readRecentVisits(userId?: string | null): RecentVisit[] {
  if (!userId) return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(userId)) || '[]');
    return Array.isArray(parsed) ? parsed.filter(isRecentVisit).slice(0, MAX_RECENT_VISITS) : [];
  } catch {
    return [];
  }
}

export function recordRecentVisit(userId: string, result: GlobalSearchResult): RecentVisit[] {
  if (result.type !== 'project' && result.type !== 'worklog') return readRecentVisits(userId);
  const next: RecentVisit = {
    ...result,
    score: undefined,
    visitedAt: new Date().toISOString(),
  };
  const items = [next, ...readRecentVisits(userId).filter(item => item.id !== next.id)]
    .slice(0, MAX_RECENT_VISITS);
  localStorage.setItem(storageKey(userId), JSON.stringify(items));
  return items;
}

export function clearRecentVisits(userId?: string | null) {
  if (!userId) return;
  localStorage.removeItem(storageKey(userId));
}
