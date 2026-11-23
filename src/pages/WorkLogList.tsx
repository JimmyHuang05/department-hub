import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronLeft, Clock3, Filter, Menu, Plus, Search, Settings2, Square, Table2, Trash2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useSearchParams } from 'react-router-dom';
import Header from '../components/Layout/Header';
import FeatureInfo from '../components/Guidance/FeatureInfo';
import AppModal from '../components/Layout/AppModal';
import DetailModal, { DetailGrid, DetailSection } from '../components/Layout/DetailModal';
import ListCardShell from '../components/Layout/ListCardShell';
import TableToolbar from '../components/DataTable/TableToolbar';
import WorkLogCards, {
  WORKLOG_DIRECT_SALES_CARD_FIELD_OPTIONS,
  WORKLOG_NORMAL_CARD_FIELD_OPTIONS,
  WORKLOG_PROBLEM_CARD_FIELD_OPTIONS,
  type WorkLogCardFieldPreferences,
} from '../components/WorkLogCards';
import WorkLogExcelView from '../components/WorkLogExcelView';
import WorkLogImportModal from '../components/DataTable/WorkLogImportModal';
import DragImportOverlay from '../components/DragImportOverlay';
import DeleteConfirmDialog from '../components/DeleteConfirmDialog';
import AppSelect from '../components/Form/AppSelect';
import ManagerScopeFilter from '../components/ManagerScopeFilter';
import TemplateRichNameInput from '../components/Form/TemplateRichNameInput';
import { MobileDateInput, MobileNumberInput, MobileSelectInput, MobileTextInput } from '../components/MobileWheelPicker';
import {
  MobileDetailEditorSheet,
  MobileDetailFieldRow,
  MobileDetailSection,
  type MobileDetailEditorField,
} from '../components/Mobile/MobileBasePrimitives';
import LoadingSpinner from '../components/LoadingSpinner';
import { useWorkLogStore } from '../store/workLogStore';
import { useProjectStore } from '../store/projectStore';
import { useAuthStore } from '../store/authStore';
import {
  DEFAULT_WORKLOG_DIRECT_SALES_CARD_FIELDS,
  DEFAULT_WORKLOG_NORMAL_CARD_FIELDS,
  DEFAULT_WORKLOG_PROBLEM_CARD_FIELDS,
  useUiPreferenceStore,
} from '../store/uiPreferenceStore';
import { useSettingsStore } from '../store/settingsStore';
import { _toast } from '../store/toastRef';
import { broadcastEditingStart, broadcastEditingStop } from '../hooks/useCollaboration';
import { useDebounce } from '../utils/useDebounce';
import { useMobileViewport } from '../hooks/useMobileViewport';
import { exportManagementWorkLog } from '../utils/worklogExportProgram';
import { generateId } from '../utils/id';
import { getWeekNumber, getWeekRange } from '../utils/week';
import { getWorkWeekLabelForKey } from '../utils/workWeek';
import {
  calculateProductNameTemplateWeight,
  getTemplateText,
  inferProductNameTemplate,
  normalizeProductNameTemplate,
  PRODUCT_NAME_TEMPLATE_SLOT,
  normalizeProductNameTemplateSlots,
} from '../utils/productNameTemplates';
import { api } from '../lib/api';
import { getWorkLogSnapshotWeekKeys } from '../lib/workLogSnapshotCache';
import type { ImportMode, InvestmentProduct, WorkLogEntry } from '../types';
import { mergeImportRows, workLogImportIdentity } from '../utils/importMerge';
import { isWorkLogAssignedToAccount } from '../utils/accountParticipation';
import { readPageSnapshot, writePageSnapshot } from '../utils/pageSnapshot';
import { MANAGEMENT_STAGE_OPTIONS, PROJECT_CATEGORY_OPTIONS, projectCategoryLinkage } from '../utils/projectClassification';

interface WorkLogHistoryEntry {
  id: string;
  field: string;
  oldValue: string;
  newValue: string;
  editedBy: string;
  editedName?: string;
  editedAt: string;
}

type WorkLogLastEdit = Pick<WorkLogHistoryEntry, 'editedBy' | 'editedName' | 'editedAt'>;

const WorkLogLastEditContext = createContext<Record<string, WorkLogLastEdit>>({});
const WorkLogCreateContext = createContext(false);

const WORKLOG_LABEL_FIELD_KEYS: Record<string, string> = {
  '产品名': 'productName', '项目名称': 'productName', '产品名称': 'productName',
  'A角': 'personA', 'B角': 'personB', '主动 / 被动': 'activePassive', '集合 / 单一': 'collectiveSingle',
  '投资顾问 / 管理人': 'advisorManager', '产品期限': 'productTerm', '特色': 'features',
  '管理报告': 'managementReport', '风控报告': 'riskReport', '销售端报告': 'salesReport',
  '项目分类': 'subCategory', '类别': 'subCategory', '状态': 'status', '客户名称 / 类型': 'clientType',
  '客户名称': 'clientType', '净值 / 规模情况': 'navScale', '项目规模': 'navScale', '规模（万）': 'navScale',
  '成立日 / 拟成立日': 'establishDate', '日期': 'establishDate', '渠道销售': 'channelSales', '销售渠道': 'channelSales',
  '上周进展': 'weeklyProgress', '一周回顾': 'dynamicFields.weeklyReview', '下周工作计划': 'nextWeekPlan',
  '后续举措': 'nextWeekPlan', '项目情况': 'description', '预计最晚化解时间': 'deadline',
  '进展是否达预期': 'dynamicFields.progressExpectation', '净值': 'nav', '年初净值': 'yearStartNav',
  '较上周': 'changePercent', '目标规模（万）': 'productTerm',
  '持仓超过10%的个券明细': 'dynamicFields.holdingsOver10', '权益资产占比': 'dynamicFields.equityAssetRatio',
  '是否触及预警、平仓线': 'dynamicFields.warningLineStatus', '关注点': 'dynamicFields.focusPoint',
  '渠道对接人': 'dynamicFields.channelContact', '当周申赎情况': 'dynamicFields.subscriptionRedemption',
  '下一步工作计划': 'dynamicFields.nextSalesPlan',
  '项目代码': 'dynamicFields.projectCode',
};

