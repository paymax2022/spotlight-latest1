# SP-2 — Verto Sub-Accounts, KYB/KYC Onboarding & Wallet Provisioning (Design Spec)

| | |
|---|---|
| **Status** | Draft for review (design spec; implementation plan follows via writing-plans) |
| **Date** | 2026-10-16 |
| **Sub-project** | SP-2 of the Spotlight Global program |
| **Depends on** | SP-1 (VertoFX client + adapter + `FEATURE_VERTOFX`) — merged/PR #798 |
| **Program** | [`../plans/2026-10-16-vertofx-spotlight-global-program.md`](../plans/2026-10-16-vertofx-spotlight-global-program.md) · Vision spec: [`2026-10-16-vertofx-spotlight-global-design.md`](2026-10-16-vertofx-spotlight-global-design.md) |
| **Scope** | Backend only. Mobile activation UI = SP-4; admin KYC queue = SP-5. |

---

## 1. Goal

Give a Spotlight user a **Verto sub-account** ("Global Account") provisioned through Verto's Atlas-for-Platform onboarding, so that after approval they hold multi-currency wallets they can later receive/convert/send from (SP-3/SP-4). SP-2 delivers the backend lifecycle: **activate → submit KYB/KYC → accept T&C → provisioned & ACTIVE**, reusing the existing Spotlight KYC layer and the SP-1 VertoFX client, all dark behind `FEATURE_SPOTLIGHT_GLOBAL`.

Out of scope for SP-2: pricing/platform fee (SP-3), FX/convert/send flows (already partly in orchestration; wired for Verto in SP-3/SP-4), mobile screens (SP-4), admin console (SP-5), fee sweep / treasury (SP-3), manual non-default wallet currencies (later).

## 2. Resolved decisions

| # | Decision |
|---|---|
| D1 | **Sole-proprietor variant for individuals.** One onboarding domain with `subjectType ∈ {individual, business}`. `individual` maps to a one-person entity: the user is the sole director + 100% UBO + controlling officer. `business` uses the full company + UBO(≥25%) path. Both serialize to Verto's documented company/shareholder onboarding schema. If Verto later confirms a native individual endpoint, it is a new branch in the mapper + a client method — no domain change. |
| D2 | **Reuse Spotlight KYC; never re-collect.** Activation requires Tier ≥ 2 (existing `tiers.Service`); identity fields (legal name, DOB, BVN/NIN presence, address) come from the existing `kyc`/`kycverify` records. SP-2 adds only the Verto-specific extras (products, ownership, document links, risk answers). |
| D3 | **Build against the modeled Verto schema + httptest/fake** (no live sandbox creds in this environment), exactly as SP-1. Real Verto confirmation is a go-live gate, not a build blocker. |
| D4 | **Wallets v1 = USD, EUR, GBP, NGN** auto-provisioned on approval. Manual-create currencies (KES, GHS, ZAR…) deferred. |
| D5 | **Fail-closed everywhere.** Tier gate, provider errors, and webhook verification all fail closed; nothing is marked ACTIVE or provisioned without the provider's approval event confirmed by a GET. |

## 3. Repo grounding (facts, not assumptions)

- **KYC/tiers exist and are reused as-is.** Tiers T0–T3 with a fail-closed gate (`tiers.Service.GetUserTier`, `EnforceWalletDebitLimitTx`); KYC core (`internal/finance/kyc`) holds tier state + BVN/NIN (hashed) + `SaveVerifiedIdentity` (legal name/DOB, ADR-PR722); the ADR-013 multi-provider gateway (`internal/finance/kycverify`, Dojah/Smile/Youverify) performs ID/liveness/doc/AML. `kyc.Service.Approve` already auto-provisions an NGN virtual account on T1+. **A Verto KYB submission layer does not exist — it is net-new** but fits the existing `provider.Named` + port pattern.
- **SP-1 VertoFX client** (`internal/provider/vertofx`) has auth/token cache + FX/webhook methods; SP-2 **adds** sub-account/onboarding/wallet methods to it (same modeled-schema + offline-mock + httptest approach).
- **Money/ledger:** int64 minor units; `AccountType` is a closed enum + DB CHECK (SP-2 adds no ledger accounts — provisioning is metadata, not money movement; wallet *balances* arrive in SP-3 when funds move). No transactional outbox — use in-tx atomicity + idempotency keys + a PENDING-row/poll reconciler, matching the repo.
- **Config/flags:** `getEnvBool("FEATURE_…")` on `config.Config` + conditional route mount in `internal/app/finance_routes.go`. SP-2 adds `FEATURE_SPOTLIGHT_GLOBAL`.
- **Migrations:** additive-only under `supabase/migrations/`, 14-digit timestamp, collision guard; re-check the stamp immediately before merge.
- **Webhooks:** SP-1 added a `vertofx` handler that *maps* `account.*` events but does not apply them. SP-2 applies them.

## 4. Module layout

