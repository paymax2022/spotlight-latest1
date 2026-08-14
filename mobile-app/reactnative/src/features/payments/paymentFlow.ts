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

export const WALLET_PIN_REQUIRED = parsePinRequiredFlag(
  process.env.EXPO_PUBLIC_WALLET_PIN_REQUIRED,
);

// ── KYC spend limit (client pre-check) ───────────────────────────────────────
// Every checkout in this app ends in a wallet debit, and the server gates those
// fail-closed on the caller's KYC tier: Tier 0 has no usable wallet, and every
// capped tier has a daily debit ceiling.
//
// Checking it here is NOT a duplicate of that gate — it is what stops the card rail
// from taking the customer's money before discovering the spend will be refused.
// The card flow charges Paystack first and only then runs the module's fulfilment,
// so without this a Tier 0 customer completes a card charge and *then* gets a 403,
// leaving funds in a wallet they are not allowed to spend and no order.
//
// The server remains the authority. This only ever declines early; it never
// authorises anything.

/** The caller's tier allowance, as reported by GET /api/v1/me/tier. */
export interface SpendLimit {
  tier: number;
  /** 0 means unlimited (Tier 3) OR disabled (Tier 0) — read walletDisabled to tell. */
  dailyLimitKobo: number;
  dailyUsedKobo: number;
  /** Remaining allowance today; -1 means unlimited. */
  remainingKobo: number;
  walletDisabled: boolean;
}

export type SpendDeclineReason = 'wallet_disabled' | 'daily_limit';

export type SpendDecision =
  | { allowed: true }
  | { allowed: false; reason: SpendDeclineReason; message: string };

const ALLOWED: SpendDecision = { allowed: true };

function naira(kobo: number): string {
  return '₦' + (kobo / 100).toLocaleString('en-NG', { maximumFractionDigits: 2 });
}

/**
 * Decide whether a spend of `amountKobo` can go ahead, mirroring the server's
 * tiers.EnforceWalletDebitLimit:
 *
 *   - Tier 0 (wallet disabled)          → declined, complete KYC;
 *   - unlimited tier (remaining < 0)    → allowed;
 *   - amount greater than what is left  → declined.
 *
 * `amount > remaining` is exactly the server's `used + amount > cap`, since
 * remaining is `cap - used`. An amount equal to the remainder is allowed by both.
 *
 * A null/undefined limit means the allowance could not be read, and is ALLOWED:
 * failing closed here would block checkout on a network hiccup while protecting
 * nothing, because the server still refuses the debit on its own.
 */
export function evaluateSpendLimit(
  limit: SpendLimit | null | undefined,
  amountKobo: number,
): SpendDecision {
  if (!limit) return ALLOWED; // unknown — let the server decide

  if (limit.walletDisabled) {
    return {
      allowed: false,
      reason: 'wallet_disabled',
      message: 'Your wallet is not active yet. Complete KYC verification to pay for this.',
    };
  }

  if (limit.remainingKobo < 0) return ALLOWED; // unlimited tier

  if (amountKobo > limit.remainingKobo) {
    return {
      allowed: false,
      reason: 'daily_limit',
      message:
        `This would take you past today's ${naira(limit.dailyLimitKobo)} spending limit — ` +
        `${naira(limit.remainingKobo)} left. Upgrade your KYC tier to raise it, or try again tomorrow.`,
    };
  }

  return ALLOWED;
}
