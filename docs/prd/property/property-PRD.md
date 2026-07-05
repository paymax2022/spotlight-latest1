# Product Requirements Document (PRD)
## Spotlight / Paymax — Property Management Suite (Super-App Module)

| | |
|---|---|
| **Product** | Property Management Suite — a module inside the Spotlight/Paymax super-app |
| **Surfaces** | Consumer **Mobile App** (iOS/Android) + Operator **Web Admin Console** |
| **Version** | 1.0 (Draft for review) |
| **Status** | Draft |
| **Owner** | Product — Spotlight/Paymax |
| **Last updated** | 2026-06-25 |

> **Reading note:** Every screen has a stable ID (`M-…` mobile, `A-…` admin). Use these IDs in Figma frames, Jira tickets and acceptance criteria so design ↔ engineering ↔ QA reference the same artifact. Sections 1–7 are the spec; Section 8 is the exhaustive screen inventory.

---

## 1. Summary & Strategic Thesis

Spotlight/Paymax already operate a fintech super-app (single identity + KYC, wallet, virtual accounts, bill-pay, payouts) and have **shipped a visitor-access feature** for gated estates. This module turns those assets into a full property platform spanning four pillars — **listing marketplace, shortlet management, hotel booking management, and owner↔tenant↔rent management** — plus the existing **visitor access** as the anchor.

**The wedge:** competitors sell estate access *or* rent *or* listings as separate products. We already sit inside estates with verified, physically-present residents. The growth loop is: **visitor access → verified resident identity → rent & dues rails → cross-sell shortlet / marketplace to already-trusted users.** Payments + identity + existing access is the moat incumbents (Our Property NG, Gate Africa, Spleet, PropertyPro.ng) cannot cheaply copy.

**Two architectural commitments that shape every screen:**
1. **One identity, many roles.** A single human can be a landlord, a tenant elsewhere, a shortlet host and a hotel guest at once. Roles are **contextual assignments on one identity**, scoped by entity (estate / property / unit / booking / org) — never separate accounts. This is why the app has a **context switcher**, not multiple logins.
2. **Reuse before build.** Auth, KYC, wallet, payouts, escrow, bill-pay and the visitor-access graph are existing primitives. New screens compose them; they do not rebuild them.

---

## 2. Goals & Success Metrics

| Goal | Primary metric | Target signal |
|---|---|---|
| Win estates as the entry point | Estates onboarded; residents verified | Estate-led CAC < listing-led CAC |
| Convert access users to financial users | % residents paying rent/dues in-app | Rent/dues GMV per estate |
| Become the rent rail | On-time rent collection rate; auto-debit adoption | Reduced arrears vs manual baseline |
| Monetise the stay economy | Shortlet + hotel booking GMV; take-rate | Channel-synced occupancy lift |
| Build trust moat | Verified listings %; disputes resolved via escrow | Fraud-loss reduction |
| Cross-sell | Avg. modules used per identity | ≥ 2 roles/modules per active user |

