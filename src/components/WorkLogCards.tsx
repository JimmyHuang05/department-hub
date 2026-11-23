import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { FileText, Plus, UserRound } from 'lucide-react';
import { useWorkLogStore } from '../store/workLogStore';
import { useCollaborationStore, type EditingPresence } from '../store/collaborationStore';
import { broadcastEditingStart, broadcastEditingStop } from '../hooks/useCollaboration';
import { useShallow } from 'zustand/react/shallow';
import type { WorkLogEntry } from '../types';
import EditingLockOverlay from './Collaboration/EditingLockOverlay';
import { findExactDuplicateGroups, WORKLOG_COMPARE_FIELDS } from '../utils/duplicateDetection';
import { useMobileViewport } from '../hooks/useMobileViewport';

interface WorkLogCardsProps {
  data: WorkLogEntry[];
  activeTab: string;
  selectedWeekKey?: string | null;
  onAddBlank: () => void;
  baseInfoGapMap?: Map<string, string[]>;
  onOpenDetail?: (entry: WorkLogEntry) => void;
  compact?: boolean;
  focusedEntryId?: string | null;
  cardFields?: WorkLogCardFieldPreferences;
  cardColumns?: 3 | 4 | 5 | 6;
}

export interface WorkLogCardFieldPreferences {
  normal: string[];
  problem: string[];
  directSales: string[];
}

export const WORKLOG_NORMAL_CARD_FIELD_OPTIONS = [
  { key: 'subCategory', label: '项目分类' },
  { key: 'productName', label: '产品名称' }, { key: 'clientType', label: '客户名称 / 类型' },
  { key: 'navScale', label: '净值 / 规模' }, { key: 'establishDate', label: '成立日 / 拟成立日' },
  { key: 'channelSales', label: '渠道销售' }, { key: 'weeklyProgress', label: '上周进展' },
  { key: 'nextWeekPlan', label: '下周工作计划' }, { key: 'nav', label: '净值' },
  { key: 'yearStartNav', label: '年初净值' }, { key: 'personA', label: 'A角' },
  { key: 'personB', label: 'B角' }, { key: 'activePassive', label: '主动 / 被动' },
  { key: 'collectiveSingle', label: '集合 / 单一' }, { key: 'advisorManager', label: '投资顾问 / 管理人' },
  { key: 'productTerm', label: '产品期限' }, { key: 'features', label: '特色' },
  { key: 'managementReport', label: '管理报告' }, { key: 'riskReport', label: '风控报告' },
  { key: 'salesReport', label: '销售端报告' },
];
export const WORKLOG_PROBLEM_CARD_FIELD_OPTIONS = [
  { key: 'productName', label: '项目名称' },
  { key: 'description', label: '项目情况' },
  { key: 'clientType', label: '客户名称' }, { key: 'navScale', label: '项目规模' },
  { key: 'weeklyProgress', label: '上周进展' }, { key: 'deadline', label: '预计最晚化解时间' },
  { key: 'nextWeekPlan', label: '后续举措' }, { key: 'progressExpectation', label: '进展是否达预期' },
  { key: 'personA', label: 'A角' }, { key: 'personB', label: 'B角' },
  { key: 'activePassive', label: '主动 / 被动' }, { key: 'collectiveSingle', label: '集合 / 单一' },
  { key: 'advisorManager', label: '投资顾问 / 管理人' }, { key: 'productTerm', label: '产品期限' },
  { key: 'features', label: '特色' }, { key: 'managementReport', label: '管理报告' },
  { key: 'riskReport', label: '风控报告' }, { key: 'salesReport', label: '销售端报告' },
];
export const WORKLOG_DIRECT_SALES_CARD_FIELD_OPTIONS = [
  { key: 'subCategory', label: '直销产品类别' }, { key: 'productName', label: '产品名称' },
  { key: 'clientType', label: '客户名称 / 类型' },
  { key: 'navScale', label: '规模（万）' }, { key: 'productTerm', label: '目标规模（万）' },
  { key: 'nav', label: '净值' }, { key: 'changePercent', label: '较上周' },
  { key: 'holdingsOver10', label: '持仓超过10%的个券明细' },
  { key: 'equityAssetRatio', label: '权益资产占比' },
  { key: 'warningLineStatus', label: '是否触及预警、平仓线' }, { key: 'focusPoint', label: '关注点' },
  { key: 'weeklyReview', label: '一周回顾' }, { key: 'nextWeekPlan', label: '后续计划' },
  { key: 'channelSales', label: '销售渠道' }, { key: 'channelContact', label: '渠道对接人' },
  { key: 'subscriptionRedemption', label: '当周申赎情况' },
  { key: 'nextSalesPlan', label: '下一步工作计划' },
];

