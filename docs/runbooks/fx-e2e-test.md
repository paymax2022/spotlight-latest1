# FX exchange — real end-to-end test runbook

Purpose: run the mobile FX exchange against the **real Go backend** (Maplerad
sandbox) instead of in-app mocks, and verify the full path
`mobile → frontend-web proxy → Go orchestration → Maplerad`.

## Request path

```
Expo app (:8081)
  └─ api client, base = EXPO_PUBLIC_API_BASE_URL (http://localhost:3000)
       └─ GET/POST /api/v1/fx/*
            └─ frontend-web catch-all proxy  app/api/v1/fx/[...path]/route.ts
                 · gate: featureFlags.fx() = FEATURE_FX_ENABLED
                 · auth: requireRequestUser() (Supabase), forwards Authorization + Idempotency-Key
                 └─ proxyToGoBackend → GO_BACKEND_URL (default http://localhost:8080) /api/v1/fx/*
                      └─ Go FX orchestration handler (gated by FEATURE_FX_ORCHESTRATION_ENABLED)
                           · auth: RequireAuthContext → user_id, then requireUserID()
                           └─ Maplerad LIVE adapter (MAPLERAD_SECRET_KEY set, MAPLERAD_PROD=false)
```

## Env matrix (what makes it "real")

| Layer | Var | Value | File | Status |
|---|---|---|---|---|
| mobile | `EXPO_PUBLIC_FX_USE_MOCK` | `false` | `mobile-app/reactnative/.env` | set |
| mobile | `EXPO_PUBLIC_API_BASE_URL` | `http://localhost:3000` | same | already |
| frontend-web | `FEATURE_FX_ENABLED` | `true` | `frontend-web/.env.local` | set |
| frontend-web | `GO_BACKEND_URL` | `http://localhost:8080` (default) | env / default | default OK |
| backend | `FEATURE_FX_ORCHESTRATION_ENABLED` | `true` | `backend/.env` | already |
| backend | `MAPLERAD_SECRET_KEY` | `mpr_sandbo…` | `backend/.env` | already |
| backend | `MAPLERAD_PROD` | `false` | `backend/.env` | already (sandbox) |

With no `MAPLERAD_SECRET_KEY` the backend falls back to a deterministic
(non-network) adapter, so the corridor still resolves — but this runbook uses the
live sandbox key that is already present.

## Start sequence

0. **Migration (LOCAL Supabase)** — create the beneficiary/rate-alert tables.
   Supabase here is the local CLI stack (no linked cloud project), so apply
   migrations locally — do NOT use `supabase db push` (that targets a linked
   remote and is reserved for human-DBA go-live):
   ```bash
   supabase start            # if the local stack isn't already up (db on :54322)
   supabase migration up      # apply pending migrations to the LOCAL db
   # or, to replay every migration from scratch (destroys local data):
   # supabase db reset
   ```

1. **Backend (Go)** — needs a Go toolchain (not available in this sandbox):
   ```bash
   cd backend
   go build ./...          # compile check — MUST pass (see "code change" below)
   go run ./cmd/api        # or the project's usual entrypoint; serves :8080
   ```
   Expect log line: `[finance] FX orchestration routes registered at /api/v1/fx`.
   Requires the pgx pool (Postgres/Supabase) up; quote lifecycle uses Redis when
   present, else in-memory.

2. **frontend-web (proxy)**:
   ```bash
   cd frontend-web && npm run dev    # :3000
   ```

3. **Expo app**:
   ```bash
   cd mobile-app/reactnative && npx expo start --web   # :8081
   ```
   Sign in so the api client attaches a valid Supabase bearer token.

## Code changes made for this test (needs `go build`)

1. **Auth mirror** — `backend/internal/app/finance_routes.go`: the `/api/v1/fx`
   group applied only `requireUserID()` with no middleware to populate `user_id`,
   so every call would have returned **401 "authentication required"** even with a
   valid token (the same bug the base finance group documents). Added the auth
   mirror before it:

   ```go
   og := r.Group("/api/v1/fx")
   og.Use(mapsAuth())      // RequireAuthContext → sets user_id
   og.Use(requireUserID()) // fail-closed
   ```

