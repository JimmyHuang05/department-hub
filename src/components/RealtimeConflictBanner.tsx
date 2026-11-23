import { AlertTriangle, RefreshCw, X } from 'lucide-react';
import type { DataChangeEvent } from '../lib/realtime';

export default function RealtimeConflictBanner({ event, onReload, onKeep }: {
  event: DataChangeEvent | null;
  onReload: () => void | Promise<void>;
  onKeep: () => void;
}) {
  if (!event) return null;
  const deleted = event.action === 'deleted';
  return <div role="alert" className="relative z-30 flex shrink-0 items-center gap-3 border-b border-amber-200 bg-amber-50 px-5 py-2.5 text-sm text-amber-950">
    <AlertTriangle size={17} className="shrink-0 text-amber-600" />
    <div className="min-w-0 flex-1"><span className="font-medium">{deleted ? '这条内容已被其他用户删除' : '其他用户刚刚更新了这条内容'}</span><span className="ml-2 text-amber-800">当前输入尚未被覆盖，请选择如何处理。</span>{event.changedFields?.length ? <span className="ml-2 text-xs text-amber-700">变更字段：{event.changedFields.join('、')}</span> : null}</div>
    {!deleted && <button type="button" onClick={() => void onReload()} className="inline-flex h-8 items-center gap-1.5 border border-amber-300 bg-white px-3 font-medium hover:bg-amber-100"><RefreshCw size={14} />载入新版</button>}
    <button type="button" onClick={onKeep} className="h-8 border border-amber-300 bg-white px-3 font-medium hover:bg-amber-100">保留我的修改</button>
    <button type="button" onClick={onKeep} className="flex h-8 w-8 items-center justify-center text-amber-700 hover:bg-amber-100" aria-label="稍后处理"><X size={15} /></button>
  </div>;
}
