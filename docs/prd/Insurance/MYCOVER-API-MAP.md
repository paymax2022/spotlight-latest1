# MyCover.ai API Map — Paymax insurance integration

**Generated:** 2026-08-31 · **Author:** api-cartographer agent
**Machine-readable companion:** `SCRATCHPAD/mycover-schemas.json` (build every downstream feature against that file, not against this prose)

Every claim below is tagged:

| Tag | Meaning |
|---|---|
| **VERIFIED** | A real HTTP call was made with the repo's `INSURANCE_MYCOVER_API_KEY` and the response proved it |
| **DOCS ONLY** | Read from `docs.mycover.ai`, not reproducible against our account |
| **BLOCKED** | Endpoint exists but our key or our account state prevents verification |

---

## 0. The headline: the ground-truth doc describes the LEGACY API

`SCRATCHPAD/MYCOVER-GROUND-TRUTH.md` says MyCover is "one bespoke purchase endpoint per product" on
`https://api.mycover.ai/v1`. That was true of **v1**. It is **not** how MyCover is integrated today.

**VERIFIED.** The current API — the only one MyCover documents — is:

```
Base URL (test AND live):   https://v2.api.mycover.ai/v2
Auth:                       Authorization: Bearer <secret key>
```

and it exposes **one** purchase endpoint for all 69 products:

| Purpose | Call |
|---|---|
| Quote / price | `POST /v2/products/compute-price` → `{"product_id":"<uuid>","body":{…fields…}}` |
| Buy | `POST /v2/products/buy` → flat object of the fields **plus** `product_id` |
| **Per-product form schema** | `GET /v2/public-product-details/{product_id}` — **no auth required** |

`GET /v2/public-product-details/{id}` is the single most valuable endpoint in this integration. It
returns the complete, machine-readable field table for that product: name, label, type, required,
description, data source (literal enum *or* a utility URL), and full validation rules. It is what
docs.mycover.ai itself renders. **This is the source of every `form_schema` in the catalog.**

So the correct mental model is neither "68 endpoints" nor "12–20 family endpoints". It is:

> **one endpoint + one publicly-readable schema per product.**

The v1 family endpoints still exist (19 of them found, see §10) but they are a dead end: 6 of the 19
are `403` for our key, one `500`s, and MyCover documents none of them.

---

## 1. Verification scoreboard

| | Count |
|---|---|
| Products in the v1 catalog (`/v1/products/get-all-products`) | 68 |
| Products in the v2 catalog (`/v2/products/all`) | **69** |
| Products whose buy path + schema are **live-verified** | **69 / 69** |
| Products actually **purchasable today** (provider config intact) | **62** |
| Products **broken on MyCover's side** (see §6) | **7** |
| Legacy v1 family paths that exist at all | 19 (of 138 candidates probed) |
| Utility (dropdown) endpoints mapped | 19, 17 of them **live-verified** |
| Total live HTTP probes made | ~340 |

The one v2-only product is **Comprehensive Auto (AAS)** (`24140c74-fc6f-42f5-a0d2-24800b22d81b`,
AIICO). It is absent from the v1 catalog the ground-truth doc was built from. Sync from v2.

### How each product was verified

Two independent live probes per product, both safe (validation rejects before anything is created):

1. `POST /v2/products/buy` with body `{"product_id":"<id>"}` → **400** for all 69. Proves the id
   routes to a real purchase handler. Note it reports **one missing field at a time**
   (`"first_name is missing in body"`), so it does *not* enumerate the schema.
2. `POST /v2/products/compute-price` with `{"product_id":"<id>","body":{}}` → **400** carrying the
   full list: `"The payload is missing required fields: first_name, last_name, email, …"`.

Probe 2 was then cross-checked against the published schema from `public-product-details`.
**68 of 69 agree exactly.** The single disagreement is recorded in §6.

---

## 2. Endpoint table

`✔` = live-verified with our key.

### Products & purchase

| ✔ | Method | Path | Notes |
|---|---|---|---|
| ✔ | GET | `/v2/products/all?page=&limit=` | 69 products, light shape. `data.{total_count,total_results,products[]}` |
| ✔ | GET | `/v2/products/{productId}` | Full record incl. `prefix`, `route_name`, `meta`, `sharing_formula`, `utility_batches[].configs[].payload_validation_schema` |
| ✔ | GET | `/v2/public-product-details/{productId}` | **NO AUTH.** The form schema. `product_table_data[]`, `sample_payload`, `compute_price_payload`, `renewal_table_data[]`, `utilities[]` |
| ✔ | GET | `/v2/products/categories` | `{id,name,product_count,provider_count}` |
| ✔ | POST | `/v2/products/compute-price` | The quote endpoint. `{"product_id","body":{…}}` |
| ✔ | POST | `/v2/products/buy` | The purchase endpoint. Flat body + `product_id` |
| ✔ | GET | `/v2/products/utility/{utilityId}[?query=…]` | Dropdown options, `[{label,value}]`. See §7 |

### Policies, purchases, customers

| ✔ | Method | Path | Notes |
|---|---|---|---|
| ✔ | GET | `/v2/policies` | 200, **empty** — our distributor account has zero policies |
| — | GET | `/v2/policies/{policyId}` | **BLOCKED**: no real policy uuid exists to fetch. Response shape is DOCS ONLY — see §11 |
| ✔ | GET | `/v2/purchases` | 200, empty |
| — | GET | `/v2/purchases/{id}` | DOCS ONLY |
| ✔ | GET | `/v2/customers` | 200, empty |
| — | GET | `/v2/customers/{id}`, `/{id}/purchases`, `/{id}/policies` | DOCS ONLY |

### Utilities

| ✔ | Method | Path | Notes |
|---|---|---|---|
| ✔ | GET | `/v2/utilities/genders` | `data.genders: ["Male","Female"]` |
| — | POST | `/v2/utilities/files/upload` | DOCS ONLY. Returns `data.upload_id` (uuid) — that uuid is what goes into `*_url` fields. Not probed (would require uploading a real file) |

