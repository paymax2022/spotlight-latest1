# Property Management Suite — Spotlight / Paymax Super-App
## Research · Competitor Analysis · Strategic Feature Definition
**Version 1.0 — June 2026 | Prepared for Spotlight / Paymax Product Team**

---

## 1. EXECUTIVE SUMMARY

**The wedge:** Spotlight already sits inside Nigeria's gated estates with verified, physically-present residents. No competitor combines that beachhead with payments-native infrastructure. The right sequence is: visitor access → verified resident identity & rent rails → marketplace cross-sell — not the other way round.

**The three biggest opportunities:**

1. **Payments-native rent management.** Nigeria's 98% rental rate in Lagos, a 14.9M-unit housing deficit, and near-zero digital landlord tools mean the baseline pain is enormous. Spleet has proven demand but is capacity-constrained (serving only 10% of applicants). Paymax can do everything Spleet does *plus* supply the wallet, virtual accounts, and escrow primitives — in one login.

2. **Unified shortlet + estate access.** Lagos' shortlet market hit ₦281 billion in 2025 (+263% in three years) with ~1,316 Airbnb listings and no local PMS that also provisions physical gate access. A confirmed booking inside an estate auto-provisioning a timed visitor pass is a feature *only* this platform can ship cheaply.

3. **Diaspora remote-ownership mode.** 70–80% of Lagos and Abuja developer sales originate from diaspora. These buyers have no good tool for remote oversight + NGN/FX-aware payouts. Paymax's FX orchestration layer is already built; wrapping it in a property dashboard is a thin integration, not a new silo.

**The sharpest risk:** Our Property NG has a 4-year head start, 5,700+ subscribing companies, 1.65M+ properties under management, and 4M+ daily active users. Competing on features alone is a losing race. The only winning thesis is: **compose payments + identity + existing visitor-access data into a trust layer incumbents cannot replicate without rebuilding their core.** Nail that; everything else is table stakes.

---

## 2. COMPETITOR MATRIX

| Competitor | Marketplace | Shortlet | Hotel | Rent/Tenant | Visitor/Estate | RBAC Depth | Payments-native? | Key Strength | Exploitable Gap |
|---|---|---|---|---|---|---|---|---|---|
| **Our Property NG** | Partial (listings) | Yes (hospitality manager) | Yes (via hospitality) | ✅ Full | ✅ Full — visitor, vehicle, gate | Medium — roles exist, no contextual multi-role | No — third-party gateways only | Scale (5,700 cos, 4M DAU), all-in-one, CBN gateways, NDPC registered | No wallet/escrow; no rent financing; no OTA channel sync; separate login for each role context; no physical-access ↔ booking link |
| **Gate Africa** | No | No | No | No — dues only | ✅ Invite codes, boom barrier, NFC, LPR | Low — resident / guard / admin | Partial — Gate Wallet (bills/dues) | Estate-first UX, hardware integrations, strong community features | Single vertical; no rent management; no marketplace; wallet can't handle escrow or rent financing |
| **Residence.ng** | No | No | No | Partial — dues/rent invoicing | ✅ Visitor passes, audit logs | High — Admin/Executive/Security Guard/Resident | No | Granular RBAC, AWS/PCI-DSS posture | Narrow estate scope; no payments beyond dues; no portability across estates |
| **PropertyPro.ng** | ✅ Dominant — largest traffic, AI tools, 360° tours | No | No | No | No | None (listing portal) | No | Largest listing inventory, price indices | No transaction layer; agents pay subscription; no verified resident data |
| **Nigeria Property Centre** | ✅ Strong | No | No | No | No | None | No | AI price prediction, high traffic, verified listings | Same as PropertyPro — listing-only |
| **Hutbay** | ✅ Land-focused | No | No | No | No | None | No | Fraud alerts, AI search | Niche; no transactions |
| **Spleet** | Partial | No | No | ✅ RNPL, auto-collect, tenant verify | No | Low | Partial — RNPL product | Rent financing, only 1.2% NPL | Can only serve 10% of demand; no wallet; no physical access; no multi-role |
| **Plistbooking** | Partial (hotel listings) | ✅ Full PMS + channel manager | ✅ Hotel PMS | No | No | Low — host / front desk | No | 100+ OTA channels, local focus | No identity/KYC layer; no payments wallet; no resident/estate integration |
| **Hostaway / Guesty** | No | ✅ Global leader | Partial | No | No | Medium — host / PM / ops | No | 60+ OTA channels, automation | $20-50/unit/month, USD pricing — alienates Nigerian operators; no NGN wallet; no local regulatory fit |
| **Estate Intel** | No | No | No | No | No | None (data product) | No | RE market intelligence data | Not an ops tool; potential data-partnership target |

**Where the incumbent is weak and a payments super-app wins (one-page thesis):**

Our Property NG is a strong *operational* tool but a thin *financial* platform. It collects rent via third-party gateways; it cannot hold escrow, issue rent financing, or route FX payouts to diaspora landlords. Its roles are flat (landlord / property manager / tenant / guard), not contextual: one human cannot simultaneously be a tenant in Estate A and a landlord in Estate B without either duplicate accounts or confused UX. Most critically, its visitor-access module and its rent/listing tools are *operationally linked but financially siloed* — a verified resident cannot leverage her payment history to reduce landlord friction, and a guest booking a shortlet inside an estate cannot auto-receive a gate pass.

Paymax has the wallet, KYC, FX, idempotent ledger, and existing visitor-access graph. The property management suite does *not* need to beat Our Property NG at property operations. It needs to be the **financial and identity backbone** that Our Property NG is not — and use that advantage to make switching cost irrelevant.

---

## 3. PILLAR DEEP-DIVES

