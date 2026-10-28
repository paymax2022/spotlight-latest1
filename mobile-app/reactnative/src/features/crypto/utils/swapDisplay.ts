// Pure display/state helpers for the swap quote + confirmation screens.
// All amounts are integer minor units; no floats are used for money.
import type { SwapStatus } from '../types/swapWire.ts';

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
