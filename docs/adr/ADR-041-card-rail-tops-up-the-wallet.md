# ADR-041 — The card rail tops up the wallet, then spends it

- **Status:** Accepted
- **Date:** 2026-08-14
- **Related:** [ADR-044](ADR-044-telemedicine-platform-booking-fee.md) (the review
  that surfaced this), [ADR-030](ADR-030-fx-paymax-markup.md) /
  [ADR-029](ADR-029-orch-ledger-per-currency-double-entry.md) (one ledger, balanced)

## Context

`usePurchasePayment` is the shared checkout used by **54 screens** — food, health,
mobility, savings, social, stays, marketplace, telemedicine and more. It offers two
rails: wallet and card.

The card rail was broken, and broken in the worst direction.

```
1. gateway.open({ amountKobo })     → Paystack Inline charges the CARD, client-side
2. onSuccess → finalize(req,'card') → req.charge('card')
3. every module ignores `method`    → its endpoint escrows via ledger.Debit(payer)
                                       … which debits the WALLET
```

The webhook that receives step 1's charge
(`frontend-web/app/api/webhooks/paystack/gateway-handler.ts`) verifies it, writes a
row to `payment_webhook_logs`, and stops. Crediting the wallet is an explicit
`TODO`. So the PSP money never enters the ledger.

Two consequences, both real money:

- **Double charge.** The customer pays at Paystack *and* is debited in-app. For a
  ₦3,675 consultation: ₦3,675 at the PSP + ₦3,675 from the wallet.
- **Money destroyed.** If the wallet cannot cover it, `DebitWithBalanceCheck`
  returns `ErrInsufficientFunds`, the endpoint 500s, and the PSP charge is left
  with no ledger entry, no settlement, no order and no refund path. This is the
  *default* case for a customer paying by card precisely because their wallet is
  empty.

A ledger-auditor review of the telemedicine platform fee (ADR-044) surfaced this.
It also means ADR-044's guards — "reject before any money moves" — were only ever
true of the wallet rail: on the card rail the PSP charge had already completed, so
a rejection destroyed the customer's money rather than protecting it.

Note this is **not** every card payment in the app. Bill payments (airtime, data,
cable, electricity, education) use `useGatewayCheckout`, where the server owns the
transaction and settles it server-side. Those were never affected.

## Decision

**The card rail funds the wallet for the exact purchase amount, waits for the
webhook to credit it, then runs the module's ordinary wallet charge.**

```
1. POST /api/v1/wallet/topup { amount_kobo }   → intent + Paystack initialize
2. extractAccessCode(authorization_url)
3. gateway.open({ accessCode })                → RESUMES the server's transaction
4. webhook credits the wallet (idempotent, ledger-posted)
5. poll GET /api/v1/wallet/topup/:reference until completed
6. finalize(req,'card') → the module's normal wallet debit
```

Net wallet change is zero, the customer is charged once, and every kobo moves on
one ledger with an entry behind it.

This is not a new design — it is the design the codebase already had and never
wired up. `src/features/payments/api.ts` has carried `startCardTopup` /
`waitForTopup` (unused) since it was written, its file header describes exactly
this flow, `GET /api/v1/wallet/topup/:reference` exists solely to support it ("so
the app can wait for the Paystack webhook to credit the wallet before completing a
module checkout"), and `paystackGateway.accessCode` documents resuming a
server-owned transaction. Only `usePurchasePayment` went the other way.

### Why resume, not re-charge

Step 3 resumes the transaction the *server* initialized. The server set the
amount, the Idempotency-Key and the `wallet_topup` metadata the webhook matches
on, so the client cannot alter what is charged. When no access code can be derived
the rail **fails closed** — it does not fall back to a client-initialized charge,
because that is the broken path.

### Why the module charge waits for the webhook

A client success callback is not proof of payment. Running the module's charge on
the callback alone is the original defect. `cardOutcome(credited)` returns
`'charge'` only on a confirmed credit; a timeout, a failed intent or an abort all
hold.

Holding is safe in a way the old rail never was: the money is recorded against the
top-up intent and lands in the customer's wallet, so **nothing is lost** and the
purchase can be completed from the wallet. Every failure mode now degrades to
"your money is in your wallet" instead of "your money is gone".

### Guards added along the way

- **Amount check in the top-up webhook.** It credited `intent.amount_kobo` and
  never compared it to what Paystack actually collected — it destructured `amount`
  off the event and ignored it. Every module checkout now funds itself through
  this path, so a divergence would mint wallet balance. It now fails the intent on
  a mismatch.
- **`initiateFunding({ amount })` renamed to `{ amountKobo }`.** The parameter was
  always kobo, and the misleading name had already produced a live bug: the unused
  `startCardTopup` divided by 100 first, so it would have topped up 1/100th of
  every purchase and failed the following debit. It also rounded to whole naira, so
  a ₦333.33 purchase could only ever top up ₦333.
- **Pre-flight amount check.** Amounts below the server's ₦100 top-up minimum are
  refused *before* the gateway opens, with the wallet offered instead. Discovering
  that after the card was charged would leave a paid-for purchase that cannot
  complete.

### The card rail stays PIN-free

The final money move is now a wallet debit, and wallet debits are PIN-gated. Card
is not: the customer authorised this exact amount by entering card details seconds
earlier, and a PIN would be a second authorisation for one payment.

## Consequences

**Good**

- The customer is charged once. The double charge is gone.
- No failure mode destroys money. The worst case is "it's in your wallet, retry".
- Card money is on the ledger — reconcilable, auditable, refundable through the
  ordinary path.
- No module changed. All 54 checkouts inherit the fix, because `charge()` already
  did the wallet debit.
- ADR-044's expected-total guard becomes truthful on both rails: the 409 now fires
  before the wallet is debited, and any card money already taken is sitting in the
  customer's wallet rather than lost at the PSP.

**Costs / risks**

- **Card payments now require KYC tier 1**, because `POST /wallet/topup` calls
  `requireKycTier(user.id, 1)`. Combined with the known Tier-0 population this is
  the single biggest behavioural change here and needs a product decision before
  rollout — see below.
- **Card payments now require `FEATURE_WALLET_ENABLED`.** With the wallet feature
  off the top-up route 503s and the card rail fails closed with a clear message.
- **Purchases under ₦100 cannot use card** (the server's top-up minimum).
- **Checkout is slower.** It now waits on a webhook round-trip (polled every 3s,
  up to ~2.5 min) instead of completing on the client callback.
- Customers may accumulate small wallet balances when a charge fails after the
  credit lands. That is money they still have, but it is a support surface.

**Not addressed here**

- No feature flag. The previous behaviour is never correct — a flag to restore it
  would be a flag to double-charge — so the rail is simply fixed. The operational
  kill switch is disabling the wallet feature, which fails the card rail closed.
- `gateway-handler.ts`'s fulfilment `TODO` is now moot for this rail (the top-up
  webhook does the crediting), but the handler still logs these charges as an
  audit anchor. Direct `usePaystackGateway` callers outside `usePurchasePayment`,
  if any are added later, would reintroduce the same hole.
- The KYC tier gate on top-ups is inherited, not decided, by this ADR.
