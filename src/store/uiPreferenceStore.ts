import { create } from 'zustand';
import { api } from '../lib/api';
import { _toast } from './toastRef';

export interface UiPreferences {
  worklogOnlyMine: boolean;
  worklogManagerFilters: string[];
  worklogCardColumns: 3 | 4 | 5 | 6;
  worklogNormalCardFields: string[];
  worklogProblemCardFields: string[];
  worklogDirectSalesCardFields: string[];
  projectOnlyMine: boolean;
  projectManagerFilters: string[];
  projectCardFields: string[];
  projectViewMode: 'cards' | 'table' | 'fs';
  projectExcelColumnWidths: Record<string, number>;
  projectExcelColumnOrder: string[];
  projectExcelPinnedColumns: string[];
  projectExcelFontScale: number;
  projectExcelShowFormulaBar: boolean;
  projectExcelShowCoordinates: boolean;
  showShortcutHints: boolean;
  showOnlineUsers: boolean;
  sidebarExpanded: boolean;
  projectFortuneSheetFrozenColumn: number | null;
}

export const DEFAULT_PROJECT_CARD_FIELDS = [
  'client',
  'target',
  'feeRate',
  'establishDate',
  'strategy',
  'annualIncome',
  'performanceIncome',
  'thisYearIncome',
];

export const DEFAULT_WORKLOG_NORMAL_CARD_FIELDS = ['navScale', 'weeklyProgress', 'nextWeekPlan'];
export const DEFAULT_WORKLOG_PROBLEM_CARD_FIELDS = ['navScale', 'weeklyProgress', 'nextWeekPlan'];
export const DEFAULT_WORKLOG_DIRECT_SALES_CARD_FIELDS = [
  'nav', 'changePercent', 'weeklyReview', 'nextWeekPlan', 'subscriptionRedemption', 'nextSalesPlan',
];

const WORKLOG_NORMAL_CARD_FIELD_KEYS = new Set([
  'subCategory', 'status', 'productName', 'clientType', 'navScale', 'establishDate', 'channelSales',
  'weeklyProgress', 'nextWeekPlan', 'nav', 'yearStartNav', 'personA', 'personB', 'activePassive',
  'collectiveSingle', 'advisorManager', 'productTerm', 'features', 'managementReport', 'riskReport', 'salesReport',
]);
const WORKLOG_PROBLEM_CARD_FIELD_KEYS = new Set([
  'productName', 'status', 'description', 'clientType', 'navScale', 'weeklyProgress', 'deadline', 'nextWeekPlan',
  'progressExpectation', 'personA', 'personB', 'activePassive', 'collectiveSingle', 'advisorManager',
  'productTerm', 'features', 'managementReport', 'riskReport', 'salesReport',
]);
const WORKLOG_DIRECT_SALES_CARD_FIELD_KEYS = new Set([
  'subCategory', 'productName', 'status', 'clientType', 'navScale', 'productTerm', 'nav', 'changePercent',
  'holdingsOver10', 'equityAssetRatio', 'warningLineStatus', 'focusPoint', 'weeklyReview', 'nextWeekPlan',
  'channelSales', 'channelContact', 'subscriptionRedemption', 'nextSalesPlan',
]);

function normalizeWorklogCardFields(value: unknown, allowed: Set<string>, limit: number, fallback: string[]) {
  if (!Array.isArray(value)) return fallback;
  const fields = [...new Set(value.filter((field): field is string => typeof field === 'string' && allowed.has(field)))].slice(0, limit);
  return fields.length > 0 ? fields : fallback;
}

const DEFAULT_UI_PREFERENCES: UiPreferences = {
  worklogOnlyMine: true,
  worklogManagerFilters: [],
  worklogCardColumns: 3,
  worklogNormalCardFields: DEFAULT_WORKLOG_NORMAL_CARD_FIELDS,
  worklogProblemCardFields: DEFAULT_WORKLOG_PROBLEM_CARD_FIELDS,
  worklogDirectSalesCardFields: DEFAULT_WORKLOG_DIRECT_SALES_CARD_FIELDS,
  projectOnlyMine: false,
  projectManagerFilters: [],
  projectCardFields: DEFAULT_PROJECT_CARD_FIELDS,
  projectViewMode: 'cards',
  projectExcelColumnWidths: {},
  projectExcelColumnOrder: [],
  projectExcelPinnedColumns: ['productName'],
  projectExcelFontScale: 100,
  projectExcelShowFormulaBar: true,
  projectExcelShowCoordinates: true,
  showShortcutHints: true,
  showOnlineUsers: true,
  sidebarExpanded: true,
  projectFortuneSheetFrozenColumn: null,
};

