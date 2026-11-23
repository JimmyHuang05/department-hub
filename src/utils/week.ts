/**
 * 周次工具函数。
 * weekKey 使用该周周五的 YYMMDD，例如 260710 表示 2026-07-10 所在周。
 * 业务规则：每周一 00:00 进入新周；周末仍属于刚结束的工作周。
 */

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function getBusinessWeekFriday(date: Date): Date {
  const day = date.getDay(); // 0=Sun, 1=Mon ... 5=Fri, 6=Sat
  if (day === 0) return addDays(date, -2);
  if (day === 6) return addDays(date, -1);
  return addDays(date, 5 - day);
}

export function getCurrentWeekKey(): string {
  return encodeDate(getBusinessWeekFriday(new Date()));
}

export function getWeekKeyForDate(date: Date): string {
  return encodeDate(getBusinessWeekFriday(date));
}

export function getLastWeekKey(currentWeekKey?: string): string {
  const friday = currentWeekKey ? decodeDate(currentWeekKey) : decodeDate(getCurrentWeekKey());
  return encodeDate(addDays(friday, -7));
}

export function decodeDate(key: string): Date {
  const year = 2000 + parseInt(key.substring(0, 2), 10);
  const month = parseInt(key.substring(2, 4), 10) - 1;
  const day = parseInt(key.substring(4, 6), 10);
  return new Date(year, month, day);
}

export function encodeDate(date: Date): string {
  const yy = String(date.getFullYear()).slice(2);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatWeekKey(key: string): string {
  return formatLocalDate(decodeDate(key));
}

export function getWeekRange(key: string): { start: string; end: string } {
  const friday = decodeDate(key);
  const monday = addDays(friday, -4);
  return {
    start: formatLocalDate(monday),
    end: formatLocalDate(friday),
  };
}

export function getWeekNumber(key: string): number {
  const friday = decodeDate(key);
  const thursday = addDays(friday, -1);
  const jan1 = new Date(thursday.getFullYear(), 0, 1);
  const diff = (thursday.getTime() - jan1.getTime()) / 86400000;
  return Math.ceil((diff + ((jan1.getDay() + 6) % 7) + 1) / 7);
}
