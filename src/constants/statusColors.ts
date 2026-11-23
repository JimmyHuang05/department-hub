/**
 * 状态颜色：用于新增状态时的随机配色
 * 与默认状态的颜色（settingsStore 中的 #8fa3b0 等）互补
 */
export const STATUS_COLORS = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316',
] as const;

/** 随机取一个状态颜色 */
export function randomStatusColor(): string {
  return STATUS_COLORS[Math.floor(Math.random() * STATUS_COLORS.length)];
}
