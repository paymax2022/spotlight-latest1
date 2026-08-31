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
