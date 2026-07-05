# Transport / Mobility — Production-Readiness Audit (2026-07-03)

Consolidated from a 4-agent audit across backend transport, maps/routing, mobile,
and contract/DB/docs. The module is **feature-complete** (all 8 modes implemented
server-side; ride lifecycle end-to-end; RLS + idempotency columns present) but
**not production-safe**. Below are the blocking findings, prioritized.

## Blockers (must fix before any real-money go-live)

1. **Delta-escrow double-charges riders (non-idempotent).**
   `backend/internal/transport/mobility_service.go:192` builds the escrow key from
   `time.Now().UnixNano()`, so retries/double-taps escrow the fare increase twice.
   Fix: stable key (`<clientIdemKey>:delta` or `trip:<id>:delta:<newFare>`).

2. **Completion settlement is not crash-safe.**
   `dispatch.go:238` / `service.go:205` run `settleTrip` AFTER `tx.Commit`, outside
   any transaction. A failure after commit leaves the trip `completed` but the
   escrow never released — money stuck, no retry. Fix: settle in-tx or add an
   outbox/reconciliation job.

3. **Shared settlement engine is not atomic.**
   `backend/internal/finance/settlement/service.go`: `Escrow` posts the ledger
   debit before inserting the settlement row (no tx); `Settle`'s provider credit
   uses a different connection than the commission entries. Affects **every** fare.

4. **snake_case (backend) vs camelCase (mobile) response mismatch — the FX bug, module-wide.**
   189 snake_case json tags across `model.go` + 10 mode files. Mobile does bare
   `unwrap<T>()` casts with no transform, and **production ships all 8 modes with
   `USE_MOCK=false`** — so every response field reads `undefined` live. Plus
   envelope/shape mismatches: `getTrip`/`getActiveTrip` return `{trip,driver,vehicle,fare_offer}`
   (mobile expects flat), `getHistory` returns `{trips}`, `getActiveTrip` `{active_trip:null}`,
   `shareTrip` `{share_token}`, `acceptCounter` returns a `FareOffer` (mobile types Trip),
   `getHome` lacks wallet balance/saved places. Fix: camelCase backend response DTOs
   + a deep normalizer/envelope fixes on mobile + camelCase OpenAPI schemas.

## High