### Pillar 1: Property Listing Marketplace

**Market:** Nigeria's formal residential real estate market is valued at ≈$29.2B (2024), growing at ~4.5% CAGR to 2030. The housing deficit stands at 14.9M–20M units. Urban prices in Lagos and Abuja are rising 10–12% annually. 70–80% of developer sales come from diaspora buyers. Estate Intel and NPC data confirm a data-hungry market.

**Jobs to be done:**
- *Buyer/Renter:* Find verified listings without fraud; get price context; conduct viewing remotely (diaspora); transact with escrow protection; get a mortgage.
- *Seller/Agent:* Syndicate listing broadly; filter serious buyers; handle KYC-verified enquiries; get paid on completion.
- *Landlord discovering tenants:* Verify tenant identity and rental history before committing.
- *Investor:* Access portfolio-level analytics and yield data remotely.

**Where current tools fail:**
- PropertyPro.ng and NPC are listing aggregators — no transaction layer, no escrow, no KYC verification, no rental history.
- Agents pay subscription to list but get no transaction infrastructure in return; the platform captures no take-rate on transactions.
- No platform unifies the listings database with verified resident identity (someone who already lives in an estate and can verify neighbourhood claims).
- No portability of rental payment history as a trust signal for landlords.

**Must-have features (Table-stakes):**
- Verified property listings (title check, owner KYC-gated publishing)
- Advanced search with map view, filters by LGA/neighbourhood
- Agent directory with subscription listings
- Price indices and neighbourhood insights (Estate Intel partnership or own data)
- Enquiry and scheduling system

**Differentiators (only Paymax can do cheaply):**
- Escrow-protected transactions (wallet + KYC = regulatory clarity)
- Rent Passport — tenant's verified payment history from on-platform rent management, exported as trust signal to new landlords
- Diaspora remote-purchase mode with FX-aware escrow and payout (Maplerad/Eversend rails already built)
- Resident-verified neighbourhood data — estate residents with active visitor-access profiles can vouch for listings inside their estate
- In-app viewings scheduling with identity-verified buyer (KYC already done)

---

### Pillar 2: Shortlet Management

**Market:** Lagos shortlet market reached ₦281B in revenue in 2025 (263% growth in 3 years). ~1,316 active Airbnb listings in Lagos. Average daily rate ≈$79; occupancy 31–44%. Lekki Phase I alone: ₦94B/yr. Nigeria's tourism sector is growing; 1.2M visitors to Lagos in December 2024.

**Jobs to be done:**
- *Host:* Manage calendar across Airbnb/Booking.com/direct without double-bookings; automate guest messaging; set dynamic pricing; manage cleaning/turnover; reconcile payouts in NGN.
- *Guest:* Book trustworthy, verified accommodation; pay easily (card, wallet, USSD); get access credentials (gate pass, key code) without friction.
- *Estate/building management:* Control which units can be listed as shortlets; approve new shortlet operators; ensure guests have valid gate passes.

**Where current tools fail:**
- Plistbooking offers local PMS + 100+ OTAs but has no identity/KYC layer, no wallet, and no estate integration.
- Hostaway/Guesty are globally excellent but priced in USD ($20–50/unit/month), have no NGN wallet, and have no integration with Nigerian gate infrastructure.
- No platform auto-provisions a visitor pass for a confirmed shortlet booking.
- Hosts reconcile payouts manually across USD (OTA) → NGN (local bank) with FX friction that Paymax's FX orchestration resolves.

**Must-have features:**
- Unified calendar (sync with Airbnb, Booking.com, Expedia via 2-way API)
- Anti-double-booking engine
- Automated guest messaging (pre-arrival, check-in, checkout)
- NGN-native payouts to wallet; FX-aware settlement for OTA USD payouts
- Booking website (direct bookings, zero OTA commission)
- Damage deposit escrow (wallet-held, released on checkout)

**Differentiators:**
- Auto-issue timed visitor pass on confirmed booking (estate integration — unique to Paymax)
- Host KYC (identity verified via existing super-app KYC) as a trust signal for OTA listings
- Guest wallet for payment (no card friction for Nigerian guests)
- Shortlet listings surfaced in the property marketplace (inventory network effect)
- Estate admin approval for new shortlet units (visibility + compliance for estates)

---

### Pillar 3: Hotel Booking Management

**Market:** Nigeria's hospitality sector is growing alongside shortlet demand. Hotel booking is dominated by global OTAs (Booking.com, Hotels.ng). Local PMS solutions are thin. Plistbooking is the main local player but limited in scale.

**Jobs to be done:**
- *Hotel manager:* Manage room inventory, reservations, check-in/out, housekeeping scheduling, multi-rate plans, OTA parity pricing, group bookings.
- *Front-desk staff:* Access reservation details, process check-in, verify identity, issue room access.
- *Guest:* Book and pay conveniently; get room access digitally; message front desk; review stay.

**Where current tools fail:**
- Plistbooking is the only serious local player; limited to 100+ OTAs but weak in front-desk UX, staff workflow.
- Global PMS tools (Opera, Cloudbeds) are expensive, USD-priced, not localised for NGN/USSD/wallet payment.
- No integration between hotel bookings and Nigeria's gate/access infrastructure.
- Staff management in local hotels is paper-based; housekeeping coordination is phone-based.

**Must-have features:**
- Room type inventory management
- Reservations engine with calendar view
- Front-desk web console (check-in/out, payment, ID capture)
- OTA channel manager (2-way Airbnb/Booking.com/Hotels.ng sync)
- Staff roles (front desk, housekeeping, manager, GM)
- Rate plans and promotions

