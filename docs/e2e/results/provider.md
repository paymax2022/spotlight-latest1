# PROVIDER module — production E2E validation results

Date: 2026-10-03. Stack exercised live: Next dev :3000 (proxies to `GO_BACKEND_URL=http://localhost:8080`), admin console :3001 (admin-proxy → Go :8080), Go api :8080 (HEAD build), GoTrue via Kong :54321, Postgres `supabase_db_spotlight` :54322, Mailpit :54324, fakes :9101.

Specs: `frontend-web/tests/e2e/provider/` — 4 specs / 5 tests, all green on `chromium-desktop` (~9.8s, 5 workers). Every spec runs on its own `provisionVerifiedUser`-created accounts (owner, customer, BOLA-stranger); shared fixtures only ever read (admin fixture used solely to exercise the real approval gates).

Provider type exercised: **restaurant owner** — the deepest provider surface in this stack (onboarding → KYB → menu offering → order queue → status FSM).

Environment facts verified before testing:
- `FEATURE_RESTAURANT_ENABLED=true` (backend/.env:60), `FEATURE_CHECKOUT_TOPUP_TIER0=true` → Tier-0 customers may spend ≤ ₦10,000/order via the checkout allowance (backend/internal/finance/tiers/service.go:176-187).
- `FEATURE_RESTAURANT_PAYSTACK_CHECKOUT_ENABLED` is **unset** in the api container → the Paystack-funded checkout routes are NOT mounted; wallet escrow is the only live order rail.
- `/api/restaurant/admin` mounts `mapsAuth()` + per-route `RequirePermission` only — **no `RequireAdmin` (x-admin-api-key)** on this group (backend/internal/app/finance_routes.go:1773). An admin Bearer alone is sufficient; verified live (200 with bearer, 401 without).
- Admin fixture `admin@spotlight.internal` (super-admin) holds `restaurant.admin.onboarding`, `.dispatch`, `.disputes`, `.payouts`, `.pricing`, `.withdrawals`, `restaurant.manage`.
- `WithModeration` is never called in app wiring → `moderationOn=false` → discovery filters `is_open` only (the `listing_review_status` gate is dormant).
- `frontend-admin/.env.local` still lists `ADMIN_API_BASE_URL=http://localhost:8095` (dead port), yet the running :3001 server forwarded correctly to :8080 — the live process evidently runs with an override (same class of drift as web's `GO_BACKEND_URL`, cf. user.md).
- `wallet_balance` is a VIEW over `ledger_entries`; fixture funding posted the same balanced journal the top-up webhook posts (DR `provider_clearing` / CR `user_wallet`).

## Verdicts

| ID | Journey | Verdict |
|----|---------|---------|
| PROVIDER-001 | onboarding | **PASS with gap F-P1** — user becomes a provider via `POST /api/v1/restaurant` (201); appears in `GET /mine`; created `is_open=false`, `kyb_status=NULL`; gated everywhere until approved. No web owner UI exists (API-only journey). |
| PROVIDER-002 | KYB/verification | **PASS** — fill KYB → submit → admin approval flips `restaurant_kyb.status`, `restaurants.kyb_status`, `is_open` → owner reads `approved`; appears in discovery. BOTH approval mechanisms work: admin API **and** admin console UI. |
| PROVIDER-003 | provider dashboard (offering) | **PASS** — menu category 201 → item 201 → detail read-back → price/availability PATCH 200; all persisted in DB. |
| PROVIDER-004 | cross-actor visibility | **PASS** — invisible pre-approval, discoverable post-approval (`GET /api/v1/restaurant?q=` + `/restaurant` UI + `/restaurant/[id]` UI incl. menu item). |
| PROVIDER-005 | request/order flow | **PASS** — real UI checkout (Add to Cart → Pay From Wallet) → order `pending` + balanced escrow legs posted → provider queue `role=restaurant` → owner advances `pending→confirmed→preparing`; DB tracks each move. |
| EDGE | authz probes | **PASS** — anon → 401 on create/mine/patch; provider B → 403 on A's store PATCH/availability/menu-create (BOLA); customer → 403 on provider-side order status; unapproved owner → 403 on self-open. |

## Findings

- **F-P1 — P3 (gap): the web product has NO provider-owner surface.**
  `frontend-web/app/restaurant/*` is entirely consumer-side (discovery, detail,
  checkout, orders, rating). No route under `app/` offers store creation, KYB,
  menu management or an order queue — `src/lib/restaurant` calls only
  customer-scoped endpoints. The owner console lives in the mobile app
  (`mobile-app/reactnative` per route comments). A web user CAN become a
  provider only via the BFF API. Not a defect per se, but the "provider
  journey" on web is API-only.
  Evidence: `frontend-web/app/restaurant/`, `frontend-web/src/lib/restaurant/index.ts:188-270`,
  `frontend-web/app/api/v1/restaurant/mine/route.ts:8-11` ("the mobile owner console").

- **F-P2 — P3 (gap): KYB endpoints have no BFF proxy.**
  `PUT|GET /api/finance/restaurant/:id/kyb`, `POST .../kyb/documents`,
  `POST .../kyb/submit` are mounted in Go (finance_routes.go:1668-1672) but no
  route exists under `frontend-web/app/api/v1/restaurant/[id]/`. A web caller
  must hit Go :8080 directly with its Bearer — verified working (Supabase JWT
  is accepted by `RequireAuthContext`). If the web app ever grows an owner
  console, it needs these proxies or it cannot onboard KYB same-origin.

- **F-P3 — P4 (note): admin onboarding queue vocabulary.**
  `GET /api/restaurant/admin/onboarding` maps `restaurants.kyb_status` to the
  console's status vocabulary (`submitted→pending`, `under_review/needs_more_info→in_review`,
  `approved`, `rejected`; NULL → `pending`), so a store with NO KYB submission
  shows as a pending application and the admin decision endpoint is itself the
  verification act (admin_repo.go:133-265). Consistent with FOOD-003 intent —
  but means the console cannot distinguish "owner never submitted" from
  "submitted, awaiting review" beyond the KYB row's presence.

