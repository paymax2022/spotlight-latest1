# Product Requirements Document — Restaurant Platform (Customer App + Admin Management)

**Product:** Multi-channel restaurant ordering, reservation & management platform
**Surfaces in scope:** Customer mobile app · Restaurant Admin/Management console (web + tablet) · Kitchen Display System (KDS) · Staff/Waiter app
**Adjacent (interfaced):** Third-party delivery aggregators, payment processors, delivery fleet
**Status:** Draft v1.0 · **Owner:** Product · **Last updated:** 18 June 2026
**Build note:** Written to be implementation-ready — requirement IDs, priorities, data model, and acceptance signals are explicit so this can be handed directly to an engineering agent (e.g., Claude Code) and decomposed into tickets.

---

## 0. How to Read This Document & Scoping Decision

No screen list was attached to this request, so rather than block, I **architected the full screen inventory from first principles** (Appendix A) and built the platform as a complete ecosystem. A "restaurant app and admin management" is realistically four surfaces, because the customer experience and the operational reality are two sides of the same order:

1. **Customer app** — discovery, ordering across three channels (dine-in QR, pickup, delivery), reservations, payment, tracking, loyalty.
2. **Admin / Management console** — menu, orders, tables, reservations, inventory, staff, promotions, settlement, analytics, multi-location.
3. **Kitchen Display System (KDS)** — the production floor; tickets, stations, timing, bump.
4. **Staff / Waiter app** — table service, order-taking, POS-lite, payment at table.

Two things are elevated out of the module lists into their own sections because they are where most restaurant tech *fails*: **Unified Order Orchestration** (§13) and **Real-Time Menu & Inventory Availability** (§14). A separate **Intelligence Layer** (§15) covers the "outside the box" opportunities.

---

## 1. Executive Summary

This platform lets a guest find a restaurant, browse a live menu, and order through whichever channel suits them — scanning a QR at the table, ordering ahead for pickup, or having it delivered — and lets the restaurant run all of it from one console: one order queue, one menu source of truth, one inventory ledger, one set of books.

The customer app must make ordering feel **faster than flagging down a waiter**. The admin console must make a busy Friday night feel **controllable** — every channel's orders in one queue, the kitchen never overwhelmed, the 86'd dish vanishing from every menu instantly, and the money reconciled by close.

The defensible core is not the menu UI — that's commodity. It is **order orchestration across channels**, **real-time availability tied to actual inventory**, and **kitchen-capacity intelligence** that quotes honest prep times and throttles during a rush. Those three are what keep a restaurant from drowning, and they're what most competitors get wrong.

---

## 2. Vision, Strategy & Product Principles

**Vision:** One system that runs the whole order — from the guest's first tap to the kitchen bump to the closed-out books — across every channel a restaurant sells through.

**Principles (tie-breakers):**
1. **The kitchen is the constraint.** Never accept an order the kitchen can't honor; honest prep times beat optimistic ones.
2. **One source of truth per fact.** One menu, one price, one stock count — read by every surface, edited in one place.
3. **Availability is real-time or it's a lie.** An 86'd item must disappear everywhere within seconds.
4. **Degrade, don't fail.** Payment provider down, internet flaky, printer offline — the floor keeps serving.
5. **The guest's time is the product.** Every screen earns its place by getting them fed faster.
6. **Money must reconcile by close.** Every order, refund, tip, and channel fee accounted for, nightly.

---

## 3. Problem Statement & Context

Restaurants today juggle a POS, a separate reservations tool, two or three delivery-aggregator tablets, a paper kitchen ticket rail, and a spreadsheet for inventory. Orders arrive in five places; the menu lives in seven; the 86'd item is still selling on an aggregator twenty minutes later; and reconciling the night means three exports and a calculator.

For the guest: slow ordering, stale menus, "sorry, we're out of that" after they've paid, and opaque wait times.

This platform collapses that into a single order pipeline and a single menu/inventory truth, with the kitchen's real capacity as the governor — serving both the guest (one clean app) and the operator (one console).

---

## 4. Goals & Success Metrics

