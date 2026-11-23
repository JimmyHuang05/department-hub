import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Clock, RotateCcw, Play, Pause, ChevronLeft, ChevronRight, FastForward } from 'lucide-react';
import { api } from '../../lib/api';
import { useCollaborationStore } from '../../store/collaborationStore';

interface HistoryEntry {
  id: string;
  field: string;
  oldValue: string;
  newValue: string;
  editedBy: string;
  editedAt: string;
}

interface VersionHistoryProps {
  recordId: string;
  recordType: 'product' | 'entry';
  onClose: () => void;
  onRestore?: (field: string, value: string) => void;
}

/**
 * VersionHistory - 编辑历史版本与操作回放弹窗
 *
 * 两种模式：
 * 1. 列表模式（默认）：按时间倒序显示所有编辑记录，支持恢复到指定版本
 * 2. 回放模式：按时间正序逐条播放编辑过程，支持 Play/Pause、步进、速度控制
 *
 * 输入参数：
 *   recordId   - 产品/日志记录 ID
 *   recordType - 记录类型 'product' | 'entry'
 *   onClose    - 关闭弹窗回调
 *   onRestore  - 恢复版本回调 (field, oldValue) => void
 *
 * 输出：
 *   无直接输出，通过 onRestore 回调将字段值恢复到上层组件
 */