function projectCardFieldsStorageKey() {
  try {
    const user = JSON.parse(localStorage.getItem('auth_user') || '{}') as { id?: string };
    return `ui_project_card_fields_${user.id || 'anonymous'}`;
  } catch {
    return 'ui_project_card_fields_anonymous';
  }
}

function readCachedProjectCardFields(): string[] | null {
  try {
    const value = JSON.parse(localStorage.getItem(projectCardFieldsStorageKey()) || 'null');
    return Array.isArray(value) && value.length > 0
      ? value.filter((field): field is string => typeof field === 'string')
      : null;
  } catch {
    return null;
  }
}

function normalizePreferences(value?: Partial<UiPreferences> | null): UiPreferences {
  const legacyViewMode = String(value?.projectViewMode || '');
  return {
    worklogOnlyMine: typeof value?.worklogOnlyMine === 'boolean'
      ? value.worklogOnlyMine
      : DEFAULT_UI_PREFERENCES.worklogOnlyMine,
    worklogManagerFilters: Array.isArray(value?.worklogManagerFilters) ? [...new Set(value.worklogManagerFilters.filter((name): name is string => typeof name === 'string' && Boolean(name.trim())).map(name => name.trim()))] : [],
    worklogCardColumns: [3, 4, 5, 6].includes(Number(value?.worklogCardColumns))
      ? Number(value?.worklogCardColumns) as 3 | 4 | 5 | 6
      : DEFAULT_UI_PREFERENCES.worklogCardColumns,
    worklogNormalCardFields: normalizeWorklogCardFields(value?.worklogNormalCardFields, WORKLOG_NORMAL_CARD_FIELD_KEYS, WORKLOG_NORMAL_CARD_FIELD_KEYS.size, DEFAULT_WORKLOG_NORMAL_CARD_FIELDS),
    worklogProblemCardFields: normalizeWorklogCardFields(value?.worklogProblemCardFields, WORKLOG_PROBLEM_CARD_FIELD_KEYS, 3, DEFAULT_WORKLOG_PROBLEM_CARD_FIELDS),
    worklogDirectSalesCardFields: normalizeWorklogCardFields(value?.worklogDirectSalesCardFields, WORKLOG_DIRECT_SALES_CARD_FIELD_KEYS, 6, DEFAULT_WORKLOG_DIRECT_SALES_CARD_FIELDS),
    projectOnlyMine: typeof value?.projectOnlyMine === 'boolean'
      ? value.projectOnlyMine
      : DEFAULT_UI_PREFERENCES.projectOnlyMine,
    projectManagerFilters: Array.isArray(value?.projectManagerFilters) ? [...new Set(value.projectManagerFilters.filter((name): name is string => typeof name === 'string' && Boolean(name.trim())).map(name => name.trim()))] : [],
    projectCardFields: Array.isArray(value?.projectCardFields) && value.projectCardFields.length > 0
      ? value.projectCardFields.filter((field): field is string => typeof field === 'string')
      : DEFAULT_UI_PREFERENCES.projectCardFields,
    projectViewMode: legacyViewMode === 'fs'
      ? 'table'
      : ['fortune-sheet', 'table', 'excel', 'ag-grid'].includes(legacyViewMode) ? 'table' : 'cards',
    projectExcelColumnWidths: value?.projectExcelColumnWidths && typeof value.projectExcelColumnWidths === 'object'
      ? value.projectExcelColumnWidths
      : {},
    projectExcelColumnOrder: Array.isArray(value?.projectExcelColumnOrder)
      ? value.projectExcelColumnOrder.filter((field): field is string => typeof field === 'string')
      : [],
    projectExcelPinnedColumns: Array.isArray(value?.projectExcelPinnedColumns)
      ? value.projectExcelPinnedColumns.filter((field): field is string => typeof field === 'string')
      : ['productName'],
    projectExcelFontScale: Number.isFinite(value?.projectExcelFontScale)
      ? Math.min(150, Math.max(50, Number(value?.projectExcelFontScale)))
      : 100,
    projectExcelShowFormulaBar: typeof value?.projectExcelShowFormulaBar === 'boolean'
      ? value.projectExcelShowFormulaBar
      : true,
    projectExcelShowCoordinates: typeof value?.projectExcelShowCoordinates === 'boolean'
      ? value.projectExcelShowCoordinates
      : true,
    showShortcutHints: typeof value?.showShortcutHints === 'boolean'
      ? value.showShortcutHints
      : true,
    showOnlineUsers: typeof value?.showOnlineUsers === 'boolean'
      ? value.showOnlineUsers
      : true,
    sidebarExpanded: typeof value?.sidebarExpanded === 'boolean'
      ? value.sidebarExpanded
      : true,
    projectFortuneSheetFrozenColumn: Number.isInteger(value?.projectFortuneSheetFrozenColumn)
      && Number(value?.projectFortuneSheetFrozenColumn) >= 0
      ? Math.min(999, Number(value?.projectFortuneSheetFrozenColumn))
      : null,
  };
}

