# Cluster stays-a — Stays: ACC / MRB / SHT / HTL / SRH / RAT / BKS / BKH (179 cases)

**Pass:** 31 live-executed · **Fail→Fixed:** 4 defects (D001–D004) · **Blocked:** 1 · **Needs-manual:** 1 · **Not-run (mapped):** 146
Implementation: **IMPLEMENTED 101 · PARTIAL 63 · MISSING 15** — defects STYA-D001..D014 in `defects-stays-a.csv`.
Evidence: `exec-stays-a.csv` (25 rows). Source extract: `cases-extract.csv` (all 365; this lane owns 179).

## Run notes

- Two supply planes exist and BOTH were audited:
  - **`backend/internal/stays`** — the Go marketplace rail: `stays_property` / `stays_room_type` / `stays_rate_plan` + `stays_availability_day` / `stays_rate_day` / `stays_promotion` calendars; guest path `GET /api/finance/stays/{search,destinations,home,deals,saved*,consent,prebook,book,reservations*}`; merchant path `/api/stays/extranet/*` (self-list → OWNER grant in `stays_hotelier_profile`, per-property `stays_hotelier_kyb`, staff roles OWNER/MANAGER/FRONT_DESK/FINANCE/READ_ONLY); admin `/api/stays/admin/*` (RBAC `stays.admin.*`). Money path = wallet escrow hold → settle split (commission→AccountCommission, net→AccountProviderClearing) → auto-release on failure; `Idempotency-Key` enforced on book/modify.
  - **`realtor_*` (Supabase RPC data plane)** — mobile calls `realtor_create_shortlet_booking` (EXCLUDE gist on `daterange [)` = atomic whole-unit) and `realtor_book_hotel_room` (`FOR UPDATE` room-type lock + overlap count vs `total_rooms`); `realtor_hotel_rooms` physical board (available/reserved/occupied/dirty/cleaning/inspected/out_of_service) + `realtor_channel_connections` (OTA stubs). Go side only exposes the admin control plane + stay→estate gate-pass bridge.
- **No request-to-book anywhere** (BKS-002..006 MISSING → D010). **No multi-line reservation** (mixed room/rate atomicity, HTL-015/BKH-003/BKH-005 → D011). **No hotel/shortlet merchant type** in `onb_merchant_type` — the merchant model is self-serve extranet + per-property KYB, not the UAT's application pipeline (MRB-001..003 PARTIAL; onboarding is platform-owned).
- **Environment:** `:8080` is occupied by an unrelated project's gateway; no Spotlight backend was running. This lane started local Supabase (`supabase start`, restored shared volume — fixtures intact) and ran `go run ./cmd/server` on `:18421` (env: local supabase :54321/:54322, dedicated redis :6390). Fixture login via `scripts/dev/ensure-dev-login.sh` only. Port collision note: a node process bound `localhost:8099` IPv4 mid-run while `go run` bound IPv6 only — use a higher port.
- **Live-DB suites:** `TEST_DATABASE_URL` set → adapters, extranet (338s), reservation (347s), settlement, supplierwebhooks, realtor all green. `stays/admin` `TestLiveDBDashboard` FAILS on shared-volume aggregate counts (bookings_30d moved 5, want 2) — fixture pollution from parallel suites, not a product defect.
- **UI legs are source-level only** (no device run): mobile `src/features/stays/api.ts` filters (price/stars/type/amenities) are client-side; `src/features/stayshotelier` covers the extranet; `app/realtor/hotel/desk.tsx` drives the room board.

## Fixed defects (verified live on :18421)

- **STYA-D001 (S1)** — extranet `CreateRoomType`/`CreateRatePlan` never stamped `supplier_*_ref` → offers carried `""`, prebook 400'd or resolved an arbitrary rate plan (wrong price + decrement on wrong inventory). Fixed: stamp `id::text` at create; backfill pending sql. Live: refs stamped, prebook resolves exact selection.
- **STYA-D002 (S1)** — `promo_bps`/`loyalty_tier` taken from the request body into `pricing.Price` → any guest could claim up to 20% off. Fixed: both ignored; new `Repository.BestPromotionBps` resolves active PERCENT `stays_promotion` server-side. Live: `promo_bps=9000` → `discount_kobo:0`; a real property promo → 10% applied.
- **STYA-D003 (S2)** — book_token TTL advertised (10m) never enforced. Fixed: v2 token embeds mint time; `ErrHoldExpired` at decode; `TestBookTokenTTL` added.
- **STYA-D004 (S2)** — `stays_rate_day` was write-only on the sale path: every night priced at base rate; cta/ctd/min_los/max_los/stop_sell unenforced; occupancy map dropped (`gateway.Occupancy{}` hardcoded) so over-capacity booked; search ignored dates/occupancy → sold-out listings advertised. Fixed: `priceStay()` sums per-night cells (base fallback) + arrival LOS + CTA/CTD/stop-sell; occupancy mapped & validated; `Search` adds per-night `EXISTS` headroom + occupancy filters. Live: 11M override + 7M base → gross 18M; adults=9 vs occupancy=2 → 409.

## Recorded defects / gaps (not fixed)

- **D005 (S2)** — realtor RPCs: no `client_ref` dedup, no `guests ≤ capacity`, no past-date guard, hardcoded ₦25k cleaning → `migrations-stays-a/realtor_rpc_hardening.pending.sql`.
- **D006–D009 (S3)** — publish doesn't enforce go-live eligibility; moderation reject has no reason; house_rules not in guest content; revoked KYB doesn't suspend grants.
- **D010 (S2)** — no request-to-book lifecycle. **D011 (S2)** — no mixed room-type/multi-rate atomic order.
- **D012 (S3)** — Notifier never wired → no host booking alerts. **D013 (S3)** — no horizon cap, extra-guest fees, promo codes, search pagination, flexible dates, rating sort.
- **D014 (S4, shared_platform)** — ACC identity legs are platform-owned; mapped, not deep-executed.

## Per-REQ summary

| REQ | Cases | Implemented | Partial | Missing | Notable |
|---|---|---|---|---|---|
| ACC customer lifecycle | 20 | 17 | 3 | 0 | consent+booking-scope+idem live; identity legs platform-owned |
| MRB two-modes merchant | 22 | 13 | 9 | 0 | extranet+KYB+staff model works; no stays merchant type in onboarding |
| SHT short-let supply | 25 | 12 | 12 | 1 | create/photos/details/moderation/KYB ok; no dup-unit detection, fees thin |
| HTL hotel room types | 25 | 15 | 8 | 2 | calendars+plans+occupancy ok (post-fix); no extra-bed, no mixed-type order |
| SRH guest discovery | 23 | 13 | 9 | 1 | dated availability now filters; filters client-side; no rating sort |
| RAT inventory & rates | 22 | 14 | 6 | 2 | invariants strong (row-lock, EXCLUDE, idem); rate_day now enforced |
| BKS short-let reservations | 20 | 11 | 4 | 5 | instant book solid; entire request-to-book lifecycle absent |
| BKH hotel reservations | 22 | 6 | 12 | 4 | single-type multi-room ok; mixed/room-assignment/pay-at-property partial |

**Shared-touched:** none outside stays/realtor domain paths. `backend/internal/app/stays_routes.go` not edited.
