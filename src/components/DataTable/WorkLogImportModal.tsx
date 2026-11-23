import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { X, Upload, FileSpreadsheet, AlertTriangle, CheckCircle, FileUp } from 'lucide-react';
import { ImportMode } from '../../types';
import { parseWorkLogXLSX, WorkLogParseResult } from '../../utils/worklog-import-utils';
import { _toast } from '../../store/toastRef';
import { getWeekRange, getWeekNumber } from '../../utils/week';
import { useConfirm } from '../Toast';

interface WorkLogImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (rows: any[], mode: ImportMode) => void | Promise<void>;
  defaultWeekKey?: string;
  /** 外部传入的已选文件（拖拽导入用） */
  initialFile?: File | null;
}

// 所有模块字段定义
const ALL_FIELDS = [
  { key: 'productName', label: '产品名' },
  { key: 'category', label: '分类' },
  { key: 'subCategory', label: '项目分类' },
  { key: 'status', label: '状态' },
  { key: 'clientType', label: '客户名称/类型' },
  { key: 'navScale', label: '净值/规模情况' },
  { key: 'establishDate', label: '成立日/拟成立日' },
  { key: 'productTerm', label: '产品期限' },
  { key: 'personA', label: 'A角' },
  { key: 'personB', label: 'B角' },
  { key: 'activePassive', label: '主动/被动' },
  { key: 'collectiveSingle', label: '集合/单一' },
  { key: 'advisorManager', label: '投资顾问/管理人' },
  { key: 'channelSales', label: '渠道销售' },
  { key: 'features', label: '特色' },
  { key: 'managementReport', label: '管理报告' },
  { key: 'riskReport', label: '风控报告' },
  { key: 'salesReport', label: '销售端报告' },
  { key: 'nextWeekPlan', label: '下周工作计划' },
  { key: 'nav', label: '净值' },
  { key: 'yearStartNav', label: '年初净值' },
  { key: 'changePercent', label: '涨跌幅' },
];

