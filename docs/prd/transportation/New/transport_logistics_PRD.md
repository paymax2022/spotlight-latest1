# Product Requirements Document (PRD)
# Transport & Logistics Module — Spotlight × Paymax Super-App

| Field | Value |
|---|---|
| **Product** | Transport & Logistics vertical within the Spotlight × Paymax super-app |
| **Market** | Nigeria-first (Lagos, Abuja, Port Harcourt for P0) → West Africa / pan-African |
| **Document status** | Draft v1.0 — for engineering, design, and ops review |
| **Owners** | Product (module lead), Eng (mobile/backend/platform), Design, Ops/Trust & Safety, Finance |
| **Related docs** | Master Research & Strategy Prompt (companion); Shared Platform specs (Auth, Paymax, Map, RBAC) |
| **Scope note** | This module **reuses** the super-app's existing auth/SSO, RBAC, Paymax wallet, map service, KYC, notifications, and ledger. It does **not** rebuild them. |

---

## 1. Executive summary

The transport & logistics module turns the super-app into a single front door for moving **people and goods** across Nigeria. It bundles ten capabilities under one identity, one wallet, and one map service: ride-hailing, ride-sharing/carpool, interstate and intrastate bus booking, intrastate (last-mile) and interstate delivery, home movers, towing/roadside, B2B haulage, and an admin console that runs all of them.

The strategic wedge is **the super-app itself**: a customer who already has a funded Paymax wallet and a verified identity can hail a ride, ship a parcel, book a bus seat, and move house without re-registering, re-entering cards, or re-doing KYC. On the supply side, the same single-account model lets a driver also be a sender, and lets fleet/cargo owners manage assets and sub-users under one org. A live opening in the Nigerian market — sustained driver dissatisfaction with incumbent commissions (reported roughly 20–35%) and recurring strikes — makes **driver-favourable economics** a credible differentiator from day one.

This PRD defines goals, personas, the shared-platform contract, a unified RBAC model, per-module functional requirements, the admin console, cross-cutting non-functional requirements, the data model, analytics, a phased release plan, and a **comprehensive screen inventory** (Appendix A) covering every customer, partner, and admin surface.

---

## 2. Goals & non-goals

### 2.1 Goals
1. Let any existing super-app user access all transport/logistics services with **no new signup**, reusing identity, wallet, and KYC.
2. Ship a credible **P0** (ride-hailing + last-mile delivery + interstate bus) in target cities, then expand modules on shared rails.
3. Provide one **admin console** to operate every module with strong RBAC, audit, and finance reconciliation.
4. Win supply through **transparent, driver-favourable economics** and win demand through **cross-sell** inside the super-app.
5. Achieve trust parity or better with incumbents (verification, live tracking, SOS, insurance, dispute resolution).

### 2.2 Non-goals (v1)
- Building a new payment processor, KYC engine, or map/geo stack (all reused).
- Owning vehicles/fleet directly (asset-light marketplace; fleet financing is a later P2 consideration).
- Food delivery / e-commerce marketplace (separate super-app verticals; we integrate, not absorb).
- International cross-border freight customs brokerage in v1 (interstate domestic first).

---

## 3. Success metrics (KPIs)

| Category | Metric |
|---|---|
| **Adoption** | % of existing super-app users activating ≥1 transport service; new accounts attributed to transport |
| **Liquidity** | Supply utilisation; request-to-match rate; avg wait/ETA; % requests fulfilled |
| **Growth** | Weekly active riders/senders; trips & deliveries/week; bus seats sold; haulage loads matched |
| **Retention** | 4-week retention by module; cross-module usage (users active in ≥2 modules) |
| **Economics** | GMV, take rate, contribution margin per trip/delivery; CAC vs. LTV; payout cycle time |
| **Supply health** | Driver/partner weekly earnings, churn, acceptance/cancellation rate, active days |
| **Trust & safety** | SOS incidents & resolution time, dispute rate & resolution time, fraud loss rate, rating distribution |
| **Quality** | Crash-free sessions, p95 API latency, on-time delivery/arrival rate, COD reconciliation accuracy |

Targets to be set per city at launch and reviewed monthly.

---

## 4. Personas & roles (summary)

**Demand side:** Rider/passenger; bus traveller; parcel sender & receiver; mover-client; stranded motorist (towing); cargo shipper (B2B haulage); corporate/commute-pool admin.

**Supply side:** E-hail driver; carpool driver; bus operator & terminal/booking agent; courier (bike/van); tow operator; truck driver; fleet/cargo owner (org); mover crew.

**Internal:** Super-admin; module ops manager; dispatcher; support agent; trust-&-safety officer; finance/reconciliation; KYC reviewer; analyst (read-only); partner-account manager.

A **single account** can hold multiple roles (e.g. driver + sender). Roles are composable capabilities, scoped by geography, module, and organisation (Section 7).

---

## 5. Shared-platform contract (reuse, don't rebuild)

Every module consumes these shared services. The PRD specifies **how** each is used; it does not redefine them.