### Confirmed non-existent / blocked

| Method | Path | Result |
|---|---|---|
| GET | `/v2/sales` | **404.** The docs "Sales" page actually documents `/v2/purchases` |
| GET | `/v2/wallet/balance` | **404** |
| POST | `/v2/claims` | **404** — there is no claim-filing REST endpoint. See §4 |
| GET | `/v1/claims` | **403** scope-blocked — but `/v2/claims` is **200** for the same key |
| POST | `/v1/products/buy` | **404** — v1 has no generic buy |
| GET | `/v1/public-product-details/{id}` | **404** — v2 only |

---

## 3. The money contract

**VERIFIED.** Everything MyCover returns is **NAIRA, as a decimal string** — `"6000.0000"`, `"0.5"`,
`"25000.0000"`. Paymax's iron rule is integers in kobo.

- `base_price` with `is_percentage: false` → flat premium in naira. Kobo = `×100`, exactly once.
- `base_price` with `is_percentage: true` → a **rate in percent** of the sum insured.
  `premium_kobo = sum_insured_kobo × base_price / 100`, integer arithmetic only.
- Webhook `data.essential.amount` is likewise a naira decimal string.
- `sharing_formula[].distributor_commission` is **Paymax's revenue share** (typically 10%), with
  `distributor_commission_from: original_premium | final_premium`. Surface it in admin.
  **Three products have `sharing_formula: null` — Paymax earns nothing and pricing fails.** See §6.

---

## 4. Claims — read the whole of this section before designing the claims module

**VERIFIED: there is no REST endpoint to file a claim.** `POST /v2/claims` returns
`404 Cannot POST /v2/claims`. The docs' Claims page documents only two calls, both read-only:

| ✔ | Method | Path |
|---|---|---|
| ✔ | GET | `/v2/claims` — 200, `data.{total_count,total_result,claims[]}`, **empty** on our account |
| — | GET | `/v2/claims/{claimId}` — DOCS ONLY, `data.claim{}` |

**The `/v1/claims` 403 in the ground-truth doc was a v1 scope limit, not a wrong path.** Proven by
probing both with the same key: v1 → 403 `Forbidden resource`, v2 → 200.

MyCover files claims through a **hosted flow, not an API**. Every `purchase.successful` /
`policy.updated` webhook carries:

```json
"sdk": {
  "config": { "pk", "pid", "email", "phone", "action": "claim", "progress",
              "policy_id", "business_id", "claim_type", "customer_id",
              "first_name", "currency_code", "policy_number" },
  "claim_link":      "https://mycover.ai/purchase?q=<base64 of that config>",
  "inspection_link": "https://mycover.ai/purchase?q=<base64 …>"
}
```

The distributor redirects the member to `claim_link` (or reconstructs it from the **public** key
`MCAPUBK_*`). Claim progress then flows back over webhooks. **Design the Paymax claims module as
"store the link, deep-link the member, ingest webhooks" — not as a POST.**

Claim enums (**DOCS ONLY** — zero claims exist on our account, so none of these were observed live):

- `data.essential.status`: `Pending`, `Inspection submitted`, `Third party inspection submitted`,
  `Documented`, `Approved`, `Declined`, `Requested additional information`,
  `Submitted additional information`, `Repair estimate submitted`, `Offer sent`, `Offer accepted`,
  `Offer rejected`, `Paid`
- `data.essential.type`: `Vehicle`, `Gadget`, `Credit life`, `Travel`, `Life`, `Content`
- `data.meta.progress`: `submission`, `inspection`, `documentation`, `additional_info`,
  `third_party_inspection`, `technician_repair_estimate`, `repair_estimate`, `offer`, `status`

Mapping these onto the internal `Claim.status` enum (`submitted|under_review|approved|rejected|paid`)
is a lossy 13→5 collapse. Whoever builds the claims module owns that mapping table.

---

## 5. Webhooks

**DOCS ONLY throughout.** Our account has never received a webhook (zero policies).

### Signature — this closes the "empty webhook secret" gap

| Property | Value |
|---|---|
| Header | `x-mycoverai-signature` |
| Algorithm | **HMAC-SHA512**, hex digest |
| Key | **the distributor secret API key itself** — the `MCASECK_*` value |
| Message | the raw JSON body, compact (`JSON.stringify(body)` / `separators=(',',':')`) |

> `INSURANCE_MYCOVER_WEBHOOK_SECRET` being empty in `backend/.env` is **not** a missing credential.
> MyCover issues no separate webhook secret. Set it to the same value as
> `INSURANCE_MYCOVER_API_KEY`, and verify against the **raw** request body — never a re-serialised
> one, or the digest will not match.

Registration is dashboard-only (Settings → API Key & Webhooks). Multiple URLs may be registered,
`|`-separated; each receives a copy. Retries: up to 10, exponential backoff (30s, 1m, 2m, …) on any
non-2xx or a >60s response.

### Envelope

```json
{ "event": "<resource>.<action>", "status": "processed", "event_id": "<nanoid>",
  "data": { "meta": {…}, "essential": {…}, "sdk": {…}, "created_at": "", "updated_at": "" } }
```

### Event catalog

| Event | `data.essential` carries |
|---|---|
| `purchase.successful` | `email, amount, first_name, last_name, policy_id, product_id, customer_id, policy_number, expiration_date` (+ `meta.sum_insured`, `sdk.claim_link`, `sdk.inspection_link`) |
| `purchase.renewed` | same shape |
| `policy.updated` | same, **plus `certificate_url`** — this is where the certificate first appears |
| `claim.submitted` | `type, status, policy_id, product_id, customer_id, incident_date, claimant_email, claimant_first_name, claimant_last_name, description, additional_info` |
| `claim.approved` / `claim.disapproved` / `claim.offer_sent` / `claim.offer_rejected` / `claim.updated` | claim core + `status` |
| `inspection.completed` | `type, status, category, start_date, end_date, policy_id, is_approved, inspection_report_url` (+ `meta.inspection_images{front,rear,left,right,interior,dashboard,chassis_number}`, `video_url`, `geolocation`) |

