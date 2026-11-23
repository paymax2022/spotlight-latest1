import { AxiosError } from 'axios';

export interface NormalizedError {
  message: string;
  status?: number;
  code?: string;
}

const FRIENDLY: Record<string, string> = {
  NETWORK_ERROR:        'No internet connection. Please check your network and try again.',
  TIMEOUT:              'Request timed out. Please try again.',
  PROVIDER_TIMEOUT:     'Provider timed out. Please try again or check transaction status.',
  UNAUTHORIZED:         'Your session has expired. Please sign in again.',
  // A 401 means two different things depending on WHERE it happens. On an
  // authenticated request the token lapsed — 'session expired' is right. On a
  // SIGN-IN attempt there is no session to expire, and telling someone their
  // session expired while they are signing in is simply confusing. Callers on
  // the auth path pass { authAttempt: true } to get this instead.
  INVALID_CREDENTIALS:  'Incorrect email/phone number or password. Try again, or use Forgot password to reset it.',
  INSUFFICIENT_BALANCE: 'Insufficient wallet balance for this transaction.',
  METER_NOT_FOUND:      'Unable to validate meter number. Please check the number and try again.',
  CARD_NOT_FOUND:       'Smart card number not found. Please check and try again.',
  SERVICE_UNAVAILABLE:  'Service temporarily unavailable. Please try again later.',
  TRANSACTION_FAILED:   'Transaction failed. Your wallet was not charged.',
  REFUND_PROCESSED:     'Transaction failed. Your wallet has been refunded.',
};

// The login refusal codes Go sends since ADR-PR802 (see
// backend/internal/handlers/auth_handler.go and docs/adr/ADR-PR802-*.md). Each one
// already arrives with a sentence naming the cause, and THAT sentence is the whole
// point of the change: a locked, suspended, closed, unregistered or mistyped
// sign-in must not be reported as "wrong password". So these codes are rendered
// verbatim instead of being mapped — adding one here without a matching server
// sentence would silently re-generalise it.
export const LOGIN_CAUSE_CODES: readonly string[] = [
  'invalid_identifier',
  'ambiguous_identifier',
  'account_not_found',
  'incorrect_password',
  'account_locked',
  'account_locked_by_support',
  'account_suspended',
  'account_closed',
  'account_record_missing',
];

export function normalizeApiError(error: unknown): NormalizedError {
  if (error instanceof AxiosError) {
    if (!error.response) {
      return { message: FRIENDLY.NETWORK_ERROR, code: 'NETWORK_ERROR' };
    }
    const status = error.response.status;
    const data   = error.response.data as Record<string, unknown>;
    const code   = typeof data?.code === 'string' ? data.code : undefined;
    const serverMessage =
      typeof data?.message === 'string'
        ? data.message
        : typeof data?.error === 'string'
          ? data.error
          : undefined;

    if (status === 401) {
      // A 401 that NAMES a login cause is a verdict about the account the user
      // just tried to sign into, and the server's own words are the answer.
      if (code && LOGIN_CAUSE_CODES.includes(code) && serverMessage) {
        return { message: serverMessage, status, code };
      }
      // Every other 401 keeps the historic reading: a bearer token lapsed. The
      // code is deliberately NOT consulted on this branch. On an authenticated
      // request a 401 means the session whatever else the body claims — the
      // principle pinned by tests/unit/social/requestActions.spec.ts ("a 401
      // that reaches this screen is a lapsed session, not a money problem") — so
      // only the explicitly-named login causes above may override it.
      return { message: FRIENDLY.UNAUTHORIZED, status, code: 'UNAUTHORIZED' };
    }
    if (code && FRIENDLY[code]) return { message: FRIENDLY[code], status, code };
    if (serverMessage) return { message: serverMessage, status, code };
    return { message: 'Something went wrong. Please try again.', status };
  }
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const err = error as NormalizedError;
    if (err.code && FRIENDLY[err.code]) return { ...err, message: FRIENDLY[err.code] };
    if (typeof err.message === 'string') {
      if (/status code 504|timeout|timed out/i.test(err.message)) {
        return { ...err, message: FRIENDLY.PROVIDER_TIMEOUT, code: err.code ?? 'PROVIDER_TIMEOUT', status: err.status ?? 504 };
      }
      return err;
    }
  }
  if (error instanceof Error) {
    if (/status code 504|timeout|timed out/i.test(error.message)) {
      return { message: FRIENDLY.PROVIDER_TIMEOUT, code: 'PROVIDER_TIMEOUT', status: 504 };
    }
    return { message: error.message };
  }
  return { message: 'An unexpected error occurred.' };
}

export interface ErrorMessageOptions {
  /**
   * Set on sign-in / sign-up submissions. A 401 there means the credentials
   * were rejected, not that a session lapsed.
   */
  authAttempt?: boolean;
}

export function getErrorMessage(error: unknown, opts?: ErrorMessageOptions): string {
  const normalized = normalizeApiError(error);
  if (opts?.authAttempt && normalized.status === 401 && !(normalized.code && LOGIN_CAUSE_CODES.includes(normalized.code))) {
    // Only the UNNAMED 401 needs the generic credentials copy. Once Go names the
    // cause, replacing its sentence with "incorrect email/phone number or
    // password" is the generalisation ADR-PR802 removes.
    return FRIENDLY.INVALID_CREDENTIALS;
  }
  return normalized.message;
}
