/**
 * Customer-facing copy for a failed cashtag send.
 *
 * The Send money screen used to answer every failure with
 * `Alert.alert('Could not send', 'Please try again.')`. That is wrong twice
 * over: the string is true of a network blip and false of a refusal the user
 * can actually fix (a short wallet, a locked tier, a typo'd handle), and on
 * react-native-web `Alert.alert` renders nothing at all, so the screen looked
 * like the button did nothing.
 *
 * This module owns only the classification — no React Native, no axios, no
 * env — so it stays unit-testable and the screen stays responsible for
 * rendering it (see app/social/send.tsx, which routes the result through
 * src/lib/confirm.ts so a real dialog appears on BOTH platforms).
 *
 * Statuses come from the social rail's errMap
 * (backend/internal/social/handler.go): 402 short wallet, 403 tier gate,
 * 429 AML limits, 404 unknown cashtag, 503 gate/recon unwired.
 */

export type SendFailureKind =
  | 'insufficient_funds'
  | 'daily_limit'
  | 'kyc_required'
  | 'recipient_not_found'
  | 'network'
  | 'unavailable'
  | 'failed';

/** What the dialog can offer beyond "ok". 'top_up' and 'verify' are navigable. */
export type SendFailureCta = 'top_up' | 'verify' | 'none';

export interface SendFailure {
  kind: SendFailureKind;
  title: string;
  message: string;
  cta: SendFailureCta;
  /** Label for the affirmative button when `cta !== 'none'`. */
  ctaLabel: string;
}

export interface SendFailureContext {
  /** Amount about to be sent, already formatted for display (e.g. "₦2,500"). */
  amountLabel?: string;
  /** Wallet balance available, already formatted (e.g. "₦310.00"). */
  balanceLabel?: string;
}

/**
 * Module prefixes the Go service puts on its wraps
 * ("social: send debit: ledger: insufficient funds"). The wrap belongs in the
 * server log, not on a payment screen, so leading prefixed groups are stripped
 * before a server string is shown. Only known module names are stripped so
 * ordinary copy like "Payment failed: card declined" survives intact.
 */
const INTERNAL_PREFIX = /^(?:social|ledger|tiers|cashtag|finance|transfers|aml): /i;

export function customerCopy(raw: string | undefined | null): string {
  let text = (raw ?? '').trim();
  while (INTERNAL_PREFIX.test(text)) text = text.replace(INTERNAL_PREFIX, '').trim();
  return text;
}

interface ErrorShape {
  response?: { status?: number; data?: { error?: unknown; message?: unknown; code?: unknown } };
  message?: unknown;
  code?: unknown;
  isAxiosError?: boolean;
}

interface ReadError {
  status?: number;
  serverMessage: string;
  code: string;
  /** True when the transport answered that it could not reach the server. */
  unreachable: boolean;
}

function read(error: unknown): ReadError {
  const e = (error ?? {}) as ErrorShape;
  const data = e.response?.data ?? {};
  const rawMessage =
    typeof data.message === 'string' ? data.message
      : typeof data.error === 'string' ? data.error
        : typeof e.message === 'string' ? e.message : '';
  const rawCode = typeof data.code === 'string' ? data.code : typeof e.code === 'string' ? e.code : '';
  const status = typeof e.response?.status === 'number' ? e.response.status : undefined;
  // A request that never landed has an axios error with NO response object —
  // "Network Error"/timeout/ECONN text. A locally thrown Error (a guard in the
  // screen, a bad input) is NOT a connection problem and must not claim one.
  const unreachable =
    status === undefined &&
    (e.isAxiosError === true || /network|timed?[ ]?out|econn|fetch failed|offline/i.test(rawMessage));
  return { status, serverMessage: customerCopy(rawMessage), code: rawCode.toUpperCase(), unreachable };
}

/**
 * The one sentence a short wallet gets, on both paths that can discover it:
 * the screen's own pre-flight and the backend's 402. One definition so the
 * advice cannot drift between them. Labels arrive pre-formatted — formatting
 * stays with the screen so this module keeps no dependency on the app's
 * tokens.
 */
export function insufficientBalanceCopy(amountLabel?: string, balanceLabel?: string): string {
  return amountLabel && balanceLabel
    ? `This send needs ${amountLabel} from your wallet, but you have ${balanceLabel}. Add money to your wallet, then send again.`
    : 'This send needs more money than your wallet holds. Add money to your wallet, then send again.';
}

/**
 * Classify a send failure into the dialog the user should see. Pass the amount
 * and balance labels only when the CLIENT's own balance read is what refused
 * the send — see insufficientBalanceCopy.
 */
export function classifySendFailure(error: unknown, ctx: SendFailureContext = {}): SendFailure {
  const { status, serverMessage, code, unreachable } = read(error);
  const lower = serverMessage.toLowerCase();

  const make = (kind: SendFailureKind, title: string, message: string, cta: SendFailureCta = 'none', ctaLabel = ''): SendFailure =>
    ({ kind, title, message, cta, ctaLabel });

  // 1. The refusal the user asked to be told about properly: the wallet cannot
  //    cover the send. Branch on the code the backend emits, then the 402, then
  //    the text, so a client that lost the status still gets the right dialog.
  if (code === 'INSUFFICIENT_BALANCE' || status === 402 || /insufficient|not enough (money|funds|balance)/.test(lower)) {
    return make(
      'insufficient_funds',
      'Insufficient wallet balance',
      insufficientBalanceCopy(ctx.amountLabel, ctx.balanceLabel),
      'top_up',
      'Top up wallet',
    );
  }

  // 2. Tier-0 wallets are locked outright — another PIN or a top-up will not
  //    help, so the dialog sends the user to verification instead.
  if (status === 403 && /(disabled|kyc|verif|tier)/.test(lower)) {
    return make(
      'kyc_required',
      'Verification needed',
      'Your wallet cannot send money yet. Complete KYC verification to activate sends.',
      'verify',
      'Verify my identity',
    );
  }

  // 3. Over the daily allowance — the fix is a higher tier, not a smaller retry.
  if (status === 403 || status === 429 || /limit/.test(lower)) {
    return make(
      'daily_limit',
      'Daily send limit reached',
      'This send is above the amount you are allowed to move today. Upgrade your KYC tier to raise your daily limit.',
      'verify',
      'Upgrade my tier',
    );
  }

  // 4. A typo'd handle is a normal outcome of typing a cashtag, not a crash.
  if (status === 404 || /not found|no .*account/.test(lower)) {
    return make(
      'recipient_not_found',
      'Recipient not found',
      'No Paymax account has that @cashtag. Check the spelling, or ask the person to claim their handle first.',
    );
  }

  // 5. The request never reached Paymax.
  if (unreachable) {
    return make(
      'network',
      'No connection',
      'We could not reach Paymax to send this money. Check your internet connection and try again.',
    );
  }

  // 6. Server-side refusal/outage (500, 503 unwired tier gate, recon pending).
  //    Deliberately makes no promise about whether money moved: the ledger is
  //    authoritative here, so the user is pointed at their activity instead.
  if (typeof status === 'number' && status >= 500) {
    return make(
      'unavailable',
      'Paymax could not process this send',
      'Something went wrong on our side. Please try again shortly — if it keeps failing, check your activity to see whether the send went through.',
    );
  }

  return make('failed', 'Send not completed', serverMessage || 'Paymax refused this send. Please check the details and try again.');
}
