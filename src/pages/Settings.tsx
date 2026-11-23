import { useEffect, useMemo, useState } from 'react';
import { useSettingsStore } from '../store/settingsStore';
import { Plus, Trash2, Edit2, Check, ChevronUp, ChevronDown, RefreshCw } from 'lucide-react';
import { CustodianBank } from '../types';
import Header from '../components/Layout/Header';
import ListCardShell from '../components/Layout/ListCardShell';
import AppSelect from '../components/Form/AppSelect';
import { MobileBaseAppbar } from '../components/Mobile/MobileBasePrimitives';
import { _toast } from '../store/toastRef';
import { useConfirm } from '../components/Toast';
import {
  getTemplateText,
  normalizeProductNameTemplate,
  PRODUCT_NAME_TEMPLATE_SLOT,
  normalizeProductNameTemplateSlots,
  scopedProductNameTemplateKey,
} from '../utils/productNameTemplates';

interface BankItemProps {
  bank: CustodianBank;
  editingBankId: string | null;
  editingBankName: string;
  onStartEdit: (id: string, name: string) => void;
  onSaveEdit: () => void;
  onDelete: (id: string) => void;
  onEditNameChange: (value: string) => void;
}

function BankItem({ 
  bank, 
  editingBankId, 
  editingBankName, 
  onStartEdit, 
  onSaveEdit, 
  onDelete, 
  onEditNameChange, 
}: BankItemProps) {
  if (editingBankId === bank.id) {
    return (
      <div className="flex min-h-12 items-center gap-3 bg-surface-50 px-4 py-2">
        <input
          type="text"
          value={editingBankName}
          onChange={(e) => onEditNameChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSaveEdit()}
          className="min-w-0 flex-1 border border-surface-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary-400"
          placeholder="托管行名称"
        />
        <button
          onClick={onSaveEdit}
          className="flex h-8 w-8 shrink-0 items-center justify-center text-surface-400 hover:text-primary-700"
          aria-label="保存托管行名称"
        >
          <Check size={20} />
        </button>
      </div>
    );
  }
  
  return (
    <div className="flex min-h-12 items-center gap-4 bg-white px-4 py-2 hover:bg-surface-50">
      <span className="flex-1 text-sm font-medium text-surface-800">{bank.name}</span>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onStartEdit(bank.id, bank.name)}
          className="p-1.5 text-surface-400 transition-colors hover:text-surface-800"
        >
          <Edit2 size={16} />
        </button>
        <button
          onClick={() => onDelete(bank.id)}
          className="p-1.5 text-surface-400 transition-colors hover:text-red-600"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}

// 折叠面板组件 — 左色条 + 单列布局
function CollapsibleSection({ sectionId, title, summary, active = true, children }: { sectionId?: string; title: string; summary?: string; active?: boolean; children: React.ReactNode }) {
  if (!active) return null;
  return (
    <section id={sectionId} className="settings-section-panel scroll-mt-4 bg-white px-5 py-5">
      <div className="settings-section-heading">
        <h2>{title}</h2>
        {summary && <span className="settings-section-summary">{summary}</span>}
      </div>
      <div className="settings-section-body">{children}</div>
    </section>
  );
}

function formatProjectRuleLabel(template: string) {
  const normalized = normalizeProductNameTemplateSlots(template);
  const label = normalized.split(PRODUCT_NAME_TEMPLATE_SLOT).join('〔编号〕');
  return normalized === PRODUCT_NAME_TEMPLATE_SLOT ? `${label}（无前后缀）` : label;
}

function parseReservedProjectNumbers(value: string) {
  const numbers = new Set<number>();
  const invalidTokens: string[] = [];
  value.split(/[，,\s]+/).filter(Boolean).forEach(token => {
    const range = token.match(/^(\d+)-(\d+)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (start < 1 || end < start || end - start > 999) {
        invalidTokens.push(token);
        return;
      }
      for (let number = start; number <= end; number += 1) numbers.add(number);
      return;
    }
    if (/^\d+$/.test(token) && Number(token) > 0) {
      numbers.add(Number(token));
      return;
    }
    invalidTokens.push(token);
  });
  return {
    numbers: Array.from(numbers).sort((left, right) => left - right),
    invalidTokens,
  };
}

function formatReservedProjectNumbers(numbers: number[]) {
  if (numbers.length === 0) return '无';
  const ranges: string[] = [];
  let start = numbers[0];
  let previous = numbers[0];
  const flush = () => ranges.push(start === previous ? String(start) : `${start}-${previous}`);
  numbers.slice(1).forEach(number => {
    if (number === previous + 1) {
      previous = number;
      return;
    }
    flush();
    start = number;
    previous = number;
  });
  flush();
  return ranges.join('、');
}

function compareByInitial(left: string, right: string) {
  return left.localeCompare(right, 'zh-CN', { numeric: true, sensitivity: 'base' });
}

