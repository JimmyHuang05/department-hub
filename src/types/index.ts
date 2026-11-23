export interface BaseEntity {id: string;
 createdAt: string;
 updatedAt: string;}

export interface User extends BaseEntity {display_name?: string;
 email?: string;
 birthday?: string;
 password?: string;
 role:'user'|'admin';
 business_role?:'intern'|'trust_manager'|'developer'|'admin';
 status?:'active'|'disabled'|'pending';}

export interface InvestmentProduct extends BaseEntity {productName: string;
 usd: number;
 rmb: number;
 feeRate: number;
 projectCreatedDate?: string;
 /** @deprecated 历史数据兼容；新数据统一使用 projectCreatedDate。 */
 progressStartDate?: string;
 establishDate: string;
 projectStoppedDate?: string;
 target: string;
 client: string;
 brokerChannel: string;
 strategy: string;
 custodianBank: string;
 tradingBroker: string;
 annualIncome: number;
 thisYearIncome: number;
 performanceIncome: number;
 status: string;
 projectCategory?: string;
 activePassive?: string;
 collectiveSingle?: string;
 /** 页面显示为“项目备用”时，数据库主状态仍保存为“项目中止”。 */
 projectBackup?: boolean;
 /** 信托经理A角；保留原字段名以兼容历史数据。 */
 trustManager: string;
 trustManagerB?: string;
 deadline: string;
 remarks: string;
 dynamicFields?: Record<string, string | number>;}

export interface ForcedLogoutInfo {message?: string;
 deviceType?:'desktop'|'mobile'|string;
 deviceName?: string;
 loginAt?: string;}

export interface LoginConflict {deviceType?:'desktop'|'mobile'|string;
 deviceName?: string;
 loginAt?: string;
 lastSeenAt?: string;}

export interface AuthState {user: User | null;
 isAuthenticated: boolean;
 forcedLogoutInfo: ForcedLogoutInfo | null;
 loginConflict: LoginConflict | null;
  login: (identifier: string, password: string, force?: boolean) => Promise<boolean>;
 logout: () => void;
 forceLogout: (info?: ForcedLogoutInfo) => void;
 clearForcedLogout: () => void;
 clearLoginConflict: () => void;
 refreshUser: () => Promise<void>;}

export interface ProductState {products: InvestmentProduct[];
 isLoading: boolean;
 fetchProducts: () => Promise<void>;
 addProduct: (product: Omit<InvestmentProduct, keyof BaseEntity>) => void;
 updateProduct: (id: string, product: Partial<InvestmentProduct>) => void;
 batchUpdateProducts: (changes: Array<{id: string; field: string; lockField?: string; value: string | number | boolean; version?: number}>, label?: string) => Promise<boolean>;
 applyRemoteProductUpdate: (id: string, product: Partial<InvestmentProduct>) => void;
   deleteProduct: (id: string) => Promise<boolean>;
   deleteProducts: (ids: string[]) => Promise<{deletedIds: string[]; deniedIds: string[]; missingIds: string[]}>;
 getProductById: (id: string) => InvestmentProduct | undefined;
 insertProductAt: (index: number, product: InvestmentProduct) => Promise<boolean>;
 blankProduct: () => InvestmentProduct;
 replaceProducts: (products: InvestmentProduct[]) => void;
 mergeProducts: (products: InvestmentProduct[]) => void;
 moveProduct: (id: string, toIndex: number) => void;}

export interface TableColumn {key: string;
 title: string;
 width?: number;
 sortable?: boolean;
 filterable?: boolean;
 render?: (value: any, record: InvestmentProduct) => React.ReactNode;
 editable?: boolean;
 type?:'text'|'number'|'date'|'select';}

export interface ValidationRule {required?: boolean;
 message?: string;
 min?: number;
 max?: number;
 pattern?: RegExp;
 validator?: (value: any) => boolean | string;}

export interface FormErrors {[key: string]: string;}

// 产品系列配置
export interface CustodianBank {id: string;
 name: string;}

// 信托经理配置
export interface TrustManager {id: string;
 name: string;}

// 自定义列配置
export interface CustomColumn {id: string;
 key: string;
 title: string;
 type:'text'|'number'|'date';
 width?: number;}

// 状态配置
export interface StatusConfig {id: string;
   name: string;
   color: string;}

export interface ProductNameBlock {id: string;
 label: string;
 template: string;}

export interface ProductNameTemplate {id: string;
 name: string;
 scope?: 'workLog' | 'project';
 blocks: ProductNameBlock[];
 composition: string[];}

// 系统设置
export interface SystemSettings {id: string;
 custodianBanks: CustodianBank[];
 trustManagers: TrustManager[];
 statusConfigs: StatusConfig[];
 statusOrderVersion?: number;
 productNameTemplates: ProductNameTemplate[];
 workLogNamePrefixes?: string[];
 workLogNameSuffixes?: string[];
 projectNamePrefixes?: string[];
 projectNameSuffixes?: string[];
 productNameTemplateDefaultsVersion?: number;
 reservedProjectNumbers?: number[];
 reservedProjectNumbersByTemplate?: Record<string, number[]>;
 projectNumberOccupiedStatusIds?: string[];
 suppressedProductNameTemplateKeys?: string[];
 fieldOptions: Record<string, string[]>; // 统一字段选项存储：field → value[]
  exchangeRate: number;
  manualExchangeRate?: number;
  autoExchangeRate?: number;
  exchangeRateMode?: 'manual' | 'auto';
  exchangeRateUpdatedAt?: string; // 最近设置时间
  exchangeRateSource?: string;
  exchangeRateSourceDate?: string;
 customColumns: CustomColumn[];
 columnOrder: string[];
}

