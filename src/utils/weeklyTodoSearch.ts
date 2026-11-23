import type { GlobalSearchResult } from './globalSearch';

export const OPEN_WEEKLY_TODO_SEARCH_EVENT = 'ibd:open-weekly-todo-search';
export const WEEKLY_TODO_HANDLED_EVENT = 'ibd:weekly-todo-handled';
export const WEEKLY_TODO_SEARCH_QUERY = '本周待办';
const WEEKLY_TODO_SEARCH_STORAGE_KEY = 'ibd:weekly-todo-search';

export type WeeklyTodoTone = 'danger' | 'warning' | 'primary' | 'surface';

export const weeklyTodoToneClass: Record<WeeklyTodoTone, string> = {
  danger: 'border-danger-200 bg-danger-50 text-danger-900 hover:border-danger-300',
  warning: 'app-warning-surface text-surface-900',
  primary: 'border-primary-200 bg-primary-50 text-surface-900 hover:border-primary-300',
  surface: 'border-surface-200 bg-surface-100 text-surface-900 hover:border-surface-300',
};

export const weeklyTodoBadgeClass: Record<WeeklyTodoTone, string> = {
  danger: 'bg-danger-600 text-white',
  warning: 'app-warning-badge',
  primary: 'bg-primary-600 text-white',
  surface: 'bg-white text-surface-600',
};

export interface WeeklyTodoSearchResult extends GlobalSearchResult {
  tone: WeeklyTodoTone;
  meta: string;
  actionLabel: string;
  sourceUpdatedAt?: string;
}

export interface WeeklyTodoSearchDetail {
  results: WeeklyTodoSearchResult[];
  weekKey: string;
}

export function readWeeklyTodoSearch(): WeeklyTodoSearchDetail | null {
  try {
    const raw = window.sessionStorage.getItem(WEEKLY_TODO_SEARCH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WeeklyTodoSearchDetail;
    return Array.isArray(parsed.results) && typeof parsed.weekKey === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

export function saveWeeklyTodoSearch(results: WeeklyTodoSearchResult[], weekKey: string) {
  try {
    window.sessionStorage.setItem(WEEKLY_TODO_SEARCH_STORAGE_KEY, JSON.stringify({ results, weekKey }));
  } catch {
    // Session persistence is an enhancement; the in-page event still works without it.
  }
}

export function clearWeeklyTodoSearch() {
  try {
    window.sessionStorage.removeItem(WEEKLY_TODO_SEARCH_STORAGE_KEY);
  } catch {
    // Ignore storage restrictions in privacy-focused browser modes.
  }
}

export function notifyWeeklyTodoHandled(itemId: string) {
  window.dispatchEvent(new CustomEvent<string>(WEEKLY_TODO_HANDLED_EVENT, {
    detail: itemId,
  }));
}

export function openWeeklyTodoSearch(results: WeeklyTodoSearchResult[], weekKey: string) {
  saveWeeklyTodoSearch(results, weekKey);
  window.dispatchEvent(new CustomEvent<WeeklyTodoSearchDetail>(OPEN_WEEKLY_TODO_SEARCH_EVENT, {
    detail: { results, weekKey },
  }));
}