### 4.1 North Star
**Successfully fulfilled orders per location per day** — captures demand, conversion, kitchen throughput, and reliability in one number.

### 4.2 KPIs

| Domain | Metric | Target |
|---|---|---|
| Conversion | Menu-view → completed-order rate | > 25% (pickup/delivery) |
| Speed | Dine-in QR: scan → order placed | < 90s median |
| Accuracy | Orders fulfilled without item substitution/cancellation | > 97% |
| Availability | 86'd item still orderable after toggle | < 5s, ~0% |
| Kitchen | Quoted vs actual prep-time accuracy (±) | within 3 min, 90% of orders |
| Reliability | Orders lost/dropped in pipeline | ~0% |
| Money | Nightly reconciliation auto-balanced | > 99% of days |
| Retention | 30-day repeat-order rate | trending up |
| Ops | Channel orders in unified queue (vs separate tablets) | 100% |
| Quality | Avg order rating | > 4.5 / 5 |

---

## 5. Scope & Phasing Summary

**In scope:** customer app, admin console, KDS, staff app, the orchestration and availability engines, payments/settlement, loyalty, analytics, multi-location.

**Interfaced, not specified:** third-party aggregator internals, payment-processor internals, external delivery-fleet apps.

**Phasing** (detail in §23): **V1** = single-location dine-in QR + pickup ordering, menu/inventory, KDS, payments, basic admin + reconciliation. **V2** = delivery (own + aggregator ingestion), reservations/floor, staff app, loyalty/promos, analytics. **V3** = multi-location, intelligence layer, advanced inventory/recipe costing, CRM/marketing.

---

## 6. System Architecture (Conceptual)

| Surface / Service | Role |
|---|---|
| **Customer app** | Discover, order (dine-in/pickup/delivery), reserve, pay, track, earn loyalty |
| **Admin console** | Menu, orders, tables, reservations, inventory, staff, promos, settlement, analytics, config |
| **KDS** | Ticket routing by station, prep timing, bump, all-day counts |
| **Staff/Waiter app** | Table service, order-taking, POS-lite, pay-at-table |
| **Order orchestrator** | Single pipeline merging all channels (§13) |
| **Menu/Inventory engine** | Real-time availability + stock truth (§14) |
| **Payments & settlement** | Card/wallet/cash/transfer, tips, refunds, channel-fee reconciliation |
| **Reservation/floor engine** | Tables, availability, waitlist, seating |
| **Loyalty/promo engine** | Points, rewards, vouchers, campaigns |
| **Notification service** | Push, SMS, in-app |
| **Aggregator gateway** (interfaced) | Ingest 3P orders, sync availability outward |
| **Intelligence layer** | Demand forecast, prep-time prediction, menu/CRM assist (§15) |

---

## 7. Personas & Roles

**Demand side**
- **Guest (Dine-in)** — at a table, wants to order and pay without waiting.
- **Guest (Pickup)** — ordering ahead, wants an honest ready time.
- **Guest (Delivery)** — wants tracking and accurate ETA.

**Restaurant side (least-privilege roles)**
- **Owner / Multi-location Admin** — full control, cross-location analytics, config.
- **Location Manager** — menu, staff, orders, reservations, settlement for their site.
- **Waiter / Floor Staff** — order-taking, table service, pay-at-table.
- **Kitchen / Expo** — KDS operation, bump, 86 items.
- **Cashier / Host** — reservations, seating, payment, waitlist.
- **Finance** (chain-level) — settlement, refunds, reporting.

---

## 8. Information Architecture

**Customer app nav:** Home (discover/menu) · Orders · Reserve · Rewards · Profile.
**In-order context:** Cart · Checkout · Track.

**Admin console nav:** Dashboard · Orders · Menu · Tables & Reservations · Inventory · Staff · Promotions & Loyalty · Payments & Settlement · Reviews/CRM · Analytics · Locations · Settings.

**KDS:** ticket grid by station · all-day view · bump bar · recall.

**Staff app:** Floor/Tables · New Order · Open Tabs · Payments · 86 list · Shift.

---

## 9. Core End-to-End Journeys

