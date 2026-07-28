# Paymax Mobility — Claude Code Working Memory

> Multi-modal transportation + logistics marketplace inside the Paymax super app:
> ride-hailing, ride-sharing, scheduled rides, bus booking, parcel delivery, intercity parcel,
> car hire, airport transfer, towing/roadside, mover trucks, business logistics, event transport.
> **Three apps:** customer mobile, driver/partner app, admin/dispatch.
> Positioning: a *fair mobility marketplace* — not an Uber/Bolt clone. "Move people. Move goods. Move trust."
> This file is always in context. Detailed specs live in `/docs` — read on demand (index below).

---

## ⚠️ Integration-First: Reuse, Don't Recreate

This module **drops into the existing Paymax/Spotlight codebase**. It is NOT greenfield. Before writing any code, read `docs/integration.md`. The short version:

- **Read the design system FIRST, every UI task:** `/Users/paymax/Desktop/wordpress/spotlight/new/mobile-app/reactnative/DESIGN-Mobile.md`. Build screens from its tokens, components, and patterns. Do not invent new colors, spacing, typography, or one-off components when the design system already defines them.
- **Use the existing auth system.** Do NOT build login, registration, OTP, session, token refresh, or biometric flows. Consume the app's current auth context/hooks. Mobility onboarding starts from an already-authenticated Paymax user.
- **Reuse existing shared components** (buttons, inputs, sheets, modals, list rows, headers, map views, wallet widgets) before creating anything new. Create a new component only when nothing existing fits, and build it on the design-system primitives.
- **Reuse existing wallet, notifications, and profile** infrastructure — integrate, don't reimplement.
- New mobility code lives in its own module folder (see repo structure) and imports shared infra; it must not fork or duplicate it.

If the design system file or an existing component/hook can't be found at build time, **stop and ask** rather than scaffolding a parallel version.

---

## Stack & Targets

| Layer | Choice |
|---|---|
| Customer + Driver apps | React Native + TypeScript |
| Admin / dispatch / operator portal | TypeScript (existing Paymax admin structure) |
| Backend | Go services, adapter architecture |
| Data | PostgreSQL + MongoDB, Redis, Kafka/NATS |
| Maps | Adapter over HERE / Google / Mapbox / OSM (swappable) |
| Integration | Ships inside existing Paymax app — reuse auth, wallet, notifications, profile, design system, admin |

**Feature-flag axes:** service type · city/zone · user type · compliance readiness. Don't build a ride-hailing clone — build a transport operating system that lights up service-by-service and city-by-city.

---

## The Non-Negotiable Engineering Rules

Apply to **every** change. If a task violates one, stop and flag it.

0a. **Reuse the existing auth system** — never build a parallel login/session/OTP/biometric flow.
0b. **Read `DESIGN-Mobile.md` before any UI** and build only from its tokens + components; reuse existing shared components before creating new ones.
1. Never hard-code pricing, commission, city/service availability, or driver eligibility in the client — all from backend config.
2. All fare and commission rules are **admin-configurable**.
3. Hybrid fare negotiation **never goes below the driver-profitability floor** (see `docs/pricing-commission.md`).
4. All wallet movement uses **double-entry ledger** entries.
5. All trip/job payments use **idempotency keys** + server-side validation.
6. Every trip/job has a **traceable lifecycle** (state machine, timestamps, provider/job reference).
7. Every safety incident **creates a case** (`SafetyIncident`) — never just a log line.
8. Every admin action is **audited**; sensitive ops require role-based permission + (where applicable) maker-checker.
9. Every driver document has **expiry tracking** with alerts.
10. Every delivery supports **proof of delivery**; every bus ticket supports **QR validation**.
11. Every escrow job releases funds **only on proof of completion** (see `docs/architecture.md`).
12. Every provider integration (maps, payment, etc.) goes through an **adapter interface**.
13. No manual wallet balance editing — controlled adjustment + approval only.

---

## Architecture at a Glance

- **Maps adapter** is mandatory — geocode, route, ETA, distance matrix, polyline, geofencing, zone detection — swappable across providers. `docs/architecture.md`.
- **Hybrid fare engine + negotiation service**: instant fare → rider offer → driver counter, all bounded by admin fare floor/ceiling and a driver-profitability floor. This is the product's core differentiator. `docs/pricing-commission.md`.
- **Escrow service** gates payout for parcel, mover, car-hire deposit, towing, business logistics, high-value delivery.
- **Safety service** is first-class: trip PIN, live sharing, trusted contacts, SOS, route-deviation + unexpected-stop detection, offline-trip reporting. `docs/safety.md`.
- **Dispatch service** matches supply↔demand; admin dispatch console can manually assign and watch stuck trips/SOS.
- Trips, deliveries, bus tickets, towing, mover jobs each have their own **state machine**. `docs/data-model.md`.