- **Note (by design):** `POST /api/finance/restaurant/:id/kyb/documents` stores
  a `doc_type` + `file_url` reference — the actual binary upload is a separate
  storage concern, so the R2-misconfiguration upload blocker (user.md F2) does
  NOT gate KYB submission. Spec used `business_type='sole_proprietor'` which
  requires no documents anyway; a registered entity would only need URL
  references, still no upload through this endpoint.

- **Note (by design):** admin approval sets `is_open=true` itself — the
  "open for orders" act IS the approval. `PATCH /:id/availability` stays 403
  for unapproved owners (FOOD-010 fail-closed, re-verified this run).

## Journey details

### PROVIDER-001 — onboarding — PASS
`POST /api/v1/restaurant` → **201** (`{id, name}`) → `GET /api/v1/restaurant/mine`
→ **200** contains the id → `restaurants` row `is_open=false, kyb_status=NULL`.
Consumer discovery `?q=<name>` → 200, empty (gated pre-approval).
Anon: POST create → **401**, GET mine → **401**, PATCH :id → **401**.
BOLA: stranger PATCH :id → **403**, PATCH availability → **403**, POST
menu/categories → **403** (0 rows written).
Spec: `tests/e2e/provider/provider-001-onboarding.spec.ts`.

### PROVIDER-002 — KYB → admin approval — PASS
Owner: `GET :8080/api/finance/restaurant/:id/kyb` → 200 `{status:'draft'}` →
`PUT .../kyb` (sole_proprietor + settlement account) → 200 →
`POST .../kyb/submit` → 200 `{status:'submitted'}`; `restaurant_kyb` and
`restaurants.kyb_status` both `submitted`. Negative: submit on a second store
with no KYB row → **400** "fill in your KYB details".
Admin (API): `GET :8080/api/restaurant/admin/onboarding?status=pending` → 200,
contains the restaurant → owner bearer POST `.../onboarding/:id/approve` →
**403** (RBAC negative control) → admin bearer POST `.../approve` → **200** →
`restaurant_kyb.status='approved'`, `restaurants.kyb_status='approved'`,
`is_open=true` → owner `GET .../kyb` → `approved` → discovery lists it.
Admin (UI): real login at :3001 `/admin/login` → `/admin/restaurant/onboarding`
→ row "Review" → "Approve" → success banner → same DB flip.
Spec: `tests/e2e/provider/provider-002-kyb-approval.spec.ts`.

### PROVIDER-003 — menu offering — PASS
`POST /api/v1/restaurant/:id/menu/categories` → **201** (DB row) →
`POST .../menu/items` `{price_kobo:150000}` → **201** (DB row) →
`GET /api/v1/restaurant/:id` → 200, `categories[].items[]` contains the item →
`PATCH .../menu/items/:itemId` `{price_kobo:175000,is_available:false}` → 200,
DB updated.
Spec: `tests/e2e/provider/provider-003-menu-offering.spec.ts`.