function formatLastEditTime(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function WorkLogFieldLabel({ label, fieldKey }: { label: string; fieldKey?: string }) {
  const [hovered, setHovered] = useState(false);
  const history = useContext(WorkLogLastEditContext);
  const info = history[fieldKey || WORKLOG_LABEL_FIELD_KEYS[label] || ''];
  if (!info) return <span className="flex min-h-5 items-center text-xs text-slate-500">{label}</span>;
  const editor = info.editedName || info.editedBy || '未知用户';
  const time = formatLastEditTime(info.editedAt);
  return (
    <span className="flex items-center justify-between">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="relative ml-2 inline-flex shrink-0">
        <button
          type="button"
          className="inline-flex h-5 w-5 items-center justify-center text-slate-400 opacity-80 transition-colors hover:text-primary-600"
          aria-label={`${time} · ${editor}`}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          <Clock3 size={14} />
        </button>
        {hovered && <span role="tooltip" className="pointer-events-none absolute right-0 top-6 z-50 w-max max-w-64 border border-slate-200 bg-slate-950 px-2.5 py-2 text-left text-xs leading-5 text-white shadow-lg">
          <span className="block font-medium">{time} · {editor}</span>
        </span>}
      </span>
    </span>
  );
}

const TABS = [
  { key: '全部项目', label: '全部项目' },
  { key: '正常项目', label: '正常项目' },
  { key: '问题项目', label: '问题项目' },
  { key: '直销产品情况', label: '直销产品情况' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

const DIRECT_SALES_SERIES_OPTIONS = ['固收系列', '含权系列', '权益系列'];
const NORMAL_PROJECT_CATEGORY_OPTIONS = [...PROJECT_CATEGORY_OPTIONS];
const MANAGEMENT_REPORT_OPTIONS = ['每季度', '年度报告'];
const RISK_REPORT_OPTIONS = ['每季度整体报告', '每季度报告', '每周持仓\n每月持仓'];
const SALES_REPORT_OPTIONS = ['每月估值表', '季度', '月报', '每日估值表'];

function normalizeNormalProjectCategory(value: string) {
  return value.replace(/\s+/g, '').replace(/[（(]/g, '（').replace(/[）)]/g, '）').trim();
}

function normalProjectCategoryLinkage(value: string): Pick<WorkLogEntry, 'activePassive' | 'collectiveSingle'> | null {
  return projectCategoryLinkage(normalizeNormalProjectCategory(value));
}

function productTermNumber(value: string | number | undefined) {
  const match = String(value ?? '').match(/\d+(?:\.\d+)?/);
  return match?.[0] || '';
}

function formatProductTerm(value: string) {
  const clean = value.trim();
  return clean ? `${clean}年` : '';
}

function calculateChangePercent(nav: number, yearStartNav: number) {
  if (!Number.isFinite(nav) || !Number.isFinite(yearStartNav) || yearStartNav === 0) return null;
  return nav / yearStartNav - 1;
}

function isHistoricalStatus(status: string): boolean {
  if (!status) return false;
  return ['历史', '已终止', '已结束', '已归档', '终止', '清算', '结项', '中止']
    .some(keyword => status.includes(keyword));
}

const PROJECT_STATUS_ORDER = ['材料收集', '报告撰写', '上会中', '已过会', '已成立', '项目中止', '未填写'];

function normalizeProjectStatus(status?: string) {
  if (!status) return '未填写';
  if (status.includes('成立')) return '已成立';
  if (status.includes('落地')) return '已成立';
  if (status.includes('过会')) return '已过会';
  if (status.includes('上会')) return '上会中';
  if (status.includes('报告')) return '报告撰写';
  if (status.includes('材料')) return '材料收集';
  if (status.includes('终止')) return '项目中止';
  if (status.includes('中止')) return '项目中止';
  return status;
}

function projectStatusRank(status?: string) {
  const normalized = normalizeProjectStatus(status);
  const index = PROJECT_STATUS_ORDER.indexOf(normalized);
  return index >= 0 ? index : PROJECT_STATUS_ORDER.indexOf('未填写');
}

const WORKLOG_CATEGORY_COLORS: Record<string, string> = {
  ['\u6b63\u5e38\u9879\u76ee']: '#22c55e',
  ['\u95ee\u9898\u9879\u76ee']: '#ef4444',
  ['\u76f4\u9500\u4ea7\u54c1\u60c5\u51b5']: '#3b82f6',
};

function workLogCategoryColor(entry: WorkLogEntry) {
  return WORKLOG_CATEGORY_COLORS[getWorkLogCategory(entry)] || '#64748b';
}

function baseInfoGaps(entry: WorkLogEntry) {
  const gaps: string[] = [];
  if (!entry.productName?.trim()) gaps.push('\u4ea7\u54c1');
  return gaps;
}

function getWeekLabel(key: string) {
  if (key === '__legacy__') return '原始导入数据';
  const range = getWeekRange(key);
  const weekNumber = getWeekNumber(key);
  return `第 ${weekNumber} 周 (${range.start}~${range.end})`;
}

function getWorkLogCategory(entry: WorkLogEntry): TabKey {
  const raw = entry.category || '';
  if (raw === '问题项目' || raw.includes('问题') || raw.includes('闂')) return '问题项目';
  if (raw === '直销产品情况' || raw.includes('直销') || raw.includes('鐩撮攢')) return '直销产品情况';
  return '正常项目';
}

function workLogProgress(entry: WorkLogEntry, selectedWeekKey?: string | null) {
  if (selectedWeekKey) return entry.weeklyProgress?.[selectedWeekKey] || '';
  return Object.entries(entry.weeklyProgress || {})
    .filter(([, value]) => Boolean(value) && value !== '/')
    .sort(([left], [right]) => right.localeCompare(left))[0]?.[1] || '';
}

function inheritedNavScale(entry: WorkLogEntry, selectedWeekKey?: string | null) {
  if (!selectedWeekKey) return entry.navScale || '';
  const history = entry.navScaleHistory || {};
  if (history[selectedWeekKey]) return history[selectedWeekKey];
  const inheritedKey = Object.keys(history)
    .filter(key => key <= selectedWeekKey && history[key])
    .sort()
    .at(-1);
  return inheritedKey ? history[inheritedKey] : (entry.navScale || '');
}

function historicalFallbackEntry(entry: WorkLogEntry, weekKey: string): WorkLogEntry {
  return {
    ...entry,
    navScale: inheritedNavScale(entry, weekKey),
    navScaleHistory: entry.navScaleHistory || {},
    weekKey,
  };
}

const HISTORICAL_MANAGEMENT_FIELDS: Array<keyof WorkLogEntry> = [
  'subCategory',
  'status',
  'clientType',
  'description',
  'establishDate',
  'deadline',
  'productTerm',
  'personA',
  'personB',
  'activePassive',
  'collectiveSingle',
  'advisorManager',
  'channelSales',
  'features',
  'managementReport',
  'riskReport',
  'salesReport',
  'nextWeekPlan',
];

function fillMissingHistoricalManagement(
  historical: WorkLogEntry,
  current: WorkLogEntry,
): WorkLogEntry {
  const result = { ...historical } as Record<string, unknown>;
  for (const field of HISTORICAL_MANAGEMENT_FIELDS) {
    const oldValue = result[field];
    if ((oldValue == null || String(oldValue).trim() === '') && current[field]) {
      result[field] = current[field];
    }
  }
  return result as unknown as WorkLogEntry;
}

function normalizeDirectSalesSeries(value: string) {
  if (value.includes('固收')) return '固收系列';
  if (value.includes('含权') || value.includes('盈泰')) return '含权系列';
  if (value.includes('权益')) return '权益系列';
  return '';
}

function ProductNameTemplateSuggestion({ template }: { template: string }) {
  const parts = normalizeProductNameTemplateSlots(template).split(PRODUCT_NAME_TEMPLATE_SLOT);
  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-x-1 gap-y-1">
      {parts.map((part, index) => (
        <span key={`${part}-${index}`} className="inline-flex items-center">
          {part && <span>{part}</span>}
          {index < parts.length - 1 && (
            <span className="mx-0.5 inline-flex h-5 min-w-8 items-center justify-center rounded border border-slate-300 bg-slate-50 px-2 text-xs text-slate-400">
              填空
            </span>
          )}
        </span>
      ))}
    </span>
  );
}

function buildProductNameFromTemplate(template: string, values: string[]) {
  const parts = normalizeProductNameTemplateSlots(template).split(PRODUCT_NAME_TEMPLATE_SLOT);
  return parts.map((part, index) => `${part}${values[index] || ''}`).join('');
}

function ProductNameTemplateInputs({
  template,
  onNameChange,
}: {
  template: string;
  onNameChange: (value: string) => void;
}) {
  return (
    <TemplateRichNameInput
      template={template}
      onChange={onNameChange}
      placeholder={'\u4ea7\u54c1\u540d\u79f0'}
    />
  );
}

function WorkLogProductNameField({
  label,
  value,
  onChange,
  focused = false,
  span = 1,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  focused?: boolean;
  span?: 1 | 2;
}) {
  const isCreateMode = useContext(WorkLogCreateContext);
  const [isFocused, setIsFocused] = useState(false);
  const [activeTemplate, setActiveTemplate] = useState<string | null>(null);
  const [draftValue, setDraftValue] = useState(value);
  const latestDraftRef = useRef(value);
  const draftDirtyRef = useRef(false);
  const settings = useSettingsStore(state => state.settings);
  const initialCreateParts = useRef((() => {
    const match = value.trim().match(/^(.*?)(\d+)(.*)$/);
    return match ? { prefix: match[1], number: match[2], suffix: match[3] } : null;
  })());
  const defaultCreatePrefix = settings.workLogNamePrefixes?.[0] || '鸿泰-跨境投资';
  const defaultCreateSuffix = settings.workLogNameSuffixes?.[0] || '号QDII单一资金信托';
  const [createPrefix, setCreatePrefix] = useState(initialCreateParts.current?.prefix || defaultCreatePrefix);
  const [createNumber, setCreateNumber] = useState(initialCreateParts.current?.number || '');
  const [createSuffix, setCreateSuffix] = useState(initialCreateParts.current?.suffix || defaultCreateSuffix);
  const createPrefixes = Array.from(new Set([
    ...(settings.workLogNamePrefixes || [defaultCreatePrefix]),
    ...(initialCreateParts.current?.prefix ? [initialCreateParts.current.prefix] : []),
  ]));
  const createSuffixes = Array.from(new Set([
    ...(settings.workLogNameSuffixes || [defaultCreateSuffix]),
    ...(initialCreateParts.current?.suffix ? [initialCreateParts.current.suffix] : []),
  ]));
  const entriesForTemplateWeight = useWorkLogStore(state => state.entries);
  const templateCounts = useMemo(() => {
    const counts = new Map<string, number>();
    entriesForTemplateWeight.map(entry => entry.productName).forEach(name => {
      const template = inferProductNameTemplate(name || '');
      const key = normalizeProductNameTemplate(template);
      if (!name || !template || template === name.trim() || !key) return;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return counts;
  }, [entriesForTemplateWeight]);
  const productNameTemplates = useMemo(() => {
    const seen = new Set<string>();
    return settings.productNameTemplates
      .filter(rule => (rule.scope || 'workLog') === 'workLog')
      .map(rule => {
        const template = getTemplateText(rule).trim();
        const key = normalizeProductNameTemplate(template);
        const count = templateCounts.get(key) || 0;
        return { key, template, count, source: 'manual' as const };
      })
      .filter(row => {
        if (!row.template || seen.has(row.key)) return false;
        seen.add(row.key);
        return true;
      })
      .sort((left, right) => (
        calculateProductNameTemplateWeight({ template: right.template, count: right.count, source: right.source })
        - calculateProductNameTemplateWeight({ template: left.template, count: left.count, source: left.source })
        || left.template.localeCompare(right.template, 'zh-CN')
      ))
      .map(row => row.template);
  }, [settings.productNameTemplates, templateCounts]);
  const matchedTemplates = useMemo(() => {
    const query = draftValue.trim().toLowerCase();
    if (!query) return [];
    return productNameTemplates
      .filter(template => template.toLowerCase().includes(query))
      .sort((left, right) => {
        const leftKey = normalizeProductNameTemplate(left);
        const rightKey = normalizeProductNameTemplate(right);
        return (
          calculateProductNameTemplateWeight({ template: right, count: templateCounts.get(rightKey) || 0, source: 'manual', query })
          - calculateProductNameTemplateWeight({ template: left, count: templateCounts.get(leftKey) || 0, source: 'manual', query })
          || left.localeCompare(right, 'zh-CN')
        );
      })
      .slice(0, 8);
  }, [draftValue, productNameTemplates, templateCounts]);
  const showSuggestions = !isCreateMode && !activeTemplate && isFocused && matchedTemplates.length > 0;

  useEffect(() => {
    if (draftDirtyRef.current) return;
    latestDraftRef.current = value;
    setDraftValue(value);
    if (!value.trim()) setActiveTemplate(null);
  }, [value]);

  const changeDraft = (nextValue: string) => {
    latestDraftRef.current = nextValue;
    setDraftValue(nextValue);
    draftDirtyRef.current = true;
  };

  const flushDraft = () => {
    if (!draftDirtyRef.current) return;
    draftDirtyRef.current = false;
    if (latestDraftRef.current !== value) onChange(latestDraftRef.current);
  };

  const applyCreateName = (prefix: string, number: string, suffix: string) => {
    setCreatePrefix(prefix);
    setCreateNumber(number);
    setCreateSuffix(suffix);
    onChange(`${prefix}${number}${suffix}`);
  };

  const applyTemplate = (template: string) => {
    const normalizedTemplate = normalizeProductNameTemplateSlots(template);
    setActiveTemplate(normalizedTemplate);
    changeDraft(buildProductNameFromTemplate(normalizedTemplate, []));
    setIsFocused(false);
  };

  if (isCreateMode) {
    return (
      <div data-worklog-field="productName" className={`project-detail-field ${focused ? 'is-focused' : ''} ${span === 2 ? 'md:col-span-2' : ''}`}>
        <WorkLogFieldLabel label={label} fieldKey="productName" />
        <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_110px_minmax(0,1fr)]">
          <AppSelect
            value={createPrefix}
            options={createPrefixes.map(prefix => ({ value: prefix, label: prefix, searchText: prefix }))}
            onChange={prefix => applyCreateName(prefix, createNumber, createSuffix)}
            placeholder="选择前缀"
            emptyText="暂无前缀"
            variant="anchored"
            triggerClassName="h-11 sm:h-9"
          />
          <input
            value={createNumber}
            inputMode="numeric"
            onChange={event => applyCreateName(createPrefix, event.target.value.replace(/[^\d]/g, ''), createSuffix)}
            className="h-11 w-full border border-slate-200 bg-white px-2.5 text-sm font-medium text-slate-900 outline-none focus:border-slate-400 sm:h-9"
            placeholder="数字"
            aria-label="产品编号"
          />
          <AppSelect
            value={createSuffix}
            options={createSuffixes.map(suffix => ({ value: suffix, label: suffix, searchText: suffix }))}
            onChange={suffix => applyCreateName(createPrefix, createNumber, suffix)}
            placeholder="选择后缀"
            emptyText="暂无后缀"
            variant="anchored"
            triggerClassName="h-11 sm:h-9"
          />
        </div>
        <output className="mt-2 flex h-9 items-center border border-slate-200 bg-slate-50 px-2.5 text-sm font-medium text-slate-700">
          {`${createPrefix}${createNumber}${createSuffix}`}
        </output>
      </div>
    );
  }

  return (
    <div
      data-worklog-field="productName"
      className={`project-detail-field ${focused ? 'is-focused' : ''} ${span === 2 ? 'md:col-span-2' : ''}`}
      onBlurCapture={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setIsFocused(false);
        flushDraft();
      }}
    >
      <WorkLogFieldLabel label={label} fieldKey="productName" />
      <div className="relative mt-1">
        {activeTemplate ? (
          <div>
            <ProductNameTemplateInputs
              template={activeTemplate}
              onNameChange={changeDraft}
            />
          </div>
        ) : (
          <input
            value={draftValue}
            onChange={event => changeDraft(event.target.value)}
            onFocus={() => setIsFocused(true)}
            className="h-9 w-full border border-slate-200 bg-white px-2.5 text-sm font-medium text-slate-900 outline-none transition-colors focus:border-slate-400"
            placeholder={'\u4ea7\u54c1\u540d\u79f0'}
          />
        )}
        {showSuggestions && (
          <div className="project-detail-suggestions">
            {matchedTemplates.map(template => (
              <button
                key={template}
                type="button"
                onMouseDown={event => event.preventDefault()}
                onClick={() => {
                  applyTemplate(template);
                }}
                className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
              >
                <span className="break-all">
                  <ProductNameTemplateSuggestion template={template} />
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EditableDetailField({
  label,
  value,
  onChange,
  span = 1,
  multiline = false,
  type = 'text',
  onEditingStart,
  onEditingStop,
  fieldKey,
  focused = false,
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  span?: 1 | 2 | 3;
  multiline?: boolean;
  type?: 'text' | 'number' | 'date';
  onEditingStart?: () => void;
  onEditingStop?: () => void;
  fieldKey?: string;
  focused?: boolean;
}) {
  const [draftValue, setDraftValue] = useState<string | number>(value);
  const latestDraftRef = useRef<string | number>(value);
  const latestValueRef = useRef<string | number>(value);
  const onChangeRef = useRef(onChange);
  const draftDirtyRef = useRef(false);
  const focusedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const spanClass = {
    1: '',
    2: 'md:col-span-2',
    3: 'md:col-span-3',
  }[span];

  latestValueRef.current = value;
  onChangeRef.current = onChange;

  useEffect(() => {
    if (focusedRef.current || draftDirtyRef.current) return;
    latestDraftRef.current = value;
    setDraftValue(value);
  }, [value]);

  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  }, []);

  const flushDraft = () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (!draftDirtyRef.current) return;
    draftDirtyRef.current = false;
    if (String(latestDraftRef.current ?? '') !== String(latestValueRef.current ?? '')) {
      onChangeRef.current(String(latestDraftRef.current));
    }
  };

  const changeDraft = (nextValue: string) => {
    latestDraftRef.current = nextValue;
    setDraftValue(nextValue);
    draftDirtyRef.current = true;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(flushDraft, 1500);
  };

  return (
    <label
      data-worklog-field={fieldKey}
      className={`project-detail-field ${focused ? 'is-focused' : ''} ${spanClass}`}
      onFocusCapture={() => {
        focusedRef.current = true;
        onEditingStart?.();
      }}
      onBlurCapture={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        focusedRef.current = false;
        flushDraft();
        onEditingStop?.();
      }}
    >
      <WorkLogFieldLabel label={label} fieldKey={fieldKey} />
      {multiline ? (
        <MobileTextInput
          value={draftValue}
          multiline
          title={label}
          onChange={changeDraft}
          className="mt-1 min-h-20 w-full resize-y border border-slate-200 bg-white px-2.5 py-2 text-sm font-medium text-slate-900 outline-none transition-colors focus:border-slate-400"
        />
      ) : type === 'date' ? (
        <MobileDateInput
          value={String(draftValue || '')}
          onChange={changeDraft}
          title={label}
          className="mt-1 h-9 w-full border border-slate-200 bg-white px-2.5 text-sm font-medium text-slate-900 outline-none transition-colors focus:border-slate-400"
        />
      ) : type === 'number' ? (
        <MobileNumberInput
          value={draftValue}
          onChange={changeDraft}
          title={label}
          className="mt-1 h-9 w-full border border-slate-200 bg-white px-2.5 text-sm font-medium text-slate-900 outline-none transition-colors focus:border-slate-400"
        />
      ) : (
        <MobileTextInput
          value={draftValue}
          title={label}
          onChange={changeDraft}
          className="mt-1 h-9 w-full border border-slate-200 bg-white px-2.5 text-sm font-medium text-slate-900 outline-none transition-colors focus:border-slate-400"
        />
      )}
    </label>
  );
}

function EditableDetailSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="min-w-0 border border-slate-200 bg-slate-50 px-3 py-2">
      <WorkLogFieldLabel label={label} />
      <div className="hidden lg:block"><AppSelect
        value={value}
        options={options}
        onChange={onChange}
        placeholder="请选择"
        clearable
        className="mt-1"
        triggerClassName="h-9 border-slate-200"
      /></div>
      <MobileSelectInput value={value} options={options} onChange={onChange} title={label} className="mt-1 h-9 w-full" />
    </label>
  );
}

function InlineDetailSelect({
  label,
  value,
  options,
  onChange,
  onEditingStart,
  onEditingStop,
  fieldKey,
  focused = false,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  onEditingStart?: () => void;
  onEditingStop?: () => void;
  fieldKey?: string;
  focused?: boolean;
}) {
  const isCreateMode = useContext(WorkLogCreateContext);
  return (
    <label
      data-worklog-field={fieldKey}
      className={`project-detail-field ${focused ? 'is-focused' : ''}`}
      onFocusCapture={onEditingStart}
      onBlurCapture={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        onEditingStop?.();
      }}
    >
      <WorkLogFieldLabel label={label} fieldKey={fieldKey} />
      <div className="hidden lg:block"><AppSelect
        value={value}
        options={options}
        onChange={onChange}
        className="mt-1"
        variant={isCreateMode ? 'anchored' : 'inline'}
        clearable
      /></div>
      <MobileSelectInput value={value} options={options} onChange={onChange} title={label} className="mt-1 h-9 w-full" />
    </label>
  );
}

function YearDetailField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
}) {
  const normalizedValue = productTermNumber(value);
  const [draftValue, setDraftValue] = useState(normalizedValue);
  const latestDraftRef = useRef(normalizedValue);
  const draftDirtyRef = useRef(false);

  useEffect(() => {
    if (draftDirtyRef.current) return;
    const nextValue = productTermNumber(value);
    latestDraftRef.current = nextValue;
    setDraftValue(nextValue);
  }, [value]);

  const flushDraft = () => {
    if (!draftDirtyRef.current) return;
    draftDirtyRef.current = false;
    const nextValue = formatProductTerm(String(latestDraftRef.current));
    if (nextValue !== String(value ?? '')) onChange(nextValue);
  };

  return (
    <label className="project-detail-field min-w-0 border border-slate-200 bg-slate-50 px-3 py-2" onBlurCapture={flushDraft}>
      <WorkLogFieldLabel label={label} />
      <div className="mt-1 flex h-9 overflow-hidden border border-slate-200 bg-white focus-within:border-slate-400">
        <MobileNumberInput
          value={draftValue}
          step="1"
          title={label}
          onChange={nextValue => {
            const formatted = formatProductTerm(nextValue);
            latestDraftRef.current = formatted;
            setDraftValue(productTermNumber(formatted));
            draftDirtyRef.current = false;
            onChange(formatted);
          }}
          className="min-w-0 flex-1 border-0 px-2.5 text-sm font-medium text-slate-900 outline-none"
        />
        <span className="flex h-full items-center border-l border-slate-200 bg-slate-50 px-3 text-sm text-slate-500">年</span>
      </div>
    </label>
  );
}

