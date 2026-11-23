import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Building2, CalendarDays, DollarSign, Percent, Trash2, UserRound } from 'lucide-react';
import { InvestmentProduct, StatusConfig } from '../types';
import { compactWanAmount, formatPercent } from '../utils/format';
import { useCollaborationStore } from '../store/collaborationStore';
import { useShallow } from 'zustand/react/shallow';
import EditingLockOverlay from './Collaboration/EditingLockOverlay';
import { findExactDuplicateGroups, PRODUCT_COMPARE_FIELDS } from '../utils/duplicateDetection';
import ContextMenu from './Layout/ContextMenu';
import { useMobileViewport } from '../hooks/useMobileViewport';

interface ProductCardsProps {
  data: InvestmentProduct[];
  onOpenDetail?: (product: InvestmentProduct, fieldKey?: string) => void;
  statusConfigs?: StatusConfig[];
  advanceStatusConfigs?: StatusConfig[];
  onAdvance?: (product: InvestmentProduct, nextStatus: string) => void;
  onRetreat?: (product: InvestmentProduct, previousStatus: string) => void;
  onDelete?: (product: InvestmentProduct) => void;
  selectedId?: string | null;
  visibleFieldKeys?: string[];
  temporarilyPinnedIds?: string[];
}

export const PROJECT_CARD_FIELD_OPTIONS = [
  { key: 'projectCategory', label: '项目分类' },
  { key: 'activePassive', label: '主动 / 被动' },
  { key: 'collectiveSingle', label: '集合 / 单一' },
  { key: 'client', label: '委托人' },
  { key: 'target', label: '标的' },
  { key: 'feeRate', label: '费率' },
  { key: 'establishDate', label: '（拟）成立日' },
  { key: 'strategy', label: '投资策略' },
  { key: 'annualIncome', label: '年化收入（万元）' },
  { key: 'performanceIncome', label: '绩效收入（万元）' },
  { key: 'thisYearIncome', label: '今年收入（万元）' },
  { key: 'deadline', label: '截止日期' },
  { key: 'brokerChannel', label: '渠道' },
  { key: 'custodianBank', label: '托管行' },
  { key: 'tradingBroker', label: '交易券商' },
] as const;

interface ProjectLane {
  key: string;
  title: string;
  color: string;
}

const STATUS_ORDER = ['材料收集', '报告撰写', '上会中', '已过会', '已成立', '项目中止', '未填写'];
const PROGRESS_STATUS_ORDER = ['材料收集', '报告撰写', '上会中', '已过会', '已成立'];

const STATUS_COLORS: Record<string, string> = {
  材料收集: '#94a3b8',
  报告撰写: '#60a5fa',
  上会中: '#f59e0b',
  已过会: '#84cc16',
  已成立: '#16a34a',
  项目中止: '#dc2626',
  未填写: '#d1d5db',
};