### PROVIDER-004 — cross-actor visibility — PASS
Pre-approval: customer `GET /api/v1/restaurant?q=<name>` → 200, `restaurants:[]`.
Post-approval: same call lists the store; `GET :id` returns the menu item; UI
`/restaurant` search renders the card; `/restaurant/[id]` renders the item.
Spec: `tests/e2e/provider/provider-004-visibility-order.spec.ts`.

### PROVIDER-005 — order flow — PASS
Customer (fresh Tier-0, wallet fixture-funded ₦5,000 via balanced
provider_clearing/user_wallet journal): UI `/restaurant/:id` → Add to Cart →
Go to Checkout → address → "Pay From Wallet" →
`POST /api/v1/restaurant/:id/orders` → **201** → redirect `/restaurant/orders/:id`.
DB: `orders.status='pending'`, `total_kobo=220000` (₦1,500 item + ₦200 packaging
+ ₦500 delivery); **balanced escrow legs**: `ledger_entries` DR `user_wallet`
220,000 / CR `escrow` 220,000 ref `escrow:order:<id>` — real money movement, not
a mock. Provider `GET /api/v1/restaurant/orders?role=restaurant` → 200 contains
the order `pending` → customer PATCH status `confirmed` → **403** (object-level
authZ, role=customer can't act) → owner PATCH `confirmed` → 200 → owner PATCH
`preparing` → 200; `orders.status` tracked each step.
Spec: `tests/e2e/provider/provider-004-visibility-order.spec.ts`.

## Which admin-approval mechanism worked

**Both, end-to-end.**
- Admin API: `POST :8080/api/restaurant/admin/onboarding/:id/approve` with a
  GoTrue admin Bearer — 200. `x-admin-api-key` is NOT in this gate (the group
  mounts only `mapsAuth()` + `RequirePermission`).
- Admin console UI: :3001 `/admin/login` → `/admin/restaurant/onboarding` →
  Review → Approve → lands through `/api/admin-proxy` (which attaches
  `x-admin-api-key` + the session Bearer) onto the same Go route — 200.
- psql was used ONLY for fixture setup (email-confirm, wallet funding journal)
  and verification — never to move KYB/onboarding state.

## Coverage ledger — API paths exercised this run

- BFF (:3000): `POST /api/auth/register`, `POST /api/auth/login`
- `POST|GET /api/v1/restaurant`, `GET /api/v1/restaurant/mine`, `GET /api/v1/restaurant/:id`
- `PATCH /api/v1/restaurant/:id`, `PATCH /api/v1/restaurant/:id/availability`
- `POST /api/v1/restaurant/:id/menu/categories`, `POST|PATCH /api/v1/restaurant/:id/menu/items[/:itemId]`
- `POST /api/v1/restaurant/:id/orders`, `GET /api/v1/restaurant/orders`, `PATCH /api/v1/restaurant/:id/orders/:orderId/status`
- Go direct (:8080): `GET|PUT /api/finance/restaurant/:id/kyb`, `POST /api/finance/restaurant/:id/kyb/submit`,
  `GET /api/restaurant/admin/onboarding`, `POST /api/restaurant/admin/onboarding/:id/approve`
- Admin console (:3001): `POST /api/admin/session`, `GET /api/admin-proxy/api/restaurant/admin/onboarding`,
  pages `/admin/login`, `/admin/restaurant/onboarding`
- Pages rendered: `/restaurant`, `/restaurant/[id]`, `/restaurant/checkout`, `/restaurant/orders/[id]`

## Blockers / notes for next run

- Wallet funding required the DB journal fixture: Paystack top-up cannot
  complete locally (`PAYSTACK_*` placeholders; no reachable PSP). The funding
  path itself (topup intent → webhook credit) remains unverified E2E.
- Card checkout (`orders/paystack/initiate`) is unmounted in this env
  (flag unset) — the wallet rail was the only reachable one.
- The KYB "documents" surface was exercised at the API-shape level only
  (sole_proprietor needs none); registered-entity flows need `cac_certificate`
  doc refs — the endpoint accepts URL references, so the R2 upload outage does
  not apply.
- `frontend-admin/.env.local` `ADMIN_API_BASE_URL=:8095` drift: the running
  server works, but a cold restart without the override would 502 every
  admin-proxy call (same pattern as web's GO_BACKEND_URL).
