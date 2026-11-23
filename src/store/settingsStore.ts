import { create } from 'zustand';
import { SettingsState, SystemSettings, CustodianBank, TrustManager, StatusConfig, CustomColumn, ProductNameBlock, ProductNameTemplate } from '../types';
import { generateId } from '../utils/id';
import { api } from '../lib/api';
import { _toast } from './toastRef';
import { cascadeRename } from '../utils/cascadeRename';
import {
  createProductNameTemplate,
  getTemplateText,
  inferProductNameTemplate,
  normalizeProductNameTemplate,
  scopedProductNameTemplateKey,
} from '../utils/productNameTemplates';

// 生成默认列顺序
const getDefaultColumnOrder = (customColumns: CustomColumn[]): string[] => {
  const fixedKeys = [
    'productName', 'usd', 'rmb', 'feeRate', 'establishDate',
    'target', 'client', 'status', 'projectCategory', 'activePassive', 'collectiveSingle', 'trustManager', 'trustManagerB', 'custodianBank',
    'deadline', 'brokerChannel', 'strategy', 'tradingBroker',
    'remarks',
  ];
  const customKeys = customColumns.map(c => c.key);
  const incomeKeys = ['annualIncome', 'thisYearIncome', 'performanceIncome'];
  return [...fixedKeys, ...customKeys, ...incomeKeys, 'actions'];
};

const createProductNameBlock = (label: string, template = label): ProductNameBlock => ({
  id: generateId(),
  label,
  template,
});

const compareByInitial = (left: string, right: string) => (
  String(left || '').localeCompare(String(right || ''), 'zh-CN', { numeric: true, sensitivity: 'base' })
);

const sortNamed = <T extends { name: string }>(items: T[]): T[] => (
  [...items].sort((left, right) => compareByInitial(left.name, right.name))
);

const STATUS_WORKFLOW_ORDER = ['材料收集', '报告撰写', '上会中', '已过会', '已成立', '项目中止'];
const STATUS_ORDER_VERSION = 1;