`event_id` is a nanoid — use it as the webhook idempotency key.

---

## 6. Defects and traps found while mapping

### 6.1 Seven products are broken on MyCover's side — do not ship them

`compute-price` refuses them outright. **VERIFIED** live.

| Product | route_name | Error |
|---|---|---|
| Shop Content Cover | `aiico-shop-content-cover` | `Product purchase config doesn't exist` |
| Hospital Cash Cover | `aiico-hospital-cash` | `Product purchase config doesn't exist` |
| Home Content Cover (Leadway) | `leadway-home-content` | `Product purchase config doesn't exist` |
| Goods In Transit | `sti-goods-in-transit` | `Product purchase config doesn't exist` |
| Building Cover | `coronation-building-cover` | `Product sharing formula doesn't exist` |
| Life Cover | `coronation-life-cover` | `Product sharing formula doesn't exist` |
| Personal Accident Cover | `coronation-pac-cover` | `Product sharing formula doesn't exist` |

The four `purchase config` products **also return an empty schema** — `product_table_data` contains
nothing but `product_id`. They cannot be rendered, priced, or bought.

The three `sharing formula` products have complete schemas but `sharing_formula: null`, i.e. **no
distributor commission is configured**. Even if MyCover fixed pricing, Paymax would earn zero.

These carry `purchasable: false` and `provider_config_status: "broken"` in the catalog. Filter on
that field in the catalog-sync job; raise the seven with MyCover support.

### 6.2 `sti-third-party-bike` — the published schema is wrong

`compute-price` demands `value`, but `public-product-details` marks `value` optional. Live pricing
wins. Flagged as `schema_pricing_disagreement` on that product; treat `value` as required.
This is the only such disagreement in 69 products.

### 6.3 The R2/asset trap does not apply, but a file-upload trap does

`*_url` fields do **not** take an arbitrary URL. `POST /v2/utilities/files/upload` returns an
`upload_id` uuid, and that uuid is what the sample payloads put in `identification_url`
(`"00157dbf-aee8-4fb3-94c4-041f971b7c5b"`). Some sample payloads *also* show a full S3 URL. **The
upload endpoint was not probed live** — resolve which form is accepted before building the uploader.

### 6.4 `responseText` is polymorphic

String on success, **array of strings** on validation failure. Same field. Any Go/TS parser must
handle both or it will panic on the first 400.

### 6.5 The internal `Field` contract needs two additions

`INTERNAL-CONTRACT.md` defines `Field` without support for nesting. Real MyCover schemas need:

- **`children: Field[]`** — for `type: "object"` (e.g. the `policy_holder` block, which appears on
  ~65 products) and `type: "array"` repeating groups (`office_items[]`, `cargo_details[]`,
  `beneficiaries[]`, `item_details[]`).
- **`options_url` + `depends_on.query_param`** — for utility-backed dropdowns, including the
  dependent ones in §7.
- **`type: "hidden"`** — `product_id` is present on all 69 schemas but must never be rendered; the
  adapter fills it. The catalog emits it as `hidden` with `system: true`.
- **`type: "array"`** (distinct from `multiselect`) — a repeating group whose row shape is in
  `children`. 17 such fields exist across Content, Life and Package products.

The catalog already emits both, plus `mycover_type` so nothing is lost in translation.

---

## 7. Dependent dropdowns (utilities)

All return `{"responseCode":1,"data":[{"label":"…","value":"…"}]}` — **except the hospital list**.

| Utility | Path | Feeds | Options | Depends on | verified |
|---|---|---|---|---|---|
| Titles | `GET /v2/products/utility/d0ddc783-8b5c-4ca0-b757-6c7e308e42e3` | title | 21 | — | `200_live` |
| Titles (alt list) | `GET /v2/products/utility/f64b5088-c2ad-4e8f-bfc3-e200a3ba15be` | title | 11 | — | `200_live` |
| Vehicle categories | `GET /v2/products/utility/e5de0065-e07e-4bf2-838c-92d63d31b96d` | vehicle_category / vehicle_type | 8 | — | `200_live` |
| Vehicle categories (alt) | `GET /v2/products/utility/9bf69815-5a6f-4496-8a86-b164f2b90763` | vehicle_category | 4 | — | `200_live` |
| Vehicle makes | `GET /v2/products/utility/fa2fb85f-9d1a-4652-a136-9da8e4c57c5c` | vehicle_make | 109 | — | `200_live` |
| Vehicle models | `GET /v2/products/utility/86db5030-df01-4e2d-821b-e43e017f7e67` | vehicle_model | 0 | vehicle_make | `200_live` |
| Bike makes (no query) / bike models (?query=<make>) | `GET /v2/products/utility/1de14611-4595-4b1d-89d1-8b19a6a60832` | vehicle_make, vehicle_model | 33 | vehicle_make | `200_live` |
| Colours | `GET /v2/products/utility/7ebc1db1-b151-4477-b356-3c30855b7e03` | vehicle_color / device_color | 121 | — | `200_live` |
| Years of manufacture | `GET /v2/products/utility/4d30c7f6-4d5f-48e0-9be0-2da82ea68fc5` | year_of_manufacture | 29 | — | `200_live` |
| Nigerian states (no query) / LGAs (?query=<state>) | `GET /v2/products/utility/e55de863-7d98-4236-bd61-40328cd7f7fc` | state, lga, town | 38 | state | `200_live` |
| Device types | `GET /v2/products/utility/4211e856-3ca5-4d8c-9c3c-3d26fdda4ee2` | device_type | 3 | — | `200_live` |
| Countries | `GET /v2/products/utility/90868bf1-d614-440a-bc6a-a60b2133e784` | country_of_origin / destination | 177 | — | `200_live` |
| Nationalities | `GET /v2/products/utility/2ced52cc-edc9-4cfc-8810-1b9c6742e706` | nationality | 193 | — | `200_live` |
| Identification types | `GET /v2/products/utility/4edbbc73-2a95-4577-b6c8-6162018b4524` | identification_name | 4 | — | `200_live` |
| Payment / repayment plans | `GET /v2/products/utility/f8a4438b-38d2-42c1-9c64-eff6092b8449` | payment_plan, repayment_plan | 12 | — | `200_live` |
| Durations | `GET /v2/products/utility/85ea5388-64b7-4b44-827a-da8517f400c6` | repayment_plan | 6 | — | `200_live` |
| Genders | `GET /v2/utilities/genders` | gender | — | — | `200_live` |
| File upload (returns upload_id used for *_url fields) | `POST /v2/utilities/files/upload` | any *_url / image_url / identification_url field | — | — | `docs_only` |
| Hospital list (Bastion / Goxi health plans) | `GET /v2/products/utility/d37b42ac-4652-469e-a164-0aa1e6a0f265` | informational hospital/clinic list shown on health plans (NOT a form field) | 82 | — | `200_live` |