**Differentiators:**
- NGN-native wallet/card payment at checkout
- Digital room access credentials (QR code sent to guest on booking confirmation)
- Guest identity verified via KYC at time of payment — no separate check-in ID friction
- Unified inventory: hotel rooms also surfaced in the listing marketplace
- Wallet-held damage deposits, auto-released on checkout

---

### Pillar 4: Property Owner ↔ Tenant ↔ Rent Management

**Market:** ~98% of Lagos residents rent. Rent is typically paid annually upfront. Spleet's RNPL product received overwhelming demand but could only service 10% of applicants (NPL: 1.2%). Landlords lose weeks to manual collection and have no digital tools for lease management, maintenance, or dispute documentation.

**Jobs to be done:**
- *Landlord:* Receive rent reliably; find and verify tenants; enforce lease terms; manage maintenance requests; document disputes; receive payouts remotely (diaspora).
- *Tenant:* Pay rent monthly (not annual lump sum); document payment history for portability; raise maintenance; access lease digitally; get deposit back.
- *Property manager/agent:* Manage multiple owners' portfolios; collect management fees; track maintenance across properties.
- *Service provider/artisan:* Accept maintenance jobs; get paid instantly via wallet; build reputation.

**Where current tools fail:**
- Our Property NG handles operations but has no rent financing, no tenant trust score, no escrow.
- Spleet handles financing but has no physical access integration, no estate context, no multi-role.
- No platform lets a tenant leverage her verified payment history when moving to a new landlord.
- Disputes over deposits are extremely common and poorly documented — no escrow, no paper trail.

**Must-have features:**
- Lease creation with e-signature (Nigeria Evidence Act 2011 supports electronic records)
- Automated rent invoicing and reminders (SMS/push)
- Wallet-debit rent collection (auto-debit on due date, with tenant consent)
- Deposit escrow (wallet-held; conditional release on lease end)
- Maintenance request tracking with artisan marketplace
- Tenant/landlord communication log (admissible evidence in disputes)

**Differentiators:**
- Rent Passport: portable tenant credit history (verified KYC + on-platform payment record)
- Rent financing / RNPL funded from Paymax's wallet infrastructure (cf. Spleet model, at lower 3.5%/month)
- Estate-linked rent: if a tenant is already a resident (visitor-access graph), lease management flows naturally from the existing estate profile — no re-onboarding
- Diaspora landlord mode: FX-aware payouts (Maplerad/Eversend rails already built), remote approval of maintenance spend, remote lease signing

---

## 4. RBAC MODEL — ONE IDENTITY, MANY CONTEXTUAL ROLES

### Design Principle

One Supabase auth UID. Roles are **contextual assignments** scoped by entity (estate / property / unit / booking / org), not account types. A single human can hold `Estate Admin` at Estate A and `Tenant` at Estate B simultaneously. The mobile app presents a context-switcher; the admin console scopes all data to the selected entity context.

### Role Definitions

| Role | Scope Entity | Mobile App | Admin Console | Key Permissions |
|---|---|---|---|---|
| **Platform Super Admin** | Global | None | Full | All modules; compliance oversight; dispute resolution; feature flags; billing |
| **Estate Admin / Exco** | Estate | View dashboard, communicate residents | Full estate config; residents; dues; gate; staff; reports | Manage residents, dues, elections, facilities, documents, vendors |
| **Facility Manager** | Estate | Maintenance requests | Maintenance, vendors, repairs, facilities | Raise/assign repairs; manage vendors; estate services |
| **Security / Gate Guard** | Estate | QR scan, visitor verify | None (web access is offline-resilient guard station only) | Verify/log visitor entry+exit; vehicle pass check; incident report; **no rent/wallet data** |
| **Property Owner / Landlord** | Property/Unit | View lease, rent, maintenance | Lease management; rent collection; tenant management; payout config | Create/manage properties; assign tenants; view payment history; initiate payouts |
| **Property Manager / Agent** | Multi-property org | Client overview | Multi-branch portfolio; commission dashboard; staff management | Manage owner portfolios; list properties; receive management fee; multi-branch staff hierarchy |
| **Tenant / Resident** | Unit + Estate | Pay rent, raise maintenance, visitors, lease docs | None | Pay rent/dues; manage visitors; view lease; raise maintenance; export Rent Passport |
| **Shortlet Host** | Unit | Calendar, bookings, guest messages | Channel manager; pricing; payout; unit config | Manage shortlet units; sync OTAs; configure pricing rules; issue access credentials |
| **Shortlet / Hotel Guest** | Booking | Book, pay, access credentials, message | None | View/pay booking; receive visitor pass; rate stay |
| **Hotel Manager** | Hotel entity | Summary dashboard | Full hotel: inventory, reservations, rates, staff, reports | All hotel ops; multi-rate management; OTA parity |
| **Front-desk Staff** | Hotel entity | Check-in scan | Reservations; check-in/out; payment; housekeeping | Check-in/out; payment processing; no financial admin |
| **Service Provider / Artisan** | Job-scoped | Job list; accept; complete; get paid | None | Accept maintenance jobs; upload evidence; receive wallet payout; rate by tenant |
| **Buyer / Renter (marketplace)** | None / Estate-of-interest | Search, enquire, schedule, escrow | None | Browse verified listings; escrow purchase intent; schedule viewings; import Rent Passport |
| **Investor / Diaspora Owner** | Property/Portfolio | Portfolio dashboard, payout, approvals | Payout config; maintenance approval; FX settings | Remote payout in FX; approve maintenance spend; receive reports; no day-to-day ops |

### Multi-role Context Switching

The mobile app presents a **role context bar** at the top of the home screen. On first login, roles are inferred from data (tenant if active lease found, landlord if properties owned, guard if assigned to gate shift). Switching context reloads the home screen to the relevant role's dashboard. The admin console always starts in the org/entity selection screen.

