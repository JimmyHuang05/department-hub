/**
 * 统一字段映射表
 *
 * 集中管理所有"中文名称 ↔ 字段名"的映射关系，
 * 供导出（csv.ts）和导入（worklog-import-utils.ts）共同使用。
 */

/** 工作日志字段：Excel/UI 标题 → 字段名（一对多：同一个字段可能有多种中文表述） */
export const WORKLOG_HEADER_MAP: Record<string, string> = {
  // 产品名
  '产品名': 'productName',
  '产品名称': 'productName',
  '项目名称': 'productName',
  // 分类
  '分类': 'category',
  '子分类': 'subCategory',
  '正常项目': 'subCategory',
  '项目分类': 'subCategory',
  '类别': 'subCategory',
  // 状态
  '状态': 'status',
  // 客户/对手方
  '客户名称/类型': 'clientType',
  '客户名称': 'clientType',
  '对手方': 'clientType',
  // 净值/规模
  '净值/规模情况': 'navScale',
  '产品状态': 'navScale',
  '项目情况': 'description',
  '问题描述/历史进展': 'description',
  '项目规模': 'navScale',
  '规模（万）': 'navScale',
  '规模': 'navScale',
  '目标规模（万）': 'productTerm',
  // 日期
  '成立日/拟成立日': 'establishDate',
  '成立时间': 'establishDate',
  '产品期限': 'productTerm',
  '期限': 'deadline',
  '预计最晚化解时间': 'deadline',
  // 团队
  'A角': 'personA',
  'B角': 'personB',
  '项目经理A': 'personA',
  '项目经理B': 'personB',
  '主动/被动': 'activePassive',
  '集合/单一': 'collectiveSingle',
  '投资顾问/管理人': 'advisorManager',
  // 业务信息
  '渠道销售': 'channelSales',
  '特色': 'features',
  '管理报告': 'managementReport',
  '风控报告': 'riskReport',
  '销售端报告': 'salesReport',
  '下周工作计划': 'nextWeekPlan',
  '后续计划': 'nextWeekPlan',
  '后续举措': 'nextWeekPlan',
  // 直销产品运作与销售
  '一周回顾': 'dynamicFields.weeklyReview',
  '该产品销售渠道': 'channelSales',
  '销售渠道': 'channelSales',
  '渠道对接人': 'dynamicFields.channelContact',
  '当周申赎情况': 'dynamicFields.subscriptionRedemption',
  '下一步工作计划': 'dynamicFields.nextSalesPlan',
  '下一步计划': 'dynamicFields.nextSalesPlan',
  '持仓超过10%的个券明细': 'dynamicFields.holdingsOver10',
  '持仓超10%的个券细节': 'dynamicFields.holdingsOver10',
  '权益资产占比': 'dynamicFields.equityAssetRatio',
  '是否触及预警、平仓线': 'dynamicFields.warningLineStatus',
  '是否触及预警/平仓线': 'dynamicFields.warningLineStatus',
  '关注点': 'dynamicFields.focusPoint',
  // 净值跟踪
  '净值': 'nav',
  '年初净值': 'yearStartNav',
  '涨跌幅': 'changePercent',
  '较上周': 'changePercent',
};

/** 产品字段：中文标题 → 字段名（用于导出产品 CSV） */
export const PRODUCT_HEADER_MAP: Record<string, string> = {
  '产品名称': 'productName',
  'USD': 'usd',
  'RMB': 'rmb',
  '费率': 'feeRate',
  '项目创建日': 'projectCreatedDate',
  '开始推进日': 'projectCreatedDate',
  '成立时间': 'establishDate',
  '成立/落地日': 'establishDate',
  '项目中止日': 'projectStoppedDate',
  '标的': 'target',
  '委托人': 'client',
  '券商渠道': 'brokerChannel',
  '策略': 'strategy',
  '托管行': 'custodianBank',
  '交易券商': 'tradingBroker',
  '年度收益': 'annualIncome',
  '今年收益': 'thisYearIncome',
  '业绩报酬': 'performanceIncome',
  '状态': 'status',
  '信托经理': 'trustManager',
  '信托经理A角': 'trustManager',
  '信托经理B角': 'trustManagerB',
  'A角': 'trustManager',
  'B角': 'trustManagerB',
  '期限': 'deadline',
  '备注': 'remarks',
};

/** 反向映射：字段名 → 中文标题（用于导出时生成表头） */
export function fieldToChinese(field: string): string {
  // 先在日志映射中查找
  for (const [cn, en] of Object.entries(WORKLOG_HEADER_MAP)) {
    if (en === field) return cn;
  }
  // 再在产品映射中查找
  for (const [cn, en] of Object.entries(PRODUCT_HEADER_MAP)) {
    if (en === field) return cn;
  }
  return field;
}

/**
 * 从数据中提取某个字段的唯一值列表（用于输入联想）
 * 会合并 fieldOptions 中已保存的选项，去重后按中文排序
 */
export function buildFieldSuggestions<T extends Record<string, any>>(
  data: T[],
  field: string,
  fieldOptions: Record<string, string[]>,
): string[] {
  const uniqueValues = new Set<string>();
  // 加入已存储的选项
  const saved = fieldOptions[field];
  if (saved) saved.forEach(v => uniqueValues.add(v));
  // 收集所有数据中该字段的值
  for (const item of data) {
    const val = item[field];
    if (val && typeof val === 'string' && val.trim()) {
      uniqueValues.add(val.trim());
    }
  }
  return Array.from(uniqueValues).sort((a, b) => a.localeCompare(b, 'zh-CN'));
}
