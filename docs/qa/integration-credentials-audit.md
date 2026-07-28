# Third-Party Integration & Credentials Audit

Read-only audit of every service/module that depends on a third-party API: the provider, whether
the code is **really integrated or mocked/stubbed** ("manually coded"), whether **credentials are
supplied**, and — where safely testable — whether they **work**.

> **No secret values appear in this document.** Credentials are reported only by classification
> (present / sandbox / live-shaped / placeholder / empty / absent) and non-secret prefix.
> "Working" was verified only via **read-only, non-billable** calls; live/billable providers were
> **not** exercised (see §5).

Sources: `backend/internal/provider/**`, `orchestration/adapters/**`, `integrations/**`,
`platform/**`, the standalone trading backend `mobile-app/reactnative/backend/**`, `config/validate.go`,
and the env files. Method: three parallel code/credential sweeps + live connectivity probes.

---

## 0. ⚠️ Security finding (highest priority — act first)

**Live production secrets sit in plaintext env files, and one has been in git history.**

- The repo-root `.env` and `frontend-web/.env.local` contain **live** third-party secrets
  (LLM, email, SMS, live Supabase service-role, object storage, and a DB password embedded in a
  connection URL). `backend/.env` by contrast is sandbox-only.
- The `.env` files are **gitignored / not currently tracked** — but `git log --all` shows
  **`frontend-web/.env.local` was committed to history at least once**, so any live keys it held at
  that commit are recoverable from history. `.history/` (editor snapshots, gitignored) also holds
  plaintext env copies on disk.

**Actions:** rotate every live secret that appeared in `frontend-web/.env.local` and the root
`.env`; purge them from git history (`git filter-repo`/BFG) and from `.history/`; move live secrets
to a secret manager; keep only sandbox/dev values in on-disk `.env`. Tracked as an engineering task.

---

## 1. Provider matrix — integration, credential, working status

Legend — **Wiring:** REAL = real HTTP client on the default/prod path · MOCK-DEFAULT = silently
mocked when creds/URL unset · MOCK-ONLY = no real adapter exists. **Cred (backend/.env unless
noted):** ✅ supplied · 🟡 sandbox/test · 🔵 live-shaped · ⛔ placeholder/empty/absent. **Working:**
✅ verified (read-only) · — not tested (billable/live/side-effect) · n/a.

