# Paymax Mobility / Transport — GO-LIVE Runbook

**Audience:** the human operator running the production cutover (possibly at 2am).
**Scope:** taking the 8-mode transport module from mock/dev to live real-money production.
**Companion docs:** `PRODUCTION-READINESS-AUDIT.md` (findings + fix status), `INTEGRATION-RUNBOOK.md`
(mock→live config, request-path map), `DELIVERY-INDEX.md` (where everything lives).

> This is an **ordered, executable checklist**. Do not skip a gate. Each numbered
> section must be complete and green before the next. If any gate is red, STOP and
> remediate — a partial transport cutover can strand real money in escrow.

---

## 0. Cutover principles (read first)

- **Local-first migrations.** Apply migrations locally with `supabase migration up`.
  `supabase db push` against the live project is the **LAST gate** and is performed by
  a **human DBA**, never by CI and never from a dev loop.
- **Migrations are additive-only.** There is no schema rollback. Rollback == feature
  flags OFF (see §9). Additive migrations left in place after a flags-off rollback are
  inert.
- **Money is integer kobo, double-entry, idempotent, escrowed.** Escrow releases only on
  proof of completion (PIN / proof-of-delivery / QR / customer-confirm). Any row stuck in
  `settlement_status = 'settlement_pending'` is stranded money → reconciliation required.
- **No live maps provider, no boot.** The backend now REFUSES to boot in production with
  `MockMaps`. A live provider MUST be configured before enabling transport (§5, §6).

---

## 1. Pre-flight verification gate (ALL must be green)

Run on the host, from the repo root. **Every command below must exit 0 / print clean.**
If any is red, the cutover does not proceed.

```bash
# Backend: compile, vet, formatting
cd backend && go build ./... && go vet ./... && gofmt -l internal/transport internal/maps internal/finance
#   gofmt -l must print NOTHING (any filename listed = unformatted → fix before go-live).

# Backend: money-path + transport + maps tests
cd backend && go test ./internal/transport/... ./internal/maps/... \
                      ./internal/finance/ledger/... ./internal/finance/settlement/...

# Contract: implementation vs contracts/openapi.yaml
npm run contract:check

# Mobile: full type-check (not just the scoped mobility project)
cd mobile-app/reactnative && npx tsc --noEmit
```

Gate: **backend build/vet clean, `gofmt -l` empty, all Go tests pass, `contract:check`
passes, mobile `tsc --noEmit` passes.** Do not continue on any failure.

---

## 2. Ledger-auditor review gate (money-path)

The money-path fixes for blockers #1–#3 (PRODUCTION-READINESS-AUDIT.md) MUST be signed off
by the **`ledger-auditor`** subagent before go-live. Provide the auditor these exact
review targets:

| Concern | File / function to review |
|---|---|
| **Delta-escrow idempotency** (fare-increase double-charge) | `backend/internal/transport/mobility_service.go` — the escrow-key builder; confirm the stable key `trip:<id>:delta:<newFare>` replaced `time.Now().UnixNano()` and that retries dedupe. |
| **Completion settlement crash-safety** | `backend/internal/transport/dispatch.go` + `backend/internal/transport/service.go` — `settleTrip` / `markSettlementPending`; confirm `trips.settlement_status` is flipped to `settlement_pending` before the ledger split and back to `settled` on commit, and that a failure path logs for reconciliation. |
| **Settlement engine atomicity** | `backend/internal/finance/settlement/service.go` — `Escrow` (debit + settlement-row insert on one tx, ON CONFLICT re-read) and `Settle` (provider credit + commission legs on ONE tx / one connection). |
| **Ledger advisory-lock debit** (balance TOCTOU) | `backend/internal/finance/ledger/*` — the `GetBalance`→`PostJournal` path; confirm the `FOR UPDATE` / advisory-lock guard is present so concurrent debits cannot oversell a wallet. |

Gate: **ledger-auditor returns APPROVED for all four.** Money-path tests (from §1) must
have been written first and be green.

---

## 3. Migrations — apply locally, verify, then human-DBA push

### 3a. Ordered transport migration list
Apply in timestamp order (they are additive and idempotent). The transport-relevant set:

| Order | Migration | Adds |
|---|---|---|
| 1 | `20260616290000_transport.sql` | legacy transport base |
| 2 | `20260621090000_mobility_rbac.sql` | `mobility.*` RBAC permissions (see §5) |
| 3 | `20260621100000_mobility_mode_ratings.sql` | mode ratings |
| 4 | `20260623000000_transport_mobility.sql` | ride lifecycle, fare_offers, vehicles, driver_documents, safety_incidents, trip_events, trip_ratings, trusted_contacts, mobility_profiles, transport_audit_log, seeded pricing |
| 5 | `20260624000000_transport_modes.sql` | parcels, bus_routes/schedules/tickets, towing_jobs, mover_jobs/bids, car_hire_bookings + RLS |
| 6 | `20260625000000_transport_logistics_event.sql`* | business_accounts, delivery_batches, business_deliveries, business_invoices, event_transport_offers/bookings + RLS (*file: `20260625000500_transport_logistics_event.sql`) |
| 7 | `20260625130000_mobility_ops_roles.sql` | ops role slugs |
| 8 | `20260626000000_enable_postgis.sql` | PostGIS extension |
| 9 | `20260626000100_maps_core.sql` | maps cache/usage tables |
| 10 | `20260710000000_transport_dispatch_geo_and_shares.sql` | `drivers.geog` (PostGIS geography) + GiST index + `drivers_sync_geog` trigger; `trips.settlement_status` crash marker + partial index; `trip_shares` token table + RLS |
| 11 | `20260830000000_transport_mode_idempotency_default.sql` | **NEW** — `transport_default_idempotency_key()` fn + BEFORE INSERT trigger per mode table (parcels, bus_tickets, towing_jobs, mover_jobs, car_hire_bookings, business_deliveries, event_transport_bookings): defaults a NULL `idempotency_key` to `gen_random_uuid()::text`, closing the NULL-bypass gap (audit #15). Additive: no column type/nullability change. |

### 3b. Apply locally + verify
```bash
supabase migration up          # apply all pending locally
# dev-only full replay to prove from-scratch cleanliness:
# supabase db reset
```
Verify these objects created cleanly (psql against the local DB):
- `drivers.geog` exists as `geography(Point,4326)`; index `drivers_geog_gist` is a **GiST** index; trigger `drivers_sync_geog_trg` present.
- `trips.settlement_status` exists with the CHECK constraint; partial index `trips_settlement_status_idx` present.
- Function `transport_default_idempotency_key()` exists; the 7 `*_default_idem_trg` triggers exist (one per mode table). Sanity insert with NULL key on a scratch row → row lands with a populated UUID `idempotency_key`.
- RLS enabled on every new table.

### 3c. Human-DBA production push (LAST gate)
Only after §1, §2 green and §3b verified locally:
```bash
supabase db push               # HUMAN DBA ONLY — against the live project
```
This is the point of no return for schema. Because migrations are additive, a re-run is
safe (all `IF NOT EXISTS` / `ON CONFLICT DO NOTHING` / `DROP TRIGGER IF EXISTS` guarded).

---

## 4. Environment & credentials matrix (production)

Set on the backend host before enabling any flag. Missing a required item = the module
will fail or (for maps) refuse to boot.

| Area | Variable(s) | Required value / note |
|---|---|---|
| Transport core flag | `FEATURE_TRANSPORT_ENABLED` | `true` (enabled in §7, not yet) |
| Modes flag | `FEATURE_TRANSPORT_MODES_ENABLED` | `true` (the 7 non-ride modes; enabled in §7) |
| Maps flag | `FEATURE_MAPS_ENABLED` | `true` |
| **Live maps provider** | `MAPS_PROVIDER` + provider keys | One of `google` / `here` / `osrm` / `geoapify` with its API key(s). **The backend REFUSES to boot in prod with MockMaps** — a real provider is mandatory. OSRM (self-host) needs a routing URL; Google/HERE/Geoapify need API keys. |
| Storage (driver docs) | R2 / S3 creds | `@aws-sdk/client-s3` presign; bucket for driver-document upload (KYC docs, proof photos). Driver onboarding doc upload is the R2-presign path. |
| Payments / wallet | Paystack + wallet/ledger config | Fares debit the wallet + settle through the double-entry ledger. Paystack live keys + HMAC-SHA512 webhook secret. |
| Redis | Redis URL | Idempotency cache, rate-limits, and WS pub/sub for live location/trip fan-out. Required in prod. |
| Admin gate | `ADMIN_API_KEY` | Strong secret. Empty = OPEN admin (dev only) — never empty in prod. |
| Mobility RBAC seed | migration `20260621090000_mobility_rbac.sql` | Must be applied AND `mobility.*` permissions assigned to the relevant admin roles **before** enabling admin routes, or admins can be locked out. super-admin is granted all mobility perms out of the box by the migration. |
| DB | `DATABASE_URL` | money-path pgx pool. |
| Backend port | `APP_PORT` | Per deployment. (Dev note: local dev backend is `8091`; `8080` is a decoy.) |

---

## 5. Mobility RBAC seed (before admin routes)

1. Confirm `20260621090000_mobility_rbac.sql` applied → `mobility.view`, `mobility.manage`,
   and the per-mode `mobility.<mode>.manage` slugs exist in `public.permissions`.
2. Confirm super-admin holds all `mobility` permissions (seeded by the migration).
3. Assign per-area slugs (`mobility.ride.manage`, `mobility.parcel.manage`,
   `mobility.bus.manage`, `mobility.towing.manage`, `mobility.movers.manage`,
   `mobility.event.manage`, `mobility.logistics.manage`) to Dispatch / Ops / Logistics
   admin roles via the RBAC UI. Slugs must stay in exact sync with the constants in
   `backend/internal/app/finance_routes.go`.

Gate: **at least one live operator can reach `/api/finance/admin/transport/*`** before you
enable admin traffic — verify by loading the admin Mobility console.

---

## 6. Feature-flag rollout sequence (staged, safe order)

Enable in this order, verifying at each step. Canary to internal/staff accounts first,
then a small % of traffic, then general availability.

1. **Maps** — `FEATURE_MAPS_ENABLED=true` with a LIVE provider. Confirm the backend boots
   (it will refuse if still MockMaps). Smoke: an estimate returns a real route/ETA, not a
   straight-line fabrication.
2. **Transport core (ride-hailing)** — `FEATURE_TRANSPORT_ENABLED=true`. Canary the ride
   lifecycle end-to-end (§8).
3. **Modes** — `FEATURE_TRANSPORT_MODES_ENABLED=true`. Bring the 7 modes online only after
   ride core is healthy.
4. **Admin** — expose `/api/finance/admin/transport/*` once RBAC (§5) is seeded and
   `ADMIN_API_KEY` is set.

Do NOT enable modes or admin before maps + transport core are verified green.

---

## 7. Mobile cutover

- **Build:** real maps require an **EAS / dev-client build** (react-native-maps or MapLibre).
  Expo Go is a placeholder and cannot render live maps.
- **Flip mocks only after the backend is verified** (do not flip before §1–§6):
  - `EXPO_PUBLIC_MOBILITY_USE_MOCK=false` (ride core)
  - The **8 mode flags** `EXPO_PUBLIC_*_USE_MOCK=false` (ride + the 7 modes). Flip mode
    flags in the same staged order as §6 (core first, then modes).
- Keep `EXPO_PUBLIC_API_BASE_URL` on the frontend-web gateway so calls route through the
  `/api/finance/:path*` → `GO_BACKEND_URL` rewrite (Bearer forwarded), or point directly at
  the backend.
- **Wire format:** requests are snake_case, responses are camelCase — the app must already
  parse camelCase (regression from audit #4). Verify no response field reads `undefined`.

---

## 8. Post-deploy smoke tests

Run per canary account. **Every mode** must pass its money loop before GA.

**Per mode — estimate → request → accept → complete → settle:**
- Ride-hailing: estimate → request → driver accept → arrive → PIN verify → start → complete → confirm wallet debit/escrow + driver settlement on the ledger.
- Parcel: estimate → create → courier assign → pickup PIN → in-transit → dropoff verify → delivered → settle.
- Bus: browse schedule → book seat (QR issued) → board → complete → settle.
- Towing: request → operator accept → en route → PIN → in progress → complete → settle.
- Movers: quote request → bids → accept bid → escrow funded → complete → escrow released.
- Car hire: request → quote → confirm (deposit) → active → complete → settle.
- Business logistics: batch → deliveries → assign courier → dropoff PIN → delivered → settle/invoice.
- Event transport: offer → booking (QR) → board → complete → settle.

**Cross-cutting:**
- **Driver onboarding + doc upload:** submit onboarding → upload docs (confirm R2 presign works, not the stub) → admin approve → driver can go online.
- **SOS:** trigger mid-trip → admin Safety Center shows the incident → resolve (audited).
- **Share link resolve:** rider creates a share → `GET /api/finance/mobility/public/track/:token` resolves (never leaks the trip PIN); revoke → resolve returns gone.
- **Rate + tip:** rider rates and tips → tip escrows and settles to the driver (tip errors must surface, not be swallowed) → driver earnings reflect net of commission.
- **Negotiation guard:** offer below `fare_floor_pct` / counter breaching the profit floor → both rejected `422 FARE_BELOW_FLOOR`.

Gate: **all mode loops settle cleanly; no stranded escrow; no `undefined` fields on mobile.**

---

## 9. Observability, reconciliation & rollback

### Watch (first hours + ongoing)
- **Stranded escrow — the key alarm:** rows with `settlement_status = 'settlement_pending'`
  (query `trips`; the partial index `trips_settlement_status_idx` makes this cheap). Any row
  lingering here past a short window = escrow that debited a rider/business but never
  released to the driver/provider → **reconciliation required**.
- Also watch: `settlement_status = 'settlement_failed'`; ledger imbalance alerts; maps
  provider spend/budget-guard hits; idempotency-cache errors; WS pub/sub health.

### Reconciliation job (REQUIRED)
A reconciliation / sweeper job MUST be running that finds `settlement_pending` (and
`settlement_failed`) trips and re-drives the settlement (release escrow) or flags for
manual ops. This is the safety net for the "settle after commit" crash window
(audit #2). Do not GA without it, or confirm it runs on a schedule.

### Rollback
- **There is no schema rollback** (migrations are additive). Rollback = **flags OFF** in
  reverse of §6: admin → modes → transport core → maps.
  ```
  FEATURE_TRANSPORT_MODES_ENABLED=false
  FEATURE_TRANSPORT_ENABLED=false
  ```
  Mobile: flip the `EXPO_PUBLIC_*_USE_MOCK` flags back to `true` (or ship the flags-off build).
- Flags-off stops new money mutations immediately. **Before or right after flipping flags,
  run reconciliation** so any in-flight `settlement_pending` rows are released — flags-off
  does not settle already-escrowed money.
- The additive migrations left in place are inert with flags off.

---

## 10. Known residual risks / not-done (from PRODUCTION-READINESS-AUDIT.md "Still open")

Accept these consciously before GA; they are cross-referenced from the audit's
"Still open (follow-ups)" section:

- **#7 MockMaps prod-default:** mitigated by the boot-refusal guard, but ops MUST confirm a
  live provider is configured (§4). If the guard is not present in your build, treat maps
  config as a hard manual gate.
- **#15 Mode `idempotency_key` nullable:** the column stays nullable; the new trigger
  (`20260830000000`) defaults NULL keys to a UUID at insert, closing the practical bypass.
  A genuine client key still dedupes on the existing UNIQUE.
- **#16 Ledger balance TOCTOU:** verify the `FOR UPDATE` / advisory-lock guard is in place
  (§2) — it lives in `internal/finance/ledger`, outside transport scope.
- **#18 Mobile map / realtime:** live maps need an EAS/dev-client + real map SDK; WS realtime
  is untested in the default dev config. Verify on the EAS build (§7).
- **#19 Driver onboarding doc upload:** confirm it is wired to R2 presign (not the stub) —
  smoke-tested in §8.
- **Mode booking escrows** (parcel / towing / car-hire / etc.) do **not** yet call
  `enforceTierLimit` — mode money mutations are not tier/spending-limit gated (iron rule #4
  partially unmet for modes). Decide whether to GA modes without tier limits or hold them.
- **`/maps/metrics` + `/usage`** have in-handler RBAC; an edge-level gate is optional.

---

## Go / No-Go summary

| Gate | Condition |
|---|---|
| §1 Pre-flight | build/vet/gofmt clean, all Go tests pass, `contract:check` pass, mobile `tsc` pass |
| §2 Ledger-auditor | APPROVED for delta-escrow, settlement atomicity, crash-safety, ledger lock |
| §3 Migrations | applied + verified locally; PostGIS geog/GiST + triggers clean; DBA `db push` done |
| §4–§5 Env / RBAC | live maps provider set, R2/Paystack/Redis wired, `ADMIN_API_KEY` set, `mobility.*` seeded |
| §6–§7 Rollout | flags staged maps→core→modes→admin; mobile EAS build, mocks off |
| §8 Smoke | every mode settles; SOS, share, rate+tip, onboarding pass |
| §9 Observability | reconciliation job running; `settlement_pending` alarm live; rollback path known |

**All gates GO → proceed to GA. Any NO-GO → stop and remediate.**
