# PRD — Paymax Micro-Insurance Integration (Insurance Service v1)

**Product:** Paymax Super-App — Insurance & Protection module
**Provider rails:** MyCover.ai (consumer/fintech/Spotlight) + Octamile (mobility/logistics)
**Author:** Product (on behalf of CEO, Spotlight/Paymax)
**Status:** Draft for build · **Doc owner:** Insurance Product Lead
**Stack baseline:** Go services · React Native client · PostgreSQL + PostGIS · existing Paymax platform primitives

---

## 0. Document control

| Field | Value |
|---|---|
| Version | 1.0 (build-ready) |
| Regulatory baseline | NIIRA 2025; NAICOM Insurtech Operations Guidelines (effective 1 Aug 2025); NDPA 2023 |
| Integration model | Partnering Insurtech / distribution channel — **no underwriting risk held by Paymax** |
| Net-new services | `insurance-svc`, `underwriter-gateway`, `insurance-admin` |
| Reused platform primitives | Identity/SSO, KYC, Wallet ledger, Virtual accounts, Bill-pay, Payouts, Agent network, Notifications, Document store |
| Depends on | Transport & Logistics module (Octamile event bindings), Connect/SME profiles (MyCover bindings) |

---

## 1. Executive summary

Paymax will embed micro-insurance as a native capability, not a bolt-on. Underwriting stays with NAICOM-licensed insurers; Paymax distributes through two embedded-insurance aggregators via a single provider-agnostic gateway. The product line determines the rail:

- **MyCover.ai** — general micro-insurance, wallet insurance, health, personal accident, credit-life, device, SME, and Spotlight events/contestants cover.
- **Octamile** — ride-hailing, logistics, parcel delivery, bus booking, vehicle/motor, goods-in-transit (GIT), and driver/rider/passenger protection.

The integration reuses Paymax's existing wallet ledger (premium debit + claims credit), KYC (insurer data requirements), bill-pay (recurring premium), payouts (claims disbursement), and agent network (assisted sales). The net-new build is an `insurance-svc` plus an `underwriter-gateway` abstraction — the same provider-agnostic pattern already proven by `MapService` — so a third rail (e.g. Curacel or a direct insurer) can be added later as a config change, not a re-architecture.

The strategic case: insurance penetration in Nigeria sits at roughly 0.5% of the population (NAICOM). Paymax already holds the three things that historically block distribution — verified identity (KYC), a funded wallet for friction-free premium collection, and an agent network for the informal market. Embedding cover at the moment of need (a ride starting, a parcel shipped, a loan disbursed, a contestant signing on) converts that distribution advantage directly into gross written premium and recurring fee/commission revenue.

---

## 2. Strategic rationale & market context

- **Underserved market.** Only ~0.5% of Nigerians hold insurance (NAICOM); embedded distribution through high-frequency fintech touchpoints is the recognised lever to break the sub-1% ceiling.
- **Distribution moat.** Paymax's KYC + wallet + agent network removes the three classic frictions: identity capture, premium collection, and last-mile reach into the informal/cash economy.
- **Event-native cover.** Octamile binds protection onto transport/logistics lifecycle events (trip start, parcel booked, driver onboarded). MyCover binds onto financial lifecycle events (wallet funded, loan disbursed, device purchased, contestant enrolled). Insurance becomes a *feature*, not a separate purchase.
- **Revenue.** Commission/revenue-share on every premium collected, plus float and re-engagement value. Both rails operate a share-of-premium model and settle programmatically.
- **Regulatory tailwind.** NAICOM's Insurtech Operations Guidelines (effective 1 Aug 2025) formalise the **Partnering Insurtech** route, giving Paymax a clean, low-capital path to distribute through licensed aggregators and insurers without holding underwriting risk.

---

## 3. Goals, non-goals, success metrics

### 3.1 Goals
1. Single in-app Insurance & Protection surface across both rails, with a unified policy wallet and claims tracker.
2. Provider-agnostic gateway: add/replace/route underwriters by configuration, never by branching business logic.
3. Voluntary (user-initiated) **and** embedded (event-triggered) cover, both reusing the wallet ledger for money movement.
4. End-to-end policy lifecycle: quote → bind → active → renew/lapse/cancel, with claims FNOL → assessment → settlement → payout.
5. Full reconciliation and commission ledger against each provider; immutable audit for every state change.

### 3.2 Non-goals (v1)
- Paymax acting as underwriter or risk carrier (explicitly out — Partnering Insurtech only).
- Building proprietary actuarial pricing (pricing comes from providers/underwriters).
- Standalone Insurtech licence (revisit post-scale if economics justify).
- Group/corporate policy administration beyond SME single-entity cover (Phase 3+).

