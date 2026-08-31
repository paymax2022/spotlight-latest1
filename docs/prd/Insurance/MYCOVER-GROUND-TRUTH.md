# MyCover.ai — VERIFIED ground truth (probed live 2026-08-31 with the repo test key)

Everything below was confirmed by real HTTP calls, not from docs or guesswork.
Do NOT "improve" on these facts from memory. If you need a new fact, PROBE FOR IT.

## Connection
- Base URL (test AND live): `https://api.mycover.ai/v1`
  ⚠️ The current adapter defaults to `https://api.sandbox.mycover.ai/v1` — THAT HOST IS WRONG.
  `INSURANCE_MYCOVER_BASE_URL` in backend/.env is `""` so the wrong default is what runs today.
- Auth header: `Authorization: Bearer <INSURANCE_MYCOVER_API_KEY>` (key starts `MCASECK_T`).
  Sending the key WITHOUT the `Bearer ` prefix returns 400 "Invalid bearer token format".
- The `MCASECK_T…` key resolves to MyCover's **staging/test** environment
  (asset URLs come back as `s3.eu-west-2.amazonaws.com/staging.mycover.ai/...`).
- Public key `MCAPUBK_T…` exists for client-side/SDK use.
- `INSURANCE_MYCOVER_WEBHOOK_SECRET` is EMPTY — webhook signature verification cannot
  work until a real secret is set. Treat that as a known gap, do not fake it.

## Response envelope (ALL endpoints)
```json
{ "responseCode": 1, "responseText": "Products fetched successfully", "data": { ... } }
```
- Success => `responseCode: 1`. Failure => `responseCode: 0`.
- On validation failure `responseText` is an ARRAY of human-readable strings, not a string.
  Any parser must handle `responseText` being either string or []string.

## Verified endpoints
| Method | Path | Status | Notes |
|---|---|---|---|
| GET | `/products/get-all-products?page=1&limit=100` | 200 | Returns all 68. `limit` works; default page size 25. `data.{total_count,products[]}` |
| GET | `/policies` | 200 | `data.{total_result,total_count,policies[]}`. Currently EMPTY (nothing purchased yet). |
| GET | `/policies/{uuid}` | — | Requires a UUID ("Id must be a uuid"). |
| POST | `/products/{prefix}/buy-{slug}` | 400 w/ field errors | Per-product bespoke schema. See below. |
| GET | `/claims`, `/wallet/balance`, `/products/get-all-categories`, `/products/bulk/compute-price` | 403 "Forbidden resource" | Path exists but this key lacks the scope. Do NOT build on these without re-probing. |

## ⚠️ THE CENTRAL ARCHITECTURAL FACT
MyCover is **NOT** a generic `POST /quotes` → `POST /policies` API.
It exposes **one bespoke purchase endpoint per product**, each with its **own required-field schema**.
Examples verified live:
- `POST /products/bastion/buy-medisure` requires: gender (Male|Female), nin (exactly 11 chars),
  image_url (must be a valid image URL), first_name, last_name, email, …
- `POST /products/sti/buy-marine-cover` requires: cargo_details (array), first_name (>=2),
  last_name (>=2), email, phone_number, cargo_value (>=5000), country_of_origin (enum), …
- `POST /products/aiico/buy-office-content-cover` requires: pre_ownership, tenancy, address (>=6),
  office_items[], lga (enum of Nigerian LGAs e.g. "ABIA-Aba"), …

Consequences you MUST design for:
1. The mobile app needs a **schema-driven dynamic form renderer**, not one hardcoded quote form.
2. The existing gateway interface (`GetQuote`/`BindPolicy` with a generic `Inputs` map) is the
   right shape ONLY if the adapter carries a per-product route + schema table.
3. The endpoint slug is **NOT** mechanically derivable from `route_name`.
   `bastion-flexicare-mini` → `/products/bastion/buy-flexicare-mini` returns **404**.
   The slug must be discovered per product and stored, not computed.

### How to discover a product's schema (USE THIS TECHNIQUE)
`POST` the candidate buy path with body `{}` and read the 400 validation array — it enumerates
every required field, its type, length bounds and enum values. This is safe: validation rejects
before anything is created. This is how every schema above was obtained.

