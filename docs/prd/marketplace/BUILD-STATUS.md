# Marketplace Mobile — Build Status (real vs scaffold)

**Updated:** 2026-07-05 · Ref: `docs/prd/marketplace/Mobile-UX-Flows.md`, ADR-021.

Legend: **Real** = wired to backend (or reuse of a shipped screen) with mock
fallback · **Scaffold** = placeholder/stub · **Reuse** = links into an existing
Paymax surface (no net-new screen) · **Other agent** = owned elsewhere.

## Screen inventory (34)

### Discovery (1–9) — Discover agent
| # | Screen | Status | Notes |
|---|--------|--------|-------|
| 1 | Home / rails | Real | `getHomeRails` composes from `/search`; mock fallback |
| 2 | Category landing | Real | `/categories`, `/categories/:id` |
| 3 | Search | Real | `/search` — **now works via Postgres fallback** when ES unwired (this build) |
| 4 | Results | Real | search results grid |
| 5 | Map / near-me | Real (reduced) | geo ranking needs ES; fallback returns non-geo results |
| 6 | Listing detail | Real | `/listings/:id` |
| 7 | Seller profile | Real | `/sellers/:id/profile|listings|reviews` |
| 8 | Saved items (wishlist) | Real | **`/listings/:id/save`, `/saved-items` added this build**; screen live |
| 9 | Saved searches | Real | `/saved-searches` CRUD |

### Sell (10–17) — Sell agent
| # | Screen | Status | Notes |
|---|--------|--------|-------|
| 10–16 | Smart Composer, My Listings, etc. | Other agent | Sell agent |
| — | Listing photo upload | Real (backend) | **`POST /media/presign` added this build** (R2, fail-closed 503) |
| 17 | Boost purchase | Other agent | `/boosts`, `/boosts/tiers` |

### Transact (18–27) — Transact agent
| # | Screen | Status | Notes |
|---|--------|--------|-------|
| 18–26 | Checkout, Order Tracker, Deal Room, Dispute Wizard | Other agent | escrow FSM, `/orders/*`, `/disputes/*` |
| 27 | Meetup Mode | Other agent (data ready) | **`GET /meetup/safe-spots` added this build** feeds safe-spot list |

### Trust & Account (28–34) — THIS build
| # | Screen | Status | Notes |
|---|--------|--------|-------|
| 28 | Verification Center | Reuse | `account.tsx` links `/kyc-verify` (existing KYC flow) |
| 29 | My Orders | Other agent | Transact agent (Orders tab) — intentionally not built here |
| 30 | Wallet hand-off | Reuse | `account.tsx` links `/(tabs)/wallet` (existing wallet) |
| 31 | Report flow | Real | `app/marketplace/account/report.tsx` → `POST /reports` (+ optional block) |
| 32 | Blocked users | Real | `app/marketplace/account/blocked.tsx` → `GET/DELETE /blocks` |
| 33 | Notification Preferences | Real | `app/marketplace/account/notifications.tsx` → `GET/PATCH /notification-prefs` |
| 34 | Help & Support | Real | `app/marketplace/account/help.tsx` — searchable static FAQ + contact (routes into support with context) |
| Hub | Account tab | Real | `app/marketplace/account.tsx` — links all of the above + Verification + Wallet |

## Backend gap endpoints added (this build)

| Method | Path | Table | Guard |
|--------|------|-------|-------|
| POST | `/v1/marketplace/media/presign` | — (R2) | Bearer |
| POST | `/v1/marketplace/listings/:id/save` | `mkt_saved_items` | Bearer |
| DELETE | `/v1/marketplace/listings/:id/save` | `mkt_saved_items` | Bearer |
| GET | `/v1/marketplace/saved-items` | `mkt_saved_items` | Bearer |
| POST | `/v1/marketplace/reports` | `mkt_reports` | Bearer |
| POST | `/v1/marketplace/blocks` | `mkt_blocks` | Bearer |
| DELETE | `/v1/marketplace/blocks/:id` | `mkt_blocks` | Bearer + OLA |
| GET | `/v1/marketplace/blocks` | `mkt_blocks` | Bearer |
| GET | `/v1/marketplace/notification-prefs` | `mkt_notification_prefs` | Bearer |
| PATCH | `/v1/marketplace/notification-prefs` | `mkt_notification_prefs` | Bearer |
| GET | `/v1/marketplace/meetup/safe-spots` | — (static seed) | Bearer |
| GET | `/v1/marketplace/search` | (fallback over `mkt_listings`) | Bearer-optional |

All non-money metadata (no `Idempotency-Key`, no ledger). Owner-scoped via the
service-layer OLA on the pgx service-role pool (no RLS — matches `mkt_*` module
convention; see ADR-021 §6).

## Go-live gates

| Gate | Command / condition | State |
|------|---------------------|-------|
| Go compile | `cd backend && go build ./...` | **Pending host run** (no Go toolchain in this env; static-verified: imports, signatures, brace balance) |
| Go vet | `cd backend && go vet ./...` | Pending host run |
| Go tests | `cd backend && go test ./internal/marketplace/...` | Pending host run |
| Migration (local) | `supabase migration up` (local-first; NOT `db push` pre-go-live) | **Pending host run** — `20260908000000_marketplace_account_gaps.sql` additive, safe to re-run |
| Mobile types | scoped `tsc --noEmit` over `app/marketplace/account/**` + `src/features/marketplace/api/account.*` | **Clean** (this build) |
| Contract | `npm run contract:check` (impl vs `contracts/openapi.yaml`) | OpenAPI updated; YAML parses, no dangling refs |
| Live wiring | `EXPO_PUBLIC_MARKETPLACE_USE_MOCK=false` | Switches Account API from mock to the frontend-web proxy → Go |
| Full search | `ELASTICSEARCH_URL=<url>` | Optional — without it, `/search` uses the Postgres fallback (`degraded: true`) |
| Uploads | R2 env (`R2_ACCOUNT_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`) | Without it, `/media/presign` returns `503 UPLOADS_NOT_CONFIGURED` (fail-closed) |
| Feature flag | `FEATURE_MARKETPLACE_ENABLED=true` | Gates the whole `/v1/marketplace` surface |

## Deferred / not in this build

- My Orders (§29) — Transact agent.
- ~~Saved-items **live** enrichment on the Discover screen~~ — **DONE (this build)**:
  `discovery.getSavedItems()` now calls `GET /saved-items` and projects each
  joined row to the Discover `SavedItem` shape via `toSummary` (rows with no
  live listing are dropped). Screen 8 is fully live end-to-end.
- ES-backed search relevance/facets/geo — gated on `ELASTICSEARCH_URL`.
- Report/block **admin triage UI** — reports land in `mkt_reports` (`status=open`);
  surfacing them in the admin moderation queue is a follow-up.
- Notification **delivery** — prefs are stored/queried; the actual push/email
  fan-out honoring them is owned by the notifications pipeline.