1. **Dine-in QR:** scan table QR → live menu → add items + modifiers → order → kitchen receives → courses fired → served → pay-at-table (or staff settles) → review.
2. **Pickup:** browse → cart → checkout/pay → quoted ready-time (capacity-aware) → kitchen prep → "ready" notification → pickup → review.
3. **Delivery:** order/pay → prep → dispatch (own fleet or 3P) → live tracking/ETA → delivered → review.
4. **Reservation:** select date/party/time → availability check → confirm → reminder → seated → linked to order/tab.
5. **Menu management:** create item → modifiers/combos → pricing/schedule → availability rules → publish → live everywhere instantly.
6. **Kitchen:** ticket routes to stations → prep timers → expo coordinates courses → bump → all-day counts update.
7. **Close-out:** reconcile all channels → tips, refunds, channel fees → daily settlement report.

---

## 10. Functional Requirements — Customer App

> Priority: **P0** (V1) · **P1** (V2) · **P2** (V3).

### 10.1 Onboarding & Account (CUST-AUTH)
| ID | Requirement | Pri |
|---|---|---|
| CA-1 | Phone/email signup + OTP; social login; guest checkout (no account required for first order). | P0 |
| CA-2 | Profile: name, saved addresses, payment methods, dietary preferences/allergens, notification settings. | P0 |
| CA-3 | Order history with reorder-in-one-tap. | P0 |

### 10.2 Discovery & Menu (CUST-MENU)
| ID | Requirement | Pri |
|---|---|---|
| CM-1 | Restaurant/location discovery (for multi-location); single-restaurant home for branded build. | P0 |
| CM-2 | Live menu by category with photos, descriptions, prices, dietary/allergen tags, spice/portion info. | P0 |
| CM-3 | **Real-time availability**: out-of-stock/86'd items shown unavailable instantly (§14). | P0 |
| CM-4 | Item detail with **modifiers** (required/optional, single/multi), add-ons, combos/meals, special instructions. | P0 |
| CM-5 | Search, filter (dietary, price, category), and recommendations/popular items. | P1 |
| CM-6 | Channel-aware menu (some items pickup/delivery-only or dine-in-only) and time-based menus (breakfast/lunch). | P1 |

### 10.3 Ordering & Channels (CUST-ORDER)
| ID | Requirement | Pri |
|---|---|---|
| CO-1 | **Dine-in via QR**: scan table QR → table-bound session → order routes to that table. | P0 |
| CO-2 | **Pickup**: select pickup, get **capacity-aware quoted ready time**, schedule-ahead option. | P0 |
| CO-3 | **Delivery**: address + delivery-zone/fee check, quoted ETA, contactless option. | P1 |
| CO-4 | Cart: edit quantities/modifiers, item notes, order-level notes, promo/voucher entry, tip selection. | P0 |
| CO-5 | Group/shared table ordering (multiple guests add to one table tab). | P2 |
| CO-6 | Order minimum, surcharge, service charge, tax shown transparently before pay. | P0 |

### 10.4 Checkout & Payment (CUST-PAY)
| ID | Requirement | Pri |
|---|---|---|
| CP-1 | Pay via card, wallet, bank transfer; saved methods; split-bill (by item or evenly) for dine-in. | P0 (card/wallet) / P1 (split) |
| CP-2 | Apply loyalty points/rewards/vouchers at checkout. | P1 |
| CP-3 | Clear price breakdown (subtotal, tax, service, delivery, tip, discounts); payment success/failure/pending states. | P0 |
| CP-4 | Pay-at-counter / pay-with-cash (dine-in/pickup) option where enabled by restaurant. | P0 |

### 10.5 Tracking & Post-order (CUST-TRACK)
| ID | Requirement | Pri |
|---|---|---|
| CT-1 | Live order status: received → preparing → ready/out-for-delivery → completed, with timestamps & notifications. | P0 |
| CT-2 | Delivery live tracking + ETA; pickup "ready now" alert. | P1 |
| CT-3 | Rate & review order; report an issue (missing/wrong item) → refund/credit flow. | P1 |
| CT-4 | Receipt + downloadable history. | P0 |