const migrateLegacyStatusOrder = (items: StatusConfig[]): StatusConfig[] => {
  const workflowRank = new Map(STATUS_WORKFLOW_ORDER.map((name, index) => [name, index]));
  return items
    .map((item, index) => ({ item, index, rank: workflowRank.get(item.name) ?? Number.MAX_SAFE_INTEGER }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map(({ item }) => item);
};

const createProductNameRule = (
  name: string,
  blockSpecs: Array<{ label: string; template?: string }>
): ProductNameTemplate => {
  const blocks = blockSpecs.map(spec => createProductNameBlock(spec.label, spec.template || spec.label));
  return {
    id: generateId(),
    name,
    blocks,
    composition: blocks.map(block => block.id),
  };
};

const defaultProductNameTemplates = (): ProductNameTemplate[] => [
  createProductNameTemplate('鸿泰-跨境投资$$号QDII单一资金信托', 'workLog'),
  createProductNameTemplate('环球甄选$$号', 'workLog'),
  createProductNameTemplate('$$期', 'workLog'),
  createProductNameTemplate('$$', 'workLog'),
  createProductNameTemplate('跨境投资$$号', 'project'),
];

const dedupeProductNameTemplates = (templates: ProductNameTemplate[]): ProductNameTemplate[] => {
  const seen = new Set<string>();
  return templates.filter(rule => {
    const scope = rule.scope || 'workLog';
    const template = getTemplateText(rule);
    const key = `${scope}:${normalizeProductNameTemplate(template)}`;
    if (!template.trim() || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const isGenericProductNameLevelName = (name: string): boolean => (
  ['一级', '二级', '三级', '四级', '五级'].includes(name)
  || /^第\d+级/.test(name)
);

const migrateProductNameTemplate = (item: any): ProductNameTemplate | null => {
  if (typeof item === 'string') {
    const template = item.trim();
    return template ? createProductNameRule(template, [{ label: template }]) : null;
  }

  if (!item || typeof item !== 'object') return null;

  if (Array.isArray(item.blocks)) {
    const blocks = item.blocks
      .map((block: any) => {
        const template = String(block?.template || block?.label || '').trim();
        const label = String(block?.label || template).trim();
        if (!template) return null;
        return {
          id: block?.id || generateId(),
          label: label || template,
          template,
        };
      })
      .filter(Boolean) as ProductNameBlock[];

    if (blocks.length === 0) return null;

    const blockIds = new Set(blocks.map(block => block.id));
    const composition = Array.isArray(item.composition)
      ? item.composition.map((id: any) => String(id)).filter((id: string) => blockIds.has(id))
      : blocks.map(block => block.id);

    return {
      id: item.id || generateId(),
      name: String(item.name || '名称规则').trim() || '名称规则',
      scope: item.scope === 'project' ? 'project' : 'workLog',
      blocks,
      composition: composition.length > 0 ? composition : blocks.map(block => block.id),
    };
  }

  if (item.template && !item.levels) {
    const template = String(item.template).trim();
    if (!template) return null;
    return createProductNameRule(String(item.name || template).trim() || template, [
      { label: String(item.name || template).trim() || template, template },
    ]);
  }

  if (Array.isArray(item.levels)) {
    const blockSpecs: Array<{ label: string; template: string }> = [];
    item.levels.forEach((level: any) => {
      const levelName = String(level?.name || '').trim();
      const options = Array.isArray(level?.options) ? level.options : [];
      options.forEach((option: any) => {
        const template = String(typeof option === 'string' ? option : option?.template || '').trim();
        if (!template) return;
        const label = levelName && !isGenericProductNameLevelName(levelName) && options.length === 1
          ? levelName
          : template;
        blockSpecs.push({ label, template });
      });
    });

    if (blockSpecs.length > 0) {
      return createProductNameRule(String(item.name || '名称规则').trim() || '名称规则', blockSpecs);
    }
  }

  return null;
};

// 默认设置
const defaultSettings: SystemSettings = {
  id: 'settings',
  custodianBanks: [
    { id: generateId(), name: '招商银行' },
    { id: generateId(), name: '工商银行' },
    { id: generateId(), name: '建设银行' }
  ],
  trustManagers: [
    { id: generateId(), name: '张三' },
    { id: generateId(), name: '李四' },
    { id: generateId(), name: '王五' }
  ],
  statusConfigs: [
    { id: generateId(), name: '材料收集', color: '#94a3b8' },
    { id: generateId(), name: '报告撰写', color: '#60a5fa' },
    { id: generateId(), name: '上会中', color: '#f59e0b' },
    { id: generateId(), name: '已过会', color: '#84cc16' },
    { id: generateId(), name: '已成立', color: '#16a34a' },
    { id: generateId(), name: '项目中止', color: '#dc2626' }
  ],
  statusOrderVersion: STATUS_ORDER_VERSION,
  productNameTemplates: defaultProductNameTemplates(),
  workLogNamePrefixes: ['鸿泰-跨境投资', '环球甄选'],
  workLogNameSuffixes: ['号QDII单一资金信托', '号', '期'],
  projectNamePrefixes: ['跨境投资'],
  projectNameSuffixes: ['号'],
  productNameTemplateDefaultsVersion: 1,
  reservedProjectNumbers: [],
  reservedProjectNumbersByTemplate: {},
  suppressedProductNameTemplateKeys: [],
  fieldOptions: {},
  exchangeRate: 7.2,
  manualExchangeRate: 7.2,
  autoExchangeRate: undefined,
  exchangeRateMode: 'manual',
  exchangeRateUpdatedAt: undefined,
  exchangeRateSource: undefined,
  exchangeRateSourceDate: undefined,
  customColumns: [],
  columnOrder: getDefaultColumnOrder([])
};

const LEGACY_PRODUCT_NAMING_SETTING_KEYS = [
  'productSeries',
  'workLogProductSeries',
  'projectProductSeries',
  'workLogProductPrefixes',
  'workLogProductSuffixes',
  'projectProductPrefixes',
  'projectProductSuffixes',
  'workLogProductNameTemplates',
  'projectProductNameTemplates',
  'occupiedStatusIds',
  'dataIsolationMode',
];

const stripLegacyProductNamingSettings = (data: any) => {
  const cleanData = { ...data };
  LEGACY_PRODUCT_NAMING_SETTING_KEYS.forEach(key => {
    delete cleanData[key];
  });
  return cleanData;
};

const migrateSettings = (data: any): SystemSettings => {
  let custodianBanks: CustodianBank[] = [];
  if (Array.isArray(data.custodianBanks)) {
    custodianBanks = data.custodianBanks.map((bank: string | CustodianBank) => {
      if (typeof bank === 'string') {
        return { id: generateId(), name: bank };
      }
      return { id: bank.id || generateId(), name: String(bank.name || '').trim() };
    });
  }

  let trustManagers: TrustManager[] = [];
  if (Array.isArray(data.trustManagers)) {
    trustManagers = data.trustManagers.map((manager: string | TrustManager) => {
      if (typeof manager === 'string') {
        return { id: generateId(), name: manager };
      }
      return manager;
    });
  }

  let statusConfigs: StatusConfig[] = [];
  if (Array.isArray(data.statusConfigs)) {
    statusConfigs = data.statusConfigs
      .filter((status: StatusConfig) => status.name !== '已落地' && status.name !== '终止')
      .map((status: StatusConfig) => ({ ...status }));
  } else {
    statusConfigs = [
      { id: generateId(), name: '材料收集', color: '#94a3b8' },
      { id: generateId(), name: '报告撰写', color: '#60a5fa' },
      { id: generateId(), name: '上会中', color: '#f59e0b' },
      { id: generateId(), name: '已过会', color: '#84cc16' },
      { id: generateId(), name: '已成立', color: '#16a34a' },
      { id: generateId(), name: '项目中止', color: '#dc2626' }
    ];
  }

  let customColumns: CustomColumn[] = [];
  if (Array.isArray(data.customColumns)) {
    customColumns = data.customColumns;
  }
  const statusOrderVersion = Number(data.statusOrderVersion) || 0;
  if (statusOrderVersion < STATUS_ORDER_VERSION) {
    statusConfigs = migrateLegacyStatusOrder(statusConfigs);
  }

  let productNameTemplates: ProductNameTemplate[] = [];
  if (Array.isArray(data.productNameTemplates)) {
    productNameTemplates = data.productNameTemplates
      .map(migrateProductNameTemplate)
      .filter(Boolean) as ProductNameTemplate[];
  }
  productNameTemplates = dedupeProductNameTemplates(productNameTemplates);
  if (productNameTemplates.length === 0) {
    productNameTemplates = defaultProductNameTemplates();
  }
  const productNameTemplateDefaultsVersion = Number(data.productNameTemplateDefaultsVersion) || 0;
  if (
    productNameTemplateDefaultsVersion < 1
    && !productNameTemplates.some(rule => (rule.scope || 'workLog') === 'project')
  ) {
    productNameTemplates = dedupeProductNameTemplates([
      ...productNameTemplates,
      createProductNameTemplate('跨境投资$$号', 'project'),
    ]);
  }

  const suppressedProductNameTemplateKeys = Array.isArray(data.suppressedProductNameTemplateKeys)
    ? data.suppressedProductNameTemplateKeys.filter((item: any) => typeof item === 'string')
    : [];
  const cleanNameParts = (value: unknown, fallback: string[]) => Array.isArray(value)
    ? Array.from(new Set(value.map(item => String(item || '').trim()).filter(Boolean)))
    : fallback;
  const workLogNamePrefixes = cleanNameParts(data.workLogNamePrefixes, ['鸿泰-跨境投资', '环球甄选']);
  const workLogNameSuffixes = cleanNameParts(data.workLogNameSuffixes, ['号QDII单一资金信托', '号', '期']);
  const projectNamePrefixes = cleanNameParts(data.projectNamePrefixes, ['跨境投资']);
  const projectNameSuffixes = cleanNameParts(data.projectNameSuffixes, ['号']);
  const reservedProjectNumbers = Array.isArray(data.reservedProjectNumbers)
    ? Array.from(new Set<number>(
      data.reservedProjectNumbers
        .map((item: any) => Number(item))
        .filter((item: number) => Number.isInteger(item) && item > 0),
    )).sort((left, right) => left - right)
    : [];
  const reservedProjectNumbersByTemplate = Object.entries(
    data.reservedProjectNumbersByTemplate && typeof data.reservedProjectNumbersByTemplate === 'object'
      ? data.reservedProjectNumbersByTemplate
      : {},
  ).reduce<Record<string, number[]>>((result, [key, value]) => {
    if (!Array.isArray(value)) return result;
    result[key] = Array.from(new Set<number>(
      value
        .map(item => Number(item))
        .filter(item => Number.isInteger(item) && item > 0),
    )).sort((left, right) => left - right);
    return result;
  }, {});
  const legacyReservedKey = scopedProductNameTemplateKey('project', '跨境投资$$号');
  if (reservedProjectNumbers.length > 0 && !reservedProjectNumbersByTemplate[legacyReservedKey]) {
    reservedProjectNumbersByTemplate[legacyReservedKey] = reservedProjectNumbers;
  }

  const fieldOptions: Record<string, string[]> = data.fieldOptions || {};
  const validStatusIds = new Set(statusConfigs.map(status => status.id));
  const rawProjectNumberOccupiedStatusIds = Array.isArray(data.projectNumberOccupiedStatusIds)
    ? data.projectNumberOccupiedStatusIds
    : undefined;
  const projectNumberOccupiedStatusIds = rawProjectNumberOccupiedStatusIds
    ? Array.from(new Set<string>(
      rawProjectNumberOccupiedStatusIds.filter(
        (id: unknown): id is string => typeof id === 'string' && validStatusIds.has(id),
      ),
    ))
    : undefined;

  const cleanData = stripLegacyProductNamingSettings(data);

  const result: SystemSettings = {
    ...cleanData,
    custodianBanks: sortNamed(custodianBanks),
    trustManagers: sortNamed(trustManagers),
    // Project stages are a business workflow, not an alphabetical list.
    // Preserve the configured order so 材料收集 -> 报告撰写 remains stable
    // and manual move-up/move-down changes survive a reload.
    statusConfigs,
    statusOrderVersion: STATUS_ORDER_VERSION,
    productNameTemplates,
    workLogNamePrefixes,
    workLogNameSuffixes,
    projectNamePrefixes,
    projectNameSuffixes,
    productNameTemplateDefaultsVersion: 1,
    reservedProjectNumbers,
    reservedProjectNumbersByTemplate,
    projectNumberOccupiedStatusIds,
    suppressedProductNameTemplateKeys,
    fieldOptions,
    exchangeRate: data.exchangeRate ?? 7.2,
    manualExchangeRate: data.manualExchangeRate
      ?? (data.exchangeRateMode === 'auto' ? 7.2 : (data.exchangeRate ?? 7.2)),
    autoExchangeRate: Number.isFinite(Number(data.autoExchangeRate)) ? Number(data.autoExchangeRate) : undefined,
    exchangeRateMode: data.exchangeRateMode === 'auto' ? 'auto' : 'manual',
    exchangeRateUpdatedAt: data.exchangeRateUpdatedAt || undefined,
    exchangeRateSource: data.exchangeRateSource || undefined,
    exchangeRateSourceDate: data.exchangeRateSourceDate || undefined,
    customColumns,
    columnOrder: data.columnOrder,
  };

  if (!Array.isArray(result.columnOrder)) {
    result.columnOrder = getDefaultColumnOrder(customColumns);
  } else if (!result.columnOrder.includes('trustManagerB')) {
    const managerIndex = result.columnOrder.indexOf('trustManager');
    result.columnOrder = [...result.columnOrder];
    result.columnOrder.splice(managerIndex >= 0 ? managerIndex + 1 : result.columnOrder.length, 0, 'trustManagerB');
  }

  return result;
};

// 通用移动数组元素函数
const moveArrayItem = <T extends { id: string }>(
  array: T[], id: string, direction: 'up' | 'down'): T[] => {
  const index = array.findIndex(item => item.id === id);
  if (index === -1) return array;

  const newArray = [...array];
  const item = newArray.splice(index, 1)[0];

  let newIndex = direction === 'up' ? index - 1 : index + 1;
  if (newIndex < 0) newIndex = 0;
  if (newIndex >= array.length) newIndex = array.length - 1;

  newArray.splice(newIndex, 0, item);
  return newArray;
};

// 防抖保存：收集短时间内的多次更新，只发一次 API
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function debouncedSaveSettings(settings: SystemSettings) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    try {
      await api.put('/settings', { settings });
    } catch (err: any) {
      _toast?.error?.(err.message || '保存设置失败');
    }
  }, 500);
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: defaultSettings,

  reloadSettings: async () => {
    try {
      const res = await api.get<{ settings: any }>('/settings');
      if (res.settings) {
        set({ settings: migrateSettings(res.settings) });
      }
    } catch (err: any) {
      _toast?.error?.(err.message || '获取设置失败');
    }
  },

  updateSettings: (updates) => {
    const newSettings = { ...get().settings, ...updates };
    set({ settings: newSettings });
    debouncedSaveSettings(newSettings);
  },

  addCustodianBank: (bank) => {
    const newBank: CustodianBank = { id: generateId(), name: bank };
    const newSettings = { ...get().settings, custodianBanks: sortNamed([...get().settings.custodianBanks, newBank]) };
    set({ settings: newSettings });
    debouncedSaveSettings(newSettings);
  },

  updateCustodianBank: (id, bank) => {
    const old = get().settings.custodianBanks.find(b => b.id === id);
    const oldName = old?.name;
    const newSettings = { ...get().settings, custodianBanks: sortNamed(get().settings.custodianBanks.map(b => b.id === id ? { ...b, ...bank } : b)) };
    set({ settings: newSettings });
    debouncedSaveSettings(newSettings);
    if (oldName && bank.name && oldName !== bank.name) {
      cascadeRename('custodianBank', oldName, bank.name);
    }
  },

  deleteCustodianBank: (id) => {
    const newSettings = { ...get().settings, custodianBanks: get().settings.custodianBanks.filter(b => b.id !== id) };
    set({ settings: newSettings });
    debouncedSaveSettings(newSettings);
  },

  moveCustodianBank: (id, direction) => {
    const newSettings = { ...get().settings, custodianBanks: moveArrayItem(get().settings.custodianBanks, id, direction) };
    set({ settings: newSettings });
    debouncedSaveSettings(newSettings);
  },

  addTrustManager: (manager) => {
    const name = manager.trim();
    if (!name || get().settings.trustManagers.some(m => m.name === name)) return;
    const newManager: TrustManager = { id: generateId(), name };
    const newSettings = { ...get().settings, trustManagers: sortNamed([...get().settings.trustManagers, newManager]) };
    set({ settings: newSettings });
    debouncedSaveSettings(newSettings);
  },

  deleteTrustManager: (id) => {
    const newSettings = { ...get().settings, trustManagers: get().settings.trustManagers.filter(m => m.id !== id) };
    set({ settings: newSettings });
    debouncedSaveSettings(newSettings);
  },

  moveTrustManager: (id, direction) => {
    const newSettings = { ...get().settings, trustManagers: moveArrayItem(get().settings.trustManagers, id, direction) };
    set({ settings: newSettings });
    debouncedSaveSettings(newSettings);
  },

  addStatusConfig: (config) => {
    const newConfig: StatusConfig = { ...config, id: generateId() };
    const newSettings = { ...get().settings, statusConfigs: [...get().settings.statusConfigs, newConfig] };
    set({ settings: newSettings });
    debouncedSaveSettings(newSettings);
  },

  updateStatusConfig: (id, config) => {
    const old = get().settings.statusConfigs.find(c => c.id === id);
    const oldName = old?.name;
    const newSettings = { ...get().settings, statusConfigs: get().settings.statusConfigs.map(c => c.id === id ? { ...c, ...config } : c) };
    set({ settings: newSettings });
    debouncedSaveSettings(newSettings);
    if (oldName && config.name && oldName !== config.name) {
      cascadeRename('status', oldName, config.name);
    }
  },

  deleteStatusConfig: (id) => {
    const currentSettings = get().settings;
    const newSettings = {
      ...currentSettings,
      statusConfigs: currentSettings.statusConfigs.filter(c => c.id !== id),
      projectNumberOccupiedStatusIds: currentSettings.projectNumberOccupiedStatusIds?.filter(statusId => statusId !== id),
    };
    set({ settings: newSettings });
    debouncedSaveSettings(newSettings);
  },

  moveStatusConfig: (id, direction) => {
    const newSettings = { ...get().settings, statusConfigs: moveArrayItem(get().settings.statusConfigs, id, direction) };
    set({ settings: newSettings });
    debouncedSaveSettings(newSettings);
  },

  updateExchangeRate: (rate) => {
    const newSettings = { ...get().settings, exchangeRate: rate };
    set({ settings: newSettings });
    debouncedSaveSettings(newSettings);
  },

  addCustomColumn: (column) => {
    const existingKeys = get().settings.customColumns.map(c => c.key);
    let keyNum = 1;
    while (existingKeys.includes(`custom_col_${keyNum}`)) { keyNum++; }
    const key = `custom_col_${keyNum}`;
    const newColumn: CustomColumn = { ...column, id: generateId(), key };
    const newSettings = { ...get().settings, customColumns: [...get().settings.customColumns, newColumn] };
    set({ settings: newSettings });
    debouncedSaveSettings(newSettings);
  },

  updateCustomColumn: (id, column) => {
    const newSettings = { ...get().settings, customColumns: get().settings.customColumns.map(c => c.id === id ? { ...c, ...column } : c) };
    set({ settings: newSettings });
    debouncedSaveSettings(newSettings);
  },

  deleteCustomColumn: (id) => {
    const newSettings = { ...get().settings, customColumns: get().settings.customColumns.filter(c => c.id !== id) };
    set({ settings: newSettings });
    debouncedSaveSettings(newSettings);
  },

  moveCustomColumn: (id, direction) => {
    const newSettings = { ...get().settings, customColumns: moveArrayItem(get().settings.customColumns, id, direction) };
    set({ settings: newSettings });
    debouncedSaveSettings(newSettings);
  },

  updateColumnOrder: (order: string[]) => {
    const newSettings = { ...get().settings, columnOrder: order };
    set({ settings: newSettings });
    debouncedSaveSettings(newSettings);
  },

  addFieldOption: (field, value) => {
    if (!value || !value.trim()) return;
    const v = value.trim();
    const current = get().settings.fieldOptions[field] || [];
    if (current.includes(v)) return;
    const newOptions = { ...get().settings.fieldOptions, [field]: [...current, v] };
    const newSettings = { ...get().settings, fieldOptions: newOptions };
    set({ settings: newSettings });
    debouncedSaveSettings(newSettings);
  },

  deleteFieldOption: (field, value) => {
    const current = get().settings.fieldOptions[field] || [];
    const newOptions = { ...get().settings.fieldOptions, [field]: current.filter(v => v !== value) };
    const newSettings = { ...get().settings, fieldOptions: newOptions };
    set({ settings: newSettings });
    debouncedSaveSettings(newSettings);
  },

  renameFieldOption: (field, oldValue, newValue) => {
    if (!newValue || !newValue.trim()) return;
    const current = get().settings.fieldOptions[field] || [];
    const newOptions = { ...get().settings.fieldOptions, [field]: current.map(v => v === oldValue ? newValue.trim() : v) };
    const newSettings = { ...get().settings, fieldOptions: newOptions };
    set({ settings: newSettings });
    debouncedSaveSettings(newSettings);
    cascadeRename(field, oldValue, newValue.trim());
  },

  scanProductNameTemplates: (productNames, scope = 'workLog') => {
    const settings = get().settings;
    const currentTemplates = dedupeProductNameTemplates(settings.productNameTemplates);
    const existingKeys = new Set(
      currentTemplates
        .filter(rule => (rule.scope || 'workLog') === scope)
        .map(rule => scopedProductNameTemplateKey(scope, getTemplateText(rule)))
        .filter(Boolean)
    );
    const suppressedKeys = new Set(settings.suppressedProductNameTemplateKeys || []);
    const nextTemplates: ProductNameTemplate[] = [];

    productNames.forEach(name => {
      const cleanName = String(name || '').trim();
      const template = inferProductNameTemplate(cleanName);
      const key = scopedProductNameTemplateKey(scope, template);
      if (!cleanName || !template || template === cleanName || !key) return;
      if (existingKeys.has(key) || suppressedKeys.has(key)) return;
      existingKeys.add(key);
      nextTemplates.push(createProductNameTemplate(template, scope));
    });

    if (nextTemplates.length === 0) return;

    const newSettings = {
      ...settings,
      productNameTemplates: dedupeProductNameTemplates([...currentTemplates, ...nextTemplates]),
    };
    set({ settings: newSettings });
    debouncedSaveSettings(newSettings);
  },

  // 汇率设置按用户独立保存，不再写入全局汇率接口。
  setExchangeRate: (rate) => {
    const newSettings = {
      ...get().settings,
      exchangeRate: rate,
      manualExchangeRate: rate,
      exchangeRateMode: 'manual' as const,
      exchangeRateUpdatedAt: new Date().toISOString(),
    };
    set({ settings: newSettings });
    debouncedSaveSettings(newSettings);
    _toast.success?.(`汇率已更新: USD/CNY = ${rate}`);
  },

  refreshLiveExchangeRate: async () => {
    // Mode selection and live refresh happen back-to-back. Cancel the pending
    // full-settings save so an older exchangeRate cannot overwrite the fresh rate.
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    try {
      const result = await api.post<{
        rate: number;
        updatedAt: string;
        source: string;
        sourceDate?: string;
      }>('/settings/exchange-rate/live', {});
      const newSettings = {
        ...get().settings,
        exchangeRate: result.rate,
        autoExchangeRate: result.rate,
        exchangeRateMode: 'auto' as const,
        exchangeRateUpdatedAt: result.updatedAt,
        exchangeRateSource: result.source,
        exchangeRateSourceDate: result.sourceDate,
      };
      set({ settings: newSettings });
      _toast.success?.(`已获取最新汇率: USD/CNY = ${result.rate}`);
      return result.rate;
    } catch (err: any) {
      // Keep the selected automatic mode and the last valid rate as the fallback.
      debouncedSaveSettings(get().settings);
      _toast?.error?.(err.message || '实时汇率获取失败，继续使用最近一次有效汇率');
      throw err;
    }
  },

  scanAllFieldOptions: (entries, products) => {
    // 定义需要扫描的字段：autocomplete 类型的字段
    const targetFields = [
      'clientType', 'personA', 'personB', 'advisorManager', 'channelSales',
      'features', 'managementReport', 'riskReport', 'salesReport', 'nextWeekPlan',
      'productName', 'target', 'client', 'brokerChannel', 'strategy', 'tradingBroker',
      'custodianBank', 'trustManager', 'trustManagerB', 'status',
    ];
    const settings = get().settings;
    const counts: Record<string, Record<string, number>> = {};

    // 初始化计数
    for (const f of targetFields) counts[f] = {};

    // 统计 entries 数据
    for (const entry of entries) {
      for (const f of targetFields) {
        const v = entry[f];
        if (v && typeof v === 'string' && v.trim()) {
          counts[f][v.trim()] = (counts[f][v.trim()] || 0) + 1;
        }
      }
    }

    // 统计 products 数据
    for (const product of products) {
      for (const f of targetFields) {
        const v = product[f];
        if (v && typeof v === 'string' && v.trim()) {
          counts[f][v.trim()] = (counts[f][v.trim()] || 0) + 1;
        }
      }
    }

    // 对于已有专用存储的字段，先检查缺失值
    const existingBanks = new Set(settings.custodianBanks.map(b => b.name));
    const existingManagers = new Set(settings.trustManagers.map(m => m.name));
    const existingStatuses = new Set(settings.statusConfigs.map(s => s.name));

    const newFieldOptions = { ...settings.fieldOptions };

    for (const f of targetFields) {
      const fieldCounts = counts[f];
      const existing = new Set(newFieldOptions[f] || []);

      for (const [value, cnt] of Object.entries(fieldCounts)) {
        if (cnt < 2) continue; // 出现次数 < 2 跳过
        if (existing.has(value)) continue;

        // 检查是否已在专用存储中
        if (f === 'custodianBank' && existingBanks.has(value)) continue;
        if ((f === 'trustManager' || f === 'trustManagerB') && existingManagers.has(value)) continue;
        if (f === 'status' && existingStatuses.has(value)) continue;

        // 已存在于专用存储
        const inDedicated =
          (f === 'custodianBank' && existingBanks.has(value)) ||
          ((f === 'trustManager' || f === 'trustManagerB') && existingManagers.has(value)) ||
          (f === 'status' && existingStatuses.has(value));

        if (!inDedicated) {
          if (!newFieldOptions[f]) newFieldOptions[f] = [];
          newFieldOptions[f] = [...newFieldOptions[f], value];
        }
      }
    }

    // 对于 custodianBank 和 trustManager，也检查专用存储是否有遗漏
    const custodianValues = counts['custodianBank'] || {};
    for (const [v, cnt] of Object.entries(custodianValues)) {
      if (cnt >= 2 && !existingBanks.has(v)) {
        if (!newFieldOptions['custodianBank']) newFieldOptions['custodianBank'] = [];
        if (!newFieldOptions['custodianBank'].includes(v)) {
          newFieldOptions['custodianBank'] = [...newFieldOptions['custodianBank'], v];
        }
      }
    }

    if (JSON.stringify(newFieldOptions) !== JSON.stringify(settings.fieldOptions)) {
      const newSettings = { ...settings, fieldOptions: newFieldOptions };
      set({ settings: newSettings });
      debouncedSaveSettings(newSettings);
    }
  },
}));
