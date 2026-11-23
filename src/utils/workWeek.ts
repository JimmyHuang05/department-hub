const CHINA_PUBLIC_HOLIDAYS = new Set([
  // 2026 China public holiday calendar. Update this table when the next official annual notice changes.
  '2026-01-01',
  '2026-02-16',
  '2026-02-17',
  '2026-02-18',
  '2026-02-19',
  '2026-02-20',
  '2026-02-21',
  '2026-02-22',
  '2026-02-23',
  '2026-04-04',
  '2026-04-05',
  '2026-04-06',
  '2026-05-01',
  '2026-05-02',
  '2026-05-03',
  '2026-05-04',
  '2026-05-05',
  '2026-06-19',
  '2026-06-20',
  '2026-06-21',
  '2026-09-25',
  '2026-09-26',
  '2026-09-27',
  '2026-10-01',
  '2026-10-02',
  '2026-10-03',
  '2026-10-04',
  '2026-10-05',
  '2026-10-06',
  '2026-10-07',
]);

const CHINA_MAKEUP_WORKDAYS = new Set<string>();

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfWeek(date: Date) {
  const next = new Date(date);
  const day = next.getDay() || 7;
  next.setDate(next.getDate() - day + 1);
  next.setHours(0, 0, 0, 0);
  return next;
}

function isWorkday(date: Date) {
  const key = toDateKey(date);
  if (CHINA_MAKEUP_WORKDAYS.has(key)) return true;
  if (CHINA_PUBLIC_HOLIDAYS.has(key)) return false;
  const day = date.getDay();
  return day >= 1 && day <= 5;
}

function formatShortDate(date: Date) {
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

export function getCurrentWorkWeekLabel(date = new Date()) {
  const monday = startOfWeek(date);
  const weekDates = Array.from({ length: 7 }, (_, index) => addDays(monday, index));
  const workdays = weekDates.filter(isWorkday);

  if (!workdays.length) return '本周无工作日';
  if (workdays.length === 1) return `${formatShortDate(workdays[0])} 工作日`;

  const first = workdays[0];
  const last = workdays[workdays.length - 1];
  const continuousDays = Math.round((last.getTime() - first.getTime()) / 86400000) + 1;
  if (continuousDays === workdays.length) {
    return `${formatShortDate(first)}-${formatShortDate(last)}`;
  }

  return workdays.map(formatShortDate).join('、');
}

export function getWorkWeekLabelForKey(key: string | null | undefined) {
  const weekKey = key && key !== '__legacy__' ? key : getCurrentWeekKey();
  const friday = decodeDate(weekKey);
  const monday = addDays(friday, -4);
  const sunday = addDays(monday, 6);
  const range = `${formatShortDate(monday)}-${formatShortDate(sunday)}`;

  return `${friday.getFullYear()}年第${String(getWeekNumber(weekKey)).padStart(2, '0')}周 ${range}`;
}
import { decodeDate, getCurrentWeekKey, getWeekNumber } from './week';