### 10.6 Reservations & Loyalty (CUST-EXTRA)
| ID | Requirement | Pri |
|---|---|---|
| CR-1 | Book a table (date/party/time), availability check, confirmation, reminders, modify/cancel, waitlist join. | P1 |
| CR-2 | Loyalty: earn points per order, tiers, rewards catalogue, vouchers, referral. | P1 |
| CR-3 | Saved favorites and dietary-preference-aware menu highlighting. | P2 |

---

## 11. Functional Requirements — Admin / Management Console

| ID | Module | Requirement | Pri |
|---|---|---|---|
| AD-1 | **Order Management** | **Unified queue** of all channels (dine-in/pickup/delivery/3P) with status, accept/reject, prep-time adjust, refund, reprint/re-fire (§13). | P0 |
| AD-2 | **Menu Management** | CRUD items/categories/modifiers/combos; pricing, schedules, channel rules, photos, dietary tags; **publish = live everywhere**. | P0 |
| AD-3 | **Availability / 86** | One-tap mark item/modifier unavailable; auto-86 on stock depletion; scheduled availability (§14). | P0 |
| AD-4 | **Inventory** | Stock levels, low-stock alerts, **recipe-level depletion** (selling a dish decrements ingredients), waste logging, supplier/PO (V3). | P1 / P2 |
| AD-5 | **Tables & Floor** | Floor plan, table states (open/seated/dirty), QR-per-table mapping, merge/split tables. | P1 |
| AD-6 | **Reservations** | Reservation calendar, capacity rules, waitlist, seating, no-show handling, deposits. | P1 |
| AD-7 | **Staff & Roles** | Staff accounts, role-based permissions, shifts/clock-in, performance basics. | P1 |
| AD-8 | **Promotions & Loyalty** | Discounts, vouchers, happy-hour/time-based pricing, loyalty config, campaign scheduling. | P1 |
| AD-9 | **Payments & Settlement** | Daily reconciliation across channels, tips distribution, refunds, channel-fee accounting, payout reports, tax/VAT. | P0 |
| AD-10 | **Reviews & CRM** | Review inbox + response, customer profiles/segments, order history, marketing exports. | P1 / P2 |
| AD-11 | **Analytics** | Sales by channel/item/hour, kitchen throughput, prep-time accuracy, top/under-performers, cohort/retention. | P1 |
| AD-12 | **Multi-location** | Location switcher, cross-location menu inheritance + overrides, consolidated reporting. | P2 |
| AD-13 | **Settings & Config** | Hours, channels enabled, delivery zones/fees, surcharges, payment methods, printer/KDS config, feature flags. | P0 |

---

## 12. Functional Requirements — Operational Surfaces

### 12.1 Kitchen Display System (KDS)
| ID | Requirement | Pri |
|---|---|---|
| KDS-1 | Tickets appear in real time, **routed to the right station** (grill/fry/cold/bar); color/timer escalation as they age. | P0 |
| KDS-2 | Bump (mark done) per item and per ticket; recall a bumped ticket; expo/all-day view (e.g., "12 fries fired"). | P0 |
| KDS-3 | Course firing / hold-and-fire for dine-in; modifier and allergen highlighting; **86 an item from KDS** (propagates everywhere). | P0 / P1 |
| KDS-4 | Offline-resilient: queued tickets survive a network blip; printer fallback. | P1 |

### 12.2 Staff / Waiter App
| ID | Requirement | Pri |
|---|---|---|
| ST-1 | Floor/table view; open a tab; take/modify orders; send to kitchen; fire courses. | P1 |
| ST-2 | Pay-at-table (card/wallet/cash), split bill, apply discount, add tip, print/email receipt. | P1 |
| ST-3 | View live 86 list; transfer/merge tables; handoff between staff at shift change. | P1 |

---

## 13. Unified Order Orchestration *(differentiator)*

Every order — dine-in QR, pickup, delivery, and ingested third-party-aggregator orders — lands in **one pipeline with one state machine**, so the floor never watches five tablets.