**Rule for rent management inside estate context:**
When a user holds both `Estate Tenant / Resident` and their landlord is also an estate member (property is within an estate), rent management appears as a sub-section of the estate dashboard. Lease terms, dues, maintenance requests, and rent payments all share the same entity context — no duplication. If the property is standalone (not in an estate), rent management appears as a standalone landlord/tenant module.

### Audit Logging & Least Privilege

- Every write action (rent payment, lease signature, visitor entry, escrow release, ban, rate change) creates an immutable audit entry with: actor UID, role-in-context, entity, action, payload hash, timestamp. This exceeds what Residence.ng exposes.
- Gate Guard role explicitly **cannot** see financial data (rent, wallet balance, lease terms). The guard station API surface is: verify pass → log entry/exit → report incident.
- Service Provider role is job-scoped: can only see the maintenance job assigned, the tenant contact on that job, and their own earnings. Cannot see other tenants or properties.
- Estate Admin role cannot see individual wallet balances — only aggregated dues status per unit.

---

## 5. PRIORITISED FEATURE BACKLOG

**Legend:** [TS] = Table-stakes | [D] = Differentiator | [MS] = Moonshot
**Build origin:** [Reuse] = reuse existing super-app primitive | [Integrate] = 3rd-party integration | [Build] = net new
**Effort:** S = 1–2 sprints | M = 3–6 sprints | L = 7+ sprints
**Impact:** H = transformative / H = material / M = incremental
**Surface:** Mobile | Web Admin | Both

### Phase 1 — Estate-led Rent & Identity Foundation

| Feature | Tag | Origin | Effort | Impact | Surface |
|---|---|---|---|---|---|
| Contextual multi-role identity (context switcher, role-scoped home) | [TS] | [Reuse] existing auth/RBAC | M | H | Both |
| Tenant onboarding from existing estate resident profile | [D] | [Reuse] visitor-access graph | S | H | Mobile |
| Lease creation + e-signature | [TS] | [Build] (new) | M | H | Both |
| Automated rent invoicing + SMS/push reminders | [TS] | [Reuse] notifications + [Build] invoicing | M | H | Both |
| Wallet-debit rent collection (auto-debit with consent) | [D] | [Reuse] wallet debit | S | H | Both |
| Deposit escrow (wallet-held, conditional release) | [D] | [Reuse] wallet + [Build] escrow conditions | M | H | Both |
| Tenant maintenance request with artisan assignment | [TS] | [Build] | M | M | Both |
| Artisan marketplace (vetted, rated, wallet-paid) | [D] | [Build] + [Reuse] wallet | L | M | Both |
| Rent Passport (tenant payment history export / shareable link) | [D] | [Reuse] ledger + [Build] export/share | M | H | Mobile |
| Estate dues + service charges (leverages existing estate module) | [TS] | [Reuse] existing estate dues | S | H | Both |
| Landlord payout (NGN + diaspora FX) | [D] | [Reuse] FX orchestration (already built) | S | H | Both |
| Property Owner / Tenant RBAC roles | [TS] | [Reuse] RBAC system | S | H | Both |
| Audit log (all money mutations, lease events) | [TS] | [Reuse] existing audit infrastructure | S | H | Web Admin |
| Offline-resilient guard station (pass verify, entry log) | [TS] | [Reuse] existing visitor-access | S | M | Mobile |

### Phase 2 — Marketplace + Shortlet

| Feature | Tag | Origin | Effort | Impact | Surface |
|---|---|---|---|---|---|
| Verified property listing (KYC-gated publishing) | [TS] | [Build] | L | H | Both |
| Advanced search (map, filters, price index) | [TS] | [Build] + [Integrate] mapping | L | H | Mobile |
| Agent directory + subscription listings | [TS] | [Build] | M | M | Both |
| Escrow-protected purchase (buyer deposits, conditional release) | [D] | [Reuse] wallet + [Build] conditions | M | H | Both |
| Resident-verified neighbourhood data | [D] | [Reuse] estate resident graph | M | M | Mobile |
| Price indices (partner Estate Intel or internal data) | [D] | [Integrate] or [Build] | L | M | Web Admin |
| Shortlet unit management (calendar, pricing, bookings) | [TS] | [Build] | L | H | Both |
| OTA channel sync (Airbnb, Booking.com, Hotels.ng) | [TS] | [Integrate] OTA APIs | L | H | Web Admin |
| Auto-issue timed visitor pass on confirmed shortlet booking | [MS→D] | [Reuse] visitor-access + [Build] trigger | S | H | Both |
| NGN-native payout for OTA bookings (FX settlement) | [D] | [Reuse] FX orchestration | S | H | Web Admin |
| Damage deposit escrow for shortlet (auto-release post-checkout) | [D] | [Reuse] wallet + escrow | M | H | Both |
| Direct booking website generator | [D] | [Build] | L | M | Web Admin |
| Shortlet host KYC verification badge | [D] | [Reuse] existing KYC | S | M | Both |
| Guest wallet / USSD payment at booking | [D] | [Reuse] wallet | S | H | Mobile |

### Phase 3 — Hotel PMS + Channel Manager + Data/Insurance/Financing

