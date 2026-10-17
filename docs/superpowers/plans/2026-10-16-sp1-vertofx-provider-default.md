# SP-1: VertoFX Provider + Default-Provider Mechanism — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This is a **money-path** feature: follow CLAUDE.md iron rules — tests first, request `ledger-auditor` review before marking money tasks done, feature-flag everything, keep PRs < 400 lines, additive-only migrations.

**Goal:** Add VertoFX as a cross-border FX/payments provider behind the existing `orchestration.Provider` interface and make it the default via a config-driven preferred-with-score-fallback mechanism, all dark behind `FEATURE_VERTOFX`.

**Architecture:** Mirror the Eversend integration exactly — a low-level HTTP client in `backend/internal/provider/vertofx/` and an orchestration adapter in `backend/internal/orchestration/adapters/vertofx.go` implementing `orchestration.Provider`. Add a `defaultProvider` to the orchestration `Service` so the router prefers Verto whenever it covers the corridor, and generalize the hardcoded collection-provider strings. No Verto types leak outside `provider/vertofx`.

**Tech Stack:** Go 1.27, Gin, `net/http` + `httptest` tests, HMAC-SHA256 webhook verification, config via env.

**Spec:** [`docs/superpowers/specs/2026-10-16-vertofx-spotlight-global-design.md`](../specs/2026-10-16-vertofx-spotlight-global-design.md) · Program: [`2026-10-16-vertofx-spotlight-global-program.md`](2026-10-16-vertofx-spotlight-global-program.md)

## Global Constraints

- All monetary amounts are **int64 minor units**. Verto's API uses major units on some endpoints (as Eversend does) — convert at the adapter boundary with the existing `minorToMajor`/`majorToMinor` helper pattern (`orchestration/adapters/eversend.go:141-142`). Never float math on money.
- Idempotency: Verto `paymentId` (UUID) on trades/payouts = our transfer/quote id. Same key on retry must not double-execute.
- No Verto types in any package outside `backend/internal/provider/vertofx/`. The adapter translates to/from `orchestration` domain types only.
- Feature flag `FEATURE_VERTOFX` (default **false**); flag-off means the provider is never added to the slice and no Verto route/behavior is reachable.
- `FX_DEFAULT_PROVIDER` empty = today's pure best-score behavior (no regression); set to `vertofx` = Verto preferred.
- Follow existing adapter test pattern: `httptest.NewServer` + `New(...).WithBaseURL(srv.URL)` (`provider/maplerad/maplerad_test.go:67`); stub-provider routing pattern (`orchestration/orchestration_test.go:112`).
- No DB migration in SP-1 (default-provider is env-driven; treasury buckets are code). If a `corridors`/routing table is wanted later it is SP-5, not here.

## Review Focus