const CATEGORY_ORDER = ['正常项目', '问题项目', '直销产品情况'];
const CATEGORY_COLORS: Record<string, string> = {
  正常项目: '#22c55e',
  问题项目: '#ef4444',
  直销产品情况: '#3b82f6',
};

function normalizeCategory(category?: string) {
  if (!category) return '正常项目';
  if (category.includes('问题')) return '问题项目';
  if (category.includes('直销')) return '直销产品情况';
  if (category.includes('正常')) return '正常项目';
  return category;
}

function sortedProgress(entry: WorkLogEntry): [string, string][] {
  return Object.entries(entry.weeklyProgress || {})
    .filter(([, value]) => Boolean(value) && value !== '/')
    .sort(([left], [right]) => right.localeCompare(left));
}

function getCurrentProgress(entry: WorkLogEntry, selectedWeekKey?: string | null) {
  if (selectedWeekKey) return entry.weeklyProgress?.[selectedWeekKey] || '';
  return sortedProgress(entry)[0]?.[1] || '';
}

function managerText(entry: WorkLogEntry) {
  if (normalizeCategory(entry.category) === '直销产品情况') {
    return String(entry.dynamicFields?.channelContact || '').trim();
  }
  return [entry.personA, entry.personB].filter(Boolean).join(' / ');
}

function workLogStatusColor(status?: string) {
  const value = String(status || '');
  if (/中止|终止|异常|问题|逾期/.test(value)) return '#dc2626';
  if (/成立|完成|正常|已完成/.test(value)) return '#16a34a';
  if (/上会|待定|推进|进行/.test(value)) return '#d97706';
  if (/报告|审核|复核/.test(value)) return '#2563eb';
  return '#64748b';
}

function EditableField({
  label,
  value,
  onChange,
  type = 'text',
  disabled = false,
  onEditingStart,
  onEditingStop,
}: {
  label: string;
  value?: string | number;
  onChange: (value: string) => void;
  type?: 'text' | 'number';
  multiline?: boolean;
  disabled?: boolean;
  onEditingStart?: () => void;
  onEditingStop?: () => void;
}) {
  const [draft, setDraft] = useState(String(value ?? ''));
  const latestDraftRef = useRef(String(value ?? ''));
  const latestValueRef = useRef(String(value ?? ''));
  const onChangeRef = useRef(onChange);
  const focusedRef = useRef(false);
  const dirtyRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputClassName = 'worklog-card-field__input h-9 w-full border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none placeholder:text-slate-300 disabled:cursor-not-allowed disabled:bg-slate-100';

  latestValueRef.current = String(value ?? '');
  onChangeRef.current = onChange;

  useEffect(() => {
    if (focusedRef.current || dirtyRef.current) return;
    const nextValue = String(value ?? '');
    latestDraftRef.current = nextValue;
    setDraft(nextValue);
  }, [value]);

  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  }, []);

  const flushDraft = () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    if (latestDraftRef.current !== latestValueRef.current) {
      onChangeRef.current(latestDraftRef.current);
    }
  };

  const changeDraft = (nextValue: string) => {
    latestDraftRef.current = nextValue;
    dirtyRef.current = true;
    setDraft(nextValue);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(flushDraft, 1500);
  };

  return (
    <label className="worklog-card-field grid min-w-0 gap-1" onClick={event => event.stopPropagation()}>
      <span className="worklog-card-field__label text-[11px] font-normal leading-4 text-slate-500">{label}</span>
      <input
        type={type}
        inputMode={type === 'number' ? 'decimal' : undefined}
        value={draft}
        disabled={disabled}
        onFocus={() => {
          focusedRef.current = true;
          onEditingStart?.();
        }}
        onBlur={() => {
          flushDraft();
          focusedRef.current = false;
          onEditingStop?.();
        }}
        onChange={(event) => changeDraft(event.target.value)}
        className={inputClassName}
        placeholder="未填写"
      />
    </label>
  );
}