| Feature | Tag | Origin | Effort | Impact | Surface |
|---|---|---|---|---|---|
| Hotel room inventory management | [TS] | [Build] | L | H | Web Admin |
| Front-desk reservations console (check-in, payment, ID capture) | [TS] | [Build] | L | H | Web Admin |
| Hotel staff RBAC (Front Desk, Housekeeping, GM) | [TS] | [Reuse] RBAC | M | M | Web Admin |
| Hotel rate plans and dynamic pricing | [TS] | [Build] | L | M | Web Admin |
| Digital room access credentials | [D] | [Reuse] visitor-access QR infrastructure | S | M | Mobile |
| Rent financing / RNPL (cf. Spleet) | [MS] | [Build] credit scoring + [Reuse] wallet | L | H | Mobile |
| Rent default insurance for landlords | [MS] | [Integrate] insurance partner | L | H | Both |
| Proof-of-address product (compliance-grade) | [MS] | [Reuse] KYC + lease data | M | M | Both |
| Portfolio analytics + reporting (investor view) | [TS] | [Build] | M | M | Web Admin |
| Market data / valuation product (own or Estate Intel partnership) | [MS] | [Build/Integrate] | L | M | Web Admin |

---

## 6. OUTSIDE-THE-BOX BETS — VERDICT

### 2×2 Placement

```
HIGH IMPACT
    |
    |  [3] Escrow deposits  [4] Auto gate pass       [2] Rent Passport
    |  [1] Estate-led CAC   [5] Rent financing        [8] Diaspora mode
    |                       [7] Unified inventory
    |  [10] Proof of addr   [9] Maintenance mkt       [6] Insurance
    |  [6] Insurance attach
    +-------------------------------------------------------> EFFORT
                            LOW ←—————————————————→ HIGH
```

| # | Bet | Verdict | Reasoning |
|---|---|---|---|
| 1 | **Visitor access as CAC wedge** | **BUILD** | Estate-led growth is empirically cheaper: the user is already verified, physically in the estate, and has a trust relationship with neighbours. Resident identity lowers landlord screening cost → faster lease conversion. CAC from estate entry << CAC from listing portal advertising. Sequence: estate → resident → tenant/landlord. This is the core thesis. |
| 2 | **Portable Rent Passport / tenant trust score** | **BUILD (Phase 1)** | Directly attacks Nigeria's #1 landlord pain: unreliable tenants. KYC + on-platform payment record + lease history = a credit file for renting. Regulatory path is manageable: this is a verified data export, not a credit bureau (though CBN licensing would be required if marketed as a credit score). Start as a shareable PDF; evolve into API. |
| 3 | **Paymax escrow for deposits & earnests** | **BUILD (Phase 1)** | Deposit fraud is the #1 trust breakdown in Nigerian property. Paymax holds the wallet and has CBN payment processing credentials. Holding deposits in escrow is functionally a trust account; the regulatory question is whether CBN fintech licensing already covers this or whether a mortgage/trust company structure is needed. Early legal review required; likely manageable under existing e-money frameworks. High impact; blocking only by legal clarity, not technology. |
| 4 | **Auto gate pass on shortlet/hotel booking** | **BUILD (Phase 2, fast)** | Lowest-effort differentiator in the backlog: existing visitor-access module issues QR passes; shortlet/hotel booking module triggers it on confirmation. No competitor can replicate without rebuilding visitor access from scratch. Ship in Phase 2 as a 1-sprint feature once shortlet bookings are live. |
| 5 | **Rent-as-a-flow & RNPL financing** | **PILOT** | Spleet validated demand (only 10% served, 1.2% NPL). Paymax has the wallet and ledger infrastructure. The constraint is credit risk and CBN lending licensing (Consumer/Money Lender license or MFB structure required for unsecured credit). Pilot in Phase 3 with a partner MFB or using payroll-debit model (employer integration) to manage risk before going unsecured. |
| 6 | **Insurance & protection attach** | **PILOT** | Rent-default cover for landlords and damage cover for shortlet hosts are natural attach products at contract signing. Regulatory path is clear (as agent/referrer, not underwriter). Revenue is take-rate on premiums. Integrate a partner insurer (AIICO, AXA Mansard) in Phase 3. Do not build in-house underwriting. |
| 7 | **Unified inventory → marketplace network effect** | **BUILD (Phase 2-3)** | All shortlet + hotel + long-let inventory in one marketplace compounds discovery and SEO. Estate-level demand data (occupancy, dues payment rates, maintenance frequency) becomes a data moat for pricing. Partner with Estate Intel or build proprietary indices. The network effect accrues slowly; start the data collection from Day 1 even if the analytics product ships in Phase 3. |
| 8 | **Diaspora remote-ownership mode** | **BUILD (Phase 1-2)** | 70–80% of Lagos/Abuja developer sales are diaspora. $20.93B in remittances in 2024; ~30% go to real estate. This is a large, underserved, high-LTV segment. Paymax's FX orchestration (Maplerad + Eversend) is already built. The product delta is: remote maintenance approval, FX-aware payout dashboard, currency preference setting, and time-zone-aware rent alerts. Effort is **S-M** against an **H impact** segment. Build it. |
| 9 | **Maintenance marketplace (vetted artisans)** | **BUILD (Phase 1-2)** | Immediate retention hook for tenants/estates; monetised at a take-rate (typically 10–15% of job value). Integrates with existing wallet payout. The artisan vetting (KYC, skill certification, identity check) is an operational investment. Start with estate-referred artisans (already trusted community), expand to open marketplace in Phase 2. |
| 10 | **Proof of address / verified residency product** | **PILOT** | CBN-grade proof of address (active lease + verified identity + payment history) is valuable for banks, lenders, and KYC flows — they pay for it. Technically simple to produce; legally more complex (the consumer must consent to each disclosure, and the product must comply with NDPA consent requirements). Build the underlying data structure in Phase 1; pilot the B2B API in Phase 3 after legal review. |

---

## 7. MONETISATION MODEL

### Revenue Streams