```
backend/internal/crossborder/onboarding/
  model.go         # GlobalAccount, SubjectType, Status, ProviderWallet, FundingDetail, consent
  state.go         # state machine + legal-transition table
  ports.go         # SubAccountProvider, WalletProvisioner, KYCReader, Clock
  mapper.go        # Spotlight profile + KYC -> Verto onboarding-data (individual|business)
  service.go       # Activate, SubmitDocuments, AcceptTnC, HandleProviderStatus, GetStatus, ensureWallets
  repository.go    # pgx: provider_accounts / provider_wallets / funding_details / onboarding_submissions / consent
  http.go          # handlers + DTOs + validation
  onboarding_test.go, mapper_test.go, state_test.go, service_test.go  # + live-DB repo test gated on TEST_DATABASE_URL
backend/internal/provider/vertofx/       # EXTEND: CreateSubAccount, SubmitOnboarding, GetSubAccount, EnsureWallet, GetFundingDetails, GenerateUploadLink
backend/internal/orchestration/webhooks_vertofx.go  # EXTEND: apply account.* + tnc events (or a thin hook into onboarding.Service)
backend/internal/app/finance_routes.go   # mount the /v1/global/* group behind FEATURE_SPOTLIGHT_GLOBAL
supabase/migrations/<ts>_crossborder_onboarding.sql   # additive
```

The onboarding domain speaks Spotlight language; no Verto types cross the `ports.go` boundary (the vertofx client + a thin adapter satisfy the ports).

## 5. State machine (provider-normalised)

```
NOT_STARTED --activate--> SUBMITTED --provider ack--> IN_REVIEW
IN_REVIEW --approved(+T&C required)--> AWAITING_TNC --tnc accepted--> ACTIVE
IN_REVIEW --approved(no T&C)--> ACTIVE
IN_REVIEW --rejected--> REJECTED --fix & resubmit--> SUBMITTED
* --suspended--> SUSPENDED --reinstated--> (prior active state)
```

- Maps Verto `Pending|Active|Suspended` and `CREATED|APPROVED|REJECTED` into this one enum (single source of truth; mapping table in `state.go`).
- Transitions are **monotonic**; the applier rejects regressions and, on any doubt from a webhook, re-fetches via `GetSubAccount` before applying (belt-and-braces until webhook signing V6 is confirmed).
- `ACTIVE` is reached only after a provider-confirmed approval; wallet provisioning is triggered on entry to `ACTIVE`, idempotently.

## 6. Activation flow

1. `POST /v1/global/activate {subjectType, ...businessFields?}` → service checks **Tier ≥ 2** (fail-closed) and that no ACTIVE/IN_REVIEW account already exists (idempotent: returns the existing one).
2. Mapper builds the Verto onboarding payload from the Spotlight profile + KYC record (D2) + request extras.
3. `vertofx.CreateSubAccount` → `companyId`; persist `provider_accounts` row (status SUBMITTED, idempotency key = our account id).
4. `vertofx.SubmitOnboarding(companyId, payload)` → IN_REVIEW.
5. Verto review (async). On `account.approved` webhook (confirmed by GET): if a director T&C link is required → AWAITING_TNC and surface the link via `GET /v1/global/status`; else → ACTIVE.
6. `POST` T&C acceptance (records consent: version, timestamp, IP/device) → on provider confirmation → ACTIVE.
7. On ACTIVE: `ensureWallets` provisions USD/EUR/GBP/NGN (idempotent), fetches + stores funding details.
8. `GET /v1/global/status` always returns `{state, subjectType, nextStep, tier, rejectionReasons?, tncUrl?, wallets[]}`.

Documents: `PUT /v1/global/onboarding/documents` generates Verto upload links and records `action: ADD|UPDATE|DELETE`; used for initial submission and for **Fix & resubmit** on REJECTED.

## 7. Onboarding payload mapper (the heart of D1)

