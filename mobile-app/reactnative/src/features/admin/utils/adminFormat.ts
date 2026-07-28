// ── Paymax · Admin Console — Formatters ──────────────────────────────────────
// All money is minor units (integer). Display helpers convert to major units.
// Ported from crypto's cryptoFormatters so the admin surface formats money and
// time identically to the rest of the app.

import type { Money } from '../types/admin.types';

/** Currency display metadata (symbol + minor-unit decimals). */
const CURRENCY_META: Record<string, { symbol: string; decimals: number }> = {
  NGN: { symbol: '₦', decimals: 2 },
  USD: { symbol: '$', decimals: 2 },
};

/** Decimals for a currency or crypto symbol — fiat = 2, crypto = 8 by default. */
function decimalsFor(currency: string): number {
  return CURRENCY_META[currency]?.decimals ?? 8;
}

function symbolFor(currency: string): string {
  return CURRENCY_META[currency]?.symbol ?? '';
}

/**
 * Format minor units → localized major-unit string with the currency symbol.
 * Fiat renders "₦1,050.00"; a crypto symbol renders "0.0125 BTC".
 */
export function formatMoney(
  amount: number,
  currency: string,
  opts?: { decimals?: boolean },
): string {
  const decimals = decimalsFor(currency);
  const major = amount / 10 ** decimals;
  const sym = symbolFor(currency);

  if (sym) {
    const places = opts?.decimals === false ? 0 : decimals;
    const body = major.toLocaleString('en-NG', {
      minimumFractionDigits: places,
      maximumFractionDigits: places,
    });
    return `${sym}${body}`;
  }
  // Crypto: trim trailing zeros, suffix the symbol.
  const body = major.toLocaleString('en-US', { maximumFractionDigits: decimals });
  return `${body} ${currency}`;
}

/** Format a Money object. */
export function formatMoneyObj(m: Money, opts?: { decimals?: boolean }): string {
  return formatMoney(m.amount, m.currency, opts);
}

/** Compact fiat for KPI cards: 1_250_000_00 NGN → "₦1.25M". */
export function formatMoneyCompact(amount: number, currency: string): string {
  const decimals = decimalsFor(currency);
  const sym = symbolFor(currency);
  const major = amount / 10 ** decimals;
  let body: string;
  if (major >= 1_000_000_000) body = `${(major / 1_000_000_000).toFixed(major % 1_000_000_000 === 0 ? 0 : 2)}B`;
  else if (major >= 1_000_000) body = `${(major / 1_000_000).toFixed(major % 1_000_000 === 0 ? 0 : 2)}M`;
  else if (major >= 10_000) body = `${(major / 1_000).toFixed(major % 1_000 === 0 ? 0 : 1)}K`;
  else body = major.toLocaleString('en-NG', { maximumFractionDigits: 2 });
  return sym ? `${sym}${body}` : `${body} ${currency}`;
}

/** Basis points → percent string, e.g. 90 → "0.90%". */
export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

// ─── Time ──────────────────────────────────────────────────────────────────────

/** Human "x ago" relative time, falling back to an absolute date past 30 days. */
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

/** Absolute date + time, e.g. "24 Jun 2026, 14:05". */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-NG', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/** Mask the middle of a long string (addresses/references): "bc1q…f5mdq". */
export function maskMiddle(value: string, head = 6, tail = 5): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}
