const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

function shanghaiParts(date = new Date()) {
  const shifted = new Date(date.getTime() + SHANGHAI_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

function parseTime(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ''));
  if (!match) throw new Error('执行时间必须采用 HH:mm 格式');
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error('执行时间无效');
  return { hour, minute };
}

function shanghaiDate(year, month, day, hour, minute) {
  return new Date(Date.UTC(year, month, day, hour - 8, minute, 0, 0));
}

function normalizeSchedule(schedule) {
  const kind = String(schedule?.kind || 'daily');
  if (kind === 'interval') {
    const minutes = Number(schedule?.minutes);
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 10080) {
      throw new Error('间隔时间必须在 5 至 10080 分钟之间');
    }
    return { kind, minutes };
  }
  const time = String(schedule?.time || '00:00');
  parseTime(time);
  if (kind === 'daily') return { kind, time };
  if (kind === 'weekly') {
    const weekday = Number(schedule?.weekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new Error('星期设置无效');
    return { kind, weekday, time };
  }
  throw new Error('不支持的执行周期');
}

function nextRunAt(schedule, from = new Date()) {
  const normalized = normalizeSchedule(schedule);
  if (normalized.kind === 'interval') {
    return new Date(from.getTime() + normalized.minutes * 60 * 1000);
  }

  const parts = shanghaiParts(from);
  const clock = parseTime(normalized.time);
  let candidate = shanghaiDate(parts.year, parts.month, parts.day, clock.hour, clock.minute);
  if (normalized.kind === 'weekly') {
    const dayOffset = (normalized.weekday - parts.weekday + 7) % 7;
    candidate = shanghaiDate(parts.year, parts.month, parts.day + dayOffset, clock.hour, clock.minute);
    if (candidate.getTime() <= from.getTime()) {
      candidate = shanghaiDate(parts.year, parts.month, parts.day + dayOffset + 7, clock.hour, clock.minute);
    }
    return candidate;
  }
  if (candidate.getTime() <= from.getTime()) {
    candidate = shanghaiDate(parts.year, parts.month, parts.day + 1, clock.hour, clock.minute);
  }
  return candidate;
}

module.exports = { nextRunAt, normalizeSchedule, parseTime, shanghaiParts };