function sortByName<T extends { name: string }>(items: T[]) {
  return [...items].sort((left, right) => compareByInitial(left.name || '', right.name || ''));
}

export default function Settings() {
  const { confirm: ask, ConfirmDialog } = useConfirm();
  const {
    settings,
    addCustodianBank,
    updateCustodianBank,
    deleteCustodianBank,
    addTrustManager,
    deleteTrustManager,
    addStatusConfig,
    updateStatusConfig,
    deleteStatusConfig,
    moveStatusConfig,
    updateSettings,
    addCustomColumn,
    deleteCustomColumn,
    moveCustomColumn,
    setExchangeRate,
    refreshLiveExchangeRate,
  } = useSettingsStore();
  const [newCustodianBank, setNewCustodianBank] = useState('');
  const [editingBankId, setEditingBankId] = useState<string | null>(null);
  const [editingBankName, setEditingBankName] = useState('');
  const [newTrustManager, setNewTrustManager] = useState('');
  const [newStatusName, setNewStatusName] = useState('');
  const [newStatusColor, setNewStatusColor] = useState('#3b82f6');
  const [editingStatusId, setEditingStatusId] = useState<string | null>(null);
  const [editingStatusName, setEditingStatusName] = useState('');
  const [editingStatusColor, setEditingStatusColor] = useState('#3b82f6');
  const [newColumnTitle, setNewColumnTitle] = useState('');
  const [newColumnType, setNewColumnType] = useState<'text' | 'number' | 'date'>('text');
  const [activeSettingsSection, setActiveSettingsSection] = useState('托管行设置');
  const [fixedExchangeRate, setFixedExchangeRate] = useState(() => String(settings.manualExchangeRate || settings.exchangeRate || 7.2));
  const [refreshingExchangeRate, setRefreshingExchangeRate] = useState(false);
  const [exchangeRateError, setExchangeRateError] = useState('');
  const [newWorkLogPrefix, setNewWorkLogPrefix] = useState('');
  const [newWorkLogSuffix, setNewWorkLogSuffix] = useState('');
  const confirmDelete = async (title: string, targetName: string, action: () => void) => {
    const confirmed = await ask({ title, message: `确定要删除“${targetName}”吗？删除后无法恢复。`, confirmText: '删除', tone: 'danger' });
    if (confirmed) action();
  };
  const [newProjectPrefix, setNewProjectPrefix] = useState('');
  const [newProjectSuffix, setNewProjectSuffix] = useState('');
  const [reservedProjectTemplateKey, setReservedProjectTemplateKey] = useState('');
  const [reservedProjectNumbersText, setReservedProjectNumbersText] = useState('');
  const configuredProjectRuleOptions = useMemo(() => {
    const prefixes = settings.projectNamePrefixes?.length ? settings.projectNamePrefixes : ['跨境投资'];
    const suffixes = settings.projectNameSuffixes?.length ? settings.projectNameSuffixes : ['号'];
    return prefixes.flatMap(prefix => suffixes.map(suffix => {
      const template = `${prefix}${PRODUCT_NAME_TEMPLATE_SLOT}${suffix}`;
      return { key: scopedProductNameTemplateKey('project', template), template };
    }));
  }, [settings.projectNamePrefixes, settings.projectNameSuffixes]);
  const sortedCustodianBanks = useMemo(() => sortByName(settings.custodianBanks), [settings.custodianBanks]);
  const sortedTrustManagers = useMemo(() => sortByName(settings.trustManagers), [settings.trustManagers]);
  const sortedStatusConfigs = settings.statusConfigs;
  const projectNumberOccupiedStatusIds = settings.projectNumberOccupiedStatusIds
    ?? settings.statusConfigs.map(status => status.id);
  const toggleProjectNumberOccupiedStatus = (statusId: string) => {
    const nextIds = projectNumberOccupiedStatusIds.includes(statusId)
      ? projectNumberOccupiedStatusIds.filter(id => id !== statusId)
      : [...projectNumberOccupiedStatusIds, statusId];
    updateSettings({ projectNumberOccupiedStatusIds: nextIds });
  };

  const handleAddCustodianBank = () => {
    if (newCustodianBank.trim()) {
      addCustodianBank(newCustodianBank.trim());
      setNewCustodianBank('');
    }
  };

  const handleStartEditBank = (id: string, name: string) => {
    setEditingBankId(id);
    setEditingBankName(name);
  };

  const handleSaveEditBank = () => {
    if (!editingBankId || !editingBankName.trim()) return;
    updateCustodianBank(editingBankId, { name: editingBankName.trim() });
    setEditingBankId(null);
  };

  const handleAddTrustManager = () => {
    if (newTrustManager.trim()) {
      addTrustManager(newTrustManager.trim());
      setNewTrustManager('');
    }
  };

  const handleAddStatusConfig = () => {
    if (newStatusName.trim()) {
      addStatusConfig({ name: newStatusName.trim(), color: newStatusColor });
      setNewStatusName('');
      setNewStatusColor('#3b82f6');
    }
  };

  const handleStartEditStatus = (id: string, name: string, color: string) => {
    setEditingStatusId(id);
    setEditingStatusName(name);
    setEditingStatusColor(color);
  };

  const handleSaveEditStatus = () => {
    if (editingStatusId) {
      updateStatusConfig(editingStatusId, { name: editingStatusName, color: editingStatusColor });
      setEditingStatusId(null);
    }
  };

  const handleAddColumn = () => {
    if (newColumnTitle.trim()) {
      addCustomColumn({ title: newColumnTitle.trim(), type: newColumnType });
      setNewColumnTitle('');
    }
  };

  const handleRefreshLiveExchangeRate = async () => {
    setRefreshingExchangeRate(true);
    setExchangeRateError('');
    try {
      await refreshLiveExchangeRate();
    } catch (error: any) {
      setExchangeRateError(error?.message || '获取失败，正在继续使用最近一次有效汇率');
    } finally {
      setRefreshingExchangeRate(false);
    }
  };

  const handleExchangeRateModeChange = (mode: 'manual' | 'auto') => {
    setExchangeRateError('');
    if (mode === 'manual') {
      const manualRate = settings.manualExchangeRate || 7.2;
      setFixedExchangeRate(String(manualRate));
      updateSettings({ exchangeRateMode: 'manual', exchangeRate: manualRate });
      return;
    }

    updateSettings({
      exchangeRateMode: 'auto',
      exchangeRate: settings.autoExchangeRate || settings.exchangeRate,
    });
    void handleRefreshLiveExchangeRate();
  };

  useEffect(() => {
    setFixedExchangeRate(String(settings.manualExchangeRate || 7.2));
  }, [settings.manualExchangeRate]);

  useEffect(() => {
    if (settings.exchangeRateMode !== 'auto') return;
    const interval = window.setInterval(() => {
      void refreshLiveExchangeRate();
    }, 30 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [refreshLiveExchangeRate, settings.exchangeRateMode]);

  useEffect(() => {
    const seen = new Set<string>();
    const dedupedTemplates = settings.productNameTemplates.filter(rule => {
      const scope = rule.scope || 'workLog';
      const template = getTemplateText(rule);
      const key = `${scope}:${normalizeProductNameTemplate(template)}`;
      if (!template.trim() || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (dedupedTemplates.length !== settings.productNameTemplates.length) {
      updateSettings({ productNameTemplates: dedupedTemplates });
    }
  }, [settings.productNameTemplates, updateSettings]);

  type NamePartKind = 'workLogPrefix' | 'workLogSuffix' | 'projectPrefix' | 'projectSuffix';
  const namePartConfig = (kind: NamePartKind) => {
    if (kind === 'workLogPrefix') return { key: 'workLogNamePrefixes' as const, value: newWorkLogPrefix, reset: setNewWorkLogPrefix, label: '管理周报名称前缀' };
    if (kind === 'workLogSuffix') return { key: 'workLogNameSuffixes' as const, value: newWorkLogSuffix, reset: setNewWorkLogSuffix, label: '管理周报名称后缀' };
    if (kind === 'projectPrefix') return { key: 'projectNamePrefixes' as const, value: newProjectPrefix, reset: setNewProjectPrefix, label: '项目名称前缀' };
    return { key: 'projectNameSuffixes' as const, value: newProjectSuffix, reset: setNewProjectSuffix, label: '项目名称后缀' };
  };

  const addNamePart = (kind: NamePartKind) => {
    const config = namePartConfig(kind);
    const value = config.value.trim();
    if (!value) return;
    const current = settings[config.key] || [];
    if (!current.includes(value)) updateSettings({ [config.key]: [...current, value] });
    config.reset('');
  };

  const deleteNamePart = (kind: NamePartKind, value: string) => {
    const config = namePartConfig(kind);
    const current = settings[config.key] || [];
    if (current.length <= 1) {
      _toast.warning?.(`请至少保留一个${config.label}`);
      return;
    }
    updateSettings({ [config.key]: current.filter(item => item !== value) });
  };

  useEffect(() => {
    if (!reservedProjectTemplateKey) {
      setReservedProjectNumbersText('');
      return;
    }
    setReservedProjectNumbersText(
      (settings.reservedProjectNumbersByTemplate?.[reservedProjectTemplateKey] || []).join(', '),
    );
  }, [reservedProjectTemplateKey, settings.reservedProjectNumbersByTemplate]);

  const handleSaveReservedProjectNumbers = () => {
    if (!reservedProjectTemplateKey) {
      _toast.warning?.('请先选择项目名称规则');
      return;
    }
    const parsed = parseReservedProjectNumbers(reservedProjectNumbersText);
    if (parsed.invalidTokens.length > 0) {
      _toast.warning?.(`以下编号格式无效：${parsed.invalidTokens.join('、')}`);
      return;
    }
    updateSettings({
      reservedProjectNumbersByTemplate: {
        ...(settings.reservedProjectNumbersByTemplate || {}),
        [reservedProjectTemplateKey]: parsed.numbers,
      },
    });
    setReservedProjectNumbersText(parsed.numbers.join(', '));
    _toast.success?.(`已保存 ${parsed.numbers.length} 个预留编号`);
  };

  const settingsSectionTabs = [
    { key: '托管行设置', label: '托管行', count: settings.custodianBanks.length },
    { key: '信托经理设置', label: '信托经理', count: settings.trustManagers.length },
    { key: '状态设置', label: '状态', count: settings.statusConfigs.length },
    { key: '产品名称规则', label: '产品名称规则', count: (settings.workLogNamePrefixes?.length || 2) + (settings.workLogNameSuffixes?.length || 3) + (settings.projectNamePrefixes?.length || 1) + (settings.projectNameSuffixes?.length || 1) },
    { key: '编号设置', label: '编号', count: configuredProjectRuleOptions.length },
    { key: '汇率设置', label: '汇率', count: 1 },
  ];

  const scrollToSettingsSection = (key: string) => {
    setActiveSettingsSection(key);
    const container = document.getElementById('settings-sections-scroll');
    const section = document.getElementById(`settings-section-${key}`);
    if (!container || !section) return;
    const top = section.getBoundingClientRect().top
      - container.getBoundingClientRect().top
      + container.scrollTop;
    container.scrollTo({ top, behavior: 'smooth' });
  };

  useEffect(() => {
    const container = document.getElementById('settings-sections-scroll');
    if (!container) return;

    const sectionKeys = [
      '托管行设置',
      '信托经理设置',
      '状态设置',
      '产品名称规则',
      '编号设置',
      '汇率设置',
    ];

    const updateActiveSection = () => {
      const containerTop = container.getBoundingClientRect().top;
      let currentKey = sectionKeys[0];
      let closestDistance = Number.POSITIVE_INFINITY;

      sectionKeys.forEach(key => {
        const section = document.getElementById(`settings-section-${key}`);
        if (!section) return;
        const distance = Math.abs(section.getBoundingClientRect().top - containerTop - 24);
        if (distance < closestDistance) {
          closestDistance = distance;
          currentKey = key;
        }
      });

      setActiveSettingsSection(currentKey);
    };

    container.addEventListener('scroll', updateActiveSection, { passive: true });
    updateActiveSection();
    return () => container.removeEventListener('scroll', updateActiveSection);
  }, []);

  return (
    <div className="mobile-product-settings-page square-ui flex min-h-full min-w-0 w-full flex-col gap-5 overflow-visible lg:h-full lg:min-h-0 lg:overflow-hidden">
      <div className="mobile-settings-heading lg:hidden">
        <MobileBaseAppbar title="产品设置" />
        <nav aria-label="产品设置分类">
          {settingsSectionTabs.map(tab => (
            <button
              key={tab.key}
              type="button"
              className={activeSettingsSection === tab.key ? 'is-active' : ''}
              onClick={() => scrollToSettingsSection(tab.key)}
            >{tab.label}<span>{tab.count}</span></button>
          ))}
        </nav>
      </div>
      <Header title="产品设置" subtitle="集中维护产品字段、业务选项与权限规则。" />

      <ListCardShell
        id="product-settings-content"
        views={settingsSectionTabs.map(tab => ({
          key: tab.key,
          label: tab.label,
          count: tab.count,
          active: activeSettingsSection === tab.key,
          onClick: () => scrollToSettingsSection(tab.key),
        }))}
        metrics={[]}
        compactViews
        viewsTitle="设置索引"
        stickyWorkspace
        mergeToolbarWithContent
        showContentTopDivider={false}
        contentClassName="p-0"
      >

      <div id="settings-sections-scroll" className="min-h-0 flex-1 overflow-y-auto scroll-smooth">
        {/* 托管行设置 */}
        <CollapsibleSection sectionId="settings-section-托管行设置" title="托管行设置" summary={`${settings.custodianBanks.length} 家银行`}>
          
          <div className="mb-3 divide-y divide-surface-100 border border-surface-200 bg-white">
            {sortedCustodianBanks.map((bank) => (
              <BankItem
                key={bank.id}
                bank={bank}
                editingBankId={editingBankId}
                editingBankName={editingBankName}
                onStartEdit={handleStartEditBank}
                onSaveEdit={handleSaveEditBank}
                onDelete={id => { const item = settings.custodianBanks.find(bank => bank.id === id); void confirmDelete('删除托管行', item?.name || '该托管行', () => deleteCustodianBank(id)); }}
                onEditNameChange={setEditingBankName}
              />
            ))}
          </div>

          <div className="flex gap-2 bg-surface-50 p-3">
            <input
              type="text"
              value={newCustodianBank}
              onChange={(e) => setNewCustodianBank(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddCustodianBank()}
              className="h-10 flex-1 border border-surface-200 bg-white px-3 text-sm outline-none placeholder:text-surface-400 focus:border-primary-400"
              placeholder="输入托管行名称"
            />
            <button
              onClick={handleAddCustodianBank}
              className="flex h-10 items-center gap-2 bg-slate-950 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800"
            >
              <Plus size={20} />
              <span>添加</span>
            </button>
          </div>
        </CollapsibleSection>

        {/* 信托经理设置 */}
        <CollapsibleSection sectionId="settings-section-信托经理设置" title="信托经理设置" summary={`${settings.trustManagers.length} 人`}>
          
          <div className="mb-3 divide-y divide-surface-100 border border-surface-200 bg-white">
            {sortedTrustManagers.map((manager) => (
              <div key={manager.id} className="flex min-h-12 items-center justify-between bg-white px-4 py-2 hover:bg-surface-50">
                <span className="text-sm font-medium text-surface-800">{manager.name}</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => void confirmDelete('删除信托经理', manager.name, () => deleteTrustManager(manager.id))}
                    className="p-1.5 text-surface-400 transition-colors hover:text-red-600"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-2 bg-surface-50 p-3">
            <input
              type="text"
              value={newTrustManager}
              onChange={(e) => setNewTrustManager(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddTrustManager()}
              className="h-10 flex-1 border border-surface-200 bg-white px-3 text-sm outline-none placeholder:text-surface-400 focus:border-primary-400"
              placeholder="输入信托经理姓名"
            />
            <button
              onClick={handleAddTrustManager}
              className="flex h-10 items-center gap-2 bg-slate-950 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800"
            >
              <Plus size={20} />
              <span>添加</span>
            </button>
          </div>
        </CollapsibleSection>

        {/* 状态设置 */}
        <CollapsibleSection sectionId="settings-section-状态设置" title="状态设置" summary={`${settings.statusConfigs.length} 个状态`}>
          
          <div className="mb-3 divide-y divide-surface-100 border border-surface-200 bg-white">
            {sortedStatusConfigs.map((status, index) => (
              <div key={status.id} className="flex min-h-12 items-center gap-4 bg-white px-4 py-2 hover:bg-surface-50">
                {editingStatusId === status.id ? (
                  <>
                    <div className="flex-1 flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <label className="text-sm text-slate-600">颜色</label>
                        <input
                          type="color"
                          value={editingStatusColor}
                          onChange={(e) => setEditingStatusColor(e.target.value)}
                          className="settings-color-input cursor-pointer"
                        />
                      </div>
                      <input
                        type="text"
                        value={editingStatusName}
                        onChange={(e) => setEditingStatusName(e.target.value)}
                        className="h-10 flex-1 border border-surface-200 bg-white px-3 text-sm outline-none focus:border-primary-400"
                        placeholder="状态名称"
                      />
                    </div>
                    <button
                      onClick={handleSaveEditStatus}
                      className="p-1.5 text-surface-400 transition-colors hover:text-primary-700"
                    >
                      <Check size={20} />
                    </button>
                  </>
                ) : (
                  <>
                    <div 
                      className="h-5 w-5 flex-shrink-0 border border-surface-200"
                      style={{ backgroundColor: status.color }}
                    />
                    <span className="flex-1 text-sm font-medium text-surface-800">{status.name}</span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => moveStatusConfig(status.id, 'up')}
                        disabled={index === 0}
                        className="p-1.5 text-surface-400 transition-colors hover:text-surface-800 disabled:cursor-not-allowed disabled:opacity-25"
                        aria-label={`上移状态 ${status.name}`}
                        title="上移"
                      >
                        <ChevronUp size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveStatusConfig(status.id, 'down')}
                        disabled={index === sortedStatusConfigs.length - 1}
                        className="p-1.5 text-surface-400 transition-colors hover:text-surface-800 disabled:cursor-not-allowed disabled:opacity-25"
                        aria-label={`下移状态 ${status.name}`}
                        title="下移"
                      >
                        <ChevronDown size={16} />
                      </button>
                      <button
                        onClick={() => handleStartEditStatus(status.id, status.name, status.color)}
                        className="p-1.5 text-surface-400 transition-colors hover:text-surface-800"
                      >
                        <Edit2 size={16} />
                      </button>
                      <button
                        onClick={() => void confirmDelete('删除项目阶段', status.name, () => deleteStatusConfig(status.id))}
                        className="p-1.5 text-surface-400 transition-colors hover:text-red-600"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-2 bg-surface-50 p-3 sm:flex-row">
            <div className="flex-1 flex items-center gap-4">
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-slate-700">颜色</label>
                <input
                  type="color"
                  value={newStatusColor}
                  onChange={(e) => setNewStatusColor(e.target.value)}
                  className="settings-color-input cursor-pointer"
                />
              </div>
              <input
                type="text"
                value={newStatusName}
                onChange={(e) => setNewStatusName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddStatusConfig()}
                className="h-10 flex-1 border border-surface-200 bg-white px-3 text-sm outline-none placeholder:text-surface-400 focus:border-primary-400"
                placeholder="输入状态名称"
              />
            </div>
            <button
              onClick={handleAddStatusConfig}
              className="flex h-10 items-center gap-2 bg-slate-950 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800"
            >
              <Plus size={20} />
              <span>添加</span>
            </button>
          </div>
        </CollapsibleSection>

        <CollapsibleSection sectionId="settings-section-产品名称规则" title="产品名称规则" summary="前缀 + 数字 + 后缀">
          <p className="mb-4 text-xs leading-5 text-slate-500">新建时分别选择前缀和后缀，中间仅填写数字；历史名称不会被修改。</p>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {([
              { kind: 'workLogPrefix' as const, title: '管理周报名称前缀', values: settings.workLogNamePrefixes || ['鸿泰-跨境投资', '环球甄选'], value: newWorkLogPrefix, setValue: setNewWorkLogPrefix, placeholder: '例如：环球甄选' },
              { kind: 'workLogSuffix' as const, title: '管理周报名称后缀', values: settings.workLogNameSuffixes || ['号QDII单一资金信托', '号', '期'], value: newWorkLogSuffix, setValue: setNewWorkLogSuffix, placeholder: '例如：号' },
              { kind: 'projectPrefix' as const, title: '项目进度名称前缀', values: settings.projectNamePrefixes || ['跨境投资'], value: newProjectPrefix, setValue: setNewProjectPrefix, placeholder: '例如：跨境投资' },
              { kind: 'projectSuffix' as const, title: '项目进度名称后缀', values: settings.projectNameSuffixes || ['号'], value: newProjectSuffix, setValue: setNewProjectSuffix, placeholder: '例如：号' },
            ]).map(group => (
              <div key={group.kind} className="border border-surface-200 bg-white p-4">
                <div className="text-sm font-semibold text-slate-800">{group.title}</div>
                <div className="mt-3 flex min-h-9 flex-wrap gap-2">
                  {group.values.map(value => (
                    <span key={value} className="inline-flex h-8 items-center gap-1.5 border border-surface-200 bg-surface-50 px-2.5 text-sm text-slate-700">
                      {value}
                      <button type="button" onClick={() => void confirmDelete('删除命名项', value, () => deleteNamePart(group.kind, value))} className="text-surface-400 hover:text-red-600" aria-label={`删除${value}`}>
                        <Trash2 size={14} />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="mt-3 flex gap-2">
                  <input
                    value={group.value}
                    onChange={event => group.setValue(event.target.value)}
                    onKeyDown={event => event.key === 'Enter' && addNamePart(group.kind)}
                    className="h-10 min-w-0 flex-1 border border-surface-200 bg-white px-3 text-sm outline-none placeholder:text-surface-400 focus:border-primary-400"
                    placeholder={group.placeholder}
                  />
                  <button type="button" onClick={() => addNamePart(group.kind)} disabled={!group.value.trim()} className="h-10 bg-slate-950 px-4 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
                    添加
                  </button>
                </div>
              </div>
            ))}
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          sectionId="settings-section-编号设置"
          title="编号设置"
          summary={`${configuredProjectRuleOptions.length} 条项目规则`}
        >
          <div className="settings-number-panels grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="h-full border border-surface-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-800">占号状态</div>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    只有处于已勾选状态的现有项目才会占用编号；手工预留编号始终占用。
                  </p>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => updateSettings({
                      projectNumberOccupiedStatusIds: settings.statusConfigs.map(status => status.id),
                    })}
                    className="border border-surface-200 bg-white px-2.5 py-1.5 text-surface-600 hover:bg-surface-50"
                  >
                    全选
                  </button>
                  <button
                    type="button"
                    onClick={() => updateSettings({ projectNumberOccupiedStatusIds: [] })}
                    className="border border-surface-200 bg-white px-2.5 py-1.5 text-surface-600 hover:bg-surface-50"
                  >
                    清空
                  </button>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {sortedStatusConfigs.map(status => {
                  const checked = projectNumberOccupiedStatusIds.includes(status.id);
                  return (
                    <label
                      key={status.id}
                      className={`inline-flex cursor-pointer items-center gap-2 border px-3 py-2 text-sm transition-colors ${
                        checked
                          ? 'border-primary-300 bg-primary-50 text-primary-800'
                          : 'border-surface-200 bg-white text-surface-500 hover:border-surface-300'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleProjectNumberOccupiedStatus(status.id)}
                        className="peer pointer-events-none h-0 w-0 shrink-0 opacity-0"
                      />
                      <span
                        aria-hidden="true"
                        className={`flex h-5 w-5 shrink-0 items-center justify-center border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-brand-300 peer-focus-visible:ring-offset-2 ${
                          checked
                            ? 'border-primary-600 bg-primary-600 text-white'
                            : 'border-surface-300 bg-white text-transparent'
                        }`}
                      >
                        <Check size={14} strokeWidth={2.5} />
                      </span>
                      <span>{status.name}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="h-full border border-surface-200 bg-white p-4">
              <div className="mb-2">
                <div className="text-sm font-semibold text-slate-800">预留编号</div>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  先选择“项目进度”名称规则，再填写编号；支持逗号和区间，例如 2, 5, 8-12。
                </p>
              </div>
              <div className="grid grid-cols-1 gap-3">
                <AppSelect
                  value={reservedProjectTemplateKey}
                  options={configuredProjectRuleOptions.map(row => ({
                    value: row.key,
                    label: formatProjectRuleLabel(row.template),
                    searchText: formatProjectRuleLabel(row.template),
                  }))}
                  onChange={setReservedProjectTemplateKey}
                  placeholder="选择项目名称规则"
                  emptyText="请先添加项目进度名称规则"
                  triggerClassName="h-10"
                />
                <input
                  type="text"
                  value={reservedProjectNumbersText}
                  onChange={event => setReservedProjectNumbersText(event.target.value)}
                  onKeyDown={event => event.key === 'Enter' && handleSaveReservedProjectNumbers()}
                  className="h-10 border border-surface-200 bg-white px-3 text-sm outline-none placeholder:text-surface-400 focus:border-primary-400"
                  placeholder="例如：2, 5, 8-12"
                  aria-label="预留项目编号"
                />
                <button
                  type="button"
                  onClick={handleSaveReservedProjectNumbers}
                  className="flex h-10 items-center justify-center gap-2 bg-slate-950 px-4 text-sm font-medium text-white hover:bg-slate-800"
                >
                  <Check size={17} />
                  保存
                </button>
              </div>
              {configuredProjectRuleOptions.length > 0 && (
                <div className="mt-3 space-y-1 text-xs text-slate-500">
                  {configuredProjectRuleOptions.map(row => (
                    <div key={row.key}>
                      {formatProjectRuleLabel(row.template)}：{formatReservedProjectNumbers(
                        settings.reservedProjectNumbersByTemplate?.[row.key] || [],
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </CollapsibleSection>

        {/* 汇率设置 */}
        <CollapsibleSection sectionId="settings-section-汇率设置" title="汇率设置" summary={`1 USD = ${settings.exchangeRate} CNY`}>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => handleExchangeRateModeChange('manual')}
              className={`flex min-h-14 items-center gap-3 border px-4 text-left transition-colors ${
                (settings.exchangeRateMode || 'manual') === 'manual'
                  ? 'border-primary-600 bg-primary-50 text-primary-800'
                  : 'border-surface-200 bg-white text-surface-600 hover:bg-surface-50'
              }`}
            >
              <span className={`h-3 w-3 border ${
                (settings.exchangeRateMode || 'manual') === 'manual' ? 'border-primary-600 bg-primary-600' : 'border-surface-300 bg-white'
              }`} />
              <span><span className="block text-sm font-semibold">手动填写</span><span className="mt-0.5 block text-xs font-normal opacity-70">使用固定 USD/CNY 汇率</span></span>
            </button>
            <button
              type="button"
              onClick={() => handleExchangeRateModeChange('auto')}
              className={`flex min-h-14 items-center gap-3 border px-4 text-left transition-colors ${
                settings.exchangeRateMode === 'auto'
                  ? 'border-primary-600 bg-primary-50 text-primary-800'
                  : 'border-surface-200 bg-white text-surface-600 hover:bg-surface-50'
              }`}
            >
              <span className={`h-3 w-3 border ${settings.exchangeRateMode === 'auto' ? 'border-primary-600 bg-primary-600' : 'border-surface-300 bg-white'}`} />
              <span><span className="block text-sm font-semibold">自动获取</span><span className="mt-0.5 block text-xs font-normal opacity-70">使用最新参考汇率</span></span>
            </button>
          </div>

          <div className="mt-3 bg-surface-50 p-4">
            {(settings.exchangeRateMode || 'manual') === 'manual' ? (
              <div className="flex flex-wrap items-end gap-3">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-surface-500">USD/CNY 固定汇率</span>
                  <input
                    type="number"
                    step="0.0001"
                    min="0.0001"
                    value={fixedExchangeRate}
                    onChange={(event) => setFixedExchangeRate(event.target.value)}
                    className="h-10 w-44 border border-surface-200 bg-white px-3 text-sm text-surface-900 outline-none transition-colors focus:border-primary-400"
                    placeholder="输入固定汇率"
                  />
                </label>
                <button
                  type="button"
                  disabled={!Number.isFinite(Number(fixedExchangeRate)) || Number(fixedExchangeRate) <= 0 || Number(fixedExchangeRate) === settings.exchangeRate}
                  onClick={() => setExchangeRate(Number(fixedExchangeRate))}
                  className="h-10 bg-primary-600 px-4 text-sm font-medium text-white transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  保存固定汇率
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
                <div><div className="text-xs text-surface-500">当前 USD/CNY</div><div className="mt-1 text-2xl font-semibold tabular-nums text-surface-900">{settings.exchangeRate.toFixed(4)}</div></div>
                <div className="min-w-0 text-xs leading-5 text-surface-500">
                  <div>更新时间：{settings.exchangeRateUpdatedAt ? new Date(settings.exchangeRateUpdatedAt).toLocaleString('zh-CN') : '尚未获取'}</div>
                  <div>数据来源：{settings.exchangeRateSource || 'Frankfurter'}{settings.exchangeRateSourceDate ? ` · ${settings.exchangeRateSourceDate}` : ''}</div>
                  {exchangeRateError && <div className="text-red-600">{exchangeRateError}</div>}
                </div>
                <button
                  type="button"
                  onClick={handleRefreshLiveExchangeRate}
                  disabled={refreshingExchangeRate}
                  className="ml-auto flex h-10 items-center gap-2 border border-surface-200 bg-white px-4 text-sm font-medium text-surface-700 hover:bg-surface-50 disabled:opacity-50"
                >
                  <RefreshCw size={16} className={refreshingExchangeRate ? 'animate-spin' : ''} />
                  {refreshingExchangeRate ? '获取中' : '立即刷新'}
                </button>
              </div>
            )}
          </div>
        </CollapsibleSection>

        {/* 自定义列设置 */}
        <div className="hidden" aria-hidden="true">
        <CollapsibleSection sectionId="settings-section-自定义列设置" title="自定义列设置" summary={`${settings.customColumns.length} 个自定义字段`}>
          <p className="mb-3 text-sm text-surface-500">添加自定义列到产品列表表格中</p>

          <div className="mb-3 divide-y divide-surface-100 border border-surface-200 bg-white">
            {settings.customColumns.map((col, index) => (
              <div key={col.id} className="flex min-h-12 items-center gap-4 bg-white px-4 py-2 hover:bg-surface-50">
                <div className="flex items-center gap-1">
                  <button onClick={() => moveCustomColumn(col.id, 'up')} disabled={index === 0}
                    className="p-0.5 text-slate-400 hover:text-slate-600 disabled:opacity-30">
                    <ChevronUp size={14} />
                  </button>
                  <button onClick={() => moveCustomColumn(col.id, 'down')} disabled={index === settings.customColumns.length - 1}
                    className="p-0.5 text-slate-400 hover:text-slate-600 disabled:opacity-30">
                    <ChevronDown size={14} />
                  </button>
                </div>
                <span className="flex-1 text-sm font-medium text-surface-800">{col.title}</span>
                <span className="text-xs text-slate-400 w-12">{col.type}</span>
                <button onClick={() => void confirmDelete('删除自定义字段', col.title, () => deleteCustomColumn(col.id))}
                  className="p-1.5 text-surface-400 transition-colors hover:text-red-600">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {settings.customColumns.length === 0 && (
              <p className="bg-surface-50 py-6 text-center text-sm text-surface-400">暂无自定义列</p>
            )}
          </div>

          <div className="flex items-center gap-2 bg-surface-50 p-3">
            <input value={newColumnTitle} onChange={e => setNewColumnTitle(e.target.value)}
              placeholder="列标题"
              className="h-10 min-w-0 flex-1 border border-surface-200 bg-white px-3 text-sm outline-none placeholder:text-surface-400 focus:border-primary-400" />
            <AppSelect
              value={newColumnType}
              onChange={value => setNewColumnType(value as any)}
              options={[
                { value: 'text', label: '文本' },
                { value: 'number', label: '数字' },
                { value: 'date', label: '日期' },
              ]}
              className="w-28 shrink-0"
              triggerClassName="h-10 border-surface-200 bg-white"
            />
            <button onClick={handleAddColumn}
              disabled={!newColumnTitle.trim()}
              className="flex h-10 items-center gap-1 bg-slate-950 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-50">
              <Plus size={14} /> 添加
            </button>
          </div>
        </CollapsibleSection>
        </div>

      </div>
      </ListCardShell>
      {ConfirmDialog}
    </div>
  );
}