| Provider | Purpose | Module(s) | Wiring (default) | Credential | Working? |
|---|---|---|---|---|---|
| **Paystack** | payments, VA, payout, webhooks | finance wallet/va/transfers, academy | REAL if key, else mock | 🟡 sandbox `sk_test_` | ✅ **200** (list banks) |
| **Maplerad** | VA/DVA, cards, FX rails | finance va/cards, FX orch | REAL if key | 🟡 sandbox `mpr_sandbox_` | ✅ **200** (/countries) |
| **Monnify** | bank payout/disbursement | transfers | REAL if creds, else mock | ⛔ absent in backend/.env (placeholder in example) | — (no key) |
| **Eversend** | FX provider #2 | FX orchestration | REAL if creds, else synthetic-rate adapter | 🟡 present but **client_id == client_secret** (config smell → likely non-functional) | — |
| **Dojah** | KYC (ID/liveness/doc/AML) | kycverify | REAL if creds, else PENDING (never fake-pass) | 🟡 test `test_sk_` | — (billable) |
| **Smile ID** | KYC (facial/liveness/doc) | kycverify | REAL if creds | ⛔ **placeholder** (`your_…`) | n/a (not configured) |
| **Youverify** | KYC (ID/facial/doc/AML) | kycverify | REAL if token | ⛔ **placeholder** (`your_…`) | n/a |
| **MyCover.ai** | insurance underwriting | insurance | REAL, **defaults to sandbox URL**; `TODO(live)` | 🟡 test `MCASECK_TEST` | — |
| **Octamile** | insurance (embedded/event) | insurance | REAL, sandbox default; `TODO(live)` | ⛔ placeholder in backend/.env (live-ish in root `.env`) | — |
| **CAC** | business-name registration | business registry | **MOCK-DEFAULT** (offline stub unless base+key) | ⛔ empty → sandbox stub | n/a (stub) |
| **Supabase** (Auth/REST) | identity + module data | platform-wide | REAL only | ✅ local CLI key | ✅ (used live this session) |
| **Anthropic** | doctor/nutrition/aicare LLM | health AI | REAL only, no-op if empty | 🔵 **live** `sk-ant-…` (root `.env`) | — (billable) |
| **Agora / VideoSDK** | RTC video-call tokens | telemedicine, academy live | REAL (local token signer, no network) | 🔵 live (root `.env`) | n/a (local signer) |
| **Resend** | transactional email | notifications | REAL, no-op if empty | 🔵 **live** `re_…` (root `.env`) | — (avoid live send) |
| **Termii** | SMS | notifications | REAL, no-op if empty | 🔵 **live** `tlv_…` (root `.env`) | — (billable) |
| **Cloudflare R2** | object storage (presign) | uploads (open-mic, docs, KYC) | REAL (SigV4) | 🔵 live (root `.env` / frontend) | — |
| **Google Maps** | geocode/route/matrix | maps, transport, delivery-fee | REAL if key, else mock provider | 🔵 live-shaped `AIza…` (backend/.env) | — (billable) |
| **Redis** | idempotency, Redlock, asynq | platform | REAL | ✅ local | ✅ port up |
| **PostgreSQL** | money-path + module data | platform | REAL (pgx) | ✅ local | ✅ 1,151 tables |
| **Alpaca** (trading svc) | equities execution | standalone trading backend | REAL if enabled, else MockBroker | 🟡 sandbox | ⚠️ **401** (creds not authenticating; **two different Alpaca secrets exist across env files**) |
| **Quidax** (trading svc) | crypto MD/liquidity/custody | standalone trading backend | REAL if enabled, else Mock | 🟡 opaque keys pointed at **live** `app.quidax.io` | — (live host) |

---

## 2. "Manually coded" / mock-by-default sections (money-path risk)

The failure mode for most of these is **a missing env var in production**, not an explicit dev
flag — i.e. a prod misconfig silently serves a mock. Ordered by risk.

### MOCK-ONLY — no real adapter exists (mock runs even fully configured)
| Seam | File | Behavior |
|---|---|---|
| **crypto price feed** | `internal/crypto/provider.go` | `MockPriceProvider` — hardcoded NGN prices (BTC ₦90M…) + fnv-seeded synthetic; wired unconditionally. **No real price adapter anywhere.** |
| **crypto on-chain withdrawal** | `internal/crypto/withdrawal_provider.go` | `mockWithdrawalProvider.Broadcast` **always** returns accepted + fake tx hash; deposit addresses are sha256 fakes. **No real broadcast path.** The ledger burns units as if broadcast. |
| **invest PublicOffer** | `internal/invest/provider.go` | always `MockPublicOffer` (IPO/allocations); no real seam wired |
| **fractional-RE title registry** | `internal/fractionalre/service.go` | `MockAssetProvider.VerifyTitle` clears anything not containing "disputed"; valuation 0 |

### MOCK-DEFAULT — real adapter exists, but mock is served when creds/URL unset
| Seam | Prod-reachable when… | Effect |
|---|---|---|
| **bank disbursement** (`provider/disbursement/mock.go`) | Paystack & Monnify payout creds unset | `GetTransferStatus` **always `successful`** — payouts fake-succeed |
| **FX conversion/transfer** (`orchestration/adapters/{maplerad,eversend}.go`) | Maplerad/Eversend creds unset | `ExecuteConversion→settled`, `ExecuteTransfer→processing`, synthetic refs, no dispatch; webhook verify accepts any non-empty sig |
| **card issuing** (`provider/maplerad/cards.go`) | Maplerad key unset | synthesizes fake card (masked PAN); live issuing `TODO` unverified |
| **insurance bind** (`provider/{mycover,octamile}`) | base URLs unset | binds against **sandbox**/unverified endpoints while debiting the **real** wallet/ledger |
| **CAC business reg** (`provider/cac/sandbox.go`) | base+key unset (the default) | deterministic offline registration/verify stub |
| **invest broker/market-data** (`invest/provider.go`) | `INVEST_BROKER_BASE_URL`/`…MARKETDATA…` unset | `MockBroker` fills market orders instantly at reference price |
| **academy rails** (`academy_rails_external.go`) | `RAILS_MODE=fake` (**the default**) + rail base URLs unset | tutor payout / school billing / edupay disburse+BNPL return synthetic `stub-…` success, no vendor call |
| **maps** (`maps/routes.go`) | provider key/URL unset | `MockProvider` geocode/route → affects delivery-fee distance/ETA |
| **trading backend** (`api/server.go`, `cmd/server/main.go`) | `DATABASE_URL` / `LEDGER_BACKEND` / Alpaca / Quidax unset | in-memory store + **no-op MockLedger** + mock liquidity/custody/broker — "double-entry ledger" is an in-memory no-op by default |

