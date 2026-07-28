# Referral + Stays Integration — Handoff & Verification Checklist

**Date:** 2026-07-06

**Update (2026-07-06): Go 1.25.0 toolchain was installed in the cowork sandbox
and the backend now COMPILES + VETS + unit-tests here.** Verified:
- `go build -buildvcs=false ./...` → **exit 0** (whole backend, incl. the referral
  withdraw endpoint, route wiring, and stays reservation enrichment).
- `go vet ./internal/referral/ledger/... ./internal/stays/reservation/... ./internal/app/...` → **exit 0**.
- `go test ./internal/referral/ledger/...` → **ok** (withdraw validation tests pass).

**Update 2 (2026-07-06): local Postgres installed (pgserver, rootless) and the
referral withdraw money-path is DB-VERIFIED here.**
- `go test -run Integration ./internal/referral/ledger/...` (with a migrated local
  PG) → **PASS**: eligible→wallet sweep, balanced double-entry (wallet credited ==
  swept), idempotent replay (no double-credit), fail-closed KYC gate. Harness +
  reproducible steps in `docs/local-postgres-testing.md`.
- **Discovery endpoint #1 shipped:** `GET /api/finance/stays/destinations?q=`
  (`internal/stays/discovery/discovery.go`, registered in `stays_routes.go`;
  frontend `searchDestinations` wired). `go build`/`go vet` clean; the SQL was
  validated against seeded rows in the local PG.
- **Blocker found:** the **stays** schema uses **PostGIS** (`geometry`/`ST_Y`),
  which isn't installable rootless — so `stays_property` et al. don't migrate in
  the sandbox and the stays booking saga can't be DB-tested here. Needs a PostGIS-
  enabled Postgres (real Supabase or a postgis Docker image) to exercise live.

Still requires a Postgres/test DB (not present) for: integration tests, and the
live prebook/book saga + concurrent-withdraw behaviour. TypeScript is type-checked.
To reuse the toolchain in a later sandbox call: `source ~/goenv.sh` (installs Go
env + a `gob` = `go build -buildvcs=false` alias). Note `-buildvcs=false` is
needed because the repo's git ownership isn't readable from the sandbox.

---

## 1. What shipped (and where)

### Referral
- **frontend-web Earn page** (live, no mock): `app/earn/page.tsx`,
  `src/components/referral/EarnClient.tsx`, `src/lib/referral/{api,format}.ts`
  → Direct Rewards engine `/api/v1/referrals/*`.
- **Mobile — all 10 modules** backend-driven or safe-stubbed
  (`src/features/referral/*/api.ts`). Money mutations with no backend throw; no
  screen 404s when `EXPO_PUBLIC_REFERRAL_USE_MOCK=false`.
- **New money-path endpoint** `POST /api/finance/referral/withdraw`
  (`backend/internal/referral/ledger/{service,handlers}.go`,
  `backend/internal/app/referral_routes.go`, spec in `contracts/openapi.yaml`,
  unit test `ledger/withdraw_test.go`). Sweeps eligible→wallet reusing the
  audited `Transition(→paid)` primitive; Idempotency-Key + double-entry + audit
  event + KYC gate + per-user advisory lock.

### Stays
- **Mobile booking saga** wired live via an adapter (composite supplier key
  encoded into opaque ids; `{data}` envelope unwrapped):
  `src/features/stays/{api,trips,reviews}.ts` — search, property content, rooms,
  prebook, book, reservations, cancel/modify, reviews. `agent.ts` + discovery
  kept as flagged fallbacks.
- **Reservation content-enrichment** (backend, additive, no migration):
  `internal/stays/reservation/handler.go` + `internal/app/stays_routes.go` —
  List/Get/Cancel/Modify now attach a best-effort `content` block via
  `searchSvc.GetContent`. Frontend reads it in `api.ts`/`trips.ts`.

---

## 2. Verification steps (run locally)

```bash
# Backend compiles + vets (covers withdraw + stays enrichment)
cd backend && go build ./... && go vet ./...

# Referral withdraw unit test (pure-logic; no DB needed)
go test ./internal/referral/ledger/...

# Frontend-web type-check (Earn page)
cd ../frontend-web && npx tsc --noEmit

# Mobile type-check (referral + stays)
cd ../mobile-app/reactnative && npx tsc -p tsconfig.json --noEmit

# OpenAPI stays valid
python3 -c "import yaml; yaml.safe_load(open('contracts/openapi.yaml'))"
```

### Env to run the sagas live
- `FEATURE_REFERRALS_ENABLED=true`, `FEATURE_STAYS_ENABLED=true`
- `GO_BACKEND_URL` → the real backend (**port 8091** per project notes; 8080 is a
  decoy)
- Mobile: `EXPO_PUBLIC_REFERRAL_USE_MOCK=false`, `EXPO_PUBLIC_STAYS_USE_MOCK=false`
- Stays supplier creds: `STAYS_BEDBANK_*` (see `stays_routes.go`)

---

## 3. Risks to specifically test (human review)

1. **Referral withdraw — `ledger-auditor` pass required.** The pay primitive
   `Transition` posts the wallet credit BEFORE the guarded state flip. The new
   withdraw serializes per-user with a `pg_advisory_lock` to prevent a concurrent
   double-credit — verify that reasoning, and consider reordering the primitive
   (flip-then-credit) as hardening. Test: two concurrent withdraws for one user;
   assert one credit, exactly-once.
2. **Stays prebook/book field semantics — money path.** The adapter sends the
   supplier refs as `property_id/room_type_id/rate_plan_id`. If the gateway needs
   the INTERNAL mapped ids for mapped (bedbank) supply, thread
   `offer.mapped_property_id` in `src/features/stays/api.ts` `prebook()`. Test the
   full search→prebook→book→confirm and the auto-release (409 `state=VOID`) path;
   assert the wallet HOLD is released with no net debit on supplier failure.
3. **Reservation enrichment assumption.** Enrichment keys on
   `reservation.PropertyID == supplier_property_ref`. Confirm prebook persists the
   supplier ref there (true for this adapter). Bookings created by other clients
   with an internal id resolve to no `content` (graceful).

---

## 4. Remaining backend backlog (net-new; do where Go builds)

Prioritised, each = spec (`openapi.yaml`) → additive migration (if needed) →
handler → tests → wire frontend → flip flag.

**Referral:** member `earnings` per-row ledger/vesting/catalog/currency/statement/
clawback-appeal; `invite` (contacts match, vanity/UTM, tracking channel);
member `merchant` zone; ambassador payouts/analytics/creatives; agent
onboarding/training/leaderboard; `roles`; `notifications`.

**Stays:** discovery — `home`, `deals`, `destinations` (could seed from distinct
cities in the direct-inventory + mapping tables), `nearby` (add lat/lng reading to
the existing search handler — the gateway model already carries it), `saved`/
wishlist, `addons` catalogue, stays `profile`, `loyalty`, `saved-guests`;
agent-assisted flow (`/agent/*`); room/rate content embedding for richer trips;
cancel/modify refund PREVIEW + refund status.

All corresponding frontend call sites already exist with `TODO(...)` markers and
safe fallbacks — wiring them is a path/shape swap once the endpoint lands.
