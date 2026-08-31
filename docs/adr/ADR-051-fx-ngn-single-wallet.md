# ADR-051 — FX holds NGN in the main wallet, not a private pot

- **Status:** Accepted
- **Date:** 2026-08-29
- **Related:** [ADR-045](ADR-045-one-wallet-plane.md) (the same defect one plane
  up: two spendable accounts for one currency, invisible until money crossed),
  [ADR-040](ADR-040-wallet-plane-double-entry.md) (balanced pairs into the shared
  ledger), [ADR-029] (per-currency balance of `orch_ledger_entries`, preserved
  here unchanged)

## Context

The FX module kept **every** currency, NGN included, in its own `orch_balances`
table. Nothing in production ever put NGN there. The table's only writers are a
conversion's own destination leg, a card refund, and a test-only `SeedBalance` —
so on a live database the query was simply:

```
select count(*) from orch_balances;  →  0
```

Two things followed, and both were visible on `/fx`:

1. **The screen lied by omission.** The FX home read `orch_balances` and showed
   ₦0.00 while the wallet, checkout, food and mobility screens all showed the
   user's real balance out of `ledger_entries`. Same user, same currency, two
   different numbers, and the FX one was always zero.
2. **The first conversion was unreachable.** `ExecuteConversion` gates on
   `Balance(customer, source)`; for NGN that read the empty pot. The only way to
   get NGN into the pot was to have already converted into it.

`POST /balances` ("Add currency wallet") compounded it: the handler echoed
`{available: 0}` and persisted nothing, so an added wallet vanished on the next
refetch and no currency could be held at all.

The tempting cheap fix — point the FX *display* at the main wallet and leave the
money path alone — is the worse bug, not a smaller one. `/fx/convert` gates its
Continue button on the same balance the home screen renders, so the user would
see ₦40,000,000, tap Convert, and be refused at the ledger for insufficient
funds. Showing one number and spending a different one is the failure mode
ADR-045 already paid for once.

## Decision

**For NGN there is exactly one pot: the platform's main ledger.** FX reads it,
debits it, and pays into it. `orch_balances` holds the non-NGN currencies only.

The rule lives in exactly one file, `backend/internal/orchestration/customer_wallet.go`,
behind four functions that every FX money path now goes through —
`customerBalance`, `customerBalances`, `debitCustomerWallet`,
`creditCustomerWallet`. A caller cannot pick a different answer, and a read
cannot disagree with a write, because both run the same selector.

Call sites converted: `Balance`, `Balances`, `SeedBalance`, `ApplyConversion`,
`ApplyTransfer`, `FundCard`, `TerminateCard`. Converting only some of them would
have reproduced the split it removes.

### Consequences that had to be got right

- **Locking.** Every one of those paths now takes
  `pg_advisory_xact_lock(hashtext('wallet:'+customerID))` **first, before any row
  lock, exactly once**. The key namespace is shared with `finance/ledger` and
  `finance/transfers` deliberately: an FX conversion and a wallet transfer for the
  same user serialise against each other instead of both reading a pre-debit
  balance. One lock, same key, always first — no cycle can form.
- **Sufficiency is checked inside the debit,** under that lock, in the debiting
  transaction. `Balance()` remains an unlocked read for display and cheap
  pre-flight rejection only.
- **Idempotency.** NGN legs post into `ledger_entries` with per-side
  `":debit"/":credit"` suffixes and `ON CONFLICT DO NOTHING`, mirroring
  `ledger.Repository.DebitWithBalanceCheck`, so a replay is a no-op rather than a
  unique-key error. Keys carry an `fx:` prefix so an FX leg can never collide
  with a wallet or checkout leg that reuses a reference.
- **`orch_ledger_entries` is untouched.** It still posts a full per-currency
  balanced set for every move, so the ADR-029 invariant holds exactly as before.
  For NGN it is now the FX module's analytical mirror of a cash movement recorded
  in the main ledger, rather than the record of the pot itself.
  `provider_clearing` is the bridging account on both books.

### The deliberate fallback

`mainWalletAccountID` returns "no main wallet" for a customer id that is not a
UUID in `auth.users` — an FX business customer keyed by business id, or a
synthetic test customer. Those keep using `orch_balances` for NGN as well.

