// The rules that decide whether the RECEIVER of a cashtag money request can
// act on it — the whole point of GET /requests + POST /requests/:id/pay.
//
// A request is not symmetric: `requester` is owed the money, `payer` owes it,
// and the client only learns which one it is from `direction`. These tests pin
// the wire→view translation and, above all, that a pending incoming request is
// actionable by the payer while the requester gets cancel instead — because
// mixing those two up is exactly how "@staging11 has to pay @doctor's request"
// becomes a screen with no button.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  mapRequestRow, mapRequestRows, buildInbox, canPay, canDecline, canCancel,
  isPendingIncoming, counterpartLabel, statusCopy, requestVerb, withAt,
  requestFailure, shortfallCopy, stripModuleWrap,
} from '@/features/social/lib/requests';
import { normalizeApiError } from '@/utils/errorMapper';
import type { RequestRowServer } from '@/features/social/types';

// "@doctor requests ₦200 from @staging11", read as @staging11.
const incomingPending: RequestRowServer = {
  id: 'req-1',
  requester_id: 'user-doctor',
  payer_id: 'user-staging11',
  amount_kobo: 200_00,
  note: 'Consult',
  state: 'PENDING',
  direction: 'incoming',
  counterpart_id: 'user-doctor',
  counterpart_handle: 'doctor',
  counterpart_name: 'Dr Okon',
  created_at: '2026-11-17T10:00:00Z',
};

const row = (over: Partial<RequestRowServer>) => mapRequestRow({ ...incomingPending, ...over });

// ── the wire shape ──────────────────────────────────────────────────────────

test('the payer reads a pending incoming request as money they owe', () => {
  const req = row({});
  assert.equal(req.direction, 'incoming');
  assert.equal(req.state, 'PENDING');
  assert.equal(req.amountKobo, 200_00);
  assert.equal(req.note, 'Consult');
  assert.equal(req.counterpartId, 'user-doctor');
});

test('handles come back without the @ on the wire and gain it for display', () => {
  // backend/internal/cashtag Normalize strips the prefix before storing, so
  // GET /requests yields "doctor"; the customer vocabulary is "@doctor".
  assert.equal(incomingPending.counterpart_handle, 'doctor');
  assert.equal(row({}).counterpartHandle, '@doctor');
  assert.equal(withAt('  @Doctor '), '@doctor');
  assert.equal(withAt(''), '');
});

test('uppercase and lowercase state and direction both survive', () => {
  assert.equal(row({ state: 'paid' }).state, 'PAID');
  assert.equal(row({ state: ' Cancelled ' }).state, 'CANCELLED');
  assert.equal(row({ direction: 'INCOMING' }).direction, 'incoming');
});

test('an unknown state stays PENDING, never silently settled', () => {
  // A row the client cannot classify must not cost the payer their action.
  assert.equal(row({ state: 'AWAITING_REVIEW' }).state, 'PENDING');
  assert.equal(canPay(row({ state: 'AWAITING_REVIEW' })), true);
});

test('a missing amount reads as zero rather than NaN', () => {
  assert.equal(row({ amount_kobo: undefined }).amountKobo, 0);
  assert.equal(row({ amount_kobo: 200.4 }).amountKobo, 200);
});

test('the list mapper drops junk rows and keeps order', () => {
  const out = mapRequestRows([
    incomingPending,
    { id: 'req-2', direction: 'outgoing', state: 'PENDING' },
    undefined as unknown as RequestRowServer,
    { id: '' } as RequestRowServer,
    null as unknown as RequestRowServer,
  ]);
  assert.deepEqual(out.map((r) => r.id), ['req-1', 'req-2']);
  assert.equal(mapRequestRows(undefined).length, 0);
});

// ── who may do what ─────────────────────────────────────────────────────────

test('the receiver of a pending request can pay and decline it', () => {
  const req = row({});
  assert.equal(canPay(req), true);
  assert.equal(canDecline(req), true);
  // ...and must not be able to cancel someone else's request.
  assert.equal(canCancel(req), false);
});

test('the requester can cancel but never pay their own request', () => {
  const req = row({ direction: 'outgoing' });
  assert.equal(canCancel(req), true);
  assert.equal(canPay(req), false, 'paying your own request would move money twice');
  assert.equal(canDecline(req), false);
});

test('a settled request is inert for both parties', () => {
  for (const state of ['PAID', 'DECLINED', 'CANCELLED']) {
    for (const direction of ['incoming', 'outgoing']) {
      const req = row({ state, direction });
      assert.equal(canPay(req), false, `${direction} ${state} must not offer Pay`);
      assert.equal(canDecline(req), false, `${direction} ${state} must not offer Decline`);
      assert.equal(canCancel(req), false, `${direction} ${state} must not offer Cancel`);
    }
  }
});

test('only pending incoming rows count as waiting', () => {
  assert.equal(isPendingIncoming(row({})), true);
  assert.equal(isPendingIncoming(row({ state: 'PAID' })), false);
  assert.equal(isPendingIncoming(row({ direction: 'outgoing' })), false);
});

