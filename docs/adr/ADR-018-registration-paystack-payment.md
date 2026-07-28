# ADR-018 — Registration Fee Payment via the Real Paystack Gateway

**Date:** 2026-07-03  
**Status:** Accepted  
**Deciders:** Platform team

## Context

The contest registration module's payment step (`app/registration/[id]/payment.tsx`,
`src/features/registration/api/registration.api.ts`) initiated Paystack
checkout by fabricating `https://checkout.paystack.com/mock?ref=...` client-side
and opening it via `Linking.openURL`. `checkout.paystack.com` is Paystack's
real, live domain — but the reference was never registered with Paystack
(no `transaction/initialize` call was ever made), so every attempt landed on
Paystack's own "We could not start this transaction" error page.

The registration module runs mock-first
(`EXPO_PUBLIC_REGISTRATION_USE_MOCK`), with drafts held in a client-side
`Map` (later persisted to `localStorage` — see the reload-safety fix earlier
the same day). The Next.js backend
(`frontend-web/src/server/registration/store.ts`,
`frontend-web/app/api/registration/**`) already fully implements contests,
draft creation, step save/validation, fraud checks, submit, and file uploads
(real Cloudflare R2) — it just had no payment routes.

The utility/bills module already integrates Paystack for real
(`frontend-web/app/api/v1/utility/paystack/{initiate,verify}/route.ts`), via a
shared gateway helper (`frontend-web/src/server/voting/payment/paystack.ts`,
originally built for voting, reused by utility) that calls Paystack's real
`transaction/initialize`/`transaction/verify` endpoints with
`PAYSTACK_SECRET_KEY` (currently a **test-mode** secret key).

## Decision

1. **Reuse the existing Paystack gateway helper**, not a new integration.
   `initializePaystackPayment`/`verifyPaystackPayment` from
   `src/server/voting/payment/paystack.ts` are called directly — the same
   code path already proven by utility bills.

2. **Payment cannot stay mocked while the draft is mocked.** A Paystack
   payment has to attach to an application the payment route can actually
   look up (`getRegistrationDraft(id)`). A client-only mock draft
   (id `mock-<timestamp>`) doesn't exist in the Next.js server's store, so a
   real payment against it always 404s. There's no coherent way to keep the
   rest of the module mocked while making only payment real — so
   `REGISTRATION_USE_MOCK`'s default flips from `true` to `false`. The
   Next.js side was already a complete, real implementation; this was the
   last missing piece, not a new module.
   `EXPO_PUBLIC_REGISTRATION_USE_MOCK=true` still forces the old fully-offline
   mode for pure UI iteration (no payment will actually charge anything in
   that mode).

3. **New routes**, mirroring the utility pattern exactly:
   `POST /api/registration/applications/{id}/payment/initiate` and
   `GET /api/registration/applications/{id}/payment/verify`. Both require
   `requireUser` auth and object-level ownership (`draft.userId === user.id`).
   `initiate` requires an `Idempotency-Key` header (NL-9) — a replayed/
   double-submitted request returns the existing intent rather than opening a
   second Paystack transaction.

4. **The fee amount is pinned server-side**, never trusted from the client:
   `amountKobo = draft.formData['payment.feeAmount'] * 100`, read from the
   authoritative draft (locked at draft creation / step save), not from the
   request body.

5. **A `RegistrationPaymentIntent` record lives in the same in-memory store**
   as the rest of the registration module
   (`paymentIntentsByIdempotencyKey` / `paymentIntentsByReference` maps in
   `store.ts`), not a new Postgres table — because the parent `RegistrationDraft`
   it belongs to isn't durable in Postgres either yet. If/when registration
   drafts move to Supabase, this should move with them (mirroring
   `utility_paystack_intents`), not stay in-memory on its own.

6. **WALLET is disabled, not faked.** Registration fees have no real
   wallet-debit path yet (that needs an escrow hold + ledger release —
   the same iron rules as every other money mutation in this codebase).
   Rather than build that now or fake a wallet charge, the WALLET option is
   shown disabled ("Coming soon") in `payment.tsx`, and the initiate route
   rejects `method != 'PAYSTACK'` with a clear 400 if it's ever hit directly.

## Consequences

### Positive
- Registration fee payments now genuinely charge through Paystack (test
  mode) — the reported "could not start this transaction" failure is
  structurally impossible now (no fabricated URL exists anywhere).
- Reuses a proven gateway integration instead of building a second one.
- The rest of the registration module (contests, drafts, uploads, submit)
  gets exercised for real as a side effect, closing gaps that would have
  surfaced later anyway.

### Negative / trade-offs
- Flipping `REGISTRATION_USE_MOCK`'s default is a bigger blast radius than
  "just fix payment" — anything relying on registration mock quirks (e.g. the
  UI copy assuming instant wallet settlement) needs re-checking. WALLET was
  disabled rather than fixed for this reason.
- The Next.js registration store is still process-memory only (not
  Postgres) — a server restart loses in-flight drafts/payment intents. This
  ADR does not change that; it only makes the money movement itself real.
- No refund/reversal path exists yet for a registration fee (unlike the
  pharmacy/vet verticals' escrow hold→release→refund). Out of scope here.

### Deferred
- Real wallet-debit path for registration fees (escrow + ledger).
- Moving registration drafts + payment intents to Supabase for durability.