export default function VersionHistory({ recordId, recordType, onClose, onRestore }: VersionHistoryProps) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [replayMode, setReplayMode] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const { onlineUsers } = useCollaborationStore();
  const playTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 加载历史数据
  const loadHistory = useCallback(async (asc: boolean) => {
    setLoading(true);
    try {
      const orderParam = asc ? '?order=asc' : '';
      const res = await api.get<{ entries: HistoryEntry[] }>(`/history/${recordType}/${recordId}${orderParam}`);
      setHistory(res.entries);
    } catch {
      // 静默失败
    } finally {
      setLoading(false);
    }
  }, [recordId, recordType]);

  useEffect(() => {
    loadHistory(replayMode);
  }, [replayMode, loadHistory]);

  // 进入/退出回放模式时重置状态
  useEffect(() => {
    setCurrentStep(0);
    setIsPlaying(false);
    if (playTimerRef.current) {
      clearTimeout(playTimerRef.current);
      playTimerRef.current = null;
    }
  }, [replayMode]);

  // 自动播放逻辑
  useEffect(() => {
    if (!isPlaying || currentStep >= history.length - 1) {
      if (currentStep >= history.length - 1 && isPlaying) {
        setIsPlaying(false);
      }
      return;
    }
    const interval = Math.max(500, 2000 / speed);
    playTimerRef.current = setTimeout(() => {
      setCurrentStep(prev => Math.min(prev + 1, history.length - 1));
    }, interval);
    return () => {
      if (playTimerRef.current) clearTimeout(playTimerRef.current);
    };
  }, [isPlaying, currentStep, speed, history.length]);

  const getUserName = (userId: string) => {
    const user = onlineUsers.find(u => u.userId === userId);
    return user?.displayName || userId.slice(0, 8);
  };

  const getFieldLabel = (field: string) => field;

  // 步进控制
  const goToStep = (step: number) => {
    setCurrentStep(Math.max(0, Math.min(step, history.length - 1)));
  };

  const togglePlay = () => {
    if (currentStep >= history.length - 1) {
      setCurrentStep(0); // 播完后重头开始
    }
    setIsPlaying(prev => !prev);
  };

  const speedOptions = [1, 2, 4];

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-2xl w-[90vw] max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}>
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <Clock size={18} className="text-slate-500" />
            <h3 className="text-base font-semibold text-slate-900">
              {replayMode ? '操作回放' : '编辑历史版本'}
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setReplayMode(!replayMode)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                replayMode
                  ? 'bg-brand-500 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {replayMode ? '回放模式' : '列表模式'}
            </button>
            <button onClick={onClose}
              className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors text-slate-400 hover:text-slate-600">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* 内容区域 */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {loading ? (
            <div className="py-8 text-center text-slate-400 text-sm">加载中...</div>
          ) : history.length === 0 ? (
            <div className="py-8 text-center text-slate-400 text-sm">暂无历史记录</div>
          ) : (
            <div className="space-y-2">
              {history.map((entry, idx) => {
                const isHighlighted = replayMode && idx === currentStep;
                const isPast = replayMode && idx < currentStep;
                const isFuture = replayMode && idx > currentStep;
                return (
                  <div
                    key={entry.id}
                    className={`p-3 rounded-lg border transition-all duration-300 ${
                      isHighlighted
                        ? 'border-brand-400 bg-brand-50 shadow-md scale-[1.02]'
                        : isPast
                          ? 'border-green-200 bg-green-50/50 opacity-70'
                          : isFuture
                            ? 'border-slate-100 bg-slate-50 opacity-50'
                            : 'bg-slate-50 border-slate-100'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
                          {replayMode && (
                            <span className={`font-mono text-[10px] ${isHighlighted ? 'text-brand-600 font-bold' : 'text-slate-400'}`}>
                              #{idx + 1}
                            </span>
                          )}
                          <span className="font-medium text-slate-700">{getUserName(entry.editedBy)}</span>
                          <span>修改了</span>
                          <span className="font-mono bg-slate-200 px-1 rounded">{getFieldLabel(entry.field)}</span>
                          <span>{new Date(entry.editedAt).toLocaleString('zh-CN')}</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm">
                          <span className="text-red-600 line-through max-w-[200px] truncate">{entry.oldValue || '(空)'}</span>
                          <span className="text-slate-400">→</span>
                          <span className="text-green-600 max-w-[200px] truncate">{entry.newValue || '(空)'}</span>
                        </div>
                      </div>
                      {!replayMode && onRestore && (
                        <button
                          onClick={() => onRestore(entry.field, entry.oldValue)}
                          className="flex-shrink-0 p-1 text-brand-600 hover:bg-brand-100 rounded transition-colors"
                          title="恢复到该版本"
                        >
                          <RotateCcw size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 底部：回放控制栏 / 统计信息 */}
        <div className="px-5 py-2.5 border-t border-slate-200">
          {replayMode && history.length > 0 ? (
            <div className="space-y-2">
              {/* 时间轴滑块 */}
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-slate-400 w-6 text-right">{currentStep + 1}</span>
                <input
                  type="range"
                  min={0}
                  max={history.length - 1}
                  value={currentStep}
                  onChange={(e) => goToStep(Number(e.target.value))}
                  className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer
                    bg-slate-200 accent-brand-500
                    [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3
                    [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-brand-500 [&::-webkit-slider-thumb]:shadow"
                />
                <span className="text-[10px] text-slate-400 w-6">{history.length}</span>
              </div>
              {/* 播放控制按钮 */}
              <div className="flex items-center justify-center gap-3">
                <button
                  onClick={() => goToStep(0)}
                  className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors"
                  title="跳转到开头"
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  onClick={() => goToStep(currentStep - 1)}
                  disabled={currentStep <= 0}
                  className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors disabled:opacity-30"
                  title="上一步"
                >
                  <ChevronLeft size={18} />
                </button>
                <button
                  onClick={togglePlay}
                  className={`p-2 rounded-full transition-colors ${
                    isPlaying
                      ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                      : 'bg-brand-500 text-white hover:bg-brand-600'
                  }`}
                  title={isPlaying ? '暂停' : '播放'}
                >
                  {isPlaying ? <Pause size={18} /> : <Play size={18} />}
                </button>
                <button
                  onClick={() => goToStep(currentStep + 1)}
                  disabled={currentStep >= history.length - 1}
                  className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors disabled:opacity-30"
                  title="下一步"
                >
                  <ChevronRight size={18} />
                </button>
                <button
                  onClick={() => goToStep(history.length - 1)}
                  className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors"
                  title="跳转到结尾"
                >
                  <ChevronRight size={16} />
                </button>
                {/* 速度选择 */}
                <div className="flex items-center gap-1 ml-4 pl-4 border-l border-slate-200">
                  <FastForward size={14} className="text-slate-400" />
                  {speedOptions.map(s => (
                    <button
                      key={s}
                      onClick={() => setSpeed(s)}
                      className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                        speed === s
                          ? 'bg-brand-500 text-white'
                          : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                      }`}
                    >
                      {s}x
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-xs text-slate-400 text-center">
              共 {history.length} 条修改记录
              {history.length > 1 && !replayMode && (
                <span className="ml-2">—— 点击「回放模式」逐条查看编辑过程</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