**VERIFIED dependent behaviour** — the child list is fetched with `?query=<parent value>`:

- `vehicle_model` ← `vehicle_make`. Without `query` the endpoint returns `[]`, which is exactly how a
  naive form renderer produces a permanently empty dropdown.
- **`e55de863-…` serves double duty:** no `query` → the 36 Nigerian states; `?query=Abia` → that
  state's LGAs. So `state` and `lga` share one utility id, and `lga` depends on `state`.
- **`1de14611-…` likewise:** no `query` → bike makes; `?query=Bajaj` → that make's models.

**Trap:** the hospital list (`d37b42ac-…`) returns `data` as an **object**
(`{name, hospitals:[{providerName,state,lga,address,email,phone}]}`), not a `[{label,value}]` array.
Do not route it through the generic option loader.

---

## 8. Product catalog

| # | Product | Category | Underwriter | route_name | MyCover `product_id` | Fields req/total | Purchasable | verified |
|---|---|---|---|---|---|---|---|---|
| 1 | Comprehensive Auto | Auto | AIICO Insurance Plc | `aiico-comprehensive` | `24140c74-fc6f-42f5-a0d2-24800b22d80a` | 23/27 | yes | `400_validation` |
| 2 | Comprehensive Auto | Auto | Coronation Insurance Plc | `coronation-comprehensive` | `45140c74-fc6f-42f5-a0d2-66800b22d999` | 20/25 | yes | `400_validation` |
| 3 | Comprehensive Auto | Auto | Sovereign Trust Insurance Plc | `sti-comprehensive` | `b0d0f39c-0b8a-452f-a876-78bef8de3347` | 23/27 | yes | `400_validation` |
| 4 | Comprehensive Auto | Auto | SanlamAllianz  Insurance | `sanlam-comprehensive` | `c94e6f4d-e868-4782-bb35-df6e3344ae7e` | 21/26 | yes | `400_validation` |
| 5 | Comprehensive Auto (AAS) | Auto | AIICO Insurance Plc | `None` | `24140c74-fc6f-42f5-a0d2-24800b22d81b` | 23/27 | yes | `400_validation` |
| 6 | Coronation Motor Max Bronze | Auto | Coronation Insurance Plc | `motor-max-bronze` | `4a62409b-442d-474f-b1bb-de6dc43df4ba` | 21/26 | yes | `400_validation` |
| 7 | Coronation Motor Max Gold | Auto | Coronation Insurance Plc | `coronation-motor-max-gold` | `d6d1efa6-9dc1-4c94-ba7a-25fdcc8f66e2` | 21/26 | yes | `400_validation` |
| 8 | Coronation Motor Max Silver | Auto | Coronation Insurance Plc | `coronation-motor-max-silver` | `ea93d1b3-a2ab-4291-bc1f-fc7e2ccdcf9a` | 21/26 | yes | `400_validation` |
| 9 | Micro Comprehensive Auto | Auto | Sovereign Trust Insurance Plc | `sti-micro-comprehensive` | `b0d0f4ad-0b8a-452f-a876-78bef8de3873` | 22/27 | yes | `400_validation` |
| 10 | Mini Comprehensive Auto | Auto | Sovereign Trust Insurance Plc | `sti-mini-comprehensive` | `0ced01f3-7698-4101-a244-dd5d70e974c4` | 25/30 | yes | `400_validation` |
| 11 | Monthly Comprehensive Auto | Auto | Sovereign Trust Insurance Plc | `sti-monthly-comprehensive` | `b0d0f39c-0b8a-452f-a876-78bef8de3862` | 23/27 | yes | `400_validation` |
| 12 | Third Party Auto | Auto | Coronation Insurance Plc | `coronation-third-party` | `56240c74-fc6f-42f5-a0d2-66800b22d99a` | 20/25 | yes | `400_validation` |
| 13 | Third Party Auto | Auto | AIICO Insurance Plc | `aiico-third-party-only` | `a72c4e3c-e868-4782-bb35-df6e3344ae6c` | 19/24 | yes | `400_validation` |
| 14 | Third Party Bike Cover | Auto | Sovereign Trust Insurance Plc | `sti-third-party-bike` | `c1e1f39c-0b8a-452f-a876-78bef8de4973` | 18/24 | yes | `400_validation` |
| 15 | Third-Party Auto | Auto | SanlamAllianz  Insurance | `sanlam-third-party-only` | `b83d5f4d-e868-4782-bb35-df6e3344ae7d` | 21/26 | yes | `400_validation` |
| 16 | Building Cover | Content | Coronation Insurance Plc | `coronation-building-cover` | `59340c74-fc6f-42f5-a0d2-66800b22dacc` | 12/13 | **NO** | `400_validation` |
| 17 | Home Content Cover | Content | AIICO Insurance Plc | `aiico-home-content-cover` | `0386fe30-a3be-4ff2-a64a-048d2c99504b` | 15/17 | yes | `400_validation` |
| 18 | Home Content Cover | Content | Coronation Insurance Plc | `coronation-home-content` | `48340c74-fc6f-42f5-a0d2-66800b22dabb` | 12/13 | yes | `400_validation` |
| 19 | Home Content Cover | Content | SanlamAllianz  Insurance | `sanlam-home-content` | `da5f7f6f-e868-4782-bb35-df6e3344ae7d` | 13/14 | yes | `400_validation` |
| 20 | Home Content Cover | Content | AIICO Insurance Plc | `leadway-home-content` | `fab6bda1-b870-4648-8704-11c0102a41c0` | 1/1 | **NO** | `400_validation` |
| 21 | HomeOwner (Building and Content) | Content | Coronation Insurance Plc | `homeowners-all-in-one-cover` | `7bf1c503-0d5c-4b6c-9ce0-9308b4d686a1` | 13/21 | yes | `400_validation` |
| 22 | HomeOwner (Content Only) | Content | Coronation Insurance Plc | `homeowners-content` | `d90daccd-8422-43b4-a668-095a974d31f5` | 13/20 | yes | `400_validation` |
| 23 | HouseHolder All-in-One | Content | Coronation Insurance Plc | `house-holder-all-in-one-cover` | `9ad9714a-940e-4d23-868c-15335a84c84a` | 13/20 | yes | `400_validation` |
| 24 | Office or Inventory Fire & Burglary | Content | Coronation Insurance Plc | `inventory-burglary-cover` | `34904ecf-2e45-4b02-b281-c6bf012991b4` | 14/16 | yes | `400_validation` |
| 25 | Shop Content Cover | Content | AIICO Insurance Plc | `aiico-shop-content-cover` | `58a6df7e-87f4-40e8-bf78-5b1f85c6d87f` | 1/1 | **NO** | `400_validation` |
| 26 | Device Cover | Gadget | Coronation Insurance Plc | `coronation-device` | `46240c74-fc6f-42f5-a0d2-66800b22d9aa` | 17/19 | yes | `400_validation` |
| 27 | FlexiGuard | Gadget | Sovereign Trust Insurance Plc | `sti-flexi-guard` | `88e7008e-0cb6-4559-a146-ee2bb9770c71` | 17/19 | yes | `400_validation` |
| 28 | FlexiGuard Mini | Gadget | Sovereign Trust Insurance Plc | `sti-flexi-guard-mini` | `1bd9437e-3654-49fc-88bb-ef270cd64c21` | 17/19 | yes | `400_validation` |
| 29 | FlexiGuard Plus | Gadget | Sovereign Trust Insurance Plc | `sti-flexi-guard-plus` | `01d11296-8f05-4ca6-9f8b-cb49d1e8b035` | 17/19 | yes | `400_validation` |
| 30 | Gadget Cover | Gadget | Sovereign Trust Insurance Plc | `mcg-gadget-cover` | `ffb0711c-1e4a-453b-a26c-2726e0a1a7bb` | 17/19 | yes | `400_validation` |
| 31 | Gadget Cover V2 | Gadget | Sovereign Trust Insurance Plc | `sti-gadget-cover` | `eec0711c-1e4a-453b-a26c-2726e0a1a7cc` | 17/19 | yes | `400_validation` |
| 32 | Laptop Insurance (Basic) | Gadget | Sovereign Trust Insurance Plc | `sti-laptop-cover-basic` | `5776bfc5-a387-4980-8ca4-708c0f083314` | 17/18 | yes | `400_validation` |
| 33 | Laptop Insurance (Standard) | Gadget | Sovereign Trust Insurance Plc | `sti-laptop-cover-standard` | `5886bfc5-a387-4980-8ca4-708c0f083325` | 17/18 | yes | `400_validation` |
| 34 | PrimeProtect | Gadget | Sovereign Trust Insurance Plc | `sti-prime-protect` | `ba773a8f-2072-4fa2-a8fb-bc7e0ab1e7b3` | 17/19 | yes | `400_validation` |
| 35 | PrimeProtect Plus | Gadget | Sovereign Trust Insurance Plc | `sti-prime-protect-plus` | `4ee0455d-2ffb-4b3b-8849-935d6269d9ad` | 17/19 | yes | `400_validation` |
| 36 | FlexiCare Mini Retail | Health | Bastion Health Ltd | `bastion-flexicare-mini` | `f7b4bca1-b870-4648-8704-11c1802a51d0` | 12/13 | yes | `400_validation` |
| 37 | FlexiCare Retail | Health | Bastion Health Ltd | `bastion-flexicare` | `e6b4bca1-b870-4648-8704-11c1802a51d0` | 12/13 | yes | `400_validation` |
| 38 | PrimeCare | Health | Bastion Health Ltd | `bastion-primecare` | `9786b349-3819-4fe3-8987-96b4d6214143` | 12/13 | yes | `400_validation` |
| 39 | PrimeCare Plus | Health | Bastion Health Ltd | `bastion-primecare-plus` | `0521ffe3-e7c1-4bfa-b90e-d69ab311ec98` | 12/13 | yes | `400_validation` |
| 40 | Seniors | Health | Bastion Health Ltd | `bastion-seniors` | `807dca29-d514-415d-abd9-1d2b9c532939` | 12/13 | yes | `400_validation` |
| 41 | Seniors Plus | Health | Bastion Health Ltd | `bastion-seniors-plus` | `604dca29-d514-415d-abd9-1d2b9c532844` | 12/13 | yes | `400_validation` |
| 42 | Seniors Prime | Health | Bastion Health Ltd | `bastion-seniors-premium` | `602dca29-d514-415d-abd9-1d2b9c532454` | 12/13 | yes | `400_validation` |
| 43 | Surgery and Outpatient Hospicash | Health | Goxi MicroInsurance Company Ltd  | `surgeryandoupatienthospicash` | `2cac2889-d886-46ff-a1fb-ea07f93b5344` | 18/19 | yes | `400_validation` |
| 44 | Surgery and Outpatient Hospicash Mini | Health | Goxi MicroInsurance Company Ltd  | `outpatient-hospicash-mini` | `c4f710e9-3f86-4983-b27a-4476532626bc` | 18/19 | yes | `400_validation` |
| 45 | ZenCare Plus Retail | Health | Bastion Health Ltd | `bastion-zencare-plus` | `cf74abd4-4727-43dc-b8d5-ca6fd824538b` | 12/13 | yes | `400_validation` |
| 46 | ZenCare Prime Retail | Health | Bastion Health Ltd | `bastion-zencare-prime` | `901dca29-d514-415d-abd9-1d2b9c532828` | 12/13 | yes | `400_validation` |
| 47 | ZenCare Retail | Health | Bastion Health Ltd | `bastion-zencare` | `7b6f82a3-c4bc-446d-9b81-4fa0849a1de1` | 12/13 | yes | `400_validation` |
| 48 | Accident Cover | Life | SanlamAllianz  Insurance | `sanlam-personal-accident` | `c94e6f5e-e868-4782-bb35-df6e3344ae7d` | 13/14 | yes | `400_validation` |
| 49 | Artisan Basic Insurance | Life | Goxi MicroInsurance Company Ltd  | `goxi-artisan-basic` | `5c99fa33-7fba-4862-89bb-e4d2ce3576e5` | 10/11 | yes | `400_validation` |
| 50 | Artisan Essential Insurance | Life | Goxi MicroInsurance Company Ltd  | `goxi-artisan-essential` | `193db6fb-1337-4d81-86ac-49c2bbc7d6e3` | 10/11 | yes | `400_validation` |
| 51 | Artisan Plus Insurance | Life | Goxi MicroInsurance Company Ltd  | `goxi-artisan-plus` | `ccf6c752-bf86-4b6b-a445-31c99db49b87` | 10/11 | yes | `400_validation` |
| 52 | CredPlus | Life | Goxi MicroInsurance Company Ltd  | `goxi-cred-plus` | `832df321-5e01-48a8-9f4d-7abfccf994be` | 17/20 | yes | `400_validation` |
| 53 | Credit Life | Life | SanlamAllianz  Insurance | `allianz-credit-life` | `f8b5bca1-b870-4648-8704-11c1802a51d0` | 13/14 | yes | `400_validation` |
| 54 | Default Insurance | Life | Goxi MicroInsurance Company Ltd  | `goxi-default-creditlife` | `40a56210-0f8d-4728-9162-268ad50ae87e` | 15/16 | yes | `400_validation` |
| 55 | Hospicash Basic | Life | Goxi MicroInsurance Company Ltd  | `goxi-hospicash-plus` | `62543e4a-1a89-4977-8c6c-3488ab05bcb4` | 15/16 | yes | `400_validation` |
| 56 | Hospital Cash Cover | Life | AIICO Insurance Plc | `aiico-hospital-cash` | `cfee22e7-5aa1-4413-ba66-8ac5d550c69e` | 1/1 | **NO** | `400_validation` |
| 57 | Life Cover | Life | Coronation Insurance Plc | `coronation-life-cover` | `77240c74-fc6f-42f5-b2d2-66800b22d9bb` | 13/14 | **NO** | `400_validation` |
| 58 | Life Cover | Life | Bastion Health Ltd | `tangerine-life` | `ecc0631e-c151-4c0e-944c-a1faf94cd1fc` | 14/15 | yes | `400_validation` |
| 59 | Personal Accident Cover | Life | Coronation Insurance Plc | `coronation-pac-cover` | `88240c74-fc6f-42f5-b2d2-77800b22d911` | 12/13 | **NO** | `400_validation` |
| 60 | TripCover | Life | Goxi MicroInsurance Company Ltd  | `traveller-accident-basic-cover` | `1979d44d-a487-4b9a-a94a-ca14221eabe1` | 15/16 | yes | `400_validation` |
| 61 | TripCover Plus | Life | Goxi MicroInsurance Company Ltd  | `traveller-essential-cover` | `246bab8b-25f1-4eba-a899-27990eddc0d3` | 15/16 | yes | `400_validation` |
| 62 | TripCover Prime | Life | Goxi MicroInsurance Company Ltd  | `traveller-plus-cover` | `a3af8e07-2741-45d2-ab80-e515736d320d` | 15/16 | yes | `400_validation` |
| 63 | Annual Goods In Transit | Package | Sovereign Trust Insurance Plc | `sti-git-annual` | `6e417faa-e042-4768-8d5d-916fd531a478` | 13/14 | yes | `400_validation` |
| 64 | Goods In Transit | Package | Sovereign Trust Insurance Plc | `sti-goods-in-transit` | `b0d0f39c-0b8a-452f-a876-78bef8dde1d9` | 1/1 | **NO** | `400_validation` |
| 65 | Marine Cover (Import and export) | Package | Sovereign Trust Insurance Plc | `sti-marine-cover` | `d2e1f4ad-0b8a-452f-a876-78bef8dde1d9` | 16/21 | yes | `400_validation` |
| 66 | Marine Cover Capped (Import and export) | Package | Sovereign Trust Insurance Plc | `sti-marine-cover-capped` | `252c66de-6e87-4109-a515-83ee142fe70c` | 16/21 | yes | `400_validation` |
| 67 | On Demand Goods In Transit | Package | Sovereign Trust Insurance Plc | `sti-git-on-demand` | `e6bd69d9-eaa7-4420-a2dd-7f3305bd5b80` | 16/17 | yes | `400_validation` |
| 68 | On Demand Goods In Transit (Capped) | Package | Sovereign Trust Insurance Plc | `sti-git-on-demand-capped` | `4ca89151-78e9-4cda-9a3b-20f759f89a41` | 16/17 | yes | `400_validation` |
| 69 | Travel Cover | Travel | SanlamAllianz  Insurance | `allianz-travel-cover` | `c0e104ad-0b8a-452f-a876-78bef8dde1db` | 23/26 | yes | `400_validation` |

