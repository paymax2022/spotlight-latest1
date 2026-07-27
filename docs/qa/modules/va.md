# Module: Virtual Accounts (VA)

**Risk tier:** 0 &nbsp;·&nbsp; **Money-path:** yes (inbound credit) &nbsp;·&nbsp; **Feature flag:** `FEATURE_VIRTUAL_ACCOUNTS_ENABLED`
**Code:** `backend/internal/finance/va/` (`handler.go`, `service.go`, `model.go`, `model_test.go`); mounted in `backend/internal/app/finance_routes.go`; inbound credit driven by the Paystack VA webhook
**Slug:** `VA` (uppercase, used in Case IDs)

## 1. Overview & scope

VA provisions each user a **dedicated NGN virtual account** via a `VirtualAccountProvider` adapter and credits their wallet when money lands in it. Provisioning is **KYC-tier gated** (requires `kyc_tier >= 1`, i.e. BVN verified) and idempotent on `(user_id, provider, currency)`. The single member endpoint `GET /api/finance/va/me` returns-or-provisions the caller's account. Inbound credits arrive through the webhook path (`CreditInbound`), which posts a ledger credit keyed by the provider event id so replays never double-credit. Tier gate details in `../cross-cutting/kyc-and-tiers.md`; webhook/adapter contract in `../cross-cutting/webhooks-and-providers.md` (PROV-CON-005); money invariants in `../cross-cutting/money-invariants.md`.

## 2. Services / endpoints in scope

| Operation | Method + path (or service func) | Auth / permission | Money-path? |
|---|---|---|---|
| Get-or-provision own VA | `GET /api/finance/va/me` | `requireUserID()` (token) | no (provision) |
| Get-or-provision (lib) | `GetOrProvision(ctx, userID) (*VirtualAccount, error)` | library | no |
| KYC-upgrade hook | `ProvisionForUser(ctx, userID) error` | library (called by KYC tier-1 path) | no |
| Inbound credit | `CreditInbound(ctx, InboundTransfer) error` | library (webhook) | yes |

`VirtualAccount`: `id, user_id, provider, account_number, account_name, bank_name, bank_code, provisioned_at`. `InboundTransfer` (internal): `AccountNumber, AmountKobo, Reference, SenderName, SenderBank, IdempotencyKey`. Errors: `ErrTierTooLow` (403 `tier_required`), `ErrProviderUnavailable` (503).

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage (cite file) | Status |
|---|---|---|---|
| VA field shape (10-digit NUBAN) | unit | `internal/finance/va/model_test.go` (`TestVirtualAccountFields`) | AUTOMATED |
| Inbound amount positive / key present | unit | `model_test.go` (`TestInboundTransferAmountPositive`) | AUTOMATED |
| Idempotency-key-required documented | unit | `model_test.go` (`TestIdempotencyKeyIsRequired`, `t.Log` only) | PARTIAL (not enforced/tested) |
| Tier-1 gate on provision | int | — (service reads `kyc_tier`; no test) | TODO |
| Provision idempotent on (user,provider,currency) | int | — | TODO |
| Inbound credit idempotent (webhook replay) | int | — (relies on ledger unique key) | TODO |
| Handler 401 + error mapping | authz | — | TODO |

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `VA-INT-001` | Provision on first call (Tier 1) | P0 | `qa-user-a` `kyc_tier=1`, flag on, provider configured | `GET /api/finance/va/me` | — | 200 with account (10-digit `account_number`, bank fields) |
| `VA-INT-002` | Second call returns same account | P0 | VA already provisioned | `GET /va/me` again | — | 200 same account id (idempotent on `(user_id,provider,currency)`; conflict re-fetches winner) |
| `VA-SEC-001` | Tier 0 blocked from provisioning | P0 | `qa-user-kyc0` (`kyc_tier=0`) | `GET /va/me` | — | 403 `{code:"tier_required"}` — `../cross-cutting/kyc-and-tiers.md` KYC-SEC-001 |
| `VA-INT-003` | Provider not configured → 503 | P1 | `vaProvider==nil` | `GET /va/me` (Tier 1 user) | — | 503 `virtual accounts are temporarily unavailable` |
| `VA-SEC-002` | Tier read error fails closed | P0 | force `user_profiles` read to error | `GET /va/me` | — | Blocked (500 wrapped `va: read tier`); never provisions |
| `VA-INV-001` | Inbound credit posts wallet once | P0 | provisioned VA | `CreditInbound` with `AmountKobo=250000` | key=event-id | Wallet credited `250000` via ledger; single entry |
| `VA-INV-002` | Inbound replay no double-credit | P0 | prior credit applied | `CreditInbound` again same `IdempotencyKey` | same event id | No second credit (ledger unique key) — MONEY-INV-006 / WH-SEC-004 |
| `VA-INV-003` | Inbound to unknown account number | P1 | random account number | `CreditInbound` | unmatched | No orphan credit; no user resolved — WH-INT-003 |
| `VA-AUTHZ-001` | Missing token | P0 | no token | `GET /va/me` | — | 401 `unauthenticated` |
| `VA-AUTHZ-002` | Identity from token only | P0 | `qa-user-a` token | `GET /va/me` | — | Returns `qa-user-a`'s VA; no body/param overrides identity (no body accepted) |
| `VA-SEC-003` | Flag off → route not mounted | P0 | `FEATURE_VIRTUAL_ACCOUNTS_ENABLED` off | `GET /va/me` | — | 404 — FLAG-SEC-001 |
| `VA-SEC-004` | Inbound credit audit | P1 | — | `CreditInbound` once | — | One audit event (amount kobo, ref) — AUDIT-INT-001 |

## 5. State-machine transitions

Not applicable — VA has no explicit FSM. Provisioning is a get-or-create; inbound credit is a single ledger post.

## 6. Security & abuse cases

- **Tier gate fail-closed (`VA-SEC-001/002`):** provisioning requires `kyc_tier >= 1`; a tier-read error blocks (never opens a regulated account) — `../cross-cutting/kyc-and-tiers.md`.
- **Inbound idempotency (`VA-INV-002`):** double-credit prevention rests entirely on the caller passing a stable `IdempotencyKey` (the provider event id) into the ledger's unique key — `CreditInbound` does **not** itself reject an empty key (finding). Verify the webhook path always supplies it, and add a service guard.
- **No orphan credit (`VA-INV-003`):** an inbound event for an unknown account resolves to no user and credits nothing.
- **Identity from token (`VA-AUTHZ-002`):** no request body, so no spoofable `user_id`.
- **Webhook signature** for the inbound path is verified upstream — WH-SEC-001/002.

## 7. Automated specs to add

- `internal/finance/va/service_test.go` — fake tier/DB seams: Tier-0 → `ErrTierTooLow`; tier read error → fail-closed; provision idempotency (conflict → re-fetch); `CreditInbound` empty-key rejection (close the finding). (VA-SEC-001/002, VA-INT-002, VA-INV-002)
- `internal/finance/va/handler_test.go` — httptest: 401 on missing user_id; error → status mapping (`ErrTierTooLow`→403, `ErrProviderUnavailable`→503).
- Webhook idempotency integration test: apply the same inbound event twice against real ledger → single credit (WH-SEC-004). (gap)

## 8. Coverage target & exit criteria

Tier-0: **≥ 85%** pure-logic. Exit: Tier-1 gate + fail-closed proven; provisioning idempotency proven; inbound credit idempotency proven on real ledger; flag-off returns 404; `CreditInbound` empty-key guard added. A failing tier gate or double-credit is a release blocker.
