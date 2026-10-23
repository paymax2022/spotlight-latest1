# Eversend as the wallet→bank payout rail (flag-gated) + services/wallet footer nav fix

- **Date:** 2026-10-17
- **Area:** `backend/internal/provider/eversend`, `backend/internal/provider/disbursement`,
  `backend/internal/finance/transfers`, `backend/internal/app/finance_routes.go`,
  `backend/internal/config`, `mobile-app/reactnative` (footer nav)
- **Status:** Proposed (design approved in chat; spec under review)

## Goal

Route the **wallet→bank** payout corridor through **Eversend only** when a feature
flag is on, while leaving every other money corridor (wallet→wallet, bank→bank,
collections, VA funding) exactly as it is today. Separately, fix the footer
navigation that is missing across the `/services/*` screens and absent from the
`/wallet/*` stack.

"Any specified bank, including the user's own validated bank" needs **no special
destination handling**: a wallet→bank payout already takes an arbitrary
`bank_code` + `account_number`, so the user's own account is just one such
destination. There is no separate code path for it.

## Non-goals (scope guardrails — "stick to this only for now")

- No change to wallet→wallet (Paymax P2P) or bank→bank.
- No cross-border / FX conversion. NGN→NGN payout only.
- No global change of the registry default provider (that would also move
  bank→bank). Eversend is pinned to the wallet→bank corridor specifically.
- No new "user profile bank" subsystem. If a validated bank already exists in
  the profile/beneficiaries it is offered to the UI as a prefilled destination;
  we do not build a new store for it here.

## Current state (grounding)

- Mobile `walletToBankTransfer` → `POST /api/v1/transfers/bank` (Next proxy →
  Go). `BankTransferRequest` already has an optional `Provider` field
  (`service.go:1430`); `""` = registry default.
- `transfers.InitiateBankTransfer` reserves funds (double-entry: debit user,
  credit suspense), writes a `bank_transfers` row (has a `provider` column),
  emits audit, applies the tier gate, then runs the payout leg via
  `disbursement.Registry.InitiatePayoutFailover(preferred, …)`.
- `disbursement.Registry` is built in `finance_routes.go:275` with
  `NewLive("paystack", …)`, `NewLive("monnify", …)`; default + failover come
  from `TRANSFER_PROVIDER_DEFAULT` / `TRANSFER_FAILOVER_ENABLED`.
- `provider.DisbursementProvider` (interfaces.go:79) = ListBanks,
  ResolveAccount, CreateTransferRecipient, InitiatePayout, GetTransferStatus,
  VerifyWebhookSignature, ParseWebhook, Name.
- Existing `internal/provider/eversend/eversend.go` is an FX client
  (CreateQuotation/Exchange/Payout/CreateIBAN, OAuth token, amounts in **major
  units**), **not** a DisbursementProvider.
- Eversend creds are blank in config and unverified (memory
  [FX Rails Live], [FX NGN Single Wallet]). Live payout therefore **cannot be
  proven here**; the adapter must run mock-first when creds are blank, exactly
  as `NewLive` already wraps paystack/monnify.

## Design

### 1. Eversend disbursement adapter

New `internal/provider/eversend/disbursement.go`: a `DisbursementProvider`
wrapping the existing Eversend `Client` (reused for auth/transport), plus the
NGN-payout endpoints the FX client lacks.

- `Name()` → `"eversend"`.
- `ListBanks(ctx)` → Eversend delivery banks for NG, mapped to `provider.Bank`.
- `ResolveAccount(ctx, bankCode, acct)` → Eversend account name enquiry →
  `provider.AccountResolution`.
- `CreateTransferRecipient(ctx, req)` → Eversend beneficiary create/lookup →
  `provider.Recipient{Code}` (beneficiary id/token).
- `InitiatePayout(ctx, req)` → Eversend payout. **Unit conversion at this
  boundary**: `req.AmountKobo` (int64 minor) → major units for Eversend;
  responses convert back. `IdempotencyKey`/`Reference` passed through.
- `GetTransferStatus(ctx, ref)` → Eversend transaction status →
  `provider.PayoutStatus`.
- `VerifyWebhookSignature(payload, sig)` → HMAC with `EVERSEND_WEBHOOK_SECRET`;
  **fail closed** when the secret is blank (never accept `"mock"` — same rule
  the Monnify webhook follows, finance_routes.go:948).
- `ParseWebhook(payload)` → normalize to `provider.WebhookEvent`.

The Eversend HTTP calls are coded to the documented Eversend API but are
**unverifiable live** without creds; integration tests assert request shaping
and response mapping against recorded/fixture payloads, not a live endpoint.

### 2. Registry wiring + corridor pinning

- `finance_routes.go`: build `eversendDisb` (nil-safe — only when
  `EversendClientID/Secret` set), wrap `disbursement.NewLive("eversend", …)`,
  add it to `NewRegistry(...)`. With blank creds `NewLive` falls back to the
  deterministic mock, so dev/CI stay offline-green.
