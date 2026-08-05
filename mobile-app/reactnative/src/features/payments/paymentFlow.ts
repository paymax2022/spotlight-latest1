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
