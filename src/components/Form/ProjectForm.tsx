import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, AlertCircle } from 'lucide-react';
import { InvestmentProduct } from '../../types';
import { validateField, validateForm } from '../../utils/validation';
import { useSettingsStore } from '../../store/settingsStore';
import { useProjectStore } from '../../store/projectStore';
import { useAuthStore } from '../../store/authStore';
import { normalizeRate } from '../../utils/format';
import AppSelect from './AppSelect';

interface ProjectFormProps {
  initialData?: InvestmentProduct | null;
  onSubmit: (data: any) => void;
  hideBackButton?: boolean;
  onCancel?: () => void;
}

interface FormData {
  productName: string;
  usd: number | string;
  rmb: number | string;
  feeRate: number | string;
  establishDate: string;
  target: string;
  client: string;
  brokerChannel: string;
  strategy: string;
  custodianBank: string;
  tradingBroker: string;
  annualIncome: number | string;
  thisYearIncome: number | string;
  performanceIncome: number | string;
  status: string;
  trustManager: string;
  trustManagerB: string;
  deadline: string;
}

export default function ProjectForm({ initialData, onSubmit, hideBackButton, onCancel }: ProjectFormProps) {
  const navigate = useNavigate();
  const { settings } = useSettingsStore();
  const activeExchangeRate = settings.exchangeRate;
  const { products } = useProjectStore();
  const currentUser = useAuthStore(s => s.user);
  const defaultTrustManager = currentUser?.business_role === 'trust_manager' ? (currentUser.display_name || '') : '';
  
  const [deadlineValue, setDeadlineValue] = useState<string>('');
  const [deadlineUnit, setDeadlineUnit] = useState<string>('?');
  
  const [formData, setFormData] = useState<FormData>({
    productName: '',
    usd: '',
    rmb: '',
    feeRate: '',
    establishDate: new Date().toISOString().split('T')[0],
    target: '',
    client: '',
    brokerChannel: '',
    strategy: '',
    custodianBank: '',
    tradingBroker: '',
    annualIncome: '',
    thisYearIncome: '',
    performanceIncome: '',
    status: settings.statusConfigs[0]?.name || '',
    trustManager: defaultTrustManager,
    trustManagerB: '',
    deadline: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const trustManagerOptions = useMemo(() => {
    const managers = settings.trustManagers || [];
    if (defaultTrustManager && !managers.some(manager => manager.name === defaultTrustManager)) {
      return [{ id: 'current-user', name: defaultTrustManager }, ...managers];
    }
    return managers;
  }, [settings.trustManagers, defaultTrustManager]);

  const occupationCheck = useMemo((): { occupied: boolean; product?: InvestmentProduct } => {
    const productName = formData.productName.trim();
    if (!productName) {
      return { occupied: false };
    }

    const occupiedProduct = products.find(p => {
      if (initialData && p.id === initialData.id) return false;
      return p.productName.trim() === productName;
    });

    return { occupied: Boolean(occupiedProduct), product: occupiedProduct };
  }, [products, initialData, formData.productName]);

  const parseDeadline = (deadlineStr: string) => {
    if (!deadlineStr) return { value: '', unit: '天' };
    const match = deadlineStr.match(/^(\d+)(天|月|年)$/);
    if (match) {
      return { value: match[1], unit: match[2] };
    }
    // 如果是纯数字，默认单位是天
    if (/^\d+$/.test(deadlineStr)) {
      return { value: deadlineStr, unit: '天' };
    }
    return { value: '', unit: '天' };
  };

  // 格式化期限
  const formatDeadline = (value: string, unit: string) => {
    if (!value) return '';
    return `${value}${unit}`;
  };

  useEffect(() => {
    if (initialData) {
      // 解析期限
      const parsed = parseDeadline(initialData.deadline);
      setDeadlineValue(parsed.value);
      setDeadlineUnit(parsed.unit);

      setFormData({
        productName: initialData.productName,
        usd: initialData.usd !== 0 ? String(initialData.usd) : '',
        rmb: initialData.rmb !== 0 ? String(initialData.rmb) : '',
        feeRate: initialData.feeRate !== 0 ? String(initialData.feeRate) : '',
        establishDate: initialData.establishDate,
        target: initialData.target,
        client: initialData.client,
        brokerChannel: initialData.brokerChannel,
        strategy: initialData.strategy,
        custodianBank: initialData.custodianBank,
        tradingBroker: initialData.tradingBroker,
        annualIncome: initialData.annualIncome !== 0 ? String(initialData.annualIncome) : '',
        thisYearIncome: initialData.thisYearIncome !== 0 ? String(initialData.thisYearIncome) : '',
        performanceIncome: initialData.performanceIncome !== 0 ? String(initialData.performanceIncome) : '',
        status: initialData.status,
        trustManager: initialData.trustManager,
        trustManagerB: initialData.trustManagerB || '',
        deadline: initialData.deadline,
      });
    }
  }, [initialData]);

  useEffect(() => {
    if (!initialData && defaultTrustManager && !formData.trustManager) {
      setFormData(prev => ({ ...prev, trustManager: defaultTrustManager }));
    }
  }, [initialData, defaultTrustManager, formData.trustManager]);

  // 查找第一个可用的编号
  useEffect(() => {
    const rmbVal = Number(formData.rmb);
    const feeRateVal = normalizeRate(Number(formData.feeRate));
    const establishDate = formData.establishDate;

    // 初始化值
    let annualIncome = '';
    let thisYearIncome = '';
    let performanceIncome = '';

    // 计算年化收入
    if (!isNaN(rmbVal) && !isNaN(feeRateVal) && rmbVal > 0 && feeRateVal > 0) {
      const annIncome = rmbVal * feeRateVal;
      annualIncome = Math.round(annIncome * 100) / 100 + '';

      // 计算今年收入：年化收入 * ((当年11月30日 - 成立时间) / 365)
      if (establishDate) {
        const today = new Date();
        const targetDate = new Date(today.getFullYear(), 10, 30); // 11月30日
        const startDate = new Date(establishDate);

        // 如果成立时间在目标日期之后，使用成立时间
        let endDate = targetDate;
        if (startDate > targetDate) {
          endDate = startDate;
        }

        const timeDiff = endDate.getTime() - startDate.getTime();
        const dayDiff = Math.max(0, Math.ceil(timeDiff / (1000 * 3600 * 24)));

        if (dayDiff > 0) {
          const tIncome = annIncome * dayDiff / 365;
          thisYearIncome = Math.round(tIncome * 100) / 100 + '';

          // 计算绩效收入：今年收入 / 1.06
          const perfIncome = tIncome / 1.06;
          performanceIncome = Math.round(perfIncome * 100) / 100 + '';
        }
      }
    }

    // 更新表单数据
    setFormData(prev => ({
      ...prev,
      annualIncome,
      thisYearIncome,
      performanceIncome
    }));
  }, [formData.rmb, formData.feeRate, formData.establishDate]);

  const validationRules = {
    productName: [{ required: true, message: '\u8bf7\u8f93\u5165\u4ea7\u54c1\u540d\u79f0' }],
    client: [{ required: true, message: '请输入委托人' }],
    trustManager: [{ required: true, message: '请选择A角' }],
  };

  const handleChange = (field: keyof FormData, value: any) => {
    // 如果是数字输入框，允许空字符串
    if (field === 'usd') {
      // 只有在有值的时候才计算
      if (value) {
        const numValue = Number(value);
        if (!isNaN(numValue)) {
          const newRmb = numValue * activeExchangeRate;
          setFormData(prev => ({ 
            ...prev, 
            [field]: value,
            rmb: Math.round(newRmb * 100) / 100 
          }));
        } else {
          // 输入无效时，只更新当前字段
          setFormData(prev => ({ 
            ...prev, 
            [field]: value 
          }));
        }
      } else {
        // 清空时，另一个也清空
        setFormData(prev => ({ 
          ...prev, 
          [field]: value,
          rmb: '' 
        }));
      }
    } else if (field === 'rmb') {
      if (value) {
        const numValue = Number(value);
        if (!isNaN(numValue)) {
          const newUsd = numValue / activeExchangeRate;
          setFormData(prev => ({ 
            ...prev, 
            [field]: value,
            usd: Math.round(newUsd * 100) / 100 
          }));
        } else {
          setFormData(prev => ({ 
            ...prev, 
            [field]: value 
          }));
        }
      } else {
        setFormData(prev => ({ 
          ...prev, 
          [field]: value,
          usd: '' 
        }));
      }
    } else {
      setFormData(prev => ({ ...prev, [field]: value }));
    }
    
    if (errors[field]) {
      const error = validateField(value, (validationRules as Record<string, any>)[field] || []);
      setErrors(prev => ({ ...prev, [field]: error || '' }));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const finalDeadline = formatDeadline(deadlineValue, deadlineUnit);
    
    // 把字符串数字转换成数字
    const submissionData = {
      ...formData,
      deadline: finalDeadline,
      usd: formData.usd !== '' ? Number(formData.usd) : 0,
      rmb: formData.rmb !== '' ? Number(formData.rmb) : 0,
      feeRate: formData.feeRate !== '' ? normalizeRate(Number(formData.feeRate)) : 0,
      annualIncome: formData.annualIncome !== '' ? Number(formData.annualIncome) : 0,
      thisYearIncome: formData.thisYearIncome !== '' ? Number(formData.thisYearIncome) : 0,
      performanceIncome: formData.performanceIncome !== '' ? Number(formData.performanceIncome) : 0,
    };
    
    const validationErrors = validateForm(submissionData, validationRules);
    
    // 合并错误
    const allErrors = { ...validationErrors };
    
    if (Object.keys(allErrors).length > 0) {
      setErrors(allErrors);
      return;
    }

    onSubmit(submissionData);
  };

  return (
    <div className="max-w-4xl mx-auto">
      {!hideBackButton && (
        <div className="mb-6">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-slate-600 hover:text-slate-900 transition-colors"
          >
            <ArrowLeft size={20} />
            <span>返回</span>
          </button>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
        <h2 className="text-lg font-bold text-slate-900 mb-4">
          {initialData ? '编辑产品' : '新建产品'}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="bg-brand-50 rounded-lg p-3 border border-brand-200 mb-3">
            <h3 className="text-sm font-medium text-brand-800 mb-2">{'\u4ea7\u54c1\u540d\u79f0'} <span className="text-red-500">*</span></h3>
            <div className="relative">
              <input
                type="text"
                value={formData.productName}
                onChange={(e) => handleChange('productName', e.target.value)}
                className={`w-full px-2 py-1.5 border rounded-md focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400 outline-none text-sm bg-white ${occupationCheck.occupied ? 'border-red-400 pr-8' : 'border-slate-300'}`}
                placeholder={'\u8bf7\u8f93\u5165\u4ea7\u54c1\u540d\u79f0'}
              />
              {occupationCheck.occupied && (
                <AlertCircle
                  size={15}
                  className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-red-500"
                  aria-hidden="true"
                />
              )}
            </div>
            {occupationCheck.occupied && (
              <div className="mt-2 p-2 bg-amber-50 border border-amber-200 rounded-md flex items-start gap-2">
                <AlertCircle size={14} className="text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-xs font-medium text-amber-800">产品名称重复</p>
                  <p className="text-xs text-amber-700">
                    已有产品使用该名称
                  </p>
                </div>
              </div>
            )}
            {errors.productName && <p className="mt-1 text-xs text-red-600">{errors.productName}</p>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">

            <div>
              <label className="block text-xs text-slate-700 mb-1">USD</label>
              <input
                type="text"
                value={formData.usd}
                onChange={(e) => handleChange('usd', e.target.value)}
                className="w-full px-2 py-1.5 border border-slate-300 rounded-md focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400 outline-none text-sm"
                placeholder="请输入USD"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-700 mb-1">RMB</label>
              <input
                type="text"
                value={formData.rmb}
                onChange={(e) => handleChange('rmb', e.target.value)}
                className="w-full px-2 py-1.5 border border-slate-300 rounded-md focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400 outline-none text-sm"
                placeholder="请输入RMB"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-700 mb-1">费率</label>
              <input
                type="text"
                value={formData.feeRate}
                onChange={(e) => handleChange('feeRate', e.target.value)}
                className="w-full px-2 py-1.5 border border-slate-300 rounded-md focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400 outline-none text-sm"
                placeholder="请输入费率"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-700 mb-1">成立时间</label>
              <input
                type="date"
                value={formData.establishDate}
                onChange={(e) => handleChange('establishDate', e.target.value)}
                className="w-full px-2 py-1.5 border border-slate-300 rounded-md focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400 outline-none text-sm"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-700 mb-1">标的</label>
              <input
                type="text"
                value={formData.target}
                onChange={(e) => handleChange('target', e.target.value)}
                className="w-full px-2 py-1.5 border border-slate-300 rounded-md focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400 outline-none text-sm"
                placeholder="请输入标的"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-700 mb-1">
              委托人 <span className="text-red-500">*</span>
            </label>
              <input
                type="text"
                value={formData.client}
                onChange={(e) => handleChange('client', e.target.value)}
                className={`w-full px-2 py-1.5 border rounded-md focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400 outline-none transition-colors text-sm ${
                  errors.client ? 'border-red-300 focus:ring-red-500' : 'border-slate-300'
                }`}
                placeholder="请输入委托人"
              />
              {errors.client && <p className="mt-0.5 text-xs text-red-600">{errors.client}</p>}
            </div>

            <div>
              <label className="block text-xs text-slate-700 mb-1">券商渠道</label>
              <input
                type="text"
                value={formData.brokerChannel}
                onChange={(e) => handleChange('brokerChannel', e.target.value)}
                className="w-full px-2 py-1.5 border border-slate-300 rounded-md focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400 outline-none text-sm"
                placeholder="请输入券商渠道"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-700 mb-1">策略</label>
              <input
                type="text"
                value={formData.strategy}
                onChange={(e) => handleChange('strategy', e.target.value)}
                className="w-full px-2 py-1.5 border border-slate-300 rounded-md focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400 outline-none text-sm"
                placeholder="请输入策略"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-700 mb-1">托管行</label>
              <AppSelect
                value={formData.custodianBank}
                onChange={(value) => handleChange('custodianBank', value)}
                options={settings.custodianBanks.map(bank => bank.name)}
                placeholder="请选择托管行"
                clearable
                triggerClassName="border-slate-300"
              />
              <div className="mt-1">
                <input
                  type="text"
                  placeholder="或输入自定义托管行"
                  className="w-full px-2 py-1 border border-slate-300 rounded text-xs focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400 outline-none"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                      handleChange('custodianBank', e.currentTarget.value.trim());
                      e.currentTarget.value = '';
                    }
                  }}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-slate-700 mb-1">交易券商</label>
              <input
                type="text"
                value={formData.tradingBroker}
                onChange={(e) => handleChange('tradingBroker', e.target.value)}
                className="w-full px-2 py-1.5 border border-slate-300 rounded-md focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400 outline-none text-sm"
                placeholder="请输入交易券商"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-700 mb-1">状态</label>
              <AppSelect
                value={formData.status}
                onChange={(value) => handleChange('status', value)}
                options={settings.statusConfigs.map(status => status.name)}
                placeholder="请选择状态"
                triggerClassName="border-slate-300"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-700 mb-1">
              A角 <span className="text-red-500">*</span>
            </label>
              <AppSelect
                value={formData.trustManager}
                onChange={(value) => handleChange('trustManager', value)}
                options={trustManagerOptions.map(manager => manager.name)}
                placeholder="请选择A角"
                clearable
                triggerClassName={errors.trustManager ? 'border-red-300' : 'border-slate-300'}
              />
              {errors.trustManager && <p className="mt-0.5 text-xs text-red-600">{errors.trustManager}</p>}
            </div>

            <div>
              <label className="block text-xs text-slate-700 mb-1">B角</label>
              <AppSelect
                value={formData.trustManagerB}
                onChange={(value) => handleChange('trustManagerB', value)}
                options={trustManagerOptions.map(manager => manager.name)}
                placeholder="请选择B角"
                clearable
                triggerClassName="border-slate-300"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-700 mb-1">期限</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={deadlineValue}
                  onChange={(e) => setDeadlineValue(e.target.value.replace(/[^0-9]/g, ''))}
                  className="flex-1 px-2 py-1.5 border border-slate-300 rounded-md focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400 outline-none text-sm"
                  placeholder="请输入期限"
                />
                <AppSelect
                  value={deadlineUnit}
                  onChange={setDeadlineUnit}
                  options={['天', '月', '年']}
                  className="w-24 shrink-0"
                  triggerClassName="border-slate-300"
                />
              </div>
            </div>

            </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={() => onCancel ? onCancel() : navigate(-1)}
              className="px-4 py-1.5 text-slate-700 bg-slate-100 rounded-md hover:bg-slate-200 transition-colors text-sm"
            >
              取消
            </button>
            <button
              type="submit"
              className="flex items-center gap-1.5 px-4 py-1.5 text-white bg-brand-500 rounded-md hover:bg-brand-600 transition-colors disabled:bg-slate-400 disabled:cursor-not-allowed text-sm"
            >
              <Save size={16} />
              <span>保存</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
