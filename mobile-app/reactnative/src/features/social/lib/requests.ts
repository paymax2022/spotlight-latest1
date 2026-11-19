// Pure decision logic for cashtag money requests — no React, no react-native,
// no design tokens — so the rules that decide whether the RECEIVER can act are
// testable under `node --test` (tests/unit/social) and shared by the API layer,
// the inbox and the detail screen.
//
// The one thing these rules exist to keep straight: a request is not symmetric.
// The requester is owed the money; the payer owes it. Only the payer may pay or
// decline, only the requester may cancel, and the client learns which one it is
// from `direction` — the backend's per-session view (`incoming` = I owe).

import type { MoneyRequest, RequestRowServer, RequestState, RequestDirection } from '../types';

/**
 * `@` + a normalized handle, for display only (server stores no prefix).
 * Case-folded to match the server's own rule — `cashtag.Normalize` "lower-cases
 * and strips a leading '@'" (backend/internal/cashtag/service.go) — so what a
 * screen shows is always what typing that handle resolves to, and matches the
 * client's `normalizeHandle`. An empty handle (a counterparty with no cashtag)
 * stays empty rather than rendering a bare '@'.
 */
export function withAt(handle: string): string {
  const trimmed = handle.trim().replace(/^@+/, '').toLowerCase();
  return trimmed ? `@${trimmed}` : '';
}

const STATES: RequestState[] = ['PENDING', 'PAID', 'DECLINED', 'CANCELLED'];
const DIRECTIONS: RequestDirection[] = ['incoming', 'outgoing'];

function asState(raw?: string): RequestState {
  const upper = (raw ?? '').trim().toUpperCase();
  // An unrecognised state is read as PENDING: that is the state a row is born
  // in, and treating an unknown label as settled would silently hide a money
  // action the user is still entitled to take.
  return (STATES as string[]).includes(upper) ? (upper as RequestState) : 'PENDING';
}

function asDirection(raw?: string): RequestDirection {
  const lower = (raw ?? '').trim().toLowerCase();
  return (DIRECTIONS as string[]).includes(lower) ? (lower as RequestDirection) : 'outgoing';
}

/** One GET /requests row (snake_case, uppercase state) → the view model. */
export function mapRequestRow(row: RequestRowServer): MoneyRequest {
  return {
    id: String(row.id ?? ''),
    direction: asDirection(row.direction),
    state: asState(row.state),
    amountKobo: Math.max(0, Math.round(Number(row.amount_kobo ?? 0))),
    note: row.note ?? '',
    requesterId: row.requester_id ?? '',
    payerId: row.payer_id ?? '',
    counterpartHandle: withAt(row.counterpart_handle ?? ''),
    counterpartName: row.counterpart_name ?? '',
    counterpartId: row.counterpart_id ?? '',
    createdAtISO: row.created_at ?? '',
  };
}

export function mapRequestRows(rows: RequestRowServer[] | undefined | null): MoneyRequest[] {
  return (rows ?? []).filter((r) => r && r.id).map(mapRequestRow);
}

/**
 * Who is this money coming from / going to. Falls back in tiers because a
 * payer can be addressed by handle without having claimed one, and
 * `counterpart_name` only exists once the backend read can join it:
 * name → handle → a generic label. Never a raw UUID in front of a customer.
 */
export function counterpartLabel(req: Pick<MoneyRequest, 'counterpartName' | 'counterpartHandle'>): string {
  const name = req.counterpartName.trim();
  if (name) return name;
  const handle = req.counterpartHandle.trim();
  if (handle) return handle;
  return 'Someone without a cashtag';
}

/** The receiver of the request may pay: they are the named payer, still pending. */
export function canPay(req: MoneyRequest): boolean {
  return req.direction === 'incoming' && req.state === 'PENDING';
}

/** The receiver may also refuse it — same party, same window. */
export function canDecline(req: MoneyRequest): boolean {
  return canPay(req);
}

/** Only the requester may withdraw a request they sent. */
export function canCancel(req: MoneyRequest): boolean {
  return req.direction === 'outgoing' && req.state === 'PENDING';
}

