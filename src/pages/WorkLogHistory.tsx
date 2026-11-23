import { useState, useMemo, useEffect } from 'react';
import { useWorkLogStore } from '../store/workLogStore';
import { WorkLogEntry } from '../types';
import { getWeekRange, getWeekNumber } from '../utils/week';
import { ChevronDown, ChevronRight, Calendar } from 'lucide-react';

const CATEGORIES = [
  { key: '正常项目', label: '正常项目' },
  { key: '问题项目', label: '问题项目' },
  { key: '直销产品情况', label: '直销产品情况' },
] as const;
type CategoryKey = (typeof CATEGORIES)[number]['key'];

export default function WorkLogHistory() {
  const { entries, fetchEntries } = useWorkLogStore();
  const [expandedWeeks, setExpandedWeeks] = useState<Set<string>>(new Set());
  const [activeCategory, setActiveCategory] = useState<CategoryKey>('正常项目');

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const cat of CATEGORIES) {
      counts[cat.key] = entries.filter(e => e.category === cat.key).length;
    }
    return counts;
  }, [entries]);

  const filteredEntries = useMemo(() => {
    return entries.filter(e => e.category === activeCategory);
  }, [entries, activeCategory]);

  const allWeekKeysFromProgress = useMemo(() => {
    const keys = new Set<string>();
    filteredEntries.forEach(e => {
      if (e.weeklyProgress) Object.keys(e.weeklyProgress).forEach(k => keys.add(k));
    });
    return keys;
  }, [filteredEntries]);

  const grouped = useMemo(() => {
    const map = new Map<string, { type: 'entry' | 'progress'; items: { entry: WorkLogEntry; progressText?: string }[] }>();
    filteredEntries.forEach(e => {
      const key = e.weekKey || '__legacy__';
      if (!map.has(key)) map.set(key, { type: 'entry', items: [] });
      map.get(key)!.items.push({ entry: e });
    });
    allWeekKeysFromProgress.forEach(weekKey => {
      if (map.has(weekKey)) return;
      const items: { entry: WorkLogEntry; progressText: string }[] = [];
      filteredEntries.forEach(e => {
        if (e.weeklyProgress && e.weeklyProgress[weekKey]) {
          items.push({ entry: e, progressText: e.weeklyProgress[weekKey] });
        }
      });
      if (items.length > 0) map.set(weekKey, { type: 'progress', items });
    });
    return Array.from(map.entries()).sort(([a], [b]) => {
      if (a === '__legacy__') return 1;
      if (b === '__legacy__') return -1;
      return b.localeCompare(a);
    });
  }, [filteredEntries, allWeekKeysFromProgress]);

  const toggleWeek = (weekKey: string) => {
    setExpandedWeeks(prev => {
      const next = new Set(prev);
      if (next.has(weekKey)) next.delete(weekKey);
      else next.add(weekKey);
      return next;
    });
  };

  const getWeekTitle = (key: string) => {
    if (key === '__legacy__') return '原始导入数据';
    const range = getWeekRange(key);
    const wn = getWeekNumber(key);
    return `第 ${wn} 周（${range.start}~${range.end}）`;
  };

  return (
    <div className="flex h-full w-full flex-col gap-5">

      {/* 分类 Tab */}
      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
        <div className="flex flex-wrap gap-1">
        {CATEGORIES.map(tab => (
          <button key={tab.key} onClick={() => { setActiveCategory(tab.key); setExpandedWeeks(new Set()); }}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              activeCategory === tab.key ? 'bg-primary-50 text-primary-700' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
            }`}>
            {tab.label}
            <span className="ml-1.5 text-xs text-slate-400">({categoryCounts[tab.key] || 0})</span>
          </button>
        ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-3" key={activeCategory}>
        {grouped.length === 0 && (
          <div className="flex h-full min-h-[420px] items-center justify-center text-slate-400">
            <div className="text-center">
              <Calendar size={48} className="mx-auto mb-3 text-slate-300" />
              <p className="text-sm">暂无{activeCategory}历史记录</p>
            </div>
          </div>
        )}

        {grouped.map(([weekKey, group]) => {
          const isExpanded = expandedWeeks.has(weekKey);
          const { type, items } = group;
          const weekTitle = getWeekTitle(weekKey);
          return (
            <div key={weekKey} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <button onClick={() => toggleWeek(weekKey)}
                className="w-full flex min-h-12 items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors cursor-pointer">
                {isExpanded ? <ChevronDown size={18} className="shrink-0 text-slate-400" /> : <ChevronRight size={18} className="shrink-0 text-slate-400" />}
                <Calendar size={16} className="shrink-0 text-slate-400" />
                <span className="min-w-0 flex-1 truncate text-left font-medium text-slate-800" title={weekTitle}>{weekTitle}</span>
                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">{items.length} 条</span>
                {type === 'progress' && (
                  <span className="shrink-0 rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700">周进展汇总</span>
                )}
              </button>
              {isExpanded && (
                <div className="border-t border-slate-200 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">产品名</th>
                        {type === 'entry' && (
                          <>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">状态</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">客户</th>
                          </>
                        )}
                        <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">本周进展</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {items.map((item) => (
                        <tr key={item.entry.id} className="hover:bg-slate-50">
                          <td className="px-3 py-2 text-slate-700 font-medium whitespace-nowrap">{item.entry.productName}</td>
                          {type === 'entry' && (
                            <>
                              <td className="px-3 py-2 whitespace-nowrap">
                                <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-brand-50 text-brand-700">{item.entry.status}</span>
                              </td>
                              <td className="px-3 py-2 text-slate-600 max-w-[150px] truncate">{item.entry.clientType || '-'}</td>
                            </>
                          )}
                          <td className="px-3 py-2 text-slate-500 text-xs max-w-[200px] truncate">
                            {'progressText' in item && item.progressText
                              ? item.progressText
                              : (() => {
                                  const keys = Object.keys(item.entry.weeklyProgress);
                                  return keys.length > 0 ? item.entry.weeklyProgress[keys[keys.length - 1]] : item.entry.nextWeekPlan || '-';
                                })()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
