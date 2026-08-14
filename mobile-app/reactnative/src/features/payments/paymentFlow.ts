// ── Shared checkout — pure flow helpers ──────────────────────────────────────
// Side-effect-free so they unit-test under plain Node (node --test). The stateful
// controller (usePurchasePayment) composes these; keeping the decisions here means
// the security-relevant rule (when a wallet debit needs a PIN) is testable.

export type PayMethod = 'wallet' | 'card';

/**
 * Wallet debits require a 4-digit transaction PIN by default. Disable only via
 * EXPO_PUBLIC_WALLET_PIN_REQUIRED=false (kill-switch for incidents/rollback).
 * The card rail is authorised by the Paystack gateway, so it is never PIN-gated.
 */
export function parsePinRequiredFlag(env: string | undefined): boolean {
  return (env ?? 'true') !== 'false';
}

/** Only the wallet rail is PIN-gated; card defers auth to the gateway. */
export function requiresPin(method: PayMethod, pinRequired: boolean): boolean {
  return method === 'wallet' && pinRequired;
}

/** A 4-digit numeric PIN — the only shape the sheet will submit. */
export function isValidPin(pin: string): boolean {
  return /^\d{4}$/.test(pin);
}

// ── Card rail: top up, then spend ────────────────────────────────────────────
// The card rail funds the WALLET for the exact purchase amount and then runs the
// module's ordinary wallet charge, so the net wallet change is zero and the money
// travels on one ledger.
//
// It used to charge the card directly at the PSP and then ALSO run the module's
// charge — which escrows from the wallet. The customer paid twice, and when the
// wallet was short the escrow failed after the card had already been charged, so
// the PSP money was destroyed: no ledger entry, no settlement, no refund path.
// The webhook that receives those charges only writes an audit row.

/** Server-side minimum for a wallet top-up (frontend-web wallet service). */
export const MIN_CARD_TOPUP_KOBO = 10_000; // ₦100

/**
 * Why this amount cannot be paid by card, or null when it can.
 *
 * Checked BEFORE the gateway opens. The card rail must never begin a charge it
 * cannot complete — the whole point of the change is that money is never taken
 * for a purchase that then fails.
 */
export function cardTopupBlockedReason(amountKobo: number): string | null {
  if (!Number.isInteger(amountKobo) || amountKobo <= 0) {
    return 'This amount cannot be paid by card.';
  }
  if (amountKobo < MIN_CARD_TOPUP_KOBO) {
    return `Card payments start at ₦${MIN_CARD_TOPUP_KOBO / 100}. Please pay with your wallet instead.`;
  }
  return null;
}

/**
 * What the card rail does once the gateway reports success.
 *
 * `charge` ONLY when the top-up is confirmed credited to the wallet. A client
 * success callback is not proof of payment, and running the module's charge
 * against an uncredited wallet is what produced the double charge. Everything
 * else holds: the customer's money is recorded against the top-up intent and
 * lands in their wallet, so nothing is lost and the purchase can be retried.
 */
export type CardOutcome = 'charge' | 'hold_uncredited';

export function cardOutcome(topupCredited: boolean): CardOutcome {
  return topupCredited ? 'charge' : 'hold_uncredited';
}

export interface TopupStatus {
  reference: string;
  status: string;
  completed: boolean;
  amountKobo: number;
}

/**
 * Poll a top-up intent until the webhook credits the wallet. Returns true ONLY on
 * a confirmed credit — a timeout, a failed intent or a caller abort all return
 * false, because the alternative is debiting a wallet that was never funded.
 *
 * The status fetcher and clock are injected so this stays free of the network
 * client and testable under plain Node (see paymentFlow's header). api.ts wraps
 * it with the real endpoint.
 */
export async function pollUntilCredited(
  reference: string,
  fetchStatus: (reference: string) => Promise<TopupStatus>,
  opts: {
    intervalMs?: number;
    timeoutMs?: number;
    signal?: () => boolean;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<boolean> {
  const intervalMs = opts.intervalMs ?? 3000;
  const timeoutMs = opts.timeoutMs ?? 150_000; // ~2.5 min
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    if (opts.signal?.()) return false;
    try {
      const s = await fetchStatus(reference);
      if (s.completed) return true;
      if (s.status === 'failed') return false;
    } catch {
      // Transient read failure — keep polling. The money is already recorded
      // against the intent; giving up here would only lose track of it.
    }
    await sleep(intervalMs);
  }
  return false;
}

export const WALLET_PIN_REQUIRED = parsePinRequiredFlag(
  process.env.EXPO_PUBLIC_WALLET_PIN_REQUIRED,
);
