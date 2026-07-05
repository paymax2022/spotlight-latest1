// ── Spotlight Wealth — Display formatters ────────────────────────────────────
// Reward credit is in major units (this surface never executes trades, so it
// skips the crypto module's minor-unit math). Helpers stay self-contained.

import { CURRENCY_META } from '../constants/spotlight.constants';
import type { Money } from '../types/spotlight.types';

/** Format a reward Money value with its currency symbol (signed for history rows). */
export function formatMoney(m: Money, opts?: { signed?: boolean }): string {
  const meta = CURRENCY_META[m.currency] ?? { symbol: '', decimals: 0 };
  const sign = m.amount < 0 ? '-' : opts?.signed ? '+' : '';
  const body = Math.abs(m.amount).toLocaleString('en-NG', {
    minimumFractionDigits: meta.decimals,
    maximumFractionDigits: meta.decimals,
  });
  return `${sign}${meta.symbol}${body}`;
}

/** Format learning points with thousands separators. */
export function formatPoints(points: number): string {
  return points.toLocaleString('en-NG');
}

/** Human "ends in" copy for a challenge deadline (ISO → "Ends in 3 days"). */
export function formatEndsIn(isoEndsAt: string): string {
  const ms = new Date(isoEndsAt).getTime() - Date.now();
  if (ms <= 0) return 'Ended';
  const hours = Math.round(ms / 3_600_000);
  if (hours < 24) return `Ends in ${hours} hr${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `Ends in ${days} day${days === 1 ? '' : 's'}`;
}

/** Relative "time ago" copy for reward-history rows (ISO → "2 days ago"). */
export function formatTimeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const hours = Math.round(ms / 3_600_000);
  if (hours < 1) return 'Just now';
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