This keeps the routing **deterministic per customer**: a given customer's NGN
always lives in exactly one place, so nobody is split across both pots. The
`auth.users` probe before the insert is load-bearing rather than defensive —
`ledger_accounts.user_id` is FK to `auth.users`, and a failed insert aborts the
whole enclosing money transaction, so inside a money tx we cannot "try it and
fall back"; we have to know first.

## Alternatives rejected

- **Display-only.** Fastest, and it produces a charged-then-refused checkout.
  See above.
- **Keep the pot, add a "fund FX wallet" transfer.** Honest, but it leaves `/fx`
  at ₦0 until the user funds it, which does not fix what was reported, and it
  invents a second place for naira to sit for no benefit — the thing ADR-045
  removed.

## Status of USD

The main ledger has no per-currency user accounts (`ledger_accounts` is unique on
`(user_id, type)` and every `user_wallet` row is NGN), so non-NGN FX holdings stay
in `orch_balances`. `POST /balances` now persists a real zero-balance row, so a
USD wallet survives a refetch and is fetched back through `GET /balances`.

FX is settled by **Maplerad and Eversend**, both wired as live adapters
(`internal/orchestration/adapters/{maplerad,eversend}_live.go`) and enabled at
boot whenever their credentials are set, which they are. The funding rail was
built except for its last step, and that step is now closed:

| Step | State |
|---|---|
| Provision a USD virtual account / IBAN | ✅ `Provider.CreateCollection` → `orch_collections` |
| Mobile "Receive" screen + `GET /collections/virtual-accounts` | ✅ |
| Signed inbound webhook endpoint | ✅ `POST /api/v1/fx/webhooks/:provider`, HMAC-SHA256, fails closed |
| Webhook credits the wallet | ✅ **added here** — `Service.applyCollectionEvent` |
| Inbound collection events persisted | ✅ **added here** — `orch_collection_events` |

Before this, `HandleProviderEvent` mapped only transfer/conversion **status**, so
a real deposit was signature-checked, acknowledged `200`, and dropped. That is the
other half of why `orch_balances` was empty: not only did nothing credit NGN,
nothing credited anything.

The collection credit goes through the same `customer_wallet.go` selector as every
other path, so an NGN deposit lands in the main wallet and a USD one in the FX
pot. It is fail-closed in three places, each of which is a way to invent money
nobody sent: a non-positive amount is refused; an **unmatched reference credits
nothing** and is merely acknowledged (QA WH-INT-003, no orphan credit); and a
payload currency that disagrees with the account's own currency is refused rather
than resolved by guessing. The virtual-account row — never the payload — is the
authority on who owns a deposit and in which currency; the payload is trusted only
for the amount and the dedupe id. Redelivery is idempotent on
`(provider, provider_event_id)`.

Two supporting fixes were needed:

- `CreateCollection` was **discarding** `CollectionResult.ProviderRef`, leaving
  `details->>'account_number'` as the only way to match a webhook to a customer.
  A jsonb key is not a join key; `orch_collections.provider_ref` is now a column,
  backfilled for accounts provisioned earlier.
- The transactions feed listed one row per `orch_collections` row — per virtual
  **account**, which is not a transaction: no amount, and `destination.currency`
  left as `""`. The mobile `TransactionRef` formats that leg through
  `CURRENCIES[currency]`, so an empty code was `undefined.decimals` and the crash
  **blanked the entire FX screen** for any customer who had ever provisioned an
  account. The feed now lists real deposits from `orch_collection_events`, and
  `formatMoney` no longer takes the screen down on an unknown code.

### Still gated on the operator

`MAPLERAD_WEBHOOK_SECRET` and `EVERSEND_WEBHOOK_SECRET` are empty in `.env`, so in
that state every delivery is rejected — correctly, since verification fails
closed. They must be taken from the provider dashboards before a real deposit can
land.

Eversend is **not** wired for collections: `eversend.Client` has no `ParseWebhook`
and its collection payload shape is not in the codebase, so its event names and
field layout would be guesswork. The branch recognises the vocabulary Maplerad's
own client already maps (`maplerad.go ParseWebhook`); Eversend deposits will fall
through as unmatched — acknowledged, never credited — until its shape is
confirmed against a real payload.
