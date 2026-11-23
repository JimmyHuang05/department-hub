import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Download, LayoutGrid, Plus, Search, Trash2, Upload } from 'lucide-react';
import { MobileOptionWheelSheet } from '../MobileWheelPicker';

interface WeekOption {
  key: string;
  label: string;
}

interface ToolbarMenuAction {
  label: string;
  onClick: () => void;
  icon?: ReactNode;
  hideOnMobile?: boolean;
}

interface ToolbarViewOption {
  key: string;
  label: string;
  count?: number;
  active?: boolean;
  onClick: () => void;
}

interface TableToolbarProps {
  className?: string;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  selectedCount: number;
  onDeleteSelected?: () => void;
  onExport: () => void;
  exportLabel?: string;
  exportDisabled?: boolean;
  hideExportAction?: boolean;
  onImport?: () => void;
  onRefresh?: () => void;
  onAdd?: () => void;
  searchPlaceholder?: string;
  weekDateLabel?: string;
  weekOptions?: WeekOption[];
  selectedWeekKey?: string | null;
  onWeekChange?: (key: string | null) => void;
  hideSearch?: boolean;
  leadingContent?: ReactNode;
  weekLeadingContent?: ReactNode;
  menuAction?: ToolbarMenuAction;
  menuActions?: ToolbarMenuAction[];
  hideActions?: boolean;
  hideTransferOnMobile?: boolean;
  viewOptions?: ToolbarViewOption[];
}

function compactWeekLabel(label: string) {
  const match = label.match(/^(?:\d{4}年)?第(\d+)周\s+(\d{1,2})月(\d{1,2})日[-—–至]+(\d{1,2})月(\d{1,2})日$/);
  if (!match) return label;
  return `第${match[1]}周 · ${match[2]}/${match[3]}–${match[4]}/${match[5]}`;
}

function weekParts(label: string) {
  const match = label.match(/^(?:(\d{4})年)?第(\d+)周\s+(\d{1,2})月(\d{1,2})日[-—–至]+(\d{1,2})月(\d{1,2})日$/);
  if (!match) return { year: '', week: label, date: '' };
  return { year: match[1] || '', week: `第${match[2]}周`, date: `${match[3]}/${match[4]}–${match[5]}/${match[6]}` };
}