```
Customer app ─┐                          ┌─ Maps Adapter (HERE/Google/Mapbox/OSM)
              ├─> API (server validation, ┤
Driver app  ──┘    idempotency) ─> Dispatch ─> Pricing+Negotiation ─> Trip/Job state machine
                                      │              │                        │
                                  Safety svc    Commission/Escrow      Wallet Ledger (double-entry)
                                      │              │                        │
                                  Incident      Settlement          Reconciliation + Audit
```

---

## Build Order (do not skip ahead)

0. **Integrate, don't scaffold:** read `DESIGN-Mobile.md`, locate the existing auth context/hooks and shared component library, confirm wallet/notification/profile entry points. (See `docs/integration.md`.)
1. Shared types (TS) + Go structs → `packages/shared-types`
2. Feature flags (service/city/user-type axes)
3. Maps adapter (mock first)
4. Driver onboarding + vehicle verification + admin review
5. Rider onboarding + trust levels
6. Pricing + negotiation (hybrid fare, floors/ceilings)
7. Dispatch + ride-hailing trip state machine
8. Wallet payment integration (ledger, idempotency)
9. Safety stack (PIN, live share, SOS, route-deviation)
10. Ratings + receipts + disputes
11. Admin: pricing → commission → driver/vehicle approval → dispatch console → safety center → reconciliation → audit
12. Parcel delivery (+ escrow, proof of delivery)
13. Bus booking (+ QR, operator portal, settlement)
14. Towing / car hire → movers / business logistics → event transport
15. Real maps/payment adapters after sandbox validation

Mock adapters first. Each service stays feature-flagged off until its city/compliance readiness.

---

## Repo Structure

```
/apps/mobile/src/modules/{mobility,wallet,auth,profile,spotlight}
  mobility/{screens,components,hooks,services,state,types,utils}
/apps/driver/src/modules/{driver-onboarding,driver-home,trips,deliveries,earnings,safety}
/apps/admin/src/modules/{mobility,drivers,vehicles,dispatch,bus,logistics,pricing,safety,reconciliation}
/services/{mobility-profile,driver,vehicle,trip,dispatch,pricing,negotiation,bus,parcel,
           logistics,towing,mover,wallet-payment,escrow,commission,settlement,safety,
           maps-adapter,notification,reconciliation,admin,audit}-service
/packages/{shared-types,api-client,ui,maps,logger,errors,feature-flags}
```

---

## Every Trip/Job Confirmation Must Show
Fare breakdown (transparent fees) · ETA/distance · safety reminder · payment method · and require the relevant verification (trip PIN / pickup PIN / dropoff PIN) at the right step.

## Every Screen Must Handle These States
loading · empty · error · restricted · no-driver-found · service-unavailable-in-city · payment-failed · offline.

---

## Doc Index — read on demand

| File | Read it when… |
|---|---|
| `docs/integration.md` | **Before any UI or auth work** — reuse contract, design-system path, what not to rebuild |
| `docs/product.md` | Scope, competitor strategy, segments, MVP, roadmap, Spotlight |
| `docs/pricing-commission.md` | Anything touching fares, negotiation, surge, commission, driver economics |
| `docs/safety.md` | Trip PIN, SOS, live sharing, incidents, route deviation — any safety surface |
| `docs/architecture.md` | Services, maps/escrow adapters, RBAC, the Claude Code build prompt |
| `docs/data-model.md` | Entities, statuses, trip/job state machines |
| `docs/api.md` | Adding/changing endpoints (customer/driver/admin) |
| `docs/modules.md` | Implementing a service (ride, bus, parcel, car hire, towing, movers, logistics, event) |
| `docs/onboarding.md` | Driver/vehicle onboarding, rider trust levels, vehicle types |
| `docs/screens.md` | Building/locating a customer, driver, or admin screen |
| `docs/acceptance.md` | Writing tests or verifying "done" |

---

## Hard MVP Exclusions (do NOT build)
Autonomous vehicles · helicopter · international/cross-border freight · maritime · air cargo · heavy industrial haulage · customs clearance · dangerous-goods logistics · fuel-tanker logistics · weapon/controlled-item delivery · ambulance replacement · unlicensed public-transport operation · unregulated driver lending · in-app transport credit without lending compliance. Also: no negotiation below driver-profit floor, no unverified cash-only driver network, no manual wallet edits. Full list in `docs/product.md`.