function normalizeStatus(status?: string) {
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

function statusRank(status?: string) {
  const normalized = normalizeStatus(status);
  const index = STATUS_ORDER.indexOf(normalized);
  return index >= 0 ? index : STATUS_ORDER.length;
}

function resolveNextStatus(product: InvestmentProduct, statusConfigs: StatusConfig[]) {
  const currentStatus = normalizeStatus(product.status);
  const currentIndex = PROGRESS_STATUS_ORDER.indexOf(currentStatus);
  if (currentIndex < 0 || currentIndex >= PROGRESS_STATUS_ORDER.length - 1) return null;

  const nextStatus = PROGRESS_STATUS_ORDER[currentIndex + 1];
  const configuredStatus = statusConfigs.find(config => normalizeStatus(config.name) === nextStatus);
  return configuredStatus?.name ?? (statusConfigs.length === 0 ? nextStatus : null);
}

function resolvePreviousStatus(product: InvestmentProduct, statusConfigs: StatusConfig[]) {
  const currentStatus = normalizeStatus(product.status);
  const currentIndex = PROGRESS_STATUS_ORDER.indexOf(currentStatus);
  if (currentIndex <= 0) return null;
  const previousStatus = PROGRESS_STATUS_ORDER[currentIndex - 1];
  const configuredStatus = statusConfigs.find(config => normalizeStatus(config.name) === previousStatus);
  return configuredStatus?.name ?? (statusConfigs.length === 0 ? previousStatus : null);
}

function fmtWanAmount(value: number | null | undefined) {
  if (value == null || Number.isNaN(Number(value)) || Number(value) === 0) return '-';
  return compactWanAmount(Number(value)).display;
}

function hasNumber(value: number | null | undefined) {
  return value != null && Number.isFinite(Number(value)) && Number(value) !== 0;
}

function resolveStageDate(product: InvestmentProduct) {
  const status = normalizeStatus(product.status);
  if ((status === '项目中止' || status === '项目备用') && product.projectStoppedDate) {
    return { fieldKey: 'projectStoppedDate', label: '中止', value: product.projectStoppedDate };
  }
  if (status === '已成立' && product.establishDate) {
    return { fieldKey: 'establishDate', label: '成立', value: product.establishDate };
  }
  const createdDate = product.projectCreatedDate || product.progressStartDate;
  return createdDate ? { fieldKey: 'projectCreatedDate', label: '创建', value: createdDate } : null;
}

function deadlineTone(deadline?: string) {
  if (!deadline) return 'text-slate-500';
  const target = new Date(`${deadline}T23:59:59`);
  if (Number.isNaN(target.getTime())) return 'text-slate-500';
  const days = Math.ceil((target.getTime() - Date.now()) / 86_400_000);
  if (days < 0) return 'font-medium text-red-600';
  if (days <= 30) return 'font-medium text-amber-600';
  return 'text-slate-600';
}

function DetailTargetCell({
  fieldKey,
  className = '',
  children,
  onOpen,
  disabled = false,
}: {
  fieldKey: string;
  className?: string;
  children: ReactNode;
  onOpen: (fieldKey: string) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      onClick={(event) => {
        event.stopPropagation();
        if (disabled) return;
        onOpen(fieldKey);
      }}
      onKeyDown={(event) => {
        if (disabled) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          event.stopPropagation();
          onOpen(fieldKey);
        }
      }}
      className={`${disabled ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-slate-100'} transition-colors ${className}`}
      title="打开详情并定位到该字段"
    >
      {children}
    </div>
  );
}

function ProjectMetaRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div data-project-meta-row={label} className="grid min-w-0 grid-cols-[2rem_minmax(0,1fr)] items-start gap-x-2">
      <span className="leading-5 text-slate-400">{label}</span>
      <div data-project-meta-content className="min-w-0 leading-5 text-slate-600">
        {children}
      </div>
    </div>
  );
}

function ProjectCardField({ label, fieldKey, value, onOpen, disabled = false, valueClassName = '' }: {
  label: string;
  fieldKey: string;
  value: ReactNode;
  onOpen: (fieldKey: string) => void;
  disabled?: boolean;
  valueClassName?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[11px] leading-4 text-slate-400">{label}</div>
      <DetailTargetCell fieldKey={fieldKey} onOpen={onOpen} disabled={disabled} className={`mt-0.5 min-w-0 truncate text-xs leading-5 text-slate-700 ${valueClassName}`}>
        <span>{value || '—'}</span>
      </DetailTargetCell>
    </div>
  );
}

function resolveLanes(data: InvestmentProduct[], statusConfigs: StatusConfig[]) {
  const lanes: ProjectLane[] = [];
  const seenKeys = new Set<string>();

  statusConfigs.forEach(config => {
    const key = normalizeStatus(config.name);
    if (seenKeys.has(key)) return;
    lanes.push({ key, title: config.name, color: config.color || STATUS_COLORS[key] || '#64748b' });
    seenKeys.add(key);
  });

  if (statusConfigs.length === 0) {
    STATUS_ORDER.filter(status => status !== '未填写').forEach(status => {
      lanes.push({ key: status, title: status, color: STATUS_COLORS[status] });
      seenKeys.add(status);
    });
  }

  [...data]
    .sort((a, b) => statusRank(a.status) - statusRank(b.status))
    .forEach(product => {
      const key = normalizeStatus(product.status);
      if (seenKeys.has(key)) return;
      lanes.push({ key, title: key, color: STATUS_COLORS[key] || '#64748b' });
      seenKeys.add(key);
    });

  return lanes;
}