function ReadOnlyDetailField({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <label className="project-detail-field min-w-0 border border-slate-200 bg-slate-50 px-3 py-2">
      <span className="text-xs text-slate-500">{label}</span>
      <input
        value={value}
        readOnly
        className="mt-1 h-9 w-full border border-slate-200 bg-slate-100 px-2.5 text-sm font-medium text-slate-700 outline-none"
      />
    </label>
  );
}

void EditableDetailSelect;

type WorkLogPageMemory = {
  searchQuery: string;
  activeTab: TabKey;
  displayMode: 'cards' | 'table';
  detailEntryId: string | null;
  selectedWeekKey: string | null;
  listScrollTop: number;
  pageScrollY: number;
  detailDraft: WorkLogEntry | null;
};

const WORKLOG_SNAPSHOT_KEY = 'worklog';

function readWorkLogPageMemory(userId?: string): Partial<WorkLogPageMemory> {
  if (typeof window === 'undefined') return {};
  try {
    return readPageSnapshot<WorkLogPageMemory>(WORKLOG_SNAPSHOT_KEY, userId);
  } catch {
    return {};
  }
}

function writeWorkLogPageMemory(userId: string | undefined, value: WorkLogPageMemory) {
  try {
    writePageSnapshot(WORKLOG_SNAPSHOT_KEY, userId, value);
  } catch {
    // Session storage may be unavailable in privacy-restricted browsers.
  }
}

