export const MANAGEMENT_STAGE_OPTIONS = ['推进中', '已过会', '运行中', '终止清算'] as const;
export const PROJECT_CATEGORY_OPTIONS = ['资产管理', '资产服务（主动管理）', '资产服务（事务管理）'] as const;
export const ACTIVE_PASSIVE_OPTIONS = ['主动', '被动'] as const;
export const COLLECTIVE_SINGLE_OPTIONS = ['集合', '单一'] as const;

export function projectCategoryLinkage(value: string) {
  const normalized = String(value || '').replace(/\s+/g, '').replace(/[（(]/g, '（').replace(/[）)]/g, '）').trim();
  if (normalized === '资产管理') return { activePassive: '主动', collectiveSingle: '集合' };
  if (normalized === '资产服务（主动管理）') return { activePassive: '主动', collectiveSingle: '单一' };
  if (normalized === '资产服务（事务管理）') return { activePassive: '被动', collectiveSingle: '单一' };
  return null;
}
