# Product — Strategy, Scope, MVP, Roadmap

## What it is
A full transportation + logistics module inside the Paymax super app combining ride-hailing, ride-sharing, scheduled rides, bus booking, parcel delivery, intercity parcel, car hire/chauffeur, airport transfer, towing/roadside, mover trucks, business logistics, and event transport. Built for African (Nigerian-first) market realities: cash, fuel costs, road conditions, terminals/parks, operators.

**Promise:** *Move people. Move goods. Move trust.* (alts: *One Paymax. Every movement.* / *From doorstep to destination.*)
**Don't say** "cheaper than Uber." **Do say** "fairer, safer, broader, and built for how Nigerians actually move."

---

## Competitor strategy (why a clone loses)
Uber/Bolt/inDrive each leave gaps: opaque/unpredictable pricing, commission pressure that drives **offline-trip leakage**, persistent safety concerns, and almost no integration with **bus, parcel, towing, mover** realities or with wallet/events/groups. Paymax wins by being a **fair mobility marketplace** with five levers:
1. **Hybrid fare** — instant fare + rider offer + driver counter, bounded by fare floors and a driver-profit floor (anti-exploitation, anti-surge-abuse). See `pricing-commission.md`.
2. **Driver welfare engine** — lower-commission tiers, subscription plan, loyalty score, fuel/maintenance/insurance partners, instant wallet payout, savings, fair deactivation appeal.
3. **Safety trust stack** — verified rider+driver, vehicle inspection, trip PIN, live sharing, trusted contacts, SOS, route-deviation/stop detection, night mode, phone masking. See `safety.md`.
4. **Multi-modal super-app** — one app for rides through business logistics.
5. **Spotlight demand engine** + **Paymax wallet/escrow/loyalty** advantage.

---

## Target users
Paymax customers · Spotlight fans/event attendees · commuters · intercity travelers · students · SMEs/merchants · bus operators · drivers · logistics partners · fleet owners · movers · towing operators.

---

## In Scope
**Customer app:** ride-hailing, ride-sharing, scheduled rides, bus (inter/intra-state), parcel + same-day + intercity, car hire/chauffeur, airport transfer, towing/roadside, mover trucks, business logistics, event shuttle · wallet/cash/split payment · fare negotiation · live tracking · safety tools · disputes · ratings · refunds · loyalty.
**Driver/partner app:** onboarding, vehicle onboarding, document upload, background verification, job acceptance, fare negotiation, navigation, earnings wallet, payout, safety tools, inspection, service-category selection, parcel POD, bus manifest, towing/mover workflows.
**Admin:** user/driver/fleet/bus-operator/logistics-partner management, pricing, commission, negotiation settings, zones, dispatch + trip + parcel + bus + car-hire + towing + mover monitoring, wallet reconciliation, disputes, refunds, safety incidents, compliance docs, promotions, reports, audit logs.
**Backend services:** see `architecture.md`.

## Out of Scope for MVP
Autonomous vehicles · helicopter · international freight · maritime · air cargo · heavy industrial haulage · cross-border customs · dangerous-goods logistics · fuel-tanker logistics · weapon/controlled-item delivery · ambulance replacement · unlicensed public-transport operation · unregulated driver lending · in-app transport credit without lending compliance.

---

## MVP Definition

**Must-have:** mobility home · ride-hailing · hybrid fare (instant + rider offer + driver counter) · driver onboarding · vehicle onboarding · wallet payment · cash toggle by city · trip PIN · live trip sharing · SOS · driver/rider rating · parcel delivery · basic bus booking · admin dashboard · pricing control · commission control · driver management · trip monitoring · dispute management · wallet reconciliation · notifications.

**Should-have:** ride sharing · scheduled ride · intercity parcel · towing · car hire · event transport · driver subscription commission model · driver fuel wallet · proof of delivery · bus QR boarding · safety incident center.

**Could-have:** movers · business logistics · corporate transport · AI dispatch optimization · driver financing · insurance marketplace · Spotlight fan bus · group ride split payment.

**Must-NOT-have:** dangerous-goods delivery · ambulance replacement · cross-border freight · unverified cash-only driver network · negotiation below driver-profit floor · manual wallet balance editing · unlicensed public-transport operation.

---

## Release Roadmap

| Phase | Ships |
|---|---|
| 0 — Foundation | Legal/regulatory review, city launch strategy, driver-onboarding policy, vehicle inspection process, insurance framework, maps provider, wallet integration, pricing rules, admin foundation |
| 1 — Ride-Hailing MVP | Ride request, driver app, hybrid pricing, wallet/cash, trip PIN, live tracking, safety tools, ratings, admin dispatch |
| 2 — Parcel Delivery | Same-city parcel, courier onboarding, proof of delivery, tracking, escrow for high-value, business delivery accounts |
| 3 — Bus Booking | Operators, routes, schedules, seat maps, QR ticketing, terminal boarding, operator settlement |
| 4 — Towing + Car Hire | Towing operators, roadside assistance, car hire, airport transfer, chauffeur |
| 5 — Movers + Business Logistics | Truck providers, quote marketplace, escrow, inventory checklist, business dashboard, bulk delivery |
| 6 — Spotlight Mobility Engine | Event shuttle, fan buses, artist logistics, ticket+ride bundles, sponsored rides, open-mic venue transport |

---

## Spotlight integration
Events become automatic transport demand. Features: event-page transport button, group ride, fan bus, venue shuttle, artist/crew logistics, equipment van, ticket+ride / ticket+bus bundle, venue geofencing, post-event surge control, sponsor rides, promo codes, youth-driver recruitment, driver trust stories. Flow: buy ticket → app suggests ride/bus/shuttle → book → transport linked to ticket → reminder → QR/ride-PIN → post-event pickup zone → rate.

---

## Final standard
Compete on fairness to drivers, rider safety, family trust, business reliability, operator digitization, parcel tracking, mover escrow, towing emergency value, wallet convenience, Spotlight demand — not on cheaper rides. The win: *"I don't need five different apps to move people, goods, buses, cars, and business deliveries. Paymax handles it."*
