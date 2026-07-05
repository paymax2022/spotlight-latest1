// ── Fractional Real Estate — Formatters & calc helpers ───────────────────────
// All money is integer kobo. Display helpers convert to ₦. Calculator output is
// a CLIENT PREVIEW only — the backend is authoritative for fees, limits & payouts.

import { PAYOUTS_PER_YEAR } from './constants';
import type { ReturnsCalcInput, ReturnsCalcResult, OfferingStatus } from './types';

/** ₦ from kobo with grouped thousands. 1_250_000 → "₦12,500". */
export function formatNaira(kobo: number, opts?: { decimals?: boolean }): string {
  const naira = kobo / 100;
  return `₦${naira.toLocaleString('en-NG', {
    minimumFractionDigits: opts?.decimals ? 2 : 0,
    maximumFractionDigits: opts?.decimals ? 2 : 0,
  })}`;
}

/** Compact ₦ for cards: 125_000_000 → "₦1.25M". */
export function formatNairaCompact(kobo: number): string {
  const naira = kobo / 100;
  if (naira >= 1_000_000) return `₦${(naira / 1_000_000).toFixed(naira % 1_000_000 === 0 ? 0 : 1)}M`;
  if (naira >= 1_000) return `₦${(naira / 1_000).toFixed(naira % 1_000 === 0 ? 0 : 1)}K`;
  return `₦${naira.toLocaleString('en-NG')}`;
}

/** Basis points → percent string. 1450 → "14.5%". */
export function formatYield(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`;
}

export function progressPct(raisedKobo: number, targetKobo: number): number {
  if (targetKobo <= 0) return 0;
  return Math.min(100, Math.round((raisedKobo / targetKobo) * 100));
}

/** Months → human label. */
export function tenorLabel(months: number): string {
  if (months % 12 === 0) return `${months / 12} yr`;
  if (months < 12) return `${months} mo`;
  return `${(months / 12).toFixed(1)} yr`;
}

/** Milliseconds until a closing date; null when no date. */
export function msUntil(iso: string | null): number | null {
  if (!iso) return null;
  return Math.max(0, new Date(iso).getTime() - Date.now());
}

/** Countdown label e.g. "3d 4h" / "5h 12m" / "Closed". */
export function countdownLabel(iso: string | null): string {
  const ms = msUntil(iso);
  if (ms === null) return 'No deadline';
  if (ms <= 0) return 'Closed';
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export function statusLabel(status: OfferingStatus): string {
  const map: Record<OfferingStatus, string> = {
    open: 'Open', funding: 'Funding', funded: 'Fully funded',
    closing: 'Closing soon', closed: 'Closed', settled: 'Settled',
  };
  return map[status];
}

export function relativeDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Units affordable for a given budget at a unit price. */
export function unitsForAmount(amountKobo: number, unitPriceKobo: number): number {
  if (unitPriceKobo <= 0) return 0;
  return Math.floor(amountKobo / unitPriceKobo);
}

/**
 * Client-side returns PREVIEW. Simple projection: periodic income = principal ×
 * annual yield ÷ payouts-per-year, plus capital returned at exit. Not advice;
 * the server confirms actuals.
 */
export function calcReturns(input: ReturnsCalcInput): ReturnsCalcResult {
  const annualIncome = Math.round((input.amountKobo * input.projectedYieldBps) / 10_000);
  const years = input.tenorMonths / 12;
  const ppy = PAYOUTS_PER_YEAR[input.payoutFrequency];
  const payoutsCount = ppy === 0 ? 1 : Math.max(1, Math.round(ppy * years));
  const totalIncomeKobo = Math.round(annualIncome * years);
  const periodicPayoutKobo = ppy === 0 ? totalIncomeKobo : Math.round(totalIncomeKobo / payoutsCount);
  return {
    periodicPayoutKobo,
    totalIncomeKobo,
    projectedExitKobo: input.amountKobo + totalIncomeKobo,
    payoutsCount,
  };
}

/** RFC4122-ish idempotency key generator (no crypto dep). */
export function makeIdempotencyKey(prefix = 'fre'): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}