/** Does this row belong on the "to pay" side of the inbox? */
export function isPendingIncoming(req: MoneyRequest): boolean {
  return req.direction === 'incoming' && req.state === 'PENDING';
}

export interface RequestInbox {
  /** Money I owe, newest first — the actionable list. */
  toPay: MoneyRequest[];
  /** Money owed to me, newest first. */
  requested: MoneyRequest[];
  /** Total of the pending asks — what settling the inbox costs. */
  toPayKobo: number;
  /** Pending asks only: drives the badge, and is what "nothing waiting" means. */
  pendingCount: number;
}

/** Split the flat list into the two sides, preserving the server's order. */
export function buildInbox(list: MoneyRequest[]): RequestInbox {
  const toPay: MoneyRequest[] = [];
  const requested: MoneyRequest[] = [];
  let toPayKobo = 0;
  for (const req of list) {
    if (req.direction === 'incoming') {
      toPay.push(req);
      if (req.state === 'PENDING') toPayKobo += req.amountKobo;
    } else {
      requested.push(req);
    }
  }
  return { toPay, requested, toPayKobo, pendingCount: toPay.filter(isPendingIncoming).length };
}

/**
 * What the detail screen says about a request's state, from the caller's side.
 * The same row means different things to the two parties, so the copy is keyed
 * on direction — "Paid" to the payer reads as "you sent", to the requester as
 * "you received".
 */
export function statusCopy(req: MoneyRequest): string {
  const incoming = req.direction === 'incoming';
  switch (req.state) {
    case 'PENDING':
      return incoming ? 'Waiting for you to pay' : 'Waiting for them to pay';
    case 'PAID':
      return incoming ? 'You paid this' : 'You received this';
    case 'DECLINED':
      return incoming ? 'You declined this' : 'They declined this';
    case 'CANCELLED':
      return incoming ? 'They cancelled this' : 'You cancelled this';
  }
  return 'Pending';
}

/** The headline verb for a list row. */
export function requestVerb(req: MoneyRequest): string {
  return req.direction === 'incoming' ? 'Requested from you' : 'You requested';
}

// ── what a failed action says ───────────────────────────────────────────────
//
// A request action can fail for reasons the payer can fix (a short wallet, a
// locked tier) and reasons they cannot (someone else settled it first, the
// service is down). One flat "Could not send, please try again" is wrong for
// the first group and misleading for the second, so the dialog is chosen from
// the refusal's own signals. Input is the already-normalized error — pass
// `normalizeApiError(error)` from src/utils/errorMapper, the app's committed
// error vocabulary — so this stays pure and testable under node --test.

export type RequestFailureCta = 'top_up' | 'verify' | 'none';

export interface RequestFailure {
  title: string;
  message: string;
  cta: RequestFailureCta;
  /** Label for the affirmative button when `cta !== 'none'`. */
  ctaLabel: string;
}

export interface FailureSignals {
  status?: number;
  code?: string;
  message?: string;
}

export interface FailureContext {
  /** Amount about to be paid, already formatted for display (e.g. "₦200.00"). */
  amountLabel?: string;
  /** Wallet balance available, already formatted. Omit when the read failed. */
  balanceLabel?: string;
}

/**
 * Go wraps its internal errors with the layer that produced them, and the
 * social service wraps twice: the sentinel is `social: <sentence>`
 * (internal/social/service.go:177) and the call site prefixes the operation
 * label, so what reaches the client is
 * "social: pay request debit: ledger: insufficient funds".
 *
 * httperr passes a 4xx string through verbatim unless it matches its
 * internal-signature regex (go-common/httperr/httperr.go:200), and a module
 * chain does not — so that whole chain lands on the receiver's dialog unless it
 * is trimmed here. Leading lowercase word groups followed by ": " are the wrap
 * convention, so those go; a real sentence starts with a capital letter and
 * survives intact ("Payment failed: card declined"). This mirrors httperr's own
 * deliberately case-sensitive reading of lowercase/uppercase copy.
 *
 * Bounded to three groups: past that the remainder is the sentence, and a loop
 * without a cap would let a pathological string be eaten whole.
 */
const MODULE_WRAP = /^[a-z][a-z_]*(?: [a-z][a-z_]*)*: /;