### 3.3 Success metrics
| Metric | Target (first 2 quarters live) |
|---|---|
| Embedded attach rate (transport/parcel trips with cover) | ≥ 30% |
| Voluntary policy activation (Insurance surface visitors → bind) | ≥ 8% |
| Premium collection success (wallet debit first attempt) | ≥ 97% |
| Claims FNOL → payout median | ≤ provider SLA (Octamile motor target: ≤ 60 min for fast-track) |
| Reconciliation break rate (unmatched premium/commission lines) | < 0.5% |
| Policy issuance failure after successful debit (must auto-reverse) | 0 unresolved > 24h |

---

## 4. Provider split & responsibility matrix

Routing is **config-driven** off the product line. Each catalog product carries a `provider` and `provider_product_code`; the gateway resolves the adapter at runtime.

| Product line | Provider | Binding mode | Primary trigger |
|---|---|---|---|
| General micro-insurance | MyCover.ai | Voluntary | Insurance surface |
| Wallet insurance (balance/fraud protection) | MyCover.ai | Embedded + voluntary | Wallet funded / opt-in |
| Health (micro-health / HMO) | MyCover.ai | Voluntary | Insurance surface, agent |
| Personal accident | MyCover.ai | Voluntary + embedded | Insurance surface, payroll |
| Credit-life | MyCover.ai | Embedded | Loan disbursement |
| Device / gadget | MyCover.ai | Embedded + voluntary | Device purchase / opt-in |
| SME cover | MyCover.ai | Voluntary | SME profile |
| Spotlight events | MyCover.ai | Embedded | Event creation/ticketing |
| Spotlight contestants | MyCover.ai | Embedded | Contestant enrolment |
| Ride-hailing (driver/rider/passenger) | Octamile | Embedded (per-trip / annual) | Trip lifecycle |
| Logistics / haulage | Octamile | Embedded | Job/consignment booking |
| Parcel delivery | Octamile | Embedded (per-parcel) | Parcel booking |
| Bus booking (interstate/intrastate) | Octamile | Embedded (per-seat/trip) | Seat booking |
| Vehicle / motor (3rd-party + comprehensive) | Octamile | Voluntary + embedded | Vehicle onboarding |
| Goods-in-transit (GIT) | Octamile | Embedded (per-shipment) | Shipment created |
| Driver / rider protection | Octamile | Embedded (annual/onboarding) | Partner onboarding |
| Passenger protection | Octamile | Embedded (per-trip) | Trip start |

**Rule of thumb:** if the product attaches to a *journey of goods or people* → Octamile. If it attaches to a *financial or identity event, or the Spotlight ecosystem* → MyCover.ai. The routing table is the single source of truth; no product line is hard-coded into a service.

---

## 5. Regulatory & compliance posture

**Position: Partnering Insurtech / distribution channel under NAICOM Insurtech Operations Guidelines (effective 1 Aug 2025), operating under NIIRA 2025.** Paymax does not underwrite, does not hold premium reserves, and does not assume risk. All cover is underwritten by NAICOM-licensed insurers contracted through MyCover.ai and Octamile, both of which operate with insurer partners and bear the aggregator-side compliance.

Compliance requirements baked into the build:
- **Underwriter disclosure.** Every quote and policy must display the underwriting insurer and the aggregator — surfaced from the provider API, never hard-coded.
- **Premium handling.** Premium debited from the Paymax wallet is remitted to the provider on the provider's terms; Paymax holds **no** premium float beyond settlement timing. Modelled as pass-through ledger entries, not Paymax revenue.
- **Commission only.** Paymax revenue is the agreed share-of-premium / distribution commission, recorded on a separate ledger account distinct from premium.
- **Policy documents.** Certificate/schedule PDFs returned by the provider are stored in the access-controlled document store and surfaced read-only to the user.
- **Data protection (NDPA 2023).** Explicit consent before sharing KYC/PII with a provider; consent is versioned and logged; data minimisation — share only fields the provider's product requires.
- **Cooling-off / cancellation.** Honour provider cancellation and refund rules; refunds route back to wallet via reversing ledger entries.
- **Complaints.** In-app complaint capture mapped to provider/insurer complaint channels; track to NAICOM consumer-protection expectations.

> Confirm the contractual chain in writing with each provider: which named NAICOM-licensed insurer underwrites each product line, and whether Paymax is recorded as agent, distribution partner, or web-aggregator-equivalent. This determines disclosure wording and the commission tax treatment. (Open decision D-1.)

---

## 6. System architecture — REUSE vs NET-NEW

