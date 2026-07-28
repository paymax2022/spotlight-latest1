// ── Invest formatting helpers ────────────────────────────────────────────────
// Money is always integer kobo. Display in Naira (₦) with thousands separators.

export function koboToNaira(kobo: number): number {
  return (kobo ?? 0) / 100;
}

export function formatNaira(kobo: number, opts?: { decimals?: number; sign?: boolean }): string {
  const decimals = opts?.decimals ?? 2;
  const naira = koboToNaira(kobo);
  const sign = opts?.sign && naira > 0 ? '+' : '';
  const formatted = Math.abs(naira).toLocaleString('en-NG', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${naira < 0 ? '-' : sign}₦${formatted}`;
}

export function formatQty(qty: number): string {
  if (qty == null) return '0';
  // Trim trailing zeros for whole-share display.
  return Number(qty.toFixed(4)).toLocaleString('en-NG', { maximumFractionDigits: 4 });
}

export function formatPct(pct: number, withSign = true): string {
  const sign = withSign && pct > 0 ? '+' : '';
  return `${sign}${(pct ?? 0).toFixed(2)}%`;
}

// nairaToKobo parses a user-entered Naira string into integer kobo.
export function nairaToKobo(input: string | number): number {
  const n = typeof input === 'number' ? input : parseFloat(String(input).replace(/[^0-9.]/g, ''));
  if (!isFinite(n)) return 0;
  return Math.round(n * 100);
}

// newIdempotencyKey generates a unique key per money mutation.
export function newIdempotencyKey(prefix = 'inv'): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${rand}`;
}

// Human-readable order status label.
export function orderStatusLabel(status: string): string {
  const map: Record<string, string> = {
    PendingReview: 'Reviewing',
    AwaitingConfirmation: 'Awaiting confirmation',
    CashLocked: 'Cash locked',
    Submitted: 'Submitted',
    Accepted: 'Accepted',
    PartiallyFilled: 'Partially filled',
    Filled: 'Filled',
    PendingSettlement: 'Pending settlement',
    Settled: 'Settled',
    CancelRequested: 'Cancelling',
    Cancelled: 'Cancelled',
    Rejected: 'Rejected',
    Failed: 'Failed',
    Reversed: 'Reversed',
    ComplianceHold: 'On hold',
  };
  return map[status] ?? status;
}

export function isPositiveStatus(status: string): boolean {
  return ['Filled', 'Settled', 'Accepted', 'PendingSettlement', 'PartiallyFilled'].includes(status);
}