## Product catalog (68 products, all is_active=true)
Categories: Life 15, Auto 14, Health 12, Content 10, Gadget 10, Package 6, Travel 1.
Underwriters: AIICO, Sovereign Trust (sti), Coronation, Sanlam, SanlamAllianz, Leadway,
Bastion Health, Goxi MicroInsurance, Tangerine, MyCoverGenius (mcg).
Raw JSON saved at: `SCRATCHPAD/mycover-products.json`

Useful per-product fields:
- `id` (uuid), `name`, `description`, `route_name`, `prefix`
- `base_price` + `is_percentage` — if true, base_price is a RATE (% of sum insured), else a flat NGN amount
- `cover_period` (days), `is_renewable`, `is_claimable`, `is_inspectable`, `is_certificateable`
- `meta.logo` — underwriter logo URL (use in UI), `meta.sum_insured` on some products
- `category{id,name}`, `provider{id,organization_name}`, `currency`, `country`
- `payment_providers[]` — Paystack, channels ["Bank transfer","Ussd"]
- `sharing_formula[]` — `{mca_commission, provider_commission, distributor_commission,
  provider_commission_from: original_premium|final_premium}`. **`distributor_commission` is
  Paymax's revenue share** — surface it in the admin commission screens.
- `key_benefits`, `full_benefits`, `how_it_works`, `how_to_claim` — HTML strings, render sanitised.

## ⚠️ MONEY UNITS — READ TWICE
MyCover `base_price` and all amounts are in **NAIRA** (major units), often as decimal strings
("6000.0000", "0.5"). The Paymax iron rule is **integers in kobo**. Every value crossing the
adapter boundary MUST be converted naira→kobo (×100) exactly once, with no float rounding
drift. Percentage products: premium = sum_insured_kobo × base_price / 100, integer math only.
Getting this wrong is a money bug, not a display bug.

## Where things live in this repo
- Adapter (needs rewrite): `backend/internal/provider/mycover/mycover.go` (360 lines,
  littered with `TODO(live): confirm ... against live docs` — it was written against GUESSED
  endpoints `/quotes`, `/policies`, `/claims` that do not match reality).
- Provider-agnostic interface: `backend/internal/insurance/gateway/{gateway,models}.go` (good design, keep it).
- Router wiring: `backend/internal/app/insurance_routes.go:59` + `insurance_claims_routes.go:63`.
- Go route mounts: member `/api/finance/insurance/*`, admin `/api/insurance/admin/*`,
  webhooks `/internal/webhooks` (see `backend/internal/app/finance_routes.go:439-453`).
- Mobile proxy (exists): `frontend-web/app/api/v1/insurance/[...path]/route.ts`
- Mobile feature: `mobile-app/reactnative/src/features/insurance/` — **mock-first**,
  `USE_MOCK` defaults **true** in `constants/insurance.constants.ts`.
- Mobile screens: `mobile-app/reactnative/app/insurance/` (44 screens already scaffolded).
- Admin: `frontend-admin/app/admin/insurance/` (21 pages), service
  `frontend-admin/src/services/insuranceAdminService.ts`.
- Migrations: `supabase/migrations/20260712000000_insurance_core.sql`,
  `20260713000000_insurance_claims.sql`, `20261031000100_insurance_products_seed.sql`.

## Running services (already up, main checkout)
- Expo web (mobile UAT): http://localhost:8083/insurance
- Admin console: http://localhost:3001/admin/insurance/dashboard
- frontend-web proxy: http://localhost:3000
- Go backend: http://localhost:8091
- Supabase Postgres: localhost:54322
- `FEATURE_INSURANCE_ENABLED=true` already set in backend/.env.

## House rules that apply (from CLAUDE.md — non-negotiable)
- Money = integers in minor units (kobo). Never floats, never strings for math.
- Every money mutation: Idempotency-Key + balanced double-entry ledger + audit event + tier check.
- Wallet balances are ledger projections — never UPDATE a balance column.
- Migrations are additive-only. Never reuse a migration version (check for collisions right
  before merging). No DROP, no renames, no type narrowing.
- Never modify legacy Spotlight modules (contests/voting/applicants/legacy auth).
- Feature-flag every new module.
- ADRs: name the file `ADR-PR<pr-number>-<slug>.md`, never hand-pick an ADR number.
- Never hand-reset a dev fixture password; run `scripts/dev/ensure-dev-login.sh`.
- NEVER print a secret value. Report presence/length only. A leaked key in a log is an incident.