function NumericEditableField({
  label,
  value,
  onCommit,
  disabled = false,
  onEditingStart,
  onEditingStop,
}: {
  label: string;
  value?: number;
  onCommit: (value: string) => void;
  disabled?: boolean;
  onEditingStart?: () => void;
  onEditingStop?: () => void;
}) {
  const [draft, setDraft] = useState(String(value ?? ''));
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) setDraft(String(value ?? ''));
  }, [value]);

  return (
    <label className="worklog-card-field grid min-w-0 gap-1" onClick={event => event.stopPropagation()}>
      <span className="worklog-card-field__label text-[11px] font-normal leading-4 text-slate-500">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={draft}
        disabled={disabled}
        onFocus={() => {
          focusedRef.current = true;
          onEditingStart?.();
        }}
        onBlur={() => {
          focusedRef.current = false;
          onCommit(draft);
          onEditingStop?.();
        }}
        onChange={event => setDraft(event.target.value)}
        className="worklog-card-field__input h-9 w-full border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none placeholder:text-slate-300 disabled:cursor-not-allowed disabled:bg-slate-100"
        placeholder="未填写"
      />
    </label>
  );
}

function WorkLogCard({
  entry,
  selectedWeekKey,
  baseInfoGaps = [],
  onOpenDetail,
  compact = false,
  focused = false,
  editor,
  isDuplicate = false,
  cardFields,
  cardColumns = 3,
}: {
  entry: WorkLogEntry;
  selectedWeekKey?: string | null;
  baseInfoGaps?: string[];
  onOpenDetail?: (entry: WorkLogEntry) => void;
  compact?: boolean;
  focused?: boolean;
  editor?: EditingPresence;
  isDuplicate?: boolean;
  cardFields: WorkLogCardFieldPreferences;
  cardColumns?: 3 | 4 | 5 | 6;
}) {
  const updateEntry = useWorkLogStore(state => state.updateEntry);
  const [editingField, setEditingField] = useState<string | null>(null);
  const editingPresenceRef = useRef<{
    recordType: string;
    recordId: string | null;
    recordLabel: string;
    field: string;
    fieldLabel: string;
    location: string;
    startedAt: number;
  } | null>(null);
  const progress = getCurrentProgress(entry, selectedWeekKey);
  const manager = managerText(entry);
  const weekKey = selectedWeekKey || entry.weekKey;
  const baseInfoGapText = baseInfoGaps.map(item => '\u7f3a' + item).join(' / ');
  const isLocked = Boolean(editor);
  const isDirectSales = normalizeCategory(entry.category) === '直销产品情况';
  const dynamicFields = entry.dynamicFields || {};
  const weeklyReview = Object.prototype.hasOwnProperty.call(dynamicFields, 'weeklyReview')
    ? dynamicFields.weeklyReview
    : progress;
  const nextSalesPlan = Object.prototype.hasOwnProperty.call(dynamicFields, 'nextSalesPlan')
    ? dynamicFields.nextSalesPlan
    : entry.nextWeekPlan;
  const normalizedCategory = normalizeCategory(entry.category);
  const configuredVisibleFields = isDirectSales
    ? cardFields.directSales
    : normalizedCategory === '问题项目' ? cardFields.problem : cardFields.normal;
  const visibleFields = configuredVisibleFields.filter(field => field !== 'status');
  const statusBadgeStyle = { '--status-color': workLogStatusColor(entry.status) } as CSSProperties;

  const stopEditing = () => {
    if (!editingPresenceRef.current) return;
    broadcastEditingStop(editingPresenceRef.current);
    editingPresenceRef.current = null;
    setEditingField(null);
  };

  const startEditing = (field: string, fieldLabel: string) => {
    if (isLocked) return;
    stopEditing();
    const payload = {
      recordType: 'worklog',
      recordId: entry.id,
      recordLabel: entry.productName || entry.id,
      field,
      fieldLabel,
      location: '管理周报',
      startedAt: Date.now(),
    };
    editingPresenceRef.current = payload;
    setEditingField(field);
    broadcastEditingStart(payload);
  };

  useEffect(() => {
    if (!editingPresenceRef.current) return;
    const timer = window.setInterval(() => {
      if (editingPresenceRef.current) broadcastEditingStart(editingPresenceRef.current);
    }, 15000);
    return () => window.clearInterval(timer);
  }, [editingField]);

  useEffect(() => () => {
    stopEditing();
  }, []);

  const setField = (field: keyof WorkLogEntry, value: string) => {
    if (field === 'navScale' && weekKey) {
      updateEntry(entry.id, {
        navScale: value,
        navScaleHistory: { ...(entry.navScaleHistory || {}), [weekKey]: value },
      });
      return;
    }
    updateEntry(entry.id, { [field]: value } as Partial<WorkLogEntry>);
  };

  const setProgress = (value: string) => {
    if (!weekKey) return;
    updateEntry(entry.id, {
      weeklyProgress: { ...(entry.weeklyProgress || {}), [weekKey]: value },
    });
  };

  const setNumberField = (field: 'nav' | 'yearStartNav' | 'changePercent', value: string) => {
    updateEntry(entry.id, { [field]: value === '' ? 0 : Number(value) || 0 });
  };

  const setDynamicField = (field: string, value: string) => {
    updateEntry(entry.id, {
      dynamicFields: { ...(entry.dynamicFields || {}), [field]: value },
    });
  };

  const renderCardField = (field: string) => {
    const editable = (label: string, value: string | number | undefined, target: keyof WorkLogEntry, multiline = false) => (
      <EditableField key={field} label={label} value={value} multiline={multiline} disabled={isLocked}
        onEditingStart={() => startEditing(String(target), label)} onEditingStop={stopEditing}
        onChange={value => setField(target, value)} />
    );
    switch (field) {
      case 'nav': return <NumericEditableField key={field} label="净值" value={entry.nav} disabled={isLocked} onEditingStart={() => startEditing('nav', '净值')} onEditingStop={stopEditing} onCommit={value => setNumberField('nav', value)} />;
      case 'yearStartNav': return <NumericEditableField key={field} label="年初净值" value={entry.yearStartNav} disabled={isLocked} onEditingStart={() => startEditing('yearStartNav', '年初净值')} onEditingStop={stopEditing} onCommit={value => setNumberField('yearStartNav', value)} />;
      case 'changePercent': return <NumericEditableField key={field} label="较上周" value={entry.changePercent} disabled={isLocked} onEditingStart={() => startEditing('changePercent', '较上周')} onEditingStop={stopEditing} onCommit={value => setNumberField('changePercent', value)} />;
      case 'weeklyProgress': return <EditableField key={field} label="上周进展" value={progress} multiline disabled={isLocked} onEditingStart={() => startEditing('weeklyProgress', '上周进展')} onEditingStop={stopEditing} onChange={setProgress} />;
      case 'weeklyReview': return <EditableField key={field} label="一周回顾" value={weeklyReview} multiline disabled={isLocked} onEditingStart={() => startEditing('dynamicFields.weeklyReview', '一周回顾')} onEditingStop={stopEditing} onChange={value => setDynamicField('weeklyReview', value)} />;
      case 'subscriptionRedemption': return <EditableField key={field} label="当周申赎情况" value={dynamicFields.subscriptionRedemption || ''} multiline disabled={isLocked} onEditingStart={() => startEditing('dynamicFields.subscriptionRedemption', '当周申赎情况')} onEditingStop={stopEditing} onChange={value => setDynamicField('subscriptionRedemption', value)} />;
      case 'nextSalesPlan': return <EditableField key={field} label="下一步工作计划" value={nextSalesPlan} multiline disabled={isLocked} onEditingStart={() => startEditing('dynamicFields.nextSalesPlan', '下一步工作计划')} onEditingStop={stopEditing} onChange={value => setDynamicField('nextSalesPlan', value)} />;
      case 'progressExpectation': return <EditableField key={field} label="进展是否达预期" value={dynamicFields.progressExpectation || ''} disabled={isLocked} onEditingStart={() => startEditing('dynamicFields.progressExpectation', '进展是否达预期')} onEditingStop={stopEditing} onChange={value => setDynamicField('progressExpectation', value)} />;
      case 'holdingsOver10': return <EditableField key={field} label="持仓超过10%的个券明细" value={dynamicFields.holdingsOver10 || ''} multiline disabled={isLocked} onEditingStart={() => startEditing('dynamicFields.holdingsOver10', '持仓超过10%的个券明细')} onEditingStop={stopEditing} onChange={value => setDynamicField('holdingsOver10', value)} />;
      case 'equityAssetRatio': return <EditableField key={field} label="权益资产占比" value={dynamicFields.equityAssetRatio || ''} disabled={isLocked} onEditingStart={() => startEditing('dynamicFields.equityAssetRatio', '权益资产占比')} onEditingStop={stopEditing} onChange={value => setDynamicField('equityAssetRatio', value)} />;
      case 'warningLineStatus': return <EditableField key={field} label="是否触及预警、平仓线" value={dynamicFields.warningLineStatus || ''} disabled={isLocked} onEditingStart={() => startEditing('dynamicFields.warningLineStatus', '是否触及预警、平仓线')} onEditingStop={stopEditing} onChange={value => setDynamicField('warningLineStatus', value)} />;
      case 'focusPoint': return <EditableField key={field} label="关注点" value={dynamicFields.focusPoint || ''} multiline disabled={isLocked} onEditingStart={() => startEditing('dynamicFields.focusPoint', '关注点')} onEditingStop={stopEditing} onChange={value => setDynamicField('focusPoint', value)} />;
      case 'channelContact': return <EditableField key={field} label="渠道对接人" value={dynamicFields.channelContact || ''} disabled={isLocked} onEditingStart={() => startEditing('dynamicFields.channelContact', '渠道对接人')} onEditingStop={stopEditing} onChange={value => setDynamicField('channelContact', value)} />;
      case 'subCategory': return editable(isDirectSales ? '直销产品类别' : '项目分类', entry.subCategory, 'subCategory');
      case 'productName': return editable(isDirectSales ? '产品名称' : normalizedCategory === '问题项目' ? '项目名称' : '产品名称', entry.productName, 'productName');
      case 'status': return editable('状态', entry.status, 'status');
      case 'clientType': return editable(isDirectSales ? '客户名称 / 类型' : normalizedCategory === '问题项目' ? '客户名称' : '客户名称 / 类型', entry.clientType, 'clientType');
      case 'navScale': return editable(isDirectSales ? '规模（万）' : normalizedCategory === '问题项目' ? '项目规模' : '净值 / 规模', entry.navScale, 'navScale');
      case 'establishDate': return editable('成立日 / 拟成立日', entry.establishDate, 'establishDate');
      case 'deadline': return editable('预计最晚化解时间', entry.deadline, 'deadline');
      case 'channelSales': return editable(isDirectSales ? '销售渠道' : '渠道销售', entry.channelSales, 'channelSales');
      case 'productTerm': return editable(isDirectSales ? '目标规模（万）' : '产品期限', entry.productTerm, 'productTerm');
      case 'features': return editable('特色', entry.features, 'features', true);
      case 'description': return editable('项目情况', entry.description, 'description', true);
      case 'personA': return editable('A角', entry.personA, 'personA');
      case 'personB': return editable('B角', entry.personB, 'personB');
      case 'activePassive': return editable('主动 / 被动', entry.activePassive, 'activePassive');
      case 'collectiveSingle': return editable('集合 / 单一', entry.collectiveSingle, 'collectiveSingle');
      case 'advisorManager': return editable('投资顾问 / 管理人', entry.advisorManager, 'advisorManager');
      case 'managementReport': return editable('管理报告', entry.managementReport, 'managementReport');
      case 'riskReport': return editable('风控报告', entry.riskReport, 'riskReport');
      case 'salesReport': return editable('销售端报告', entry.salesReport, 'salesReport');
      case 'nextWeekPlan': return editable(isDirectSales ? '后续计划' : normalizedCategory === '问题项目' ? '后续举措' : '下周工作计划', entry.nextWeekPlan, 'nextWeekPlan', true);
      default: return null;
    }
  };

  return (
    <article
      data-worklog-entry-id={entry.id}
      className={`worklog-card mobile-unified-card app-virtual-worklog-card group relative snap-start scroll-mt-3 overflow-hidden border bg-white shadow-sm transition-[border-color,box-shadow] ${isDuplicate ? 'border-red-300 bg-red-50/30 ring-1 ring-inset ring-red-300' : ''} ${isLocked ? 'cursor-not-allowed border-slate-200 bg-slate-100 opacity-60 grayscale' : focused ? 'app-selected-border z-10 cursor-pointer' : `cursor-pointer ${isDuplicate ? 'hover:border-red-400' : 'border-slate-200 hover:border-slate-300 hover:shadow-md'}`}`}
      role="button"
      tabIndex={isLocked ? -1 : 0}
      aria-disabled={isLocked}
      onClick={() => {
        if (isLocked) return;
        onOpenDetail?.(entry);
      }}
      onKeyDown={event => {
        if (isLocked) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpenDetail?.(entry);
        }
      }}
    >
      <span className="absolute left-0 top-3 h-10 w-1 bg-[var(--group-color)]" />
      {editor && <EditingLockOverlay editor={editor} />}
      <header className="worklog-card__header min-w-0 px-5 py-3">
        <div className="min-w-0" style={statusBadgeStyle}>
          <div className="flex min-w-0 items-start gap-2.5">
            <h3
              className={`worklog-card__title min-w-0 flex-1 break-words text-base font-semibold leading-6 text-slate-900 ${
                !compact && cardColumns >= 5 ? 'line-clamp-2' : 'truncate'
              }`}
              title={entry.productName || '未命名记录'}
            >
              {entry.productName || '未命名记录'}
            </h3>
            {baseInfoGapText && <span className="app-warning-badge max-w-[180px] shrink-0 truncate px-2 py-0.5 text-xs font-medium" title={baseInfoGapText}>{baseInfoGapText}</span>}
          </div>
          <div className="mt-0.5 flex min-w-0 items-center justify-between gap-3 text-xs font-medium leading-5">
            <span className="worklog-card__status min-w-0 truncate text-[var(--status-color)]">{entry.status || '未填写状态'}</span>
            <span className="worklog-card__manager flex min-w-0 shrink-0 items-center gap-1.5 text-slate-700">
              <UserRound size={14} className="shrink-0 text-slate-400" aria-hidden="true" />
              <span className="max-w-44 truncate">{manager || '未分配'}</span>
            </span>
          </div>
        </div>
      </header>

      <div className="worklog-card__body border-t border-slate-100 px-5 py-3">
        <div className={`worklog-card__fields grid gap-x-3 gap-y-2.5 ${isDirectSales && !compact ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'}`}>
          {visibleFields.map(renderCardField)}
        </div>
      </div>

    </article>
  );
}