| Stream | Model | Paymax Advantage vs Incumbent |
|---|---|---|
| **Property management SaaS** | Tiered subscription — Free (individual landlords ≤3 units), Basic ₦15k/mo, Growth ₦35k/mo, Enterprise ₦99k+/mo (mirrors Our Property NG pricing) | Incumbents charge for the tool; Paymax charges for the tool + gets float on wallet balances held |
| **Rent collection transaction fee** | 0.5–1.0% per transaction (wallet debit) or flat ₦500/transaction, capped | Paymax *processes* the payment natively; OurPropertyNG/Spleet pay third-party gateways and pass cost to operators |
| **Deposit/escrow fee** | 0.5–1.0% of held amount per year (float income + fee) | No incumbent escrow product. Paymax holds the float. |
| **Shortlet/hotel OTA settlement FX** | 25–50 bps spread on USD → NGN settlement for Airbnb/Booking.com payouts | FX orchestration already built; incumbents (Plistbooking) pay banks at retail FX rates |
| **Marketplace listing subscription** | Agent: ₦5k–₦50k/month tiered by impressions and premium placement | Similar to PropertyPro; differentiator is verified listings and Rent Passport data attracting higher-intent buyers |
| **Marketplace transaction fee** | 1–2% on escrow-protected purchase transactions | No incumbent transaction fee exists; currently zero-take listing portals |
| **RNPL / rent financing interest** | 3–3.5%/month on financed amount (Spleet benchmarks 3.5%/month with 1.2% NPL) | Paymax wallet captures repayments automatically; no third-party collection |
| **Insurance referral / take-rate** | 5–15% of premium on rent-default and damage cover sold at contract signing | Partner model; zero underwriting risk |
| **Artisan marketplace take-rate** | 10–15% of job value, paid via wallet | Wallet settlement is zero-friction; no cash handling |
| **Proof-of-address API** | B2B API pricing: ₦500–₦1,500 per verified residency check sold to lenders/banks | Data moat — only possible because Paymax holds the lease + payment + identity trifecta |
| **Diaspora FX payouts** | Spread on landlord's NGN → USD/GBP/EUR conversion on payouts | FX orchestration (Maplerad + Eversend) built; this is incremental volume |

### What Payments-native Unlocks That Incumbents Cannot Match

1. **Float income:** Holding deposits and escrow balances generates treasury income that no PMS player currently captures.
2. **Zero-cost collections:** Auto-debit via wallet = no gateway fee, no failed-payment chase. Our Property NG passes gateway fees to landlords.
3. **Cross-sell at money moment:** Rent payment screen is the ideal moment to offer rent financing, insurance, and Rent Passport — all on the same session, no separate app.
4. **FX take-rate:** Every diaspora landlord payout and OTA settlement goes through Paymax's FX layer. Incumbents have no FX layer.
5. **Data + credit:** On-platform payment history creates a proprietary credit dataset. This eventually enables RNPL underwriting at lower risk than Spleet (which has to rely on payroll).

---

## 8. COMPLIANCE CHECKLIST

### By Pillar

| Area | Requirement | Pillar | Status | Priority |
|---|---|---|---|---|
| **NDPA 2023 Registration** | All entities processing personal data for >200 persons/6 months must register as DCPMI with NDPC. Late registration incurs penalty fees. | All | Action required — register before launch | Table stakes |
| **NDPA — Consent** | Tenant/landlord/guest data (identity, financial, location, lease terms) requires explicit, informed consent at collection. Consent must be withdrawable. | All | Build consent management into onboarding | Table stakes |
| **NDPA — Data minimisation** | Gate Guard role must not see financial data; artisan must not see tenant's lease terms. Role-scoped access enforced at API layer. | Visitor/Rent/Artisan | Addressed in RBAC design above | Table stakes |
| **CBN payment licensing** | Paymax presumably holds a Payment Solution Service Provider (PSSP) or Super Agent license. Verify that wallet-debit rent collection and escrow are within license scope; may need CBN no-objection letter for escrow-as-a-product. | Rent/Shortlet | Legal review required before Phase 1 launch | Blocking |
| **CBN lending license (RNPL)** | Offering rent financing / RNPL requires a Money Lender license, Microfinance Bank license, or partnership with a licensed MFB. Building RNPL in-house without this is regulatory risk. | RNPL (Phase 3) | Partner with licensed MFB or apply for CBN license before Phase 3 | Blocking for RNPL |
| **Lagos Tenancy Law 2011 (updated 2025)** | Valid quit notice: 1 month (monthly), 3 months (half-yearly), 6 months (yearly). 7-day notice of intention to recover after quit notice. Eviction requires court order. | Rent | Digital lease templates must include compliant notice clauses; reminders on notice periods | Table stakes |
| **E-signature enforceability** | Nigeria Evidence Act 2011 recognises electronic records; digital signature is enforceable if both parties consent. Use a reputable e-sign provider (DocuSign, Verify) with audit trail. | Rent | Integrate e-signature with audit trail | Table stakes |
| **FRCN / company registration** | Property management / estate management entities should be FRCN-registered where applicable. Agents must hold valid property brokerage registration. | Marketplace | Build agent registration step in onboarding | Table stakes |
| **OTA terms — Airbnb/Booking.com** | Channel sync must comply with each OTA's API terms of service. Paymaster/revenue manager must not engage in rate parity violations. Airbnb's terms prohibit certain automated pricing practices. | Shortlet/Hotel | Legal review of OTA API terms before launch | Table stakes |
| **Hospitality licensing** | Lagos State levies Tourism Development Authority (LTDA) registration for shortlets/hotels. Some LGAs require local operating permits. | Shortlet/Hotel | Include LTDA registration step in host onboarding checklist | Differentiator trust signal |
| **KYC/AML reuse** | Leverage existing super-app BVN/NIN/ID verification for all landlord/tenant/host onboarding. Ensure AML monitoring extends to rent and property transactions above relevant thresholds (₦5M+ typically triggers NFIU reporting). | All | Extend existing AML rules to property transactions | Table stakes |
| **Proof of address product** | Issuing a compliance-grade proof of address as a B2B product requires consumer consent per NDPA and potentially FRC/CBN guidance. Get legal opinion before Phase 3 launch. | Data product | Legal review in Phase 3 | Risk — get legal opinion |
| **Access control data** | CCTV footage, LPR data, and biometric gate access are sensitive personal data under NDPA. Retention period should be defined and disclosed. Biometric data requires explicit separate consent. | Visitor/Gate | Data retention policy; biometric consent flow | Table stakes |

