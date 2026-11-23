import { useEffect, useMemo } from 'react';
import { ArrowLeft, ArrowRight, Bell, CheckCircle2, CheckSquare2, ChevronLeft, ChevronRight, Clock3, ScrollText, Search, Square, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useShallow } from 'zustand/react/shallow';
import Header from '../components/Layout/Header';
import { useProjectStore } from '../store/projectStore';
import { useWorkLogStore } from '../store/workLogStore';
import { useAuthStore } from '../store/authStore';
import { getCurrentWeekKey, getWeekRange } from '../utils/week';
import { readAnimationsEnabled } from '../utils/motionPreference';
import { useMobileViewport } from '../hooks/useMobileViewport';
import { _toast } from '../store/toastRef';
import type { InvestmentProduct, WorkLogEntry } from '../types';
import FeatureInfo from '../components/Guidance/FeatureInfo';
import UserProfileAvatar from '../components/UserProfileAvatar';
import { MobileEmptyState, MobileHero, MobileListRow, MobileMetricGrid, MobilePageShell, MobileSection } from '../components/Mobile';
import {
  openWeeklyTodoSearch,
  WEEKLY_TODO_HANDLED_EVENT,
  weeklyTodoBadgeClass,
  weeklyTodoToneClass,
  type WeeklyTodoTone,
} from '../utils/weeklyTodoSearch';

