import type { InvestmentProduct, User, WorkLogEntry } from '../types';

export type GlobalSearchKind = 'project' | 'worklog' | 'task' | 'file' | 'page';

export interface GlobalSearchResult {
  id: string;
  title: string;
  description: string;
  type: GlobalSearchKind;
  href: string;
  matchedField?: string;
  matchedFieldLabel?: string;
  score?: number;
}

export interface GlobalSearchFile {
  id: string;
  fileName: string;
  mimeType?: string;
  uploadedBy?: string;
  remark?: string;
}

export interface GlobalSearchTask {
  id: string;
  title: string;
  description?: string;
  remark?: string;
  projectName?: string;
  assignedToName?: string;
  createdByName?: string;
  recipientNames?: string[];
  comments?: Array<{ userName?: string; content?: string; createdAt?: string }>;
}

const normalUserPages: GlobalSearchResult[] = [
  { id: 'page-dashboard', title: '工作台', description: '查看本周待填写、最近项目和状态概览', type: 'page', href: '/dashboard' },
  { id: 'page-worklog', title: '管理周报', description: '维护每周项目进展、问题项目和直销产品情况', type: 'page', href: '/worklog' },
  { id: 'page-projects', title: '项目进度', description: '查看、筛选和维护投资项目数据', type: 'page', href: '/projects' },
  { id: 'page-cloud-drive', title: '云盘', description: '搜索和预览部门文件资料', type: 'page', href: '/cloud-drive' },
  { id: 'page-tools', title: '工具', description: '打开内部工具和业务辅助页面', type: 'page', href: '/tools' },
  { id: 'page-questionnaires', title: '问卷', description: '打开部门问卷与填写页面', type: 'page', href: '/questionnaires' },
  { id: 'page-skills', title: '技能', description: '查看可用技能包和业务能力', type: 'page', href: '/skills' },
  { id: 'page-appearance', title: '外观设置', description: '调整主题、颜色和显示风格', type: 'page', href: '/appearance' },
  { id: 'page-settings', title: '产品设置', description: '查看信托经理、状态、托管行和字段配置', type: 'page', href: '/settings' },
  { id: 'page-applications', title: '应用中心', description: '集中访问业务应用、协作工具和分析能力', type: 'page', href: '/applications' },
  { id: 'page-profile', title: '个人中心', description: '查看账号资料和个人信息', type: 'page', href: '/profile' },
];

const adminPages: GlobalSearchResult[] = [
  { id: 'page-users', title: '人员管理', description: '管理账号、角色和启用状态', type: 'page', href: '/admin/users' },
  { id: 'page-scheduled-jobs', title: '定时任务', description: '管理后台定时任务与执行记录', type: 'page', href: '/admin/scheduled-jobs' },
];

const developerPages: GlobalSearchResult[] = [
  { id: 'page-backups', title: '数据备份', description: '管理业务数据备份与恢复', type: 'page', href: '/admin/backups' },
  { id: 'page-audit', title: '操作日志', description: '查询系统操作和数据变更记录', type: 'page', href: '/audit' },
  { id: 'page-error-events', title: '事件日志', description: '按事件编号查询系统错误与接口状态', type: 'page', href: '/admin/error-events' },
];

export function normalizeSearchText(value: unknown) {
  return String(value || '').trim().toLocaleLowerCase('zh-CN');
}

interface SearchField {
  value: unknown;
  label: string;
  field?: string;
  weekKey?: string;
  weight?: number;
}

function searchTokens(query: string) {
  return normalizeSearchText(query).split(/\s+/).filter(Boolean);
}

function fieldMatchScore(value: unknown, token: string) {
  const normalized = normalizeSearchText(value);
  if (!normalized || !token) return 0;
  if (normalized === token) return 120;
  if (normalized.startsWith(token)) return 90;
  if (normalized.includes(token)) return 60;
  return 0;
}

function bestFieldMatch(fields: SearchField[], tokens: string[]) {
  if (tokens.length === 0) return { score: 0, field: undefined as SearchField | undefined, token: undefined as string | undefined };
  const tokenMatches = tokens.map(token => fields
    .map(field => ({ field, token, score: fieldMatchScore(field.value, token) + (field.weight || 0) }))
    .filter(match => match.score > (match.field.weight || 0))
    .sort((left, right) => right.score - left.score)[0]);
  if (tokenMatches.some(match => !match)) return null;
  const primary = [...tokenMatches].sort((left, right) => right.score - left.score)[0];
  return {
    score: tokenMatches.reduce((sum, match) => sum + match.score, 0),
    field: primary.field,
    token: primary.token,
  };
}

