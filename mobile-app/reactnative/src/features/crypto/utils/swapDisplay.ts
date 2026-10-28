// Pure display/state helpers for the swap quote + confirmation screens.
// All amounts are integer minor units; no floats are used for money.
import type { SwapStatus, SettlementStatus, SwapOrderWire } from '../types/swapWire.ts';

export const URGENT_SECONDS = 5;

/** Whole seconds left until expiry; 0 when expired or unparseable (fail closed). */
export function secondsRemaining(expiresAt: string, now: number = Date.now()): number {
  const t = Date.parse(expiresAt);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.ceil((t - now) / 1000));
}

export type CountdownState = 'normal' | 'urgent' | 'expired';
export function countdownState(seconds: number): CountdownState {
  if (seconds <= 0) return 'expired';
  return seconds < URGENT_SECONDS ? 'urgent' : 'normal';
}

/** Thousands-grouped integer. Throws on non-integers so floats never reach the UI. */
export function formatUnits(n: number): string {
  if (!Number.isSafeInteger(n)) throw new Error(`formatUnits: expected integer, got ${n}`);
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export const quoteLabel = (units: number, assetId: string) => `${formatUnits(units)} ${assetId.toUpperCase()}`;
export const receiveLabel = (units: number, assetId: string) => `You will receive ${quoteLabel(units, assetId)}`;
export const feeLabel = (spreadKobo: number) => `Fee: ${formatUnits(spreadKobo)} kobo`;

/** bps -> percent string using integer math (25 -> "0.25%"). */
export const spreadLabel = (bps: number) => {
  if (!Number.isSafeInteger(bps) || bps < 0) throw new Error(`spreadLabel: bad bps ${bps}`);
  return `${Math.floor(bps / 100)}.${String(bps % 100).padStart(2, '0')}%`;
};

export const expiryLabel = (seconds: number) =>
  seconds <= 0 ? 'Quote expired' : `Expires in ${seconds} second${seconds === 1 ? '' : 's'}`;

// ---- Execution & Result (Phase 2 Task 1.2) ----
export const EXECUTION_TIMEOUT_MS = 30_000;
export const POLL_INTERVAL_MS = 2_000;
export const MAX_POLLS = 30; // 30 x 2s = 1 minute

export const executionLabel = (_status: SwapOrderWire['status']) => 'Processing your swap...';
export const executionTimedOut = (startedAt: number, now: number = Date.now()) => now - startedAt > EXECUTION_TIMEOUT_MS;

export const resultHeadline = (status: SwapOrderWire['status']) =>
  status === 'completed' ? 'Swap completed' : status === 'failed' ? 'Swap failed' : 'Swap in progress';
export const receivedLabel = (units: number, assetId: string) => `You received ${quoteLabel(units, assetId)}`;

export const settlementLabel = (s: SettlementStatus | null | undefined) =>
  s?.ledger_settled ? `Settled${s.settled_at ? ` at ${s.settled_at}` : ''}` : 'Settlement pending';
export const refundLabel = (s: SettlementStatus | null | undefined) =>
  s?.ledger_settled ? `Refunded${s.settled_at ? ` at ${s.settled_at}` : ''}` : 'Refund pending';

export function orderDetailLines(
  order: Pick<SwapOrderWire, 'id' | 'status'> & { swap_transaction_id?: string },
  s: SettlementStatus | null | undefined,
): string[] {
  const lines = [`Order ID: ${order.id}`, `Status: ${order.status}`];
  if (order.swap_transaction_id) lines.push(`Transaction ID: ${order.swap_transaction_id}`);
  lines.push(`Ledger: ${settlementLabel(s)}`);
  return lines;
}

/** Polls fetchOnce until ledger_settled; a transient error counts as an unsettled attempt. */
export async function pollUntilSettled(
  fetchOnce: () => Promise<SettlementStatus>,
  opts: { sleep?: (ms: number) => Promise<void>; intervalMs?: number; maxRetries?: number } = {},
): Promise<SettlementStatus> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const interval = opts.intervalMs ?? POLL_INTERVAL_MS;
  const max = opts.maxRetries ?? MAX_POLLS;
  for (let i = 0; i < max; i++) {
    try {
      const s = await fetchOnce();
      if (s?.ledger_settled) return s;
    } catch { /* retry */ }
    if (i < max - 1) await sleep(interval);
  }
  throw new Error('Settlement not settled within the polling window.');
}

export type SwapEvent = 'confirm' | 'accepted' | 'settled' | 'error' | 'reset';
export function nextSwapStatus(s: SwapStatus, e: SwapEvent): SwapStatus {
  if (e === 'reset') return 'idle';
  switch (s) {
    case 'idle': return e === 'confirm' ? 'confirming' : s;
    case 'confirming': return e === 'accepted' ? 'executing' : e === 'error' ? 'failed' : s;
    case 'executing': return e === 'settled' ? 'complete' : e === 'error' ? 'failed' : s;
    default: return s;
  }
}