**Canonical order states:** `placed → accepted → in_kitchen → ready → (handoff: served | picked_up | dispatched → delivered) → completed`, with `rejected`, `cancelled`, `refunded` branches.

**Rules:**
- **OO-1 (P0):** All channels normalize into the same Order entity and queue; channel is an attribute, not a separate system.
- **OO-2 (P0):** **Capacity-aware acceptance** — the orchestrator quotes prep time from current kitchen load (§15) and can **throttle/pause a channel** during a rush instead of accepting orders the kitchen can't honor.
- **OO-3 (P0):** Idempotent, no-loss pipeline — an order is never silently dropped; failures surface to admin for action.
- **OO-4 (P1):** Third-party aggregator orders are ingested into the same queue and KDS; availability syncs outward so aggregators reflect 86'd items.
- **OO-5 (P0):** Every state transition is timestamped and audit-logged for reconciliation and dispute handling.

---

## 14. Real-Time Menu & Inventory Availability *(differentiator)*

One menu/inventory truth, read by customer app, KDS, staff app, and aggregators; edited in one place; propagated in seconds.

- **AV-1 (P0):** A single published menu source; price/description/availability edits go live across all surfaces in < 5s.
- **AV-2 (P0):** Manual **86 toggle** (item or modifier) from admin, KDS, or staff app — propagates everywhere immediately, including outward to aggregators (V2).
- **AV-3 (P1):** **Recipe-linked depletion** — selling a dish decrements ingredient stock; an item auto-86s when a required ingredient hits zero.
- **AV-4 (P1):** Scheduled/time-based availability (breakfast menu, happy hour) and channel-specific availability.
- **AV-5 (P0):** Race-condition safety — concurrent orders for a last-unit item resolve deterministically; the loser gets a clear, immediate "just sold out" state, never a post-payment surprise.

---

## 15. Intelligence Layer *(outside-the-box; phased)*

Optional but high-leverage, and natural to power with an AI model:
- **IN-1:** **Prep-time prediction** from live kitchen load → honest quoted times (feeds OO-2).
- **IN-2:** **Demand forecasting** by daypart/day → prep-ahead and inventory guidance.
- **IN-3:** **Menu-content assist** — generate/clean item descriptions, allergen tagging, photo suggestions.
- **IN-4:** **Review-response drafting** and sentiment summarization for the review inbox.
- **IN-5:** **Smart upsell/recommendations** in the customer cart based on order context.
- **IN-6:** **Anomaly/loss detection** in reconciliation (voids, comps, refund patterns).

---

## 16. Data Model (Key Entities)

`Restaurant`/`Location` (hours, channels, zones, config) ·
`MenuItem` (category, price, modifiers[], dietary_tags[], availability, channel_rules, schedule) ·
`Modifier`/`ModifierGroup` (required, min/max, price_delta) ·
`Combo` ·
`InventoryItem` (stock, unit, low_threshold) · `Recipe` (item → ingredient quantities) ·
`Order` (channel, state, items[], totals, tax, tip, discounts, table_id?, customer_id?, timestamps[], audit[]) ·
`OrderItem` (menu_item, modifiers[], qty, notes, station_route) ·
`Table` (zone, state, qr_code, capacity) · `Reservation` (party, time, status, deposit) ·
`Payment` (method, amount, tip, status, refunds[]) · `Settlement` (channel fees, payouts, period) ·
`Customer` (profile, addresses[], preferences, loyalty_balance) ·
`LoyaltyAccount` / `Voucher` / `Promotion` ·
`StaffUser` (role, permissions, shifts[]) ·
`Review` · `AuditEvent` (actor, action, target, timestamp).

---

## 17. Permissions Matrix (abridged)