function MobileProjectCards({ data, onOpenDetail }: Pick<ProductCardsProps, 'data' | 'onOpenDetail'>) {
  return (
    <div className="mobile-native-card-list">
      {data.map(product => {
        const status = normalizeStatus(product.status);
        return (
          <article
            key={product.id}
            data-project-id={product.id}
            role={onOpenDetail ? 'button' : undefined}
            tabIndex={onOpenDetail ? 0 : -1}
            className="mobile-native-card"
            onClick={() => onOpenDetail?.(product)}
            onKeyDown={event => {
              if (!onOpenDetail || (event.key !== 'Enter' && event.key !== ' ')) return;
              event.preventDefault();
              onOpenDetail(product);
            }}
          >
            <div className="mobile-native-card__title-row">
              <h3>{product.productName || '未命名项目'}</h3>
              <ArrowRight size={18} aria-hidden="true" />
            </div>
            <div className="mobile-native-card__grid">
              <div><span>状态</span><strong className="mobile-native-card__status" style={{ color: STATUS_COLORS[status] || '#475569' }}>{status}</strong></div>
              <div><span>标的</span><strong>{product.target || '—'}</strong></div>
              <div><span>客户</span><strong title={product.client}>{product.client || '—'}</strong></div>
              <div><span>规模 USD</span><strong>{hasNumber(product.usd) ? fmtWanAmount(product.usd) : '—'}</strong></div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

export default function ProductCards({
  data,
  onOpenDetail,
  statusConfigs = [],
  advanceStatusConfigs = [],
  onAdvance,
  onRetreat,
  onDelete,
  selectedId,
  visibleFieldKeys = PROJECT_CARD_FIELD_OPTIONS.slice(0, 8).map(option => option.key),
  temporarilyPinnedIds = [],
}: ProductCardsProps) {
  const isMobileViewport = useMobileViewport();
  const { activeEditors, currentUserId } = useCollaborationStore(useShallow(s => ({
    activeEditors: s.activeEditors,
    currentUserId: s.userId,
  })));
  const productEditors = new Map(
    [...activeEditors.values()]
      .filter(editor => editor.recordType === 'product' && editor.recordId && editor.userId !== currentUserId)
      .map(editor => [editor.recordId!, editor])
  );

  const { duplicateIds } = findExactDuplicateGroups(data, PRODUCT_COMPARE_FIELDS);
  const temporaryPinRank = new Map(temporarilyPinnedIds.map((id, index) => [id, index]));
  const sortedProducts = [...data].sort((a, b) => {
    const aRank = temporaryPinRank.get(a.id);
    const bRank = temporaryPinRank.get(b.id);
    if (aRank !== undefined || bRank !== undefined) {
      if (aRank === undefined) return 1;
      if (bRank === undefined) return -1;
      return aRank - bRank;
    }
    return (a.productName || '').localeCompare(b.productName || '', 'zh-CN');
  });
  const lanes = resolveLanes(data, statusConfigs);
  const visibleLanes = isMobileViewport
    ? lanes.filter(lane => sortedProducts.some(product => normalizeStatus(product.status) === lane.key))
    : lanes;
  const selectedProduct = selectedId ? data.find(product => product.id === selectedId) : undefined;
  const selectedLaneKey = selectedProduct ? normalizeStatus(selectedProduct.status) : null;
  const boardScrollRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<{ product: InvestmentProduct; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('pointerdown', close);
    window.addEventListener('blur', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [contextMenu]);

  useEffect(() => {
    const animationFrame = window.requestAnimationFrame(() => {
      const board = boardScrollRef.current;
      if (!selectedLaneKey) {
        board?.scrollTo({ left: 0, behavior: 'smooth' });
        return;
      }
      const selectedLane = board?.querySelector<HTMLElement>(
        `[data-project-lane="${CSS.escape(selectedLaneKey)}"]`,
      );
      if (!board || !selectedLane) return;
      board.scrollTo({ left: selectedLane.offsetLeft, behavior: 'smooth' });
      const laneScroll = selectedLane.querySelector<HTMLElement>(
        `[data-project-lane-scroll="${CSS.escape(selectedLaneKey)}"]`,
      );
      const selectedCard = selectedLane.querySelector<HTMLElement>(
        `[data-project-id="${CSS.escape(selectedId || '')}"]`,
      );
      if (laneScroll && selectedCard) {
        laneScroll.scrollTo({ top: Math.max(0, selectedCard.offsetTop - laneScroll.offsetTop - 8), behavior: 'smooth' });
      }
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [selectedId, selectedLaneKey]);

  useEffect(() => {
    const latestPinnedId = temporarilyPinnedIds[0];
    const latestPinned = latestPinnedId ? data.find(product => product.id === latestPinnedId) : null;
    if (!latestPinned) return;
    const animationFrame = window.requestAnimationFrame(() => {
      const board = boardScrollRef.current;
      const laneKey = normalizeStatus(latestPinned.status);
      const lane = board?.querySelector<HTMLElement>(`[data-project-lane="${CSS.escape(laneKey)}"]`);
      const laneScroll = lane?.querySelector<HTMLElement>(`[data-project-lane-scroll="${CSS.escape(laneKey)}"]`);
      if (!board || !lane) return;
      board.scrollTo({ left: lane.offsetLeft, behavior: 'smooth' });
      laneScroll?.scrollTo({ top: 0, behavior: 'smooth' });
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [data, temporarilyPinnedIds]);

  if (isMobileViewport) {
    return data.length > 0
      ? <MobileProjectCards data={sortedProducts} onOpenDetail={onOpenDetail} />
      : <div className="mobile-native-empty">暂无项目数据</div>;
  }

  if (data.length === 0 && lanes.length === 0) {
    return (
      <div className="project-board-empty flex h-full min-h-[420px] flex-col items-center justify-center border border-dashed border-slate-200 bg-white text-sm text-slate-500">
        暂无项目数据
      </div>
    );
  }

  return (
    <div ref={boardScrollRef} className="project-card-board h-auto min-h-0 min-w-0 snap-x snap-mandatory overflow-x-auto overflow-y-visible overscroll-x-contain pb-3 pr-1 lg:h-full lg:overflow-y-hidden">
      <div
        className="project-card-board__lanes grid h-auto min-h-0 w-full auto-cols-[minmax(calc(100vw-4rem),1fr)] grid-flow-col items-stretch gap-3 lg:h-full lg:auto-cols-[minmax(340px,1fr)]"
      >
        {visibleLanes.map(lane => {
          const products = sortedProducts.filter(product => normalizeStatus(product.status) === lane.key);

          return (
            <section
              key={lane.key}
              data-project-lane={lane.key}
              className="project-card-board__lane flex h-auto min-h-0 min-w-0 snap-start flex-col lg:h-full"
              style={{ ['--group-color' as string]: lane.color }}
            >
              <div className="project-board-lane-header project-card-board__lane-header z-30 flex min-h-10 shrink-0 items-center gap-2 border-b border-slate-200 bg-white/95 px-1 backdrop-blur-sm">
                <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--group-color)]" />
                <h2 className="project-board-lane-title truncate text-sm font-medium text-slate-900">{lane.title}</h2>
                <span className="project-board-lane-count inline-flex min-w-5 items-center justify-center rounded bg-slate-100 px-1.5 py-0.5 text-xs tabular-nums text-slate-500">
                  {products.length}
                </span>
              </div>

              <div
                data-project-lane-scroll={lane.key}
                className="project-stage-scroll project-card-board__lane-list min-h-0 flex-1 space-y-2 overflow-y-visible pb-1 pt-2 lg:snap-y lg:snap-mandatory lg:overflow-y-auto lg:overscroll-y-contain lg:scroll-pb-1 lg:scroll-pt-2"
              >
                {products.length === 0 ? (
                  <div className="project-board-empty flex min-h-28 items-center justify-center border border-dashed border-slate-200 bg-slate-50/50 text-xs text-slate-400">
                    暂无项目
                  </div>
                ) : products.map(product => {
                  const editor = productEditors.get(product.id);
                  const isLocked = Boolean(editor);
                  const isDuplicate = duplicateIds.has(product.id);
                  const nextStatus = resolveNextStatus(product, advanceStatusConfigs);
                  const canAdvance = Boolean(nextStatus && onAdvance);
                  const stageDate = resolveStageDate(product);
                  const amounts = [
                    hasNumber(product.rmb) ? { fieldKey: 'rmb', currency: 'CNY', value: fmtWanAmount(product.rmb) } : null,
                    hasNumber(product.usd) ? { fieldKey: 'usd', currency: 'USD', value: fmtWanAmount(product.usd) } : null,
                  ].filter((item): item is NonNullable<typeof item> => Boolean(item));
                  const incomes = [
                    hasNumber(product.annualIncome) ? { fieldKey: 'annualIncome', label: '年化', value: fmtWanAmount(product.annualIncome) } : null,
                    hasNumber(product.thisYearIncome) ? { fieldKey: 'thisYearIncome', label: '本年', value: fmtWanAmount(product.thisYearIncome) } : null,
                    hasNumber(product.performanceIncome) ? { fieldKey: 'performanceIncome', label: '绩效', value: fmtWanAmount(product.performanceIncome) } : null,
                  ].filter((item): item is NonNullable<typeof item> => Boolean(item));
                  const channels = [
                    product.brokerChannel ? { fieldKey: 'brokerChannel', label: '渠道', value: product.brokerChannel } : null,
                    product.custodianBank ? { fieldKey: 'custodianBank', label: '托管', value: product.custodianBank } : null,
                    product.tradingBroker ? { fieldKey: 'tradingBroker', label: '交易', value: product.tradingBroker } : null,
                  ].filter((item): item is NonNullable<typeof item> => Boolean(item));

                  return (
                    <article
                      key={product.id}
                      role={onOpenDetail ? 'button' : undefined}
                      tabIndex={onOpenDetail && !isLocked ? 0 : -1}
                      onClick={() => {
                        if (isLocked) return;
                        onOpenDetail?.(product);
                      }}
                      onContextMenu={(event) => {
                        if (isLocked) return;
                        event.preventDefault();
                        event.stopPropagation();
                        setContextMenu({ product, x: event.clientX, y: event.clientY });
                      }}
                      onKeyDown={(event) => {
                        if (isLocked || !onOpenDetail) return;
                        if (event.target !== event.currentTarget) return;
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          onOpenDetail(product);
                        }
                      }}
                      aria-label={onOpenDetail ? `打开项目：${product.productName || '未命名项目'}` : undefined}
                      aria-disabled={isLocked}
                      data-project-id={product.id}
                      data-project-status={lane.key}
                      data-project-duplicate={isDuplicate ? 'true' : 'false'}
                      data-project-locked={isLocked ? 'true' : 'false'}
                      className={`mobile-unified-card group relative h-fit snap-start overflow-hidden border bg-white px-5 py-4 shadow-sm transition-[border-color,background-color,box-shadow] ${isDuplicate ? 'border-red-300 bg-red-50/30' : 'border-slate-200'} ${isLocked ? 'cursor-not-allowed bg-slate-100 opacity-60 grayscale' : 'hover:border-slate-300 hover:shadow-md'} ${selectedId === product.id ? 'app-selected-border z-10' : ''} ${onOpenDetail && !isLocked ? 'cursor-pointer' : ''}`}
                    >
                      {editor && <EditingLockOverlay editor={editor} />}
                      {isDuplicate && (
                        <span className={`absolute top-2 rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium leading-4 text-red-700 ${canAdvance ? 'right-10' : 'right-2'}`}>
                          重复
                        </span>
                      )}
                      {canAdvance && (
                        <button
                          type="button"
                          disabled={isLocked}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (!isLocked && nextStatus) onAdvance?.(product, nextStatus);
                          }}
                          onKeyDown={(event) => event.stopPropagation()}
                          aria-label={`推进至：${nextStatus}`}
                          title={`推进至：${nextStatus}`}
                          className="absolute right-3 top-3 z-10 block h-8 w-8 p-0 text-slate-400 transition hover:bg-slate-50 hover:text-primary-700 focus-visible:opacity-100 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          <span className="absolute inset-0 flex items-center justify-center"><ArrowRight size={14} className="block shrink-0" aria-hidden="true" /></span>
                        </button>
                      )}

                      <span className="pointer-events-none absolute left-0 top-4 h-16 w-1.5 bg-[var(--group-color)]" />
                      <DetailTargetCell
                          fieldKey="productName"
                          onOpen={(fieldKey) => onOpenDetail?.(product, fieldKey)}
                          disabled={isLocked}
                          className={`truncate text-base font-semibold leading-8 text-slate-900 ${isDuplicate && canAdvance ? 'pr-20' : isDuplicate || canAdvance ? 'pr-10' : ''}`}
                        >
                          <span title={product.productName}>{product.productName || '未命名项目'}</span>
                        </DetailTargetCell>

                        <div className="mt-3 flex min-w-0 items-center justify-between gap-4 border-b border-slate-100 pb-3 text-xs">
                          <div className="flex min-w-0 flex-1 items-center gap-1.5 font-medium tabular-nums text-slate-700">
                            <DollarSign size={14} className="shrink-0 text-slate-400" aria-hidden="true" />
                            <div className="flex min-w-0 items-center overflow-hidden whitespace-nowrap">
                              {amounts.length ? amounts.map((amount, index) => <span key={amount.fieldKey} className="min-w-0 truncate">{index > 0 && <span className="mx-1 text-slate-300">/</span>}{amount.value} {amount.currency}</span>) : <span className="text-slate-400">暂无规模</span>}
                            </div>
                          </div>
                          <DetailTargetCell fieldKey="trustManager" onOpen={(fieldKey) => onOpenDetail?.(product, fieldKey)} disabled={isLocked} className="flex max-w-[45%] shrink-0 items-center gap-1.5 truncate text-xs font-medium text-slate-700">
                            <UserRound size={14} className="shrink-0 text-slate-400" aria-hidden="true" />
                            <span className="truncate" title={`A角：${product.trustManager || '未分配'}${product.trustManagerB ? `；B角：${product.trustManagerB}` : ''}`}>
                              {product.trustManager || '未分配'}{product.trustManagerB ? ` / ${product.trustManagerB}` : ''}
                            </span>
                          </DetailTargetCell>
                        </div>

                      {visibleFieldKeys.length > 0 && <div className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                        {PROJECT_CARD_FIELD_OPTIONS.filter(option => visibleFieldKeys.includes(option.key)).map(option => {
                          const rawValue = product[option.key as keyof InvestmentProduct];
                          const value = option.key === 'feeRate'
                            ? (hasNumber(product.feeRate) ? formatPercent(Number(product.feeRate)) : '—')
                            : ['annualIncome', 'performanceIncome', 'thisYearIncome'].includes(option.key)
                              ? (hasNumber(rawValue as number) ? fmtWanAmount(rawValue as number) : '—')
                              : (rawValue as ReactNode) || '—';
                          const numeric = option.key === 'feeRate'
                            || option.key === 'establishDate'
                            || option.key.endsWith('Income');
                          return (
                            <ProjectCardField
                              key={option.key}
                              label={option.label}
                              fieldKey={option.key}
                              value={value}
                              onOpen={(fieldKey) => onOpenDetail?.(product, fieldKey)}
                              disabled={isLocked}
                              valueClassName={numeric ? 'tabular-nums' : ''}
                            />
                          );
                        })}
                      </div>}

                      <div className="hidden mt-2 space-y-0 text-xs leading-4 text-slate-600">
                        {(product.client || product.target) && (
                          <div className="flex min-w-0 items-center gap-1.5 px-1.5 py-0.5">
                            <Building2 size={14} className="shrink-0 text-slate-400" aria-hidden="true" />
                            <div className="flex min-w-0 items-center gap-1 overflow-hidden">
                              {product.client && (
                                <DetailTargetCell fieldKey="client" onOpen={(fieldKey) => onOpenDetail?.(product, fieldKey)} disabled={isLocked} className="min-w-0 truncate">
                                  <span title={product.client}>{product.client}</span>
                                </DetailTargetCell>
                              )}
                              {product.client && product.target && <span className="shrink-0 text-slate-300">·</span>}
                              {product.target && (
                                <DetailTargetCell fieldKey="target" onOpen={(fieldKey) => onOpenDetail?.(product, fieldKey)} disabled={isLocked} className="min-w-0 truncate">
                                  <span title={product.target}>{product.target}</span>
                                </DetailTargetCell>
                              )}
                            </div>
                          </div>
                        )}
                        {amounts.length > 0 && (
                          <div className="flex min-w-0 items-center gap-1.5 px-1.5 py-0.5 font-medium tabular-nums text-slate-700">
                            <DollarSign size={14} className="shrink-0 text-slate-400" aria-hidden="true" />
                            <div className="flex min-w-0 flex-1 items-center overflow-hidden whitespace-nowrap">
                              {amounts.map((amount, index) => (
                                <div key={amount.fieldKey} className="flex min-w-0 items-center">
                                  {index > 0 && <span className="mx-1 shrink-0 text-slate-300">/</span>}
                                  <DetailTargetCell
                                    fieldKey={amount.fieldKey}
                                    onOpen={(fieldKey) => onOpenDetail?.(product, fieldKey)}
                                    disabled={isLocked}
                                    className="min-w-0 truncate whitespace-nowrap"
                                  >
                                    <span title={`${amount.value} ${amount.currency}`}>{amount.value} {amount.currency}</span>
                                  </DetailTargetCell>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {hasNumber(product.feeRate) && (
                          <div className="flex min-w-0 items-center gap-1.5 px-1.5 py-0.5 font-medium tabular-nums text-slate-700">
                            <Percent size={14} className="shrink-0 text-slate-400" aria-hidden="true" />
                            <DetailTargetCell fieldKey="feeRate" onOpen={(fieldKey) => onOpenDetail?.(product, fieldKey)} disabled={isLocked} className="min-w-0 truncate whitespace-nowrap">
                              <span>{formatPercent(Number(product.feeRate))}费率</span>
                            </DetailTargetCell>
                          </div>
                        )}
                        <div className="flex min-w-0 items-center gap-1.5 px-1.5 py-0.5">
                          <UserRound size={14} className="shrink-0 text-slate-400" aria-hidden="true" />
                          <DetailTargetCell fieldKey="trustManager" onOpen={(fieldKey) => onOpenDetail?.(product, fieldKey)} disabled={isLocked} className="min-w-0 truncate">
                            <span title={`A角：${product.trustManager || '未分配'}${product.trustManagerB ? `；B角：${product.trustManagerB}` : ''}`}>
                              {product.trustManager || '未分配'}{product.trustManagerB ? ` / ${product.trustManagerB}` : ''}
                            </span>
                          </DetailTargetCell>
                        </div>
                        <div className="flex min-w-0 items-center gap-1.5 px-1.5 py-0.5">
                          <CalendarDays size={14} className="shrink-0 text-slate-400" aria-hidden="true" />
                          <DetailTargetCell fieldKey="deadline" onOpen={(fieldKey) => onOpenDetail?.(product, fieldKey)} disabled={isLocked} className={`min-w-0 truncate ${deadlineTone(product.deadline)}`}>
                            <span title={product.deadline}>截止 {product.deadline || '未设置'}</span>
                          </DetailTargetCell>
                        </div>
                      </div>

                      {(product.strategy || channels.length > 0 || incomes.length > 0 || stageDate || product.remarks) && (
                        <div className="hidden mt-2 space-y-1.5 border-t border-slate-100 px-1.5 pt-2 text-xs">
                          {product.strategy && (
                            <ProjectMetaRow label="策略">
                              <DetailTargetCell fieldKey="strategy" onOpen={(fieldKey) => onOpenDetail?.(product, fieldKey)} disabled={isLocked} className="truncate">
                                <span title={`策略：${product.strategy}`}>{product.strategy}</span>
                              </DetailTargetCell>
                            </ProjectMetaRow>
                          )}

                          {channels.length > 0 && (
                            <ProjectMetaRow label="渠道">
                              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5">
                                {channels.map(channel => (
                                  <DetailTargetCell key={channel.fieldKey} fieldKey={channel.fieldKey} onOpen={(fieldKey) => onOpenDetail?.(product, fieldKey)} disabled={isLocked} className="max-w-full truncate whitespace-nowrap">
                                    <span title={`${channel.label}：${channel.value}`}>
                                      {channel.fieldKey !== 'brokerChannel' && <span className="mr-1 text-slate-400">{channel.label}</span>}
                                      {channel.value}
                                    </span>
                                  </DetailTargetCell>
                                ))}
                              </div>
                            </ProjectMetaRow>
                          )}

                          {incomes.length > 0 && (
                            <ProjectMetaRow label="收入">
                              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 tabular-nums">
                                {incomes.map(income => (
                                  <DetailTargetCell key={income.fieldKey} fieldKey={income.fieldKey} onOpen={(fieldKey) => onOpenDetail?.(product, fieldKey)} disabled={isLocked} className="max-w-full truncate whitespace-nowrap">
                                    <span title={`${income.label}收入：${income.value}`}><span className="mr-1 text-slate-400">{income.label}</span>{income.value}</span>
                                  </DetailTargetCell>
                                ))}
                              </div>
                            </ProjectMetaRow>
                          )}

                          {stageDate && (
                            <ProjectMetaRow label={stageDate.label}>
                              <DetailTargetCell fieldKey={stageDate.fieldKey} onOpen={(fieldKey) => onOpenDetail?.(product, fieldKey)} disabled={isLocked} className="truncate tabular-nums">
                                <span title={`${stageDate.label}日期：${stageDate.value}`}>{stageDate.value}</span>
                              </DetailTargetCell>
                            </ProjectMetaRow>
                          )}

                          {product.remarks && (
                            <ProjectMetaRow label="备注">
                              <DetailTargetCell fieldKey="remarks" onOpen={(fieldKey) => onOpenDetail?.(product, fieldKey)} disabled={isLocked} className="line-clamp-2 text-slate-600">
                                <span title={product.remarks}>{product.remarks}</span>
                              </DetailTargetCell>
                            </ProjectMetaRow>
                          )}
                        </div>
                      )}

                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
      {contextMenu && (() => {
        const nextStatus = resolveNextStatus(contextMenu.product, advanceStatusConfigs);
        const previousStatus = resolvePreviousStatus(contextMenu.product, advanceStatusConfigs);
        const product = contextMenu.product;
        return <ContextMenu x={contextMenu.x} y={contextMenu.y} onClose={() => setContextMenu(null)} items={[
          { key: 'next', label: '推进到下一阶段', icon: <ArrowRight size={14} />, disabled: !nextStatus || !onAdvance, onSelect: () => nextStatus && onAdvance?.(product, nextStatus) },
          { key: 'previous', label: '返回上一阶段', icon: <ArrowLeft size={14} />, disabled: !previousStatus || !onRetreat, onSelect: () => previousStatus && onRetreat?.(product, previousStatus) },
          { key: 'delete', label: '删除', icon: <Trash2 size={14} />, danger: true, separatorBefore: true, onSelect: () => onDelete?.(product) },
        ]} />;
      })()}
    </div>
  );
}