| Shared service | What the module reuses | Module must NOT |
|---|---|---|
| **Auth / SSO** | One identity, session, MFA, device trust across all verticals | Build a separate login/registration |
| **RBAC** | Central role/permission engine; module registers its roles & scopes | Fork identity or store ad-hoc permissions |
| **Paymax wallet** | Wallet balance, cards, bank transfer, escrow/hold, split, payouts, refunds, COD settlement, ledger | Add a new PSP or parallel ledger |
| **Map service** | Geocoding, routing, ETA, distance/time matrix, live tracking, geofencing | Re-implement maps or routing |
| **KYC / verification** | Identity (BVN/NIN), document upload, liveness, vehicle/business docs | Build a separate KYC pipeline |
| **Notifications** | Push, SMS, in-app, email; templates & preferences | Spin up a separate notification stack |
| **Support / dispute** | Ticketing, masked PII lookup, dispute workflow | Maintain shadow support tooling |

**Design rule:** Every functional requirement states *Reuses* (shared rails it calls) and *Net-new* (the minimal new capability it adds).

---

## 6. High-level architecture (overview)

- **Clients:** Customer app (the super-app, with a Transport hub), Partner/Driver app(s) (role-aware single app with mode switching), Admin console (web).
- **Module backend:** Per-domain services — Trips (ride-hailing/carpool), Bus, Delivery, Movers, Towing, Haulage — plus shared module services: **Dispatch/Matching**, **Pricing/Quote**, **Tracking**, **Ratings**, **Disputes**.
- **Shared platform (external to module):** Auth/SSO, RBAC, Paymax (wallet/ledger/payouts), Map service, KYC, Notifications, Support.
- **Data/eventing:** Event bus for trip lifecycle, payment events, location streams; analytics/BI sink; audit log store.
- **Integration:** Insurance partners, SMS/voice masking, ID verification sources, accounting/settlement exports.

A shared-rails architecture diagram is included in Appendix C (to be rendered by design/eng).

---

## 7. Unified RBAC & role taxonomy

### 7.1 Principles
- **One identity, many capabilities.** Roles attach to a single super-app account; users switch contexts (e.g. "I'm driving" vs "I'm sending").
- **Least privilege by default.** Every role gets the minimum scope; elevation is explicit and audited.
- **Scoping dimensions:** geography (city/region/state), module (which vertical), organisation (partner/fleet/B2B sub-accounts), and lifecycle state (e.g. pending-KYC vs active).
- **Maker-checker** for sensitive actions: refunds, payouts, fare/price overrides, bans, KYC approvals.
- **Full audit logging** on every privileged action; PII masking and time-boxed access for support.

### 7.2 Role taxonomy
- **End-user roles:** rider, bus_passenger, sender, receiver, mover_client, shipper (haulage), commute_pool_admin.
- **Supply roles:** ehail_driver, carpool_driver, courier, bus_operator, terminal_agent, tow_operator, truck_driver, fleet_owner (org), cargo_owner (org), mover_crew.
- **Internal roles:** super_admin, module_ops_manager, dispatcher, support_agent, trust_safety_officer, finance_recon, kyc_reviewer, analyst_readonly, partner_account_manager.

### 7.3 Permission matrix (illustrative — to be completed in the RBAC config)

| Resource / Action | rider | driver/courier | fleet_owner | dispatcher | support_agent | finance_recon | trust_safety | super_admin |
|---|---|---|---|---|---|---|---|---|
| Book/request trip | C | — | — | C (manual) | R | — | R | RUD |
| Accept/fulfil job | — | CRU | R | RU (reassign) | R | — | R | RUD |
| View live location | own | own job | own fleet | all (scope) | masked | — | all | all |
| Issue refund | request | — | — | — | request | **approve** | — | approve |
| Trigger payout | — | request | request | — | — | **approve** | — | approve |
| Override fare/price | — | — | — | propose | — | — | — | approve |
| Approve KYC | — | — | submit | — | — | — | review | approve |
| Ban / suspend account | — | — | — | flag | flag | — | **decide** | decide |
| Configure pricing/zones | — | — | — | — | — | — | — | RUD |
| Access audit logs | — | — | — | — | — | R | R | R |

*(C=create, R=read, U=update, D=delete; "own"/"scope" denotes row-level scoping.)*

---

## 8. Cross-cutting non-functional requirements (NFRs)

- **Performance:** p95 critical API latency ≤ 500 ms; quote/ETA ≤ 1.5 s; live-location update cadence configurable (e.g. 3–5 s in-trip).
- **Offline & low-connectivity:** graceful degradation; queue actions (e.g. delivery proof) and sync; cached last-known map tiles/ETAs; SMS fallbacks for OTP and critical status.
- **Low-end devices:** support older Android; lightweight bundles; avoid heavy animations on the critical path.
- **Localisation:** landmark-based addressing (not just street numbers); local currency formatting; multi-language ready (EN + major NG languages later); pidgin-friendly support copy.
- **Payments realism:** cash and **COD** first-class; wallet top-up frictionless; split & escrow for high-value (movers, haulage).
- **Security & privacy:** masked phone numbers for in-trip comms; PII access logged; data retention policy; encryption in transit/at rest (platform-provided).
- **Compliance:** state e-hailing licensing, FRSC/road safety, insurance mandates, terminal/union (NURTW) realities, okada/keke restrictions by city.
- **Accessibility:** WCAG-aligned mobile patterns; large tap targets; high-contrast mode.
- **Reliability:** trip/payment events idempotent; no double-charge; reconciliation guarantees for COD and payouts.
- **Observability:** structured events for every lifecycle transition; dashboards and alerting on SLA breaches.