// Every request writes the complete preference object. Serializing writes keeps
// a slower, older response from overwriting a newer view or grid setting.
let preferenceSaveQueue: Promise<void> = Promise.resolve();

function enqueuePreferenceSave(task: () => Promise<void>): Promise<void> {
  const queued = preferenceSaveQueue.then(task, task);
  preferenceSaveQueue = queued.catch(() => undefined);
  return queued;
}

interface UiPreferenceStore {
  preferences: UiPreferences;
  loaded: boolean;
  loadPreferences: () => Promise<void>;
  setOnlyMine: (scope: 'worklog' | 'project', enabled: boolean) => Promise<void>;
  setProjectCardFields: (fields: string[]) => Promise<boolean>;
  updatePreferences: (patch: Partial<UiPreferences>, failureMessage?: string) => Promise<boolean>;
}

export const useUiPreferenceStore = create<UiPreferenceStore>((set, get) => ({
  preferences: DEFAULT_UI_PREFERENCES,
  loaded: false,

  loadPreferences: async () => {
    try {
      const result = await api.get<{ uiState: UiPreferences }>('/preferences/ui-state');
      const normalized = normalizePreferences(result.uiState);
      set({
        preferences: normalized,
        loaded: true,
      });
    } catch (error) {
      console.error('加载界面偏好失败', error);
      const cachedFields = readCachedProjectCardFields();
      set({
        preferences: cachedFields
          ? { ...DEFAULT_UI_PREFERENCES, projectCardFields: cachedFields }
          : DEFAULT_UI_PREFERENCES,
        loaded: true,
      });
    }
  },

  setOnlyMine: async (scope, enabled) => {
    const key = scope === 'worklog' ? 'worklogOnlyMine' : 'projectOnlyMine';
    const next = { ...get().preferences, [key]: enabled };
    set({ preferences: next });
    try {
      await enqueuePreferenceSave(async () => {
        await api.put('/preferences/ui-state', { uiState: get().preferences });
      });
    } catch (error) {
      console.error('保存界面偏好失败', error);
      _toast.error?.('“只看我的”偏好保存失败');
    }
  },

  setProjectCardFields: async (fields) => {
    const next = normalizePreferences({ ...get().preferences, projectCardFields: fields });
    set({ preferences: next });
    try {
      await enqueuePreferenceSave(async () => {
        await api.put('/preferences/ui-state', { uiState: get().preferences });
      });
      localStorage.setItem(projectCardFieldsStorageKey(), JSON.stringify(next.projectCardFields));
      return true;
    } catch (error) {
      console.error('保存项目卡片字段偏好失败', error);
      _toast.error?.('卡片字段设置保存失败');
      return false;
    }
  },

  updatePreferences: async (patch, failureMessage = '个人偏好保存失败') => {
    const next = normalizePreferences({ ...get().preferences, ...patch });
    set({ preferences: next });
    try {
      await enqueuePreferenceSave(async () => {
        await api.put('/preferences/ui-state', { uiState: get().preferences });
      });
      return true;
    } catch (error) {
      console.error('保存个人偏好失败', error);
      _toast.error?.(failureMessage);
      return false;
    }
  },
}));
