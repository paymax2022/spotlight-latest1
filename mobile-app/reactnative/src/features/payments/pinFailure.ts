/**
 * Why a PIN verification failed, and whether it is worth trying again.
 *
 * POST /transfers/pin/verify answers 403 for five quite different reasons —
 * pin_invalid, pin_locked, pin_not_set, wallet_disabled, daily_limit_exceeded —
 * and the sheet used to render all of them as "Incorrect PIN. Please try
 * again." That is wrong in a way that costs the customer something: it invites
 * a locked-out user to keep guessing, tells someone who never set a PIN that
 * the one they don't have is wrong, and hides a tier limit behind a PIN prompt.
 *
 * Only a genuinely wrong PIN is retryable. Everything else needs a different
 * action, so the sheet must stop asking for digits and say what to do.
 */

export interface PinFailure {
  message: string;
  /** Whether re-entering the PIN could succeed. */
  retryable: boolean;
}

function serverMessage(err: unknown): string | null {
  const msg = (err as { message?: unknown })?.message;
  return typeof msg === 'string' && msg.trim() ? msg.trim() : null;
}

export function describePinFailure(err: unknown): PinFailure {
  const response = (err as { response?: { data?: { code?: string; attempts_remaining?: number } } })?.response;

  // No response at all — the request never reached the server, so no attempt was
  // scored against the customer and retrying is exactly right.
  if (!response) {
    return { message: 'We could not reach the server. Please try again.', retryable: true };
  }

  const code = response.data?.code;
  const remaining = response.data?.attempts_remaining;

  switch (code) {
    case 'pin_invalid': {
      // Warn BEFORE the lock, not after it.
      const warning =
        typeof remaining === 'number' && remaining > 0
          ? ` ${remaining} attempt${remaining === 1 ? '' : 's'} left before your PIN is locked.`
          : '';
      return { message: `Incorrect PIN.${warning}`, retryable: true };
    }
    case 'pin_locked':
      return {
        message: 'Too many incorrect attempts. Your PIN is locked for 15 minutes. Pay by card, or try again later.',
        retryable: false,
      };
    case 'pin_not_set':
      return {
        message: 'You have not set a transaction PIN yet. Set one in Settings to pay from your wallet.',
        retryable: false,
      };
    case 'wallet_disabled':
    case 'daily_limit_exceeded':
      // The server's own wording is specific (which tier, which limit).
      return { message: serverMessage(err) ?? 'Your wallet cannot be used for this payment.', retryable: false };
    default:
      // An unrecognised failure must not invite more guesses: each one is scored
      // against the lockout, and we do not know that a retry would help.
      return { message: serverMessage(err) ?? 'We could not verify your PIN.', retryable: false };
  }
}
