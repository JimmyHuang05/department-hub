import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, UserRound } from 'lucide-react';

interface ManagerScopeFilterProps {
  isAdmin: boolean;
  accountName: string;
  managers: string[];
  selectedManagers: string[];
  onlyMine: boolean;
  onManagersChange: (managers: string[]) => void;
  onOnlyMineChange: (enabled: boolean) => void;
  scopeLabel: string;
}

export default function ManagerScopeFilter({ isAdmin, accountName, managers, selectedManagers, onlyMine, onManagersChange, onOnlyMineChange, scopeLabel }: ManagerScopeFilterProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const options = [...new Set(managers.map(value => value.trim()).filter(Boolean))];

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  if (!isAdmin) return <button
    type="button"
    disabled={!accountName}
    aria-pressed={onlyMine}
    aria-label={onlyMine ? `显示全部${scopeLabel}` : `只显示我参与的${scopeLabel}`}
    title={accountName ? `${onlyMine ? '取消只看我的' : '只看我的'}（${accountName}）` : '请先在个人中心设置姓名'}
    onClick={() => onOnlyMineChange(!onlyMine)}
    className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${onlyMine ? 'border-primary-600 bg-primary-600 text-white' : 'border-slate-200 bg-white text-slate-500 hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700'}`}
  ><UserRound size={17} /></button>;

  const label = selectedManagers.length === 0 ? '全部经理' : selectedManagers.length === 1 ? selectedManagers[0] : `已选 ${selectedManagers.length} 位`;
  return <div ref={rootRef} className="relative shrink-0">
    <button type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(value => !value)} className={`inline-flex h-10 min-w-28 items-center justify-between gap-2 rounded-lg border bg-white px-3 text-sm transition-colors ${selectedManagers.length ? 'border-primary-300 text-primary-700' : 'border-slate-200 text-slate-600 hover:border-primary-200'}`}>
      <span className="inline-flex min-w-0 items-center gap-2"><UserRound size={16} className="shrink-0" /><span className="max-w-28 truncate">{label}</span></span><ChevronDown size={14} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
    {open && <div className="absolute right-0 top-[calc(100%+6px)] z-50 w-56 border border-slate-200 bg-white p-1.5 shadow-xl" role="listbox" aria-multiselectable="true">
      <button type="button" onClick={() => onManagersChange([])} className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm ${selectedManagers.length === 0 ? 'bg-primary-50 text-primary-700' : 'text-slate-700 hover:bg-slate-50'}`}><span className={`flex h-4 w-4 items-center justify-center border ${selectedManagers.length === 0 ? 'border-primary-600 bg-primary-600 text-white' : 'border-slate-300'}`}>{selectedManagers.length === 0 && <Check size={11} />}</span><span>全部经理</span></button>
      <div className="my-1 border-t border-slate-100" />
      <div className="max-h-64 overflow-y-auto">{options.map(manager => { const checked = selectedManagers.includes(manager); return <button key={manager} type="button" role="option" aria-selected={checked} onClick={() => onManagersChange(checked ? selectedManagers.filter(value => value !== manager) : [...selectedManagers, manager])} className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm ${checked ? 'bg-primary-50 text-primary-700' : 'text-slate-700 hover:bg-slate-50'}`}><span className={`flex h-4 w-4 items-center justify-center border ${checked ? 'border-primary-600 bg-primary-600 text-white' : 'border-slate-300'}`}>{checked && <Check size={11} />}</span><span className="truncate">{manager}</span></button>; })}</div>
      {!options.length && <div className="px-3 py-5 text-center text-xs text-slate-400">暂无经理</div>}
    </div>}
  </div>;
}