5. **No tier / spending-limit checks** on any transport money mutation (iron rule #4).
6. **Tip escrow errors swallowed** (`ratings.go:55`) — rider thinks tip sent, driver unpaid.
7. **MockMaps is the production default** if the maps provider isn't wired
   (`service.go:27`, `finance_routes.go:1270`) — fabricated straight-line fares/ETAs.
8. **Unguarded legacy endpoint** `UpdateTripStatus` (`service.go:122`, routes `finance_routes.go:1289-1294`)
   — no ownership check, no transition guard; any user can drive any trip's status/settle.
9. **Maps route/matrix/autocomplete never cached or budget-guarded** (`service_impl.go:270-397`)
   — every dispatch + every autocomplete keystroke is a fresh paid Google call.
10. **No lat/lng validation** in maps handlers — garbage coordinates hit paid providers.
11. **Driver dispatch is not PostGIS** — `dispatch.go:NearbyDrivers` full-scans online
    drivers + in-Go haversine; plain btree on `(lat,lng)`. Won't scale. PostGIS is
    already enabled (`20260626000000_enable_postgis.sql`).
12. **Ride estimate screen**: hardcoded pickup (`estimate.tsx:23`), no PaymentSheet/PIN/KYC gate.

## Medium

13. **OpenAPI covers ~9%** — 14 of ~137 transport routes in the spec; `contract:check` fails.
    Missing schemas: Driver, FareOffer, Vehicle, RideEstimate, all mode DTOs.
14. **ShareRide non-functional** — token not persisted, no resolve endpoint (`safety.go:52`).
15. **Mode `idempotency_key` nullable** — a NULL key bypasses the unique guard.
16. **Ledger balance TOCTOU race** — `GetBalance`→`PostJournal` with no `FOR UPDATE`.
17. **CacheV2/per-source TTL is dead code** — `NewServiceFromDeps` wires `NewCache`.
18. **Mobile map is an Expo Go placeholder** — needs EAS/dev-client + real map SDK; WS
    realtime untested in default dev config (ride ships mock).
19. **Driver onboarding doc upload is a stub** — not wired to R2 presign.
20. **Docs** — ✅ RESOLVED 2026-07-10: `INTEGRATION-RUNBOOK.md`/`DELIVERY-INDEX.md`
    now use local-first `supabase migration up` (db push flagged go-live-only);
    `QA-REPORT.md` carries a dated stale-scope note pointing to `QA-REPORT-MODES.md`;
    the false "103 contract paths" claim corrected to the real count (142
    mobility/driver/admin/transport + 13 maps).
21. `/maps/metrics` + `/usage` not RBAC-gated (backend follow-up). Parcel rate route
    typo — ✅ RESOLVED: backend + spec now use plural `POST /mobility/parcels/:id/rate`.

## Verification constraints

No Go toolchain in this environment — all backend changes are static-verified only
and MUST be gated on the host: `cd backend && go build ./... && go vet ./... && go test ./internal/transport/... ./internal/maps/...`.
Money-path changes (blockers 1–3, 5, 6) additionally require `ledger-auditor` review
and money-path tests written first. Migrations apply locally (`supabase migration up`), never `db push`.

## Swarm remediation status (2026-07-03)

A 4-agent fix swarm addressed the findings. Status:

**Resolved (static-verified, pending host build/test):**
- #1 Delta-escrow: stable idempotency key `trip:<id>:delta:<newFare>` (`mobility_service.go`).
- #2 Completion settlement: `markSettlementPending` marker + `trips.settlement_status` + ERROR log for reconciliation (`dispatch.go`, `service.go`).
- #3 Settlement engine: `Escrow` debit+insert made crash-safe (ON CONFLICT + re-read); `Settle` posts all legs on one tx (`settlement/service.go`). **Ledger-auditor review required.**
- #4 Wire format: all transport response DTOs → camelCase; mobile envelope/shape fixes (getTrip/getActiveTrip/getHistory/getTrustedContacts/shareTrip/acceptCounter/getHome); OpenAPI schemas camelCase.
- #5 Tier gate: `enforceTierLimit` on ride request/counter/tip (mode bookings still TODO).
- #6 Tip errors surfaced (`ratings.go`, `mode_ratings.go`).
- #8 Unguarded legacy `/transport/trips` money routes removed; `UpdateTripStatus` hardened defensively.
- #9/#10 Maps: budget-guard + short-TTL cache on route/matrix/autocomplete; lat/lng validation on all coord handlers.
- #11 Driver dispatch → PostGIS `ST_DWithin` on new `drivers.geog` GiST column (`dispatch.go` + migration `20260710000000`).
- #12 Ride estimate: real current-location pickup + `AddressEntry` + PaymentSheet gating.
- #13 OpenAPI backfilled (390 paths, 173 schemas, 0 dangling refs; also fixed a pre-existing schemas-under-`paths:` structural bug).
- #14 ShareRide persisted + public resolve `GET /mobility/public/track/:token`.
- #17 CacheV2 + per-source TTL wired.
- #20/#21 Docs local-first; parcel route plural; maps metrics/usage RBAC-gated in-handler.

**Closed in wave 2 (static-verified, pending host build/test):**
- #7 MockMaps prod-default: `cfg.IsProd()` boot-refusal added (dev/offline keep MockMaps).
- #15 Mode `idempotency_key`: additive BEFORE INSERT trigger defaults NULL→`gen_random_uuid()` (migration `20260830000000`).
- #16 Ledger TOCTOU: `DebitWithBalanceCheck` — advisory-lock (`pg_advisory_xact_lock`, `wallet:<userID>` namespace matching transfers) + in-tx balance re-check + `ON CONFLICT` inserts. **Ledger-auditor review required.**
- #18 Mobile map: Expo Go fallback upgraded to a real Leaflet/OSM WebView map (pins + route); MapLibre GL already wired for dev-client builds.
- #19 Driver doc upload: mobile wired to R2 presign; backend `POST /driver/documents/presign` endpoint added (`transport/presign.go`).
- Tier gate now on ALL mode booking escrows (parcel/towing/movers/car-hire/bus/logistics/event) + legacy RequestTrip.
- Money-path + authz tests added (transport `money_authz_test.go`; ledger `toctou_test.go`; settlement `split_invariant_test.go`).
- `ExtendCarHire`: reviewed — NOT a double-charge (uses client `idempotencyKey` as the escrow key; the `UnixNano` is only the descriptive ref).

**Still open (require host / infra, cannot be done in this environment):**
- HOST VERIFICATION GATE (below) — nothing is "done" until it's green.
- `ledger-auditor` review of the money-path changes.
- Live provider creds (maps, Paystack, R2), Redis, mobility RBAC seed — ops setup (see GO-LIVE.md).
- Mobile EAS/dev-client build for the interactive GL map; end-to-end WS realtime test.
- `/maps/metrics`+`/usage` route-level RBAC (in-handler guard present; edge gate optional).
- `Service.Credit`/`Refund` could gain the same `ON CONFLICT` treatment as `Debit` (auditor note).

**HOST VERIFICATION GATE (run before merge):**
```
cd backend && go build ./... && go vet ./... && gofmt -l internal/transport internal/maps
cd backend && go test ./internal/transport/... ./internal/maps/... ./internal/finance/settlement/...
supabase migration up            # applies 20260710000000_transport_dispatch_geo_and_shares.sql locally
npm run contract:check           # openapi vs implementation
cd mobile-app/reactnative && npx tsc --noEmit
```
Money-path (blockers 1–3,5,6): `ledger-auditor` review + money-path tests before go-live.