export default function TableToolbar({
  className = '',
  searchQuery,
  onSearchChange,
  selectedCount,
  onDeleteSelected,
  onExport,
  exportLabel = '导出',
  exportDisabled = false,
  hideExportAction = false,
  onImport,
  searchPlaceholder = '搜索...',
  onAdd,
  weekDateLabel,
  weekOptions = [],
  selectedWeekKey,
  onWeekChange,
  hideSearch = false,
  leadingContent,
  weekLeadingContent,
  menuAction,
  menuActions = [],
  hideActions = false,
  hideTransferOnMobile = false,
  viewOptions = [],
}: TableToolbarProps) {
  const [weekOpen, setWeekOpen] = useState(false);
  const weekRef = useRef<HTMLDivElement>(null);
  const canSelectWeek = Boolean(onWeekChange && weekOptions.length > 0);
  const selectedWeekIndex = weekOptions.findIndex(option => option.key === selectedWeekKey);
  const previousWeek = selectedWeekIndex >= 0 ? weekOptions[selectedWeekIndex + 1] : undefined;
  const nextWeek = selectedWeekIndex > 0 ? weekOptions[selectedWeekIndex - 1] : undefined;
  const weekGroups = weekOptions.reduce<Array<{ year: string; options: WeekOption[] }>>((groups, option) => {
    const year = weekParts(option.label).year || '历史周';
    const previous = groups[groups.length - 1];
    if (previous?.year === year) previous.options.push(option);
    else groups.push({ year, options: [option] });
    return groups;
  }, []);

  useEffect(() => {
    if (!weekOpen) return;
    const close = (event: MouseEvent) => {
      if ((event.target as Element | null)?.closest?.('.mobile-wheel-layer')) return;
      if (weekRef.current?.contains(event.target as Node)) return;
      setWeekOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [weekOpen]);

  return (
    <div className={`flex w-full flex-col gap-3 lg:flex-row lg:items-center lg:justify-between ${className}`}>
      {leadingContent ? (
        <div className="flex w-full min-w-0 flex-wrap items-center gap-2 lg:flex-1">
          {leadingContent}
        </div>
      ) : !hideSearch && (
        <div className="relative w-full min-w-0 lg:w-1/2 lg:max-w-none lg:flex-none">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" size={17} />
          <input
            type="text"
            placeholder={searchPlaceholder}
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            className="app-control h-10 w-full pl-9 pr-9 text-sm"
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 lg:ml-auto lg:justify-end">
        {onAdd && (
          <button
            onClick={onAdd}
            className="app-button-primary h-10"
          >
            <Plus size={16} />
            <span>新增</span>
          </button>
        )}
        {selectedCount > 0 && (
          <button
            onClick={onDeleteSelected}
            className="app-button-danger h-10"
          >
            <Trash2 size={16} />
            <span>删除 ({selectedCount})</span>
          </button>
        )}
        {weekLeadingContent}
        {weekDateLabel && (
          <div className="mobile-week-stepper flex min-w-0 items-center">
            <button
              type="button"
              disabled={!nextWeek}
              onClick={() => nextWeek && onWeekChange?.(nextWeek.key)}
              className="flex h-10 w-9 shrink-0 items-center justify-center border border-r-0 border-surface-200 bg-white text-surface-500 disabled:text-surface-200 lg:hidden"
              aria-label="切换到下一周"
              title="下一周"
            >
              <ChevronLeft size={17} />
            </button>
          <div ref={weekRef} className="relative min-w-0 flex-1">
            <button
              type="button"
              onClick={() => canSelectWeek && setWeekOpen(value => !value)}
              title={weekDateLabel}
              aria-label={`历史周：${weekDateLabel}`}
              className={`app-button-secondary h-10 max-w-[230px] gap-2 px-2 ${canSelectWeek ? '' : 'cursor-default'}`}
            >
              <CalendarDays size={19} strokeWidth={1.8} className="shrink-0 text-surface-500" />
              {(() => { const current = weekParts(weekDateLabel); return <><span className="shrink-0 bg-surface-100 px-2 py-1 text-xs font-semibold tabular-nums text-surface-800">{current.week}</span><span className="min-w-0 truncate whitespace-nowrap text-xs tabular-nums text-surface-500">{current.date || compactWeekLabel(weekDateLabel)}</span></>; })()}
              {canSelectWeek && <ChevronDown size={14} className={`shrink-0 text-surface-400 transition-transform ${weekOpen ? 'rotate-180' : ''}`} />}
            </button>
            {canSelectWeek && weekOpen && (
              <div className="app-float absolute right-0 top-[calc(100%+8px)] z-40 hidden w-60 overflow-hidden lg:block">
                <div className="max-h-52 overflow-y-auto">
                  {weekGroups.map(group => <div key={group.year}>
                    <div className="sticky top-0 z-20 border-b border-surface-100 bg-white px-3 py-2 text-xs font-semibold tabular-nums text-surface-500">{group.year === '历史周' ? group.year : `${group.year} 年`}</div>
                    {group.options.map(option => {
                    const active = option.key === selectedWeekKey;
                    const optionParts = weekParts(option.label);
                    return (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() => {
                          onWeekChange?.(option.key);
                          setWeekOpen(false);
                        }}
                        className={`mx-1.5 flex h-10 w-[calc(100%-0.75rem)] items-center gap-2 px-2.5 text-left transition-colors ${active ? 'bg-primary-50 text-primary-800' : 'text-surface-700 hover:bg-surface-50'}`}
                      >
                        <span className={`shrink-0 px-2 py-1 text-xs font-semibold tabular-nums ${active ? 'bg-primary-600 text-primary-contrast' : 'bg-surface-100 text-surface-700'}`}>{optionParts.week}</span>
                        <span className="min-w-0 truncate text-xs tabular-nums text-surface-500">{optionParts.date || option.label}</span>
                        {active && <span className="ml-auto text-[10px] font-medium text-primary-700">当前</span>}
                      </button>
                    );
                    })}
                  </div>)}
                </div>
              </div>
            )}
            {canSelectWeek && <MobileOptionWheelSheet
              open={weekOpen}
              title="历史周"
              value={selectedWeekKey}
              options={weekOptions.map(option => ({ value: option.key, label: compactWeekLabel(option.label) }))}
              onClose={() => setWeekOpen(false)}
              onChange={key => onWeekChange?.(key)}
            />}
          </div>
            <button
              type="button"
              disabled={!previousWeek}
              onClick={() => previousWeek && onWeekChange?.(previousWeek.key)}
              className="flex h-10 w-9 shrink-0 items-center justify-center border border-l-0 border-surface-200 bg-white text-surface-500 disabled:text-surface-200 lg:hidden"
              aria-label="切换到上一周"
              title="上一周"
            >
              <ChevronRight size={17} />
            </button>
          </div>
        )}
        {!hideActions && <div
          className="group/actions relative"
        >
          <button
            type="button"
            aria-haspopup="menu"
            aria-label="功能"
            title="功能"
            className="app-button-secondary h-10 w-10 !p-0"
          >
            <LayoutGrid size={17} strokeWidth={1.8} className="shrink-0 text-surface-500" />
          </button>
          <div
            className="pointer-events-none invisible absolute right-0 top-full z-50 w-40 translate-y-1 pt-2 opacity-0 transition-all duration-150 group-hover/actions:pointer-events-auto group-hover/actions:visible group-hover/actions:translate-y-0 group-hover/actions:opacity-100 group-focus-within/actions:pointer-events-auto group-focus-within/actions:visible group-focus-within/actions:translate-y-0 group-focus-within/actions:opacity-100"
            role="menu"
          >
            <div className="app-float overflow-hidden p-1.5">
              {onImport && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={onImport}
                  className={`app-menu-item h-9 ${hideTransferOnMobile ? 'hidden lg:flex' : ''}`}
                >
                  <Upload size={15} />
                  <span>导入</span>
                </button>
              )}
              {!hideExportAction && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={onExport}
                  disabled={exportDisabled}
                  className={`app-menu-item h-9 disabled:cursor-not-allowed disabled:opacity-40 ${hideTransferOnMobile ? 'hidden lg:flex' : ''}`}
                >
                  <Download size={15} />
                  <span>{exportLabel}</span>
                </button>
              )}
              {menuAction && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={menuAction.onClick}
                  className={`app-menu-item h-9 ${menuAction.hideOnMobile ? 'hidden lg:flex' : ''}`}
                >
                  <span className="flex h-[15px] w-[15px] items-center justify-center text-surface-400">{menuAction.icon}</span>
                  <span>{menuAction.label}</span>
                </button>
              )}
              {viewOptions.length > 0 && (
                <div className="mt-1 border-t border-surface-100 pt-1">
                  {viewOptions.map(option => (
                    <button
                      key={option.key}
                      type="button"
                      role="menuitemradio"
                      aria-checked={option.active}
                      onClick={option.onClick}
                      className={`app-menu-item h-9 ${option.active ? 'bg-primary-50 text-primary-700' : ''}`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${option.active ? 'bg-primary-600' : 'bg-surface-300'}`} />
                      <span className="min-w-0 flex-1 truncate">{option.label}</span>
                      {typeof option.count === 'number' && <span className="text-xs tabular-nums text-surface-400">{option.count}</span>}
                    </button>
                  ))}
                </div>
              )}
              {menuActions.map(action => (
                <button
                  key={action.label}
                  type="button"
                  role="menuitem"
                  onClick={action.onClick}
                  className={`app-menu-item h-9 ${action.hideOnMobile ? 'hidden lg:flex' : ''}`}
                >
                  <span className="flex h-[15px] w-[15px] items-center justify-center text-surface-400">{action.icon}</span>
                  <span>{action.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>}
      </div>
    </div>
  );
}
