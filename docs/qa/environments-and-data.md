# Test Environments & Data

How to bring up a stack you can run these cases against, what to seed, and which flags to flip.
All env-var names below are the real ones read by `backend/internal/config/config.go`.

## 1. Environments

| Env | Purpose | Backing services |
|---|---|---|
| **Local dev** | Manual case execution + automated unit/integration. | Local Supabase (`supabase start`, DB on `:54322`), local Redis, backend on `APP_PORT`, providers in **fake/sandbox** mode. |
| **CI** | Automated gates on every PR. | `integration-verify.yml` runs a `postgres:16` service with `RAILS_MODE=fake`; per-module lanes run `go build/vet/test`. |
| **Staging** | Full e2e + UAT sign-off before go-live. | Cloud Supabase (staging project), provider **sandbox** keys (Paystack test, Dojah/SmileID sandbox, Maplerad test). |
| **Production** | Post-deploy smoke only (read-only + one reversible op). | Live providers. **Never run destructive cases here.** |

### Bring up a local stack

```bash
# 1. Database (local Supabase, replays all ~291 additive migrations)
supabase db reset          # DB on localhost:54322

# 2. Backend
cd backend && RAILS_MODE=fake DATABASE_URL=postgres://postgres:postgres@localhost:54322/postgres go run ./cmd/server

# 3. Web
cd frontend-web && npm run dev

# 4. Admin
cd frontend-admin && npm run dev    # http://localhost:3001/admin

# 5. Mobile (Expo web target used by Playwright)
cd mobile-app/reactnative && npm run web    # :8083
```

`RAILS_MODE=fake` makes provider adapters return deterministic canned responses instead of
calling real APIs — use it for everything except explicit provider-integration cases.

## 2. Auth / identity model (what a "logged-in user" means here)

- Auth is **Supabase-managed** (JWT/HS256). The Go backend does **not** verify the JWT
  signature locally — `RequireAuthContext` (`backend/internal/middleware/auth_context.go`)
  calls Supabase `GET /auth/v1/user` to resolve identity, then loads RBAC roles/permissions.
  → **Test implication:** a token is only as valid as Supabase says. To test "invalid token"
  you need a token Supabase rejects; to test "suspended user" you set `user_status` and expect
  a **403** even with a valid token.
- Admin-only backend endpoints also accept an `x-admin-api-key` header (`RequireAdmin`,
  `ADMIN_API_KEY`). **If `ADMIN_API_KEY` is unset the guard is dev-permissive** — a Tier-0
  config case verifies prod sets it.
- Internal service-to-service endpoints (e.g. internal ledger API) require a service token
  (`LEDGER_SERVICE_TOKEN`) via `RequireServiceToken`, constant-time compared, **fail-closed**
  (503) if unconfigured.

### Standard test personas (seed these once)

| Persona | Roles | Use for |
|---|---|---|
| `qa-super-admin` | `super-admin` | RBAC grant/critical-permission cases, last-super-admin invariant. |
| `qa-admin` | domain admin (e.g. `finance.admin`) | Admin-console cases, scoped-permission checks. |
| `qa-user-a` | authenticated user, KYC Tier 1 | Happy-path money flows; owner in IDOR cases. |
| `qa-user-b` | authenticated user, KYC Tier 1 | The *other* user in IDOR / object-level authz cases. |
| `qa-user-kyc0` | authenticated user, **no KYC** | Tier-limit fail-closed, KYC-gated action denial. |
| `qa-suspended` | any role, `user_status=suspended` | Auth 403-on-suspended cases. |
| `qa-driver` / `qa-doctor` / `qa-school-admin` | role-specific | Vertical role apps (transport/health/academy). |

Seeding follows the existing Go test convention (`seedUser` inserts a synthetic `auth.users`
row with a fresh `uuid.New()`; `seedWallet` credits via `ledger.GetOrCreateStandingAccount` +
`Credit`). Reuse those helpers; do not hand-write SQL that bypasses the ledger.

## 3. Money test data rules

- **All amounts are integer kobo.** ₦1,000.00 → `100000`. Never use floats or naira decimals
  in requests or assertions.
- Fund a wallet **only through a ledger credit** (topup or `seedWallet`), never by writing a
  balance column — balances are projections of the ledger.
- Every money-mutating request carries a unique `Idempotency-Key` (≥8 chars). For replay
  cases, reuse the **same** key and assert no double-post.
- Standard fixture amounts: small `500` (₦5), normal `100000` (₦1,000), tier-boundary amounts
  taken from the tier config, large/over-limit `500000000` (₦5,000,000).

## 4. Feature flags

Every module is flag-gated (`FEATURE_<MODULE>_ENABLED`); **no flag, no route**. A flag that is
off must make the route return not-found/forbidden, not error. Relevant flags include:

```
FEATURE_CRYPTO_ENABLED           FEATURE_FX_ENABLED / FEATURE_FX_ORCHESTRATION_ENABLED
FEATURE_INVEST_ENABLED           FEATURE_INVESTAI_ENABLED
FEATURE_BANK_TRANSFERS_ENABLED   FEATURE_BENEFICIARIES_ENABLED
FEATURE_KYC_ENABLED / FEATURE_KYC_VERIFY_ENABLED   FEATURE_MAPLERAD_ENABLED
FEATURE_ACADEMY_ENABLED (+ _FEES_/_EDUPAY_/_EXAM_/_TUTOR_/_SCHOOLS_/_LIVE_/_CREDENTIALS_/_SPINE_)
FEATURE_HEALTH_ENABLED (+ _TRIAGE_/_INTAKE_/_LAB_/_PHARMACY_/_VET_)   FEATURE_DOCTOR_ENABLED
FEATURE_ESTATE_ENABLED  FEATURE_ASSOCIATION(S)_ENABLED  FEATURE_CROWDFUNDING_ENABLED
FEATURE_CONNECT_ENABLED  FEATURE_CREATORS_ENABLED  FEATURE_LOYALTY_ENABLED
FEATURE_INSURANCE_ENABLED  FEATURE_GROUPS_ENABLED  FEATURE_EVENTS_ENABLED
FEATURE_ARENA_ENABLED  FEATURE_LEARN_ENABLED  FEATURE_MAPS_ENABLED
FEATURE_BUSINESS_REGISTRY_ENABLED  FEATURE_COMMISSION_ENABLED  FEATURE_DISPUTES_ENABLED
FEATURE_FRACTIONAL_RE_ENABLED  FEATURE_INTERNAL_LEDGER_API_ENABLED  FEATURE_FINTECH_ADMIN_ENABLED
FEATURE_AICARE_ENABLED
```

Each module file has an `flag-off` case (`<MODULE>-SEC-00x`): with the flag off, the route is
inaccessible; with it on, it behaves per spec. **Watch for dev-bypass flags** — e.g.
`FEATURE_INVEST_PIN_DEV_BYPASS` must be **off** in staging/prod (Tier-0 config case).

## 5. Provider sandboxes & secrets (integration cases only)

| Provider | Vars | Sandbox toggle |
|---|---|---|
| Paystack (payments/payout) | `PAYSTACK_SECRET_KEY`, `PAYSTACK_WEBHOOK_SECRET` | test secret key |
| Monnify | `MONNIFY_API_KEY/SECRET_KEY/CONTRACT_CODE`, `MONNIFY_WEBHOOK_SECRET` | `MONNIFY_PROD=false` |
| Maplerad (cards/FX) | `MAPLERAD_PUBLIC_KEY/SECRET_KEY`, `MAPLERAD_WEBHOOK_SECRET` | `MAPLERAD_PROD=false` |
| Eversend (FX) | `EVERSEND_CLIENT_ID/SECRET`, `EVERSEND_WEBHOOK_SECRET` | `EVERSEND_PROD=false` |
| Dojah / SmileID / YouVerify (KYC) | `DOJAH_*`, `SMILEID_*`, `YOUVERIFY_*` | `*_PROD=false` |
| CAC (business reg) | `CAC_VAS_API_KEY/BASE_URL/CONSUMER_SECRET` | sandbox base URL |
| R2 storage | `R2_ACCOUNT_ENDPOINT/ACCESS_KEY_ID/SECRET_ACCESS_KEY/BUCKET/REGION` | — |
| Resend email | `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | fire-and-forget; assert enqueue, not delivery |
| RTC (live classes/consults) | `AGORA_APP_ID`, `AGORA_APP_CERTIFICATE` | — |
| LLM (nutrition/aicare/investai) | `ANTHROPIC_API_KEY` | — |

**Webhook signature secrets** (`*_WEBHOOK_SECRET`, plus `PAYMAX_WEBHOOK_SECRET`,
`PAYOUT_WEBHOOK_SECRET`, `BILLING_WEBHOOK_SECRET`, `BNPL_WEBHOOK_SECRET`,
`DISBURSE_WEBHOOK_SECRET`, `INVEST_BROKER_WEBHOOK_SECRET`) are the inputs for the
signature-forgery cases in `cross-cutting/webhooks-and-providers.md`.

**Never** enter real card/bank/BVN/NIN numbers. Use each provider's documented sandbox test
values.

## 6. Auth-hardening knobs (for lockout / anomaly cases)

`AUTH_MAX_FAILED_LOGIN_ATTEMPTS`, `AUTH_ACCOUNT_LOCK_MINUTES`,
`AUTH_SUSPICIOUS_FAILED_LOGIN_SPIKE`, `AUTH_SUSPICIOUS_IMPOSSIBLE_KMH`,
`AUTH_SUSPICIOUS_ESCALATION_POLICY` — drive the account-lockout and impossible-travel cases in
`cross-cutting/authentication.md`.

## 7. Data isolation & teardown

- Each case creates the state it needs with fresh UUIDs; **no shared mutable fixtures, no order
  dependence.** This matches the Go suite convention (repeatable, no truncation).
- Reset local DB between full runs with `supabase db reset`.
- Automated integration/e2e run against an ephemeral DB only. Never against production data or
  real PII.