| Capability | Guest | Waiter | Kitchen | Cashier/Host | Loc. Manager | Owner | Finance |
|---|---|---|---|---|---|---|---|
| Place/track own order | ✅ | — | — | — | — | — | — |
| Take/modify table order | — | ✅ | — | ✅ | ✅ | ✅ | — |
| Bump / 86 from KDS | — | — | ✅ | — | ✅ | ✅ | — |
| Edit menu/pricing | — | — | — | — | ✅ | ✅ | — |
| Manage inventory | — | — | view | — | ✅ | ✅ | — |
| Refunds | — | — | — | limited | ✅ | ✅ | ✅ |
| Reservations/seating | — | — | — | ✅ | ✅ | ✅ | — |
| Settlement & payouts | — | — | — | — | view | ✅ | ✅ |
| Staff & roles | — | — | — | — | ✅ | ✅ | — |
| Multi-location config | — | — | — | — | — | ✅ | — |

---

## 18. Non-Functional Requirements

| Area | Requirement |
|---|---|
| **Performance** | Menu load < 1.5s; add-to-cart instant; order placement < 2s; KDS ticket appears < 2s. |
| **Reliability** | No-loss order pipeline; KDS and staff app survive network blips with local queue + sync. |
| **Real-time** | Availability/86 propagation < 5s across all surfaces. |
| **Scalability** | Rush-hour concurrency per location; multi-location tenancy with data isolation. |
| **Security** | PCI-compliant payment handling (tokenized, no raw card storage); role-based access; audit trail. |
| **Resilience** | Payment-provider fallback; printer fallback for KDS; offline order-taking that syncs. |
| **Localization** | Currency, tax/VAT/service-charge rules, language, local payment methods. |
| **Accessibility** | Large-tap KDS/staff controls; readable allergen/alert states; high-contrast modes. |

---

## 19. Payments, Settlement & Financial Logic

- Channels: card, wallet, bank transfer, cash, pay-at-counter; tips (in-app and at-table); split-bill.
- Transparent fee/tax/service/delivery breakdown pre-payment.
- **Nightly reconciliation (§11 AD-9):** aggregate all channels, allocate tips, net out aggregator/processor fees, surface refunds/voids/comps, produce a balanced daily settlement and payout report. **Anomaly flags** (IN-6) on irregular void/refund/comp patterns.
- Refund/credit flow tied to the order-issue path (CT-3) with audit.

---

## 20. Notifications Matrix

**Customer:** order accepted · preparing · ready/out-for-delivery · delivered · reservation confirmed/reminder · loyalty reward earned · issue-resolution/refund.
**Staff/Admin:** new order · order needs acceptance · channel throttled · **low-stock / auto-86** · reservation/waitlist · payment failure · refund request · settlement ready · negative review.
Safety/operational-critical (auto-86, channel throttle, payment failure) cannot be silenced.

---

## 21. Edge & Error States

No internet (offline order-taking + sync) · server error · payment failed/pending · item sold out post-add (AV-5) · order rejected by kitchen · delivery zone unavailable · reservation full/waitlist · QR invalid/expired · printer/KDS offline · aggregator sync failure · session expired · empty states (no orders/menu/reservations/reviews) · maintenance mode · app update required.

---

## 22. Analytics & Dashboards

**Operator:** sales by channel/item/daypart, average ticket, kitchen throughput, prep-time accuracy, table turn time, 86-frequency, top/under-performers, labor vs sales.
**Customer-quality:** ratings, issue rate, repeat rate, loyalty engagement.
**Business:** North Star (§4.1), GMV, channel mix, fee leakage, location comparison.

---

## 23. Release Roadmap

**V1 — One location, ordering that doesn't break**
Customer app: dine-in QR + pickup, live menu/modifiers, cart, card/wallet/cash pay, tracking, receipts. KDS: routing, timers, bump, 86. Admin: order queue (unified), menu management, availability/86, payments + **nightly reconciliation**, core settings. Orchestration (OO-1/2/3/5) + availability (AV-1/2/5).

**V2 — Channels, floor & loyalty**
Delivery (own fleet + aggregator ingestion), reservations/floor plan, staff/waiter app, loyalty/promotions, split-bill, recipe-linked inventory, analytics, reviews/CRM.

**V3 — Scale & intelligence**
Multi-location, intelligence layer (§15), advanced inventory/recipe costing + suppliers/PO, CRM/marketing, group/shared-tab ordering.

---

## 24. Risks, Assumptions, Dependencies & Open Questions

