/** Convert an Excel serial date to a Date. */
function excelSerialToDate(serial: number): Date {
  const adjusted = serial > 60 ? serial - 1 : serial;
  return new Date((adjusted - 25569) * 86400 * 1000);
}

function isExcelSerial(str: string): boolean {
  const n = Number(str);
  return !isNaN(n) && Number.isInteger(n) && n >= 1 && n <= 2958465;
}

function formatNumber(value: number, digits = 2): string {
  return value.toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatDate(date: string | Date): string {
  if (!date) return '';
  if (typeof date === 'string' && isExcelSerial(date)) {
    date = excelSerialToDate(Number(date));
  }

  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

/**
 * Product amount fields in this app are stored in ten-thousands.
 * CNY: 1600 => ¥1,600.00万
 * USD: 228.57 => $228.57万
 */
export function formatCurrency(amount: number, currency: 'CNY' | 'USD' = 'CNY'): string {
  const value = Number(amount);
  if (isNaN(value)) return '-';
  const symbol = currency === 'USD' ? '$' : '¥';
  return `${symbol}${formatNumber(value)}万`;
}

export function normalizeRate(value: number): number {
  const rate = Number(value);
  if (isNaN(rate)) return 0;
  return Math.abs(rate) > 1 ? rate / 100 : rate;
}

export function formatPercent(value: number): string {
  const rate = normalizeRate(value);
  if (isNaN(rate)) return '-';
  const percent = rate * 100;
  const truncated = Math.trunc(percent * 1_000_000) / 1_000_000;
  return `${truncated.toFixed(6).replace(/\.?0+$/, '')}%`;
}

export function compactWanAmount(value: number): { display: string; full: string; isCompact: boolean } {
  const amount = Number(value);
  if (isNaN(amount)) return { display: '-', full: '-', isCompact: false };

  const full = `${formatNumber(amount)}万`;
  const abs = Math.abs(amount);
  if (abs >= 10000) {
    return {
      display: `${formatNumber(amount / 10000)}亿`,
      full,
      isCompact: true,
    };
  }

  return {
    display: `${amount.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}万`,
    full,
    isCompact: false,
  };
}

export function compactNumber(value: number): { display: string; full: string; isCompact: boolean } {
  const amount = Number(value);
  if (isNaN(amount)) return { display: '-', full: '-', isCompact: false };

  const full = amount.toLocaleString('zh-CN');
  const abs = Math.abs(amount);

  if (abs >= 1_0000_0000) {
    return { display: `${formatNumber(amount / 1_0000_0000)}亿`, full, isCompact: true };
  }
  if (abs >= 1_0000) {
    return { display: `${formatNumber(amount / 1_0000)}万`, full, isCompact: true };
  }
  return { display: full, full, isCompact: abs >= 1000 };
}

export function compactUsd(value: number): string {
  const { display } = compactWanAmount(value);
  return `$${display}`;
}

export function compactRmb(value: number): string {
  const { display } = compactWanAmount(value);
  return `¥${display}`;
}