`BuildOnboardingData(subjectType, profile, kyc, extras) -> VertoOnboardingData`:
- `selectedProducts`: default Collect, Convert, Pay, Hold.
- **individual (sole-prop):** one `company` (type sole-trader; COMPANY_ADDRESS = the user's address); `shareholders = [ one INDIVIDUAL: user legal name/email/DOB/nationality/phone/address, ownership 100%, controllingOfficer true, role director ]`; documents = the user's ID + address proof via upload links.
- **business:** full `company` (type, COMPANY_ADDRESS/OPERATING_ADDRESS) + `shareholders[]` (INDIVIDUAL and/or CORPORATE, full data for any UBO ≥ 25%, ownership topology) + company documents.
- Golden tests pin both serializations (the modeled schema until V11 doc-type/risk-question IDs are confirmed; IDs are config, not hard-coded).

## 8. Data model (additive migration)

```
provider_accounts(id, user_id, provider, subject_type, provider_company_id, status,
                  tier_at_activation, created_at, submitted_at, approved_at, tnc_accepted_at,
                  rejection_reason, idempotency_key UNIQUE, ...)
provider_wallets(id, provider_account_id, currency, provider_wallet_id, funding_mode, status, created_at)
funding_details(id, wallet_id, rail, account_name, account_number_enc, bank_code, bank_name,
                reference_rule, smart_wallet_ref, created_at)
onboarding_submissions(id, provider_account_id, version, payload_ref, documents_json, submitted_at, result)
onboarding_consents(id, provider_account_id, tnc_version, accepted_at, ip, device)   -- append-only
```
- Unique `(user_id, provider)` where status is active/in-flight (one Global Account per user per provider).
- Account numbers / PII fields encrypted at rest (field-level), consistent with existing KYC PII handling.
- No `ledger_accounts`/`ledger_entries` changes in SP-2.

## 9. Webhook status application

Extend the SP-1 `vertofx` webhook path to **apply** (not just map) the account lifecycle:
- `account.approved|rejected|suspended` and T&C events → `onboarding.Service.HandleProviderStatus(companyId, normalizedEvent)` → drive the state machine (monotonic), set rejection reasons, provision wallets on ACTIVE.
- Fail-closed verify (reuse SP-1); dedupe on event id; re-fetch via `GetSubAccount` before applying a state change until V6 signing is confirmed.
- Idempotent: re-delivered approval does not re-provision wallets or duplicate rows.

## 10. HTTP API (flag-gated `FEATURE_SPOTLIGHT_GLOBAL`, bearer auth, object-level authz)

| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/global/status` | Activation state, subjectType, nextStep, tier, rejection reasons, T&C url, wallets |
| POST | `/v1/global/activate` | Start activation (tier-gated; idempotent) |
| PUT | `/v1/global/onboarding/documents` | Generate/replace document upload links (ADD/UPDATE/DELETE) |
| POST | `/v1/global/onboarding/tnc` | Record T&C acceptance |
| GET | `/v1/global/wallets` | Provisioned wallets (currency, status) — balances arrive in SP-3 |
| GET | `/v1/global/wallets/{ccy}/funding-details` | Account details (dedicated/pooled + share payload) |

All endpoints enforce that the caller owns the `provider_account` (object-level authz, not just route-level). Activation and T&C require step-up per existing money-action policy (reuse).

## 11. Testing strategy (TDD)

- **vertofx client (extend):** httptest for CreateSubAccount/SubmitOnboarding/GetSubAccount/EnsureWallet/GetFundingDetails/GenerateUploadLink; offline-mock path; re-login reuse.
- **mapper:** golden tests for individual (sole-prop) and business payloads.
- **state machine:** every legal + illegal transition; monotonic rejection.
- **service:** fake provider — tier-gate fail-closed (Tier < 2 refused), idempotent activate (second call returns the same account), approval → wallet provisioning once, reject → resubmit, suspend.
- **webhook application:** idempotent approval (no double provision), out-of-order/monotonic, GET-confirm before apply, unknown event logged no-op.
- **repository:** live-DB test gated on `TEST_DATABASE_URL` (additive migration applied), authz/ownership.
- **No money mutation** in SP-2, so no ledger invariants here; provisioning idempotency is the key property.

## 12. Security / compliance

- Reuse existing PII handling: encrypt ID/account fields; never log secrets/PII; consent log immutable.
- Object-level authz on every endpoint; step-up on activation/T&C.
- `security-reviewer` pass required before merge (auth/PII surface). Verto performs sanctions/PEP on the sub-account; Spotlight KYC remains the pre-gate.
- Counsel/compliance still own the V1 individual-onboarding acceptance and the Platform-model posture (go-live gates, tracked in the program plan).

## 13. Carried gates (build-against-modeled; confirm in Verto sandbox before enabling the flag)

| Gate | SP-2 handling |
|---|---|
| V1 individual onboarding | Mitigated by the sole-prop mapper; final acceptance is commercial/compliance. |
| V8 sub-account scoping (`companyId` path vs `X-Sub-Account-Id` header) | Hidden behind the client; verify per service in sandbox. |
| V10 review SLA + rejection taxonomy | State machine + `rejection_reason`; map taxonomy when Verto provides it. |
| V11 document type IDs + risk-assessment question IDs | IDs are config, not hard-coded; fill from Verto reference pages. |
| V5/V18 sweep | NOT in SP-2 (SP-3). |

## 14. Done when
- A user at Tier ≥ 2 can activate (individual or business), the onboarding payload is submitted to the (modeled) Verto API, approval webhooks drive the state machine, and ACTIVE triggers idempotent provisioning of USD/EUR/GBP/NGN wallets + funding details — all proven by tests, dark behind `FEATURE_SPOTLIGHT_GLOBAL`, build+vet+affected tests green, additive migration, `security-reviewer` requested, and an `ADR-PR<pr#>-global-account-onboarding.md` recording the sole-prop modeling decision.