---

## 9. Module functional requirements

Each module follows the same shape: **Overview/JTBD → Core user stories → Functional requirements (FR) → Pricing → Map touchpoints → Edge cases.** Priorities: **P0** = launch, **P1** = fast-follow, **P2** = later.

### 9.1 Ride-hailing (P0)

**Overview/JTBD.** On-demand point-to-point rides (economy, comfort, XL; two-wheeler/keke where legal), plus scheduled and airport rides. Rider job: get a safe, fair-priced ride quickly. Driver job: steady, transparent earnings.

**Core user stories.** As a rider I set pickup/drop-off, see an upfront fare and ETA, get matched, track my driver, pay from wallet/cash, rate, and get a receipt. As a driver I go online, receive requests with fare/destination transparency, navigate, complete trips, and see earnings instantly.

**Functional requirements.**
- FR-RH-1 (P0): Set pickup/destination via map + saved places + landmark search. *Reuses:* map geocoding/routing.
- FR-RH-2 (P0): Upfront fare quote with breakdown; vehicle tiers; ETA. *Reuses:* map matrix/ETA; pricing engine (net-new module logic).
- FR-RH-3 (P0): Dispatch/matching to nearest suitable driver; configurable radius/algorithm. *Net-new:* matching service.
- FR-RH-4 (P0): Live driver-to-pickup and in-trip tracking; masked call/chat. *Reuses:* tracking, notifications, comms masking.
- FR-RH-5 (P0): Payment via wallet, card, **cash**; auto-receipt; tip (P1). *Reuses:* Paymax.
- FR-RH-6 (P0): Two-way ratings + feedback tags; safety: SOS, share-trip, driver/vehicle verification badge. *Reuses:* ratings, KYC, notifications.
- FR-RH-7 (P0): Cancellation policy + fees; no-show handling. *Reuses:* Paymax for fee capture.
- FR-RH-8 (P1): Scheduled rides; airport flow; multi-stop.
- FR-RH-9 (P1): **Transparent driver economics** view (earnings, commission shown line-by-line); instant payout to wallet. *Differentiator.*
- FR-RH-10 (P2): Driver subscription/flat-fee option vs commission (test against incumbents); rider fare negotiation experiment.
- FR-RH-11 (P1): Insurance coverage per trip; incident reporting.

**Pricing.** Upfront, distance/time + surge (capped, transparent); evaluate **lower commission or flat-fee** to attract supply. **Map touchpoints:** geocoding, routing, ETA, matrix, geofence (zones/airport), live tracking. **Edge cases:** GPS drift, surge transparency, cash change handling, driver-rider no-show, off-route detection, multi-account fraud.

### 9.2 Ride-sharing / carpool (P1)

**Overview/JTBD.** Cost-split shared rides and recurring commute pools, including corporate/B2B commuting. Rider job: cheaper predictable commute. Driver/host job: offset costs or run a route.

**Core user stories.** As a commuter I find/join a recurring pool or one-off shared ride along my route, reserve a seat, split cost automatically, and track the vehicle. As a corporate admin I set up staff routes, manage eligible riders, and pay/subsidise centrally.

**Functional requirements.**
- FR-CP-1 (P1): Create/find pools by route, time window, and seats; recurring schedules. *Reuses:* map routing/matrix.
- FR-CP-2 (P1): Seat reservation + automatic cost split across riders. *Reuses:* Paymax split payments.
- FR-CP-3 (P1): Route-match riders to drivers/pools (corridor matching). *Net-new:* corridor matching.
- FR-CP-4 (P1): Corporate/B2B console: org sub-accounts, eligible-rider lists, central billing/subsidy. *Reuses:* RBAC org scoping, Paymax.
- FR-CP-5 (P1): In-trip tracking, safety (verified co-riders, share-trip), ratings.
- FR-CP-6 (P2): Dynamic pool optimisation; waitlists; season passes.

**Pricing.** Per-seat cost-split + small platform fee; corporate subscription/seat licences. **Map touchpoints:** routing, corridor/matrix, geofence (pickup clusters), tracking. **Edge cases:** partial fills, late cancellations within a pool, rider reliability scoring, subsidy reconciliation.

### 9.3 Bus booking — interstate (P0)

**Overview/JTBD.** Intercity seat reservation across operators, terminals, hire-a-bus/charter, and parcel-on-bus. Traveller job: book a trusted intercity seat with a known departure. Operator/terminal job: fill seats and manifest passengers.

**Core user stories.** As a traveller I search routes/dates, pick an operator and seat, pay, get an e-ticket + boarding info, and (optionally) request terminal pickup. As a terminal agent I manage trips, manifests, seat maps, and boarding. As an operator I configure routes, schedules, pricing, and fleet.