// ── the inbox split ─────────────────────────────────────────────────────────

test('the inbox splits what I owe from what I am owed', () => {
  const list = mapRequestRows([
    incomingPending,
    { ...incomingPending, id: 'req-2', amount_kobo: 80_00 },
    { ...incomingPending, id: 'req-3', state: 'PAID', amount_kobo: 50_00 },
    { ...incomingPending, id: 'req-4', direction: 'outgoing' },
  ]);
  const inbox = buildInbox(list);

  assert.deepEqual(inbox.toPay.map((r) => r.id), ['req-1', 'req-2', 'req-3']);
  assert.deepEqual(inbox.requested.map((r) => r.id), ['req-4']);
  // The total is what settling costs, so a paid row must not inflate it.
  assert.equal(inbox.toPayKobo, 280_00);
  assert.equal(inbox.pendingCount, 2);
});

test('an empty list is an empty inbox, not a crash', () => {
  assert.deepEqual(buildInbox([]), { toPay: [], requested: [], toPayKobo: 0, pendingCount: 0 });
});

// ── labels ──────────────────────────────────────────────────────────────────

test('the counterparty is named, and never a bare UUID', () => {
  assert.equal(counterpartLabel({ counterpartName: 'Dr Okon', counterpartHandle: '@doctor' }), 'Dr Okon');
  // A payer can be addressed by handle without a profile name.
  assert.equal(counterpartLabel({ counterpartName: '', counterpartHandle: '@doctor' }), '@doctor');
  assert.equal(counterpartLabel({ counterpartName: '   ', counterpartHandle: '  ' }), 'Someone without a cashtag');
});

test('the verb and the status are told from the viewer’s side', () => {
  assert.equal(requestVerb(row({})), 'Requested from you');
  assert.equal(requestVerb(row({ direction: 'outgoing' })), 'You requested');

  // Same PAID row, opposite meanings — this is where a symmetric copy would lie.
  assert.equal(statusCopy(row({ state: 'PAID' })), 'You paid this');
  assert.equal(statusCopy(row({ state: 'PAID', direction: 'outgoing' })), 'You received this');
  assert.equal(statusCopy(row({ state: 'PENDING' })), 'Waiting for you to pay');
  assert.equal(statusCopy(row({ state: 'PENDING', direction: 'outgoing' })), 'Waiting for them to pay');
});

// ── refusing a payment in a sentence the customer can act on ────────────────
//
// Paying a request is a wallet debit, and the ledger refuses for several
// different reasons. Each needs its own dialog: a short wallet is fixed by Add
// Money, a locked or capped wallet is fixed by KYC, and a stale request is
// fixed by refreshing. Landing them all in one generic "try again" is how
// @staging11 gets told to retry a payment that will never succeed.

test('a short wallet is the only refusal that offers Add Money', () => {
  // The transfers rail answers 402 + INSUFFICIENT_BALANCE (backend/internal/
  // finance/transfers/decision.go); social routes are moving to the same code.
  const byCode = requestFailure({ code: 'INSUFFICIENT_BALANCE' });
  assert.equal(byCode.cta, 'top_up');
  assert.equal(byCode.ctaLabel, 'Top up wallet');
  assert.equal(byCode.title, 'Insufficient wallet balance');

  // Either half of the pair may be missing and the dialog still means top-up.
  assert.equal(requestFailure({ status: 402, message: 'insufficient wallet balance' }).cta, 'top_up');
  assert.equal(requestFailure({ status: 400, message: 'ledger: insufficient funds' }).cta, 'top_up');
  assert.equal(requestFailure({ status: undefined, message: 'Not enough money in your wallet' }).cta, 'top_up');
});

test('the shortfall sentence quotes both figures, and neither when it cannot', () => {
  assert.equal(
    shortfallCopy('₦200.00', '₦45.00'),
    'This needs ₦200.00 from your wallet, but you have ₦45.00. Add money to your wallet, then pay again.',
  );
  // A balance the app failed to read must not be quoted as ₦0 — so a missing
  // label drops the whole sentence rather than printing a fabricated figure.
  assert.equal(
    shortfallCopy('₦200.00', undefined),
    'This needs more money than your wallet holds. Add money to your wallet, then pay again.',
  );
  assert.equal(
    requestFailure({ status: 402 }, { amountLabel: '₦200.00' }).message,
    'This needs more money than your wallet holds. Add money to your wallet, then pay again.',
  );
});

test('a locked wallet goes to KYC, not to Add Money', () => {
  const locked = requestFailure({ status: 403, message: 'social: wallet is disabled until KYC verification' });
  assert.equal(locked.title, 'Verification needed');
  assert.equal(locked.cta, 'verify');
  assert.match(locked.message, /KYC/);
});