export default function WorkLogImportModal({ isOpen, onClose, onImport, defaultWeekKey, initialFile }: WorkLogImportModalProps) {
  const { confirm: ask, ConfirmDialog } = useConfirm();
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<ImportMode>('overwrite');
  const [parseResult, setParseResult] = useState<WorkLogParseResult | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // 当外部传入 initialFile（拖拽导入）时，自动加载
  const initialFileProcessed = useRef(false);
  useEffect(() => {
    if (initialFile && !initialFileProcessed.current) {
      initialFileProcessed.current = true;
      handleFileSelect(initialFile);
    }
  }, [initialFile]);

  // 每次打开时重置进程标记
  useEffect(() => {
    if (isOpen) {
      initialFileProcessed.current = false;
    }
  }, [isOpen]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback(async (selectedFile: File | null) => {
    if (!selectedFile) return;

    const ext = selectedFile.name.toLowerCase();
    if (!ext.endsWith('.xlsx') && !ext.endsWith('.xls')) {
      _toast.error?.('仅支持 XLSX/XLS 格式的文件');
      return;
    }

    setFile(selectedFile);
    setIsParsing(true);
    setParseResult(null);

    try {
      const buffer = await selectedFile.arrayBuffer();
      const result = await parseWorkLogXLSX(buffer, defaultWeekKey);
      setParseResult(result);
    } catch (err) {
      setParseResult({
        rows: [],
        errors: [{ row: 0, message: '文件解析失败: ' + (err instanceof Error ? err.message : '未知错误') }],
        totalRows: 0,
        successRows: 0,
      });
    } finally {
      setIsParsing(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) handleFileSelect(droppedFile);
  }, [handleFileSelect]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleConfirmImport = useCallback(async () => {
    if (!parseResult || parseResult.rows.length === 0) return;
    if (mode === 'overwrite' && !await ask({
      title: '确认覆盖周报数据',
      message: `将先清除当前管理周报中的全部数据和历史周快照，再导入 ${parseResult.rows.length} 条记录。此操作不可撤销。`,
      confirmText: '覆盖并导入',
      tone: 'danger',
    })) return;
    setIsImporting(true);
    try {
      await onImport(parseResult.rows, mode);
    } finally {
      setIsImporting(false);
    }
  }, [ask, parseResult, mode, onImport]);

  const handleClose = useCallback(() => {
    setFile(null);
    setParseResult(null);
    setIsParsing(false);
    onClose();
  }, [onClose]);

  // 按 sheet 分组统计
  const sheetStats = useMemo(() => {
    if (!parseResult) return [];
    const catCount: Record<string, number> = {};
    for (const row of parseResult.rows) {
      const cat = row.category || '未分类';
      catCount[cat] = (catCount[cat] || 0) + 1;
    }
    return Object.entries(catCount);
  }, [parseResult]);

  // 预览前 5 行
  const previewRows = useMemo(() => {
    if (!parseResult) return [];
    return parseResult.rows.slice(0, 5);
  }, [parseResult]);

  // 收集所有进展周次和净值周次
  const allProgressWeeks = useMemo(() => {
    if (!parseResult) return [];
    const s = new Set<string>();
    for (const r of parseResult.rows) { if (r.weeklyProgress) Object.keys(r.weeklyProgress).forEach(k => s.add(k)); }
    return Array.from(s).sort();
  }, [parseResult]);
  const allNavScaleWeeks = useMemo(() => {
    if (!parseResult) return [];
    const s = new Set<string>();
    for (const r of parseResult.rows) { if (r.navScaleHistory) Object.keys(r.navScaleHistory).forEach(k => s.add(k)); }
    return Array.from(s).sort();
  }, [parseResult]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={handleClose}>
      <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-5xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <FileSpreadsheet size={20} className="text-brand-600" />
            <h2 className="text-lg font-semibold text-slate-900">导入工作日志</h2>
          </div>
          <button onClick={handleClose} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors">
            <X size={20} className="text-slate-500" />
          </button>
        </div>

        {/* 内容区域 */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {/* 操作指引 */}
          <div className="text-sm text-slate-600 space-y-2">
            <p>上传工作日志 Excel 文件，系统会自动解析并按周次分类。</p>
            <div className="flex items-center gap-2 text-xs bg-brand-50 text-brand-700 px-3 py-2 rounded-lg">
              <Upload size={14} />
              <span>支持导入「国际部滚动工作日志」格式的 .xlsx 文件</span>
            </div>
          </div>

          {/* 文件上传区域 */}
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
            className={`
              border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors
              ${isDragging ? 'border-brand-500 bg-brand-50' : 'border-slate-300 hover:border-brand-400 hover:bg-slate-50'}
            `}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => handleFileSelect(e.target.files?.[0] || null)}
            />
            {file ? (
              <div className="flex items-center justify-center gap-3">
                <FileSpreadsheet size={32} className={parseResult ? 'text-green-600' : 'text-brand-600'} />
                <div className="text-left">
                  <div className="font-medium text-slate-800">{file.name}</div>
                  <div className="text-xs text-slate-500">{(file.size / 1024).toFixed(1)} KB</div>
                </div>
                {isParsing && (
                  <div className="flex items-center gap-2 text-sm text-brand-600">
                    <div className="animate-spin w-4 h-4 border-2 border-brand-600 border-t-transparent rounded-full" />
                    解析中...
                  </div>
                )}
                {parseResult && !isParsing && (
                  <CheckCircle size={20} className="text-green-500" />
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Upload size={32} className="text-slate-400" />
                <div className="font-medium text-slate-600">点击选择文件，或拖拽文件到此处</div>
                <div className="text-xs text-slate-400">支持 .xlsx 格式</div>
              </div>
            )}
          </div>

          {/* 模式选择 */}
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-2">导入方式</label>
            <div className="flex gap-4">
              <label className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border cursor-pointer transition-colors ${mode === 'overwrite' ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-slate-200 hover:bg-slate-50'}`}>
                <input
                  type="radio"
                  name="importMode"
                  value="overwrite"
                  checked={mode === 'overwrite'}
                  onChange={() => setMode('overwrite')}
                  className="text-orange-600"
                />
                <div>
                  <div className="font-medium text-sm">覆盖</div>
                  <div className="text-xs opacity-75">清除所有现有数据，仅保留导入的数据</div>
                </div>
              </label>
              <label className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border cursor-pointer transition-colors ${mode === 'append' ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 hover:bg-slate-50'}`}>
                <input
                  type="radio"
                  name="importMode"
                  value="append"
                  checked={mode === 'append'}
                  onChange={() => setMode('append')}
                  className="text-brand-600"
                />
                <div>
                  <div className="font-medium text-sm">合并补全</div>
                  <div className="text-xs opacity-75">同一项目更新非空字段，新项目自动增加</div>
                </div>
              </label>
            </div>
            {mode === 'overwrite' && (
              <div className="mt-2 flex items-center gap-1.5 text-sm text-orange-600 bg-orange-50 px-3 py-2 rounded-lg">
                <AlertTriangle size={16} />
                <span>警告：所有现有工作日志将被替换，此操作不可撤销！</span>
              </div>
            )}
          </div>

          {/* 解析结果 */}
          {parseResult && !isParsing && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-green-700 font-medium">
                    <CheckCircle size={16} className="inline mr-1" />
                    共解析 {parseResult.rows.length} 条记录
                  </span>
                  {parseResult.errors.length > 0 && (
                    <span className="text-orange-600 font-medium">
                      <AlertTriangle size={16} className="inline mr-1" />
                      {parseResult.errors.length} 个警告
                    </span>
                  )}
                </div>
              </div>

              {/* 分类统计 */}
              {sheetStats.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {sheetStats.map(([cat, count]) => (
                    <span key={cat} className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-700">
                      {cat}: {count} 条
                    </span>
                  ))}
                </div>
              )}

              {/* 完整字段预览表格 */}
              {previewRows.length > 0 && (
                <div className="overflow-x-auto border border-slate-200 rounded-lg">
                  <table className="w-full text-xs whitespace-nowrap">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="px-2 py-1.5 text-left text-slate-600 font-medium sticky left-0 bg-slate-50 z-10">#</th>
                        {ALL_FIELDS.map(f => (
                          <th key={f.key} className="px-2 py-1.5 text-left text-slate-600 font-medium">{f.label}</th>
                        ))}
                        {allProgressWeeks.map(w => (
                          <th key={`p_${w}`} className="px-2 py-1.5 text-left text-brand-600 font-medium">上周进展({w})</th>
                        ))}
                        {allNavScaleWeeks.map(w => (
                          <th key={`n_${w}`} className="px-2 py-1.5 text-left text-green-600 font-medium">净值情况({w})</th>
                        ))}
                        <th className="px-2 py-1.5 text-left text-slate-600 font-medium">覆盖周次</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {previewRows.map((row, idx) => {
                        let weekLabel = '-';
                        if (row.weekKey) {
                          const range = getWeekRange(row.weekKey as string);
                          const wn = getWeekNumber(row.weekKey as string);
                          weekLabel = `第${wn}周 (${range.start})`;
                        }
                        return (
                          <tr key={idx} className="hover:bg-slate-50">
                            <td className="px-2 py-1.5 text-slate-400 sticky left-0 bg-white z-10">{idx + 1}</td>
                            {ALL_FIELDS.map(f => (
                              <td key={f.key} className="px-2 py-1.5 text-slate-700 max-w-[140px] truncate" title={(row as Record<string, any>)[f.key] != null ? String((row as Record<string, any>)[f.key]) : ''}>
                                {(row as Record<string, any>)[f.key] != null && (row as Record<string, any>)[f.key] !== '' ? String((row as Record<string, any>)[f.key]) : '-'}
                              </td>
                            ))}
                            {allProgressWeeks.map(w => (
                              <td key={`p_${w}`} className="px-2 py-1.5 text-slate-600 max-w-[200px] truncate" title={row.weeklyProgress?.[w] || ''}>
                                {row.weeklyProgress?.[w] || '-'}
                              </td>
                            ))}
                            {allNavScaleWeeks.map(w => (
                              <td key={`n_${w}`} className="px-2 py-1.5 text-slate-600 max-w-[200px] truncate" title={row.navScaleHistory?.[w] || ''}>
                                {row.navScaleHistory?.[w] || '-'}
                              </td>
                            ))}
                            <td className="px-2 py-1.5 text-slate-500 text-xs">{weekLabel}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {parseResult.rows.length > 5 && (
                    <div className="px-2 py-1.5 text-xs text-slate-400 bg-slate-50 border-t border-slate-200">
                      仅显示前 5 行，共 {parseResult.rows.length} 行
                    </div>
                  )}
                </div>
              )}

              {/* 错误列表 */}
              {parseResult.errors.length > 0 && (
                <div className="mt-2 p-3 bg-orange-50 border border-orange-200 rounded-lg">
                  <div className="text-sm font-medium text-orange-700 mb-1">解析警告</div>
                  <ul className="space-y-0.5">
                    {parseResult.errors.map((err, idx) => (
                      <li key={idx} className="text-xs text-orange-600">
                        {err.row > 0 ? `第 ${err.row} 行: ` : ''}{err.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleConfirmImport}
            disabled={!parseResult || parseResult.rows.length === 0 || isParsing || isImporting}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-brand-500 text-white rounded-lg hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <FileUp size={16} />
            {isImporting ? '正在导入...' : `${mode === 'overwrite' ? '覆盖导入' : '合并补全'} ${parseResult ? parseResult.rows.length : 0} 条记录`}
          </button>
        </div>
      </div>
      {ConfirmDialog}
    </div>
  );
}