// ====== 工作日志模块 ======

export interface WorkLogEntry extends BaseEntity {// 分类
 projectId?: string; // 稳定关联的项目 ID；旧数据允许为空
 reviewStatus?: 'draft' | 'submitted' | 'returned' | 'approved';
 reviewComment?: string;
 reviewedBy?: string;
 reviewedAt?: string;
 category: string; // 正常项目 / 问题项目 / 直销产品情况
 subCategory: string; // 直销产品下的子分类：固收系列 / 含权系列 / 权益类

 // 基本信息
 productName: string; // 产品名
 status: string; // 状态
 clientType: string; // 客户名称/类型（正常项目）/ 对手方（问题项目）
 navScale: string; // 净值/规模情况
 description: string; // 问题描述/产品状态描述（问题项目专用）

 // 日期
 establishDate: string; // 成立日/拟成立日
 deadline?: string; // 预计最晚化解时间
 productTerm: string; // 产品期限

 // 团队
 personA: string; // A角
 personB: string; // B角

 // 分类属性
 activePassive: string; // 主动/被动
 collectiveSingle: string; // 集合/单一
 advisorManager: string; // 投资顾问/管理人

 // 业务信息
 channelSales: string; // 渠道销售
 features: string; // 特色
 managementReport: string; // 管理报告
 riskReport: string; // 风控报告
 salesReport: string; // 销售端报告
 nextWeekPlan: string; // 下周工作计划

 // 净值跟踪
 nav: number; // 净值
 yearStartNav: number; // 年初净值
 changePercent: number; // 涨跌幅

 // 每周进展（键名：210806, 210813, ... 值：进展文本）
 weeklyProgress: Record<string, string>;

 // 每周净值/规模情况历史（键名：210806, 210813, ... 值：当时的净值/规模情况）
 navScaleHistory: Record<string, string>;

 // 周次标识（YYMMDD格式，如 260612 表示2026年6月12日那周的周五）
 weekKey?: string;

 // 分类特有数据（直销产品情况：目标规模/当前规模/周变动/持仓/回顾/计划/渠道信息等）
 dynamicFields: Record<string, any>;}

export interface WorkLogState {entries: WorkLogEntry[];
 currentWeekKey: string;
 selectedWeekKey: string | null;
 isLoading: boolean;
 refreshCurrentWeek: () => void;
 fetchEntries: () => Promise<void>;
 addEntry: (entry: Omit<WorkLogEntry, keyof BaseEntity>) => void;
 updateEntry: (id: string, entry: Partial<WorkLogEntry>) => void;
 deleteEntry: (id: string) => void;
 deleteEntries: (ids: string[]) => void;
 insertEntryAt: (index: number, entry: WorkLogEntry) => void;
 blankEntry: () => WorkLogEntry;
 replaceEntries: (entries: WorkLogEntry[]) => void;
 mergeEntries: (entries: WorkLogEntry[]) => void;
 moveEntry: (id: string, toIndex: number) => void;
 setSelectedWeekKey: (key: string | null) => void;
 copyEntriesFromWeek: (fromWeekKey: string, toWeekKey: string) => Promise<number>;}

// 设置状态管理接口
// 导入模式
export type ImportMode ='overwrite'|'append';

// 导入解析结果
export interface ParseResult {rows: Partial<InvestmentProduct>[];
 errors: {row: number; message: string}[];
 totalRows: number;
 successRows: number;}

export interface SettingsState {settings: SystemSettings;
 reloadSettings: () => void;
 updateSettings: (updates: Partial<SystemSettings>) => void;
 addCustodianBank: (bank: string) => void;
 updateCustodianBank: (id: string, bank: Partial<CustodianBank>) => void;
 deleteCustodianBank: (id: string) => void;
 moveCustodianBank: (id: string, direction:'up'|'down') => void;
 addTrustManager: (manager: string) => void;
 deleteTrustManager: (id: string) => void;
 moveTrustManager: (id: string, direction:'up'|'down') => void;
 addStatusConfig: (config: Omit<StatusConfig,'id'>) => void;
 updateStatusConfig: (id: string, config: Partial<StatusConfig>) => void;
 deleteStatusConfig: (id: string) => void;
 moveStatusConfig: (id: string, direction:'up'|'down') => void;
 updateExchangeRate: (rate: number) => void;
 addCustomColumn: (column: Omit<CustomColumn,'id'|'key'>) => void;
 updateCustomColumn: (id: string, column: Partial<CustomColumn>) => void;
 deleteCustomColumn: (id: string) => void;
 moveCustomColumn: (id: string, direction:'up'|'down') => void;
	updateColumnOrder: (order: string[]) => void;
	/** 添加字段选项（统一存储） */
	addFieldOption: (field: string, value: string) => void;
	/** 删除字段选项 */
	deleteFieldOption: (field: string, value: string) => void;
	/** 重命名字段选项 */
	renameFieldOption: (field: string, oldValue: string, newValue: string) => void;
	/** 扫描所有数据，自动注册出现≥2次的选项 */
	scanAllFieldOptions: (entries: any[], products: any[]) => void;
	/** 扫描产品名，自动补充名称模板 */
	scanProductNameTemplates: (productNames: string[], scope?: 'workLog' | 'project') => void;
	/** 设置全局汇率 A */
	setExchangeRate: (rate: number) => void;
	refreshLiveExchangeRate: () => Promise<number>;}
