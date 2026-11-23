import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { X, Upload, FileSpreadsheet, Download, AlertTriangle, CheckCircle, FileUp } from 'lucide-react';
import { ImportMode, ParseResult, InvestmentProduct } from '../../types';
import { parseCSV, parseXLSX, generateImportTemplate } from '../../utils/import-utils';
import { useSettingsStore } from '../../store/settingsStore';
import { _toast } from '../../store/toastRef';
import { useProjectStore } from '../../store/projectStore';
import { normalizeProjectName, PRODUCT_COMPARE_FIELDS } from '../../utils/duplicateDetection';
import { useConfirm } from '../Toast';

interface ImportDifference {
  field: string;
  current: unknown;
  imported: unknown;
  conflict: boolean;
}

interface ImportConflictPreview {
  row: Partial<InvestmentProduct>;
  existing?: InvestmentProduct;
  kind: 'add' | 'unchanged' | 'update' | 'conflict';
  differences: ImportDifference[];
}

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (rows: Partial<InvestmentProduct>[], mode: ImportMode) => void | Promise<void>;
  initialFile?: File | null;
}

export default function ImportModal({ isOpen, onClose, onImport, initialFile }: ImportModalProps) {
  const { confirm: ask, ConfirmDialog } = useConfirm();
  const { settings } = useSettingsStore();
  const existingProducts = useProjectStore(state => state.products);
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<ImportMode>('append');
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDownloadTemplate = useCallback(() => {
    generateImportTemplate(settings);
  }, [settings]);

  const handleFileSelect = useCallback(async (selectedFile: File | null) => {
    if (!selectedFile) return;

    const ext = selectedFile.name.toLowerCase();
    if (!ext.endsWith('.csv') && !ext.endsWith('.xlsx') && !ext.endsWith('.xls')) {
      _toast.error?.('仅支持 CSV 和 XLSX 格式的文件');
      return;
    }

    setFile(selectedFile);
    setIsParsing(true);
    setParseResult(null);

    try {
      let result: ParseResult;
      if (ext.endsWith('.csv')) {
        const text = await selectedFile.text();
        result = parseCSV(text, settings);
      } else {
        const buffer = await selectedFile.arrayBuffer();
        result = await parseXLSX(buffer, settings);
      }
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
  }, [settings]);

  useEffect(() => {
    if (isOpen && initialFile) void handleFileSelect(initialFile);
  }, [handleFileSelect, initialFile, isOpen]);

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
      title: '确认覆盖项目数据',
      message: `将先清除当前项目进度中的全部数据，再导入 ${parseResult.rows.length} 条记录。此操作不可撤销。`,
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

  const previewRows = useMemo(() => {
    if (!parseResult) return [];
    return parseResult.rows.slice(0, 5);
  }, [parseResult]);

  const conflictPreview = useMemo<ImportConflictPreview[]>(() => {
    if (!parseResult) return [];
    const existingByName = new Map(existingProducts.map(product => [normalizeProjectName(product.productName), product]));
    return parseResult.rows.map(row => {
      const existing = existingByName.get(normalizeProjectName(row.productName));
      if (!existing) return { row, kind: 'add', differences: [] };
      const differences: ImportDifference[] = [];
      for (const field of PRODUCT_COMPARE_FIELDS) {
        if (field === 'productName') continue;
        const imported = row[field];
        if (imported == null || imported === '' || (typeof imported === 'object' && Object.keys(imported).length === 0)) continue;
        const current = existing[field];
        if (JSON.stringify(current ?? '') === JSON.stringify(imported ?? '')) continue;
        const currentHasValue = current != null && current !== '' && !(typeof current === 'object' && Object.keys(current).length === 0);
        differences.push({ field: String(field), current, imported, conflict: currentHasValue });
      }
      if (differences.length === 0) return { row, existing, kind: 'unchanged', differences };
      return { row, existing, kind: differences.some(item => item.conflict) ? 'conflict' : 'update', differences };
    });
  }, [existingProducts, parseResult]);

  const conflictCounts = useMemo(() => conflictPreview.reduce((counts, item) => ({ ...counts, [item.kind]: counts[item.kind] + 1 }), { add: 0, unchanged: 0, update: 0, conflict: 0 }), [conflictPreview]);

  // 展开动态字段用 title 显示 — 也移到条件 return 之前
  const previewDataFields = useMemo(() => {
    const base = ['productName', 'usd', 'rmb', 'feeRate', 'establishDate', 'client', 'strategy', 'status', 'trustManager', 'trustManagerB'];
    const dynamicTitles = settings.customColumns.map(c => c.title);
    return [...base, ...dynamicTitles];
  }, [settings.customColumns]);

  if (!isOpen) return null;

  const getFieldTitle = (field: string): string => {
    // 如果是动态列 key，返回 title
    for (const col of settings.customColumns) {
      if (col.key === field) return col.title;
    }
    // 标准字段名转中文
    const map: Record<string, string> = {
      productName: '产品名称', usd: 'USD', rmb: 'RMB', feeRate: '费率',
      establishDate: '成立时间', target: '标的', client: '委托人',
      brokerChannel: '券商渠道', strategy: '策略', custodianBank: '托管行',
      tradingBroker: '交易券商', annualIncome: '年化收入', thisYearIncome: '今年收入',
      performanceIncome: '绩效收入', status: '状态', trustManager: 'A角', trustManagerB: 'B角',
      deadline: '期限', remarks: '备注',
    };
    return map[field] || field;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={handleClose}>
      <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-3xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <FileSpreadsheet size={20} className="text-brand-600" />
            <h2 className="text-lg font-semibold text-slate-900">导入产品</h2>
          </div>
          <button onClick={handleClose} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors">
            <X size={20} className="text-slate-500" />
          </button>
        </div>

        {/* 内容区域 */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">

          {/* 操作指引 */}
          <div className="text-sm text-slate-600 space-y-2">
            <p>上传 CSV 或 XLSX 文件导入产品数据。建议先下载模板填写后再导入。</p>
            <button
              onClick={handleDownloadTemplate}
              className="inline-flex items-center gap-1.5 text-brand-600 hover:text-brand-700 font-medium transition-colors"
            >
              <Download size={16} />
              下载导入模板
            </button>
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
              accept=".csv,.xlsx,.xls"
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
                <div className="text-xs text-slate-400">支持 CSV、XLSX 格式</div>
              </div>
            )}
          </div>

          {/* 模式选择 */}
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-2">导入方式</label>
            <div className="flex gap-4">
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
                  <div className="text-xs opacity-75">同名项目更新非空字段，新项目自动增加</div>
                </div>
              </label>
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
            </div>
            {mode === 'overwrite' && (
              <div className="mt-2 flex items-center gap-1.5 text-sm text-orange-600 bg-orange-50 px-3 py-2 rounded-lg">
                <AlertTriangle size={16} />
                <span>警告：当前所有产品数据将被替换，此操作不可撤销！</span>
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
                    成功解析 {parseResult.successRows} 行
                  </span>
                  {parseResult.errors.length > 0 && (
                    <span className="text-orange-600 font-medium">
                      <AlertTriangle size={16} className="inline mr-1" />
                      {parseResult.errors.length} 个警告
                    </span>
                  )}
                  <span className="text-slate-500">共 {parseResult.totalRows} 行</span>
                </div>
              </div>

              {/* 预览表格 */}
              {previewRows.length > 0 && (
                <div className="overflow-x-auto border border-slate-200 rounded-lg">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="px-2 py-1.5 text-left text-slate-600 font-medium whitespace-nowrap">#</th>
                        {previewDataFields.map(field => (
                          <th key={field} className="px-2 py-1.5 text-left text-slate-600 font-medium whitespace-nowrap">
                            {getFieldTitle(field)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {previewRows.map((row, idx) => (
                        <tr key={idx} className="hover:bg-slate-50">
                          <td className="px-2 py-1.5 text-slate-400">{idx + 1}</td>
                          {previewDataFields.map(field => {
                            // 如果是动态列 title，从 dynamicFields 取
                            let val: any;
                            const customCol = settings.customColumns.find(c => c.title === field);
                            if (customCol) {
                              val = row.dynamicFields?.[customCol.key];
                            } else {
                              val = (row as any)[field];
                            }
                            return (
                              <td key={field} className="px-2 py-1.5 text-slate-700 max-w-[120px] truncate whitespace-nowrap">
                                {val == null || val === '' ? '-' : String(val)}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {parseResult.rows.length > 5 && (
                    <div className="px-2 py-1.5 text-xs text-slate-400 bg-slate-50 border-t border-slate-200">
                      仅显示前 5 行，共 {parseResult.rows.length} 行
                    </div>
                  )}
                </div>
              )}

              {mode === 'append' && conflictPreview.length > 0 && (
                <div className="mt-3 border border-slate-200 rounded-lg overflow-hidden">
                  <div className="grid grid-cols-4 divide-x divide-slate-200 bg-slate-50 text-center text-xs">
                    <div className="p-2"><span className="block text-base font-semibold text-emerald-700">{conflictCounts.add}</span>新增</div>
                    <div className="p-2"><span className="block text-base font-semibold text-blue-700">{conflictCounts.update}</span>补全</div>
                    <div className="p-2"><span className="block text-base font-semibold text-orange-700">{conflictCounts.conflict}</span>冲突更新</div>
                    <div className="p-2"><span className="block text-base font-semibold text-slate-500">{conflictCounts.unchanged}</span>无变化</div>
                  </div>
                  {conflictCounts.conflict > 0 && <div className="border-t border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-700">冲突更新表示系统和导入文件均有非空值，确认后将采用导入值。</div>}
                  <div className="max-h-64 overflow-auto divide-y divide-slate-100">
                    {conflictPreview.filter(item => item.kind !== 'unchanged').map((item, index) => (
                      <details key={`${item.row.productName || 'blank'}-${index}`} className="bg-white">
                        <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2 text-xs">
                          <span className={`w-14 shrink-0 text-center py-0.5 font-medium ${item.kind === 'add' ? 'bg-emerald-50 text-emerald-700' : item.kind === 'conflict' ? 'bg-orange-50 text-orange-700' : 'bg-blue-50 text-blue-700'}`}>{item.kind === 'add' ? '新增' : item.kind === 'conflict' ? '冲突' : '补全'}</span>
                          <span className="min-w-0 flex-1 truncate font-medium text-slate-700">{item.row.productName || '（空白项目名称）'}</span>
                          <span className="text-slate-400">{item.differences.length > 0 ? `${item.differences.length} 个字段变化` : '新项目'}</span>
                        </summary>
                        {item.differences.length > 0 && <div className="border-t border-slate-100 px-3 py-2">
                          {item.differences.map(diff => <div key={diff.field} className="grid grid-cols-[100px_minmax(0,1fr)_20px_minmax(0,1fr)] gap-2 py-1 text-[11px]"><span className={diff.conflict ? 'font-medium text-orange-700' : 'text-slate-500'}>{getFieldTitle(diff.field)}</span><span className="truncate text-slate-500" title={String(diff.current ?? '')}>{String(diff.current ?? '') || '（空白）'}</span><span className="text-center text-slate-300">→</span><span className="truncate text-slate-800" title={String(diff.imported ?? '')}>{String(diff.imported ?? '') || '（空白）'}</span></div>)}
                        </div>}
                      </details>
                    ))}
                  </div>
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
            {isImporting ? '正在导入...' : `${mode === 'overwrite' ? '覆盖导入' : '合并补全'} ${parseResult ? parseResult.rows.length : 0} 条数据`}
          </button>
        </div>
      </div>
      {ConfirmDialog}
    </div>
  );
}
