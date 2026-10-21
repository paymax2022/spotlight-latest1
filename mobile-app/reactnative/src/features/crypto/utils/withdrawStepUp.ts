// One-shot, in-memory handoff of the withdrawal transaction PIN from the PIN
// screen to the submit step. Never route params: on Expo web those are written
// to the URL and the browser history. Pure — runs under node --test.

let pending: string | null = null;

export function setWithdrawalPin(pin: string): void {
  pending = pin.trim() ? pin : null;
}

/** Returns the PIN once and forgets it; null when none is waiting. */
export function takeWithdrawalPin(): string | null {
  const pin = pending;
  pending = null;
  return pin;
}

/** True when the server refused the PIN itself (wrong, locked or missing), so
 *  the right recovery is to enter it again. A missing PIN *setup* is not one. */
export function isPinRefusal(err: unknown): boolean {
  // The crypto API wraps errors (toCryptoError) and keeps the server code on
  // cryptoCode; a raw axios error carries it on response.data.code.
  const e = err as { cryptoCode?: unknown; response?: { data?: { code?: unknown } } } | undefined;
  const code = e?.cryptoCode ?? e?.response?.data?.code;
  return code === 'pin_invalid' || code === 'pin_required';
}
