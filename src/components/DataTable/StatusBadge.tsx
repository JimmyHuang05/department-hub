import type { CSSProperties } from 'react';
import { useSettingsStore } from '../../store/settingsStore';

interface StatusBadgeProps {
  status: string;
}

/**
 * 状态标签组件 — 统一状态徽标样式
 * 从 settings 中查找状态配置，渲染带颜色的圆角标签
 */
export default function StatusBadge({ status }: StatusBadgeProps) {
  const { settings } = useSettingsStore();
  const cfg = settings.statusConfigs.find(s => s.name === status);
  const style = cfg
    ? ({ '--status-color': cfg.color } as CSSProperties)
    : undefined;

  return (
    <span
      className="app-status-badge inline-flex rounded-full border px-2 py-1 text-xs font-medium"
      style={style}
    >
      {status || '-'}
    </span>
  );
}