---

# ADDENDUM — verified by live purchase attempt (same session)

## 1. Buy endpoints are per product FAMILY, not per product
Every buy endpoint requires a body field `product_id` ("must be a UUID") — the `id` from
get-all-products. One family endpoint therefore serves many plans; the plan is chosen in the BODY.
This is why deriving a path per product from `route_name` always 404s.
Family names are their OWN namespace and need not match any catalog product name:
`/products/bastion/buy-medisure` is live even though no product called "MediSure" exists in the catalog.

Probe signal: `404 "Cannot POST ..."` = path absent. `400` (validation array) or `403` = path EXISTS.

### Family paths VERIFIED to exist
| Path | Category | Status |
|---|---|---|
| `/products/bastion/buy-medisure` | Health | 400 schema (usable) |
| `/products/mcg/buy-gadget-cover` | Gadget | 400 schema |
| `/products/sti/buy-gadget-cover` | Gadget | exists |
| `/products/sti/buy-comprehensive` | Auto | exists |
| `/products/sti/buy-third-party-bike` | Auto | 400 schema |
| `/products/sti/buy-goods-in-transit` | Package | exists |
| `/products/sti/buy-marine-cover` | Package | 400 schema |
| `/products/aiico/buy-third-party-auto` | Auto | exists |
| `/products/aiico/buy-comprehensive-auto` | Auto | exists |
| `/products/aiico/buy-home-content-cover` | Content | exists |
| `/products/aiico/buy-office-content-cover` | Content | 400 schema |
| `/products/sanlam/buy-personal-accident` | Life | **403 scope-blocked** |
| `/products/tangerine/buy-life-cover` | Life | **403 scope-blocked** |

## 2. ⛔ BLOCKER — MyCover uses a PREFUNDED DISTRIBUTOR WALLET
A fully-valid purchase payload (every field accepted) returns:
`{"responseCode":0,"responseText":"v2 Error: Insufficient wallet fund for purchase"}`

MyCover does not charge per transaction against a card. The distributor (Paymax) must hold a
prefunded wallet balance with MyCover, and **each policy purchase debits that wallet**.
Our staging wallet balance is zero, so **no policy can be bound today** — this is an account/treasury
action, not a code fix. `/wallet/balance` and `/wallet/transactions` exist but return 403 for our key,
so the balance must be funded and read from the MyCover dashboard.

### Architectural consequence (money path — design for this now)
Three distinct movements, and they must not be conflated:
1. User pays Paymax the premium (wallet or card debit) — user ledger.
2. Paymax's MyCover float is debited by the provider at bind time — a Paymax ASSET account
   drawdown, asynchronous to (1) and invisible to the user.
3. Paymax earns `sharing_formula[].distributor_commission` (0–25%) — revenue recognition.
Reconciliation must watch float balance vs bound policies, and there must be a low-float alarm:
if the MyCover wallet empties, every bind fails and users are charged with no policy issued.
**Therefore: never debit the user before the provider bind succeeds, or fully reverse on failure.**
This is the same reserve-before-move inversion that caused prior money bugs in this repo.

## 3. image_url fields are FETCHED and content-checked by the provider
`image_url` / `id_image_url` / `device_about_image_url` must be publicly reachable image URLs, and
MyCover actually retrieves them. Verified: cloudinary `.webp` and `aiicoplc.com/.png` PASS;
`picsum.photos/*.jpg`, `upload.wikimedia.org/*.jpg` and a non-existent S3 key all FAIL with
"image_url is not a valid image url". So uploads must go to our own reachable storage (Cloudflare R2,
bucket from `R2_BUCKET`) and the resulting PUBLIC url is what we send — a presigned/private URL will fail.

## 4. Confirmed-good purchase payload shape (Bastion health family)
Every field below was ACCEPTED; the request failed only at the wallet-funding step.
```json
{ "product_id": "<catalog uuid>", "gender": "Male", "nin": "12345678901",
  "image_url": "<publicly fetchable image url>", "first_name": "...", "last_name": "...",
  "email": "...", "date_of_birth": "1990-04-12", "phone_number": "+2348012345678",
  "payment_plan": 1 }
```
`payment_plan` is an integer 1..12 (instalment months) and affects premium — do not hardcode it.
