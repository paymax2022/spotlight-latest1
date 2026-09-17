# ADR-PR184 — Real Paystack verification for doctor bank-account payouts

**Date:** 2026-09-17
**Status:** Accepted
**Deciders:** Platform/Finance
**Scope:** `backend/internal/doctor/{service.go,service_account_tail.go,repository_account_tail.go,handler.go}`,
`backend/internal/app/finance_routes.go`,
`mobile-app/reactnative/src/{api/doctor.profile.api.ts,features/doctor/constants/profile.ts}`.
No migration — reuses existing `doctor_bank_accounts.is_verified`/`account_name` columns.

## Context

The doctor onboarding screen (`/profile/setup/bank-account`) lets a doctor register
the bank account their consultation earnings pay out to. Investigating a live UAT
failure ("Verify account" silently did nothing) surfaced three compounding bugs:

1. The live (non-mock) `saveBankAccount()` response was the bare `BankAccount` row,
   but the frontend expected `{account: BankAccount}` (matching the mock branch's
   shape) — `resolved` was always `undefined`, so the UI could never show a result
   or enable "Continue", independent of whether verification itself worked.
2. `CreateBankAccount` never called any verification adapter; the SQL `INSERT`
   hardcoded `is_verified` to `false` regardless of input.
3. Even a genuinely verified account wasn't a real safety gate: `PUT /payout-account`
   could re-point an already-verified row at a *different* bank/account number
   without touching `is_verified`, and `RequestPayout` never checked `is_verified`
   before debiting the wallet. Verification was purely a UX flag — money already
   moved to unverified accounts.

## Decision

**1. A local `BankAccountResolver` interface, not a direct `provider/paystack` import.**
Mirrors the existing `CommissionRecorder` seam in the same file: `doctor` declares
`ResolveAccount(ctx, bankCode, accountNumber) (string, error)` and never imports
`provider/paystack` at compile time. `internal/app/finance_routes.go` is the one
place that imports both packages, via a 10-line `doctorBankResolverAdapter`. This
keeps the doctor package's dependency graph exactly as thin as it was, and makes the
resolver trivially fakeable in tests without a live Paystack sandbox call.

**2. Reuse the existing `paystack.Client` instance, gated only on `PAYSTACK_SECRET_KEY`.**
`finance_routes.go` already constructs a Paystack client for `paymentProvider`/
`vaProvider` when the key is set; a `paystackClient` variable was added to keep that
same instance in scope for the new adapter, rather than constructing a second one.
Deliberately **not** gated on `FEATURE_BANK_TRANSFERS_ENABLED` — that flag governs
actual outbound bank transfers and additionally requires `MONNIFY_SECRET_KEY`
(`config/validate.go`); NUBAN name-resolution is a read-only lookup that only needs
the Paystack key, and tying it to an unrelated, credential-heavier flag would block
this fix in any environment that has Paystack but not Monnify configured.

**3. Nil resolver falls back to the pre-fix behaviour (store unverified), not an error.**
An environment with no `PAYSTACK_SECRET_KEY` (e.g. local dev without the secret)
must not be unable to complete doctor onboarding at all. `CreateBankAccount`/
`UpdatePayoutAccount` check `s.bankResolver != nil` and skip verification entirely
when absent — the account is stored/updated exactly as before this fix. A
**configured** resolver that fails to resolve, by contrast, fails closed
(`ErrBankAccountUnresolvable`, 422) — once a real adapter exists, "Verify account"
must mean something.

**4. `is_verified` is decided by the SERVICE, never trusted from the client request.**
Both `CreateBankAccount` and `UpdatePayoutAccount` overwrite any client-supplied
`accountName`/verification implication with the resolver's own answer. The
repository's `verified bool`/`verified *bool` parameters are separate from the
request DTO precisely so there is no field a malicious or buggy client could set to
claim verification it didn't earn.

**5. Changing `bank_code`/`account_number` via `PUT /payout-account` always
recomputes `is_verified`** — closing the bypass described in point 3 of Context.
`nil` (no bank identity field present) means "leave as-is" (e.g. just flipping
`is_default`); a non-nil value (re-verified `true`, or `false` when unresolvable/no
resolver) overwrites it. This is why the repository signature grew a `verified
*bool` parameter with `COALESCE($n, is_verified)` in the `UPDATE`, mirroring the
existing pattern for every other patchable field in that query.

**6. `RequestPayout` gates on `is_verified` as its own step, inserted between the
idempotency/dedup block and the tier-limit check** — before the ledger debit, after
the cheaper guards. Resolves to the caller-specified `BankAccountID` or, when
absent, the doctor's current default; either way this is the account the payout
records as its destination, so it is the account whose verification must hold.
`ErrNotFound` (no account on file at all) and `ErrBankAccountUnverified` (exists but
unverified) both reject before any money moves.

## Consequences

- A doctor cannot complete a real payout against an unverified bank account,
  closing what was previously a UX-only check.
- Local/CI environments without `PAYSTACK_SECRET_KEY` are unaffected — behaviour is
  identical to before this fix (accounts store unverified, no payout gate blocks
  them). This was a deliberate compatibility choice, not an oversight; tightening it
  to fail-closed with no resolver configured is a follow-up decision for whoever
  owns the go-live gate for this feature, not bundled into this fix.
- `docs/qa/modules/marketplace.md`-style QA docs for the doctor module should record
  MKT-FSM-015's sibling: "re-pointing a verified payout account to different bank
  details resets verification" — no such doc exists yet for `doctor`; left as a
  follow-up rather than inventing a new QA doc format in this PR.