export default function WorkLogList() {
  const [searchParams, setSearchParams] = useSearchParams();
  const routeEntryId = searchParams.get('entryId');
  const createFromProjectId = searchParams.get('createFromProject');
  const routeWeekKey = searchParams.get('weekKey');
  const routeWorkLogField = searchParams.get('field');
  const {
    entries,
    fetchEntries,
    isLoading,
    addEntry,
    updateEntry,
    deleteEntry,
    blankEntry,
    replaceEntries,
    mergeEntries,
    refreshCurrentWeek,
    currentWeekKey,
    selectedWeekKey,
    setSelectedWeekKey,
  } = useWorkLogStore(useShallow(s => ({
    entries: s.entries,
    fetchEntries: s.fetchEntries,
    isLoading: s.isLoading,
    addEntry: s.addEntry,
    updateEntry: s.updateEntry,
    deleteEntry: s.deleteEntry,
    blankEntry: s.blankEntry,
    replaceEntries: s.replaceEntries,
    mergeEntries: s.mergeEntries,
    refreshCurrentWeek: s.refreshCurrentWeek,
    currentWeekKey: s.currentWeekKey,
    selectedWeekKey: s.selectedWeekKey,
    setSelectedWeekKey: s.setSelectedWeekKey,
  })));
  const { products } = useProjectStore(useShallow(s => ({
    products: s.products,
  })));
  const settings = useSettingsStore(s => s.settings);
  const workLogStatusOptions = useMemo(() => [...MANAGEMENT_STAGE_OPTIONS], []);
  const currentUser = useAuthStore(s => s.user);
  const isMobileViewport = useMobileViewport();
  const pageMemory = useMemo(() => readWorkLogPageMemory(currentUser?.id), [currentUser?.id]);
  const [displayMode, setDisplayMode] = useState<'cards' | 'table'>(() => pageMemory.displayMode === 'table' ? 'table' : 'cards');
  const [workLogTableToolbarHost, setWorkLogTableToolbarHost] = useState<HTMLDivElement | null>(null);
  const accountName = currentUser?.display_name?.trim() || '';
  const trustManagers = settings.trustManagers;
  const [searchQuery, setSearchQuery] = useState(() => String(pageMemory.searchQuery || ''));
  const showOnlyMine = useUiPreferenceStore(state => state.preferences.worklogOnlyMine);
  const selectedManagerFilters = useUiPreferenceStore(state => state.preferences.worklogManagerFilters);
  const setOnlyMinePreference = useUiPreferenceStore(state => state.setOnlyMine);
  const worklogCardFields = useUiPreferenceStore(useShallow(state => ({
    normal: state.preferences.worklogNormalCardFields,
    problem: state.preferences.worklogProblemCardFields,
    directSales: state.preferences.worklogDirectSalesCardFields,
  })));
  const worklogCardColumns = useUiPreferenceStore(state => state.preferences.worklogCardColumns);
  const updatePreferences = useUiPreferenceStore(state => state.updatePreferences);
  const [cardSettingsOpen, setCardSettingsOpen] = useState(false);
  const [cardFieldDraft, setCardFieldDraft] = useState<WorkLogCardFieldPreferences>(worklogCardFields);
  const [cardColumnsDraft, setCardColumnsDraft] = useState<3 | 4 | 5 | 6>(worklogCardColumns);
  const debouncedQuery = useDebounce(searchQuery, 200);
  const [activeTab, setActiveTab] = useState<TabKey>(() => TABS.some(tab => tab.key === pageMemory.activeTab) ? pageMemory.activeTab as TabKey : '全部项目');
  useEffect(() => {
    if (isMobileViewport && activeTab === TABS[0].key) setActiveTab(TABS[1].key);
  }, [activeTab, isMobileViewport]);
  const isDirectSalesTab = activeTab === '直销产品情况';
  const effectiveDisplayMode = isMobileViewport || isDirectSalesTab ? 'cards' : displayMode;
  const [showImportModal, setShowImportModal] = useState(false);
  const [importInitialFile, setImportInitialFile] = useState<File | null>(null);
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const [detailEntryId, setDetailEntryId] = useState<string | null>(() => pageMemory.detailEntryId || null);
  const listScrollRef = useRef<HTMLDivElement>(null);
  const pageMemoryRef = useRef(pageMemory);
  const skipFirstMemoryWriteRef = useRef(true);
  const [detailDraft, setDetailDraft] = useState<WorkLogEntry | null>(() => pageMemory.detailDraft || null);
  const [mobileWorkLogEditField, setMobileWorkLogEditField] = useState<MobileDetailEditorField | null>(null);
  const handledProjectDraftRef = useRef<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [snapshotEntries, setSnapshotEntries] = useState<WorkLogEntry[]>([]);
  const [snapshotWeekKeys, setSnapshotWeekKeys] = useState<string[]>([]);
  const [detailHistory, setDetailHistory] = useState<WorkLogHistoryEntry[]>([]);

  const openCardSettings = () => {
    setCardFieldDraft({
      normal: [...worklogCardFields.normal],
      problem: [...worklogCardFields.problem],
      directSales: [...worklogCardFields.directSales],
    });
    setCardColumnsDraft(worklogCardColumns);
    setCardSettingsOpen(true);
  };

  const toggleCardField = (scope: keyof WorkLogCardFieldPreferences, field: string, limit: number) => {
    setCardFieldDraft(current => {
      const selected = current[scope];
      if (selected.includes(field)) {
        if (selected.length === 1) return current;
        return { ...current, [scope]: selected.filter(item => item !== field) };
      }
      if (selected.length >= limit) return current;
      return { ...current, [scope]: [...selected, field] };
    });
  };

  const saveCardSettings = async () => {
    const saved = await updatePreferences({
      worklogNormalCardFields: cardFieldDraft.normal,
      worklogProblemCardFields: cardFieldDraft.problem,
      worklogDirectSalesCardFields: cardFieldDraft.directSales,
      worklogCardColumns: cardColumnsDraft,
    }, '管理周报卡片设置保存失败');
    if (saved) {
      setCardSettingsOpen(false);
      _toast.success?.('管理周报卡片设置已保存');
    }
  };
  const lastEditByField = useMemo(() => {
    const latest: Record<string, WorkLogLastEdit> = {};
    detailHistory.forEach(entry => {
      if (!latest[entry.field]) latest[entry.field] = { editedBy: entry.editedBy, editedName: entry.editedName, editedAt: entry.editedAt };
    });
    return latest;
  }, [detailHistory]);
  useEffect(() => {
    setSelectedWeekKey(pageMemory.selectedWeekKey || null);
  }, [pageMemory.selectedWeekKey, setSelectedWeekKey]);

  useEffect(() => {
    if (skipFirstMemoryWriteRef.current) {
      skipFirstMemoryWriteRef.current = false;
      return;
    }
    const memory: WorkLogPageMemory = {
      searchQuery,
      activeTab,
      displayMode,
      detailEntryId,
      selectedWeekKey,
      listScrollTop: listScrollRef.current?.scrollTop ?? pageMemoryRef.current.listScrollTop ?? 0,
      pageScrollY: window.scrollY,
      detailDraft,
    };
    pageMemoryRef.current = memory;
    writeWorkLogPageMemory(currentUser?.id, memory);
  }, [activeTab, currentUser?.id, detailDraft, detailEntryId, displayMode, searchQuery, selectedWeekKey]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (listScrollRef.current) listScrollRef.current.scrollTop = Number(pageMemory.listScrollTop || 0);
      window.scrollTo({ top: Number(pageMemory.pageScrollY || 0), behavior: 'auto' });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      const memory = {
        ...pageMemoryRef.current,
        listScrollTop: listScrollRef.current?.scrollTop ?? pageMemoryRef.current.listScrollTop ?? 0,
        pageScrollY: window.scrollY,
      } as WorkLogPageMemory;
      writeWorkLogPageMemory(currentUser?.id, memory);
    };
  }, [currentUser?.id, pageMemory.listScrollTop, pageMemory.pageScrollY]);

  useEffect(() => {
    const timer = window.setInterval(refreshCurrentWeek, 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [refreshCurrentWeek]);

  useEffect(() => {
    let cancelled = false;
    const loadSnapshot = async () => {
      if (!selectedWeekKey || selectedWeekKey === currentWeekKey || selectedWeekKey === '__legacy__') {
        setSnapshotEntries([]);
        return;
      }
      try {
        const res = await api.get<{ entries: WorkLogEntry[] }>(`/entries/snapshots/${selectedWeekKey}`);
        if (!cancelled) setSnapshotEntries(res.entries || []);
      } catch {
        if (!cancelled) setSnapshotEntries([]);
      }
    };
    loadSnapshot();
    return () => {
      cancelled = true;
    };
  }, [selectedWeekKey, currentWeekKey]);

  useEffect(() => {
    let cancelled = false;
    const loadSnapshotWeeks = async () => {
      try {
        const weekKeys = await getWorkLogSnapshotWeekKeys();
        if (!cancelled) setSnapshotWeekKeys(weekKeys);
      } catch {
        if (!cancelled) setSnapshotWeekKeys([]);
      }
    };
    loadSnapshotWeeks();
    return () => {
      cancelled = true;
    };
  }, [entries.length]);

  useEffect(() => {
    if (!routeEntryId) return;
    const targetEntry = entries.find(entry => entry.id === routeEntryId);
    if (!targetEntry) return;
    setDetailDraft(null);
    setDetailEntryId(targetEntry.id);
    setActiveTab(getWorkLogCategory(targetEntry));
  }, [entries, routeEntryId]);

  useEffect(() => {
    if (!detailEntryId || !routeWorkLogField) return;
    const timer = window.setTimeout(() => {
      const target = document.querySelector(`[data-worklog-field="${CSS.escape(routeWorkLogField)}"]`);
      target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 160);
    return () => window.clearTimeout(timer);
  }, [detailEntryId, routeWorkLogField]);

  useEffect(() => {
    if (!detailEntryId || detailDraft) {
      setDetailHistory([]);
      return;
    }
    let cancelled = false;
    api.get<{ entries: WorkLogHistoryEntry[] }>(`/history/entry/${encodeURIComponent(detailEntryId)}`)
      .then(result => { if (!cancelled) setDetailHistory(result.entries || []); })
      .catch(() => { if (!cancelled) setDetailHistory([]); });
    return () => { cancelled = true; };
  }, [detailEntryId, detailDraft?.id]);

  const productByName = useMemo(() => {
    const map = new Map<string, InvestmentProduct>();
    products.forEach(product => {
      if (product.productName) map.set(product.productName.trim(), product);
    });
    return map;
  }, [products]);
  const productById = useMemo(() => new Map(products.map(product => [product.id, product])), [products]);
  const relatedProduct = (entry: WorkLogEntry) => entry.projectId
    ? productById.get(entry.projectId)
    : productByName.get((entry.productName || '').trim());

  useEffect(() => {
    if (!createFromProjectId || handledProjectDraftRef.current === createFromProjectId) return;
    const product = productById.get(createFromProjectId);
    if (!product) return;

    const existing = entries
      .filter(entry => entry.projectId === createFromProjectId)
      .sort((left, right) => (right.updatedAt || '').localeCompare(left.updatedAt || ''))[0];
    handledProjectDraftRef.current = createFromProjectId;

    if (existing) {
      setDetailDraft(null);
      setDetailEntryId(existing.id);
      setActiveTab(getWorkLogCategory(existing));
      setSearchParams({ entryId: existing.id });
      _toast.info?.('该项目已有管理周报，已为你打开现有记录');
      return;
    }

    const draft = blankEntry();
    const scaleParts = [
      product.rmb ? `人民币 ${product.rmb} 万元` : '',
      product.usd ? `美元 ${product.usd} 万美元` : '',
    ].filter(Boolean);
    setDetailEntryId(null);
    setActiveTab('\u6b63\u5e38\u9879\u76ee');
    setDetailDraft({
      ...draft,
      projectId: product.id,
      category: '\u6b63\u5e38\u9879\u76ee',
      productName: product.productName,
      status: '运行中',
      clientType: product.client || '',
      navScale: scaleParts.join(' / '),
      establishDate: product.establishDate || '',
      personA: product.trustManager || '',
      subCategory: product.projectCategory || '',
      activePassive: product.activePassive || '',
      collectiveSingle: product.collectiveSingle || '',
      weekKey: currentWeekKey,
    });
    setSearchParams({});
  }, [blankEntry, createFromProjectId, currentWeekKey, entries, productById, setSearchParams]);

  const activeEntries = useMemo(
    () => entries.filter(entry => !isHistoricalStatus(entry.status)),
    [entries],
  );
  const activeEntryLookup = useMemo(() => {
    const map = new Map<string, WorkLogEntry>();
    activeEntries.forEach(entry => {
      map.set(`id:${entry.id}`, entry);
      map.set(`name:${getWorkLogCategory(entry)}:${entry.productName.trim()}`, entry);
    });
    return map;
  }, [activeEntries]);
  const hasSelectedSnapshot = Boolean(
    selectedWeekKey &&
    selectedWeekKey !== currentWeekKey &&
    selectedWeekKey !== '__legacy__' &&
    snapshotEntries.length > 0
  );

  const allWeekKeys = useMemo(() => {
    const keys = new Set<string>();
    if (currentWeekKey) keys.add(currentWeekKey);
    activeEntries.forEach(entry => {
      if (entry.weekKey) keys.add(entry.weekKey);
      else keys.add('__legacy__');
      Object.keys(entry.weeklyProgress || {}).forEach(key => {
        if (key) keys.add(key);
      });
    });
    snapshotWeekKeys.forEach(key => {
      if (key) keys.add(key);
    });
    return Array.from(keys).sort().reverse();
  }, [activeEntries, currentWeekKey, snapshotWeekKeys]);

  const weekOptions = useMemo(
    () => allWeekKeys
      .filter(key => key !== '__legacy__')
      .map(key => ({ key, label: getWorkWeekLabelForKey(key) })),
    [allWeekKeys],
  );
  const workWeekLabel = getWorkWeekLabelForKey(selectedWeekKey || currentWeekKey);

  const weekFilteredEntries = useMemo(() => {
    if (hasSelectedSnapshot) {
      return snapshotEntries
        .filter(entry => !isHistoricalStatus(entry.status))
        .map(entry => {
          const current = activeEntryLookup.get(`id:${entry.id}`)
            || activeEntryLookup.get(`name:${getWorkLogCategory(entry)}:${entry.productName.trim()}`);
          return current ? fillMissingHistoricalManagement(entry, current) : entry;
        });
    }
    if (!selectedWeekKey) return activeEntries;
    if (selectedWeekKey === currentWeekKey) return activeEntries;
    if (selectedWeekKey === '__legacy__') return activeEntries.filter(entry => !entry.weekKey);
    if (selectedWeekKey !== currentWeekKey) {
      return activeEntries
        .filter(entry => Boolean(entry.weeklyProgress?.[selectedWeekKey]))
        .map(entry => historicalFallbackEntry(entry, selectedWeekKey));
    }
    return activeEntries;
  }, [activeEntries, activeEntryLookup, currentWeekKey, hasSelectedSnapshot, selectedWeekKey, snapshotEntries]);

  const accountFilteredEntries = useMemo(
    () => currentUser?.business_role === 'admin' && selectedManagerFilters.length > 0
      ? weekFilteredEntries.filter(entry => selectedManagerFilters.includes(String(entry.personA || '').trim()) || selectedManagerFilters.includes(String(entry.personB || '').trim()))
      : showOnlyMine && currentUser?.business_role !== 'admin'
        ? weekFilteredEntries.filter(entry => isWorkLogAssignedToAccount(entry, accountName))
        : weekFilteredEntries,
    [accountName, currentUser?.business_role, selectedManagerFilters, showOnlyMine, weekFilteredEntries],
  );

  const filteredByTab = useMemo(
    () => activeTab === '全部项目'
      ? accountFilteredEntries
      : accountFilteredEntries.filter(entry => getWorkLogCategory(entry) === activeTab),
    [accountFilteredEntries, activeTab],
  );

  const filteredEntries = useMemo(() => {
    const query = debouncedQuery.trim().toLowerCase();
    const searched = !query ? filteredByTab : filteredByTab.filter(entry => [
      entry.productName,
      entry.clientType,
      entry.personA,
      entry.personB,
      entry.features,
      entry.nextWeekPlan,
    ].some(value => (value || '').toLowerCase().includes(query)));

    return [...searched].sort((left, right) => {
      const leftProduct = relatedProduct(left);
      const rightProduct = relatedProduct(right);
      const rankDiff = projectStatusRank(leftProduct?.status || left.status) - projectStatusRank(rightProduct?.status || right.status);
      if (rankDiff !== 0) return rankDiff;
      return (left.productName || '').localeCompare(right.productName || '', 'zh-CN');
    });
  }, [debouncedQuery, filteredByTab, productById, productByName]);

  const baseInfoGapMap = useMemo(() => {
    const map = new Map<string, string[]>();
    filteredEntries.forEach(entry => {
      const gaps = baseInfoGaps(entry);
      if (gaps.length > 0) map.set(entry.id, gaps);
    });
    return map;
  }, [filteredEntries, productById, productByName]);

  const detailEntry = useMemo(
    () => detailDraft || filteredEntries.find(entry => entry.id === detailEntryId) || entries.find(entry => entry.id === detailEntryId) || null,
    [detailDraft, detailEntryId, entries, filteredEntries],
  );

  useEffect(() => {
    if (!detailEntryId || detailDraft || effectiveDisplayMode !== 'cards') return;
    const handleCardNavigation = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, button, [contenteditable="true"], [role="textbox"], [role="listbox"], [role="dialog"]')) return;
      const currentIndex = filteredEntries.findIndex(entry => entry.id === detailEntryId);
      if (currentIndex < 0) return;
      const nextIndex = Math.max(0, Math.min(filteredEntries.length - 1, currentIndex + (event.key === 'ArrowDown' ? 1 : -1)));
      const nextEntry = filteredEntries[nextIndex];
      if (!nextEntry || nextEntry.id === detailEntryId) return;
      event.preventDefault();
      setDetailDraft(null);
      setDetailEntryId(nextEntry.id);
    };
    window.addEventListener('keydown', handleCardNavigation);
    return () => window.removeEventListener('keydown', handleCardNavigation);
  }, [detailDraft, detailEntryId, effectiveDisplayMode, filteredEntries]);
  const workLogEditingPresenceRef = useRef<{
    recordType: string;
    recordId: string | null;
    recordLabel: string;
    field: string;
    fieldLabel: string;
    location: string;
    startedAt: number;
  } | null>(null);
  const workLogEditingTimerRef = useRef<number | null>(null);

  const stopWorkLogEditing = () => {
    if (workLogEditingTimerRef.current) {
      window.clearInterval(workLogEditingTimerRef.current);
      workLogEditingTimerRef.current = null;
    }
    if (!workLogEditingPresenceRef.current) return;
    broadcastEditingStop(workLogEditingPresenceRef.current);
    workLogEditingPresenceRef.current = null;
  };

  const startWorkLogEditing = (field: string, fieldLabel: string) => {
    if (!detailEntry || detailDraft) return;
    if (
      workLogEditingPresenceRef.current?.recordId === detailEntry.id &&
      workLogEditingPresenceRef.current?.field === field
    ) {
      return;
    }
    stopWorkLogEditing();
    const payload = {
      recordType: 'worklog',
      recordId: detailEntry.id,
      recordLabel: detailEntry.productName || detailEntry.id,
      field,
      fieldLabel,
      location: '管理周报',
      startedAt: Date.now(),
    };
    workLogEditingPresenceRef.current = payload;
    broadcastEditingStart(payload);
    workLogEditingTimerRef.current = window.setInterval(() => {
      if (workLogEditingPresenceRef.current) broadcastEditingStart(workLogEditingPresenceRef.current);
    }, 15000);
  };

  useEffect(() => () => {
    stopWorkLogEditing();
  }, []);

  useEffect(() => {
    if (!detailEntry || detailDraft) {
      stopWorkLogEditing();
      return;
    }
    startWorkLogEditing('detail', '详情');
    return () => {
      stopWorkLogEditing();
    };
  }, [detailEntry?.id, detailDraft?.id]);

  const detailProgressKey = detailEntry ? (routeWeekKey || selectedWeekKey || detailEntry.weekKey || currentWeekKey) : currentWeekKey;
  const trustManagerOptions = useMemo(() => {
    const names = new Set<string>();
    trustManagers.forEach(manager => {
      if (manager.name?.trim()) names.add(manager.name.trim());
    });
    [detailEntry?.personA, detailEntry?.personB].forEach(name => {
      if (name?.trim()) names.add(name.trim());
    });
    return Array.from(names);
  }, [detailEntry?.personA, detailEntry?.personB, trustManagers]);
  const activePassiveOptions = useMemo(
    () => settings.fieldOptions.activePassive?.length ? settings.fieldOptions.activePassive : ['主动', '被动'],
    [settings.fieldOptions],
  );
  const collectiveSingleOptions = useMemo(
    () => settings.fieldOptions.collectiveSingle?.length ? settings.fieldOptions.collectiveSingle : ['集合', '单一'],
    [settings.fieldOptions],
  );
  const normalProjectCategoryOptions = useMemo(() => {
    const options = new Set<string>(NORMAL_PROJECT_CATEGORY_OPTIONS);
    if (detailEntry?.subCategory?.trim()) options.add(detailEntry.subCategory.trim());
    return Array.from(options);
  }, [detailEntry?.subCategory]);

  const updateDetailField = (field: keyof WorkLogEntry, value: string | number) => {
    if (!detailEntry) return;
    const linkedFields = field === 'subCategory' && typeof value === 'string'
      ? normalProjectCategoryLinkage(value)
      : null;
    const updates = {
      [field]: value,
      ...(linkedFields || {}),
    } as Partial<WorkLogEntry>;
    if (field === 'navScale' && typeof value === 'string') {
      const source = detailDraft || detailEntry;
      updates.navScaleHistory = {
        ...(source.navScaleHistory || {}),
        [detailProgressKey || source.weekKey || currentWeekKey]: value,
      };
    }
    if (field === 'nav' || field === 'yearStartNav') {
      const nextNav = field === 'nav' ? Number(value) : Number(detailEntry.nav);
      const nextYearStartNav = field === 'yearStartNav' ? Number(value) : Number(detailEntry.yearStartNav);
      const nextChangePercent = calculateChangePercent(nextNav, nextYearStartNav);
      if (nextChangePercent !== null) updates.changePercent = nextChangePercent;
    }
    if (detailDraft) {
      setDetailDraft({ ...detailDraft, ...updates, updatedAt: new Date().toISOString() });
      return;
    }
    if (String((detailEntry as any)[field] ?? '') !== String(value ?? '')) {
      setDetailHistory(current => [{
        id: `local-${Date.now()}-${String(field)}`,
        field: String(field),
        oldValue: String((detailEntry as any)[field] ?? ''),
        newValue: String(value ?? ''),
        editedBy: currentUser?.id || '',
        editedName: currentUser?.display_name || currentUser?.id || '当前用户',
        editedAt: new Date().toISOString(),
      }, ...current]);
    }
    updateEntry(detailEntry.id, updates);
  };

  const updateDetailProgress = (value: string) => {
    if (!detailEntry || !detailProgressKey) return;
    if (detailDraft) {
      setDetailDraft({
        ...detailDraft,
        weeklyProgress: { ...(detailDraft.weeklyProgress || {}), [detailProgressKey]: value },
        updatedAt: new Date().toISOString(),
      });
      return;
    }
    const previousProgress = detailEntry.weeklyProgress?.[detailProgressKey] || '';
    if (previousProgress !== value) {
      setDetailHistory(current => [{
        id: `local-${Date.now()}-weeklyProgress`, field: 'weeklyProgress', oldValue: previousProgress, newValue: value,
        editedBy: currentUser?.id || '', editedName: currentUser?.display_name || currentUser?.id || '当前用户', editedAt: new Date().toISOString(),
      }, ...current]);
    }
    updateEntry(detailEntry.id, {
      weeklyProgress: { ...(detailEntry.weeklyProgress || {}), [detailProgressKey]: value },
    });
  };

  const updateDynamicDetailField = (field: string, value: string) => {
    if (!detailEntry) return;
    const source = detailDraft || detailEntry;
    const dynamicFields = { ...(source.dynamicFields || {}), [field]: value };
    if (detailDraft) {
      setDetailDraft({ ...detailDraft, dynamicFields, updatedAt: new Date().toISOString() });
      return;
    }
    if (String(source.dynamicFields?.[field] ?? '') !== value) {
      setDetailHistory(current => [{
        id: `local-${Date.now()}-dynamicFields.${field}`, field: `dynamicFields.${field}`,
        oldValue: String(source.dynamicFields?.[field] ?? ''), newValue: value,
        editedBy: currentUser?.id || '', editedName: currentUser?.display_name || currentUser?.id || '当前用户', editedAt: new Date().toISOString(),
      }, ...current]);
    }
    updateEntry(detailEntry.id, { dynamicFields });
  };

  const selectedWeekLabel = selectedWeekKey ? getWeekLabel(selectedWeekKey) : '全部周次';

  const categoryCounts = useMemo(() => {
    return TABS.reduce((acc, tab) => {
      acc[tab.key] = tab.key === '全部项目'
        ? accountFilteredEntries.length
        : accountFilteredEntries.filter(entry => getWorkLogCategory(entry) === tab.key).length;
      return acc;
    }, {} as Record<TabKey, number>);
  }, [accountFilteredEntries]);

  const workLogShellViews = useMemo(() => TABS.map(tab => ({
    key: tab.key,
    label: tab.label,
    count: categoryCounts[tab.key] || 0,
    active: activeTab === tab.key,
    onClick: () => setActiveTab(tab.key),
  })), [activeTab, categoryCounts]);

  const handleAddBlank = () => {
    const entry = blankEntry();
    setDetailEntryId(null);
    setDetailDraft({ ...entry, category: activeTab === '全部项目' ? '正常项目' : activeTab, weekKey: selectedWeekKey || currentWeekKey });
  };

  const closeDetail = () => {
    stopWorkLogEditing();
    setDeleteConfirmOpen(false);
    setMobileWorkLogEditField(null);
    setDetailEntryId(null);
    setDetailDraft(null);
    if (routeEntryId || routeWeekKey) setSearchParams({});
  };

  const handleCompleteDetail = async () => {
    if (!detailEntry) return;
    if (detailDraft) {
      const hasRequired =
        detailDraft.productName.trim() &&
        detailDraft.subCategory.trim() &&
        (detailDraft.personA.trim() || detailDraft.personB.trim());

      if (!hasRequired) {
        _toast.warning?.('请先填写项目名称、种类、经理');
        return;
      }
      if (!/\d+/.test(detailDraft.productName)) {
        _toast.warning?.('产品名称中间必须填写数字编号');
        return;
      }

      const normalizedName = detailDraft.productName.trim().replace(/\s+/g, '').toLocaleLowerCase('zh-CN');
      const duplicate = entries.find(entry => (
        entry.id !== detailDraft.id
        && entry.productName.trim().replace(/\s+/g, '').toLocaleLowerCase('zh-CN') === normalizedName
      ));
      if (duplicate) {
        _toast.warning?.(`管理周报中已存在项目“${detailDraft.productName.trim()}”`);
        return;
      }

      await Promise.resolve(addEntry(detailDraft));
      _toast.success?.('新增周报记录成功');
    }
    closeDetail();
  };

  const handleDeleteDetail = async () => {
    if (!detailEntry || detailDraft) return;
    const deletedName = detailEntry.productName || '未命名周报';
    await Promise.resolve(deleteEntry(detailEntry.id));
    _toast.success?.(`已删除 ${deletedName}`);
    closeDetail();
  };

  const handleImport = useCallback(async (rows: Partial<WorkLogEntry>[], mode: ImportMode) => {
    const now = new Date().toISOString();
    const createImportedEntry = (row: Partial<WorkLogEntry>): WorkLogEntry => ({
      id: generateId(),
      createdAt: now,
      updatedAt: now,
      category: row.category || '正常项目',
      subCategory: row.subCategory || '',
      productName: row.productName || '',
      status: row.status || '',
      clientType: row.clientType || '',
      navScale: row.navScale || '',
      description: row.description || '',
      establishDate: row.establishDate || '',
      deadline: row.deadline || '',
      productTerm: row.productTerm || '',
      personA: row.personA || '',
      personB: row.personB || '',
      activePassive: row.activePassive || '',
      collectiveSingle: row.collectiveSingle || '',
      advisorManager: row.advisorManager || '',
      channelSales: row.channelSales || '',
      features: row.features || '',
      managementReport: row.managementReport || '',
      riskReport: row.riskReport || '',
      salesReport: row.salesReport || '',
      nextWeekPlan: row.nextWeekPlan || '',
      nav: row.nav ?? 0,
      yearStartNav: row.yearStartNav ?? 0,
      changePercent: row.changePercent ?? 0,
      weeklyProgress: row.weeklyProgress || {},
      navScaleHistory: row.navScaleHistory || {},
      weekKey: row.weekKey || currentWeekKey,
      dynamicFields: row.dynamicFields || {},
    });
    const newEntries = rows.map(createImportedEntry);

    try {
      if (mode === 'overwrite') {
        await replaceEntries(newEntries);
      } else {
        const merged = mergeImportRows(
          entries,
          rows,
          workLogImportIdentity,
          createImportedEntry,
          now,
        );
        const cleanRecords = merged.changes.map(record => {
          const { created_by: _createdBy, ...cleanRecord } = record as WorkLogEntry & { created_by?: string };
          return cleanRecord;
        });
        await mergeEntries(cleanRecords);
        _toast.success?.(`合并完成：更新 ${merged.updated} 条，新增 ${merged.added} 条，未变化 ${merged.unchanged} 条`);
      }
      setShowImportModal(false);
      setImportInitialFile(null);
      if (mode === 'overwrite') {
        _toast.success?.(`已清除原有管理周报并导入 ${newEntries.length} 条记录`);
      }
      await fetchEntries();
    } catch {
      _toast.error?.(mode === 'overwrite' ? '导入失败，原有管理周报数据未被替换' : '合并失败，原有管理周报保持不变');
    }
  }, [currentWeekKey, entries, fetchEntries, mergeEntries, replaceEntries]);

  const handleExport = async () => {
    await exportManagementWorkLog({
      entries: weekFilteredEntries,
      scopeLabel: '全部项目',
    });
  };

  const detailHeaderColor = detailEntry ? workLogCategoryColor(detailEntry) : undefined;
  const detailGridColumns: 1 | 2 = detailDraft ? 2 : 1;
  const renderReportFields = () => !detailEntry ? null : (
    <DetailSection title="管理信息">
      <DetailGrid columns={detailDraft ? 3 : 1}>
        <InlineDetailSelect fieldKey="personA" focused={routeWorkLogField === 'personA'} label="A角" value={detailEntry.personA || ''} options={trustManagerOptions} onChange={value => updateDetailField('personA', value)} />
        <InlineDetailSelect fieldKey="personB" focused={routeWorkLogField === 'personB'} label="B角" value={detailEntry.personB || ''} options={trustManagerOptions} onChange={value => updateDetailField('personB', value)} />
        <InlineDetailSelect label="主动 / 被动" value={detailEntry.activePassive || ''} options={activePassiveOptions} onChange={value => updateDetailField('activePassive', value)} />
        <InlineDetailSelect label="集合 / 单一" value={detailEntry.collectiveSingle || ''} options={collectiveSingleOptions} onChange={value => updateDetailField('collectiveSingle', value)} />
        <EditableDetailField label="投资顾问 / 管理人" value={detailEntry.advisorManager || ''} onChange={value => updateDetailField('advisorManager', value)} />
        <YearDetailField label="产品期限" value={detailEntry.productTerm || ''} onChange={value => updateDetailField('productTerm', value)} />
        <EditableDetailField label="特色" value={detailEntry.features || ''} onChange={value => updateDetailField('features', value)} multiline />
        <InlineDetailSelect label="管理报告" value={detailEntry.managementReport || ''} options={MANAGEMENT_REPORT_OPTIONS} onChange={value => updateDetailField('managementReport', value)} />
        <InlineDetailSelect label="风控报告" value={detailEntry.riskReport || ''} options={RISK_REPORT_OPTIONS} onChange={value => updateDetailField('riskReport', value)} />
        <InlineDetailSelect label="销售端报告" value={detailEntry.salesReport || ''} options={SALES_REPORT_OPTIONS} onChange={value => updateDetailField('salesReport', value)} />
      </DetailGrid>
    </DetailSection>
  );

  const renderNormalDetail = () => {
    if (!detailEntry) return null;
    const basicSection = (
      <DetailSection title="项目基础信息">
        <DetailGrid columns={detailGridColumns}>
          <InlineDetailSelect label="项目分类" value={detailEntry.subCategory || ''} options={normalProjectCategoryOptions} onChange={value => updateDetailField('subCategory', value)} />
          <InlineDetailSelect fieldKey="status" focused={routeWorkLogField === 'status'} label="状态" value={detailEntry.status || ''} options={workLogStatusOptions} onChange={value => updateDetailField('status', value)} />
          <WorkLogProductNameField span={detailDraft ? 2 : 1} focused={routeWorkLogField === 'productName'} label="产品名" value={detailEntry.productName || ''} onChange={value => updateDetailField('productName', value)} />
          <EditableDetailField fieldKey="clientType" focused={routeWorkLogField === 'clientType'} label="客户名称 / 类型" value={detailEntry.clientType || ''} onChange={value => updateDetailField('clientType', value)} />
          <EditableDetailField fieldKey="navScale" focused={routeWorkLogField === 'navScale'} label="净值 / 规模情况" value={detailEntry.navScale || ''} onChange={value => updateDetailField('navScale', value)} multiline />
          <EditableDetailField label="成立日 / 拟成立日" value={detailEntry.establishDate || ''} onChange={value => updateDetailField('establishDate', value)} type="date" />
          <EditableDetailField label="渠道销售" value={detailEntry.channelSales || ''} onChange={value => updateDetailField('channelSales', value)} />
        </DetailGrid>
      </DetailSection>
    );
    const weeklySection = (
      <DetailSection title="周报内容">
        <DetailGrid columns={detailGridColumns}>
          <EditableDetailField fieldKey="weeklyProgress" focused={routeWorkLogField === 'weeklyProgress'} label="上周进展" value={workLogProgress(detailEntry, selectedWeekKey || currentWeekKey)} onChange={updateDetailProgress} multiline />
          <EditableDetailField fieldKey="nextWeekPlan" focused={routeWorkLogField === 'nextWeekPlan'} label="下周工作计划" value={detailEntry.nextWeekPlan || ''} onChange={value => updateDetailField('nextWeekPlan', value)} multiline />
        </DetailGrid>
      </DetailSection>
    );
    const navSection = (
      <DetailSection title="净值辅助">
        <DetailGrid columns={detailGridColumns}>
          <EditableDetailField label="日期" value={detailEntry.establishDate || ''} onChange={value => updateDetailField('establishDate', value)} type="date" />
          <EditableDetailField label="净值" value={detailEntry.nav ?? ''} onChange={value => updateDetailField('nav', Number(value) || 0)} type="number" />
          <EditableDetailField label="年初净值" value={detailEntry.yearStartNav ?? ''} onChange={value => updateDetailField('yearStartNav', Number(value) || 0)} type="number" />
          <ReadOnlyDetailField label="涨跌幅（自动）" value={detailEntry.changePercent ?? ''} />
        </DetailGrid>
      </DetailSection>
    );

    if (detailDraft) {
      return (
        <div className="worklog-normal-create-layout">
          <div className="worklog-create-column">
            {basicSection}
          </div>
          <div className="worklog-create-column">
            {weeklySection}
            {navSection}
          </div>
          {renderReportFields()}
        </div>
      );
    }

    return <>{basicSection}{weeklySection}{renderReportFields()}{navSection}</>;
  };

  const renderProblemDetail = () => !detailEntry ? null : (
    <>
      <DetailSection title="问题项目基础信息">
        <DetailGrid columns={detailGridColumns}>
          <WorkLogProductNameField span={detailDraft ? 2 : 1} focused={routeWorkLogField === 'productName'} label="项目名称" value={detailEntry.productName || ''} onChange={value => updateDetailField('productName', value)} />
          <InlineDetailSelect fieldKey="status" focused={routeWorkLogField === 'status'} label="状态" value={detailEntry.status || ''} options={workLogStatusOptions} onChange={value => updateDetailField('status', value)} />
          <EditableDetailField label="项目情况" value={detailEntry.description || ''} onChange={value => updateDetailField('description', value)} multiline />
          <EditableDetailField fieldKey="clientType" focused={routeWorkLogField === 'clientType'} label="客户名称" value={detailEntry.clientType || ''} onChange={value => updateDetailField('clientType', value)} />
          <EditableDetailField fieldKey="navScale" focused={routeWorkLogField === 'navScale'} label="项目规模" value={detailEntry.navScale || ''} onChange={value => updateDetailField('navScale', value)} />
        </DetailGrid>
      </DetailSection>

      <DetailSection title="处置进展">
        <DetailGrid columns={detailGridColumns}>
          <EditableDetailField fieldKey="weeklyProgress" focused={routeWorkLogField === 'weeklyProgress'} label="上周进展" value={workLogProgress(detailEntry, selectedWeekKey || currentWeekKey)} onChange={updateDetailProgress} multiline />
          <EditableDetailField fieldKey="deadline" focused={routeWorkLogField === 'deadline'} label="预计最晚化解时间" value={detailEntry.deadline || ''} onChange={value => updateDetailField('deadline', value)} type="date" />
          <EditableDetailField fieldKey="nextWeekPlan" focused={routeWorkLogField === 'nextWeekPlan'} label="后续举措" value={detailEntry.nextWeekPlan || ''} onChange={value => updateDetailField('nextWeekPlan', value)} multiline />
          <EditableDetailField label="进展是否达预期" value={detailEntry.dynamicFields?.progressExpectation || ''} onChange={value => updateDynamicDetailField('progressExpectation', value)} />
        </DetailGrid>
      </DetailSection>

      {renderReportFields()}
    </>
  );

  const renderDirectSalesDetail = () => {
    if (!detailEntry) return null;
    const series = normalizeDirectSalesSeries(detailEntry.subCategory || detailEntry.productName || '');
    const showFixedIncome = series === '固收系列';
    const showOption = series === '含权系列';
    const showEquity = series === '权益系列';

    return (
      <>
        <DetailSection title="类别">
          <DetailGrid columns={detailGridColumns}>
            <InlineDetailSelect
              label="直销产品类别"
              value={series}
              options={DIRECT_SALES_SERIES_OPTIONS}
              onChange={value => updateDetailField('subCategory', value)}
            />
          </DetailGrid>
        </DetailSection>

        <DetailSection title="产品现状">
          <DetailGrid columns={detailGridColumns}>
            <WorkLogProductNameField span={detailDraft ? 2 : 1} focused={routeWorkLogField === 'productName'} label="产品名称" value={detailEntry.productName || ''} onChange={value => updateDetailField('productName', value)} />
            <InlineDetailSelect fieldKey="status" focused={routeWorkLogField === 'status'} label="状态" value={detailEntry.status || ''} options={workLogStatusOptions} onChange={value => updateDetailField('status', value)} />
            <EditableDetailField fieldKey="clientType" focused={routeWorkLogField === 'clientType'} label="客户名称 / 类型" value={detailEntry.clientType || ''} onChange={value => updateDetailField('clientType', value)} />
            <EditableDetailField fieldKey="navScale" focused={routeWorkLogField === 'navScale'} label="规模（万）" value={detailEntry.navScale || ''} onChange={value => updateDetailField('navScale', value)} />
            <EditableDetailField label="目标规模（万）" value={detailEntry.productTerm || ''} onChange={value => updateDetailField('productTerm', value)} />
            <EditableDetailField label="净值" value={detailEntry.nav ?? ''} onChange={value => updateDetailField('nav', Number(value) || 0)} type="number" />
            <EditableDetailField label="较上周" value={detailEntry.changePercent ?? ''} onChange={value => updateDetailField('changePercent', Number(value) || 0)} type="number" />
            {showFixedIncome && (
              <EditableDetailField label="持仓超过10%的个券明细" value={detailEntry.dynamicFields?.holdingsOver10 || ''} onChange={value => updateDynamicDetailField('holdingsOver10', value)} multiline />
            )}
            {showOption && (
              <EditableDetailField label="权益资产占比" value={detailEntry.dynamicFields?.equityAssetRatio || ''} onChange={value => updateDynamicDetailField('equityAssetRatio', value)} />
            )}
            {(showOption || showEquity) && (
              <EditableDetailField label="是否触及预警、平仓线" value={detailEntry.dynamicFields?.warningLineStatus || ''} onChange={value => updateDynamicDetailField('warningLineStatus', value)} />
            )}
            {showEquity && (
              <EditableDetailField label="关注点" value={detailEntry.dynamicFields?.focusPoint || ''} onChange={value => updateDynamicDetailField('focusPoint', value)} multiline />
            )}
          </DetailGrid>
        </DetailSection>

        <DetailSection title="产品运作">
          <DetailGrid columns={detailGridColumns}>
            <EditableDetailField fieldKey="weeklyProgress" focused={routeWorkLogField === 'weeklyProgress'} label="一周回顾" value={detailEntry.dynamicFields?.weeklyReview || workLogProgress(detailEntry, selectedWeekKey || currentWeekKey)} onChange={value => updateDynamicDetailField('weeklyReview', value)} multiline />
            <EditableDetailField fieldKey="nextWeekPlan" focused={routeWorkLogField === 'nextWeekPlan'} label="后续计划" value={detailEntry.nextWeekPlan || ''} onChange={value => updateDetailField('nextWeekPlan', value)} multiline />
          </DetailGrid>
        </DetailSection>

        <DetailSection title="产品销售">
          <DetailGrid columns={detailGridColumns}>
            <EditableDetailField label="销售渠道" value={detailEntry.channelSales || ''} onChange={value => updateDetailField('channelSales', value)} />
            <EditableDetailField label="渠道对接人" value={detailEntry.dynamicFields?.channelContact || ''} onChange={value => updateDynamicDetailField('channelContact', value)} />
            <EditableDetailField label="当周申赎情况" value={detailEntry.dynamicFields?.subscriptionRedemption || ''} onChange={value => updateDynamicDetailField('subscriptionRedemption', value)} multiline />
            <EditableDetailField label="下一步工作计划" value={detailEntry.dynamicFields?.nextSalesPlan || detailEntry.nextWeekPlan || ''} onChange={value => updateDynamicDetailField('nextSalesPlan', value)} multiline />
          </DetailGrid>
        </DetailSection>
      </>
    );
  };

  const renderDetailContent = () => {
    if (!detailEntry) return null;
    const category = getWorkLogCategory(detailEntry);
    const categoryContent = category === '问题项目'
      ? renderProblemDetail()
      : category === '直销产品情况'
        ? renderDirectSalesDetail()
        : renderNormalDetail();
    return (
      <>
        {categoryContent}
        <DetailSection title="辅助信息" description="项目代码用于 AI 稳定识别项目，由用户手动维护。">
          <DetailGrid columns={1}>
            <EditableDetailField
              fieldKey="dynamicFields.projectCode"
              label="项目代码"
              value={detailEntry.dynamicFields?.projectCode || ''}
              onChange={value => updateDynamicDetailField('projectCode', value)}
            />
          </DetailGrid>
        </DetailSection>
      </>
    );
  };

  const detailPanel = detailEntry && !detailDraft ? (
    <DetailModal
      mode="panel"
      open
      title={detailEntry.productName || '未命名项目'}
      subtitle={`${detailEntry.category || '未分类'} · ${selectedWeekLabel}`}
      headerColor={detailHeaderColor}
      onClose={closeDetail}
    >
      <WorkLogLastEditContext.Provider value={lastEditByField}>
        <div className="space-y-4">
          {renderDetailContent()}
          {!detailDraft && (
            <button
              type="button"
              onClick={() => setDeleteConfirmOpen(true)}
              className="flex h-11 w-full items-center justify-center gap-2 bg-danger-600 px-4 text-sm font-medium text-white hover:bg-danger-700"
            >
              <Trash2 size={16} />
              删除该条目
            </button>
          )}
        </div>
      </WorkLogLastEditContext.Provider>
    </DetailModal>
  ) : null;

  if (isMobileViewport) {
    const selectedMobileWeekKey = selectedWeekKey || currentWeekKey;
    const mobileWeekIndex = Math.max(0, weekOptions.findIndex(option => option.key === selectedMobileWeekKey));
    const previousMobileWeek = weekOptions[mobileWeekIndex + 1];
    const nextMobileWeek = weekOptions[mobileWeekIndex - 1];
    const mobileTabs = TABS.slice(1);

    if (detailEntry) {
      const mobileProgress = workLogProgress(detailEntry, selectedMobileWeekKey);
      const mobileHelpNeeded = detailEntry.dynamicFields?.helpNeeded || '';
      if (!detailDraft) {
        type MobileWorkLogRecordField = MobileDetailEditorField & {
          source?: 'field' | 'progress' | 'dynamic';
          readOnly?: boolean;
        };
        const currentOption = (options: string[], value?: string) => Array.from(new Set([value || '', ...options].filter(Boolean)));
        const category = getWorkLogCategory(detailEntry);
        const commonManagementFields: MobileWorkLogRecordField[] = [
          { key: 'personA', label: 'A角', value: detailEntry.personA || '', type: 'select', options: currentOption(trustManagerOptions, detailEntry.personA) },
          { key: 'personB', label: 'B角', value: detailEntry.personB || '', type: 'select', options: currentOption(trustManagerOptions, detailEntry.personB) },
          { key: 'activePassive', label: '主动 / 被动', value: detailEntry.activePassive || '', type: 'select', options: currentOption(activePassiveOptions, detailEntry.activePassive) },
          { key: 'collectiveSingle', label: '集合 / 单一', value: detailEntry.collectiveSingle || '', type: 'select', options: currentOption(collectiveSingleOptions, detailEntry.collectiveSingle) },
          { key: 'advisorManager', label: '投资顾问 / 管理人', value: detailEntry.advisorManager || '', type: 'text' },
          { key: 'productTerm', label: '产品期限', value: detailEntry.productTerm || '', type: 'text' },
          { key: 'features', label: '特色', value: detailEntry.features || '', type: 'textarea' },
          { key: 'managementReport', label: '管理报告', value: detailEntry.managementReport || '', type: 'select', options: currentOption(MANAGEMENT_REPORT_OPTIONS, detailEntry.managementReport) },
          { key: 'riskReport', label: '风控报告', value: detailEntry.riskReport || '', type: 'select', options: currentOption(RISK_REPORT_OPTIONS, detailEntry.riskReport) },
          { key: 'salesReport', label: '销售端报告', value: detailEntry.salesReport || '', type: 'select', options: currentOption(SALES_REPORT_OPTIONS, detailEntry.salesReport) },
        ];
        const workLogRecordSections: Array<{ title: string; fields: MobileWorkLogRecordField[] }> = [];
        if (category === '问题项目') {
          workLogRecordSections.push(
            { title: '问题项目基础信息', fields: [
              { key: 'category', label: '周报类型', value: category, type: 'select', options: ['正常项目', '问题项目', '直销产品情况'] },
              { key: 'productName', label: '项目名称', value: detailEntry.productName || '', type: 'text' },
              { key: 'status', label: '状态', value: detailEntry.status || '', type: 'select', options: currentOption(workLogStatusOptions, detailEntry.status) },
              { key: 'description', label: '项目情况', value: detailEntry.description || '', type: 'textarea' },
              { key: 'clientType', label: '客户名称', value: detailEntry.clientType || '', type: 'text' },
              { key: 'navScale', label: '项目规模', value: detailEntry.navScale || '', type: 'text' },
            ]},
            { title: '处置进展', fields: [
              { key: 'weeklyProgress', label: '上周进展', value: mobileProgress, type: 'textarea', source: 'progress' },
              { key: 'deadline', label: '预计最晚化解时间', value: detailEntry.deadline || '', type: 'date' },
              { key: 'nextWeekPlan', label: '后续举措', value: detailEntry.nextWeekPlan || '', type: 'textarea' },
              { key: 'progressExpectation', label: '进展是否达预期', value: detailEntry.dynamicFields?.progressExpectation || '', type: 'select', options: currentOption(['符合预期', '低于预期', '超出预期'], detailEntry.dynamicFields?.progressExpectation), source: 'dynamic' },
            ]},
            { title: '管理信息', fields: commonManagementFields },
          );
        } else if (category === '直销产品情况') {
          const series = normalizeDirectSalesSeries(detailEntry.subCategory || detailEntry.productName || '');
          const directFields: MobileWorkLogRecordField[] = [
            { key: 'category', label: '周报类型', value: category, type: 'select', options: ['正常项目', '问题项目', '直销产品情况'] },
            { key: 'subCategory', label: '直销产品类别', value: series, type: 'select', options: currentOption(DIRECT_SALES_SERIES_OPTIONS, series) },
            { key: 'productName', label: '产品名称', value: detailEntry.productName || '', type: 'text' },
            { key: 'status', label: '状态', value: detailEntry.status || '', type: 'select', options: currentOption(workLogStatusOptions, detailEntry.status) },
            { key: 'clientType', label: '客户名称 / 类型', value: detailEntry.clientType || '', type: 'text' },
            { key: 'navScale', label: '规模', value: detailEntry.navScale || '', type: 'text' },
            { key: 'productTerm', label: '目标规模', value: detailEntry.productTerm || '', type: 'text' },
            { key: 'nav', label: '净值', value: detailEntry.nav ?? '', type: 'number' },
            { key: 'changePercent', label: '较上周', value: detailEntry.changePercent ?? '', type: 'number', unit: '%' },
          ];
          if (series === '固收系列') directFields.push({ key: 'holdingsOver10', label: '持仓超过10%的个券明细', value: detailEntry.dynamicFields?.holdingsOver10 || '', type: 'textarea', source: 'dynamic' });
          if (series === '含权系列') directFields.push({ key: 'equityAssetRatio', label: '权益资产占比', value: detailEntry.dynamicFields?.equityAssetRatio || '', type: 'text', source: 'dynamic' });
          if (series === '含权系列' || series === '权益系列') directFields.push({ key: 'warningLineStatus', label: '是否触及预警、平仓线', value: detailEntry.dynamicFields?.warningLineStatus || '', type: 'select', options: currentOption(['未触及', '触及预警线', '触及平仓线'], detailEntry.dynamicFields?.warningLineStatus), source: 'dynamic' });
          if (series === '权益系列') directFields.push({ key: 'focusPoint', label: '关注点', value: detailEntry.dynamicFields?.focusPoint || '', type: 'textarea', source: 'dynamic' });
          workLogRecordSections.push(
            { title: '产品现状', fields: directFields },
            { title: '产品运作', fields: [
              { key: 'weeklyReview', label: '一周回顾', value: detailEntry.dynamicFields?.weeklyReview || mobileProgress, type: 'textarea', source: 'dynamic' },
              { key: 'nextWeekPlan', label: '后续计划', value: detailEntry.nextWeekPlan || '', type: 'textarea' },
            ]},
            { title: '产品销售', fields: [
              { key: 'channelSales', label: '销售渠道', value: detailEntry.channelSales || '', type: 'text' },
              { key: 'channelContact', label: '渠道对接人', value: detailEntry.dynamicFields?.channelContact || '', type: 'text', source: 'dynamic' },
              { key: 'subscriptionRedemption', label: '当周申赎情况', value: detailEntry.dynamicFields?.subscriptionRedemption || '', type: 'textarea', source: 'dynamic' },
              { key: 'nextSalesPlan', label: '下一步工作计划', value: detailEntry.dynamicFields?.nextSalesPlan || detailEntry.nextWeekPlan || '', type: 'textarea', source: 'dynamic' },
            ]},
          );
        } else {
          workLogRecordSections.push(
            { title: '项目基础信息', fields: [
              { key: 'category', label: '周报类型', value: category, type: 'select', options: ['正常项目', '问题项目', '直销产品情况'] },
              { key: 'subCategory', label: '项目分类', value: detailEntry.subCategory || '', type: 'select', options: currentOption(normalProjectCategoryOptions, detailEntry.subCategory) },
              { key: 'status', label: '状态', value: detailEntry.status || '', type: 'select', options: currentOption(workLogStatusOptions, detailEntry.status) },
              { key: 'productName', label: '产品名', value: detailEntry.productName || '', type: 'text' },
              { key: 'clientType', label: '客户名称 / 类型', value: detailEntry.clientType || '', type: 'text' },
              { key: 'navScale', label: '净值 / 规模情况', value: detailEntry.navScale || '', type: 'textarea' },
              { key: 'establishDate', label: '成立日 / 拟成立日', value: detailEntry.establishDate || '', type: 'date' },
              { key: 'channelSales', label: '渠道销售', value: detailEntry.channelSales || '', type: 'text' },
            ]},
            { title: '周报内容', fields: [
              { key: 'weeklyProgress', label: '上周进展', value: mobileProgress, type: 'textarea', source: 'progress' },
              { key: 'nextWeekPlan', label: '下周工作计划', value: detailEntry.nextWeekPlan || '', type: 'textarea' },
              { key: 'helpNeeded', label: '需要协助', value: mobileHelpNeeded, type: 'textarea', source: 'dynamic' },
            ]},
            { title: '管理信息', fields: commonManagementFields },
            { title: '净值辅助', fields: [
              { key: 'nav', label: '净值', value: detailEntry.nav ?? '', type: 'number' },
              { key: 'yearStartNav', label: '年初净值', value: detailEntry.yearStartNav ?? '', type: 'number' },
              { key: 'changePercent', label: '涨跌幅', value: detailEntry.changePercent ?? '', type: 'number', unit: '%', readOnly: true },
            ]},
          );
        }
        const knownDynamicKeys = new Set(workLogRecordSections.flatMap(section => section.fields.filter(field => field.source === 'dynamic').map(field => field.key)));
        const auxiliaryFields: MobileWorkLogRecordField[] = [
          { key: 'projectCode', label: '项目代码', value: detailEntry.dynamicFields?.projectCode || '', type: 'text', source: 'dynamic' },
          { key: 'weekKey', label: '数据周次', value: detailProgressKey || '', type: 'text', readOnly: true },
        ];
        knownDynamicKeys.add('projectCode');
        Object.entries(detailEntry.dynamicFields || {}).forEach(([key, value]) => {
          if (!knownDynamicKeys.has(key)) auxiliaryFields.push({ key, label: key, value: String(value ?? ''), type: typeof value === 'number' ? 'number' : 'text', source: 'dynamic' });
        });
        if (detailEntry.reviewStatus) auxiliaryFields.push({ key: 'reviewStatus', label: '审核状态', value: detailEntry.reviewStatus, type: 'select', options: ['draft', 'submitted', 'returned', 'approved'] });
        if (detailEntry.reviewComment) auxiliaryFields.push({ key: 'reviewComment', label: '审核意见', value: detailEntry.reviewComment, type: 'textarea', readOnly: true });
        workLogRecordSections.push({ title: '辅助信息', fields: auxiliaryFields });

        const saveMobileWorkLogField = (value: string) => {
          const field = mobileWorkLogEditField as MobileWorkLogRecordField | null;
          if (!field) return;
          if (field.source === 'progress') updateDetailProgress(value);
          else if (field.source === 'dynamic') updateDynamicDetailField(field.key, value);
          else updateDetailField(field.key as keyof WorkLogEntry, field.type === 'number' ? Number(value) || 0 : value);
        };

        return (
          <div className="mobile-worklog-detail square-ui">
            <header className="mobile-worklog-appbar">
              <button type="button" onClick={closeDetail} aria-label="返回周报列表"><ChevronLeft size={23} /></button>
              <h1>周报详情</h1>
              <span />
            </header>
            <section className="mobile-record-intro">
              <span>{getWeekLabel(detailProgressKey)}</span>
              <h2>{detailEntry.productName || '未命名项目'}</h2>
              <div><em>{category}</em><em>{detailEntry.status || '未填写状态'}</em></div>
            </section>
            <div className="mobile-record-summary">完整周报档案 · 字段会按周报类型展示，点击可编辑字段从底部修改。</div>
            {workLogRecordSections.map(section => (
              <MobileDetailSection key={section.title} title={section.title} hint={section.title === '周报内容' || section.title === '处置进展' || section.title === '产品运作' ? getWeekLabel(detailProgressKey) : undefined}>
                {section.fields.map(field => (
                  <MobileDetailFieldRow
                    key={`${section.title}-${field.key}`}
                    label={field.label}
                    value={field.value}
                    unit={field.unit}
                    readOnly={field.readOnly}
                    onClick={field.readOnly ? undefined : () => setMobileWorkLogEditField(field)}
                  />
                ))}
              </MobileDetailSection>
            ))}
            <MobileDetailEditorSheet field={mobileWorkLogEditField} onClose={() => setMobileWorkLogEditField(null)} onSave={saveMobileWorkLogField} />
            <DeleteConfirmDialog
              open={deleteConfirmOpen}
              title="删除管理周报条目"
              targetName={detailEntry.productName || '未命名周报'}
              onCancel={() => setDeleteConfirmOpen(false)}
              onConfirm={handleDeleteDetail}
            />
          </div>
        );
      }
      return (
        <div className="mobile-worklog-edit square-ui">
          <header className="mobile-worklog-appbar">
            <button type="button" onClick={closeDetail} aria-label="返回周报列表"><ChevronLeft size={23} /></button>
            <h1>{detailDraft ? '新增周报' : '编辑周报'}</h1>
            <span />
          </header>
          <div className="mobile-worklog-week is-editing">
            <span>周次</span>
            <strong>{workWeekLabel}</strong>
            <span className="mobile-worklog-save-state"><i />{detailDraft ? '填写中' : '已自动保存'}</span>
          </div>
          <section className="mobile-worklog-project-block">
            <h2>项目</h2>
            {detailDraft ? (
              <div className="mobile-worklog-project-fields">
                <label><span>项目名称</span><input value={detailEntry.productName || ''} onChange={event => updateDetailField('productName', event.target.value)} placeholder="请输入带编号的项目名称" /></label>
                <label><span>项目分类</span><select value={detailEntry.subCategory || ''} onChange={event => updateDetailField('subCategory', event.target.value)}><option value="">请选择项目分类</option>{normalProjectCategoryOptions.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
                <label><span>项目状态</span><select value={detailEntry.status || ''} onChange={event => updateDetailField('status', event.target.value)}><option value="">请选择项目状态</option>{workLogStatusOptions.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
                <label><span>A角经理</span><select value={detailEntry.personA || ''} onChange={event => updateDetailField('personA', event.target.value)}><option value="">请选择A角经理</option>{trustManagerOptions.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
              </div>
            ) : <>
              <strong className="mobile-worklog-project-name">{detailEntry.productName || '未命名项目'}</strong>
              <div className="mobile-worklog-project-tags"><em>{getWorkLogCategory(detailEntry)}</em><em>{detailEntry.status || '未填写'}</em></div>
            </>}
          </section>
          <section className="mobile-worklog-form-section">
            <h2>本周进展</h2>
            <textarea value={mobileProgress} onChange={event => updateDetailProgress(event.target.value)} placeholder="填写本周项目进展" />
            <p>内容将同步到本周工作小结</p>
          </section>
          <section className="mobile-worklog-form-section">
            <h2>下周工作计划</h2>
            <textarea value={detailEntry.nextWeekPlan || ''} onChange={event => updateDetailField('nextWeekPlan', event.target.value)} placeholder="填写下周工作计划" />
          </section>
          <section className="mobile-worklog-form-section">
            <h2>需要协助</h2>
            <textarea value={mobileHelpNeeded} onChange={event => updateDynamicDetailField('helpNeeded', event.target.value)} placeholder="填写需要部门协助解决的问题" />
          </section>
          <div className="mobile-worklog-form-actions">
            <button type="button" className="is-secondary" onClick={() => detailDraft ? closeDetail() : setDeleteConfirmOpen(true)}>{detailDraft ? '取消' : '删除'}</button>
            <button type="button" className="is-primary" onClick={() => void handleCompleteDetail()}>{detailDraft ? '创建周报' : '完成'}</button>
          </div>
          <DeleteConfirmDialog
            open={deleteConfirmOpen}
            title="删除管理周报条目"
            targetName={detailEntry.productName || '未命名周报'}
            onCancel={() => setDeleteConfirmOpen(false)}
            onConfirm={handleDeleteDetail}
          />
        </div>
      );
    }

    return (
      <div className="mobile-worklog-list square-ui">
        <header className="mobile-worklog-appbar"><span /><h1>管理周报</h1><button type="button" onClick={handleAddBlank} aria-label="新增周报"><Plus size={22} /></button></header>
        <div className="mobile-worklog-week">
          <button type="button" disabled={!previousMobileWeek} onClick={() => previousMobileWeek && setSelectedWeekKey(previousMobileWeek.key)}>‹ 上一周</button>
          <strong>{workWeekLabel}</strong>
          <button type="button" disabled={!nextMobileWeek} onClick={() => nextMobileWeek && setSelectedWeekKey(nextMobileWeek.key)}>下一周 ›</button>
        </div>
        <div className="mobile-worklog-chips">
          {mobileTabs.map(tab => <button key={tab.key} type="button" onClick={() => setActiveTab(tab.key)} className={activeTab === tab.key ? 'is-active' : ''}>{tab.key === TABS[3].key ? '服务类' : tab.label} {categoryCounts[tab.key] || 0}</button>)}
        </div>
        <div className="mobile-worklog-toolbar"><label><Search size={18} /><input value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder="搜索项目或进展内容" /></label><button type="button" aria-label="筛选周报"><Filter size={19} /></button></div>
        <main className="mobile-worklog-card-list">
          {isLoading && entries.length === 0 ? <div className="mobile-worklog-empty">周报加载中…</div> : filteredEntries.length === 0 ? <div className="mobile-worklog-empty">本周暂无周报</div> : filteredEntries.map(entry => {
            const summary = workLogProgress(entry, selectedMobileWeekKey) || entry.description || entry.nextWeekPlan || '本周暂未填写进展。';
            return <article key={entry.id} data-mobile-worklog-id={entry.id} className="mobile-worklog-card" onClick={() => { setDetailDraft(null); setDetailEntryId(entry.id); }}>
              <h2>{entry.productName || '未命名项目'}</h2>
              <div><em>{entry.status || '未填写'}</em><span>{entry.personA || entry.personB || '未分配'}</span><span>·</span><span>{workLogProgress(entry, selectedMobileWeekKey) ? '本周已更新' : '待更新'}</span></div>
              <p>{summary}</p>
            </article>;
          })}
        </main>
        <button type="button" onClick={handleAddBlank} className="mobile-worklog-fab" aria-label="新增周报"><Plus size={24} /></button>
      </div>
    );
  }

  return (
    <div className="mobile-card-page square-ui -m-4 flex min-h-[calc(100%+2rem)] w-screen flex-col gap-0 sm:-m-5 sm:min-h-[calc(100%+2.5rem)] lg:m-0 lg:h-full lg:min-h-full lg:w-full lg:gap-5">
      <Header className="mobile-shared-page-header" title="管理周报" info={<FeatureInfo label="管理周报功能说明">按周维护记录，点击卡片可编辑完整内容。</FeatureInfo>} subtitle="按周记录项目进展、待办问题与直销产品情况。">
        <button
          type="button"
          onClick={handleAddBlank}
          className="hidden h-10 items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-medium text-white hover:bg-slate-800 lg:inline-flex"
        >
          <Plus size={16} />
          新增
        </button>
      </Header>

      <button type="button" onClick={handleAddBlank} className="mobile-card-page__fab fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-40 flex h-12 w-12 items-center justify-center bg-primary-600 text-white shadow-[0_10px_24px_rgba(37,87,214,.28)] lg:hidden" aria-label="新增周报记录">
        <Plus size={24} />
      </button>

      <ListCardShell
        id="worklog-content-scope"
        views={workLogShellViews}
        metrics={[]}
        hideViews
        stickyWorkspace
        mergeToolbarWithContent
        contentClassName="px-4 pb-4 pt-0"
        toolbar={(
          <div className="space-y-3">
            <TableToolbar
              className="mobile-card-toolbar"
              hideSearch
              leadingContent={effectiveDisplayMode === 'table' ? (
                <div className="flex h-10 min-w-0 flex-1 items-center">
                  <AppSelect
                    value={activeTab}
                    options={TABS.filter(tab => tab.key !== '直销产品情况').map(tab => ({
                      value: tab.key,
                      label: (
                        <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
                          <span className="truncate">{tab.label}</span>
                          <span className="shrink-0 text-xs tabular-nums text-slate-400">{categoryCounts[tab.key] || 0}</span>
                        </span>
                      ),
                    }))}
                    onChange={value => {
                      setActiveTab(value as TabKey);
                    }}
                    size="sm"
                    className="w-9 shrink-0"
                    triggerClassName="worklog-table-category-trigger !h-9 !w-9 !border-0 !bg-transparent !p-0 hover:!bg-slate-50"
                    triggerContent={<Menu size={18} />}
                    hideChevron
                    hideSelectedCheck
                    panelClassName="w-40"
                  />
                  <span className="mx-0.5 h-6 w-px shrink-0 bg-slate-200" />
                  <div
                    ref={setWorkLogTableToolbarHost}
                    className="project-format-toolbar-host flex h-10 min-w-0 flex-1 items-center"
                    aria-label="表格格式工具栏"
                  />
                </div>
              ) : (
                <div className="flex min-w-0 max-w-full flex-1 items-center overflow-x-auto overscroll-x-contain">
                  {TABS.map(tab => {
                    const active = activeTab === tab.key;
                    return (
                      <button
                        key={tab.key}
                        type="button"
                        onClick={() => setActiveTab(tab.key)}
                        className={`relative inline-flex h-9 shrink-0 items-center gap-2 px-2 text-sm font-medium transition-colors after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:content-[''] ${
                          active
                            ? 'text-primary-600 after:bg-primary-600'
                            : 'text-slate-500 after:bg-transparent hover:text-slate-900'
                        }`}
                      >
                        <span>{tab.label}</span>
                        <span className={`text-xs tabular-nums ${active ? 'text-primary-600' : 'text-slate-400'}`}>
                          {categoryCounts[tab.key] || 0}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              selectedCount={0}
              onExport={() => void handleExport()}
              onImport={() => importFileInputRef.current?.click()}
              hideTransferOnMobile
              menuActions={[{
                label: '设置',
                icon: <Settings2 size={16} />,
                onClick: openCardSettings,
              }]}
              searchPlaceholder="搜索产品、客户、负责人、特色..."
              weekDateLabel={workWeekLabel}
              weekLeadingContent={(
                <div className="flex items-center gap-2">
                  <div className="hidden h-10 shrink-0 items-center rounded-lg border border-slate-200 bg-slate-100 p-0.5 lg:flex" aria-label="管理周报视图切换">
                    <button type="button" aria-label="卡片视图" aria-pressed={displayMode === 'cards'} title="卡片视图" onClick={() => setDisplayMode('cards')} className={`flex h-9 w-9 items-center justify-center rounded-md transition-colors ${displayMode === 'cards' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-700'}`}>
                      <Square size={17} />
                    </button>
                    {!isDirectSalesTab && <button type="button" aria-label="表格模式" aria-pressed={displayMode === 'table'} title="表格模式" onClick={() => { setDetailDraft(null); setDetailEntryId(null); setDisplayMode('table'); }} className={`flex h-9 w-9 items-center justify-center rounded-md transition-colors ${displayMode === 'table' ? 'bg-white text-primary-700 shadow-sm' : 'text-slate-400 hover:text-slate-700'}`}>
                      <Table2 size={17} />
                    </button>}
                  </div>
                <ManagerScopeFilter
                  isAdmin={currentUser?.business_role === 'admin'}
                  accountName={accountName}
                  managers={trustManagers.map(manager => manager.name)}
                  selectedManagers={selectedManagerFilters}
                  onlyMine={showOnlyMine}
                  onManagersChange={managers => void updatePreferences({ worklogManagerFilters: managers }, '经理筛选保存失败')}
                  onOnlyMineChange={enabled => void setOnlyMinePreference('worklog', enabled)}
                  scopeLabel="管理周报"
                />
                </div>
              )}
              weekOptions={weekOptions}
              selectedWeekKey={selectedWeekKey || currentWeekKey}
              onWeekChange={setSelectedWeekKey}
            />
          </div>
        )}
      >
        <div className={`grid min-h-0 flex-1 gap-4 transition-[grid-template-columns] duration-200 ${detailPanel ? 'lg:grid-cols-[minmax(280px,1fr)_1px_minmax(360px,520px)] lg:gap-0' : 'grid-cols-1'}`}>
          <div ref={listScrollRef} key={`${activeTab}-${selectedWeekKey || currentWeekKey}`} className={`app-cloud-preview min-w-0 overflow-visible lg:overflow-y-auto lg:overscroll-y-contain ${effectiveDisplayMode === 'table' ? 'p-0' : 'pb-1 pr-1 pt-3'}`}>
          {isLoading && entries.length === 0 ? (
            <LoadingSpinner fullPage message="加载工作日志..." />
          ) : effectiveDisplayMode === 'cards' ? (
            <WorkLogCards
              data={filteredEntries}
              activeTab={activeTab}
              selectedWeekKey={selectedWeekKey || currentWeekKey}
              onAddBlank={handleAddBlank}
              baseInfoGapMap={baseInfoGapMap}
              focusedEntryId={detailEntryId}
              onOpenDetail={entry => {
                setDetailDraft(null);
                setDetailEntryId(entry.id);
              }}
              compact={Boolean(detailEntry)}
              cardFields={worklogCardFields}
              cardColumns={worklogCardColumns}
            />
          ) : (
            <WorkLogExcelView
              data={filteredEntries}
              weekKey={selectedWeekKey || currentWeekKey}
              toolbarHost={workLogTableToolbarHost}
              onUpdate={(entry, updates) => updateEntry(entry.id, updates)}
              statusOptions={workLogStatusOptions}
              onOpenDetail={entry => {
                setDisplayMode('cards');
                setDetailDraft(null);
                setDetailEntryId(entry.id);
              }}
            />
          )}
          </div>

          {detailPanel && <div aria-hidden="true" className="hidden h-full bg-slate-200 lg:block" />}

          {detailPanel && (
            <aside className="contents min-w-0 lg:block lg:h-full lg:min-h-0 lg:overflow-hidden">
              {detailPanel}
            </aside>
          )}
        </div>
      </ListCardShell>

      <AppModal
        open={cardSettingsOpen}
        onClose={() => setCardSettingsOpen(false)}
        title="管理周报卡片设置"
        subtitle="设置仅对当前账号生效，只调整卡片外显字段，不影响详情中的完整内容。"
        size="lg"
        footer={(
          <>
            <button
              type="button"
              onClick={() => {
                setCardColumnsDraft(3);
                setCardFieldDraft({
                  normal: [...DEFAULT_WORKLOG_NORMAL_CARD_FIELDS],
                  problem: [...DEFAULT_WORKLOG_PROBLEM_CARD_FIELDS],
                  directSales: [...DEFAULT_WORKLOG_DIRECT_SALES_CARD_FIELDS],
                });
              }}
              className="mr-auto inline-flex h-10 items-center justify-center border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              恢复默认
            </button>
            <button type="button" onClick={() => setCardSettingsOpen(false)} className="inline-flex h-10 items-center justify-center border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">
              取消
            </button>
            <button type="button" onClick={() => void saveCardSettings()} className="inline-flex h-10 items-center justify-center bg-primary-600 px-4 text-sm font-medium text-white hover:bg-primary-700">
              保存设置
            </button>
          </>
        )}
      >
        <div className="space-y-6">
          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">每行卡片数</h3>
              <p className="mt-0.5 text-xs text-slate-500">选择电脑端管理周报每行显示的卡片数量</p>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {([3, 4, 5, 6] as const).map(columns => {
                const selected = cardColumnsDraft === columns;
                return (
                  <button
                    key={columns}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setCardColumnsDraft(columns)}
                    className={`flex h-14 items-center justify-center gap-1 border text-sm transition-colors ${
                      selected
                        ? 'border-primary-500 bg-primary-50 font-semibold text-primary-700'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                    }`}
                  >
                    <span className="text-lg tabular-nums">{columns}</span>
                    <span className="text-xs">列</span>
                  </button>
                );
              })}
            </div>
          </section>
          {([
            { scope: 'normal', title: '正常项目卡片', limit: WORKLOG_NORMAL_CARD_FIELD_OPTIONS.length, unlimited: true, options: WORKLOG_NORMAL_CARD_FIELD_OPTIONS },
            { scope: 'problem', title: '问题项目卡片', limit: 3, unlimited: false, options: WORKLOG_PROBLEM_CARD_FIELD_OPTIONS },
            { scope: 'directSales', title: '直销产品情况', limit: 6, unlimited: false, options: WORKLOG_DIRECT_SALES_CARD_FIELD_OPTIONS },
          ] as const).map(group => (
            <section key={group.scope} className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">{group.title}</h3>
                  <p className="mt-0.5 text-xs text-slate-500">{group.unlimited ? '至少选择 1 项，可选择全部字段' : `至少选择 1 项，最多选择 ${group.limit} 项`}</p>
                </div>
                <span className="text-xs font-medium tabular-nums text-slate-500">{group.unlimited ? `${cardFieldDraft[group.scope].length} 项` : `${cardFieldDraft[group.scope].length} / ${group.limit}`}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {group.options.map(option => {
                  const selected = cardFieldDraft[group.scope].includes(option.key);
                  const disabled = !selected && cardFieldDraft[group.scope].length >= group.limit;
                  return (
                    <button
                      key={option.key}
                      type="button"
                      disabled={disabled}
                      aria-pressed={selected}
                      onClick={() => toggleCardField(group.scope, option.key, group.limit)}
                      className={`flex min-h-11 items-center justify-between gap-2 border px-3 py-2 text-left text-sm transition-colors ${
                        selected
                          ? 'border-primary-500 bg-primary-50 text-primary-700'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-300'
                      }`}
                    >
                      <span>{option.label}</span>
                      {selected && <Check size={15} className="shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </AppModal>

      <AppModal
        open={Boolean(detailDraft)}
        onClose={closeDetail}
        title="新增管理周报"
        subtitle={`${detailDraft?.category || '正常项目'} · ${selectedWeekLabel}`}
        size="xl"
        fillContent
        scopeId="worklog-content-scope"
        backdrop="none"
        exitAnimation={false}
        panelClassName="worklog-create-panel"
        bodyClassName="worklog-create-body"
        footer={(
          <>
            <button type="button" onClick={closeDetail} className="inline-flex h-10 items-center justify-center border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">
              取消
            </button>
            <button type="button" onClick={handleCompleteDetail} className="inline-flex h-10 items-center justify-center bg-slate-950 px-5 text-sm font-medium text-white hover:bg-slate-800">
              创建周报
            </button>
          </>
        )}
      >
        {detailDraft && (
          <WorkLogCreateContext.Provider value>
            <WorkLogLastEditContext.Provider value={{}}>
              <div className="worklog-create-sections">
                {renderDetailContent()}
              </div>
            </WorkLogLastEditContext.Provider>
          </WorkLogCreateContext.Provider>
        )}
      </AppModal>

      <input
        ref={importFileInputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0] || null;
          event.target.value = '';
          if (!file) return;
          setImportInitialFile(file);
          setShowImportModal(true);
        }}
      />

      {showImportModal && (
        <WorkLogImportModal
          isOpen={showImportModal}
          onClose={() => { setShowImportModal(false); setImportInitialFile(null); }}
          onImport={handleImport}
          defaultWeekKey={currentWeekKey}
          initialFile={importInitialFile}
        />
      )}

      <DragImportOverlay
        enabled
        onFileDrop={(file) => {
          setImportInitialFile(file);
          setShowImportModal(true);
        }}
      />

      <DeleteConfirmDialog
        open={deleteConfirmOpen}
        title="删除管理周报条目"
        targetName={detailEntry?.productName || '未命名周报'}
        onCancel={() => setDeleteConfirmOpen(false)}
        onConfirm={handleDeleteDetail}
      />

    </div>
  );
}
