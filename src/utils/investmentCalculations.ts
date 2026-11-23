import type { InvestmentProduct } from '../types';
import { normalizeRate } from './format';

export function defaultDeadlineForEstablishDate(establishDate?: string): string {
  const match = String(establishDate || '').match(/^(\d{4})-\d{2}-\d{2}$/);
  return match ? `${match[1]}-11-30` : '';
}

export function computeIncome(
  rmb: number,
  feeRate: number,
  establishDate?: string,
  deadline?: string,
): { annualIncome: number; thisYearIncome: number; performanceIncome: number } {
  const result = { annualIncome: 0, thisYearIncome: 0, performanceIncome: 0 };
  const normalizedFeeRate = normalizeRate(feeRate);
  if (rmb <= 0 || normalizedFeeRate <= 0) return result;

  const annualIncome = Math.round(rmb * normalizedFeeRate * 100) / 100;
  result.annualIncome = annualIncome;
  const effectiveDeadline = deadline || defaultDeadlineForEstablishDate(establishDate);
  if (!establishDate || !effectiveDeadline) return result;

  const startDate = new Date(`${establishDate}T00:00:00`);
  const endDate = new Date(`${effectiveDeadline}T00:00:00`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return result;
  const dayDiff = Math.max(0, Math.ceil((endDate.getTime() - startDate.getTime()) / 86_400_000));
  if (dayDiff <= 0) return result;

  result.thisYearIncome = Math.round((annualIncome * dayDiff / 365) * 100) / 100;
  result.performanceIncome = Math.round((result.thisYearIncome / 1.06) * 100) / 100;
  return result;
}

export function calculateDerivedFields(
  row: Partial<InvestmentProduct>,
  exchangeRate: number,
): Partial<InvestmentProduct> {
  const rmb = Number(row.rmb) || 0;
  const usd = Number(row.usd) || 0;
  const effectiveRmb = rmb === 0 && usd > 0
    ? Math.round(usd * exchangeRate * 100) / 100
    : rmb;
  const updates: Partial<InvestmentProduct> = computeIncome(
    effectiveRmb,
    Number(row.feeRate) || 0,
    row.establishDate,
    row.deadline,
  );
  const defaultDeadline = defaultDeadlineForEstablishDate(row.establishDate);
  if (!row.deadline && defaultDeadline) updates.deadline = defaultDeadline;
  if (effectiveRmb !== rmb) updates.rmb = effectiveRmb;
  return Object.values(updates).some(value => Number(value) > 0) ? updates : {};
}