**Functional requirements.**
- FR-BI-1 (P0): Route/date/operator search; seat-map selection; e-ticket/QR. *Net-new:* inventory & seat-map service.
- FR-BI-2 (P0): Operator/terminal back office: routes, schedules, fares, seat maps, manifests, boarding scan. *Reuses:* RBAC (terminal_agent/operator).
- FR-BI-3 (P0): Payment (wallet/card/cash-at-terminal), refunds/reschedule policy. *Reuses:* Paymax.
- FR-BI-4 (P1): Terminal/door **pickup** add-on (ties to ride-hailing). *Cross-sell.*
- FR-BI-5 (P1): Hire-a-bus / charter requests with quotes.
- FR-BI-6 (P1): **Parcel-on-bus** (send a parcel on a scheduled coach) — bridges to delivery.
- FR-BI-7 (P0): Trip status, departure reminders, live coach tracking where available. *Reuses:* tracking, notifications.
- FR-BI-8 (P2): Multi-leg/connections; loyalty for frequent travellers.

**Pricing.** Per-seat (operator-set) + platform booking fee; charter quotes; pickup add-on. **Map touchpoints:** terminal geocoding, route display, coach live tracking, pickup ETA. **Edge cases:** overbooking/seat conflicts, departure delays/cancellations, refund windows, manifest accuracy, cash-at-terminal reconciliation.

### 9.4 Bus booking — intrastate / shuttle (P1)

**Overview/JTBD.** City/shuttle routes, scheduled commuter shuttles, season/route passes. Commuter job: reliable scheduled city transit. Operator job: run fixed routes profitably.

**Functional requirements.**
- FR-BX-1 (P1): Fixed-route schedules, stops, live vehicle ETA at stops. *Reuses:* map routing/tracking, geofenced stops.
- FR-BX-2 (P1): Single-ride ticket + **season/route passes**; QR boarding. *Reuses:* Paymax.
- FR-BX-3 (P1): Wallet auto-debit / tap-to-ride pass.
- FR-BX-4 (P2): Demand-responsive micro-routing; capacity balancing.

**Pricing.** Per-ride + passes/subscriptions. **Map touchpoints:** stop geofencing, vehicle tracking, ETA-at-stop. **Edge cases:** pass abuse, vehicle bunching, stop accuracy, peak overcrowding.

### 9.5 Delivery — intrastate / last-mile (P0)

**Overview/JTBD.** Same-day on-demand & scheduled bike/van courier within a city, with **COD**. Sender job: get a parcel across town fast and tracked. Courier job: efficient batched pickups/drops with reliable pay.

**Core user stories.** As a sender I enter pickup/drop, parcel size/value, get a quote, choose vehicle (bike/van), pay or set COD, track the courier, and share a tracking link with the receiver. As a courier I accept jobs, navigate, capture **proof of delivery**, and collect/settle COD.