The hard line Paymax always draws: what already exists on the platform vs what we build.

### 6.1 REUSE — existing platform primitives (no rebuild)

| Primitive | How Insurance uses it |
|---|---|
| **Identity / SSO (single-identity, multi-capability)** | Policyholder = existing `User`. "Insured" is a **capability**, not a new account. No duplicate identity. |
| **KYC service** | Providers require name/DOB/ID/phone/address. Pull from KYC; gate products on the required verification tier; never re-collect what KYC holds. |
| **Wallet ledger (append-only)** | Premium = debit entry; claim payout = credit entry; refund = reversing entry. Balances stay derived, never mutated directly. |
| **Virtual accounts** | Fund-on-demand for premium where wallet balance is short; existing top-up rails. |
| **Bill-pay / scheduled payments** | Recurring premium (monthly micro-health, annual motor) runs on the existing scheduler — insurance is just another biller category. |
| **Payouts** | Claims settlement to wallet or bank uses the existing payout rails and limits. |
| **Agent network** | Assisted sales for the informal market; agent attaches policies to customer identity; commission via existing agent ledger. |
| **Notifications** | Quote, bind confirmation, premium due, renewal, claim status — existing multi-channel (push/SMS/in-app). |
| **Document store (signed URLs)** | Certificates, schedules, claim evidence — access-controlled, signed-URL delivery. |
| **Audit log** | Immutable actor/entity/action/before-after/timestamp records for every insurance state change. |

### 6.2 NET-NEW — what we build

| Component | Responsibility |
|---|---|
| **`insurance-svc` (Go)** | Domain owner: catalog, quotes, policies, beneficiaries, claims, renewals. Source of truth for insurance state. |
| **`underwriter-gateway` (Go)** | Provider-agnostic abstraction. One internal interface; per-provider adapters (`MyCoverAdapter`, `OctamileAdapter`). Handles auth, mapping, retries, idempotency, webhook ingestion. **Mirrors the `MapService` pattern.** |
| **Catalog & routing config** | Versioned product definitions + `product_line → provider` routing table + per-product field schema. Data, not code. |
| **Quote engine (thin)** | Requests quotes from the routed provider, normalises responses, caches with TTL. No proprietary pricing. |
| **Policy lifecycle manager** | Guarded state machine: quote → bind → active → renew/lapse/cancel. |
| **Claims orchestrator** | FNOL intake, evidence upload, provider hand-off, status sync, payout trigger. |
| **Embedded-binding engine** | Subscribes to platform events (trip start, parcel booked, loan disbursed, contestant enrolled) and binds the mapped cover automatically. |
| **Reconciliation & settlement** | Matches premium remittances and commission against provider statements; flags breaks. |
| **Commission ledger** | Separate ledger accounts for premium pass-through vs Paymax commission. |
| **`insurance-admin` (web)** | Ops console: catalog management, routing, policy/claim search, reconciliation, provider health, audit export. |

---

## 7. Provider-agnostic gateway (`underwriter-gateway`)

The whole point: services talk to **one** interface; providers sit behind adapters; routing is config. Same shape as the existing `MapService` provider abstraction.

```go
// One interface. Adapters per provider. Routing decided by catalog config.
type UnderwriterGateway interface {
    GetQuote(ctx, QuoteRequest)        (Quote, error)
    BindPolicy(ctx, BindRequest)       (Policy, error)   // idempotent (idempotency_key)
    GetPolicy(ctx, providerPolicyRef)  (Policy, error)
    CancelPolicy(ctx, CancelRequest)   (Cancellation, error)
    SubmitClaim(ctx, ClaimRequest)     (Claim, error)    // FNOL
    GetClaim(ctx, providerClaimRef)    (Claim, error)
    UploadEvidence(ctx, EvidenceRequest) (EvidenceRef, error)
    VerifyWebhook(payload, signature)  (Event, error)
}

// Adapters: MyCoverAdapter, OctamileAdapter (CuracelAdapter = future, no core change)
// Resolver: product.provider -> adapter, via routing table.
func (r *Router) Resolve(productCode string) (UnderwriterGateway, ProviderProductCode)
```

Design rules:
- **Idempotency is non-negotiable.** Every `BindPolicy` / `SubmitClaim` / payout carries an idempotency key; retries and double-submits never double-bind or double-pay.
- **Normalised models in, normalised models out.** Provider-specific JSON never leaks past the adapter. The rest of Paymax sees one `Policy`, one `Claim`, one `Quote` shape.
- **Webhook-first status.** Policy and claim status changes arrive primarily via provider webhooks (signature-verified), with a reconciliation poller as backstop for missed events.
- **Graceful degradation.** Provider down → voluntary flows show "temporarily unavailable" and never debit; embedded flows queue the bind and retry (with a hard "no cover until confirmed" guarantee surfaced to the user).
- **Secrets** (provider API keys, webhook secrets) live in the secrets manager, scoped per provider, never logged.

