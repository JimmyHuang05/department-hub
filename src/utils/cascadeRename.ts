import { useWorkLogStore } from '../store/workLogStore';
import { useProjectStore } from '../store/projectStore';

/**
 * 级联更新：将某个字段中所有旧值替换为新值（同步更新产品和日志数据）
 */
export function cascadeRename(field: string, oldValue: string, newValue: string) {
  if (!oldValue || !newValue || oldValue === newValue) return;

  // 更新工作日志条目
  const wlStore = useWorkLogStore.getState();
  if (wlStore.entries) {
    for (const entry of wlStore.entries) {
      if ((entry as any)[field] === oldValue) {
        wlStore.updateEntry(entry.id, { [field]: newValue } as any);
      }
    }
  }

  // 更新产品
  const pStore = useProjectStore.getState();
  if (pStore.products) {
    for (const product of pStore.products) {
      if ((product as any)[field] === oldValue) {
        pStore.updateProduct(product.id, { [field]: newValue } as any);
      }
    }
  }
}