- Add `Registry.InitiatePayoutVia(ctx, name, …)` — a **single-provider** payout
  that uses exactly the named provider and does **not** failover, for the
  "Eversend only" guarantee. (The existing `InitiatePayoutFailover` stays for
  every other corridor.)
- `transfers.Service` gains a `walletBankProvider string` (set from the flag at
  construction). In `InitiateBankTransfer`, when `walletBankProvider != ""`, the
  payout leg calls `InitiatePayoutVia(walletBankProvider, …)` and the
  client-supplied `req.Provider` is **ignored** for this corridor; otherwise the
  current failover behavior is unchanged. `bank_transfers.provider` records the
  actual provider used.

### 3. Feature flag + config

- `FEATURE_WALLET_BANK_EVERSEND` (default **false**). Off = wallet→bank behaves
  exactly as today (paystack default + failover). On = wallet→bank pinned to
  Eversend only. No flag, no behavior change.
- Reuses existing `EVERSEND_CLIENT_ID/SECRET/PROD/WEBHOOK_SECRET`. `.env.example`
  documents the new flag.
- Config validation: when the flag is on but Eversend creds are blank, log a
  loud warning at startup (the corridor will run mock-first) — do not hard-fail
  (dev/CI must boot).

### 4. Webhook

- New `webhooks` Eversend handler + route `POST /api/webhooks/eversend/go`,
  registered only when the Eversend provider is live (creds present), mirroring
  the Monnify registration guard. It verifies the signature (fail-closed) and
  drives the same transfer settlement seam the Monnify/Paystack handlers use
  (mark `bank_transfers` successful/failed; the ledger reversal on failure is
  the existing path, not re-implemented).

### 5. Mobile — UI entrypoint + footer nav

- **Entrypoint (decision):** keep the wallet→bank UI on the existing unified
  `TransferScreen` "To Bank" segment (`/services/transfer`), which already posts
  to `/api/v1/transfers/bank`. No client change is required for Eversend — the
  provider is a server-side routing decision. (Open for the user to redirect
  `/wallet/send` at the unified screen if they want the bank option surfaced
  there; noted, not built, to keep scope narrow.)
- **Footer nav fix (bounded):** `ModuleTabBar` only renders on routes present in
  `UTILITY_TABS`, so it blanks on `/services/transfer|fx|cards|beneficiaries|support|food|transactions`,
  and the `/wallet` stack renders no tab bar at all. Fix: pass `alsoVisibleOn`
  for the non-tab `/services/*` routes so the bar shows (no tab highlighted),
  and add a `ModuleTabBar` sibling to `app/wallet/_layout.tsx` with an
  appropriate tab set (or `alsoVisibleOn`). No navigator/route changes.

## Money-path compliance (CLAUDE.md)

- Amounts stay int64 kobo end to end; conversion to Eversend major units happens
  only inside the adapter's HTTP boundary and is covered by tests.
- Idempotency-Key already required and threaded; the payout leg reuses the
  transfer reference as the provider idempotency key.
- Double-entry reserve/settle/reverse postings are the existing
  `InitiateBankTransfer` path — unchanged.
- Audit event already emitted (`transfer.bank.reserve`).
- Tier-limit gate already applied before reserve — fail closed.
- Tests FIRST (delegate to `test-engineer`); `ledger-auditor` review before the
  money-path task is marked complete; `security-reviewer` for the webhook
  signature path.

## Testing

- Adapter unit tests: ListBanks/ResolveAccount/CreateTransferRecipient/
  InitiatePayout/GetTransferStatus request shaping + response mapping; kobo↔major
  conversion exactness; webhook signature verify (valid, invalid, **blank secret
  → reject**); webhook parse.
- Registry test: `InitiatePayoutVia` uses exactly the named provider and does
  not failover.
- transfers service test: with the flag on, wallet→bank uses `eversend` and
  ignores a client `provider`; with the flag off, behavior is unchanged.
- Mobile: footer bar visibility across the `/services/*` and `/wallet/*` routes
  (unit where feasible), and `tsc --noEmit` clean (`--stack-size=15000`).

## Rollout / flag states

- Flag off (default, all envs initially): no change; wallet→bank = paystack.
- Flag on + blank creds: corridor runs mock-first; **no real payout** — for
  wiring/UAT only, not production money movement.
- Flag on + live creds + verified webhook: real Eversend NGN payouts.

## Risks / open items

- Eversend NGN payout API surface (endpoints, quotation requirement for
  same-currency payout, status vocabulary) is **documented-but-unverified**
  here; the adapter is best-effort until exercised against a real key.
- "Eversend only" means no failover on this corridor when the flag is on: with
  blank/invalid creds every live wallet→bank payout fails closed (funds stay
  reserved, the existing reserve-without-rollback behavior). Acceptable for a
  default-off flag; called out so it is not enabled blind in production.

## Migration

None expected — `bank_transfers` already has a `provider` column and records
the provider used. If a status-vocabulary mapping needs a lookup column, it will
be an additive migration added in the plan (version re-checked immediately
before commit).