---

## 9. Per-category field summaries

_`product_id` is omitted below: it is a `hidden` system field present on every product._

### Auto — 15 products

- **Required in every Auto product:** `address`, `bought_for_self`, `chassis_number`, `date_of_birth`, `email`, `engine_number`, `first_name`, `gender`, `last_name`, `phone_number`, `registration_number`, `vehicle_category`, `vehicle_color`, `vehicle_make`, `vehicle_model`, `year_of_manufacture`
- **Required in some:** `title` (11/15), `value` (8/15), `identification_url` (8/15), `id_image_url` (7/15), `state` (5/15), `vehicle_license_url` (5/15), `vehicle_value` (5/15), `occupation` (4/15), `vehicle_insurance_type` (4/15), `payment_plan` (3/15), `nin` (2/15), `is_business_policy` (2/15), `other_names` (1/15), `town` (1/15)
- **Field types used:** `select`×144, `text`×80, `file`×43, `email`×15, `phone`×15, `date`×15, `address`×15, `nin`×15, `object`×15, `money`×14, `image`×7

### Content — 10 products

- **Required in every Content product:** _none_
- **Required in some:** `first_name` (8/10), `last_name` (8/10), `email` (8/10), `phone_number` (8/10), `gender` (8/10), `date_of_birth` (8/10), `address` (8/10), `bought_for_self` (8/10), `utility_bill_url` (4/10), `occupation` (4/10), `title` (3/10), `items` (3/10), `customer_type` (3/10), `identification_name` (2/10), `identification_url` (2/10), `sum_insured` (2/10), `cover_type` (2/10), `lga` (1/10), `description` (1/10), `cac` (1/10), `contents` (1/10), `include_larceny` (1/10), `value` (1/10), `state` (1/10)
- **Field types used:** `select`×29, `text`×25, `file`×13, `array`×10, `email`×8, `phone`×8, `date`×8, `address`×8, `object`×8, `money`×3, `nin`×3, `multiselect`×3