function parseDate(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isEstablished(product: InvestmentProduct) {
  return product.status?.includes('成立') || product.status?.includes('设立') || product.status?.includes('落地');
}

function isStopped(product: InvestmentProduct) {
  return product.status?.includes('中止') || product.status?.includes('终止');
}

function isProgressing(product: InvestmentProduct) {
  return !isEstablished(product) && !isStopped(product);
}

function isHistoricalWorkLogStatus(status: string) {
  return ['历史', '终止', '结束', '归档', '中止', '结项']
    .some(keyword => status?.includes(keyword));
}

function isHistoricalProjectStatus(status?: string) {
  return ['历史', '终止', '结束', '归档', '中止', '结项']
    .some(keyword => status?.includes(keyword || ''));
}

function isDirectSalesWorkLog(entry: WorkLogEntry) {
  return String(entry.category || '').includes('直销');
}

function workLogOwnerText(entry: WorkLogEntry) {
  if (isDirectSalesWorkLog(entry)) {
    return String(entry.dynamicFields?.channelContact || '').trim();
  }
  return [entry.personA, entry.personB].filter(Boolean).join(' / ');
}

function isAssignedToAccount(entry: WorkLogEntry, accountName: string) {
  if (!accountName) return false;
  const assignmentFields = isDirectSalesWorkLog(entry)
    ? [entry.dynamicFields?.channelContact]
    : [entry.personA, entry.personB];
  const names = assignmentFields
    .flatMap(value => String(value || '').split(/[\/／，,、;；&＆\s]+/))
    .map(value => value.trim())
    .filter(Boolean);
  return names.includes(accountName);
}

function participantProjectKey(value?: string) {
  return String(value || '').trim().toLocaleLowerCase('zh-CN');
}

function hasValue(value?: string | number | null) {
  const text = String(value ?? '').trim();
  return Boolean(text) && text !== '/';
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function dayDiff(from: Date, to: Date) {
  const dayMs = 24 * 60 * 60 * 1000;
  return Math.ceil((startOfLocalDay(to).getTime() - startOfLocalDay(from).getTime()) / dayMs);
}

function daysSince(value: string | undefined, now: Date) {
  const date = parseDate(value);
  if (!date) return null;
  return Math.max(0, dayDiff(date, now));
}

function isProblemWorkLog(entry: WorkLogEntry) {
  return [entry.category, entry.subCategory, entry.status, entry.description]
    .filter(Boolean)
    .some(value => String(value).includes('问题') || String(value).includes('风险'));
}

function uniqueLabels(labels: string[]) {
  return Array.from(new Set(labels.filter(Boolean)));
}

function wasUpdatedInWeek(updatedAt: string | undefined, weekKey: string) {
  const updated = parseDate(updatedAt);
  if (!updated) return false;
  const range = getWeekRange(weekKey);
  const start = new Date(`${range.start}T00:00:00`);
  const endExclusive = new Date(`${range.end}T00:00:00`);
  endExclusive.setDate(endExclusive.getDate() + 1);
  return updated >= start && updated < endExclusive;
}

function getWorkLogTodoGaps(entry: WorkLogEntry, weekKey: string) {
  const gaps: string[] = [];
  if (!hasValue(entry.navScale)) gaps.push('净值/规模');
  if (!hasValue(entry.weeklyProgress?.[weekKey])) gaps.push('本周进展');
  if (!hasValue(entry.productName)) gaps.push('产品名称');
  if (!hasValue(entry.status)) gaps.push('状态');
  if (!hasValue(entry.clientType)) gaps.push('客户');
  if (!hasValue(entry.personA) && !hasValue(entry.personB)) gaps.push('负责人');
  if (isProblemWorkLog(entry)) {
    if (!hasValue(entry.deadline)) gaps.push('预计化解时间');
    if (!hasValue(entry.nextWeekPlan)) gaps.push('后续措施');
  }
  return uniqueLabels(gaps);
}

function getProjectInfoGaps(product: InvestmentProduct) {
  const gaps: string[] = [];
  if (!hasValue(product.productName)) gaps.push('项目名称');
  if (!hasValue(product.status)) gaps.push('项目状态');
  if (!hasValue(product.trustManager)) gaps.push('A角');
  if (!hasValue(product.client)) gaps.push('委托人');
  if (!(Number(product.rmb) > 0) && !(Number(product.usd) > 0)) gaps.push('规模');
  return uniqueLabels(gaps);
}

type TodoTone = WeeklyTodoTone;


interface TodoItem {
  id: string;
  type: 'worklog' | 'project';
  title: string;
  description: string;
  meta: string;
  href: string;
  actionLabel: string;
  priority: number;
  tone: TodoTone;
  sourceUpdatedAt?: string;
}

interface ManagerTodoProgress {
  manager: string;
  total: number;
  completed: number;
  pending: number;
  percentage: number;
  completedItems: ManagerTodoDetail[];
  pendingItems: ManagerTodoDetail[];
}

interface ManagerTodoDetail {
  id: string;
  type: 'worklog' | 'project';
  title: string;
  description: string;
  meta: string;
  href: string;
}

const INTERN_TODO_INFO_BLOCKS = [
  {
    id: 'seal-service-hours',
    title: '用印办理安排',
    items: [
      {
        label: '公章、法定代表人章、信息披露章',
        location: '25 楼',
        periods: ['09:30–10:30', '15:30–16:30'],
      },
      {
        label: '合同专用章',
        location: '20 楼合规部',
        periods: ['11:00–11:15', '16:00–17:00'],
      },
    ],
    tips: [
      '涉及合同专用章的文件，请优先加盖合同专用章。',
      '文件超过一页的，应按要求加盖骑缝章。',
      '如需打印材料，请前往当前流程所在楼层打印。',
    ],
  },
] as const;

function InternTodoInfoBlocks({ mobile = false }: { mobile?: boolean }) {
  return <div className={mobile ? 'mobile-intern-info' : 'mt-3 shrink-0 border-t border-slate-100 pt-3'}>
    <div className="grid gap-2">
      {INTERN_TODO_INFO_BLOCKS.map(block => (
        <section key={block.id} className={mobile ? 'mobile-intern-info__card' : 'border border-slate-200 bg-white p-3'} aria-labelledby={`intern-info-${block.id}`}>
          <div className="flex items-start gap-2 border-b border-slate-100 pb-3">
            <Clock3 size={16} className="mt-0.5 shrink-0 text-primary-600" />
            <div className="min-w-0">
              <h4 id={`intern-info-${block.id}`} className="text-sm font-semibold text-slate-900">{block.title}</h4>
              <p className="mt-1 text-[11px] text-slate-500">请于规定时段前往指定地点办理</p>
            </div>
          </div>
          <div className="mt-3 grid gap-2">
            {block.items.map(item => (
              <div key={item.label} className={mobile ? 'mobile-intern-info__schedule' : 'border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs'}>
                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                  <div className="min-w-0 flex-1 font-medium leading-5 text-slate-800">{item.label}</div>
                  <span className="shrink-0 text-[11px] text-slate-500">{item.location}</span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] tabular-nums text-slate-600">
                  <span>{item.periods[0]}</span>
                  <span className="text-slate-300" aria-hidden="true">/</span>
                  <span>{item.periods[1]}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 border-t border-slate-100 pt-3">
            <div className="text-[11px] font-semibold text-slate-700">用印注意事项</div>
            <ol className="mt-2 grid gap-1.5 text-[11px] leading-[18px] text-slate-500">
              {block.tips.map((tip, index) => (
                <li key={tip} className="flex items-start gap-2">
                  <span className="shrink-0 tabular-nums text-slate-400">{index + 1}.</span>
                  <span>{tip}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>
      ))}
    </div>
  </div>;
}

function assignmentNames(...values: unknown[]) {
  return Array.from(new Set(values
    .flatMap(value => String(value || '').split(/[\/／，,、;；&＆\s]+/))
    .map(value => value.trim())
    .filter(Boolean)));
}

function buildManagerTodoProgress(entries: WorkLogEntry[], products: InvestmentProduct[], weekKey: string, now: Date) {
  const progress = new Map<string, ManagerTodoDetail[]>();
  const add = (manager: string, detail: ManagerTodoDetail) => {
    const current = progress.get(manager) || [];
    current.push(detail);
    progress.set(manager, current);
  };

  entries
    .filter(entry => !isHistoricalWorkLogStatus(entry.status))
    .forEach(entry => {
      const managers = isDirectSalesWorkLog(entry)
        ? assignmentNames(entry.dynamicFields?.channelContact)
        : assignmentNames(entry.personA, entry.personB);
      const todo = buildWorkLogTodo(entry, weekKey);
      if (todo) managers.forEach(manager => add(manager, todo));
    });

  products
    .filter(product => !isHistoricalProjectStatus(product.status))
    .forEach(product => {
      const managers = assignmentNames(product.trustManager, product.trustManagerB);
      const todo = buildProjectTodo(product, now);
      if (todo) managers.forEach(manager => add(manager, todo));
    });

  return Array.from(progress, ([manager, pendingItems]): ManagerTodoProgress => ({
    manager,
    total: pendingItems.length,
    completed: 0,
    pending: pendingItems.length,
    percentage: 0,
    completedItems: [],
    pendingItems,
  })).sort((left, right) => right.pending - left.pending || left.manager.localeCompare(right.manager, 'zh-CN'));
}

function ManagerTodoProgressList({ items, mobile = false, onSelect }: { items: ManagerTodoProgress[]; mobile?: boolean; onSelect?: (item: ManagerTodoProgress) => void }) {
  if (items.length === 0) {
    return <div className="px-5 py-8 text-center text-sm text-slate-500">暂无经理待办数据</div>;
  }
  return <div className={mobile ? 'grid gap-2 border-t border-slate-100 bg-slate-50/50 px-4 py-3' : 'grid auto-rows-max gap-2 pr-1'}>
    {items.map(item => (
      <button key={item.manager} type="button" onClick={() => onSelect?.(item)} className="block w-full border border-slate-200 bg-white p-3 text-left transition-colors hover:bg-slate-50" aria-label={`查看${item.manager}的待办完成明细`}>
        <div className="flex items-center justify-between gap-3">
          <span className="min-w-0 truncate text-sm font-medium text-slate-900">{item.manager}</span>
          <span className="shrink-0 text-lg font-semibold tabular-nums text-primary-700">{item.percentage}%</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden bg-slate-100" aria-label={`${item.manager}完成率 ${item.percentage}%`}>
          <div className="h-full bg-primary-600 transition-[width]" style={{ width: `${item.percentage}%` }} />
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-slate-500">
          <span>已完成 <strong className="font-semibold tabular-nums text-emerald-700">{item.completed}</strong></span>
          <span>待处理 <strong className="font-semibold tabular-nums text-amber-700">{item.pending}</strong></span>
          <span className="text-right">总计 <strong className="font-semibold tabular-nums text-slate-800">{item.total}</strong></span>
        </div>
        <div className="mt-2 text-right text-[10px] font-medium text-primary-700">查看明细</div>
      </button>
    ))}
  </div>;
}

function ManagerTodoDetailModal({ item, onClose }: { item: ManagerTodoProgress | null; onClose: () => void }) {
  if (!item) return null;
  const groups = [
    { key: 'pending', title: '待处理事项', items: item.pendingItems, tone: 'text-amber-700', empty: '暂无待处理事项' },
    { key: 'completed', title: '已完成事项', items: item.completedItems, tone: 'text-emerald-700', empty: '暂无已完成事项' },
  ];
  return <div className="fixed inset-0 z-[90] flex items-end bg-slate-950/35 sm:items-center sm:justify-center sm:p-5" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="flex max-h-[88vh] w-full min-w-0 flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl sm:max-w-[920px]">
      <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold text-slate-950">{item.manager}·待办完成明细</h2>
          <p className="mt-1 text-xs text-slate-500">已完成 {item.completed} 项，待处理 {item.pending} 项，完成率 {item.percentage}%</p>
        </div>
        <button type="button" onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="关闭明细"><X size={18} /></button>
      </div>
      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 gap-4 overflow-x-hidden overflow-y-auto p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:p-5">
        {groups.map(group => <section key={group.key} className="min-w-0 overflow-hidden">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className={`text-sm font-semibold ${group.tone}`}>{group.title}</h3>
            <span className="text-xs tabular-nums text-slate-400">{group.items.length} 项</span>
          </div>
          <div className="grid min-w-0 gap-2">
            {group.items.length === 0 ? <div className="border border-slate-200 bg-slate-50 px-3 py-8 text-center text-xs text-slate-400">{group.empty}</div> : group.items.map(detail => (
              <Link key={`${group.key}-${detail.id}`} to={detail.href} onClick={onClose} className="block w-full min-w-0 overflow-hidden border border-slate-200 bg-white p-3 hover:bg-slate-50">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">{detail.title}</div>
                  <span className="shrink-0 text-[10px] text-slate-400">{detail.type === 'project' ? '项目' : '周报'}</span>
                </div>
                <div className="mt-1.5 break-words text-xs leading-5 text-slate-600">{detail.description}</div>
                <div className="mt-2 flex items-center justify-between gap-3 border-t border-slate-100 pt-2 text-[10px] text-slate-400">
                  <span className="min-w-0 truncate">{detail.meta}</span>
                  <span className="shrink-0 text-primary-700">查看 <ArrowRight size={11} className="inline" /></span>
                </div>
              </Link>
            ))}
          </div>
        </section>)}
      </div>
      <div className="shrink-0 border-t border-slate-200 px-5 py-3 pb-[calc(.75rem+env(safe-area-inset-bottom))] text-right">
        <button type="button" onClick={onClose} className="h-9 border border-slate-200 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50">关闭</button>
      </div>
    </div>
  </div>;
}

function BatchTodoConfirm({ open, items, saving, onClose, onConfirm }: {
  open: boolean;
  items: TodoItem[];
  saving: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;
  return <div className="fixed inset-0 z-[90] flex items-end bg-slate-950/35 p-0 sm:items-center sm:justify-center sm:p-5" onMouseDown={event => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <div className="w-full border border-slate-200 bg-white shadow-2xl sm:max-w-lg">
      <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
        <div><h2 className="text-base font-semibold text-slate-950">确认本周无需更新</h2><p className="mt-1 text-xs text-slate-500">仅隐藏当前账号本周的提醒，不修改项目或周报内容。</p></div>
        <button type="button" disabled={saving} onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700"><X size={18} /></button>
      </div>
      <div className="max-h-[42vh] overflow-y-auto px-5 py-3">
        <div className="mb-2 text-xs font-medium text-slate-500">共 {items.length} 项</div>
        <div className="divide-y divide-slate-100 border-y border-slate-100">{items.map(item => <div key={item.id} className="py-2.5"><div className="truncate text-sm text-slate-900">{item.title}</div><div className="mt-1 truncate text-xs text-slate-400">{item.meta}</div></div>)}</div>
      </div>
      <div className="flex gap-3 border-t border-slate-100 px-5 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <button type="button" disabled={saving} onClick={onClose} className="h-10 flex-1 border border-slate-200 text-sm text-slate-700 disabled:opacity-50">取消</button>
        <button type="button" disabled={saving || items.length === 0} onClick={onConfirm} className="h-10 flex-1 bg-primary-700 text-sm font-medium text-white disabled:opacity-50">{saving ? '处理中…' : '确认本周无变化'}</button>
      </div>
    </div>
  </div>;
}

const workLogGapFields: Record<string, string> = {
  '净值/规模': 'navScale',
  '本周进展': 'weeklyProgress',
  '产品名称': 'productName',
  '状态': 'status',
  '客户': 'clientType',
  '负责人': 'personA',
  '预计化解时间': 'deadline',
  '后续措施': 'nextWeekPlan',
};

const projectGapFields: Record<string, string> = {
  '项目名称': 'productName',
  '项目状态': 'status',
  'A角': 'trustManager',
  '委托人': 'client',
  '规模': 'rmb',
};

const todoToneRank: Record<TodoTone, number> = {
  surface: 0,
  primary: 1,
  warning: 2,
  danger: 3,
};

function strongerTodoTone(current: TodoTone, next: TodoTone): TodoTone {
  return todoToneRank[next] > todoToneRank[current] ? next : current;
}

function buildWorkLogTodo(entry: WorkLogEntry, weekKey: string): TodoItem | null {
  const gaps = getWorkLogTodoGaps(entry, weekKey);

  // Complete records saved during this reporting week are already handled.
  // Older complete records still require an explicit weekly confirmation.
  if (gaps.length === 0 && wasUpdatedInWeek(entry.updatedAt, weekKey)) return null;

  const problem = isProblemWorkLog(entry);
  const missingCoreWeekly = gaps.includes('净值/规模') || gaps.includes('本周进展');
  const priority = (gaps.length > 0 ? 60 : 40)
    + (problem ? 18 : 0)
    + (gaps.includes('本周进展') ? 12 : 0)
    + (gaps.includes('净值/规模') ? 8 : 0)
    + Math.min(gaps.length, 4);
  const tone: TodoTone = problem
    ? 'danger'
    : gaps.length === 0
      ? 'surface'
      : gaps.length >= 4
        ? 'danger'
        : missingCoreWeekly
          ? 'warning'
          : 'primary';

  return {
    id: `worklog-${entry.id}`,
    type: 'worklog',
    title: entry.productName || '未命名周报',
    description: gaps.length > 0 ? `待补：${gaps.join('、')}` : '待确认：本周情况',
    meta: [
      entry.subCategory || entry.category || '管理周报',
      workLogOwnerText(entry) || '未分配',
    ].filter(Boolean).join(' · '),
    href: `/worklog?entryId=${encodeURIComponent(entry.id)}&weekKey=${encodeURIComponent(weekKey)}&field=${encodeURIComponent(workLogGapFields[gaps[0]] || 'weeklyProgress')}`,
    actionLabel: '周报',
    priority,
    tone,
    sourceUpdatedAt: entry.updatedAt,
  };
}

function buildProjectTodo(product: InvestmentProduct, now: Date): TodoItem | null {
  if (isHistoricalProjectStatus(product.status)) return null;
  const reasons: string[] = [];
  let priority = 0;
  let tone: TodoTone = 'surface';
  let focusField = 'status';

  const deadline = parseDate(product.deadline);
  if (deadline) {
    const daysToDeadline = dayDiff(now, deadline);
    if (daysToDeadline < 0) {
      reasons.push(`到期日已过 ${Math.abs(daysToDeadline)} 天`);
      priority = Math.max(priority, 96);
      tone = 'danger';
      focusField = 'deadline';
    } else if (daysToDeadline <= 7) {
      reasons.push(`${daysToDeadline} 天后到期`);
      priority = Math.max(priority, 90);
      tone = 'danger';
      focusField = 'deadline';
    } else if (daysToDeadline <= 30) {
      reasons.push(`${daysToDeadline} 天后到期`);
      priority = Math.max(priority, 72);
      tone = strongerTodoTone(tone, 'warning');
      focusField = 'deadline';
    }
  }

  const gaps = getProjectInfoGaps(product);
  if (gaps.length > 0) {
    reasons.push(`待补：${gaps.join('、')}`);
    priority = Math.max(priority, 58 + Math.min(gaps.length, 4));
    tone = strongerTodoTone(tone, 'warning');
    if (focusField === 'status') focusField = projectGapFields[gaps[0]] || 'status';
  }

  const staleDays = daysSince(product.updatedAt, now);
  const progressing = !isEstablished(product);
  if (progressing && staleDays !== null && staleDays >= 14) {
    reasons.push(`${staleDays} 天未更新`);
    priority = Math.max(priority, 52 + Math.min(staleDays, 30));
    tone = strongerTodoTone(tone, 'primary');
  }

  if (reasons.length === 0) return null;

  return {
    id: `project-${product.id}`,
    type: 'project',
    title: product.productName || '未命名项目',
    description: uniqueLabels(reasons).join('；'),
    meta: [
      product.status || '未填写状态',
      product.trustManager || '未分配',
    ].filter(Boolean).join(' · '),
    href: `/projects?projectId=${encodeURIComponent(product.id)}&field=${encodeURIComponent(focusField)}`,
    actionLabel: '项目',
    priority,
    tone,
    sourceUpdatedAt: product.updatedAt,
  };
}

function formatMonthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function addMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

interface DashboardChartItem {
  key: string;
  label: string;
  count: number;
}

interface DashboardProjectSummary {
  usd: number;
  rmb: number;
  annualIncome: number;
  thisYearIncome: number;
  performanceIncome: number;
}

interface DashboardProjectChart {
  key: string;
  title: string;
  subtitle: string;
  total: number;
  missing: number;
  summary: DashboardProjectSummary;
  items: DashboardChartItem[];
}

function summarizeProjects(products: InvestmentProduct[]): DashboardProjectSummary {
  const sum = (field: keyof DashboardProjectSummary) => products.reduce((total, product) => {
    const value = Number(product[field]);
    return Number.isFinite(value) ? total + value : total;
  }, 0);

  return {
    usd: sum('usd'),
    rmb: sum('rmb'),
    annualIncome: sum('annualIncome'),
    thisYearIncome: sum('thisYearIncome'),
    performanceIncome: sum('performanceIncome'),
  };
}

function formatSummaryAmount(value: number, currency: '美元' | '元') {
  const amount = Number.isFinite(value) ? value : 0;
  const useHundredMillion = Math.abs(amount) >= 10_000;
  const scaled = useHundredMillion ? amount / 10_000 : amount;
  const formatted = new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: Math.abs(scaled) >= 100 ? 0 : 2,
  }).format(scaled);
  return `${formatted}${useHundredMillion ? `亿${currency}` : `万${currency}`}`;
}

function buildMonthlyProjectChart(
  products: InvestmentProduct[],
  options: {
    key: string;
    title: string;
    subtitle: string;
    dateField: 'projectCreatedDate' | 'establishDate' | 'projectStoppedDate';
    predicate?: (product: InvestmentProduct) => boolean;
  },
): DashboardProjectChart {
  const now = new Date();
  const months = Array.from({ length: 12 }, (_, index) => {
    const date = addMonths(new Date(now.getFullYear(), now.getMonth(), 1), index - 11);
    return {
      key: formatMonthKey(date),
      label: date.getMonth() === 0 ? `${String(date.getFullYear()).slice(-2)}年1月` : `${date.getMonth() + 1}月`,
      count: 0,
    };
  });
  const monthIndex = new Map(months.map((month, index) => [month.key, index]));
  const scopedProducts = options.predicate ? products.filter(options.predicate) : products;
  let missing = 0;

  scopedProducts.forEach(product => {
    const rawDate = options.dateField === 'projectCreatedDate'
      ? product.projectCreatedDate || product.progressStartDate
      : product[options.dateField];
    const date = parseDate(rawDate);
    if (!date) {
      missing += 1;
      return;
    }
    const index = monthIndex.get(formatMonthKey(date));
    if (index !== undefined) months[index].count += 1;
  });

  return {
    key: options.key,
    title: options.title,
    subtitle: options.subtitle,
    total: scopedProducts.length,
    missing,
    summary: summarizeProjects(scopedProducts),
    items: months,
  };
}

function buildProgressDurationChart(products: InvestmentProduct[]): DashboardProjectChart {
  const now = new Date();
  const progressingProducts = products.filter(isProgressing);
  const items: DashboardChartItem[] = [
    { key: 'within-30', label: '30天内', count: 0 },
    { key: '31-60', label: '31–60天', count: 0 },
    { key: '61-90', label: '61–90天', count: 0 },
    { key: 'over-90', label: '90天以上', count: 0 },
  ];
  let missing = 0;

  progressingProducts.forEach(product => {
    const startedAt = parseDate(product.projectCreatedDate || product.progressStartDate);
    if (!startedAt) {
      missing += 1;
      return;
    }
    const days = Math.max(0, dayDiff(startedAt, now));
    if (days <= 30) items[0].count += 1;
    else if (days <= 60) items[1].count += 1;
    else if (days <= 90) items[2].count += 1;
    else items[3].count += 1;
  });

  return {
    key: 'progressing',
    title: '推进中',
    subtitle: '按项目创建日至今天的停留时长统计',
    total: progressingProducts.length,
    missing,
    summary: summarizeProjects(progressingProducts),
    items,
  };
}

function buildProjectCharts(products: InvestmentProduct[]): DashboardProjectChart[] {
  return [
    buildMonthlyProjectChart(products, {
      key: 'all',
      title: '所有项目',
      subtitle: '按项目创建日统计近12个月每月新增量',
      dateField: 'projectCreatedDate',
    }),
    buildProgressDurationChart(products),
    buildMonthlyProjectChart(products, {
      key: 'established',
      title: '已成立/落地',
      subtitle: '按成立/落地日统计近12个月每月落地数量',
      dateField: 'establishDate',
      predicate: isEstablished,
    }),
    buildMonthlyProjectChart(products, {
      key: 'stopped',
      title: '已中止',
      subtitle: '按项目中止日统计近12个月每月中止数量',
      dateField: 'projectStoppedDate',
      predicate: isStopped,
    }),
  ];
}

const EMPTY_PROJECT_CHART: DashboardProjectChart = {
  key: 'empty',
  title: '项目概览',
  subtitle: '',
  total: 0,
  missing: 0,
  summary: { usd: 0, rmb: 0, annualIncome: 0, thisYearIncome: 0, performanceIncome: 0 },
  items: [],
};

function formatShortDate(value?: string) {
  const date = parseDate(value);
  if (!date) return '未记录';
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatLastEditedTime(value?: string) {
  const date = parseDate(value);
  if (!date) return '未记录';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const GREETING_TEMPLATES = {
  morning: [
    '早上好，{name}。',
    '新的一天开始了，{name}。',
    '早安，{name}。',
  ],
  noon: [
    '中午好，{name}。',
    '午间好，{name}。',
    '忙到半程了，{name}。',
  ],
  afternoon: [
    '下午好，{name}。',
    '继续推进，{name}。',
    '今天的进度还不错，{name}。',
  ],
  evening: [
    '晚上好，{name}。',
    '今天辛苦了，{name}。',
    '收个尾吧，{name}。',
  ],
};

const WORK_STATE_RANKS = [
  { rank: '大吉', weight: 15 },
  { rank: '中吉', weight: 30 },
  { rank: '小吉', weight: 25 },
  { rank: '平', weight: 20 },
  { rank: '末吉', weight: 10 },
] as const;

const WORK_STATE_THEMES_BY_WEEKDAY = {
  1: [
    {
      title: '本周定调日',
      message: '今天适合先把本周最重要的三件事排出来。',
      actions: [
        '先看本周待填写和重点项目，把需要外部反馈的事项尽早发出。',
        '给每条主线写一句本周目标，避免一开周就被临时事项带跑。',
        '先确认上会、材料、客户沟通和周报节点，再安排当天动作。',
        '把本周必须闭环的事项标出来，其他事项放进可调整清单。',
        '从风险最高或依赖最多的项目开始，先把卡点暴露出来。',
      ],
    },
    {
      title: '优先级排序日',
      message: '今天适合把事情分出先后，不急着同时开跑。',
      actions: [
        '按重要、紧急、依赖三类重新排一次项目顺序。',
        '先处理会影响他人排期的事项，再处理只影响自己的事项。',
        '把今天只需十分钟能推进的事情先清掉，给重点事项腾出整块时间。',
        '给每个待推进项目写一个下一步动作，不让任务停在标题上。',
        '把可以延后的信息收集放到下午，上午先做判断类工作。',
      ],
    },
    {
      title: '节点确认日',
      message: '今天适合检查本周的时间点是否清楚。',
      actions: [
        '核对本周材料提交、反馈截止和内部确认时间。',
        '把未明确截止时间的事项补上日期，减少后续反复确认。',
        '先问清楚需要谁拍板，再准备对应材料。',
        '检查周报里本周预计动作是否和实际排期一致。',
        '把需要提前预约沟通的事项今天发出邀请。',
      ],
    },
    {
      title: '清单搭建日',
      message: '今天适合把本周工作拆成可执行清单。',
      actions: [
        '把大任务拆成三步以内的小动作，先做第一步。',
        '按项目列出本周输入、输出和等待对象。',
        '把周报待补项、项目进度和资料归档放进同一张清单。',
        '标出今天必须完成、今天只需启动、今天可以不碰的事项。',
        '把重复检查项固定下来，后面几天照着走就好。',
      ],
    },
    {
      title: '风险预判日',
      message: '今天适合先看潜在卡点，提前留出处理空间。',
      actions: [
        '优先查看材料缺口、外部反馈、审批节点和数据口径。',
        '把可能拖慢进度的项目单独标记，先发一轮确认。',
        '对状态不明的项目先补一句客观描述，避免周中再追溯。',
        '检查是否有临近上会或披露节点的事项需要提前准备。',
        '把风险点写成一句话，方便后续同步时直接使用。',
      ],
    },
    {
      title: '沟通发起日',
      message: '今天适合把本周需要别人配合的事情先抛出去。',
      actions: [
        '把需要客户、同事或机构反馈的事项上午先发出去。',
        '对久未反馈的事项补一条简短提醒，明确需要对方确认什么。',
        '先发问题清单，再开始整理材料，避免方向偏掉。',
        '把跨部门事项拆成对方能直接回复的几个问题。',
        '给关键事项留出回复窗口，下午再根据反馈调整安排。',
      ],
    },
    {
      title: '资料起稿日',
      message: '今天适合先搭材料框架，不追求一次写完。',
      actions: [
        '先把材料目录和需要补的数据列出来。',
        '把已有信息填进框架，空缺位置直接标注来源和负责人。',
        '先完成结论、背景、下一步三段，再补细节。',
        '把上周遗留材料复制一版做更新底稿，减少从零开始。',
        '对暂不确定的数据先留口径说明，后面再统一校准。',
      ],
    },
    {
      title: '轻量启动日',
      message: '今天适合稳稳开局，不急着把所有线都铺开。',
      actions: [
        '先处理确定性最高的事项，再确认本周上会、材料和周报节点。',
        '把需要深度判断的工作留给精力更集中的时段。',
        '先完成一个可闭环的小任务，给本周建立一点推进感。',
        '把临时消息归类，不要立刻打断原本的重点安排。',
        '给今天保留一段缓冲时间，专门处理周一冒出来的新情况。',
      ],
    },
    {
      title: '项目盘点日',
      message: '今天适合快速扫一遍项目状态，找出本周重点。',
      actions: [
        '从最近编辑项目开始看，确认是否还有未记录的进展。',
        '把已成立、待推进、需补材料的项目分开处理。',
        '优先关注状态变化但周报尚未更新的项目。',
        '检查项目经理、状态和本周进展是否对应得上。',
        '把本周真正需要盯住的项目控制在少数几项。',
      ],
    },
    {
      title: '节奏校准日',
      message: '今天适合给一周定一个舒服但清晰的节奏。',
      actions: [
        '上午做判断和发起，下午做整理和补录。',
        '先把最容易拖延的事项安排到今天，不给它滚到周五。',
        '把每日需要看一眼的数据和项目固定下来。',
        '给本周留出一个复盘窗口，避免周五临时收尾。',
        '把今天的重点控制在一到两件，完成度会更高。',
      ],
    },
  ],
  2: [
    {
      title: '关键推进日',
      message: '今天适合把最重要的一件事往前推一格。',
      actions: [
        '优先处理需要他人反馈、跨部门确认或材料补充的事项。',
        '把昨天定下的重点项目先推进到可见状态。',
        '对卡住的事项直接写清卡点和需要谁协助。',
        '先做能改变项目状态的动作，再做记录整理。',
        '把推进结果同步到周报，避免周末再回忆。',
      ],
    },
    {
      title: '反馈追踪日',
      message: '今天适合盯住已经发出去的沟通和确认。',
      actions: [
        '检查昨天发出的确认事项，按优先级补一次提醒。',
        '把等待反馈的事项拆成已回复、未回复、需转问三类。',
        '对关键节点给出明确回复期限，减少开放式等待。',
        '把收到的反馈立即落到项目记录或材料备注里。',
        '对反复未回复的事项准备一个替代推进方案。',
      ],
    },
    {
      title: '材料推进日',
      message: '今天适合把材料从框架推进到可讨论版本。',
      actions: [
        '先补齐影响判断的数据和事实，再调整措辞。',
        '把空白处改成明确问题，发给对应人员确认。',
        '检查材料里的时间、金额、费率和项目名称是否一致。',
        '先形成一版可以内部看的草稿，不等到全部完美。',
        '把需要领导判断的地方单独列出来，避免埋在正文里。',
      ],
    },
    {
      title: '进度加速日',
      message: '今天适合集中推进，不让事情停在等待状态。',
      actions: [
        '逐个检查待推进项目，给每个项目补上一句明确的下一步。',
        '先做会带来后续连锁反应的动作，比如发函、约会、确认口径。',
        '把能当天闭环的事项安排在上午集中处理。',
        '对长期悬而未决的事项，今天至少确定一个处理路径。',
        '把推进动作写成可追踪记录，方便后续复盘。',
      ],
    },
    {
      title: '数据补齐日',
      message: '今天适合把项目数据和周报字段补完整。',
      actions: [
        '优先补净值、规模、费率和状态这类后续会反复用到的数据。',
        '检查数据来源是否一致，不确定的地方先标记。',
        '把缺失字段集中处理，不要在多个页面来回跳。',
        '把新拿到的数据顺手写入本周进展，减少重复录入。',
        '对异常数据先记录疑点，再找来源核对。',
      ],
    },
    {
      title: '卡点拆解日',
      message: '今天适合把复杂问题拆小，先找到能动的一步。',
      actions: [
        '把卡点写成原因、影响、下一步三句话。',
        '如果事项太大，先拆出一个今天能完成的确认动作。',
        '对需要多人参与的问题，先确认谁能给最终口径。',
        '把暂时无解的部分标出前置条件，不让它占用全部注意力。',
        '从最容易获得反馈的人开始推进，先打开缺口。',
      ],
    },
    {
      title: '内部对齐日',
      message: '今天适合把内部口径先对齐，再向外推进。',
      actions: [
        '先确认项目状态、材料方向和对外说法是否一致。',
        '把同一事项的不同版本收拢成一版主口径。',
        '对需要审批或上会的事项，先确认内部意见。',
        '把分歧点列出来，避免在正式材料里反复修改。',
        '把内部确认结果写进项目备注，方便后续接续。',
      ],
    },
    {
      title: '客户回应日',
      message: '今天适合处理对外回应和客户关切。',
      actions: [
        '先回应对方最关心的结论，再补背景和细节。',
        '把客户问题分成可直接回答和需要内部确认两类。',
        '对暂不能确认的事项给出下一次反馈时间。',
        '把对外沟通结果同步到项目进度，形成记录。',
        '检查用词是否稳妥，避免给出超出当前阶段的承诺。',
      ],
    },
    {
      title: '流程推进日',
      message: '今天适合把流程节点往前送一站。',
      actions: [
        '检查审批、用印、材料流转和归档是否有待办节点。',
        '先处理卡在自己手上的流程，不让它继续等待。',
        '把需要补件的流程列清楚，一次性向对方要齐。',
        '对流程状态不明的事项，先查清当前节点和责任人。',
        '完成一个节点后立刻记录下一节点，避免断档。',
      ],
    },
    {
      title: '深水工作日',
      message: '今天适合留出整块时间处理需要判断的事项。',
      actions: [
        '把消息处理集中到固定时段，给复杂材料留出连续时间。',
        '先完成需要思考的部分，再处理机械整理。',
        '对重点项目做一次从背景到下一步的完整梳理。',
        '把判断依据写在材料旁边，方便后续解释。',
        '今天少开新线，优先把关键线推深一点。',
      ],
    },
  ],
  3: [
    {
      title: '协同确认日',
      message: '今天适合处理沟通、确认和对齐。',
      actions: [
        '把需要同事、客户或机构确认的内容列清楚，逐项推进。',
        '先确认事项归属，再确认具体动作，避免多人都以为别人会做。',
        '把沟通结果落成文字，减少后续口径偏差。',
        '对需要多人参与的事项，给出一个最小可执行安排。',
        '把今天确认过的结论同步到周报和项目记录。',
      ],
    },
    {
      title: '信息收拢日',
      message: '今天不用开太多新线，把散落信息收回来就很好。',
      actions: [
        '补齐项目进度、净值规模和待跟进对象，减少后续返工。',
        '把邮件、聊天和材料里的关键信息归到同一个项目下。',
        '先整理本周已发生变化的项目，再处理静态项目。',
        '对来源不一致的信息先标疑点，不急着合并。',
        '把收拢后的结论写成一段可以直接放进周报的话。',
      ],
    },
    {
      title: '中段校正日',
      message: '今天适合检查本周方向是否还对。',
      actions: [
        '对照周一计划，看哪些事项已经偏离原节奏。',
        '把本周无法完成的事项提前调整，不等周五才发现。',
        '确认重点项目是否仍然是重点，必要时重新排序。',
        '把已经完成的事项划掉，给剩余事项留出清晰空间。',
        '检查是否有新增临时事项需要进入本周周报。',
      ],
    },
    {
      title: '口径统一日',
      message: '今天适合统一项目描述、数据口径和对外说法。',
      actions: [
        '检查同一项目在不同材料里的名称、状态和数字是否一致。',
        '把不确定口径先列成问题，发给对应人员确认。',
        '对外使用前先核对内部版本，避免新旧说法混用。',
        '把最终口径写入项目备注，后续直接沿用。',
        '对涉及费用、期限、规模的描述多看一遍。',
      ],
    },
    {
      title: '问题澄清日',
      message: '今天适合把模糊的问题问清楚。',
      actions: [
        '把模糊表述改成具体问题，比如缺什么、谁确认、何时反馈。',
        '对复杂事项先问结论，再补事实依据。',
        '把自己无法判断的点列出来，不在材料里含糊带过。',
        '对已经问过但未解决的问题，换成更具体的提问方式。',
        '澄清后马上更新记录，避免同一个问题重复问。',
      ],
    },
    {
      title: '节奏缓冲日',
      message: '今天适合留一点空间处理周中冒出的变化。',
      actions: [
        '把计划外事项先分级，不让所有变化都变成紧急。',
        '保留一段缓冲时间给临时反馈和突发材料。',
        '先守住本周必须完成的主线，再处理可选事项。',
        '对临时插入事项写清来源和要求，方便后续追踪。',
        '今天不追求铺开，重点是让已有事项不断线。',
      ],
    },
    {
      title: '数据核验日',
      message: '今天适合核验数据，不让小差错留到后面。',
      actions: [
        '优先检查净值、规模、费率、日期和状态字段。',
        '把异常值单独列出，先找来源再改结论。',
        '核对项目列表和周报里的数据是否一致。',
        '对手动录入的数据多做一次交叉检查。',
        '把确认过的数据标记为可沿用，减少重复核验。',
      ],
    },
    {
      title: '跨部门推动日',
      message: '今天适合把需要协同的事项往前推。',
      actions: [
        '先写清楚对方需要提供什么，而不是笼统催进度。',
        '对多个部门参与的事项，明确当前主责人和下一动作。',
        '把前置材料准备好再发起沟通，提高回复效率。',
        '对重要协同事项给出时间建议，减少来回约时间。',
        '同步时附上背景和当前状态，让对方能快速接上。',
      ],
    },
    {
      title: '材料回看日',
      message: '今天适合回看已经写过的材料，补掉薄弱处。',
      actions: [
        '先看结论是否清楚，再看细节是否完整。',
        '把缺依据的判断补上事实或来源。',
        '删除重复表述，让材料更容易被快速阅读。',
        '把下一步安排写具体，避免只写继续推进。',
        '对重要材料换一个视角读一遍，检查是否有遗漏。',
      ],
    },
    {
      title: '周中稳态日',
      message: '今天适合稳住当前节奏，不让任务堆积。',
      actions: [
        '先清掉两到三个小尾巴，降低周四周五压力。',
        '把已完成但未记录的事项补进系统。',
        '对还没启动的本周任务做一次取舍。',
        '把今天新增的信息及时归档，不留在聊天记录里。',
        '用一段时间专门处理待确认事项，避免零散打断。',
      ],
    },
  ],
  4: [
    {
      title: '周报补全日',
      message: '今天适合查漏补缺，尤其是管理周报里的空项。',
      actions: [
        '从本周待填写开始，先补净值/规模，再补本周进展。',
        '优先处理即将影响周报完整性的项目空项。',
        '把本周没有明显进展的项目也写清当前状态。',
        '检查负责人、分类、状态和进展是否能对应上。',
        '补完一项就回看一遍，避免字段填了但内容不完整。',
      ],
    },
    {
      title: '材料校准日',
      message: '今天适合把材料里的口径、数据和下一步动作校准一遍。',
      actions: [
        '检查项目状态、费用率、成立进度和周报描述是否一致。',
        '把材料中的数字和项目列表重新对一次。',
        '对有歧义的表述改成客观可验证的说法。',
        '确认材料版本和更新时间，避免沿用旧稿。',
        '把待确认口径集中发出，不要零散追问。',
      ],
    },
    {
      title: '空项清理日',
      message: '今天适合专门处理那些一直留白的小字段。',
      actions: [
        '按字段缺失程度排序，先补影响统计和展示的字段。',
        '对暂时拿不到的信息写明待确认对象和时间。',
        '把同类空项批量处理，减少页面切换。',
        '优先清理本周会被查看或导出的记录。',
        '补完后看一眼列表展示，确认信息能正常露出。',
      ],
    },
    {
      title: '事实核对日',
      message: '今天适合慢一点，把关键事实核准。',
      actions: [
        '核对项目名称、客户、日期、规模和状态这类基础事实。',
        '对来自不同渠道的信息做一次来源确认。',
        '把不确定的事实从结论里拆出来，单独标注待核。',
        '检查历史记录是否与本周新进展冲突。',
        '对重要事实留一条备注，方便以后回查。',
      ],
    },
    {
      title: '表达精炼日',
      message: '今天适合把周报和材料写得更清楚。',
      actions: [
        '把长句拆短，让进展、问题、下一步各自独立。',
        '少写过程，多写当前状态和下一动作。',
        '把继续推进改成具体要推进什么。',
        '删除重复背景，把重点留给本周变化。',
        '把需要领导关注的点放在更靠前的位置。',
      ],
    },
    {
      title: '待办闭环日',
      message: '今天适合把可闭环的小事项集中处理掉。',
      actions: [
        '先做十分钟内能完成的待办，快速减少清单噪音。',
        '对无法闭环的事项补上下一责任人和时间点。',
        '把已经完成但未反馈的事项发出简短同步。',
        '检查是否有流程卡在自己手上，优先处理。',
        '今天把小尾巴收一轮，给周五留出复盘空间。',
      ],
    },
    {
      title: '状态同步日',
      message: '今天适合让项目状态和真实进度保持一致。',
      actions: [
        '把已经发生变化的项目状态及时更新。',
        '检查待推进项目是否仍然待推进，已完成的不要继续挂着。',
        '对状态不清的项目先写当前判断和待确认点。',
        '同步状态时顺手补一条本周进展。',
        '把状态变化较大的项目放进今日重点回看。',
      ],
    },
    {
      title: '上会准备日',
      message: '今天适合为会议、汇报或审批提前做准备。',
      actions: [
        '先确认会议需要的结论、材料和补充数据。',
        '把可能被问到的问题列出来，提前准备口径。',
        '检查材料版本、附件和数据来源是否齐全。',
        '把会议前需要别人确认的事项今天先发出去。',
        '对无法确认的点准备备选说法，不临场处理。',
      ],
    },
    {
      title: '记录修补日',
      message: '今天适合把本周发生但没写下来的事情补回来。',
      actions: [
        '从聊天、邮件和会议纪要里回收遗漏进展。',
        '把口头确认转成文字记录，方便周报引用。',
        '对重要节点补上日期和参与方。',
        '检查上周遗留事项本周是否已有变化。',
        '把修补后的记录读一遍，确认别人也能看懂。',
      ],
    },
    {
      title: '质量检查日',
      message: '今天适合做一次提交前的质量检查。',
      actions: [
        '按数据、文字、状态、附件四类检查一轮。',
        '先看是否完整，再看是否好看，不反过来。',
        '对所有复制过来的内容检查是否还带着旧信息。',
        '把关键页面刷新一次，确认展示结果符合预期。',
        '留下一个简短检查结论，明天收尾时能直接接上。',
      ],
    },
  ],
  5: [
    {
      title: '收尾复盘日',
      message: '今天适合做收尾、复盘和材料归档。',
      actions: [
        '把已完成事项写清楚，把下一步动作拆成可执行的一句话。',
        '先收本周主线，再处理零散补充。',
        '把本周没有完成的原因写清楚，避免下周继续模糊。',
        '对完成事项补上结果和影响，不只写已处理。',
        '把下周要接续的动作放到记录末尾。',
      ],
    },
    {
      title: '归档整理日',
      message: '今天适合把本周材料和记录放回正确位置。',
      actions: [
        '按项目归档材料，避免只放在下载或临时文件夹里。',
        '把最终版、过程版和待确认版区分清楚。',
        '对重要材料补上日期和版本说明。',
        '清理重复文件，只保留后续会用到的版本。',
        '把归档位置写进项目备注，方便下周查找。',
      ],
    },
    {
      title: '下周铺垫日',
      message: '今天适合给下周留一个清楚的入口。',
      actions: [
        '为下周每个重点项目写一句第一动作。',
        '把需要下周一发起的沟通提前准备好草稿。',
        '列出下周必须确认的节点和对象。',
        '把未完成事项按优先级排好，不让下周重新想一遍。',
        '对需要等待的事项标出预计反馈时间。',
      ],
    },
    {
      title: '成果确认日',
      message: '今天适合确认本周到底推进了什么。',
      actions: [
        '把本周完成的节点从过程描述里提炼出来。',
        '检查项目状态是否体现了本周成果。',
        '对已完成事项发一条必要同步，让相关人知道结果。',
        '把没有形成结果的努力转成下周行动。',
        '把成果描述写得具体一点，便于后续复盘。',
      ],
    },
    {
      title: '尾项清理日',
      message: '今天适合处理那些不大但容易拖到下周的尾项。',
      actions: [
        '先清理待回复、待补录、待归档三类小事项。',
        '对无法当天处理的尾项给出明确下周时间。',
        '把已经没有意义的待办删掉或归档。',
        '检查是否还有周报字段没有补齐。',
        '收尾时只保留真正需要下周继续看的事项。',
      ],
    },
    {
      title: '周报定稿日',
      message: '今天适合把周报从可用调整到清楚。',
      actions: [
        '先确认所有重点项目都有本周进展。',
        '把重复或过长的表述压缩成清晰短句。',
        '对问题项目写清问题、原因和下一步。',
        '检查直销、问题项目和普通项目的信息格式是否对应。',
        '定稿前按项目列表快速扫一遍，避免漏项。',
      ],
    },
    {
      title: '风险交接日',
      message: '今天适合把风险和未决事项交代清楚。',
      actions: [
        '把未决事项写成当前状态、风险点、下一步三段。',
        '对需要持续关注的项目标出触发条件。',
        '把等待外部反馈的事项列出对象和时间。',
        '对本周未解决的问题说明原因，不只写待推进。',
        '让下周接续的人能一眼看懂现在卡在哪里。',
      ],
    },
    {
      title: '轻量复盘日',
      message: '今天适合做一次不沉重的小复盘。',
      actions: [
        '写下本周最有效的一次推进动作，下周继续复用。',
        '找出一个反复返工的点，给下周加一个检查动作。',
        '把本周临时事项归类，看看是否需要调整流程。',
        '记录一个下周可以提前准备的事项。',
        '复盘只写三条，保持轻量但有用。',
      ],
    },
    {
      title: '沟通收口日',
      message: '今天适合给本周沟通做一个收口。',
      actions: [
        '把关键沟通结果同步给相关人员。',
        '对还没回复的事项发一条温和但明确的跟进。',
        '把口头说过的重要结论补成文字。',
        '确认下周还需要继续沟通的对象和主题。',
        '把沟通结论写进项目进度，不只留在聊天里。',
      ],
    },
    {
      title: '节奏归档日',
      message: '今天适合把本周临时事项归位，不把尾巴留到下周。',
      actions: [
        '收拢本周项目记录，给未完成事项标出负责人和下一次跟进时间。',
        '把临时插入但已经完成的事项归档，不让它继续占用视线。',
        '检查今天结束后是否还有必须提醒自己的事项。',
        '把下周一第一件事写清楚，周末就不用惦记。',
        '如果本周已经够满，今天优先收束，不再开新线。',
      ],
    },
  ],
  weekend: [
    {
      title: '节奏保持日',
      message: '今天不用开太多新线，稳住当前节奏就很好。',
      actions: [
        '只处理可当天闭环的小任务，给下一个工作日留出清晰入口。',
        '如果只是查看状态，看到重点就可以停，不必把清单全部翻完。',
        '把临时想到的工作记下来，留到工作日再正式处理。',
        '只补最明显的遗漏，不做大范围调整。',
        '给下一个工作日留一句提醒，今天就收住。',
      ],
    },
  ],
} as const;

type WorkStateRank = (typeof WORK_STATE_RANKS)[number]['rank'];

type WorkStateTheme = {
  title: string;
  message: string;
  actions: readonly string[];
};

type WorkStateFortune = {
  rank: WorkStateRank;
  title: string;
  message: string;
  action: string;
};

type BeijingDay = {
  dateKey: string;
  weekday: number;
  weekdayLabel: string;
};

type WorkStateDraw = WorkStateFortune & BeijingDay;

const WORK_STATE_STORAGE_PREFIX = 'dashboard.workStateFortune';

function getBeijingDay(date = new Date()): BeijingDay {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(date);
  const value = (type: string) => parts.find(part => part.type === type)?.value || '';
  const weekdayMap: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 0,
  };
  const weekday = weekdayMap[value('weekday')] ?? 0;
  return {
    dateKey: `${value('year')}-${value('month')}-${value('day')}`,
    weekday,
    weekdayLabel: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][weekday] || '今日',
  };
}

function getWorkStateStorageKey(userId?: string) {
  return `${WORK_STATE_STORAGE_PREFIX}.${userId || 'anonymous'}`;
}

function getWorkStatePool(weekday: number): readonly WorkStateTheme[] {
  if (weekday >= 1 && weekday <= 5) {
    return WORK_STATE_THEMES_BY_WEEKDAY[weekday as 1 | 2 | 3 | 4 | 5];
  }
  return WORK_STATE_THEMES_BY_WEEKDAY.weekend;
}

function drawWeightedRank(): WorkStateRank {
  const totalWeight = WORK_STATE_RANKS.reduce((sum, item) => sum + item.weight, 0);
  let cursor = Math.random() * totalWeight;
  for (const item of WORK_STATE_RANKS) {
    cursor -= item.weight;
    if (cursor <= 0) return item.rank;
  }
  return WORK_STATE_RANKS[0].rank;
}

function drawWorkStateFortune(day: BeijingDay): WorkStateDraw {
  const pool = getWorkStatePool(day.weekday);
  const theme = pool[Math.floor(Math.random() * pool.length)];
  const action = theme.actions[Math.floor(Math.random() * theme.actions.length)];
  return {
    rank: drawWeightedRank(),
    title: theme.title,
    message: theme.message,
    action,
    ...day,
  };
}

function readStoredWorkState(storageKey: string, dateKey: string): WorkStateDraw | null {
  if (typeof window === 'undefined') return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) || 'null') as WorkStateDraw | null;
    return parsed?.dateKey === dateKey ? parsed : null;
  } catch {
    return null;
  }
}

function saveStoredWorkState(storageKey: string, draw: WorkStateDraw) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(storageKey, JSON.stringify(draw));
}

function getGreetingTemplates(date = new Date()) {
  const hour = date.getHours();
  if (hour >= 5 && hour < 11) return GREETING_TEMPLATES.morning;
  if (hour >= 11 && hour < 14) return GREETING_TEMPLATES.noon;
  if (hour >= 14 && hour < 18) return GREETING_TEMPLATES.afternoon;
  return GREETING_TEMPLATES.evening;
}

function MobileDashboard({
  greetingTitle,
  userId,
  managerName,
  weekRange,
  todoItems,
  pending,
  established,
  taskSummary,
  onDrawWorkState,
  onSnooze,
  snoozingTodoIds,
  bulkMode,
  selectedTodoIds,
  onToggleBulkMode,
  onToggleTodo,
  onToggleAll,
  onRequestBatch,
  managerTodoProgress,
  onSelectManager,
}: {
  greetingTitle: string;
  userId: string;
  managerName: string;
  weekRange: { start: string; end: string };
  todoItems: TodoItem[];
  pending: number;
  established: number;
  taskSummary: { active: number; overdue: number };
  onDrawWorkState: () => void;
  onSnooze: (item: TodoItem) => void;
  snoozingTodoIds: Set<string>;
  bulkMode: boolean;
  selectedTodoIds: Set<string>;
  onToggleBulkMode: () => void;
  onToggleTodo: (id: string) => void;
  onToggleAll: (ids: string[]) => void;
  onRequestBatch: () => void;
  managerTodoProgress?: ManagerTodoProgress[];
  onSelectManager: (item: ManagerTodoProgress) => void;
}) {
  const displayedTodos = todoItems.slice(0, 5);

  return <MobilePageShell className="mobile-workbench">
    <MobileHero
      eyebrow="GCO Link"
      title={greetingTitle}
      description={<><Clock3 size={13} />{weekRange.start} - {weekRange.end}</>}
      action={<UserProfileAvatar userId={userId} displayName={managerName || userId} className="mobile-workbench__avatar" />}
      footer={<button type="button" className="mobile-hero-search" onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))}><Search size={16} />搜索项目、任务和周报</button>}
    />

    <div className="mobile-page-shell__content">
      <MobileMetricGrid items={[
        { label: '未读消息', value: taskSummary.active, to: '/tasks' },
        { label: '推进中项目', value: pending, to: '/projects' },
        { label: '已成立项目', value: established, to: '/projects' },
      ]} />

      <MobileSection
        title={managerTodoProgress ? '经理待办完成情况' : '本周待办'}
        description={managerTodoProgress ? '按完成率从低到高排列' : '需要补充或确认的事项'}
        action={!managerTodoProgress && displayedTodos.length > 0 ? <button type="button" onClick={onToggleBulkMode} className="mobile-text-action">{bulkMode ? '退出' : '全部'}</button> : undefined}
      >
        {managerTodoProgress ? <ManagerTodoProgressList items={managerTodoProgress} mobile onSelect={onSelectManager} /> : <>{displayedTodos.length === 0 ? <MobileEmptyState icon={<CheckCircle2 size={24} />}>本周待办已清空</MobileEmptyState> : <div>{displayedTodos.map(item => {
          const content = <div className="mobile-todo-row"><span className="mobile-todo-row__check" /><span className="mobile-todo-row__copy"><strong>{item.title}</strong><span>{item.description}</span></span><span className={item.tone === 'danger' ? 'is-urgent' : ''}>{item.meta || item.actionLabel}</span></div>;
          return <MobileListRow key={item.id} selected={selectedTodoIds.has(item.id)}>{bulkMode ? <button type="button" onClick={() => onToggleTodo(item.id)} className="flex w-full items-start gap-3 text-left"><span className="mt-0.5 shrink-0 text-primary-700">{selectedTodoIds.has(item.id) ? <CheckSquare2 size={19} /> : <Square size={19} />}</span><span className="min-w-0 flex-1">{content}</span></button> : <><Link to={item.href} className="block">{content}</Link><div className="mt-2 flex justify-end"><button type="button" disabled={snoozingTodoIds.has(item.id)} onClick={() => onSnooze(item)} className="mobile-row-action">{snoozingTodoIds.has(item.id) ? '设置中…' : '本周无改动'}</button></div></>}</MobileListRow>;
        })}{bulkMode && <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] flex items-center gap-2 bg-white px-4 py-3 shadow-[0_-8px_20px_rgba(15,23,42,.08)]"><button type="button" onClick={() => onToggleAll(displayedTodos.map(item => item.id))} className="h-9 border border-slate-200 px-3 text-xs text-slate-700">{displayedTodos.every(item => selectedTodoIds.has(item.id)) ? '取消全选' : '全选当前'}</button><button type="button" disabled={selectedTodoIds.size === 0} onClick={onRequestBatch} className="h-9 flex-1 bg-primary-700 px-3 text-xs font-medium text-white disabled:opacity-40">本周无需更新（{selectedTodoIds.size}）</button></div>}</div>}</>}
      </MobileSection>

      <button type="button" onClick={onDrawWorkState} className="mobile-work-sign"><span><strong>今日工作签</strong><small>先完成临期事项，再处理集中反馈</small></span><span className="mobile-work-sign__icon"><ScrollText size={20} /></span></button>
    </div>
  </MobilePageShell>;
}

export default function Dashboard() {
  const { products, fetchProducts } = useProjectStore(useShallow(state => ({
    products: state.products,
    fetchProducts: state.fetchProducts,
  })));
  const { entries, fetchEntries, currentWeekKey } = useWorkLogStore(useShallow(state => ({
    entries: state.entries,
    fetchEntries: state.fetchEntries,
    currentWeekKey: state.currentWeekKey,
  }))); 
  const user = useAuthStore(state => state.user);
  const isMobileViewport = useMobileViewport();
  const animationsEnabled = readAnimationsEnabled(user?.id);
  const [beijingDay, setBeijingDay] = useState(() => getBeijingDay());
  const [todayWorkState, setTodayWorkState] = useState<WorkStateDraw | null>(null);
  const [isWorkStateOpen, setIsWorkStateOpen] = useState(false);
  const [taskSummary, setTaskSummary] = useState({ active: 0, overdue: 0 });
  const [snoozedTodoIds, setSnoozedTodoIds] = useState<Set<string>>(() => new Set());
  const [snoozingTodoIds, setSnoozingTodoIds] = useState<Set<string>>(() => new Set());
  const [todoBulkMode, setTodoBulkMode] = useState(false);
  const [selectedTodoIds, setSelectedTodoIds] = useState<Set<string>>(() => new Set());
  const [batchConfirmOpen, setBatchConfirmOpen] = useState(false);
  const [batchSaving, setBatchSaving] = useState(false);
  const [lastBatchTodoIds, setLastBatchTodoIds] = useState<string[]>([]);
  const [selectedManagerTodo, setSelectedManagerTodo] = useState<ManagerTodoProgress | null>(null);
  const [teamManagerTodoProgress, setTeamManagerTodoProgress] = useState<ManagerTodoProgress[]>([]);
  const [directoryUsers, setDirectoryUsers] = useState<{ id: string; display_name: string }[]>([]);
  const [activeProjectChart, setActiveProjectChart] = useState(0);
  useEffect(() => {
    api.get<{ counts: { unread: number } }>('/notifications?filter=unread')
      .then(result => setTaskSummary({ active: Number(result.counts?.unread) || 0, overdue: 0 }))
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    fetchProducts();
    fetchEntries();
  }, [fetchProducts, fetchEntries]);

  useEffect(() => {
    let cancelled = false;
    api.get<{ users: { id: string; display_name: string }[] }>('/auth/directory')
      .then(result => { if (!cancelled) setDirectoryUsers(result.users || []); })
      .catch(() => { if (!cancelled) setDirectoryUsers([]); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setBeijingDay(current => {
        const next = getBeijingDay();
        return next.dateKey === current.dateKey ? current : next;
      });
    }, 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  const managerName = user?.display_name?.trim() || '';
  const isBusinessAdmin = user?.business_role === 'admin';
  const isIntern = user?.business_role === 'intern';
  const weekKey = currentWeekKey || getCurrentWeekKey();
  const weekRange = getWeekRange(weekKey);
  const workStateStorageKey = getWorkStateStorageKey(user?.id);

  useEffect(() => {
    let cancelled = false;
    api.get<{ itemIds: string[] }>(`/preferences/todo-snoozes?weekKey=${encodeURIComponent(weekKey)}`)
      .then(result => {
        if (!cancelled) setSnoozedTodoIds(new Set(result.itemIds || []));
      })
      .catch(() => {
        if (!cancelled) setSnoozedTodoIds(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id, weekKey]);

  useEffect(() => {
    const handleTodoHandled = (event: Event) => {
      const itemId = (event as CustomEvent<string>).detail;
      if (itemId) setSnoozedTodoIds(current => new Set(current).add(itemId));
    };
    window.addEventListener(WEEKLY_TODO_HANDLED_EVENT, handleTodoHandled);
    return () => window.removeEventListener(WEEKLY_TODO_HANDLED_EVENT, handleTodoHandled);
  }, []);

  useEffect(() => {
    setTodayWorkState(readStoredWorkState(workStateStorageKey, beijingDay.dateKey));
  }, [beijingDay.dateKey, workStateStorageKey]);

  const stats = useMemo(() => {
    const now = new Date();
    const established = products.filter(isEstablished).length;
    const currentYear = products.filter(product => parseDate(product.establishDate)?.getFullYear() === now.getFullYear()).length;
    const pending = Math.max(products.length - established, 0);

    const directlyAssignedEntries = entries.filter(entry => isAssignedToAccount(entry, managerName));
    const participatingProjectNames = new Set([
      ...directlyAssignedEntries.map(entry => participantProjectKey(entry.productName)),
    ].filter(Boolean));

    const workLogTodoItems = entries
      .filter(entry => !isHistoricalWorkLogStatus(entry.status))
      .filter(entry => isAssignedToAccount(entry, managerName))
      .map(entry => buildWorkLogTodo(entry, weekKey))
      .filter((item): item is TodoItem => Boolean(item));

    const projectTodoItems = products
      .filter(product => participatingProjectNames.has(participantProjectKey(product.productName)))
      .map(product => buildProjectTodo(product, now))
      .filter((item): item is TodoItem => Boolean(item));

    const activeWorkLogTodoItems = workLogTodoItems.filter(item => !snoozedTodoIds.has(item.id));
    const activeProjectTodoItems = projectTodoItems.filter(item => !snoozedTodoIds.has(item.id));
    const todoItems = [...activeWorkLogTodoItems, ...activeProjectTodoItems]
      .sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title, 'zh-CN'));
    const currentMonthKey = formatMonthKey(now);
    const managerEntries = Array.from(products.reduce((map, product) => {
      const manager = product.trustManager || '未分配';
      const updatedAt = parseDate(product.updatedAt);
      const current = map.get(manager) || { manager, total: 0, currentMonth: 0, recentAt: null as Date | null };
      current.total += 1;
      if (updatedAt && formatMonthKey(updatedAt) === currentMonthKey) current.currentMonth += 1;
      if (updatedAt && (!current.recentAt || updatedAt.getTime() > current.recentAt.getTime())) current.recentAt = updatedAt;
      map.set(manager, current);
      return map;
    }, new Map<string, { manager: string; total: number; currentMonth: number; recentAt: Date | null }>()).values())
      .sort((a, b) => b.total - a.total || (b.recentAt?.getTime() || 0) - (a.recentAt?.getTime() || 0));

    const recentProjects = [...products]
      .sort((a, b) => (parseDate(b.updatedAt)?.getTime() || 0) - (parseDate(a.updatedAt)?.getTime() || 0))
      .slice(0, 10);
    const projectCharts = isMobileViewport ? [] : buildProjectCharts(products);
    const managerTodoProgress = isBusinessAdmin ? buildManagerTodoProgress(entries, products, weekKey, now) : [];

    return {
      established,
      currentYear,
      pending,
      todoItems,
      managerEntries,
      recentProjects,
      projectCharts,
      managerTodoProgress,
    };
  }, [entries, isBusinessAdmin, isMobileViewport, managerName, products, snoozedTodoIds, weekKey]);

  useEffect(() => {
    if (!isBusinessAdmin) {
      setTeamManagerTodoProgress([]);
      setSelectedManagerTodo(null);
      return;
    }
    let cancelled = false;
    const currentItems = stats.managerTodoProgress;
    setTeamManagerTodoProgress(currentItems);
    api.post<{ items: ManagerTodoProgress[] }>('/preferences/manager-todo-progress', {
      weekKey,
      managers: currentItems.map(item => ({ manager: item.manager, items: item.pendingItems })),
    }).then(result => {
      if (cancelled) return;
      const items = result.items || [];
      setTeamManagerTodoProgress(items);
      setSelectedManagerTodo(current => current ? items.find(item => item.manager === current.manager) || null : null);
    }).catch(error => {
      if (!cancelled) _toast.error?.(error.message || '读取经理待办进度失败');
    });
    return () => { cancelled = true; };
  }, [isBusinessAdmin, stats.managerTodoProgress, weekKey]);

  const selectedTodoItems = useMemo(
    () => stats.todoItems.filter(item => selectedTodoIds.has(item.id)),
    [selectedTodoIds, stats.todoItems],
  );

  useEffect(() => {
    const availableIds = new Set(stats.todoItems.map(item => item.id));
    setSelectedTodoIds(current => {
      const next = new Set([...current].filter(id => availableIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [stats.todoItems]);

  useEffect(() => {
    if (lastBatchTodoIds.length === 0) return undefined;
    const timer = window.setTimeout(() => setLastBatchTodoIds([]), 12000);
    return () => window.clearTimeout(timer);
  }, [lastBatchTodoIds]);

  const managerMax = Math.max(...stats.managerEntries.map(entry => entry.total), 1);
  const currentProjectChart = stats.projectCharts[activeProjectChart] || stats.projectCharts[0] || EMPTY_PROJECT_CHART;
  const displayedProjectChartItems = currentProjectChart.items;
  const currentProjectChartSubtitle = currentProjectChart.subtitle;
  const currentProjectSummaryItems = [
    { key: 'usd', label: '美元规模', value: formatSummaryAmount(currentProjectChart.summary.usd, '美元') },
    { key: 'rmb', label: '人民币规模', value: formatSummaryAmount(currentProjectChart.summary.rmb, '元') },
    { key: 'annualIncome', label: '年化收入', value: formatSummaryAmount(currentProjectChart.summary.annualIncome, '元') },
    { key: 'thisYearIncome', label: '今年收入', value: formatSummaryAmount(currentProjectChart.summary.thisYearIncome, '元') },
    { key: 'performanceIncome', label: '绩效收入', value: formatSummaryAmount(currentProjectChart.summary.performanceIncome, '元') },
  ];
  const currentProjectChartMax = Math.max(...displayedProjectChartItems.map(item => item.count), 1);
  const projectChartPoints = displayedProjectChartItems.map((item, index) => {
    const left = 26;
    const right = 624;
    const top = 24;
    const bottom = 142;
    const x = displayedProjectChartItems.length === 1
      ? (left + right) / 2
      : left + ((right - left) * index) / (displayedProjectChartItems.length - 1);
    const y = bottom - (item.count / currentProjectChartMax) * (bottom - top);
    return { ...item, x, y };
  });
  const projectChartLine = projectChartPoints.map(point => `${point.x},${point.y}`).join(' ');

  useEffect(() => {
    if (isMobileViewport || stats.projectCharts.length === 0) return undefined;
    const timer = window.setTimeout(() => {
      setActiveProjectChart(current => (current + 1) % 4);
    }, 10_000);
    return () => window.clearTimeout(timer);
  }, [activeProjectChart, isMobileViewport, stats.projectCharts.length]);
  const greetingTitle = useMemo(() => {
    const templates = getGreetingTemplates();
    const template = templates[Math.floor(Math.random() * templates.length)] || templates[0];
    return template.replace('{name}', managerName || user?.id || '用户');
  }, [managerName, user?.id]);

  const handleDrawWorkState = () => {
    const stored = readStoredWorkState(workStateStorageKey, beijingDay.dateKey);
    if (stored) {
      setTodayWorkState(stored);
      setIsWorkStateOpen(true);
      return;
    }
    const draw = drawWorkStateFortune(beijingDay);
    saveStoredWorkState(workStateStorageKey, draw);
    setTodayWorkState(draw);
    setIsWorkStateOpen(true);
  };

  const snoozeTodoForCurrentWeek = async (item: TodoItem) => {
    if (snoozingTodoIds.has(item.id)) return;
    setSnoozingTodoIds(current => new Set(current).add(item.id));
    try {
      await api.post('/preferences/todo-snoozes', { weekKey, itemId: item.id });
      setSnoozedTodoIds(current => new Set(current).add(item.id));
      _toast.success?.(`“${item.title}”本周将不再提醒`);
    } catch (error: any) {
      _toast.error?.(error.message || '设置本周免打扰失败');
    } finally {
      setSnoozingTodoIds(current => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
    }
  };

  const toggleTodoBulkMode = () => {
    setTodoBulkMode(current => !current);
    setSelectedTodoIds(new Set());
    setBatchConfirmOpen(false);
  };

  const toggleSelectedTodo = (itemId: string) => {
    setSelectedTodoIds(current => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const toggleAllTodos = (itemIds: string[]) => {
    setSelectedTodoIds(current => {
      const allSelected = itemIds.length > 0 && itemIds.every(id => current.has(id));
      const next = new Set(current);
      itemIds.forEach(id => allSelected ? next.delete(id) : next.add(id));
      return next;
    });
  };

  const confirmBatchSnooze = async () => {
    const itemIds = selectedTodoItems.map(item => item.id);
    if (itemIds.length === 0 || batchSaving) return;
    setBatchSaving(true);
    try {
      await api.post('/preferences/todo-snoozes/batch', { weekKey, itemIds });
      setSnoozedTodoIds(current => new Set([...current, ...itemIds]));
      setLastBatchTodoIds(itemIds);
      setSelectedTodoIds(new Set());
      setTodoBulkMode(false);
      setBatchConfirmOpen(false);
      _toast.success?.(`已将 ${itemIds.length} 项标记为本周无需更新`);
    } catch (error: any) {
      _toast.error?.(error.message || '批量处理本周待办失败');
    } finally {
      setBatchSaving(false);
    }
  };

  const undoBatchSnooze = async () => {
    const itemIds = [...lastBatchTodoIds];
    if (itemIds.length === 0) return;
    setLastBatchTodoIds([]);
    try {
      await api.post('/preferences/todo-snoozes/batch/restore', { weekKey, itemIds });
      setSnoozedTodoIds(current => {
        const next = new Set(current);
        itemIds.forEach(id => next.delete(id));
        return next;
      });
      _toast.success?.('已撤销批量处理');
    } catch (error: any) {
      setLastBatchTodoIds(itemIds);
      _toast.error?.(error.message || '撤销失败');
    }
  };

  if (isMobileViewport) {
    return <>
      <MobileDashboard
        greetingTitle={greetingTitle}
        userId={user?.id || ''}
        managerName={managerName}
        weekRange={weekRange}
        todoItems={stats.todoItems}
        pending={stats.pending}
        established={stats.established}
        taskSummary={taskSummary}
        onDrawWorkState={handleDrawWorkState}
        onSnooze={snoozeTodoForCurrentWeek}
        snoozingTodoIds={snoozingTodoIds}
        bulkMode={todoBulkMode}
        selectedTodoIds={selectedTodoIds}
        onToggleBulkMode={toggleTodoBulkMode}
        onToggleTodo={toggleSelectedTodo}
        onToggleAll={toggleAllTodos}
        onRequestBatch={() => setBatchConfirmOpen(true)}
        managerTodoProgress={isBusinessAdmin ? teamManagerTodoProgress : undefined}
        onSelectManager={setSelectedManagerTodo}
      />
      <ManagerTodoDetailModal item={selectedManagerTodo} onClose={() => setSelectedManagerTodo(null)} />
      <BatchTodoConfirm open={batchConfirmOpen} items={selectedTodoItems} saving={batchSaving} onClose={() => setBatchConfirmOpen(false)} onConfirm={confirmBatchSnooze} />
      {lastBatchTodoIds.length > 0 && <div className="fixed inset-x-3 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-[85] flex items-center justify-between gap-3 bg-slate-900 px-4 py-3 text-sm text-white shadow-xl"><span>已处理 {lastBatchTodoIds.length} 项本周待办</span><button type="button" onClick={undoBatchSnooze} className="shrink-0 font-medium text-blue-300">撤销</button></div>}
      {isWorkStateOpen && todayWorkState && (
        <div className="fixed inset-0 z-[70] flex items-end bg-surface-900/35 lg:hidden">
          <div className="w-full rounded-t-[28px] bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl">
            <div className="mx-auto mt-2 h-1.5 w-12 rounded-full bg-surface-200" />
            <div className="flex items-center justify-between border-b border-surface-200 px-5 py-4"><div className="flex items-center gap-2 text-base font-semibold text-surface-900"><ScrollText size={18} />今日工作签</div><button type="button" onClick={() => setIsWorkStateOpen(false)} className="text-surface-500" aria-label="关闭"><X size={20} /></button></div>
            <div className="px-5 py-6"><p className="text-sm text-surface-500">{todayWorkState.dateKey} · {todayWorkState.weekdayLabel}</p><h2 className="mt-2 text-2xl font-semibold text-surface-900">{todayWorkState.rank} · {todayWorkState.title}</h2><p className="mt-5 text-sm leading-7 text-surface-700">{todayWorkState.message}</p><div className="mt-5 border-l-2 border-primary-600 bg-surface-50 px-4 py-3 text-sm leading-6 text-surface-600">{todayWorkState.action}</div></div>
            <div className="flex gap-3 border-t border-surface-200 px-5 py-4"><button type="button" onClick={() => setIsWorkStateOpen(false)} className="h-11 flex-1 border border-surface-300 text-sm font-medium text-surface-700">关闭</button><Link to="/worklog" onClick={() => setIsWorkStateOpen(false)} className="flex h-11 flex-1 items-center justify-center bg-primary-700 text-sm font-medium text-white">去管理周报</Link></div>
          </div>
        </div>
      )}
    </>;
  }

  return (
    <div className="square-ui flex min-h-full w-full flex-col gap-5 overflow-visible xl:h-full xl:overflow-hidden">
      <Header title={greetingTitle} subtitle="汇总常用入口与待办事项，快速开始日常工作。">
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <Link to="/tasks" title="消息" aria-label={`未读消息 ${taskSummary.active}`} className="inline-flex h-10 items-center justify-center gap-2 bg-primary-700 px-4 text-sm font-medium text-white hover:bg-primary-800"><Bell size={18} aria-hidden="true" /><span className="tabular-nums">{taskSummary.active}</span></Link>
          <button
            type="button"
            onClick={handleDrawWorkState}
            className="inline-flex h-10 items-center justify-center gap-2 border border-surface-300 bg-white px-4 text-sm font-medium text-surface-700 hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700"
          >
            <ScrollText size={16} />
            {todayWorkState ? '查看今日工作签' : '抽取今日工作签'}
          </button>
        </div>
      </Header>

      <section className="min-h-0 flex-1 xl:overflow-hidden">
        <div className="grid min-h-0 grid-cols-1 gap-5 xl:h-full xl:grid-cols-[340px_minmax(0,1fr)] xl:grid-rows-[minmax(260px,0.94fr)_minmax(220px,1fr)]">
          <aside className="flex min-h-[420px] flex-col overflow-visible border border-surface-200 bg-white p-4 lg:overflow-hidden lg:p-5 xl:min-h-0 xl:row-span-2">
            <div className="mb-3 flex shrink-0 items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <h3 className="text-2xl font-medium tracking-normal text-surface-900">{isBusinessAdmin ? '经理待办完成情况' : isIntern ? '常用信息' : '本周待办'}</h3>
                  <FeatureInfo label={isIntern ? '常用信息说明' : '本周待办功能说明'}>{isBusinessAdmin ? '汇总各经理本周应处理事项的完成率和数量。' : isIntern ? '查看盖章时间和常用办事提醒。' : '查看并处理本周待办，箭头可在侧栏展开。'}</FeatureInfo>
                </div>
                <div className="mt-1 text-xs text-surface-500">{managerName || '当前账号'} · {weekRange.start} - {weekRange.end}</div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
              {!isBusinessAdmin && !isIntern && stats.todoItems.length > 0 && <button type="button" onClick={toggleTodoBulkMode} className="h-9 px-2 text-xs font-medium text-primary-700">{todoBulkMode ? '退出批量' : '批量处理'}</button>}
              {!isBusinessAdmin && !isIntern && <button
                type="button"
                onClick={() => openWeeklyTodoSearch(stats.todoItems.map(item => ({
                  id: item.id,
                  title: item.title,
                  description: item.description,
                  type: item.type,
                  href: item.href,
                  tone: item.tone,
                  meta: item.meta,
                  actionLabel: item.actionLabel,
                  sourceUpdatedAt: item.sourceUpdatedAt,
                })), weekKey)}
                className="flex h-11 w-11 shrink-0 items-center justify-center text-surface-500 transition-colors hover:text-surface-900"
                aria-label="在侧栏查看本周待办"
                title="在侧栏查看本周待办"
              >
                <ArrowLeft size={18} />
              </button>}
              </div>
            </div>

            {isBusinessAdmin ? <div className="min-h-0 flex-1 overflow-visible lg:overflow-y-auto"><ManagerTodoProgressList items={teamManagerTodoProgress} onSelect={setSelectedManagerTodo} /></div> : <><div className={`${isIntern ? 'hidden' : 'grid'} min-h-0 flex-1 overflow-visible lg:overflow-y-auto ${
              stats.todoItems.length === 0
                ? 'place-items-center content-center'
                : 'auto-rows-max content-start gap-2 pr-1'
            }`}>
              {stats.todoItems.length === 0 && !isIntern && (
                <div className="px-5 text-center">
                  <div className="text-sm font-medium text-surface-800">本周待办已清空</div>
                  <div className="mt-2 text-xs leading-5 text-surface-500">当前没有需要处理的事项。</div>
                </div>
              )}

              {stats.todoItems.map(item => (
                <div
                  key={item.id}
                  onClick={() => { if (todoBulkMode) toggleSelectedTodo(item.id); }}
                  className={`relative block min-w-0 border p-3 transition hover:shadow-md ${selectedTodoIds.has(item.id) ? 'ring-2 ring-primary-500' : ''} ${weeklyTodoToneClass[item.tone]}`}
                >
                  {todoBulkMode && <button type="button" aria-label={`${selectedTodoIds.has(item.id) ? '取消选择' : '选择'}待办：${item.title}`} aria-pressed={selectedTodoIds.has(item.id)} className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center text-primary-700">{selectedTodoIds.has(item.id) ? <CheckSquare2 size={18} /> : <Square size={18} />}</button>}
                  <Link to={item.href} onClick={event => { if (todoBulkMode) event.preventDefault(); }} className={`block min-w-0 ${todoBulkMode ? 'pr-7' : ''}`}>
                    <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
                      <span className={`shrink-0 px-2 py-1 text-[10px] font-medium ${weeklyTodoBadgeClass[item.tone]}`}>
                        {item.tone === 'danger' ? '紧急' : item.actionLabel}
                      </span>
                      <span className="min-w-0 truncate text-right text-[10px] text-surface-500">{item.meta}</span>
                    </div>
                    <div className="truncate text-sm font-normal">{item.title}</div>
                    <div className="mt-1.5 line-clamp-2 text-xs leading-5 text-surface-600">{item.description}</div>
                  </Link>
                  {!todoBulkMode && <div className="mt-2 flex items-center justify-between gap-2 border-t border-current/10 pt-2">
                    <button
                      type="button"
                      disabled={snoozingTodoIds.has(item.id)}
                      onClick={() => snoozeTodoForCurrentWeek(item)}
                      className="h-7 border border-current/20 bg-white/70 px-2 text-[10px] font-medium opacity-75 hover:bg-white hover:opacity-100 disabled:cursor-wait disabled:opacity-40"
                    >
                      {snoozingTodoIds.has(item.id) ? '设置中…' : '本周无改动'}
                    </button>
                    <Link to={item.href} className="flex items-center gap-1 text-[10px] font-medium opacity-70 hover:opacity-100">
                      处理
                      <ArrowRight size={12} />
                    </Link>
                  </div>}
                </div>
              ))}

            </div>
            {todoBulkMode && stats.todoItems.length > 0 && <div className="mt-3 flex shrink-0 items-center gap-2 border-t border-slate-100 pt-3"><button type="button" onClick={() => toggleAllTodos(stats.todoItems.map(item => item.id))} className="h-9 border border-slate-200 px-3 text-xs text-slate-700">{stats.todoItems.every(item => selectedTodoIds.has(item.id)) ? '取消全选' : '全选当前'}</button><button type="button" disabled={selectedTodoIds.size === 0} onClick={() => setBatchConfirmOpen(true)} className="h-9 flex-1 bg-primary-700 px-3 text-xs font-medium text-white disabled:opacity-40">本周无需更新（{selectedTodoIds.size}）</button></div>}{isIntern && <InternTodoInfoBlocks />}</>}
          </aside>

          <section className="flex min-h-[340px] flex-col overflow-visible border border-surface-200 bg-white px-4 pb-3 pt-4 lg:overflow-hidden lg:px-5 lg:pt-5 xl:min-h-0">
            <div className="mb-3 flex shrink-0 items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <h3 className="truncate text-2xl font-medium tracking-normal text-surface-900">{currentProjectChart.title}</h3>
                  <FeatureInfo label="项目图表功能说明">切换查看项目数量、落地、中止和停留时长。</FeatureInfo>
                </div>
                <div className="mt-1 truncate text-xs text-surface-500">{currentProjectChartSubtitle}</div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <div className="text-right">
                  <div className="text-xl font-semibold leading-none text-surface-900">{currentProjectChart.total}</div>
                  <div className="mt-1 text-xs leading-none text-surface-500">相关项目</div>
                </div>
                  <div className="flex h-3 items-center" aria-label="图表轮播位置">
                  {stats.projectCharts.map((chart, index) => (
                    <button
                      key={chart.key}
                      type="button"
                      onClick={() => setActiveProjectChart(index)}
                        className="group flex h-3 w-3 items-center justify-center"
                      aria-label={`查看${chart.title}`}
                    >
                      <span className={`h-2 w-2 transition-colors ${
                        activeProjectChart === index
                          ? 'bg-primary-600'
                          : 'bg-surface-300 group-hover:bg-surface-400'
                      }`} />
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="relative grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[176px_minmax(0,1fr)]">
              <aside
                className="flex min-h-0 flex-col overflow-visible border border-surface-200 bg-white p-2.5 lg:overflow-hidden"
                aria-label={`${currentProjectChart.title}数据汇总`}
              >
                <div className="flex shrink-0 items-center gap-1.5">
                  <span className="h-2 w-2 bg-primary-600" />
                  <span className="text-[11px] font-medium tracking-wide text-surface-700">业务数据</span>
                </div>
                <div
                  className="mt-1 grid min-h-0 flex-1 gap-1"
                  style={{ gridTemplateRows: 'auto repeat(2, minmax(0, 1fr)) auto repeat(3, minmax(0, 1fr))' }}
                >
                  <div className="self-end text-[9px] font-medium leading-none tracking-[0.14em] text-surface-400">项目规模</div>
                  {currentProjectSummaryItems.slice(0, 2).map(item => (
                    <div key={item.key} className="flex min-h-0 min-w-0 items-center justify-between gap-2 bg-surface-50 px-2">
                      <span className="shrink-0 text-[10px] leading-none text-surface-500">{item.label.replace('规模', '')}</span>
                      <span className="min-w-0 truncate text-right text-[12px] font-medium leading-none tabular-nums text-surface-900" title={item.value}>
                        {item.value}
                      </span>
                    </div>
                  ))}
                  <div className="self-end text-[9px] font-medium leading-none tracking-[0.14em] text-surface-400">项目收入</div>
                  {currentProjectSummaryItems.slice(2).map(item => (
                    <div key={item.key} className="flex min-h-0 min-w-0 items-center justify-between gap-2 bg-surface-50 px-2">
                      <span className="shrink-0 text-[10px] leading-none text-surface-500">{item.label.replace('收入', '')}</span>
                      <span className="min-w-0 truncate text-right text-[12px] font-medium leading-none tabular-nums text-surface-900" title={item.value}>
                        {item.value}
                      </span>
                    </div>
                  ))}
                </div>
              </aside>

              <div className="relative flex min-h-[220px] flex-1 flex-col overflow-hidden border border-surface-200 bg-white px-3 pt-2 lg:min-h-0">
                <div className="app-dashboard-chart-grid relative min-h-0 flex-1">
                  <svg
                    key={currentProjectChart.key}
                    viewBox="0 0 650 170"
                    preserveAspectRatio="none"
                    className="absolute inset-0 h-full w-full overflow-visible"
                    role="img"
                    aria-label={`${currentProjectChart.title}折线图`}
                  >
                    <defs>
                      <linearGradient id="projectLineArea" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0" stopColor="var(--app-primary)" stopOpacity="0.18" />
                        <stop offset="1" stopColor="var(--app-primary)" stopOpacity="0.02" />
                      </linearGradient>
                      <clipPath id="projectLineReveal" clipPathUnits="userSpaceOnUse">
                        <rect x="0" y="0" width={animationsEnabled ? 0 : 650} height="170">
                          {animationsEnabled && (
                            <animate
                              attributeName="width"
                              from="0"
                              to="650"
                              begin="0.12s"
                              dur="0.78s"
                              fill="freeze"
                              calcMode="spline"
                              keyTimes="0;1"
                              keySplines="0.22 1 0.36 1"
                            />
                          )}
                        </rect>
                      </clipPath>
                    </defs>
                    {projectChartPoints.length > 1 && (
                      <polygon
                        points={`${projectChartLine} ${projectChartPoints[projectChartPoints.length - 1].x},154 ${projectChartPoints[0].x},154`}
                        fill="url(#projectLineArea)"
                        className="app-dashboard-area"
                      />
                    )}
                    <polyline
                      points={projectChartLine}
                      fill="none"
                      stroke="var(--app-primary)"
                      strokeWidth="3"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                      className="app-dashboard-line"
                      clipPath="url(#projectLineReveal)"
                    />
                  </svg>
                  {projectChartPoints.map((point, index) => (
                    <div
                      key={`${currentProjectChart.key}-${point.key}`}
                      className="app-dashboard-point pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
                      style={{
                        left: `${(point.x / 650) * 100}%`,
                        top: `${(point.y / 170) * 100}%`,
                        animationDelay: `${920 + index * 45}ms`,
                      }}
                    >
                      <span className="absolute bottom-3 left-1/2 -translate-x-1/2 text-[11px] font-medium leading-none text-surface-800">
                        {point.count}
                      </span>
                      <span className="block h-3 w-3 rounded-full border-[3px] border-primary-600 bg-white" />
                    </div>
                  ))}
                </div>
                <div className={`grid h-7 items-center gap-1 ${displayedProjectChartItems.length === 4 ? 'grid-cols-4' : 'grid-cols-12'}`}>
                  {displayedProjectChartItems.map(item => (
                    <div key={item.key} className="truncate text-center text-[10px] text-surface-500" title={item.label}>
                      {item.label}
                    </div>
                  ))}
                </div>

                <div className="group absolute inset-y-0 left-0 z-40 w-12">
                  <button
                    type="button"
                    onClick={() => setActiveProjectChart(current => (
                      (current - 1 + stats.projectCharts.length) % stats.projectCharts.length
                    ))}
                    className="absolute left-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center border border-surface-300 bg-white text-surface-600 opacity-0 shadow-sm transition-[opacity,color,background-color] group-hover:opacity-100 hover:bg-primary-50 hover:text-primary-700 focus:border-surface-300 focus:outline-none focus-visible:opacity-100 focus-visible:border-surface-300 focus-visible:outline-none focus-visible:ring-0"
                    aria-label="查看上一张项目图表"
                    title="上一张图表"
                  >
                    <ChevronLeft size={17} />
                  </button>
                </div>
                <div className="group absolute inset-y-0 right-0 z-40 w-12">
                  <button
                    type="button"
                    onClick={() => setActiveProjectChart(current => (
                      (current + 1) % stats.projectCharts.length
                    ))}
                    className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center border border-surface-300 bg-white text-surface-600 opacity-0 shadow-sm transition-[opacity,color,background-color] group-hover:opacity-100 hover:bg-primary-50 hover:text-primary-700 focus:border-surface-300 focus:outline-none focus-visible:opacity-100 focus-visible:border-surface-300 focus-visible:outline-none focus-visible:ring-0"
                    aria-label="查看下一张项目图表"
                    title="下一张图表"
                  >
                    <ChevronRight size={17} />
                  </button>
                </div>
              </div>
            </div>
          </section>

          <div className="grid min-h-0 gap-5 xl:grid-cols-[1fr_1.08fr]">
            <section className="flex min-h-[300px] flex-col overflow-visible border border-surface-200 bg-white p-4 lg:overflow-hidden lg:p-5 xl:min-h-0">
              <div className="mb-3 flex shrink-0 items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-1.5">
                    <h3 className="text-2xl font-medium tracking-normal text-surface-900">最近项目</h3>
                    <FeatureInfo label="最近项目功能说明">按最近编辑时间展示项目，点击可继续处理。</FeatureInfo>
                  </div>
                  <div className="mt-1 text-xs text-surface-500">按最近编辑时间排序</div>
                </div>
                <Link
                  to="/projects"
                  className="inline-flex h-9 shrink-0 items-center gap-1.5 px-2 text-sm font-medium text-surface-500 transition-colors hover:bg-surface-100 hover:text-primary-700"
                >
                  查看全部
                  <ArrowRight size={15} />
                </Link>
              </div>

              <div className="min-h-0 flex-1 overflow-visible lg:overflow-y-auto">
                {stats.recentProjects.length === 0 && (
                  <div className="flex min-h-28 items-center justify-center text-sm text-surface-500">
                    暂无最近编辑项目
                  </div>
                )}

                <div>
                {stats.recentProjects.map(product => {
                  return (
                    <Link
                      key={product.id}
                      to={`/projects?projectId=${encodeURIComponent(product.id)}`}
                      className="app-theme-hover-row group block min-h-[58px] px-3 py-2 text-surface-800 transition-colors hover:bg-primary-50/40"
                    >
                      <div className="flex min-w-0 items-center justify-between gap-3">
                        <div className="truncate text-sm font-medium text-surface-900" title={product.productName || '未命名项目'}>
                          {product.productName || '未命名项目'}
                        </div>
                        <span className="inline-flex h-7 shrink-0 items-center gap-1 text-xs font-medium text-surface-500 transition-colors group-hover:text-primary-700">
                          编辑
                          <ArrowRight size={13} />
                        </span>
                      </div>
                      <div className="-mt-0.5 flex min-w-0 items-center justify-between gap-3 text-[11px] text-surface-500">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span className="h-2 w-2 shrink-0 bg-primary-500" aria-hidden="true" />
                          <span className="shrink-0 text-surface-700">{product.status || '未填写状态'}</span>
                          <span className="text-surface-300">·</span>
                          <span className="truncate">{product.trustManager || '未分配'}{product.trustManagerB ? ` · ${product.trustManagerB}` : ''}</span>
                        </div>
                        <time className="inline-flex shrink-0 items-center gap-1 tabular-nums text-surface-400" dateTime={product.updatedAt} title={`最后编辑 ${formatLastEditedTime(product.updatedAt)}`}>
                          <Clock3 size={12} />
                          {formatLastEditedTime(product.updatedAt)}
                        </time>
                      </div>
                    </Link>
                  );
                })}
                </div>
              </div>
            </section>

            <section className="flex min-h-[300px] flex-col overflow-visible border border-surface-200 bg-white p-4 lg:overflow-hidden lg:p-5 xl:min-h-0">
              <div className="mb-3 flex shrink-0 items-start justify-between gap-4">
                <div>
                  <h3 className="text-2xl font-medium tracking-normal text-surface-900">经理项目</h3>
                  <div className="mt-1 text-xs text-surface-500">
                    {stats.managerEntries.length} 位经理 · {products.length} 个项目
                  </div>
                </div>
                <Link
                  to="/projects"
                  className="inline-flex h-9 shrink-0 items-center gap-1.5 px-2 text-sm font-medium text-surface-500 transition-colors hover:bg-surface-100 hover:text-primary-700"
                >
                  查看全部
                  <ArrowRight size={15} />
                </Link>
              </div>

              <div className="grid min-h-0 flex-1 content-start gap-4 overflow-visible pr-1 lg:overflow-y-auto">
                {stats.managerEntries.length === 0 && (
                  <div className="border border-dashed border-surface-200 bg-surface-50 p-5 text-center text-sm text-surface-500">
                    暂无经理项目数据
                  </div>
                )}

                {stats.managerEntries.map(entry => {
                  const managerUser = directoryUsers.find(item => item.display_name.trim() === entry.manager.trim());
                  return (
                  <div key={entry.manager} className="grid grid-cols-[42px_minmax(0,1fr)_76px] items-center gap-3">
                    {managerUser ? <UserProfileAvatar userId={managerUser.id} displayName={managerUser.display_name} className="h-11 w-11 text-sm" /> : <div className="flex h-11 w-11 items-center justify-center bg-surface-400 text-sm font-medium text-white">{entry.manager.slice(0, 1)}</div>}
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center justify-between gap-2">
                        <div className="truncate text-sm font-normal text-surface-800">{entry.manager}</div>
                        <div className="shrink-0 text-[10px] text-surface-500">近更 {formatShortDate(entry.recentAt?.toISOString())}</div>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden bg-surface-200">
                        <div className="app-chart-bar h-full bg-primary-600" style={{ width: `${Math.max(12, (entry.total / managerMax) * 100)}%` }} />
                      </div>
                      <div className="mt-1 text-[10px] text-surface-500">本月编辑 {entry.currentMonth} 个</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xl font-medium text-surface-800">{entry.total}</div>
                      <div className="text-[10px] text-surface-500">项目</div>
                    </div>
                  </div>
                  );
                })}
              </div>
            </section>
          </div>
        </div>
      </section>

      {isWorkStateOpen && todayWorkState && (
        <div className="app-work-fortune-backdrop fixed inset-0 z-50 flex items-center justify-center bg-surface-900/35 px-4">
          <div className="app-work-fortune-panel w-full max-w-[420px] border border-surface-200 bg-white shadow-[0_24px_70px_rgba(32,42,54,0.20)]">
            <div className="flex h-12 items-center justify-between border-b border-surface-200 px-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-surface-900">
                <ScrollText size={16} />
                今日工作签
              </div>
              <button
                type="button"
                onClick={() => setIsWorkStateOpen(false)}
                className="flex h-8 w-8 items-center justify-center text-surface-500 hover:bg-surface-100 hover:text-surface-900"
                aria-label="关闭今日工作签"
              >
                <X size={16} />
              </button>
            </div>

            <div className="grid grid-cols-[86px_minmax(0,1fr)]">
              <div className="flex min-h-[238px] flex-col items-center justify-between bg-primary-700 px-4 py-5 text-white">
                <div className="text-xs tracking-[0.28em] text-primary-200 [writing-mode:vertical-rl]">WORK FORTUNE</div>
                <div className="text-4xl font-semibold leading-none">{todayWorkState.rank}</div>
                <div className="h-8 w-px bg-primary-500" />
              </div>

              <div className="min-w-0 px-6 py-5">
                <div className="text-xs font-medium text-surface-500">{todayWorkState.dateKey} · {todayWorkState.weekdayLabel}</div>
                <h3 className="mt-2 text-2xl font-semibold tracking-normal text-surface-900">{todayWorkState.title}</h3>
                <p className="mt-5 text-sm leading-7 text-surface-700">{todayWorkState.message}</p>
                <div className="mt-5 border-l-2 border-danger-600 bg-surface-50 px-4 py-3 text-xs leading-6 text-surface-600">
                  {todayWorkState.action}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-surface-200 bg-surface-50 px-4 py-3">
              <button
                type="button"
                onClick={() => setIsWorkStateOpen(false)}
                className="inline-flex h-10 items-center justify-center gap-2 border border-surface-200 bg-white px-4 text-sm font-medium text-surface-700 hover:bg-surface-100"
              >
                关闭
              </button>
              <Link
                to="/worklog"
                onClick={() => setIsWorkStateOpen(false)}
                className="inline-flex h-10 items-center justify-center bg-primary-700 px-4 text-sm font-medium text-white hover:bg-primary-800"
              >
                去管理周报
              </Link>
            </div>
          </div>
        </div>
      )}
      <BatchTodoConfirm open={batchConfirmOpen} items={selectedTodoItems} saving={batchSaving} onClose={() => setBatchConfirmOpen(false)} onConfirm={confirmBatchSnooze} />
      <ManagerTodoDetailModal item={selectedManagerTodo} onClose={() => setSelectedManagerTodo(null)} />
      {lastBatchTodoIds.length > 0 && <div className="fixed bottom-5 left-1/2 z-[85] flex min-w-[320px] -translate-x-1/2 items-center justify-between gap-5 bg-slate-900 px-4 py-3 text-sm text-white shadow-xl"><span>已处理 {lastBatchTodoIds.length} 项本周待办</span><button type="button" onClick={undoBatchSnooze} className="font-medium text-blue-300">撤销</button></div>}
    </div>
  );
}

