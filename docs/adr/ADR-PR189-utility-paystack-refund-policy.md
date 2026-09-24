# ADR-PR189: Paystack-funded utility payment failures are never refunded via a fabricated wallet credit

## Status
Accepted

## Context
A utility bill payment (airtime/data/electricity/etc.) can be funded two
ways: from the in-app wallet (`payment_source: 'wallet'`, debited via the
ledger at purchase time) or directly via Paystack
(`payment_source: 'paystack'`, which never touches the wallet ledger at
all). When the biller fulfillment step fails AFTER a successful Paystack
charge, the customer has paid and received no service.

Investigating a live stuck case (`UTIL_A979FD873C9041CBA5`) found that
`reverseUtilityTransaction` (the admin close-out action) unconditionally
called `reverseWalletDebit` regardless of `payment_source`. For a
Paystack-funded transaction — which never debited the wallet — this would
fabricate a wallet credit with no corresponding debit: an unbacked credit
on top of whatever refund is separately issued via Paystack.

The voting module already has an explicit, documented policy for exactly
this situation (`app/api/admin/voting/votes/[voteId]/reverse/route.ts`):
only refund wallet-funded purchases from the ledger; Paystack-funded
purchases are refunded out-of-band via Paystack, and the ledger must never
fabricate a credit for them.

## Decision
Apply the same policy to utility payments. `reverseUtilityTransaction`
(`frontend-web/src/server/utility/service.ts`) now only calls
`reverseWalletDebit` when `transaction.payment_source === 'wallet'`. For
`payment_source === 'paystack'`, the transaction is still marked
`reversed`/closed with the admin's reason recorded (real, persisted audit
trail), but no wallet credit is posted — any refund for the Paystack charge
is issued out-of-band via Paystack by whoever owns that decision.

Also added the admin alert that was previously missing on this exact
failure path (`payUtility`'s failed + `paymentSource === 'paystack'`
branch): a Paystack-funded fulfillment failure now queues a `finance`
audience alert, matching the alert the wallet-funded failure path already
had via its self-healing reversal.

## Consequences
- An admin closing out a Paystack-funded failed utility transaction will
  never see a wallet balance change as a side effect — the wallet ledger
  stays exactly as it was before the charge, which is correct (it was
  never touched).
- The out-of-band Paystack refund step is not automated — an admin
  (finance) must still issue it manually via the Paystack dashboard or API.
  The `utility-payments` admin console added in this PR is where that
  decision is made and recorded.
- The alert on Paystack-funded failure means finance/support are notified
  going forward instead of a paid-but-unserviced transaction going
  unnoticed until a customer complains.

## Alternatives considered
- **Auto-refund via the Paystack API when fulfillment fails**: rejected for
  this PR — a real integration (API call, retry/idempotency semantics,
  webhook confirmation) is a larger scope than closing out this incident
  and fixing the immediate RLS bug that was the original report. Tracked as
  a reasonable follow-up, not blocking this fix.
- **Credit the wallet anyway as a customer-goodwill gesture**: rejected —
  it's an unbacked credit against no debit, which violates the ledger's
  double-entry invariant and would double-pay the customer once the
  Paystack refund is also issued.