test('a limit refusal names the tier, whatever status it arrives with', () => {
  assert.equal(requestFailure({ status: 429, message: 'too many requests' }).title, 'Daily limit reached');
  assert.equal(requestFailure({ status: 403, message: 'aml: daily limit exceeded' }).cta, 'verify');
  // ADR-001 tier ladder: T1 ₦50k / T2 ₦200k, so the fix is a higher tier.
  assert.equal(requestFailure({ message: 'Amount above your daily limit' }).title, 'Daily limit reached');
});

test('a request that already moved reads as gone, not as a failure to retry', () => {
  // Party-scoped reads answer 404 for a row that is not yours, and in practice
  // that means someone paid or cancelled it in another session.
  const stale = requestFailure({ status: 404, message: 'social: request not found' });
  assert.equal(stale.title, 'Request no longer available');
  assert.equal(stale.cta, 'none');
  assert.equal(requestFailure({ message: 'request not found' }).title, 'Request no longer available');
});

test('no connection and a server outage are told apart', () => {
  // errorMapper's own codes for a request that never reached the server.
  assert.equal(requestFailure({ code: 'NETWORK_ERROR', message: 'No internet connection.' }).title, 'No connection');
  assert.equal(requestFailure({ code: 'TIMEOUT', message: 'Request timed out.' }).title, 'No connection');
  assert.equal(requestFailure({ message: 'fetch failed' }).title, 'No connection');

  // ≥500 promises nothing about whether money moved, because only the ledger knows.
  const boom = requestFailure({ status: 503, message: 'upstream error' });
  assert.equal(boom.title, 'Paymax could not process this');
  assert.match(boom.message, /activity/);
  assert.equal(boom.cta, 'none');
});

test('module names never reach the customer', () => {
  // The shape Go actually produces: sentinel "social: <sentence>" wrapped by the
  // call site as "social: pay request debit: <inner>" (internal/social/service.go).
  assert.equal(stripModuleWrap('social: pay request debit: ledger: insufficient funds'), 'insufficient funds');
  assert.equal(stripModuleWrap('social: pay: ledger: insufficient funds'), 'insufficient funds');
  assert.equal(stripModuleWrap('  aml: check failed  '), 'check failed');
  assert.equal(stripModuleWrap('social: cannot request from yourself'), 'cannot request from yourself');
  // Ordinary copy starts with a capital, so a colon inside it is not a wrap.
  assert.equal(stripModuleWrap('Payment failed: card declined'), 'Payment failed: card declined');
  // Depth cap: a pathological chain keeps its tail rather than being eaten whole.
  assert.equal(stripModuleWrap('a: b: c: d: e: stopped'), 'd: e: stopped');
  assert.equal(stripModuleWrap(undefined), '');

  const other = requestFailure({ status: 400, message: 'ledger: request is already paid' });
  assert.equal(other.title, 'Not completed');
  assert.equal(other.message, 'request is already paid');
  assert.doesNotMatch(other.message, /\b(social|ledger|tiers|cashtag|finance|transfers|aml):/);
});

test('a shortfall wrapped in the module chain is still read as a shortfall', () => {
  // The verbatim 4xx passthrough is what main serves today, so this is the
  // realistic input, not the idealised one.
  const short = requestFailure({
    status: 400,
    message: 'social: pay request debit: ledger: insufficient funds for wallet',
  }, { amountLabel: '₦200.00', balanceLabel: '₦45.00' });
  assert.equal(short.cta, 'top_up');
  assert.equal(short.message, 'This needs ₦200.00 from your wallet, but you have ₦45.00. Add money to your wallet, then pay again.');

  // A state conflict must not be mistaken for money: the sentence has neither
  // "insufficient" nor a limit word in it.
  const settled = requestFailure({ status: 400, message: 'social: request state transition failed' });
  assert.equal(settled.title, 'Not completed');
  assert.equal(settled.message, 'request state transition failed');
});

test('a refusal with nothing to say still says something', () => {
  const empty = requestFailure({ status: 400 });
  assert.equal(empty.title, 'Not completed');
  assert.equal(empty.message, 'Paymax refused this. Please check the details and try again.');
  assert.equal(empty.cta, 'none');
});

test('the screen’s chain: normalizeApiError then requestFailure', () => {
  // What a pay.mutateAsync() rejection actually looks like once errorMapper is
  // done with it (the non-Axios path keeps the server's wrapped sentence).
  const fromServer = normalizeApiError({
    message: 'social: pay: ledger: insufficient funds for wallet',
    status: 402,
    code: 'INSUFFICIENT_BALANCE',
  });
  assert.equal(fromServer.code, 'INSUFFICIENT_BALANCE');
  assert.equal(requestFailure(fromServer, { amountLabel: '₦200.00', balanceLabel: '₦45.00' }).cta, 'top_up');

  // A 401 that reaches this screen is a lapsed session, not a money problem —
  // it must not be dressed up as one (errorMapper only attaches UNAUTHORIZED on
  // the Axios path, so the classifier falls through to a plain refusal).
  const expired = normalizeApiError({ message: 'Unauthorized', status: 401 });
  assert.equal(requestFailure(expired).title, 'Not completed');
  assert.equal(requestFailure(expired).cta, 'none');
});