- **Token expiry mid-flow:** Verto bearer token lives 60 min with no refresh endpoint. A second request after expiry must transparently re-login (single-flight), not 401 the user's transfer. → Task 1 test.
- **Default provider errors vs no-coverage:** when the default provider *supports* a corridor but its `Quote`/execute call errors, routing must still fall back to score-ranked alternatives (preferred ≠ single point of failure); when it simply doesn't cover the corridor, fall back silently. Both paths tested. → Task 4 tests.
- **Unknown webhook signature scheme (V6):** until Verto confirms the scheme, `VerifyWebhookSignature` uses HMAC-SHA256 over the raw body (Eversend parity) AND the ingestion path must be safe if the secret is empty (reject, don't accept-all). → Task 2 + Task 6 tests.
- **Unknown/duplicate webhook event names (V7):** the parser maps all three documented vocabularies to normalized events and logs (not errors) unknown names; state transitions stay monotonic. → Task 6 test.
- **Major/minor rounding at the Verto boundary:** converting minor→major→API→minor must not lose sub-unit value or misround (customer-receives rounds down, customer-pays rounds up). → Task 2 test.

---

### Task 1: VertoFX HTTP client

**Files:**
- Create: `backend/internal/provider/vertofx/vertofx.go`
- Create: `backend/internal/provider/vertofx/vertofx_test.go`

**Interfaces:**
- Produces: `New(clientID, apiKey string, prod bool) *Client`; `(*Client).WithBaseURL(url string) *Client`; `(*Client).WithWebhookSecret(secret string) *Client`; `(*Client).GetFXRate(ctx, from, to string, amountMinor int64) (Rate, error)` where `Rate{ RatePPM int64 /*or the token+rate pair Verto returns*/, VfxToken string, ExpiresAt time.Time }`; `(*Client).CreateFXTrade(ctx, in TradeInput) (Trade, error)` (idempotent by `in.PaymentID`); `(*Client).CreateFundingDetails(ctx, companyID, currency string) (Funding, error)`; `(*Client).VerifyWebhookSignature(payload []byte, signature string) bool`; `(*Client).ParseWebhook(payload []byte) (Event, error)`. Types live in this package only.

- [ ] **Step 1: Write failing tests** in `vertofx_test.go` using `httptest.NewServer`:
  - `TestClient_GetFXRate_ParsesRateAndToken` — server returns a Verto rate+`vfxToken` body; assert parsed `Rate` fields and a 30s-ish expiry.
  - `TestClient_ReLoginAfterTokenExpiry` — first call logs in; force token `expiresAt` into the past; second call triggers exactly one re-login (count login hits on the test server == 2) and succeeds. (Covers Review Focus: token expiry.)
  - `TestClient_CreateFXTrade_SendsPaymentIDAndMarkup` — assert request body carries `paymentId` and the `fxMarkup` block passed in.
  - `TestClient_VerifyWebhookSignature_HMACSHA256` — valid signature true, tampered body false, empty secret false.
  - `TestClient_OfflineMockWhenNoKey` — `New("","",false)` returns deterministic stub data without any HTTP call (mirror `maplerad.live()`).
- [ ] **Step 2: Run tests, verify they fail**
  Run: `cd backend && go test ./internal/provider/vertofx/ -run Test -v`
  Expected: FAIL (package/functions undefined).
- [ ] **Step 3: Implement the client** in `vertofx.go`, mirroring `provider/eversend/eversend.go` (token cache + single-flight re-login; `do` with retry/backoff on idempotent calls) and `provider/maplerad/maplerad.go` (offline-mock fallback via a `live()` guard, `WithBaseURL`/`WithWebhookSecret`). Per-service base URLs behind the single `baseURL` for sandbox; auth = `POST /users/login {clientId, apiKey}` → bearer + `companyId`, cached ~50 min. Amounts stay in the client's native (likely major) units; conversion happens in the adapter (Task 2).
- [ ] **Step 4: Run tests, verify pass**
  Run: `cd backend && go test ./internal/provider/vertofx/ -v`
  Expected: PASS.
- [ ] **Step 5: Commit** — `feat(vertofx): add VertoFX http client with token cache and webhook verify`

---

### Task 2: VertoFX orchestration adapter

**Files:**
- Create: `backend/internal/orchestration/adapters/vertofx.go`
- Create: `backend/internal/orchestration/adapters/vertofx_test.go`

**Interfaces:**
- Consumes: `vertofx.Client` (Task 1); `orchestration.Provider`, `ProviderQuote`, `ExecuteResult`, `CollectionResult`, `Rail`, `AmountType`, `Quote`, `Destination`, `Money` (`orchestration/routing.go`, `domain.go`, `money.go`).
- Produces: `VertoFX` (deterministic, like `adapters.Eversend`); `VertoFXLive` (wraps `*vertofx.Client`, falls back to `VertoFX`); `NewVertoFXLive(client *vertofx.Client, webhookSecret string, prod bool) *VertoFXLive`. Both satisfy `orchestration.Provider` with `Name() == "vertofx"`.

- [ ] **Step 1: Write failing tests** in `vertofx_test.go`:
  - `var _ orchestration.Provider = (*VertoFXLive)(nil)` and `(*VertoFX)(nil)` — compile-time guard.
  - `TestVertoFX_Name` — returns `"vertofx"`.
  - `TestVertoFX_SupportsCorridors` — supports the Verto currency set (USD/EUR/GBP/NGN + the Atlas list from spec §19.4); rejects an unsupported pair.
  - `TestVertoFXLive_Quote_MinorMajorRoundTrip` — a minor-unit input produces a `ProviderQuote` whose amounts are exact after minor→major→minor (customer-receives rounds down). (Covers Review Focus: rounding.)
  - `TestVertoFXLive_VerifyWebhookSignature` — delegates to the client.
- [ ] **Step 2: Run tests, verify they fail**
  Run: `cd backend && go test ./internal/orchestration/adapters/ -run VertoFX -v`
  Expected: FAIL.
- [ ] **Step 3: Implement the adapter**, mirroring `adapters/eversend.go`: `minorToMajor`/`majorToMinor` at the boundary, supported-currency map, `Quote` via `client.GetFXRate`, `ExecuteConversion`/`ExecuteTransfer` via `client.CreateFXTrade` (passing our `paymentId`=idempotency key and the `fxMarkup` from the quote), `CreateCollection` via funding-details, HMAC `VerifyWebhookSignature`. `VertoFXLive` falls back to the deterministic `VertoFX` when the client is in offline-mock mode.
- [ ] **Step 4: Run tests, verify pass**
  Run: `cd backend && go test ./internal/orchestration/adapters/ -run VertoFX -v`
  Expected: PASS.
- [ ] **Step 5: Commit** — `feat(vertofx): add orchestration adapter implementing Provider`

---

### Task 3: Config, flag and default-provider setting

**Files:**
- Modify: `backend/internal/config/config.go` (struct fields near Eversend `:122-126`; `Load()` near `:878-881`/`:936`; validation near `:1237`)
- Modify: `backend/.env.example` (FX block near `:185-198`)
- Test: `backend/internal/config/config_test.go` (follow existing table test if present; else add one)

**Interfaces:**
- Produces: `cfg.VertoFXClientID`, `cfg.VertoFXAPIKey`, `cfg.VertoFXProd bool`, `cfg.VertoFXWebhookSecret`, `cfg.VertoFXBaseURL`, `cfg.FeatureVertoFXEnabled bool` (from `FEATURE_VERTOFX`, default false), `cfg.FXDefaultProvider string` (from `FX_DEFAULT_PROVIDER`, default `""`).

- [ ] **Step 1: Write failing test** — `TestLoad_VertoFXAndDefaultProvider`: with the VERTOFX_* + `FEATURE_VERTOFX=true` + `FX_DEFAULT_PROVIDER=vertofx` env set, `Load()` populates the fields; with them unset, `FeatureVertoFXEnabled==false` and `FXDefaultProvider==""`.
- [ ] **Step 2: Run test, verify fail** — `cd backend && go test ./internal/config/ -run VertoFX -v` → FAIL.
- [ ] **Step 3: Add the fields + `getEnv`/`getEnvBool` loads** following the Eversend pattern; add a prod-guard validation (e.g. `VERTOFX_BASE_URL` forbidden when `VERTOFX_PROD=true`, mirroring MapleRad `:1327`). Document all new vars in `.env.example`.
- [ ] **Step 4: Run test, verify pass** — → PASS.
- [ ] **Step 5: Commit** — `feat(config): add VertoFX credentials, FEATURE_VERTOFX and FX_DEFAULT_PROVIDER`

---

### Task 4: Preferred-with-fallback default-provider mechanism

**Files:**
- Modify: `backend/internal/orchestration/service.go` (`NewService` `:49`; `quoteCandidates` `:237`; `executeWithFailover` `:444`; `pickCollectionProvider` `:502-514`)
- Modify: `backend/internal/orchestration/routing.go` (selection, around `Router.Rank` `:128`) if the preference is best expressed there
- Test: `backend/internal/orchestration/orchestration_test.go` (extend; reuse `stubProvider` `:112`)

**Interfaces:**
- Consumes: existing `Provider`, `Candidate`, `Router`, `Weights`.
- Produces: `NewService(..., opts ...ServiceOption)` with `WithDefaultProvider(name string) ServiceOption` (or a `defaultProvider string` field set from `cfg.FXDefaultProvider`); behavior = **preferred-with-score-fallback**.

- [ ] **Step 1: Write failing tests** with two `stubProvider`s (`"vertofx"`, `"other"`):
  - `TestDefaultProvider_PreferredWinsWhenCovers` — default `vertofx` covers the corridor and produces a candidate → selected even when `other` scores higher.
  - `TestDefaultProvider_FallsBackWhenNoCoverage` — `vertofx` does not `Supports` the corridor → `other` selected.
  - `TestDefaultProvider_FallsBackWhenPreferredErrors` — `vertofx` supports but its `Quote`/execute errors → selection/`executeWithFailover` falls back to `other`. (Covers Review Focus.)
  - `TestDefaultProvider_EmptyKeepsBestScore` — `defaultProvider==""` → identical to today's ranking (no regression).
  - `TestPickCollectionProvider_UsesDefault` — with default `vertofx` supporting the currency, collection routes to `vertofx`; iban/unsupported still falls back to the existing `eversend`/`maplerad` choice.
- [ ] **Step 2: Run tests, verify fail** — `cd backend && go test ./internal/orchestration/ -run Default -v` and `-run Collection` → FAIL.
- [ ] **Step 3: Implement** — thread `defaultProvider` into `Service`; in candidate selection, if a candidate whose `Provider().Name()==defaultProvider` exists and can cover, return it before ranking the rest; otherwise rank as today. Keep `executeWithFailover`'s alternative-trying intact (preferred is tried first, not exclusively). Generalize `pickCollectionProvider` to try `defaultProvider` first, keeping the `iban→eversend` special-case as fallback.
- [ ] **Step 4: Run tests, verify pass** — → PASS; also `cd backend && go test ./internal/orchestration/... -count=1` to confirm no regression.
- [ ] **Step 5: Commit** — `feat(orchestration): config-driven preferred default provider with score fallback`

---

### Task 5: Wire VertoFX into orchestration startup behind the flag

**Files:**
- Modify: `backend/internal/app/finance_routes.go` (adapter build `:787-805`; providers slice `:806`; treasury buckets `:822-828`; `NewService` `:856`)

**Interfaces:**
- Consumes: `adapters.NewVertoFXLive` (Task 2), `vertofx.New` (Task 1), `cfg.*` (Task 3), `WithDefaultProvider` (Task 4).

- [ ] **Step 1: Write failing test** — `TestFinanceWiring_VertoFXRegisteredWhenFlagOn` (or the nearest existing wiring-test seam): when `FeatureVertoFXEnabled` is true the built provider slice contains a `"vertofx"` provider and the service's default is `cfg.FXDefaultProvider`; when false, no `"vertofx"` provider is present. If no wiring-test seam exists, extract the slice-building into a small testable helper `buildFXProviders(cfg) []orchestration.Provider` and test that.
- [ ] **Step 2: Run test, verify fail** → FAIL.
- [ ] **Step 3: Implement** — inside the existing `if cfg.FeatureFXOrchestrationEnabled {` block, when `cfg.FeatureVertoFXEnabled`, build the Verto client+adapter, append to the `providers` slice, seed treasury float buckets for `"vertofx"` (so it isn't scored 0-liquidity / failing `CanCover`), and pass `WithDefaultProvider(cfg.FXDefaultProvider)` to `NewService`.
- [ ] **Step 4: Verify** — `cd backend && go build ./... && go vet ./... && go test ./internal/orchestration/... ./internal/app/... -count=1`
  Expected: builds, vets clean, tests pass; flag-off path unchanged.
- [ ] **Step 5: Commit** — `feat(fx): wire VertoFX provider and default behind FEATURE_VERTOFX`

---

### Task 6: Webhook ingestion vocabulary for VertoFX

**Files:**
- Modify: `backend/internal/orchestration/webhooks.go` (`VerifyProviderWebhook` `:89`; `HandleProviderEvent` `:126`; `isCollectionEvent` `:205`; `applyCollectionEvent` `:226`)
- Test: `backend/internal/orchestration/webhooks_test.go` (add) or extend `orchestration_test.go`

**Interfaces:**
- Consumes: the `"vertofx"` adapter's `VerifyWebhookSignature` (Task 2); existing `:provider` route `POST /api/v1/fx/webhooks/:provider` (`finance_routes.go:954`) — **no new route**.

- [ ] **Step 1: Write failing tests:**
  - `TestVerifyProviderWebhook_VertoFX` — a signed Verto payload for `provider="vertofx"` verifies via the registered adapter; wrong signature rejected; empty secret rejected (not accept-all). (Review Focus: signature safety.)
  - `TestVertoFXEventMapping_AllVocabularies` — each of the three documented Verto event vocabularies (and an unknown name) maps to the correct normalized transfer/collection state (unknown → logged, no state regression; monotonic). (Review Focus: event names.)
- [ ] **Step 2: Run tests, verify fail** → FAIL.
- [ ] **Step 3: Implement** — ensure `VerifyProviderWebhook` resolves `"vertofx"` from the providers map (it already dispatches by name once Task 5 registers it); extend `isCollectionEvent` / the status mapper to recognize Verto's event names, mapping to the normalized set (`collection.requested|completed|returned`, `fx.executed|failed`, `payout.*`, `account.*`, `compliance.hold`). Until V6 is confirmed, keep the belt-and-braces GET-confirm note in a code comment referencing the program plan's gate list.
- [ ] **Step 4: Run tests, verify pass** → PASS; `cd backend && go test ./internal/orchestration/... -count=1`.
- [ ] **Step 5: Commit** — `feat(vertofx): normalize webhook events and verify signatures for :provider=vertofx`

---

## Done when
- `FEATURE_VERTOFX=true` + `FX_DEFAULT_PROVIDER=vertofx` + sandbox creds → quotes/conversions/transfers/collections route to Verto first, fall back to Eversend/MapleRad on no-coverage or error; webhooks verify and map; `go build ./... && go vet ./... && go test ./... -count=1` green; flag-off leaves existing behavior byte-identical.
- `ledger-auditor` has reviewed Tasks 4–6 (the money-routing changes) before merge.
- An `ADR-PR<pr#>-vertofx-default-provider.md` records the preferred-with-fallback choice (do not hand-pick the number).

## Deliberately NOT in SP-1
Pricing/Platform-Fee line items, commission posting, new ledger accounts, sub-account/KYB onboarding, mobile/admin UI, reconciliation — these are SP-2…SP-5 (see program plan). SP-1 ships the provider + default plumbing only, dark behind the flag.