export function stripModuleWrap(raw: string | undefined | null): string {
  let text = (raw ?? '').trim();
  for (let depth = 0; depth < 3 && MODULE_WRAP.test(text); depth++) {
    text = text.replace(MODULE_WRAP, '').trim();
  }
  return text;
}

/**
 * The one sentence a short wallet gets, from both paths that can find out: the
 * screen's own pre-flight and the ledger's refusal. Defined once so the advice
 * cannot drift between them. Labels arrive pre-formatted — formatting stays
 * with the screen, so this module keeps no dependency on the app's tokens.
 */
export function shortfallCopy(amountLabel?: string, balanceLabel?: string): string {
  return amountLabel && balanceLabel
    ? `This needs ${amountLabel} from your wallet, but you have ${balanceLabel}. Add money to your wallet, then pay again.`
    : 'This needs more money than your wallet holds. Add money to your wallet, then pay again.';
}

/** Choose the dialog for a failed request action. */
export function requestFailure(err: FailureSignals, ctx: FailureContext = {}): RequestFailure {
  const status = typeof err.status === 'number' ? err.status : undefined;
  const code = (err.code ?? '').toUpperCase();
  const serverMessage = stripModuleWrap(err.message);
  const lower = serverMessage.toLowerCase();

  const view = (title: string, message: string, cta: RequestFailureCta = 'none', ctaLabel = ''): RequestFailure =>
    ({ title, message, cta, ctaLabel });

  // 1. The wallet cannot cover the payment. Three shapes reach here: the code
  //    the transfers rail answers with (402 + INSUFFICIENT_BALANCE /
  //    INSUFFICIENT_FUNDS, backend/internal/finance/transfers/decision.go:82),
  //    the 402 social is being aligned to, and — what social serves until that
  //    lands — the default 400 whose verbatim sentence is the ledger's own
  //    ("social: pay request debit: ledger: insufficient funds"). Match all
  //    three, so a client that lost the status still gets the right dialog
  //    instead of a generic retry.
  if (
    code === 'INSUFFICIENT_BALANCE' || code === 'INSUFFICIENT_FUNDS' ||
    status === 402 ||
    /insufficient|not enough (money|funds|balance)/.test(lower)
  ) {
    return view(
      'Insufficient wallet balance',
      shortfallCopy(ctx.amountLabel, ctx.balanceLabel),
      'top_up',
      'Top up wallet',
    );
  }

  // 2. A locked wallet is not fixed by a top-up or another PIN.
  if (status === 403 && /(disabled|kyc|verif|tier)/.test(lower)) {
    return view(
      'Verification needed',
      'Your wallet cannot pay yet. Complete KYC verification to activate payments on requests.',
      'verify',
      'Verify my identity',
    );
  }

  // 3. Over today's allowance — the fix is a higher tier, not a smaller retry.
  if (status === 403 || status === 429 || /limit/.test(lower)) {
    return view(
      'Daily limit reached',
      'This payment is above the amount you are allowed to move today. Upgrade your KYC tier to raise your daily limit.',
      'verify',
      'Upgrade my tier',
    );
  }

  // 4. Party-scoped reads answer 404 for a row that is not yours — in practice
  //    this is a request someone already paid or cancelled in another session.
  if (status === 404 || /not found/.test(lower)) {
    return view(
      'Request no longer available',
      'That request has already been paid, declined or cancelled. Refresh your requests to see its current state.',
    );
  }

  // 5. The request never reached Paymax (errorMapper's own no-response codes).
  if (code === 'NETWORK_ERROR' || code === 'TIMEOUT' || (status === undefined && /network|offline|timed?[ ]?out|econn|fetch failed/.test(lower))) {
    return view(
      'No connection',
      'We could not reach Paymax to record this. Check your internet connection and try again.',
    );
  }

  // 6. Server-side outage. Makes no promise about whether money moved — the
  //    ledger is authoritative, so the user is pointed at their activity.
  if (typeof status === 'number' && status >= 500) {
    return view(
      'Paymax could not process this',
      'Something went wrong on our side. Please try again shortly — if it keeps failing, check your activity to see whether it went through.',
    );
  }

  return view('Not completed', serverMessage || 'Paymax refused this. Please check the details and try again.');
}