---

## 9. PHASED ROADMAP

### The Thinnest Viable Wedge
**The MVP:** A verified estate resident who is also a tenant (already in the visitor-access graph) can: sign a digital lease, pay rent monthly via wallet, automatically send a rent receipt to the landlord, and export a one-page Rent Passport showing 12 months of payment history. The landlord can receive NGN payouts or FX payouts (diaspora).

**Why this is the right wedge:** It converts an *existing* user into a revenue-generating, retained user. No new acquisition cost. It demonstrates wallet + KYC + ledger + visitor-access all working together. It is impossible for Our Property NG to replicate without a major product rebuild.

---

### Phase 1 — "Estate-First Rent" (Months 1–6)

**Goal:** Convert existing estate residents into rent-management users. Zero new CAC.

**Deliverables:**
- Contextual multi-role identity (tenant ↔ landlord ↔ estate resident)
- Tenant onboarding from visitor-access profile (no re-KYC)
- Lease creation + e-signature
- Wallet-debit rent collection with auto-reminders
- Deposit escrow (wallet-held, conditional release)
- Rent Passport (shareable payment history)
- Landlord payout (NGN + FX for diaspora)
- Artisan marketplace v1 (estate-referred artisans; wallet payout)
- Maintenance request tracking
- Diaspora remote-ownership mode
- NDPC registration + NDPA consent flows

**Success metrics:** 500 active leases in 6 months, ₦50M in rent collected via platform, 10 estate admins actively using the integrated view.

---

### Phase 2 — "Shortlet + Marketplace" (Months 7–14)

**Goal:** Unlock shortlet revenue and start building listing inventory.

**Deliverables:**
- Shortlet unit management (calendar, pricing, automated guest messaging)
- OTA channel sync (Airbnb, Booking.com, Hotels.ng)
- **Auto-issue visitor pass on confirmed shortlet booking** (the flagship differentiator)
- NGN-native OTA payout with FX settlement
- Damage deposit escrow for shortlet
- Property listing marketplace (verified listings, KYC-gated publishing, map/filter search)
- Agent directory + subscription tiers
- Escrow-protected purchase transactions
- Resident-verified neighbourhood data
- Rent Passport as a listing marketplace signal (tenants show verified history when enquiring)
- Artisan marketplace v2 (open, not just estate-referred)

**Success metrics:** ₦500M shortlet bookings processed, 1,000 verified listings, 50 agent subscriptions, auto-pass feature adopted by ≥30% of shortlet hosts in gated estates.

---

### Phase 3 — "Hotel PMS + Financing + Data" (Months 15–24)

**Goal:** Complete the hotel vertical, launch rent financing (via MFB partner), and activate data/insurance revenue streams.

**Deliverables:**
- Hotel room inventory management + front-desk console
- Hotel OTA channel manager
- Digital room access credentials (QR → guest on booking confirmation)
- Hotel staff RBAC (Front Desk, Housekeeping, GM, Chain Admin)
- Rent financing / RNPL (via MFB partnership)
- Rent-default insurance for landlords (partner insurer)
- Shortlet damage insurance for hosts (partner insurer)
- Proof-of-address B2B API (after legal clearance)
- Portfolio analytics + investor reporting dashboard
- Market intelligence data (own or Estate Intel partnership)
- LTDA registration integration for shortlet hosts (operator compliance)

**Success metrics:** 20 hotels on platform, ₦2B in RNPL volume facilitated (via MFB partner), ₦100M annual insurance premiums referred, 5 B2B API customers for proof-of-address.

---

## 10. OPEN QUESTIONS & ASSUMPTIONS

| Question | Current Assumption | Evidence That Would Change It |
|---|---|---|
| **Does CBN licensing allow wallet-based escrow for property deposits?** | Assumed to be within existing e-money/PSSP scope, but legal confirmation needed before Phase 1 launch | CBN no-objection letter or legal opinion. If negative, escrow must be restructured as a trust account via a licensed financial institution |
| **Will Our Property NG or Gate Africa respond aggressively to the rent-financing/escrow feature?** | They are unlikely to build it quickly (requires CBN licensing + core fintech rebuild) | Monitor competitor announcements; if either raises a fintech round targeting these features, accelerate Phase 1 |
| **Is the housing deficit segment (affordable/mid-market) or premium segment more accessible?** | Assumed: premium (Lekki, Ikoyi, Ikeja GRA) for Phase 1 because those estates already use visitor-access software and have financially capable tenants. Affordable segment addressed via RNPL in Phase 3 | Market data on which estate profiles use existing visitor-access module; if mid-market estates dominate, re-prioritise RNPL to Phase 2 |
| **Will Airbnb/Booking.com API access be straightforward?** | Assumed: OTA APIs are available (both have developer programs). There may be a qualification/volume threshold before preferential API access | Initiate OTA API applications early in Phase 2; Plistbooking's success with 100+ OTAs is a positive precedent |
| **Is a single Lagos/Abuja launch sufficient to prove the model, or does multi-city launch matter?** | Lagos-first is correct. Lagos has the most estates, the highest rent prices, and the largest diaspora ownership. Abuja is a quick second because the estate penetration pattern is similar | Track estate sign-up rate; if Abuja estates request onboarding before Phase 2 ends, expand sooner |
| **Will tenant Rent Passport adoption require incentives?** | Assumed: tenants adopt voluntarily because a good Rent Passport lowers friction with future landlords. No incentive needed | Monitor export rates in Phase 1; if <20% of tenants export after 6 months, consider a "verified tenant badge" visible to landlords on the marketplace |
| **RNPL credit risk model** | Assumed: payroll-debit model (as Spleet uses) + platform payment history significantly lowers NPL below Spleet's 1.2%. Actual NPL depends on underwriting quality | Commission independent credit risk study with MFB partner before Phase 3 launch; set 5% NPL as ceiling before scaling |