---

## 8. Product catalog

Every product is a versioned config record. Adding a product = data change.

```yaml
# Example catalog entry (illustrative shape)
product:
  code: "octamile.git.parcel.v1"
  display_name: "Parcel Protection (Goods-in-Transit)"
  product_line: "GOODS_IN_TRANSIT"
  provider: "OCTAMILE"
  provider_product_code: "<from Octamile catalog>"
  binding_mode: "EMBEDDED_PER_SHIPMENT"
  underwriter_display: "<surfaced from provider>"   # never hard-coded
  premium_model: "PER_SHIPMENT"                      # or FLAT, TIERED, USAGE
  required_kyc_tier: "TIER_1"
  required_fields_schema_ref: "schema/git_parcel/v1"
  sum_insured_rules: { basis: "declared_value", min: 1000, max: 500000 }
  cancellation_policy_ref: "octamile.default"
  active: true
```

### 8.1 MyCover.ai rail
General micro-insurance · wallet insurance · micro-health/HMO · personal accident · credit-life · device/gadget · SME cover · Spotlight events · Spotlight contestants. (MyCover's open insurance API exposes 30+ products across partner insurers; map only the lines above in v1.)

### 8.2 Octamile rail
Ride-hailing protection (driver/rider/passenger) · logistics & haulage · parcel delivery · bus booking · vehicle/motor (compulsory third-party + comprehensive) · goods-in-transit (warehouse-to-warehouse, freight) · driver/rider protection · passenger protection. (Octamile's embedded API + claims automation — FNOL, remote inspection, fast payout — is purpose-built for mobility/logistics.)

> Final per-product codes, premium models, sum-insured bands, and field schemas come from each provider's live catalog during integration. Catalog is seeded from provider sandbox, then promoted. (Task in Phase 1.)

---

## 9. Domain & data model

Model the domain first; make illegal states unreachable via constraints + guarded transitions.

### 9.1 Core entities

```
InsuranceProduct        (catalog; versioned; provider + routing)
QuoteRequest / Quote    (ephemeral; TTL; provider ref)
Policy                  (durable; policyholder=User; provider_policy_ref; state)
PolicyVersion           (endorsements/renewals; immutable history)
Beneficiary             (per policy; for life/PA/credit-life)
PremiumSchedule         (one-off or recurring; links to bill-pay)
PremiumTransaction      (ledger reference; debit; status)
Claim                   (FNOL; provider_claim_ref; state)
ClaimEvidence           (document refs; signed URLs)
ClaimPayout             (ledger reference; credit; status)
ProviderEvent           (raw webhook log; signature-verified; idempotent)
CommissionEntry         (Paymax revenue ledger; separate from premium)
ReconciliationRecord    (premium/commission match vs provider statement)
ConsentRecord           (NDPA; versioned; per data-share)
```

### 9.2 Key tables (essential columns)

**`policy`**
`id` · `policyholder_user_id` (FK) · `product_code` (FK catalog) · `provider` · `provider_policy_ref` (unique per provider) · `binding_mode` · `state` (enum) · `sum_insured` · `premium_amount` · `currency` · `effective_at` · `expires_at` · `source_event_id` (nullable; for embedded) · `capability_id` (insured capability on the user) · `created_at` · `updated_at` · `version` (optimistic lock)
- Unique: `(provider, provider_policy_ref)`
- Index: `(policyholder_user_id, state)`, `(product_code, state)`, `(expires_at)` for renewal sweeps
- Check: `state` ∈ enum; `expires_at > effective_at`

**`premium_transaction`**
`id` · `policy_id` (FK) · `wallet_ledger_ref` (FK to wallet entry) · `idempotency_key` (unique) · `amount` · `direction` (DEBIT) · `status` · `provider_remittance_ref` · `created_at`
- Unique: `idempotency_key`

**`claim`**
`id` · `policy_id` (FK) · `provider_claim_ref` (unique per provider) · `state` (enum) · `loss_event_at` · `reported_at` · `claimed_amount` · `approved_amount` · `payout_ledger_ref` (nullable) · `idempotency_key` · `created_at` · `updated_at` · `version`

**`provider_event`**
`id` · `provider` · `event_type` · `external_event_id` (unique per provider — idempotent ingest) · `signature_verified` (bool) · `payload_ref` · `processed_at`
- Unique: `(provider, external_event_id)` → drops duplicate webhooks

**`commission_entry`**
`id` · `policy_id` · `premium_transaction_id` · `commission_amount` · `commission_basis` · `revenue_ledger_ref` · `reconciled` (bool) · `created_at`

Constraints encode the rules: a policy can't be `ACTIVE` without a settled premium transaction; a claim can't have a `payout_ledger_ref` unless `state = SETTLED`; premium and commission live on **different** ledger accounts.

---

## 10. State machines

Status only ever changes through guarded, atomic transitions with side effects + audit. No ad-hoc status writes.

### 10.1 Policy lifecycle
```
QUOTED ─► PENDING_PAYMENT ─► BINDING ─► ACTIVE
   │            │               │          ├─► RENEWAL_DUE ─► ACTIVE (renewed)
   │            │               │          │                └─► LAPSED (premium fail)
   │            │               │          ├─► CANCELLED (user/provider; refund)
   │            │               │          └─► EXPIRED (term end)
   │            │               └─► BIND_FAILED ─► (auto-reverse premium) ─► VOID
   │            └─► PAYMENT_FAILED ─► VOID
   └─► EXPIRED (quote TTL)
```
On `BINDING → ACTIVE` (one transaction): persist `provider_policy_ref`, store certificate PDF, write commission entry, notify user, audit.
On `BIND_FAILED`: **auto-reverse the premium debit** (reversing ledger entry) — a successful debit must never leave a user without cover and without a refund. This is the single most important invariant.

### 10.2 Claim lifecycle
```
DRAFT ─► FNOL_SUBMITTED ─► UNDER_ASSESSMENT
                              ├─► NEEDS_MORE_INFO ◄─► UNDER_ASSESSMENT
                              ├─► APPROVED ─► PAYOUT_PENDING ─► SETTLED
                              └─► REJECTED
```
`PAYOUT_PENDING → SETTLED`: idempotent payout via existing payout rails to wallet/bank; write `payout_ledger_ref`; notify; audit. Octamile fast-track motor claims target settlement within the provider's stated SLA.

### 10.3 Embedded bind (event-triggered)
```
EVENT_RECEIVED ─► COVER_RESOLVED ─► PREMIUM_HELD ─► BINDING ─► ACTIVE
        │                │              │              └─► FAILED ─► (release hold) ─► UNCOVERED(notify)
        └─► NO_MAPPING (no-op, log)     └─► INSUFFICIENT_FUNDS ─► UNCOVERED(notify/offer top-up)
```
Embedded binds must be **idempotent on `source_event_id`** — a replayed trip/parcel event never double-binds.

---

## 11. Money flows & ledger

Balances are derived from the append-only wallet ledger; insurance never mutates a balance directly.

**Premium (voluntary or embedded):**
1. Idempotent `DEBIT` on wallet (insufficient funds → offer virtual-account top-up via existing rails).
2. On debit success → `BindPolicy` via gateway (idempotency key = premium tx).
3. Bind success → policy `ACTIVE`, write `commission_entry`, remit/flag premium for provider settlement.
4. Bind failure → **reversing `CREDIT`** (auto-refund), policy `VOID`.

**Recurring premium:** registered as a biller schedule in existing bill-pay; each cycle = a premium transaction; N failed attempts (configurable) → policy `LAPSED` per provider grace rules.

**Claims payout:** provider approves → `PAYOUT_PENDING` → existing payout rails `CREDIT` to wallet (or bank) → `SETTLED`. Idempotent on `claim.idempotency_key`.

**Commission:** recorded as Paymax revenue on a **separate ledger account** at bind; reconciled against provider statements; never commingled with premium pass-through.

**Refund/cancellation:** provider refund rule → reversing `CREDIT` to wallet; policy `CANCELLED`; reverse the related commission entry.

Ledger account separation (minimum): `premium_payable_<provider>` (pass-through liability), `commission_income`, `claims_payout_clearing`. Every movement is a recorded, reversible entry.

---

## 12. API design

### 12.1 Internal `insurance-svc` (client-facing, via gateway/BFF)
```
GET    /v1/insurance/products?line=&context=        # routed, filtered by KYC tier + context
POST   /v1/insurance/quotes                          # body: product_code, inputs (schema-validated)
GET    /v1/insurance/quotes/{id}
POST   /v1/insurance/policies                         # bind from quote; Idempotency-Key header REQUIRED
GET    /v1/insurance/policies                         # user's policy wallet
GET    /v1/insurance/policies/{id}
GET    /v1/insurance/policies/{id}/certificate        # signed URL
POST   /v1/insurance/policies/{id}/cancel
POST   /v1/insurance/policies/{id}/beneficiaries
POST   /v1/insurance/claims                           # FNOL; Idempotency-Key REQUIRED
GET    /v1/insurance/claims/{id}
POST   /v1/insurance/claims/{id}/evidence             # signed-URL upload
```
Every endpoint: authenticate the request; enforce **object-level** authZ (this user owns this policy/claim); validate body against the product's versioned field schema; reject early with field-level errors.

### 12.2 Embedded-binding (internal event subscriptions)
```
event: trip.started            -> bind passenger/rider/driver protection (Octamile)
event: parcel.booked           -> bind GIT per-shipment (Octamile)
event: bus.seat_booked         -> bind passenger protection (Octamile)
event: consignment.created     -> bind haulage/GIT (Octamile)
event: loan.disbursed          -> bind credit-life (MyCover)
event: device.purchased        -> bind device cover (MyCover)
event: wallet.funded           -> offer/bind wallet insurance (MyCover)
event: spotlight.event_created -> bind event cover (MyCover)
event: contestant.enrolled     -> bind contestant cover (MyCover)
```

### 12.3 Provider webhooks (ingested by `underwriter-gateway`)
```
POST /internal/webhooks/mycover   # signature-verified, idempotent on external_event_id
POST /internal/webhooks/octamile  # signature-verified, idempotent on external_event_id
# event types: policy.bound, policy.cancelled, policy.lapsed,
#              claim.updated, claim.approved, claim.rejected, claim.settled
```

---

## 13. Embedded integration with the Transport & Logistics module

This is where Octamile earns its split. The transport module's lifecycle events are the binding triggers:

| Transport event | Octamile cover | Premium model |
|---|---|---|
| Driver/rider onboarding (partner app) | Driver/rider protection + motor (3rd-party/comprehensive) | Annual / onboarding |
| Trip started (customer + driver app) | Passenger + rider/driver per-trip protection | Per-trip micro-premium |
| Parcel booked (last-mile / interstate delivery) | Goods-in-transit per parcel | Per-shipment, on declared value |
| Bus seat booked (interstate/intrastate) | Passenger protection | Per-seat/trip |
| B2B haulage consignment created | Haulage GIT / freight | Per-consignment |
| Towing / home-movers job | GIT + liability | Per-job |

Claims for these flow through Octamile's automation (FNOL in-app, remote/virtual inspection, rule-based decisioning, fast payout). The driver/partner app surfaces "file a claim" against the active embedded policy; evidence (photos, inspection) uploads via signed URLs.

> The transport module's ~190-screen inventory gains a small set of insurance affordances (cover badge on trip, claim entry, policy view) rather than new standalone screens — embedded cover should feel invisible until needed.

---

## 14. Key user journeys

1. **Voluntary buy (MyCover health/PA/SME):** Insurance surface → pick product → schema-driven form (prefilled from KYC) → quote → review underwriter + terms → confirm → wallet debit → `ACTIVE` → certificate in policy wallet.
2. **Embedded ride cover (Octamile):** Rider requests trip → on `trip.started`, passenger/rider cover binds, micro-premium held/debited → cover badge shows on trip → if incident, FNOL from trip detail → inspection → payout to wallet.
3. **Embedded parcel GIT (Octamile):** Sender books parcel → declares value → GIT premium shown inline at checkout → binds on booking → claim if lost/damaged in transit.
4. **Credit-life (MyCover, embedded):** Loan disbursed → credit-life binds automatically → on covered death, outstanding balance settled, beneficiary protected.
5. **Spotlight contestant (MyCover, embedded):** Contestant enrolled → PA/contestant cover binds for the production window → claim path for on-set incidents.
6. **Agent-assisted (informal market):** Agent opens customer identity → recommends micro-health → collects premium (cash → agent float → wallet) → policy attaches to customer identity, not agent's.

---

## 15. Screen inventory

Net-new screens, grouped by surface. (Embedded cover adds affordances to existing transport/wallet screens rather than duplicating them.)

### 15.1 Customer app (React Native) — ~28
- Insurance home / "Protection" hub
- Product line browse · Product detail · Underwriter disclosure sheet
- Quote form (schema-driven) · Quote result/review · Terms & exclusions
- KYC-gap prompt (if product tier > current) · Consent (NDPA) sheet
- Premium summary · Pay (wallet/top-up) · Bind success · Bind failure/auto-refund notice
- Policy wallet (list) · Policy detail · Certificate viewer · Beneficiaries (add/edit)
- Renewal due · Renew/confirm · Cancellation request · Refund status
- Claims list · FNOL start · Claim form · Evidence upload · Claim status tracker · Claim settled
- Wallet-insurance opt-in · Device-cover opt-in
- Cover badge / inline insurance affordance (transport & parcel checkout) — shared component

### 15.2 Agent app — ~8
- Customer lookup/select · Recommend product · Assisted quote · Assisted bind
- Cash-to-wallet premium capture · Agent policy book · Agent commission view · Assisted claim FNOL

### 15.3 Partner/driver app (transport) — ~6
- My embedded policies · Trip/job cover status · File claim (embedded) · Inspection upload · Claim status · Onboarding cover consent

### 15.4 Admin web (`insurance-admin`) — ~22
- Dashboard (GWP, attach rate, claims ratio, provider health)
- Catalog list · Product editor (versioned) · Routing table editor · Field-schema editor
- Policy search · Policy detail/timeline · Claim search · Claim detail/timeline
- Premium transactions · Commission ledger · Reconciliation workbench · Break resolution
- Provider config (keys, webhooks, SLAs) · Provider event log · Webhook replay
- Consent/audit export · Refund/cancellation queue · Lapse/renewal sweeps monitor · Reporting/exports

**Indicative total: ~64 net-new screens** (28 customer + 8 agent + 6 partner + 22 admin), plus shared embedded affordances on existing surfaces.

---

## 16. Authorization (RBAC)

Effective permissions computed from durable grants; checked on every route; object-level enforced.

| Role | Capabilities |
|---|---|
| Policyholder (User capability) | Own policies/claims only; bind, view, claim, cancel own |
| Agent | Assisted bind/claim for customers; sees own book + own commission; **cannot** see other agents' or arbitrary users' policies |
| Insurance Ops | Policy/claim search, reconciliation, refund queue; no catalog publish |
| Insurance Admin | Catalog/routing/provider config, publish, webhook replay |
| Finance | Commission/premium ledgers, settlement, exports; read-only on policy PII |
| Auditor | Read-only audit + exports |

Object-level rule everywhere: *can this caller act on this specific policy/claim?* — the most common breach is the missing object-level check, so it's enforced in `insurance-svc`, not the BFF.

---

## 17. Reconciliation, settlement & commission

- **Premium settlement:** scheduled job matches Paymax `premium_transaction` records to provider remittance statements; unmatched → `ReconciliationRecord` break → admin workbench.
- **Commission:** computed at bind, confirmed against provider statement; discrepancies flagged; reversed on cancellation/refund.
- **Claims clearing:** payouts matched to approved claims; orphan payouts (payout without `SETTLED` claim) blocked at the ledger.
- **Break SLA:** breaks > 0.5% of volume or any break > 72h unresolved → alert.

---

## 18. Compliance, data protection & audit

- **NDPA 2023:** versioned consent before every provider data-share; data minimisation; right-to-erasure handling coordinated with provider retention; PII encrypted at rest/in transit; never logged.
- **Disclosure:** underwriter + aggregator shown on quote, bind, and certificate.
- **Audit:** immutable actor/entity/action/before-after/timestamp for every state change (bind, cancel, claim decision, payout, catalog publish, routing change); exportable for NAICOM/regulator review.
- **Document security:** certificates and claim evidence behind access-controlled signed URLs only.
- **No premium float beyond settlement window** — modelled as liability, not revenue.

---

## 19. Non-functional requirements

| Area | Requirement |
|---|---|
| Idempotency | All bind/claim/payout operations idempotent; replayed events no-op |
| Availability | Insurance surface degrades gracefully if a provider is down; embedded binds queue + retry with explicit cover guarantee |
| Latency | Quote round-trip target < 3s p95; embedded bind < 5s p95 (async-confirmed) |
| Consistency | Premium debit + bind are saga-coordinated; failure auto-reverses |
| Security | Per-provider secret scoping; signature-verified webhooks; least-privilege service creds |
| Observability | Structured logs + metrics + traces on every state change; "what happened to this policy and who did it" answerable from data |
| Data residency | Per NDPA / provider DPA terms |
| Testing | State machine + authZ paths covered; sandbox contract tests per provider; failure/auto-reverse paths explicitly tested |

---

## 20. Analytics & event taxonomy

Emit: `insurance_product_viewed`, `quote_requested`, `quote_returned`, `bind_attempted`, `bind_succeeded`, `bind_failed`, `premium_debited`, `premium_failed`, `embedded_cover_bound`, `embedded_cover_uncovered`, `renewal_due`, `renewed`, `lapsed`, `claim_fnol`, `claim_status_changed`, `claim_settled`, `commission_recorded`, `reconciliation_break`. Each carries `provider`, `product_line`, `binding_mode` for the funnel and attach-rate dashboards.

---

## 21. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Debit succeeds, bind fails → user paid, no cover | Saga + **mandatory auto-reverse**; 0 unresolved > 24h is a release gate |
| Duplicate webhook / replayed event → double bind/pay | Idempotent ingest (`external_event_id` / `source_event_id` unique) |
| Provider outage during embedded flow | Queue + retry; explicit "no cover until confirmed" UX; never silent fail |
| Premium float misclassified as revenue (regulatory) | Pass-through liability ledger; commission on separate account; D-1 contract clarity |
| PII over-shared with provider | Field-level data minimisation per product schema; versioned consent |
| Provider lock-in | Gateway abstraction + routing config; third rail addable without core change |
| Claims dissatisfaction (trust) | Surface provider SLA; in-app status tracker; Octamile fast-track for motor; complaints mapped to provider channels |
| Capital/regulatory creep (if treated as underwriter) | Stay Partnering Insurtech; no risk retention; revisit licence only at scale |

---

## 22. Phased roadmap

**Phase 0 — Foundations (gateway + contracts).** Build `underwriter-gateway` interface + both adapters against sandbox; wire wallet ledger debit/credit + auto-reverse saga; provider contracts + D-1 resolved; consent + audit plumbing.

**Phase 1 — Voluntary MyCover lines.** Catalog seed (health, PA, device, SME, general micro); quote→bind→policy wallet; claims FNOL; recurring premium via bill-pay; admin policy/claim search + reconciliation v1.

**Phase 2 — Embedded Octamile (transport/logistics).** Event bindings for trip/parcel/bus/haulage; per-trip & per-shipment premium; partner-app claim + inspection upload; fast-track motor claims; attach-rate dashboard.

**Phase 3 — Embedded MyCover (financial/Spotlight) + agent.** Credit-life on loan disbursement; wallet insurance; Spotlight events/contestants cover; agent-assisted sales + agent commission; renewal/lapse automation; full reconciliation + commission ledger.

**Phase 4 — Optimise & extend.** Third rail readiness (e.g. Curacel/direct insurer) as config; SME expansion; bundle/cross-sell; claims-experience tuning to SLA targets.

---

## 23. Open decisions

| ID | Decision needed | Owner |
|---|---|---|
| D-1 | Contractual role per product line (agent vs distribution partner vs web-aggregator-equivalent) and the named licensed underwriter behind each line | Legal + CEO |
| D-2 | Commission/revenue-share terms per provider per line; tax treatment | Finance |
| D-3 | Embedded premium model defaults (who absorbs micro-premium on per-trip cover — user, Paymax, or split) | CEO + Finance |
| D-4 | Grace-period and lapse rules per recurring product (align to provider) | Insurance Product |
| D-5 | KYC tier mapping per product (which products need which verification) | Compliance |
| D-6 | Refund routing default (wallet vs original source) | Finance |

---

## 24. Appendix

### A. Error taxonomy (normalised, provider-agnostic)
`QUOTE_UNAVAILABLE` · `PRODUCT_INACTIVE` · `KYC_TIER_INSUFFICIENT` · `CONSENT_REQUIRED` · `INSUFFICIENT_FUNDS` · `BIND_REJECTED_BY_UNDERWRITER` · `PROVIDER_TIMEOUT` · `PROVIDER_UNAVAILABLE` · `DUPLICATE_REQUEST` (idempotent no-op) · `CLAIM_NOT_ELIGIBLE` · `EVIDENCE_REQUIRED`.

### B. Webhook event catalog (normalised)
`policy.bound` · `policy.cancelled` · `policy.lapsed` · `policy.expired` · `claim.updated` · `claim.needs_info` · `claim.approved` · `claim.rejected` · `claim.settled`. All signature-verified, idempotent on `(provider, external_event_id)`.

### C. Provider mapping summary
- **MyCover.ai** — open insurance API + SDK, white-label, multi-insurer (e.g. Hygeia, Leadway, Sovereign Trust, AIICO, Allianz). Rail for: general micro, wallet, health, PA, credit-life, device, SME, Spotlight events/contestants.
- **Octamile** — embedded insurance API + widget, claims automation (FNOL, remote inspection, rule-based decisioning, fast payout), underwriter network (e.g. AXA Mansard). Rail for: ride-hailing, logistics, parcel, bus, motor, GIT, driver/rider/passenger protection.

*Final product codes, premium models, sum-insured bands, field schemas, SLAs, and settlement terms are seeded from each provider's live catalog/contract during Phase 0–1.*