**Functional requirements.**
- FR-DL-1 (P0): Pickup/drop, parcel size/weight/value, vehicle selection, instant quote. *Reuses:* map matrix; pricing (net-new).
- FR-DL-2 (P0): On-demand + **scheduled** pickup; batch/multi-drop (P1). *Net-new:* dispatch.
- FR-DL-3 (P0): Live tracking + shareable tracking link to receiver (no app needed). *Reuses:* tracking, notifications.
- FR-DL-4 (P0): **Proof of delivery** (photo, recipient name, OTP/signature). *Net-new:* POD capture.
- FR-DL-5 (P0): Payments — wallet/card/**COD**; COD collection + courier settlement + reconciliation. *Reuses:* Paymax ledger.
- FR-DL-6 (P0): Insurance/declared value; damage/loss claims. *Reuses:* disputes; insurance integration.
- FR-DL-7 (P1): Drop-off hubs; returns; cash-on-pickup; business/merchant sender console.
- FR-DL-8 (P1): Ratings, courier reliability scoring.

**Pricing.** Distance/size-based + vehicle tier + COD fee; merchant volume pricing. **Map touchpoints:** geocoding, routing, matrix, batching optimisation, live tracking, geofence. **Edge cases:** failed delivery/recipient absent, COD shortfall/fraud, wrong address, parcel disputes, multi-drop sequencing.

### 9.6 Delivery — interstate / city-to-city (P1)

**Overview/JTBD.** City-to-city parcel with drop-off hubs and/or door-to-door, multi-day tracking. Sender job: send goods to another state reliably with visibility.

**Functional requirements.**
- FR-DX-1 (P1): Origin/destination (door or hub), parcel details, ETA window, price. *Reuses:* map.
- FR-DX-2 (P1): Hub network management; handoff scans; chain-of-custody tracking. *Net-new:* hub/leg model.
- FR-DX-3 (P1): Door pickup (ties to last-mile) + interstate line-haul + last-mile delivery. *Cross-module.*
- FR-DX-4 (P1): Status milestones, POD, insurance, claims.
- FR-DX-5 (P2): Parcel-on-bus integration (use coach capacity as line-haul).

**Pricing.** Zone/weight tiers + insurance. **Map touchpoints:** hub geocoding, leg ETAs, tracking checkpoints. **Edge cases:** lost-in-transit, hub mis-sort, long-tail destinations, multi-leg delays.

### 9.7 Home movers (P1)

**Overview/JTBD.** House/office relocation: van/truck + optional labour, inventory, scheduling, quotes. Client job: move belongings safely with a fair, predictable quote. Crew job: clear jobs, fair pay, route/load info.

**Core user stories.** As a mover-client I describe the move (rooms/items, floors, distance, date), get a quote (instant or surveyed), book a slot, optionally add packing/labour, pay (deposit + balance via escrow), and track on the day. As a mover crew I see job details, inventory, addresses, and capture before/after condition.

**Functional requirements.**
- FR-MV-1 (P1): Move builder — property type, inventory/room list, floors/lift, distance; instant estimate + optional **video survey** for firm quote. *Reuses:* map distance.
- FR-MV-2 (P1): Add-ons: packing materials, labour count, disassembly, storage. *Net-new:* add-on catalogue.
- FR-MV-3 (P1): Scheduling with time-window slots; deposit + **escrow** balance release on completion. *Reuses:* Paymax escrow.
- FR-MV-4 (P1): Inventory checklist + photo condition record (pre/post) for disputes/insurance.
- FR-MV-5 (P1): Day-of tracking, crew ETA, completion sign-off, ratings.
- FR-MV-6 (P2): In-app chat with surveyor; recurring/office-move project mode.

**Pricing.** Quote-based (distance + volume + labour + add-ons); deposit + balance. **Map touchpoints:** address geocoding, route/distance, crew tracking. **Edge cases:** access/parking constraints, scope creep on the day, damage claims, partial completion, reschedules.

### 9.8 Towing / roadside (P1)

**Overview/JTBD.** Breakdown recovery, accident towing, flatbed/van recovery, emergency dispatch. Stranded-motorist job: get help fast to a known location. Operator job: rapid dispatch with clear pay.

**Core user stories.** As a stranded motorist I share my location and vehicle/issue, get a nearby tow/roadside operator with ETA and price, track arrival, and pay on completion. As a tow operator I receive emergency jobs with location, vehicle type, and destination.

**Functional requirements.**
- FR-TW-1 (P1): One-tap **emergency request** with auto-location, vehicle type, issue type (tow, jump-start, tyre, fuel, lockout). *Reuses:* map, SOS.
- FR-TW-2 (P1): Nearest-operator dispatch with ETA + upfront price; live arrival tracking. *Net-new:* priority dispatch.
- FR-TW-3 (P1): Destination capture (where to tow to); flatbed vs hook selection.
- FR-TW-4 (P1): Payment (wallet/card/cash), insurer/roadside-programme billing option (P2). *Reuses:* Paymax.
- FR-TW-5 (P1): Safety: share-status with contact, operator verification, incident notes/photos.

**Pricing.** Base callout + distance + service type; insurer pass-through later. **Map touchpoints:** precise geolocation (roadside), nearest-operator matrix, tow-route, tracking. **Edge cases:** imprecise/remote location, night safety, accident severity triage, vehicle inoperable details, destination changes.

### 9.9 Haulage / trucks — B2B freight (P1→P2)

**Overview/JTBD.** Full-/part-truckload, load-matching, contracts, trip financing, cargo visibility. Shipper job: move freight reliably with visibility and fair rates. Fleet/cargo owner job: maximise truck utilisation, reduce empty miles, get paid/financed.

**Core user stories.** As a shipper I post a load (origin, destination, cargo type, weight, truck type, date), get matched/quoted, book, sign terms, and track the shipment with milestones and PODs. As a fleet owner I manage trucks/drivers, bid on/accept loads, and access trip financing. As a truck driver I receive assigned loads, navigate, and update status.

**Functional requirements.**
- FR-HG-1 (P1): Load board — post/search loads; truck-type & cargo taxonomy; load–truck matching. *Net-new:* load matching.
- FR-HG-2 (P1): Quotes/bids, contract terms, e-acceptance; recurring contracts (P2). *Reuses:* Paymax escrow.
- FR-HG-3 (P1): Fleet & driver management (org accounts, sub-users, documents/compliance). *Reuses:* RBAC org scoping, KYC.
- FR-HG-4 (P1): Cargo visibility — milestones, live tracking, ePOD, exception alerts. *Reuses:* tracking.
- FR-HG-5 (P2): **Trip financing / working capital** for transporters; fuel/credit. *Reuses:* Paymax + financing partners.
- FR-HG-6 (P2): Empty-miles/backhaul optimisation; corridor analytics.

**Pricing.** Per-load (negotiated/quoted) + platform fee; financing fees (P2). **Map touchpoints:** long-haul routing, corridor matrix, geofenced checkpoints, live tracking. **Edge cases:** cargo disputes/damage, detention/demurrage, partial loads, document/compliance gaps, route diversions, payment terms enforcement.

### 9.10 Admin management console (P0)

The console is the operational backbone for all modules. Detailed in Section 10.

---

## 10. Admin console — requirements (P0 core, expanding by module)

Role-gated workspaces, all respecting Section 7 RBAC and emitting audit logs:

- **Operations (P0):** unified live map of active trips/deliveries/loads; manual dispatch & reassignment; ETA/exception monitoring; SLA-breach alerts.
- **Supply / partner ops (P0):** onboarding & KYC review queues; document verification; partner approval/suspension; fleet & vehicle management; terminal/route setup (bus); load-board management (haulage).
- **Demand & pricing (P0):** fare/route/zone config; surge rules (capped); promo & referral engine; per-module fee/commission config.
- **Finance (P0):** wallet/ledger views; payouts; **COD reconciliation**; refunds/chargebacks; settlement/export reports — on Paymax rails; maker-checker on money movement.
- **Trust & safety (P0):** SOS/incident queue; dispute resolution; fraud signals; ratings moderation; ban/appeal workflow.
- **Support (P0):** unified ticketing; masked customer/partner lookup; time-boxed, session-scoped access.
- **Analytics / BI (P1):** per-module KPIs (Section 3); cohort/retention; supply utilisation; cross-sell funnels; exports.
- **Config / feature flags (P0):** module enable/disable per city/region; role & permission management; CMS for terminals, routes, content.

---

## 11. Payments, wallet & settlement (Paymax)

- **Methods:** wallet, card, bank transfer, **cash**, **COD**; split (carpool); escrow (movers/haulage); tips (P1).
- **Flows:** authorise/hold on request where needed; capture on completion; instant or scheduled **driver/partner payouts**; refunds & partial refunds; cancellation-fee capture.
- **COD:** courier collects cash → reconciled against ledger → settled to platform/merchant; shortfall handling and fraud controls.
- **Reconciliation:** automated daily reconciliation; exception queue in admin finance; immutable ledger entries; idempotent payment events (no double charge).
- **Org billing:** corporate/B2B central billing, statements, credit terms (haulage/commute pools).

---

## 12. Trust & safety

- **Verification:** KYC for riders/senders (lightweight) and stronger KYC for supply (ID + vehicle/business docs + liveness).
- **In-trip safety:** SOS button, share-trip/status, masked comms, driver/vehicle badge, trip recording metadata.
- **Insurance:** per-trip/per-parcel/per-load coverage; claims via disputes + insurer integration.
- **Fraud:** multi-account detection, GPS-spoofing checks, COD fraud controls, collusion/rating-manipulation detection.
- **Moderation & enforcement:** ratings thresholds, suspension/ban workflow with appeals, trust-&-safety queue.

---

## 13. Notifications

Lifecycle-driven across push/SMS/in-app/email (reusing shared notifications): request received, matched, en route, arrived, started, completed, payment, refund, POD, departure reminders (bus), exception/delay alerts, SOS acknowledgements, payout confirmations, KYC status, promo/referral. SMS fallback for OTP and critical status in low-connectivity contexts. User-managed preferences.

---

## 14. Data model (high-level entities)

`Account` (1) ↔ `Roles/Capabilities` (N) · `Organisation` (fleet/cargo/corporate) ↔ `Members` · `Vehicle` · `Driver/Partner Profile` · `KYC Record` · `Trip` (ride/carpool) · `BusTrip`/`Route`/`Schedule`/`Seat`/`Ticket`/`Terminal` · `DeliveryJob`/`Parcel`/`Hub`/`Leg`/`POD` · `MoveJob`/`Inventory`/`AddOn` · `TowJob` · `Load`/`Bid`/`Contract` (haulage) · `Quote`/`Pricing Rule`/`Zone` · `Payment`/`LedgerEntry`/`Payout`/`Refund`/`CODRecord` · `Rating` · `Dispute`/`Claim` · `Incident/SOS` · `Notification` · `AuditLog`. (Identity, wallet/ledger, and map entities are owned by shared platform; module references by ID.)

---

## 15. Analytics & event tracking

Emit structured events for every lifecycle transition (request → quote → match → accept → en route → start → complete/cancel), every payment event, every safety/dispute event, and cross-module funnel steps (e.g. bus booking → pickup add-on). Feed BI for the KPIs in Section 3. Define a canonical event schema before build.

---

## 16. Release plan (phasing)

- **P0 (Launch):** Ride-hailing, Last-mile delivery, Interstate bus; Admin console core (ops, supply/KYC, finance/COD, trust & safety, config); wallet/cash/COD; SOS/tracking/ratings. Cities: Lagos, Abuja, Port Harcourt.
- **P1 (Fast-follow):** Carpool/corporate commute, Intrastate shuttle, Interstate delivery, Home movers, Towing; scheduled rides, drop-off hubs, passes, analytics BI, insurance integrations.
- **P2 (Expand & defend):** Haulage with trip financing & backhaul optimisation; driver subscription/flat-fee experiments; fare negotiation; multi-leg bus; demand-responsive transit; cross-border.

**Sequencing logic:** modules that share the most infrastructure (dispatch, tracking, quote, POD, escrow) come earliest and cheapest; haulage and movers reuse delivery/escrow primitives but add org/contract complexity, so they follow.

---

## 17. Risks, assumptions & open questions

- **Regulatory:** state e-hailing licensing, okada/keke bans, NURTW/terminal relationships, insurance mandates — confirm per city before launch.
- **Supply liquidity & driver economics:** incumbents face strikes over commissions; our model must be sustainable yet attractive — validate take-rate assumptions.
- **COD & cash fraud:** significant in NG; reconciliation and controls are launch-critical.
- **Shared-platform readiness:** confirm exact map, Paymax, KYC capabilities available (Inputs, Section 9 of companion prompt).
- **Trust & safety liability:** insurance partner coverage and claims SLAs.
- **Open questions:** Which P0 city first? Driver payout cadence (instant vs daily)? Commission vs subscription test design? Insurance partner(s)? Bus operator onboarding model (aggregate existing operators vs own fleet)?

---

## Appendix A — Comprehensive screen inventory

Screens are grouped by surface: **(A) Customer app** (the super-app Transport hub), **(B) Partner/Driver app** (role-aware single app), and **(C) Admin console** (web — included for completeness). Screens reused from the existing super-app (e.g. base login, base wallet) are marked **[shared]** and not rebuilt. Module tags: RH=ride-hail, CP=carpool, BI=bus-interstate, BX=bus-intrastate, DL=last-mile, DX=interstate delivery, MV=movers, TW=towing, HG=haulage.

### A. Customer app (mobile)

**A0 — Global / shared shell**
1. Super-app login / SSO **[shared]**
2. KYC / identity verification (BVN/NIN, doc upload, liveness) **[shared]**
3. Super-app home **[shared]** with Transport hub entry
4. **Transport hub / module launcher** (all services, recent activity, promos)
5. Saved places (home, work, favourites) manager
6. Global search (places/landmarks)
7. Wallet — balance & top-up **[shared]**
8. Payment methods (cards, bank, cash preference) **[shared]**
9. Transactions / receipts history (filter by module)
10. Notifications centre + preferences
11. Profile & account settings
12. Manage roles / "Become a partner" entry (driver, courier, operator, etc.)
13. Referrals & promo codes
14. Loyalty / rewards (P1)
15. Help / support home + ticket list
16. Create support ticket / live chat
17. Dispute / claim centre (status & submission)
18. Trip/order activity hub (all active + past, cross-module)
19. Safety centre (SOS settings, trusted contacts, share-trip defaults)
20. Language & accessibility settings
21. Legal (terms, privacy, insurance docs)
22. Empty/offline/error & maintenance states

**A1 — Ride-hailing (RH)**
23. RH entry / set destination
24. Pickup & drop-off picker (map + landmark search)
25. Vehicle tier & fare-quote selection (economy/comfort/XL/two-wheeler)
26. Schedule-ride / multi-stop options (P1)
27. Finding-driver / matching
28. Driver assigned — en route to pickup (live track, masked call/chat)
29. In-trip tracking + ETA + share-trip
30. SOS / emergency overlay
31. Trip completion — fare breakdown & payment
32. Rate driver + tip (P1)
33. Receipt detail
34. Cancellation reason + fee notice
35. Lost item / report issue

**A2 — Carpool / ride-share (CP)**
36. Carpool entry (find a pool / offer a ride)
37. Route & time-window search
38. Pool/ride results list + details (seats, co-riders, price-split)
39. Seat reservation & cost-split confirmation
40. Recurring commute setup
41. Corporate/commute-pool join (org code / eligibility)
42. In-trip tracking (shared)
43. Pool management (my pools, upcoming, cancel)

**A3 — Bus interstate (BI)**
44. Bus search (origin/destination/date/passengers)
45. Trip/operator results + filters
46. Operator & schedule detail
47. Seat-map selection
48. Passenger details / manifest info
49. Add-ons (terminal/door pickup, parcel-on-bus)
50. Booking summary & payment
51. E-ticket / QR + boarding info
52. Trip status & departure reminders + live coach track (where available)
53. Reschedule / cancel / refund flow
54. Hire-a-bus / charter request + quote (P1)

**A4 — Bus intrastate / shuttle (BX)**
55. Shuttle routes & stops map
56. Route detail + live ETA at stop
57. Single ticket purchase / QR
58. Season/route pass purchase & wallet
59. Active pass / tap-to-ride
60. Trip in progress (stops, ETA)

**A5 — Delivery last-mile (DL)**
61. Send a parcel — pickup & drop-off
62. Parcel details (size/weight/value/photo)
63. Vehicle selection (bike/van) + quote
64. Schedule vs on-demand; multi-drop (P1)
65. Receiver details + COD toggle
66. Payment / COD summary
67. Finding-courier / matching
68. Courier en route to pickup (track)
69. In-transit tracking + shareable link
70. Delivery completion + POD view
71. Rate courier / report issue
72. My deliveries (active/past) + tracking link resend
73. Merchant/business sender console (P1)

**A6 — Delivery interstate (DX)**
74. Interstate send — origin/destination (door or hub)
75. Parcel details + insurance/declared value
76. Service & ETA-window selection + price
77. Drop-off hub finder
78. Booking summary & payment
79. Chain-of-custody tracking (milestones/legs)
80. POD & claim entry

**A7 — Home movers (MV)**
81. Move builder — property type & inventory/rooms
82. Floors/lift/access & distance
83. Add-ons (packing, labour, disassembly, storage)
84. Instant estimate vs request video survey
85. Video survey scheduling / session (P1)
86. Slot selection & deposit (escrow)
87. Booking summary & terms
88. Move day — crew ETA & tracking
89. Inventory checklist + condition photos (pre/post)
90. Completion sign-off + balance release
91. Rate crew / file damage claim

**A8 — Towing / roadside (TW)**
92. Emergency request (auto-location + issue type)
93. Vehicle & service type (tow/jump/tyre/fuel/lockout; flatbed vs hook)
94. Destination (tow-to) capture
95. Operator matched — ETA & upfront price
96. Live arrival tracking + share-status
97. Service completion & payment
98. Incident notes/photos + rate operator

**A9 — Haulage (HG) [shipper-side in customer app]**
99. Post a load (origin/destination/cargo/truck type/date)
100. Load matches / quotes & bids
101. Contract terms & e-acceptance
102. Shipment tracking (milestones, live, exceptions)
103. ePOD & cargo dispute
104. My loads / contracts (active/past)
105. Org/business account & billing (shared with B section)

### B. Partner / Driver app (mobile, role-aware)

**B0 — Partner shell**
1. Partner login / SSO **[shared]**
2. Partner onboarding wizard (role select: driver/courier/operator/tow/truck/crew)
3. KYC & document upload (ID, licence, vehicle papers, business docs) **[shared]**
4. Verification status / pending review
5. Vehicle/asset registration & management
6. Partner home / mode switch (which service I'm providing)
7. Online/offline toggle + availability
8. Earnings dashboard (today/week) + **transparent commission breakdown**
9. Instant payout / wallet **[shared]**
10. Payout history & statements
11. Job history (all modules)
12. Ratings & performance (acceptance/cancellation, reliability)
13. Incentives / quests / bonuses
14. Notifications & preferences
15. Support / disputes (partner-side)
16. Safety centre / SOS (partner)
17. Profile & settings
18. Training / guidelines / compliance hub

**B1 — Driver (RH/CP)**
19. Incoming request (fare + destination transparency)
20. Navigate to pickup (map)
21. Arrived / start trip
22. In-trip navigation + masked comms
23. Multi-stop / scheduled trip handling
24. Trip complete + fare summary
25. Carpool: pool manifest & per-seat pickups
26. Cancellation / no-show flow

**B2 — Courier (DL/DX)**
27. Incoming delivery job (pickup/drop, COD flag)
28. Batch / multi-drop sequence
29. Navigate to pickup → confirm pickup
30. Navigate to drop → capture **POD** (photo/OTP/signature)
31. COD collection + cash reconciliation
32. Failed-delivery / recipient-absent flow
33. Hub handoff scan (interstate)

**B3 — Bus operator / terminal agent (BI/BX)**
34. Operator dashboard (trips, occupancy)
35. Route / schedule / fare setup
36. Seat-map & inventory management
37. Manifest & passenger list
38. Boarding scan (QR) & departure control
39. Cash-at-terminal collection & reconciliation
40. Trip status / delay broadcast

**B4 — Tow operator (TW)**
41. Incoming emergency job (location, vehicle, issue)
42. Navigate to motorist (precise geolocation)
43. On-scene checklist + photos
44. Tow-to navigation & completion
45. Payment / insurer billing

**B5 — Truck driver / fleet (HG)**
46. Assigned loads list
47. Load detail (cargo, route, terms)
48. Long-haul navigation + checkpoint geofences
49. Status updates / exception reporting
50. ePOD capture & completion
51. **Fleet owner console:** trucks, drivers/sub-users, documents/compliance, bid/accept loads, trip financing (P2), utilisation

**B6 — Mover crew (MV)**
52. Assigned move jobs + inventory & addresses
53. On-site condition photos (pre)
54. Move-in-progress status
55. Completion sign-off + condition photos (post)

### C. Admin console (web — for completeness)

1. Admin login / SSO + RBAC role context **[shared]**
2. Operations live map (all modules) + manual dispatch/reassign
3. Exception & SLA-breach monitor
4. Supply onboarding & **KYC review queue**
5. Document verification workbench
6. Partner directory — approve/suspend/ban
7. Fleet & vehicle management
8. Bus terminal/route/schedule/fare configuration
9. Haulage load-board management
10. Pricing/zones/surge configuration
11. Promo & referral engine
12. Fee/commission configuration (per module)
13. Finance — wallet/ledger views
14. Payouts (maker-checker)
15. **COD reconciliation** + exception queue
16. Refunds / chargebacks (maker-checker)
17. Settlement & export reports
18. Trust & safety — SOS/incident queue
19. Dispute & claim resolution
20. Fraud signals & case management
21. Ratings moderation
22. Ban/appeal workflow
23. Support — unified ticketing + masked lookup
24. Analytics/BI dashboards (per-module KPIs, cohorts, cross-sell)
25. Feature flags & module enable/disable by city/region
26. RBAC role & permission management
27. CMS (terminals, routes, content, banners)
28. Audit log explorer
29. Admin user & access management
30. System config / integrations (insurance, SMS, ID verification)

---

## Appendix B — Screen count summary

| Surface | Approx. screens |
|---|---|
| Customer app | ~105 (incl. shared shell) |
| Partner / Driver app | ~55 |
| Admin console (web) | ~30 |
| **Total** | **~190 distinct screens** (many states/variants beyond this) |

*Counts include module-specific flows; loading/empty/error/offline variants and modal states are additional. Shared-shell screens are reused from the super-app, reducing net-new build.*

---

## Appendix C — Diagrams to produce (design/eng)
1. Shared-rails architecture (auth, RBAC, Paymax, map, notifications → modules).
2. Unified RBAC role × permission matrix (full).
3. Trip/delivery/load lifecycle state machines per module.
4. Master feature-vs-module table.
5. Customer & partner app navigation maps (from Appendix A).