### Gadget — 10 products

- **Required in every Gadget product:** `address`, `bought_for_self`, `date_of_birth`, `device_color`, `device_make`, `device_model`, `device_type`, `email`, `first_name`, `gender`, `last_name`, `phone_number`, `serial_number`, `value`
- **Required in some:** `image_url` (9/10), `device_purchase_date` (9/10), `title` (1/10), `model_number` (1/10)
- **Field types used:** `text`×59, `select`×41, `date`×19, `email`×10, `phone`×10, `address`×10, `money`×10, `object`×10, `image`×9

### Health — 12 products

- **Required in every Health product:** `address`, `bought_for_self`, `date_of_birth`, `email`, `first_name`, `gender`, `last_name`, `nin`, `payment_plan`, `phone_number`
- **Required in some:** `image_url` (10/12), `benefits` (2/12), `occupation` (2/12), `nok_full_name` (2/12), `nok_phone_number` (2/12), `nok_relationship` (2/12), `nok_address` (2/12), `hmo_id` (2/12)
- **Field types used:** `select`×36, `text`×32, `phone`×14, `address`×14, `email`×12, `date`×12, `nin`×12, `object`×12, `image`×10, `multiselect`×2

### Life — 15 products

- **Required in every Life product:** _none_
- **Required in some:** `first_name` (14/15), `last_name` (14/15), `email` (14/15), `phone_number` (14/15), `gender` (14/15), `date_of_birth` (14/15), `address` (14/15), `bought_for_self` (14/15), `occupation` (4/15), `nok_full_name` (4/15), `nok_phone_number` (4/15), `nok_address` (4/15), `sum_insured` (4/15), `payment_plan` (4/15), `take_off_point` (3/15), `destination` (3/15), `transportation_mode` (3/15), `repayment_plan` (2/15), `title` (2/15), `beneficiaries` (2/15), `disbursement_date` (1/15), `loan_id` (1/15), `employment_type` (1/15), `nok_relationship` (1/15)
- **Field types used:** `text`×50, `select`×45, `phone`×19, `address`×19, `date`×16, `email`×14, `object`×14, `money`×6, `array`×3, `file`×1, `nin`×1, `multiselect`×1