**Risks**
- *Kitchen overwhelm during rush* → bad food, bad reviews. Mitigation: capacity-aware acceptance + throttling (OO-2).
- *Stale availability* → post-payment "we're out." Mitigation: real-time 86 + race-safety (§14).
- *Reconciliation gaps* → lost money. Mitigation: unified pipeline audit + nightly auto-balance (§19).
- *Aggregator fragmentation* → orders missed. Mitigation: ingest into one queue (OO-4).
- *Payment/printer failure mid-service* → floor stalls. Mitigation: fallbacks + offline mode (§18).

**Assumptions**
- Payment processor, aggregator APIs, and (for delivery) a fleet or 3P logistics are integrable.
- Restaurants will maintain a single source-of-truth menu in this system rather than parallel tools.

**Dependencies**
- Payment gateway; SMS/push provider; aggregator APIs; delivery logistics; printer/KDS hardware.

**Open questions**
1. **Branded single-restaurant app or multi-restaurant marketplace?** Changes discovery, onboarding, and economics fundamentally — assumed extensible to both, V1 single-location.
2. Own delivery fleet, third-party logistics, or aggregator-only for delivery?
3. Is this replacing the POS or sitting alongside one? (Determines whether AD/Staff app must be the system of record at the till.)
4. Cash handling depth at V1 — full drawer/till management or app-recorded only?
5. Which aggregators to ingest first, and is two-way availability sync available on their APIs?
6. Tip-distribution policy (pooled vs individual) — affects settlement logic.

---

## Appendix A — Generated Screen Inventory *(since none was provided)*

**Customer App**
*Onboarding/Auth:* Splash · Welcome · Location/restaurant select · Phone/email signup · OTP · Social login · Guest-checkout entry · Permissions (notifications/location) · Profile setup.
*Discovery/Menu:* Home/discover · Restaurant home · Menu by category · Item detail (modifiers/combos) · Search & filters · Dietary/allergen view · Unavailable-item state.
*Ordering:* Scan table QR · Dine-in session · Pickup select + ready-time quote · Delivery address + zone check · Cart · Modifier sheet · Special instructions · Promo/voucher entry · Tip select.
*Checkout/Pay:* Checkout summary · Payment method select · Card/wallet/transfer · Split bill · Pay-at-counter · Payment processing/success/failed/pending · Receipt.
*Track/Post:* Order status tracker · Delivery live map/ETA · Pickup-ready alert · Rate & review · Report issue/refund · Order history · Reorder.
*Reserve/Loyalty:* Reservation booking · Availability · Confirmation/reminder · Modify/cancel · Waitlist · Rewards dashboard · Points/tiers · Voucher wallet · Referral · Favorites.
*Profile/Settings:* Profile · Addresses · Payment methods · Dietary preferences · Notification settings · Help/support · Terms/privacy · Logout · Delete account.
*Edge states:* No internet · Server error · Payment failed · Item sold out · Zone unavailable · Reservation full · QR invalid · Empty (no orders/favorites) · App update required.

**Admin Console**
Dashboard · Unified order queue · Order detail · Refund/cancel · Menu list/editor · Modifier/combo editor · Availability/86 board · Inventory list · Low-stock alerts · Recipe mapping · Waste log · Floor plan · Table/QR mapping · Reservation calendar · Waitlist · Staff list/roles · Shifts · Promotions · Loyalty config · Campaigns · Payments dashboard · Reconciliation/settlement · Refunds · Payout reports · Tax/VAT · Review inbox · Customer/CRM profiles · Analytics (sales/kitchen/items/cohorts) · Location switcher · Cross-location reports · Settings (hours/channels/zones/fees/printers/KDS/feature flags).

**KDS**
Station ticket grid · All-day/expo view · Ticket detail · Bump/recall · Course fire/hold · 86-from-kitchen · Offline/printer-fallback state.

**Staff/Waiter App**
Floor/tables · Table detail/tab · New order · Modify order · Fire courses · 86 list · Pay-at-table · Split bill · Apply discount/tip · Receipt · Table transfer/merge · Shift handoff.
