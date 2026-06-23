# Paymax Mobility — QA & Verification Report (ride-hailing vertical)

Date: 2026-06-20 · Scope: ride-hailing end-to-end (backend + mobile + admin), built on existing auth/wallet/settlement.

## Verification status
| Layer | Check | Result |
|---|---|---|
| Mobile (RN) | `npx tsc --noEmit -p tsconfig.mobility.json` | ✅ exit 0, 0 errors in mobility module |
| Admin (Next 15) | `npm run type-check` | ✅ exit 0, 0 errors; existing build untouched |
| Backend (Go) | `go build ./...` / `go vet ./...` | ⚠️ Not runnable in this sandbox (no Go toolchain + no network). Code passed a full manual compile-review: cross-file calls resolved, imports all used, route wiring matches handler signatures, pgx scan/encode types validated, settlements `provider_kobo`/`fee_kobo` columns confirmed present. **Run `cd backend && go build ./... && go vet ./... && go test ./internal/transport/...` on the host to confirm.** |
| Backend logic | DB-free unit tests (`mobility_engine_test.go`) | ✅ Authored — fare engine, range guard, driver-profit floor, state machine, mock maps, commission integrity. Run with `go test`. |

## Acceptance criteria → coverage (PRD `acceptance.md`)

Ride-hailing
- Request a ride — `POST /mobility/rides/request` (escrows fare, idempotency key). ✅
- Choose instant or offer fare — `pricing_mode` instant|offer; offer validated to range. ✅
- Driver accepts or counters — `POST /driver/requests/:id/accept` · `/counter`. ✅
- **System blocks fare below configured floor** — `enforceDriverProfitFloor` + `validateFareInRange` return 422 `FARE_BELOW_FLOOR`; covered by `TestEnforceDriverProfitFloor`, `TestValidateFareInRange`. ✅
- Track driver — `GET /mobility/rides/:id` (driver + vehicle + phase). ✅
- Trip PIN required before start — `verify-pin` gate: `driver_arriving → pin_verified` only on PIN match (`CodePinMismatch`). ✅
- Share trip / SOS — `POST /mobility/rides/:id/share` · `/sos` (creates `SafetyIncident`, trip→safety_hold). ✅
- Payment completes + driver earnings — settlement split on `complete` via existing ledger; tips settle 100% to driver. ✅
- Receipt + rating — `POST /mobility/rides/:id/rate` (bidirectional + tip; recomputes rating). ✅

Driver app
- Onboard → upload docs → admin approves → go online → accept jobs → earnings/payout. ✅ (`/driver/onboarding/submit`, `/documents`, `/vehicle`; admin `PATCH /drivers/:id/verification`; approved-only `PATCH /driver/status`; `/driver/earnings`).

Admin
- Configure prices/commissions — `PATCH /admin/transport/pricing` · `/commission/:tier` (audited). ✅
- Approve drivers/vehicles — guarded verification transition + vehicle compliance (audited). ✅
- Monitor live trips — `GET /admin/transport/dispatch/live` (active trips + online drivers + SOS flags) + manual assign. ✅
- Reports + **all actions audited** — `transport_audit_log` written on every admin mutation; `GET /audit`. ✅

## Security / integrity invariants checked
- Money is integer kobo end-to-end; balances never mutated directly — all movement through the settlement service (escrow → settle/refund) on the double-entry ledger. ✅
- Idempotency keys on every escrow; deltas use natural-unique references. ✅
- Object-level authz: rider-only and assigned-driver-only guards on every trip action. ✅
- Guarded state transitions reject illegal moves with 409; every transition writes `trip_events`. ✅
- Negotiation below the driver-profit floor is rejected server-side regardless of client (cannot be bypassed). ✅
- Admin routes require admin gate; sensitive ops audited with before/after + reason. ✅
- RLS enabled on all new tables; service-role bypass for the Go backend. ✅

## Known gaps / follow-ups (out of MVP scope or pending host run)
- Run `go build`/`go vet`/`go test` on the host (toolchain unavailable in this sandbox) before merge.
- Maps adapter is the deterministic mock (`MockMaps`); swap in a live provider behind `MapsAdapter` after sandbox validation (PRD build step 15).
- Mobile `MapPlaceholder` is a styled stand-in (no `react-native-maps` dep yet) — single-component swap when the maps SDK lands.
- Real-time driver location/trip updates use polling hooks; upgrade to websockets/Supabase realtime later.
- Other service modes (parcel, bus, towing, movers) are intentionally not built — feature-flagged off per the agreed ride-hailing scope.