### Package — 6 products

- **Required in every Package product:** _none_
- **Required in some:** `first_name` (5/6), `last_name` (5/6), `email` (5/6), `phone_number` (5/6), `gender` (5/6), `date_of_birth` (5/6), `address` (5/6), `bought_for_self` (5/6), `shipping_date` (4/6), `item_details` (4/6), `total_value` (4/6), `mode_of_transport` (3/6), `firstloss_payee` (3/6), `country_of_origin` (2/6), `destination_country` (2/6), `pickup_location` (2/6), `drop_off_location` (2/6), `vehicle_plate_number` (2/6), `vehicle_type` (2/6), `limit_per_trip` (1/6), `number_of_monthly_trips` (1/6)
- **Field types used:** `text`×19, `select`×19, `date`×9, `file`×8, `email`×5, `phone`×5, `address`×5, `money`×5, `object`×5, `array`×4, `number`×1

### Travel — 1 products

- **Required in every Travel product:** `address`, `arrival_date`, `bought_for_self`, `date_of_birth`, `departure_date`, `destination`, `email`, `first_name`, `gender`, `image_url`, `last_name`, `marital_status`, `nationality`, `nok_address`, `nok_full_name`, `nok_phone_number`, `nok_relationship`, `occupation`, `passport_number`, `phone_number`, `state`, `title`
- **Required in some:** _none_
- **Field types used:** `text`×7, `select`×7, `date`×3, `phone`×2, `address`×2, `email`×1, `image`×1, `nin`×1, `object`×1

---

## 10. Legacy v1 family endpoints (probed, for the record — do not build on these)

138 candidate paths were probed on `https://api.mycover.ai/v1`. 119 returned
`404 Cannot POST …`; 19 exist:

| HTTP | Legacy v1 path | Meaning |
|---|---|---|
| 500 | `POST /v1/products/aiico/buy-home-content-cover` | `exists_but_500` |
| 400 | `POST /v1/products/aiico/buy-office-content-cover` | `400_validation` |
| 403 | `POST /v1/products/aiico/buy-shop-content-cover` | `scope_blocked` |
| 400 | `POST /v1/products/bastion/buy-medisure` | `400_validation` |
| 403 | `POST /v1/products/coronation/buy-building-cover` | `scope_blocked` |
| 400 | `POST /v1/products/coronation/buy-comprehensive` | `400_validation` |
| 400 | `POST /v1/products/coronation/buy-home-content` | `400_validation` |
| 403 | `POST /v1/products/leadway/buy-home-content` | `scope_blocked` |
| 400 | `POST /v1/products/mcg/buy-gadget-cover` | `400_validation` |
| 403 | `POST /v1/products/sanlam/buy-home-content` | `scope_blocked` |
| 403 | `POST /v1/products/sanlam/buy-personal-accident` | `scope_blocked` |
| 400 | `POST /v1/products/sti/buy-comprehensive` | `400_validation` |
| 400 | `POST /v1/products/sti/buy-gadget-cover` | `400_validation` |
| 403 | `POST /v1/products/sti/buy-goods-in-transit` | `scope_blocked` |
| 400 | `POST /v1/products/sti/buy-laptop-cover-standard` | `400_validation` |
| 400 | `POST /v1/products/sti/buy-marine-cover` | `400_validation` |
| 400 | `POST /v1/products/sti/buy-micro-comprehensive` | `400_validation` |
| 400 | `POST /v1/products/sti/buy-monthly-comprehensive` | `400_validation` |
| 400 | `POST /v1/products/sti/buy-third-party-bike` | `400_validation` |

Two facts worth keeping:

- The family slug is **not** derivable from `route_name`. `/products/aiico/buy-office-content-cover`
  is live even though no product is named "Office Content"; `/products/bastion/buy-medisure` is live
  even though no product named "MediSure" is in either catalog. Family names are their own namespace.
- Every family path takes `product_id` in the body to pick the plan — the family concept is real, it
  is just obsolete now that v2 collapses all of them into `POST /v2/products/buy`.

---

## 11. UNKNOWN / BLOCKED — everything not verified, and why

| Item | Status | Why it could not be verified |
|---|---|---|
| `GET /v2/policies/{uuid}` response shape | **DOCS ONLY** | Our distributor account holds **zero** policies. There is no real uuid to fetch. The field list in the catalog is transcribed from the docs sample and has never been observed. Re-probe immediately after the first real purchase. |
| `GET /v2/claims/{id}` response shape | **DOCS ONLY** | Zero claims on the account |
| Claim `status` / `type` / `progress` enums | **DOCS ONLY** | Never observed live |
| All webhook payloads and event names | **DOCS ONLY** | No webhook has ever been delivered to us. Webhook URL registration is dashboard-only and nothing is registered |
| Webhook signature algorithm | **DOCS ONLY** | Cannot be verified without a delivery. The HMAC-SHA512-with-the-API-key recipe is from the docs and is unproven against a real request |
| `POST /v2/utilities/files/upload` | **DOCS ONLY** | Not probed — would require uploading a real file. **Whether `*_url` fields want the returned `upload_id` uuid or a full URL is unresolved**, and the sample payloads are inconsistent about it |
| A successful `200` from `/v2/products/buy` or `/compute-price` | **NOT ATTEMPTED** | Both were probed only with deliberately incomplete bodies. A full body would create a real (test-mode) policy; that is a decision for the integration owner, not the cartographer |
| `GET /v2/customers/*` sub-resources | **DOCS ONLY** | Zero customers on the account |
| Renewal flow | **PARTIAL** | `renewal_table_data` is present but **empty for every one of the 69 products**, and `renewal_sample_payload` is `{}`. No renewal endpoint is documented anywhere. How renewal is triggered is unknown |
| Cancellation / refund | **UNKNOWN** | No endpoint documented, none found. The internal contract's `POST /policies/:id/cancel` has **no MyCover counterpart** |
| Certificate retrieval | **PARTIAL** | `certificate_url` arrives on the policy object and on the `policy.updated` webhook. There is no `GET /certificate` endpoint. The internal contract's `GET /policies/:id/certificate` must read the stored URL |
| Idempotency | **UNKNOWN** | MyCover documents **no** idempotency-key header on `/v2/products/buy`. Paymax's iron rule requires one on every money mutation, so idempotency must be enforced **entirely on our side** — a local key that guards the outbound call and is safe to replay |
| Inspection submission | **DOCS ONLY** | Same hosted-link pattern as claims (`sdk.inspection_link`). `is_inspectable` products (STI/Coronation comprehensive auto) do not activate until inspection completes — a real UX dependency |
| `GET /v1/claims` 403 | **RESOLVED** | Scope limit on v1, not a wrong path. `/v2/claims` is 200 for the same key |
| `payment_providers` / Paystack channel data | **NOT PROBED** | Present on v1 catalog records; no endpoint exercised. Paymax charges the member itself, so this is likely irrelevant |

### Immediate follow-ups for whoever owns the integration

1. Point the adapter at `https://v2.api.mycover.ai/v2`. The current default
   (`https://api.sandbox.mycover.ai/v1`) does not resolve, and `INSURANCE_MYCOVER_BASE_URL` is empty
   in `backend/.env`, so the wrong default is what runs today.
2. Set `INSURANCE_MYCOVER_WEBHOOK_SECRET = INSURANCE_MYCOVER_API_KEY` (§5) and register a webhook URL
   in the MyCover dashboard — nothing is registered, so no event can reach us.
3. Sync the catalog from `/v2/products/all` (69), not the v1 endpoint (68).
4. Exclude the 7 broken products (§6.1) and raise them with MyCover.
5. Make one real test purchase, then re-probe `GET /v2/policies/{uuid}` and capture the first real
   webhook. That single purchase converts most of this table from DOCS ONLY to VERIFIED.