### "Parks funds / marks COMPLETED without real dispatch"
- **Crowdfunding creator withdrawal** — `crowdfunding/adminext/withdraw_approve.go:153` `TODO(prod): trigger payout-rail transfer`: posts Escrow→`AccountProviderClearing`, then flips `PENDING→APPROVED→COMPLETED` **with no disbursement handoff and no webhook reconciliation** — funds parked in clearing, withdrawal marked COMPLETED. Prod-reachable, unguarded.

### Nil sinks / canned data in real wiring (non-money or by-design, noted for completeness)
- `finance_routes.go:238,259` commission recorder built with **nil ledger** (by design: earning-row only, no ledger leg).
- `insurance_routes.go:83-91` policy Notifier/Auditor + certificate **R2 signer nil** → no signed certificate produced.
- `orchestration/rates.go` hardcoded USD FX table feeds the synthetic FX adapters; `orchestration/handler_stubs.go` returns canned FX beneficiary/rate/collection data (persists nothing).
- Trading backend serves hardcoded `MOCK_STOCKS/POSITIONS/ORDERS` and hardcoded provider-health rows; persists literal `"mock-custody"`/`"mock-liquidity"` labels into DB rows.

### Well-guarded (for contrast — NOT holes)
Invest `MockPINVerifier` is **dev-flag-only** (`FEATURE_INVEST_PIN_DEV_BYPASS` defaults false);
disbursement money-path does **not** silently fall back once a real client exists; Maplerad webhook
verify is **fail-closed**; KYC providers return non-terminal **PENDING** (never a fabricated PASS)
when unconfigured, so an unconfigured KYC provider cannot silently approve a user.

---

## 3. Credential validation (`config/validate.go`)

