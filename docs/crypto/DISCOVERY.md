# Crypto trading — Phase 0 discovery

Evidence is file paths on `origin/main` (46ee5e8dc). Written before any implementation, per the brownfield spec.

## Conventions I will follow

**Go backend**
- Module `spotlight/backend`, Go 1.27, **Gin** (not chi) — `backend/go.mod`. Routes are mounted in `backend/internal/app/*_routes.go` behind `FEATURE_*` flags (`finance_routes.go:3209` for crypto).
- Money: integer kobo in the finance ledger (`backend/internal/finance/ledger/service.go:157`). `shopspring/decimal` is **not** in `go.mod`; the crypto module today uses `math/big` (`crypto/model.go` `unitsForCash`/`cashForUnits`). The spec's decimal-string API is therefore a deviation to decide (ASK 6).
- Auth: `RequireAuthContext` + `RequirePermission` (`crypto/handler.go:240-296`); permissions `crypto.view|trade|admin`.
- Idempotency: `Idempotency-Key` header on every money mutation (`crypto/handler.go:85`); ledger keys are deterministic strings (`ledger.Service.Debit(..., reference, idempotencyKey, ...)`).
- Webhooks: pattern to copy is `backend/internal/provider/paystack/paystack.go` (HMAC verify) with a dedupe table. Crypto's current webhook is `crypto/onchain.go` (static secret, latest-wins) — not reusable as-is.
- Migrations: `supabase/migrations/<yyyymmddhhmmss>_<slug>.sql`, additive only, version uniqueness enforced by `scripts/ci/check-migration-versions.sh` (602 versions, all unique at this commit).
- Tests: `_test.go` pure unit tests plus `_live_db_test.go` gated on `TEST_DATABASE_URL`; CI in `ci.yml` and per-module lanes.
- ADRs: `docs/adr/ADR-PR<n>-<slug>.md`, numbered on merge.
- Feature flags: `FEATURE_CRYPTO_ENABLED` (`config.go:940`, default false) plus per-capability envs.

**React Native / Next.js**
- Mobile API layer is `src/features/*/api` over one axios client (`src/api/client.ts`) that attaches the Supabase bearer token; mock vs live via `src/config/mockPolicy.ts` (staging/prod are mockless).
- Money display is server-formatted; the app does no money maths.
- Admin is `frontend-admin` (Next 15, `app/admin/...`), calling the Go API through a proxy.

## Things I will reuse

- **NGN wallet/ledger**: `backend/internal/finance/ledger` — `Debit`, `DebitWithGuard`, `PostJournal`, `PostReversal`, `Posted` (idempotent replay check). Balanced double-entry and immutable entries already exist.
- **Tier gate**: `crypto/tier_gate` interface + the platform tier model (`crypto/service.go:29,101`), fail-closed on nil.
- **Quidax adapter**: the existing `quidaxProvider` (`crypto/provider.go:162-286`) is the starting point, but it covers only ticker and withdrawal. It must be extended to the full capability set.
- **Swap atomicity**: the cash-then-holding ordering and `verifySwapLeg` identity check in `crypto/service_ext.go:189-199` and its live-DB tests.
- **Withdrawal FSM and approval queue**: `crypto/model.go:320-344`, `admin_service.go`.
- **Notifications and push**: existing service (to locate in Phase 1 — not yet mapped).
- **Audit log**: `crypto_audit_log` (existing).

## Gaps found on this commit (from the prior audit, verified)

- No provider order is placed on buy/sell; no deposit crediting; withdrawal confirmation has no provider-driven path (`crypto/service.go`, `handler_ext.go:275`).
- Custody webhook is a static-secret stub (`crypto/onchain.go`).
- A standalone trading service exists at `mobile-app/reactnative/backend` but is not used by any build (see prior audit).

## Open questions (ASK) — blocking Phase 1

1. **NGN to Quidax funding**: prefunded float at Quidax, or a virtual account per user? Who bears settlement risk? (spec §5, §17.1)
2. **Custody**: one Quidax sub-account per user acceptable to compliance? (spec §3.3, §17.2)
3. **KYC tier mapping and per-tier limits** — the platform already has tiers; confirm the mapping (spec §8.2, §17.3).
4. **Ledger holds/liens**: the ledger has no hold primitive (only `Debit`/`PostJournal`). Use a `crypto_clearing` account (recommended) or add a lien primitive? (spec §5, §17.4)
5. **Two-person approval threshold** for withdrawals (spec §11, §17.5).
6. **Decimal type**: adopt `shopspring/decimal` (new dependency) or keep integer minor units with `math/big` as the codebase does today? The spec's "decimal strings in APIs" conflicts with the kobo convention in CLAUDE.md.
7. **Strategy service runtime**: LEAN needs .NET, or a lighter Python backtester? Market data source for backtests? (spec §3.1, §17.6)
8. **Launch assets/markets** (spec §17.7).
9. **Fee model**: markup bps per pair/tier; per-order fee on spot? (spec §17.8)
10. **Legal and compliance sign-off owner and go-live date** (spec §17.10). Crypto for Nigerian users has SEC/CBN/NDPA implications; this must be signed off before any production enablement.

## Verified facts I need from the sandbox before go-live (spec §4 checklist)
Not yet verified — requires Quidax sandbox credentials, which I do not have. Recorded as pending.

## Recommended next step
Owner answers ASK items 1, 2, 4, 6 at minimum (they change the schema and money flow). Phase 1 (provider abstraction, mock, Quidax adapter, migrations, reconciler) can start in parallel with the rest, behind `CRYPTO_TRADING_ENABLED=false`.