function matchedValueExcerpt(value: string, token?: string, maxLength = 24) {
  if (!value || !token) return value;
  const matchIndex = value.toLocaleLowerCase('zh-CN').indexOf(token.toLocaleLowerCase('zh-CN'));
  if (matchIndex < 0) return value.slice(0, maxLength - 1) + '…';

  const start = Math.max(0, matchIndex - 2);
  if (start === 0 && value.length <= maxLength) return value;
  const end = Math.min(value.length, Math.max(start + maxLength, matchIndex + token.length));
  return `${start > 0 ? '…' : ''}${value.slice(start, end)}${end < value.length ? '…' : ''}`;
}

function matchedDescription(match: ReturnType<typeof bestFieldMatch>, fallback: string) {
  if (!match?.field) return fallback;
  const value = String(match.field.value || '').trim();
  const excerpt = matchedValueExcerpt(value, match.token);
  return `匹配${match.field.label}：${excerpt}${fallback ? ` · ${fallback}` : ''}`;
}

export function buildGlobalSearchResults({
  query,
  products,
  entries,
  tasks = [],
  files = [],
  user,
  limit = 12,
}: {
  query: string;
  products: InvestmentProduct[];
  entries: WorkLogEntry[];
  tasks?: GlobalSearchTask[];
  files?: GlobalSearchFile[];
  user?: User | null;
  limit?: number;
}): GlobalSearchResult[] {
  const tokens = searchTokens(query);
  const hasQuery = tokens.length > 0;
  const pages = [
    ...normalUserPages,
    ...(user?.role === 'admin' ? adminPages : []),
    ...(user?.business_role === 'developer' ? developerPages : []),
  ];

  const projectResults = products
    .map(product => {
      const match = bestFieldMatch([
        { value: product.productName, label: '项目名称', field: 'productName', weight: 30 },
        { value: product.client, label: '客户', field: 'client', weight: 20 },
        { value: product.trustManager, label: 'A角', field: 'trustManager', weight: 18 },
        { value: product.trustManagerB, label: 'B角', field: 'trustManagerB', weight: 18 },
        { value: product.status, label: '状态', field: 'status', weight: 12 },
        { value: product.target, label: '投资标的', field: 'target', weight: 10 },
        { value: product.brokerChannel, label: '券商渠道', field: 'brokerChannel', weight: 8 },
        { value: product.custodianBank, label: '托管行', field: 'custodianBank', weight: 8 },
        { value: product.tradingBroker, label: '交易券商', field: 'tradingBroker', weight: 8 },
        { value: product.strategy, label: '投资策略', field: 'strategy', weight: 8 },
        { value: product.projectCreatedDate || product.progressStartDate, label: '项目创建日期', field: 'projectCreatedDate', weight: 6 },
        { value: product.establishDate, label: '成立日期', field: 'establishDate', weight: 6 },
        { value: product.projectStoppedDate, label: '项目中止日期', field: 'projectStoppedDate', weight: 6 },
        { value: product.deadline, label: '到期日', field: 'deadline', weight: 6 },
        { value: product.usd, label: '美元规模', field: 'usd', weight: 5 },
        { value: product.rmb, label: '人民币规模', field: 'rmb', weight: 5 },
        { value: product.feeRate, label: '费率', field: 'feeRate', weight: 5 },
        { value: product.annualIncome, label: '年化收入', field: 'annualIncome', weight: 5 },
        { value: product.thisYearIncome, label: '本年收入', field: 'thisYearIncome', weight: 5 },
        { value: product.performanceIncome, label: '业绩收入', field: 'performanceIncome', weight: 5 },
        { value: product.remarks, label: '备注', field: 'remarks', weight: 4 },
        ...Object.entries(product.dynamicFields || {}).map(([field, value]) => ({ value, label: '自定义字段', field })),
      ], tokens);
      if (hasQuery && !match) return null;
      const fallback = [product.status || '未填写状态', product.trustManager || '未分配A角', product.trustManagerB || '', product.client || '未填写客户']
        .filter(Boolean)
        .join(' · ');
      const field = match?.field?.field;
      const params = new URLSearchParams({ tableRow: product.id });
      if (field) params.set('field', field);
      return {
        id: `project-${product.id}`,
        title: product.productName || '未命名项目',
        description: matchedDescription(match, fallback),
        type: 'project' as const,
        href: `/projects?${params.toString()}`,
        matchedField: field,
        matchedFieldLabel: match?.field?.label,
        score: match?.score || 0,
      };
    })
    .filter((result): result is NonNullable<typeof result> => Boolean(result))
    .sort((left, right) => right.score - left.score)
    .slice(0, hasQuery ? 8 : 4);

  const worklogResults = entries
    .map(entry => {
      const match = bestFieldMatch([
        { value: entry.productName, label: '项目名称', field: 'productName', weight: 30 },
        { value: entry.clientType, label: '客户', field: 'clientType', weight: 20 },
        { value: entry.personA, label: 'A角', field: 'personA', weight: 18 },
        { value: entry.personB, label: 'B角', field: 'personB', weight: 17 },
        { value: entry.status, label: '状态', field: 'status', weight: 12 },
        { value: entry.category, label: '周报分类', weight: 10 },
        { value: entry.subCategory, label: '周报子分类', weight: 8 },
        { value: entry.description, label: '问题描述', weight: 8 },
        { value: entry.features, label: '特色', weight: 6 },
        { value: entry.nextWeekPlan, label: '后续计划', field: 'nextWeekPlan', weight: 6 },
        ...Object.entries(entry.weeklyProgress || {}).map(([weekKey, value]) => ({
          value,
          label: '周进展',
          field: 'weeklyProgress',
          weekKey,
          weight: 7,
        })),
        ...Object.values(entry.dynamicFields || {}).map(value => ({ value, label: '自定义字段' })),
      ], tokens);
      if (hasQuery && !match) return null;
      const fallback = [entry.category || '管理周报', entry.status, [entry.personA, entry.personB].filter(Boolean).join(' / ')]
        .filter(Boolean)
        .join(' · ');
      const field = match?.field?.field;
      const weekKey = match?.field?.weekKey;
      const params = new URLSearchParams({ entryId: entry.id });
      if (weekKey) params.set('weekKey', weekKey);
      if (field) params.set('field', field);
      return {
        id: `worklog-${entry.id}`,
        title: entry.productName || '未命名周报',
        description: matchedDescription(match, fallback),
        type: 'worklog' as const,
        href: `/worklog?${params.toString()}`,
        matchedField: field,
        matchedFieldLabel: match?.field?.label,
        score: match?.score || 0,
      };
    })
    .filter((result): result is NonNullable<typeof result> => Boolean(result))
    .sort((left, right) => right.score - left.score)
    .slice(0, hasQuery ? 6 : 3);

  const taskResults = tasks
    .map(task => {
      const match = bestFieldMatch([
        { value: task.title, label: '任务标题', field: 'title', weight: 30 },
        { value: task.description, label: '任务说明', field: 'description', weight: 18 },
        { value: task.remark, label: '创建备注', field: 'remark', weight: 12 },
        { value: task.projectName, label: '关联项目', field: 'projectName', weight: 16 },
        { value: task.assignedToName, label: '负责人', field: 'assignedToName', weight: 14 },
        { value: task.createdByName, label: '创建人', field: 'createdByName', weight: 8 },
        { value: task.recipientNames?.join('、'), label: '协作人员', field: 'recipientNames', weight: 8 },
        ...(task.comments || []).map(comment => ({ value: comment.content, label: '任务动态', field: 'comment', weight: 22 })),
      ], tokens);
      if (hasQuery && !match) return null;
      const fallback = [task.projectName || '未关联项目', task.assignedToName ? `负责人：${task.assignedToName}` : '未指定负责人'].join(' · ');
      return {
        id: `task-${task.id}`,
        title: task.title || '未命名任务',
        description: matchedDescription(match, fallback),
        type: 'task' as const,
        href: `/tasks?taskId=${encodeURIComponent(task.id)}`,
        matchedField: match?.field?.field,
        matchedFieldLabel: match?.field?.label,
        score: match?.score || 0,
      };
    })
    .filter((result): result is NonNullable<typeof result> => Boolean(result))
    .sort((left, right) => right.score - left.score)
    .slice(0, hasQuery ? 8 : 3);

  const fileResults = files
    .map(file => {
      const match = bestFieldMatch([
        { value: file.fileName, label: '文件名', weight: 20 },
        { value: file.uploadedBy, label: '上传人', weight: 10 },
        { value: file.remark, label: '备注', weight: 5 },
        { value: file.mimeType, label: '文件类型' },
      ], tokens);
      if (hasQuery && !match) return null;
      return {
        id: `file-${file.id}`,
        title: file.fileName || '未命名文件',
        description: matchedDescription(match, [file.uploadedBy ? `上传人：${file.uploadedBy}` : '云盘文件', file.remark].filter(Boolean).join(' · ')),
        type: 'file' as const,
        href: `/cloud-drive?fileId=${encodeURIComponent(file.id)}`,
        matchedFieldLabel: match?.field?.label,
        score: match?.score || 0,
      };
    })
    .filter((result): result is NonNullable<typeof result> => Boolean(result))
    .sort((left, right) => right.score - left.score)
    .slice(0, hasQuery ? 5 : 2);

  const pageResults = pages.filter(page => !hasQuery || bestFieldMatch([
    { value: page.title, label: '功能', weight: 20 },
    { value: page.description, label: '功能说明' },
  ], tokens));
  const results = hasQuery
    ? [...taskResults, ...projectResults, ...worklogResults, ...fileResults, ...pageResults]
    : [...pageResults.slice(0, 6), ...taskResults, ...projectResults, ...worklogResults, ...fileResults];

  return results.slice(0, limit);
}