**Non-goals (v1):** building a new auth/KYC stack; a standalone non-super-app product; full accounting/ERP; international markets beyond NG (architect for it, don't ship it).

---

## 3. Personas & Roles (RBAC)

One identity holds one or more **contextual roles**. Permissions are scoped to the entity the role is granted on.

| Role | Surface(s) | Core jobs |
|---|---|---|
| **Platform Super Admin** (Spotlight/Paymax ops) | Admin | Global config, RBAC, KYC, moderation, settlements, escrow, disputes, compliance |
| **Estate Admin / Exco / Facility Mgr** | Admin (+ mobile-lite) | Residents, units, dues, gate config, security staff, announcements, reports |
| **Security / Gate Guard** | Mobile (offline-first) | Verify passes, log entry/exit, approve/deny, incidents |
| **Property Owner / Landlord** | Mobile + Admin | Units, tenants, leases, rent, maintenance, payouts |
| **Property Manager / Agency** | Admin (+ mobile) | Multi-branch portfolios, staff, listings, collections, owner statements |
| **Tenant / Resident** | Mobile | Pay rent/dues, maintenance, manage own visitors, lease docs |
| **Shortlet Host** | Mobile + Admin | Listings, calendar, pricing, channel sync, guests, payouts |
| **Shortlet / Hotel Guest** | Mobile | Search, book, pay, access credentials, message host/desk |
| **Hotel Manager / Front-desk** | Admin (+ mobile-lite) | Inventory, reservations, check-in/out, housekeeping, folios |
| **Service Provider / Artisan** | Mobile | Accept maintenance jobs, complete, get paid |
| **Buyer / Renter (marketplace)** | Mobile | Search, enquire, viewings, offers, escrow |
| **Investor / Diaspora Owner** | Mobile + Admin | Remote oversight, payouts, reporting |

Cross-cutting requirements: **least-privilege**, **full audit logging** (timestamp, user, IP, action) on every privileged action, **role context switcher**, **step-up KYC** when a user adds a role (e.g. becomes a landlord or host).

---

## 4. Scope & Phasing

- **Phase 1 — The wedge.** Extend visitor access → rent/dues collection, escrow for deposits, verified resident identity, landlord↔tenant management, maintenance, wallet surfaces. (Estate-led.)
- **Phase 2 — Discovery & stays.** Listing marketplace + shortlet management (incl. channel sync) + auto-issued gate passes for stays inside estates.
- **Phase 3 — Hospitality & finance.** Hotel PMS + channel manager, rent financing/RNPL, insurance attach, data/intelligence product, diaspora mode.

Each screen below is tagged with a target phase **[P1]/[P2]/[P3]**.

---

## 5. Information Architecture

**Mobile app** — bottom nav (context-aware): **Home · Discover (Marketplace) · Stays (Shortlet/Hotel) · My Place (Rent/Estate/Visitor) · Wallet**, with **Inbox**, **Notifications**, **Profile/Role switcher** in the top bar. What appears under "My Place" depends on the user's active roles.

**Admin console** — left-nav workspaces gated by role: **Platform**, **Estate**, **Agency/Portfolio**, **Shortlet**, **Hotel**, **Marketplace Ops**, **Finance**, **Support/CRM**, **Analytics**.

---

## 6. Functional Requirements (by module)

Condensed; expanded into screens in §8. Each FR maps to screen IDs.

- **FR-AUTH:** SSO reuse, role context model, step-up KYC, device/session management → `M-ONB-*`.
- **FR-MKT:** verified listings, search/filter/map, listing detail, enquiry, viewing scheduling, offer/application, listing creation & lead management, moderation → `M-MKT-*`, `A-MKT-*`.
- **FR-SHORTLET:** listing & calendar management, dynamic pricing, OTA channel sync, booking lifecycle, guest comms, deposits/escrow, payouts, reviews → `M-SLG-*`, `M-SLH-*`, `A-SLH-*`.
- **FR-HOTEL:** room types/rate plans, reservation engine, front desk, housekeeping, folio/billing, channel manager, reporting → `M-HTG-*`, `M-HTM-*`, `A-HTL-*`.
- **FR-RENT:** properties/units, leases + e-sign, rent invoicing/collection/auto-debit/RNPL, receipts, arrears, notices, rent passport → `M-RLL-*`, `M-RTN-*`, `A-LAND-*`, `A-AGY-*`.
- **FR-VISITOR:** invites (one-time/recurring/event), QR/PIN/plate passes, guard verification (offline), vehicle registry, dues, announcements, incidents, **auto-passes for stays** → `M-VAR-*`, `M-VAG-*`, `A-EST-*`.
- **FR-MAINT:** request → triage → assign artisan → track → pay → rate → `M-RTN-*`, `M-SVP-*`, `A-EST-*`, `A-AGY-*`.
- **FR-PAY:** wallet surfaces, rent vault, escrow, payouts, financing, insurance → `M-PAY-*`, `A-FIN-*`.
- **FR-TRUST:** KYC, listing/landlord/tenant verification, rent passport, proof-of-residency, disputes → `A-SADM-*`, `A-FIN-*`.

---

## 7. Non-Functional Requirements

- **Security/compliance:** NDPC / NDPA alignment (consent, retention, breach, registration), CBN-compliant naira settlement & escrow, audit trails, AES-256 at rest / TLS in transit, PCI-DSS via partners, role-based data minimisation.
- **Resilience:** guard/gate flows **offline-first** with local queue + sync; no double-bookings (idempotent reservation + channel locks).
- **Performance:** marketplace search p95 < 1.5s; pass scan < 1s; payment confirmation < 5s.
- **Accessibility & localisation:** WhatsApp/SMS/push fallbacks; low-bandwidth mode; English first.
- **Auditability:** every privileged action logged and exportable for AGM/compliance.
- **Legal docs:** enforceable digital tenancy agreements + e-signature; tamper-evident receipts.

---

# 8. EXHAUSTIVE SCREEN INVENTORY

Legend — **Roles:** Tn=Tenant/Resident, LL=Landlord, Ag=Agency/PM, Hg=Host, Gs=Guest, HM=Hotel mgr, Gd=Guard, EA=Estate admin, SP=Service provider, By=Buyer/Renter, SA=Super admin, Inv=Investor. **Phase:** P1/P2/P3.

## 8A. MOBILE APP

### Onboarding, Identity & Roles — `M-ONB`
| ID | Screen | Roles | Purpose / key elements | Phase |
|---|---|---|---|---|
| M-ONB-01 | Module entry / splash | All | Enter Property module from super-app hub | P1 |
| M-ONB-02 | Property home personalization | All | First-run: detect roles, suggest "I'm a tenant / landlord / host" | P1 |
| M-ONB-03 | Role/context selector | Multi-role | Switch active context (estate/property/org/booking) | P1 |
| M-ONB-04 | Add-a-role intro | LL/Hg/Ag | Explain becoming landlord/host; entitlements | P1 |
| M-ONB-05 | Step-up KYC | LL/Hg/Ag/SP | Reuse super-app KYC; collect role-specific verification (ownership proof, host docs) | P1 |
| M-ONB-06 | Permissions primer | All | Location, camera, notifications rationale | P1 |
| M-ONB-07 | Link to estate | Tn | Join an existing estate (code/invite/verification) | P1 |
| M-ONB-08 | Verification status | LL/Hg/Tn | Pending/approved/rejected verification states | P1 |

### Home & Global — `M-HOME`
| ID | Screen | Roles | Purpose | Phase |
|---|---|---|---|---|
| M-HOME-01 | Personalized home/dashboard | All | Role-aware cards: rent due, passes, bookings, leads, payouts | P1 |
| M-HOME-02 | Global search | All | Cross-module search (properties, stays, units, people) | P2 |
| M-HOME-03 | Notifications center | All | Grouped alerts (payments, access, bookings, maintenance) | P1 |
| M-HOME-04 | Inbox / conversations list | All | Threads with hosts, agents, tenants, guards | P1 |
| M-HOME-05 | Conversation / chat | All | In-app messaging, attachments, system messages | P1 |
| M-HOME-06 | Activity feed / timeline | All | Recent actions across roles | P2 |

### Marketplace (Buy / Rent / Sell) — `M-MKT`
| ID | Screen | Roles | Purpose | Phase |
|---|---|---|---|---|
| M-MKT-01 | Marketplace discover/feed | By | Curated + nearby + trending listings | P2 |
| M-MKT-02 | Search & filters | By | Type, price, beds, location, verified-only | P2 |
| M-MKT-03 | Map view | By | Geo browse + cluster pins | P2 |
| M-MKT-04 | Listing detail | By | Media, specs, price, verification badge, agent | P2 |
| M-MKT-05 | Gallery / 360° / video tour | By | Immersive media | P2 |
| M-MKT-06 | Saved / shortlist | By | Favorites + saved searches + alerts | P2 |
| M-MKT-07 | Enquiry / contact | By | Message agent/owner; request info | P2 |
| M-MKT-08 | Schedule viewing | By | Pick slot; calendar sync; reminders | P2 |
| M-MKT-09 | Offer / rental application | By | Submit offer/application + docs | P2 |
| M-MKT-10 | Affordability / mortgage calc | By | Financing estimate (outside-box) | P3 |
| M-MKT-11 | Report listing / fraud flag | By | Trust & safety | P2 |
| M-MKT-12 | Create listing (wizard) | LL/Ag | Multi-step: details, media, price, verify | P2 |
| M-MKT-13 | My listings | LL/Ag | Status (active/pending/let/sold), edit | P2 |
| M-MKT-14 | Leads inbox | LL/Ag | Enquiries, viewings, applications pipeline | P2 |
| M-MKT-15 | Listing performance | LL/Ag | Views, saves, enquiries | P2 |

### Shortlet — Guest — `M-SLG`
| ID | Screen | Roles | Purpose | Phase |
|---|---|---|---|---|
| M-SLG-01 | Shortlet search | Gs | Location, dates, guests, price | P2 |
| M-SLG-02 | Results + map | Gs | List/map, filters (amenities, instant book) | P2 |
| M-SLG-03 | Shortlet detail | Gs | Amenities, house rules, calendar, reviews | P2 |
| M-SLG-04 | Booking flow | Gs | Dates, guests, price breakdown, deposit | P2 |
| M-SLG-05 | Payment + deposit/escrow | Gs | Wallet pay; damage deposit held in escrow | P2 |
| M-SLG-06 | Booking confirmation | Gs | Receipt + access credentials | P2 |
| M-SLG-07 | Trip details / guidebook | Gs | Check-in instructions, digital guidebook, location | P2 |
| M-SLG-08 | **Stay gate pass** | Gs | Auto-issued estate visitor pass (QR/PIN/plate) for the stay | P2 |
| M-SLG-09 | Message host | Gs | Pre/post-stay comms | P2 |
| M-SLG-10 | Modify / cancel booking | Gs | Policy-aware changes, refunds | P2 |
| M-SLG-11 | Review & rate stay | Gs | Ratings + photos | P2 |
| M-SLG-12 | My trips | Gs | Upcoming/past stays | P2 |

### Shortlet — Host — `M-SLH`
| ID | Screen | Roles | Purpose | Phase |
|---|---|---|---|---|
| M-SLH-01 | Host dashboard | Hg | Today's check-ins/outs, earnings, alerts | P2 |
| M-SLH-02 | Add/edit listing | Hg | Photos, amenities, rules, capacity | P2 |
| M-SLH-03 | Calendar | Hg | Availability, blocks, min-stay | P2 |
| M-SLH-04 | Pricing & rules | Hg | Base/seasonal/dynamic, fees, deposits | P2 |
| M-SLH-05 | Channel sync status | Hg | Airbnb/Booking.com sync, conflicts | P2 |
| M-SLH-06 | Reservations inbox | Hg | Requests, confirmations, detail | P2 |
| M-SLH-07 | Reservation detail | Hg | Guest, dates, payout, pass issuance | P2 |
| M-SLH-08 | Guest messaging + automations | Hg | Templates, scheduled messages | P2 |
| M-SLH-09 | Payouts & earnings | Hg | Balance, withdraw, statements | P2 |
| M-SLH-10 | Damage deposit / claims | Hg | Raise claim against escrow | P2 |
| M-SLH-11 | Turnover / cleaning tasks | Hg/SP | Assign cleaner, checklist | P3 |
| M-SLH-12 | Reviews | Hg | Respond to guest reviews | P2 |

### Hotel — Guest — `M-HTG`
| ID | Screen | Roles | Purpose | Phase |
|---|---|---|---|---|
| M-HTG-01 | Hotel search | Gs | Location, dates, rooms, guests | P3 |
| M-HTG-02 | Hotel detail | Gs | About, amenities, location, reviews | P3 |
| M-HTG-03 | Room types & rates | Gs | Availability, rate plans, inclusions | P3 |
| M-HTG-04 | Booking flow | Gs | Room, occupancy, add-ons | P3 |
| M-HTG-05 | Payment | Gs | Wallet/pay; pay-now/pay-at-hotel | P3 |
| M-HTG-06 | Confirmation + check-in | Gs | Voucher, digital check-in, access (incl. estate pass if applicable) | P3 |
| M-HTG-07 | Manage booking | Gs | Modify/cancel, requests | P3 |
| M-HTG-08 | Review & rate | Gs | Post-stay feedback | P3 |

### Hotel — Manager (mobile-lite) — `M-HTM`
| ID | Screen | Roles | Purpose | Phase |
|---|---|---|---|---|
| M-HTM-01 | Today board | HM | Arrivals/departures/in-house | P3 |
| M-HTM-02 | Reservation lookup | HM | Find/inspect booking | P3 |
| M-HTM-03 | Quick check-in/out | HM | Status change, key/pass issue | P3 |
| M-HTM-04 | Room status | HM | Clean/dirty/OOO toggle | P3 |

### Rent & Tenant — Landlord — `M-RLL`
| ID | Screen | Roles | Purpose | Phase |
|---|---|---|---|---|
| M-RLL-01 | Portfolio overview | LL | Properties, units, occupancy, arrears | P1 |
| M-RLL-02 | Add property / unit | LL | Property + unit details, ownership proof | P1 |
| M-RLL-03 | Add / invite tenant | LL | Invite via phone/super-app; link to estate resident | P1 |
| M-RLL-04 | Tenant screening / rent passport | LL | View portable rent history & score | P1 |
| M-RLL-05 | Create lease (wizard) | LL | Terms, rent, dates, clauses, e-sign | P1 |
| M-RLL-06 | Rent schedule & invoicing | LL | Generate invoices, cycles, auto-reminders | P1 |
| M-RLL-07 | Rent ledger / collection | LL | Paid/pending/overdue per unit | P1 |
| M-RLL-08 | Receipts | LL | Issue/view tamper-evident receipts | P1 |
| M-RLL-09 | Maintenance inbox | LL | Incoming requests, triage | P1 |
| M-RLL-10 | Assign artisan | LL | Pick vetted provider, set budget | P1 |
| M-RLL-11 | Notices | LL | Renewal/rent-increase/eviction notices | P1 |
| M-RLL-12 | Payouts | LL | Collected rent to wallet/bank | P1 |
| M-RLL-13 | Documents vault | LL | Leases, IDs, receipts | P1 |

### Rent & Tenant — Tenant — `M-RTN`
| ID | Screen | Roles | Purpose | Phase |
|---|---|---|---|---|
| M-RTN-01 | My residence | Tn | Current lease, landlord, balance | P1 |
| M-RTN-02 | Pay rent | Tn | Wallet/auto-debit/RNPL options | P1 |
| M-RTN-03 | Auto-debit / rent vault setup | Tn | Schedule, savings toward rent | P1 |
| M-RTN-04 | Rent history & receipts | Tn | Past payments, downloadable | P1 |
| M-RTN-05 | Rent passport / score | Tn | Portable trust profile | P1 |
| M-RTN-06 | Maintenance request | Tn | Raise issue, photos, track status | P1 |
| M-RTN-07 | Lease documents | Tn | View/sign lease, renewals | P1 |
| M-RTN-08 | Estate dues / service charge | Tn | View & pay dues (links to estate) | P1 |
| M-RTN-09 | Notices from landlord/estate | Tn | Renewals, increases, announcements | P1 |
| M-RTN-10 | Apply for rent financing/RNPL | Tn | Eligibility, application, status | P3 |

### Visitor Access — Resident — `M-VAR`
| ID | Screen | Roles | Purpose | Phase |
|---|---|---|---|---|
| M-VAR-01 | Estate home | Tn | Estate hub: invites, dues, notices, SOS | P1 |
| M-VAR-02 | Invite visitor | Tn | One-time / recurring / event; generate pass | P1 |
| M-VAR-03 | Active passes | Tn | Live QR/PIN/plate codes, share | P1 |
| M-VAR-04 | Visitor history | Tn | Past entries/exits | P1 |
| M-VAR-05 | Pre-authorize service provider | Tn | Recurring access (cleaner, gas, etc.) | P1 |
| M-VAR-06 | Vehicle registry | Tn | Register cars/plates, stickers | P1 |
| M-VAR-07 | Household members | Tn | Add dependents/co-residents | P1 |
| M-VAR-08 | Estate announcements / forum | Tn | Read posts, react, comment | P1 |
| M-VAR-09 | Report issue / SOS / panic | Tn | Security alert + facility issue | P1 |
| M-VAR-10 | Pay dues / wallet | Tn | Service charge, levies | P1 |
| M-VAR-11 | Polls / voting | Tn | Estate decisions (outside-box) | P2 |

### Visitor Access — Guard / Security — `M-VAG`
| ID | Screen | Roles | Purpose | Phase |
|---|---|---|---|---|
| M-VAG-01 | Guard sign-in / shift | Gd | Start/end shift; gate assignment | P1 |
| M-VAG-02 | Scan / verify pass | Gd | QR/PIN/plate verification (offline) | P1 |
| M-VAG-03 | Manual visitor entry | Gd | Log walk-ins; capture details | P1 |
| M-VAG-04 | Approve / deny + notify | Gd | Request resident approval in real time | P1 |
| M-VAG-05 | Entry/exit log | Gd | Continuous gate log | P1 |
| M-VAG-06 | Resident lookup | Gd | Find resident/unit/contact | P1 |
| M-VAG-07 | Incident report | Gd | Log incidents w/ media | P1 |
| M-VAG-08 | Offline queue / sync | Gd | Pending records, sync status | P1 |

### Service Provider / Artisan — `M-SVP`
| ID | Screen | Roles | Purpose | Phase |
|---|---|---|---|---|
| M-SVP-01 | Job inbox | SP | Available/assigned maintenance jobs | P1 |
| M-SVP-02 | Job detail / accept | SP | Scope, location, budget, accept/decline | P1 |
| M-SVP-03 | On-the-job | SP | Navigate, update status, upload proof | P1 |
| M-SVP-04 | Get paid | SP | Receive payout to wallet | P1 |
| M-SVP-05 | Ratings & profile | SP | Reputation, verification badges | P1 |

### Wallet & Money (module surfaces) — `M-PAY`
| ID | Screen | Roles | Purpose | Phase |
|---|---|---|---|---|
| M-PAY-01 | Property wallet overview | All | Balances across rent/payouts/escrow | P1 |
| M-PAY-02 | Rent vault / savings | Tn | Save toward rent; progress | P1 |
| M-PAY-03 | Escrow status | By/Gs/LL/Hg | Deposits/earnest held & release conditions | P1 |
| M-PAY-04 | Payouts / withdraw | LL/Hg/Ag/SP | Move funds to bank | P1 |
| M-PAY-05 | Transactions history | All | Filterable ledger | P1 |
| M-PAY-06 | Financing / RNPL | Tn | Apply, schedule, repay | P3 |
| M-PAY-07 | Insurance offers & policies | LL/Tn/Hg | Rent-default, contents, damage cover | P3 |

### Account, Settings, Support — `M-ACC`
| ID | Screen | Roles | Purpose | Phase |
|---|---|---|---|---|
| M-ACC-01 | Profile | All | Identity, verification badges, roles held | P1 |
| M-ACC-02 | Roles & permissions | Multi-role | Manage/leave roles; switch context | P1 |
| M-ACC-03 | Settings | All | Notifications, security, language, privacy | P1 |
| M-ACC-04 | Documents vault | All | Centralized docs (leases, IDs, receipts) | P1 |
| M-ACC-05 | Disputes | All | Raise/track dispute (escrow-linked) | P1 |
| M-ACC-06 | Help & support | All | FAQ, chat, ticket | P1 |
| M-ACC-07 | Referral / invite | All | Refer estates/landlords/users | P2 |
| M-ACC-08 | Proof of residency request | Tn | Generate verified residency letter (outside-box) | P3 |

---

## 8B. WEB ADMIN CONSOLE

### Platform Super Admin — `A-SADM`
| ID | Screen | Roles | Purpose | Phase |
|---|---|---|---|---|
| A-SADM-01 | Global dashboard | SA | Platform KPIs, GMV, growth, alerts | P1 |
| A-SADM-02 | Identity & user management | SA | Search users, 360 view, suspend, merge | P1 |
| A-SADM-03 | RBAC & permission config | SA | Define roles, scopes, entitlements | P1 |
| A-SADM-04 | KYC / verification queue | SA | Review landlord/host/tenant verifications | P1 |
| A-SADM-05 | Estates & organizations directory | SA | Onboard/manage estates & agencies | P1 |
| A-SADM-06 | Listings moderation | SA | Approve/flag/remove listings | P2 |
| A-SADM-07 | Disputes & resolution | SA | Queue, evidence, escrow decisions | P1 |
| A-SADM-08 | Compliance & audit logs | SA | Searchable, exportable action logs | P1 |
| A-SADM-09 | Channel/OTA integration config | SA | Airbnb/Booking/Expedia credentials & mapping | P2 |
| A-SADM-10 | CMS / content & taxonomy | SA | Categories, banners, featured | P2 |
| A-SADM-11 | Notifications & templates | SA | Email/SMS/WhatsApp/push templates | P1 |
| A-SADM-12 | Fraud & risk monitoring | SA | Signals, rules, case management | P2 |
| A-SADM-13 | Feature flags / config | SA | Phased rollout control | P1 |
| A-SADM-14 | Reports & analytics hub | SA | Cross-pillar reporting | P1 |

### Estate Admin / Exco / Facility — `A-EST`
| ID | Screen | Roles | Purpose | Phase |
|---|---|---|---|---|
| A-EST-01 | Estate dashboard | EA | Collections, occupancy, visitor stats, issues | P1 |
| A-EST-02 | Residents & units registry | EA | Searchable registry; owner/tenant per unit | P1 |
| A-EST-03 | Move-in / move-out | EA | Onboarding/offboarding residents | P1 |
| A-EST-04 | Dues & service-charge setup | EA | Define dues, cycles, levies | P1 |
| A-EST-05 | Collections & revenue assurance | EA | Paid vs pending, arrears, reminders | P1 |
| A-EST-06 | Visitor logs & analytics | EA | Entry/exit, peak times, anomalies | P1 |
| A-EST-07 | Gate & access config | EA | Gates, devices, boom barriers, LPR, passes | P1 |
| A-EST-08 | Security staff & shifts | EA | Guard accounts, rosters, performance | P1 |
| A-EST-09 | Announcements & forum moderation | EA | Broadcast, moderate community | P1 |
| A-EST-10 | Maintenance / facility tickets | EA | Estate-level work orders | P1 |
| A-EST-11 | Vendors / artisans | EA | Vetted provider directory | P1 |
| A-EST-12 | Estate wallet & payouts | EA | Estate funds, disbursements | P1 |
| A-EST-13 | Reports (AGM / Exco) | EA | One-click financial & ops reports | P1 |
| A-EST-14 | Polls / voting admin | EA | Create & tally resident votes | P2 |

### Agency / Property Management Company — `A-AGY`
| ID | Screen | Roles | Purpose | Phase |
|---|---|---|---|---|
| A-AGY-01 | Org dashboard | Ag | Portfolio KPIs, collections, leads | P1 |
| A-AGY-02 | Branches | Ag | Multi-branch setup & hierarchy | P1 |
| A-AGY-03 | Staff & roles | Ag | Team accounts, permissions, targets | P1 |
| A-AGY-04 | Portfolio (owners/properties/units) | Ag | Manage managed assets | P1 |
| A-AGY-05 | Listings management | Ag | Bulk listing/publish/moderate | P2 |
| A-AGY-06 | Leads / CRM | Ag | Pipeline: enquiry→viewing→close | P2 |
| A-AGY-07 | Leases & documents | Ag | Lease lifecycle, e-sign, storage | P1 |
| A-AGY-08 | Rent roll / collections | Ag | Org-wide arrears & collection | P1 |
| A-AGY-09 | Maintenance management | Ag | Work orders, SLAs, vendors | P1 |
| A-AGY-10 | Owner statements & payouts | Ag | Per-owner reconciliation | P1 |
| A-AGY-11 | Commission tracking | Ag | Agent commissions & splits | P2 |
| A-AGY-12 | Reports | Ag | Performance, occupancy, finance | P1 |

### Landlord / Owner (web) — `A-LAND`
| ID | Screen | Roles | Purpose | Phase |
|---|---|---|---|---|
| A-LAND-01 | Portfolio overview | LL/Inv | Units, occupancy, income, arrears | P1 |
| A-LAND-02 | Properties & units | LL | Detailed asset management | P1 |
| A-LAND-03 | Tenants & leases | LL | Lease lifecycle, screening | P1 |
| A-LAND-04 | Rent ledger | LL | Invoices, payments, statements | P1 |
| A-LAND-05 | Maintenance | LL | Requests, assignment, costs | P1 |
| A-LAND-06 | Statements & payouts | LL/Inv | Income statements, withdrawals | P1 |
| A-LAND-07 | Documents | LL | Leases, receipts, ownership | P1 |

### Shortlet Host / Manager (web) — `A-SLH`
| ID | Screen | Roles | Purpose | Phase |
|---|---|---|---|---|
| A-SLH-01 | Host dashboard | Hg | Occupancy, revenue, upcoming stays | P2 |
| A-SLH-02 | Listings management | Hg | Create/edit, bulk media | P2 |
| A-SLH-03 | Multi-calendar | Hg | All units, blocks, sync state | P2 |
| A-SLH-04 | Channel manager | Hg | OTA mapping, rate parity, sync logs | P2 |
| A-SLH-05 | Rates & pricing rules | Hg | Seasonal/dynamic, length-of-stay | P2 |
| A-SLH-06 | Reservations | Hg | Booking pipeline & detail | P2 |
| A-SLH-07 | Guest CRM / messaging | Hg | Threads, automations, templates | P2 |
| A-SLH-08 | Payouts & finance | Hg | Statements, deposits, claims | P2 |
| A-SLH-09 | Turnover / housekeeping ops | Hg | Cleaner scheduling, checklists | P3 |
| A-SLH-10 | Reviews & reputation | Hg | Manage reviews | P2 |
| A-SLH-11 | Occupancy & revenue reports | Hg | RevPAR/ADR-style analytics | P2 |

### Hotel PMS — `A-HTL`
| ID | Screen | Roles | Purpose | Phase |
|---|---|---|---|---|
| A-HTL-01 | Property setup | HM | Rooms, room types, rate plans, policies | P3 |
| A-HTL-02 | Reservation calendar | HM | Tape chart / availability grid | P3 |
| A-HTL-03 | Booking engine config | HM | Direct-booking settings | P3 |
| A-HTL-04 | Front desk (check-in/out) | HM | Arrivals, departures, walk-ins | P3 |
| A-HTL-05 | Housekeeping board | HM | Room status, assignments | P3 |
| A-HTL-06 | Channel manager | HM | OTA inventory & rate sync | P3 |
| A-HTL-07 | Rates & inventory | HM | Dynamic rates, stop-sell | P3 |
| A-HTL-08 | Guest profiles | HM | History, preferences, loyalty | P3 |
| A-HTL-09 | Folio / billing / invoicing | HM | Charges, payments, splits | P3 |
| A-HTL-10 | POS / add-ons (optional) | HM | Extras, F&B | P3 |
| A-HTL-11 | Staff management | HM | Roles, shifts | P3 |
| A-HTL-12 | Reports (Occupancy/ADR/RevPAR) | HM | Performance analytics | P3 |

### Marketplace Ops — `A-MKT`
| ID | Screen | Roles | Purpose | Phase |
|---|---|---|---|---|
| A-MKT-01 | Listings moderation & verification | SA | Verify legitimacy, badges | P2 |
| A-MKT-02 | Taxonomy & categories | SA | Property types, attributes | P2 |
| A-MKT-03 | Featured / promotions | SA | Paid placement, boosts | P2 |
| A-MKT-04 | Agent verification | SA | Vet agents/agencies | P2 |
| A-MKT-05 | Marketplace analytics | SA | Supply/demand, conversion | P2 |

### Finance & Payments — `A-FIN`
| ID | Screen | Roles | Purpose | Phase |
|---|---|---|---|---|
| A-FIN-01 | Settlements | SA | Merchant/host/landlord settlement | P1 |
| A-FIN-02 | Escrow ledger | SA | Held funds, release conditions | P1 |
| A-FIN-03 | Payout management | SA | Approve/track payouts | P1 |
| A-FIN-04 | Refunds & chargebacks | SA | Dispute-linked reversals | P2 |
| A-FIN-05 | Financing / loan book | SA | RNPL/rent-advance portfolio & risk | P3 |
| A-FIN-06 | Insurance policies | SA | Policies, claims, partners | P3 |
| A-FIN-07 | Reconciliation & exports | SA | Accounting exports, statements | P1 |
| A-FIN-08 | Rent-passport / credit data | SA | Manage portable trust scoring | P3 |

### Support / CRM — `A-CRM`
| ID | Screen | Roles | Purpose | Phase |
|---|---|---|---|---|
| A-CRM-01 | Ticket queue | SA | Inbound support tickets | P1 |
| A-CRM-02 | User 360 view | SA | All roles, transactions, history | P1 |
| A-CRM-03 | Dispute workbench | SA | Evidence, decisions, payouts | P1 |
| A-CRM-04 | Macros / knowledge base | SA | Canned responses, articles | P2 |

### Analytics / BI — `A-BI`
| ID | Screen | Roles | Purpose | Phase |
|---|---|---|---|---|
| A-BI-01 | Executive dashboards | SA | Cross-pillar KPIs | P1 |
| A-BI-02 | Pillar dashboards | SA | Rent / shortlet / hotel / marketplace / estate | P2 |
| A-BI-03 | Cohort & retention | SA | Multi-role adoption, cross-sell | P2 |
| A-BI-04 | Custom reports / exports | SA | Build & schedule exports | P2 |

---

## 9. Cross-Cutting Flows (must be designed end-to-end)

1. **Estate-led onboarding loop:** estate signs up `A-EST-01` → residents verified `M-ONB-07/08` → dues/rent live `M-RTN-08`, `M-RLL-06` → cross-sell stays/marketplace.
2. **Rent collection:** invoice `M-RLL-06` → pay `M-RTN-02` (wallet/auto-debit/RNPL) → receipt `M-RLL-08`/`M-RTN-04` → arrears `A-LAND-04`.
3. **Deposit escrow:** booking/lease deposit held `M-PAY-03` → release/claim → dispute `M-ACC-05`/`A-CRM-03`.
4. **Stay → access:** confirmed shortlet/hotel stay `M-SLG-06`/`M-HTG-06` → auto gate pass `M-SLG-08` → guard verify `M-VAG-02`.
5. **Maintenance:** tenant raises `M-RTN-06` → triage `M-RLL-09`/`A-EST-10` → assign `M-RLL-10` → artisan `M-SVP-*` → pay/rate.
6. **Channel sync:** host listing `A-SLH-02` ↔ OTA `A-SLH-04`/`A-SADM-09`; anti-double-booking enforced.

---

## 10. Data Model (high level)

Core entities: **Identity** (1) ←→ **RoleAssignment** (many, scoped to entity) → **Estate / Property / Unit / Listing / Booking / Lease / Organization**. Plus: **Visitor Pass**, **Payment / Invoice / Receipt**, **Escrow**, **Payout**, **MaintenanceTicket**, **Document**, **Review**, **Dispute**, **AuditLog**, **RentPassport/CreditProfile**, **ChannelMapping**. Wallet/KYC/identity references point to existing super-app services.

---

## 11. Analytics & Event Tracking (instrument from day 1)

Key events: role_added, kyc_completed, estate_joined, rent_invoice_created, rent_paid, autodebit_enabled, deposit_escrowed, escrow_released, dispute_opened, listing_created, listing_verified, viewing_scheduled, booking_created, channel_synced, pass_issued, pass_scanned, maintenance_created, maintenance_completed, payout_completed, financing_applied, cross_sell_module_opened.

---

## 12. Risks, Assumptions & Open Questions

- **Escrow & financing licensing** — confirm regulatory permissions before P1 escrow / P3 lending.
- **OTA terms** — Airbnb/Booking API access and rate-parity constraints for channel sync.
- **Offline guard reliability** — must work through poor connectivity; conflict resolution on sync.
- **Multi-role UX complexity** — context switching must stay simple; usability-test early.
- **Incumbent depth** — Our Property NG already does much of P1; our edge is payments + escrow + access. Validate that edge converts.
- **Open:** single-market (NG) vs multi-market data model now? Hotel PMS build vs integrate a 3rd-party PMS? Rent passport fairness/regulatory review.

---

## 13. Screen Count Summary

| Surface | Modules | Screens |
|---|---|---|
| Mobile app | 13 modules | ~95 |
| Admin console | 11 workspaces | ~75 |
| **Total** | | **~170 screens** (exhaustive baseline; some expand into sub-states) |
