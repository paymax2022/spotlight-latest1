// ── Crowdfunding — Formatters & fee math ─────────────────────────────────────
// All money is in kobo (integer minor units). Display helpers convert to ₦.

import {
  PLATFORM_FEE_BPS,
  PAYMENT_FEE_BPS,
  PAYMENT_FEE_FLAT_KOBO,
} from '../constants/crowdfunding.constants';
import type { FeeBreakdown, PaymentMethod } from '../types/crowdfunding.types';

/** ₦ from kobo, grouped thousands. e.g. 1_250_000 → "₦12,500". */
export function formatNaira(kobo: number, opts?: { decimals?: boolean }): string {
  const naira = kobo / 100;
  return `₦${naira.toLocaleString('en-NG', {
    minimumFractionDigits: opts?.decimals ? 2 : 0,
    maximumFractionDigits: opts?.decimals ? 2 : 0,
  })}`;
}

/** Compact ₦ for cards: 1_250_000 → "₦1.25M". */
export function formatNairaCompact(kobo: number): string {
  const naira = kobo / 100;
  if (naira >= 1_000_000) return `₦${(naira / 1_000_000).toFixed(naira % 1_000_000 === 0 ? 0 : 1)}M`;
  if (naira >= 1_000) return `₦${(naira / 1_000).toFixed(naira % 1_000 === 0 ? 0 : 1)}K`;
  return `₦${naira.toLocaleString('en-NG')}`;
}

export function progressPct(raisedKobo: number, goalKobo: number): number {
  if (goalKobo <= 0) return 0;
  return Math.min(100, Math.round((raisedKobo / goalKobo) * 100));
}

/** Days left until deadline; null when no deadline. Negative clamped to 0. */
export function daysLeft(deadline: string | null): number | null {
  if (!deadline) return null;
  const ms = new Date(deadline).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

export function deadlineLabel(deadline: string | null): string {
  const d = daysLeft(deadline);
  if (d === null) return 'No deadline';
  if (d === 0) return 'Last day';
  if (d === 1) return '1 day left';
  return `${d} days left`;
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function maskAnonymous(displayName: string, anonymous: boolean): string {
  return anonymous ? 'Anonymous' : displayName;
}

/**
 * Compute the fee breakdown for a contribution.
 * Fees are deducted ON TOP of the contribution so the campaign receives the full
 * amount the contributor intended (transparent-fee model).
 */
export function computeFees(
  contributionKobo: number,
  method: PaymentMethod,
  tipKobo = 0,
): FeeBreakdown {
  const platformFeeKobo = Math.round((contributionKobo * PLATFORM_FEE_BPS) / 10_000);
  // Wallet payments incur no external processing fee.
  const paymentFeeKobo =
    method === 'WALLET'
      ? 0
      : Math.round((contributionKobo * PAYMENT_FEE_BPS) / 10_000) + PAYMENT_FEE_FLAT_KOBO;

  return {
    contributionKobo,
    platformFeeKobo,
    paymentFeeKobo,
    tipKobo,
    totalKobo: contributionKobo + platformFeeKobo + paymentFeeKobo + tipKobo,
  };
}