**Always required (fatal in prod, warn-only in non-prod):** `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

**Required when the gating feature is enabled:**
- `PAYSTACK_SECRET_KEY` — if wallet or bank-transfers enabled; must start `sk_` (catches a `pk_` in the secret slot).
- `MONNIFY_SECRET_KEY` — if bank-transfers enabled.
- `MAPLERAD_SECRET_KEY` — if maplerad enabled; must start `mpr_`; **prod + `MAPLERAD_PROD=true` with a `sandbox` key = hard error**.
- KYC (if kyc-verify enabled): at least one of Dojah / (SmileID partner+key) / Youverify token, **plus** `KYC_PII_ENC_KEY` (must be base64 32-byte AES-256).
- Arena (if enabled): a valid base64 32-byte signing seed.
- `MAPS_GOOGLE_KEY` (if maps enabled) — labeled "advisory" but still appended to problems ⇒ fatal in prod.

**Not validated at all** (silent if missing/wrong): all Monnify fields except secret; every webhook
secret (Maplerad/Eversend/Dojah/etc.); Eversend creds; all insurance (MyCover/Octamile); CAC; R2;
Resend; Agora; Anthropic; the RAILS adapters; `PAYMAX_WEBHOOK_SECRET`; `ADMIN_API_KEY`; Alpaca;
Elasticsearch. **Note:** `APP_ENV=staging` is treated as **non-prod** by `IsProd()` (only
`production`/`prod` match), so on the current dev config none of these fail-fast — they only warn.

---

## 4. Credential health summary (backend/.env, the primary dev config)

- **Supplied & connectivity-verified:** Paystack (sandbox), Maplerad (sandbox), Supabase/Postgres/Redis (local).
- **Supplied (sandbox/test, real adapter) — not connectivity-tested (billable):** Dojah, MyCover.
- **Supplied (live, in root `.env`) — not tested (billable/side-effect):** Anthropic, Resend, Termii, R2, Agora, Google Maps.
- **Placeholder ⇒ validator treats as unset (NOT working):** Smile ID, Youverify, Octamile (backend/.env).
- **Empty:** most webhook secrets (Maplerad/Eversend/MyCover/Dojah), CAC (all three).
- **Absent from backend/.env** (values live in root `.env`/frontend instead): Monnify, Paystack webhook, R2, Resend, Agora, Anthropic, RAILS/BILLING/BNPL/DISBURSE/PAYOUT/PAYMAX secrets, `ADMIN_API_KEY` (⇒ admin console open in dev — confirmed live earlier).
- **Consistency issues:** (1) **two different Alpaca sandbox secrets** across `backend/.env` vs the trading backend .env → the trading Alpaca creds returned **401**; (2) Eversend `client_id == client_secret`; (3) Quidax pointed at the **live** host with opaque keys while everything else is sandbox; (4) Maplerad `/institutions` returned 401 while `/countries` returned 200 (endpoint scope, not a bad key).

---

## 5. Connectivity method & results

Verified only **read-only, non-billable** endpoints; live/billable providers deliberately not called.

| Check | Endpoint | Result |
|---|---|---|
| Paystack (sandbox) | `GET api.paystack.co/bank` | ✅ 200 "Banks retrieved" |
| Maplerad (sandbox) | `GET sandbox.api.maplerad.com/v1/countries` | ✅ 200 |
| Supabase (local) | `GET /auth/v1/health` | ✅ 200 |
| Postgres (local) | `select 1` | ✅ ok (1,151 tables) |
| Redis (local) | port 6379 | ✅ up |
| Backend | `GET /api/v1/public/health` | ✅ 200 |
| Alpaca (sandbox) | `GET broker-api.sandbox.alpaca.markets/v1/assets` | ⚠️ **401** (creds not authenticating) |

**Not connectivity-tested (by choice):** Anthropic, Resend, Termii, Google Maps (billable);
Dojah/SmileID/Youverify (KYC calls are billable/side-effectful); Octamile/MyCover (bind is
side-effectful); Quidax (live host); Monnify (no key). Run a controlled sandbox smoke for these.

---

## 6. Recommendations (go-live)

1. **Rotate & relocate the live secrets** in root `.env` + `frontend-web/.env.local`; purge from git
   history + `.history/`; adopt a secret manager. (§0)
2. **Do not ship the MOCK-ONLY money seams to prod:** crypto price feed and on-chain withdrawal have
   **no real adapter** — implement real custody/market-data providers or hard-disable crypto
   withdrawal in prod. Fix the crowdfunding withdrawal that marks COMPLETED without a payout.
3. **Fail-closed on missing money-provider creds:** the default-mock-on-unset behavior for
   disbursement/FX/insurance/card should hard-fail in prod rather than silently serve an
   always-succeed stub. Extend `validate.go` to require these when their feature flag is on, and note
   `staging` is currently treated as non-prod.
4. **Fix the credential inconsistencies:** reconcile the two Alpaca secrets (trading Alpaca 401),
   Eversend id==secret, Quidax live-host-with-sandbox-everything-else.
5. **Set `ADMIN_API_KEY`, `MAPLERAD_PROD`, and provider `*_PROD` flags** correctly per environment;
   confirm `FEATURE_INVEST_PIN_DEV_BYPASS=false` and `RAILS_MODE` points at real rails in prod.
6. **Configure the KYC/insurance/CAC/Monnify providers** (currently placeholder/empty) before those
   verticals go live; wire the `TODO(live)` mappings (MyCover, Octamile, CAC, Maplerad issuing,
   SmileID webhook signature).