function MobileWorkLogCards({
  data,
  selectedWeekKey,
  onOpenDetail,
}: Pick<WorkLogCardsProps, 'data' | 'selectedWeekKey' | 'onOpenDetail'>) {
  return (
    <div className="mobile-native-card-list">
      {data.map(entry => {
        const progress = selectedWeekKey ? entry.weeklyProgress?.[selectedWeekKey] : undefined;
        return (
          <article
            key={entry.id}
            data-worklog-entry-id={entry.id}
            role="button"
            tabIndex={0}
            className="mobile-native-card"
            onClick={() => onOpenDetail?.(entry)}
            onKeyDown={event => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              onOpenDetail?.(entry);
            }}
          >
            <div className="mobile-native-card__title-row">
              <div className="mobile-native-card__heading" style={{ '--status-color': workLogStatusColor(entry.status) } as CSSProperties}>
                <h3>{entry.productName || '未命名记录'}</h3>
                <span className="mobile-native-card__subtitle text-[var(--status-color)]">{entry.status || '未填写状态'}</span>
              </div>
              <span aria-hidden="true">›</span>
            </div>
            <div className="mobile-native-card__grid">
              <div><span>项目分类</span><strong>{normalizeCategory(entry.category)}</strong></div>
              <div><span>净值 / 规模</span><strong>{entry.navScale || '—'}</strong></div>
              <div><span>上周进展</span><strong title={progress}>{progress || '—'}</strong></div>
              <div><span>下周工作计划</span><strong title={entry.nextWeekPlan}>{entry.nextWeekPlan || '—'}</strong></div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

export default function WorkLogCards({ data, activeTab, selectedWeekKey, onAddBlank, baseInfoGapMap, onOpenDetail, compact = false, focusedEntryId, cardFields = { normal: ['navScale', 'weeklyProgress', 'nextWeekPlan'], problem: ['navScale', 'weeklyProgress', 'nextWeekPlan'], directSales: ['nav', 'changePercent', 'weeklyReview', 'nextWeekPlan', 'subscriptionRedemption', 'nextSalesPlan'] }, cardColumns = 3 }: WorkLogCardsProps) {
  const isMobileViewport = useMobileViewport();
  const listRef = useRef<HTMLDivElement>(null);
  const lastScrolledEntryIdRef = useRef<string | null>(null);
  const { activeEditors, currentUserId } = useCollaborationStore(useShallow(s => ({
    activeEditors: s.activeEditors,
    currentUserId: s.userId,
  })));
  const workLogEditors = new Map(
    [...activeEditors.values()]
      .filter(editor => editor.recordType === 'worklog' && editor.recordId && editor.userId !== currentUserId)
      .map(editor => [editor.recordId!, editor])
  );
  const { duplicateIds } = findExactDuplicateGroups(data, WORKLOG_COMPARE_FIELDS);
  const grouped = data.reduce((acc, entry) => {
    const category = duplicateIds.has(entry.id) ? 'duplicate' : normalizeCategory(entry.category);
    if (!acc.has(category)) acc.set(category, []);
    acc.get(category)!.push(entry);
    return acc;
  }, new Map<string, WorkLogEntry[]>());

  const orderedGroups = Array.from(grouped.entries()).sort(([left], [right]) => {
    if (left === 'duplicate') return -1;
    if (right === 'duplicate') return 1;
    const leftIndex = CATEGORY_ORDER.indexOf(left);
    const rightIndex = CATEGORY_ORDER.indexOf(right);
    return (leftIndex === -1 ? CATEGORY_ORDER.length : leftIndex) - (rightIndex === -1 ? CATEGORY_ORDER.length : rightIndex);
  });

  useEffect(() => {
    if (!focusedEntryId) {
      lastScrolledEntryIdRef.current = null;
      return;
    }
    if (lastScrolledEntryIdRef.current === focusedEntryId) return;
    const target = listRef.current?.querySelector(`[data-worklog-entry-id="${focusedEntryId}"]`);
    if (!target) return;
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    lastScrolledEntryIdRef.current = focusedEntryId;
  }, [focusedEntryId, data.length]);

  if (isMobileViewport) {
    return data.length > 0
      ? <MobileWorkLogCards data={data} selectedWeekKey={selectedWeekKey} onOpenDetail={onOpenDetail} />
      : <div className="mobile-native-empty">暂无 {normalizeCategory(activeTab)} 记录</div>;
  }

  if (data.length === 0) {
    return (
      <div className="flex h-full min-h-[420px] flex-col items-center justify-center border border-dashed border-slate-200 bg-white px-4 py-10 text-center">
        <FileText size={28} className="mb-2 text-slate-300" />
        <p className="text-sm text-slate-500">暂无 {normalizeCategory(activeTab)} 记录</p>
        <button
          onClick={onAddBlank}
          className="mt-3 inline-flex items-center gap-2 bg-slate-950 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
        >
          <Plus size={15} />
          新增记录
        </button>
      </div>
    );
  }

  return (
    <div ref={listRef} className="space-y-3 pb-5">
      {orderedGroups.map(([category, entries]) => (
        <section key={category} className="space-y-2" style={{ ['--group-color' as string]: category === 'duplicate' ? '#dc2626' : CATEGORY_COLORS[category] || '#64748b' }}>
          <div className={`grid gap-3 ${compact ? 'grid-cols-1 md:grid-cols-2' : `grid-cols-1 md:grid-cols-2 ${{ 3: 'xl:grid-cols-3', 4: 'xl:grid-cols-4', 5: 'xl:grid-cols-5', 6: 'xl:grid-cols-6' }[cardColumns]}`}`}>
            {[...entries].sort((left, right) => (
              category === 'duplicate'
                ? (left.productName || '').localeCompare(right.productName || '', 'zh-CN') || left.id.localeCompare(right.id)
                : 0
            )).map(entry => (
              <WorkLogCard
                key={entry.id}
                entry={entry}
                selectedWeekKey={selectedWeekKey}
                baseInfoGaps={baseInfoGapMap?.get(entry.id) || []}
                onOpenDetail={onOpenDetail}
                compact={compact}
                focused={entry.id === focusedEntryId}
                editor={workLogEditors.get(entry.id)}
                isDuplicate={duplicateIds.has(entry.id)}
                cardFields={cardFields}
                cardColumns={cardColumns}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