---

## IF I OWNED THIS — WHAT I'D SHIP FIRST

**Month 1–2:** Get legal opinion on CBN wallet-as-escrow. Simultaneously, instrument the existing estate module to detect "this resident is also a tenant" (i.e., their landlord is also on the platform). Those are the first 50 lease candidates.

**Month 3:** Ship the minimum viable lease: digital agreement, e-signature via existing document infrastructure, wallet-debit rent collection on the 1st of each month, and a landlord payout. No marketplace, no shortlet, no hotel.

**Month 4:** Ship Rent Passport (shareable PDF). This is the product demo that sells the vision to new landlords and is a retention hook for tenants. Run press campaign: "the first portable rental credit history in Nigeria."

**Month 5:** Ship diaspora landlord mode (FX payout, remote maintenance approval). This segment has the highest property values, the highest willingness to pay for a reliable tool, and the lowest alternative (currently they use WhatsApp + Remitly).

**Month 6:** Ship auto-gate-pass-on-shortlet-booking. This is the proof-of-concept for why the combined platform is greater than the sum of its parts. It will generate substantial press because no competitor can replicate it.

**Why this order?** Each step builds on a verified user already in the system, de-risks the CBN licensing question before adding financial complexity, and produces a defensible moat before going broad. The instinct to launch the marketplace first is wrong — listing aggregators have no switching costs, and we'd be competing on SEO with PropertyPro.ng from Day 1. The right order is trust → money → discovery, not discovery → money.

---

*Sources used in this analysis:*

- [OurProperty NG Pricing](https://ourproperty.ng/resources/pricing)
- [Gate Africa](https://gate.africa/)
- [Spleet Africa RNPL](https://spleet.africa/rnpl)
- [Nigeria Real Estate Market Size 2024-2030 — NextMSC](https://www.nextmsc.com/report/nigeria-real-estate-market)
- [Lagos Short-let Market ₦281bn — Nigeria Housing Market](https://www.nigeriahousingmarket.com/news/lagos-short-term-rental-market-hits-281bn-revenue-in-2025)
- [Lagos Shortlet Boom — Radarr Africa](https://radarr.africa/short-let-rentals-booming-in-lagos-changing/)
- [Airbnb Lagos Data 2025 — Airbtics](https://airbtics.com/annual-airbnb-revenue-in-lagos-nigeria/)
- [PropertyPro.ng Agent Pricing](https://propertypro.ng/pricing)
- [Nigeria Housing Deficit 2026 — Nigeria Housing Market](https://www.nigeriahousingmarket.com/guides/nigeria-housing-deficit-2026)
- [Lagos Residential Supply Deficit — Nigeria Housing Market](https://www.nigeriahousingmarket.com/news/lagos-housing-supply-deficit-estate-intel-report-2025-2026)
- [Plistbooking PMS](https://plistbooking.com/property-management-system/)
- [Plistbooking Channel Manager](https://plistbooking.com/channel-manager-software-for-property-managers/)
- [Hostaway vs Guesty vs Lodgify 2026 — StaySTRA](https://staystra.com/best-str-channel-manager-2026-hostaway-guesty-lodgify-ownerrez-beds24/)
- [Nigeria Data Protection Act 2023 — NDPC](https://ndpc.gov.ng/wp-content/uploads/2025/07/NDP-ACT-GAID-2025-MARCH-20TH.pdf)
- [NDPA Compliance Guide 2025 — Secure Privacy](https://secureprivacy.ai/blog/nigeria-data-protection-law)
- [Lagos Tenancy Law — Nigeria Property Centre](https://nigeriapropertycentre.com/blog/renting-letting/the-lagos-tenancy-law-in-detail)
- [Lagos Tenancy Law 2025 — Nigeria Real Estate Blog](https://nigeriarealestateblog.com/the-ultimate-guide-to-the-lagos-tenancy-law-2025/)
- [Spleet Raises $2.6M — Business Post](https://businesspost.ng/general/spleet-raises-2-6m-to-spread-rent-offerings-products-to-nigerians/)
- [Diaspora Real Estate Investment 2025 — 234Digest](https://www.234digest.com/p/nigeria-s-real-estate-diaspora-investment-short-let-boom-and-the-affordability-challenge-2926)
- [Diaspora Impact on Nigeria Housing Market 2026 — Nigeria Housing Market](https://www.nigeriahousingmarket.com/guides/diaspora-investment-impact-nigeria-housing-market-2026)
- [Nigeria Real Estate Market 2025 — FSky Homes](https://fskyhomes.com/nigeria-real-estate-market-report-in-depth-insights-for-lagos-abuja/)
- [OurProperty NG Visitor Management](https://ourproperty.ng/our-solutions/visitor)
- [Estate Intel](https://estateintel.com/)
- [Hutbay](https://www.hutbay.com/)
- [Nigeria Property Centre](https://nigeriapropertycentre.com/)