2. **Secondary routes + persistence** — new files in
   `backend/internal/orchestration/`:
   - `handler_stubs.go` — add-wallet, rates/history, transfer-by-ref, collections
     list, dispute (contract-shaped, not persisted).
   - `handler_secondary.go` + `secondary_store.go` — beneficiaries + rate-alerts,
     persistence-backed (pgx, customer-scoped), wired via
     `NewHandler(svc).WithSecondary(NewSecondaryStore(pool))`.
   - `handler_cards.go` — FX virtual-card stubs.
   - migration `supabase/migrations/20260826000000_fx_beneficiaries_rate_alerts.sql`
     (additive: `orch_beneficiaries`, `orch_rate_alerts`).

Verify with `cd backend && go build ./...` and `go vet ./...` before running.

3. **Spec + ADR** — all 34 `/api/v1/fx` routes are now in
   `contracts/openapi.yaml` (run `npm run contract:check`). Design rationale for
   the persist-vs-stub split is in `docs/adr/ADR-015-fx-mobile-backend-reconciliation.md`.

## Manual test path (core exchange — fully backed)

1. Open the FX / exchange screen. It calls **`GET /api/v1/fx/rates`** and
   **`GET /api/v1/fx/balances`** on load.
2. Enter an amount + currency pair → **`POST /api/v1/fx/quotes`** returns a quote
   (rate, fees, expiry ~90s).
3. Confirm → **`POST /api/v1/fx/quotes/:id/lock`** locks the rate.
4. Execute → **`POST /api/v1/fx/conversions`** (carries `Idempotency-Key`) debits
   source, credits target via the ledger.
5. History → **`GET /api/v1/fx/transactions`** and
   **`GET /api/v1/fx/transactions/:id`**.

Watch the Go logs and the browser Network tab: requests should hit
`localhost:3000/api/v1/fx/*` → `localhost:8080/api/v1/fx/*` with `200`s, not the
400ms mock delay.

## Endpoint reconciliation (mobile ↔ backend orchestration)

Backed (safe to exercise in real mode):

| Mobile call | Backend route |
|---|---|
| `GET /rates` | `GET /rates` |
| `POST /quotes` | `POST /quotes` |
| `POST /quotes/:id/lock` | `POST /quotes/:id/lock` |
| `POST /conversions` | `POST /conversions` |
| `POST /transfers` | `POST /transfers` |
| `POST /collections/virtual-accounts` | `POST /collections/virtual-accounts` |
| `GET /balances` | `GET /balances` |
| `GET /transactions` | `GET /transactions` |
| `GET /transactions/:id` | `GET /transactions/:id` |

**Persistence-backed** (real, survives reload; `handler_secondary.go` +
`secondary_store.go`, tables from migration `20260826000000`):

| Mobile call | Storage |
|---|---|
| `GET/POST /beneficiaries`, `PUT/PATCH/DELETE /beneficiaries/:id` | `orch_beneficiaries` (customer-scoped) |
| `POST /beneficiaries/validate` | rail-shape check (no persistence needed) |
| `GET/POST /rate-alerts`, `DELETE /rate-alerts/:id` | `orch_rate_alerts` (customer-scoped) |

Run `supabase migration up` (local) before testing so these tables exist — see
step 0. If the pool is nil these handlers fall back to stub behaviour.

**Stubbed — contract-shaped, NOT persisted** (won't 404; render the screens but
store nothing; `handler_stubs.go` + `handler_cards.go`):

| Mobile call | Stub behaviour |
|---|---|
| `POST /balances` (add wallet) | returns a zero-balance wallet for the currency (provisioning only, no ledger) |
| `GET /rates/history` | deterministic indicative series for the chart (display-only) |
| `GET /transfers/:reference` | echoes the reference in a schema-complete `processing` Transfer (status not tracked) |
| `GET /collections`, `GET /collections/virtual-accounts` | empty list |
| `POST /transactions/:id/dispute` | echoes a `submitted` dispute |
| `GET/POST /cards`, `GET /cards/:id`, `.../reveal|fund|freeze|unfreeze|terminate`, `PATCH .../controls`, `GET .../transactions` | contract-shaped placeholder cards; list/transactions empty; no issuer wired |

Every call is routed by the single `EXPO_PUBLIC_FX_USE_MOCK=false` flag. The core
exchange + beneficiaries + rate-alerts are now real; the remaining stubs prevent
404s but don't persist. Card funding is money-path — when a real issuer lands the
fund handler MUST add idempotency + double-entry per the iron rules, at which
point delete the matching stub.

## Revert to mock

Set `EXPO_PUBLIC_FX_USE_MOCK=true` (or remove the line) in
`mobile-app/reactnative/.env` and restart Expo.
