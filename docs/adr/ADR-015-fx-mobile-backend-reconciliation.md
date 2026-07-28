# ADR-015 — FX mobile↔backend reconciliation (real exchange, staged secondary features)

**Status:** Accepted · **Date:** 2026-07-02 · **Scope:** brownfield, additive
**Module:** `internal/orchestration` (FX) · **API:** `/api/v1/fx/*`

## Context

The mobile FX module (`mobile-app/reactnative/src/features/fx`) was written mock-first
against a full V1 contract (exchange, beneficiaries, rate alerts, collections,
disputes, virtual cards). A single flag, `EXPO_PUBLIC_FX_USE_MOCK`, governs the
whole feature. The Go backend (`internal/orchestration`) implemented only the core
exchange path. Flipping the flag to `false` to test the real Maplerad-backed
exchange therefore routed ~14 additional endpoints at a backend that returned 404,
breaking the screens.

Auditing mobile calls against the backend router surfaced three problems:

1. A **latent auth bug**: the `/api/v1/fx` group applied only `requireUserID()`
   with no middleware to populate `user_id`, so every authenticated call would
   have 401'd even with a valid token — the same bug the base finance group
   already documents.
2. **Path/verb gaps**: mobile calls (`POST /balances`, `GET /rates/history`,
   `GET /transfers/{ref}`, beneficiaries, rate-alerts, disputes, collections list,
   cards) had no backend route.
3. **No single source of truth alignment**: none of these were in
   `contracts/openapi.yaml`, which `npm run contract:check` enforces.

## Decision

1. **Fix the auth mirror.** `/api/v1/fx` now applies `mapsAuth()`
   (`RequireAuthContext` → sets `user_id`) before `requireUserID()`, matching every
   other authenticated group. This unblocks the entire FX surface.

2. **Tier the secondary endpoints by data criticality, not by "stub everything".**
   - **Persist** the features users expect to survive a reload and that carry no
     issuer/provider dependency: **beneficiaries** and **rate alerts**. New
     pgx-backed store (`secondary_store.go`) + tables `orch_beneficiaries`,
     `orch_rate_alerts` (migration `20260826000000`, additive-only). Every query is
     scoped to `customer_id` for object-level authZ. Handlers degrade to stub
     behaviour when the pool is nil (`Handler.WithSecondary`).
   - **Stub** (contract-shaped, non-persistent) the features that depend on wiring
     we don't have yet, or that are read-through views: add-wallet, rate-history,
     transfer-by-reference, collections list, disputes, and the entire **virtual
     cards** vertical. These return well-formed responses so the UI renders, but
     store nothing. Each stub carries an in-code TODO to delete it when the real
     feature lands.

3. **Money-path features stay stubbed until they can be done correctly.** Card
   **funding** moves value, so it is deliberately left as a stub — the real handler
   must require an `Idempotency-Key` and post balanced double-entry ledger rows per
   the iron rules. A convenient-but-unsafe funding endpoint is worse than none.

4. **Spec is the source of truth.** All 34 `/api/v1/fx` routes (core + secondary +
   cards) are now in `contracts/openapi.yaml` with component schemas, so
   `contract:check` passes and the mobile/back-end contract is auditable.

## Consequences

- Flipping `EXPO_PUBLIC_FX_USE_MOCK=false` (plus `FEATURE_FX_ENABLED=true` on
  frontend-web and `FEATURE_FX_ORCHESTRATION_ENABLED=true` + `MAPLERAD_SECRET_KEY`
  on the backend) exercises the **real** exchange end to end, with beneficiaries and
  rate alerts persisted and the remaining features gracefully stubbed. See
  `docs/runbooks/fx-e2e-test.md`.
- The single-flag design means stubs are load-bearing: they prevent 404s while the
  backend catches up. The trade-off is that a stubbed create (e.g. a card) won't
  survive reload; this is documented in the runbook and the mobile `.env`.
- **Follow-ups:** (a) replace card stubs with a provider-backed issuer service +
  store (funding = money-path); (b) collections list + transfer-by-reference should
  read from `orch_collections` / `orch_transfers` rather than synthesize; (c) add
  handler tests for the secondary store (authZ scoping, not-found on cross-customer
  update) once a store interface/fake is introduced.

## Addendum (2026-07-02) — canonical wire format is camelCase

Flipping to real mode surfaced a systemic mismatch: the Go orchestration domain
types serialized **snake_case** (`all_in_rate`, `amount_type`, `expires_at`,
`quoted_rate`, `status_history`, `created_at`, `provider_ref`, `transaction_id`),
while the mobile — the **sole consumer** of `/api/v1/fx` — codes against camelCase
and does `unwrap<T>()` with no transform. Every multi-word field on every real FX
response was therefore read as `undefined` (e.g. the lock countdown from
`expiresAt`). It went unnoticed because the app had only ever run in mock mode.

**Decision:** camelCase is the canonical `/api/v1/fx` wire format (the mobile
`fx.types.ts`, labelled "source of truth … Backend role owns this file", is
camelCase). Changed the json tags on `domain.go` (Quote, Conversion, Transfer,
VirtualAccount, Alternative), `store.go` (TxView), `errors.go` (APIError), the
`QuoteRequest` inbound binding (`amountType`, `destinationRail` — the mobile sends
these camelCase), and the OpenAPI FX schemas. Inbound bodies the mobile sends
snake_case (`quote_id`, `beneficiary_id`) are left as-is. DB columns are unaffected
(SQL uses explicit column names, not json tags). Guarded by `domain_json_test.go`.

Residual (tracked in the readiness checklist): the Go `Transfer` has no
`beneficiary` field the mobile expects, and `VirtualAccount.details` map keys
should be verified camelCase.

## Alternatives considered

- **Stub everything (including beneficiaries/rate-alerts).** Rejected: these have
  no external dependency and users expect them to persist; stubbing would ship a
  visibly broken experience.
- **Per-sub-feature mock flags on mobile.** Rejected for now: more surface area and
  config drift; the backend stub-or-persist split achieves the same "no 404s"
  outcome with the contract centralized server-side. Revisit if teams want to demo
  subsets independently.
- **Block the flag flip until the whole surface is real.** Rejected: would stall
  validation of the core exchange (the actual goal) behind unrelated features.
