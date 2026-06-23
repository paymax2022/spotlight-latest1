# Architecture

## Core Services (Go)
auth · user · mobility-profile · driver · vehicle · fleet · trip · dispatch · pricing · negotiation · bus-booking · parcel-delivery · logistics · towing · movers · event-transport · wallet-payment · escrow · commission · settlement · safety · rating · notification · location · maps-adapter · support · promotion · admin · audit · reporting · reconciliation.

---

## Maps Adapter (mandatory, swappable)
Adapter over **HERE / Google / Mapbox / OSM-based** providers. Must support: geocoding · reverse geocoding · route estimate · distance matrix · ETA · traffic-aware routing · route polyline · place search · zone detection · geofencing. Business logic depends on the adapter interface, never a provider SDK. Mock implementation first.

## Escrow Service
Holds funds, releases **only on proof of completion**. Use cases: parcel delivery · mover truck · car-hire deposit · towing · business logistics · high-value delivery.

---

## Repo Structure
```
/apps/mobile/src/modules/{mobility,wallet,auth,profile,spotlight}
/apps/driver/src/modules/{driver-onboarding,driver-home,trips,deliveries,earnings,safety}
/apps/admin/src/modules/{mobility,drivers,vehicles,dispatch,bus,logistics,pricing,safety,reconciliation}
/services/<service>-service   (see Core Services above)
/packages/{shared-types,api-client,ui,maps,logger,errors,feature-flags}
```

---

## Engineering Rules (full)
Never hard-code pricing · commission · city availability · driver eligibility in mobile. All service availability + fare + commission rules come from backend, admin-configurable. All wallet movement uses ledger entries. All trip payments use idempotency keys. Every trip has a traceable lifecycle. Every safety incident creates a case. Every admin action is audited. Every driver document has expiry tracking. Every delivery supports proof of delivery. Every bus ticket supports QR validation. Every sensitive operation is role-permission gated. Every provider integration uses the adapter pattern.

---

## Admin Roles (RBAC)
Super Admin · Mobility Operations Admin · Driver Onboarding Admin · Vehicle Compliance Admin · Bus Operator Admin · Logistics Admin · Pricing Admin · Finance Admin · Safety Admin · Support Admin · Marketing Admin · Fleet Admin · Reconciliation Admin · Audit Admin.

## Admin module map (where features live)
| Area | Modules |
|---|---|
| Executive | total trips, GBV, revenue, driver earnings, completion/cancellation rate, safety incidents, offline-trip attempts, refunds, disputes, active cities/categories |
| Users | search, profile, trust level, trips, deliveries, payments, complaints, refunds, restrictions, safety reports, wallet activity |
| Drivers | list, profile, documents, vehicle assignment, service category, approval status, rating, earnings, trips, complaints, suspensions, training, commission tier |
| Vehicles | list, document review, insurance, roadworthiness, inspection, category, fleet assignment, photos, expiry alerts |
| Bus operators | list, verification, terminals, routes, schedules, buses, seats, drivers, ticket sales, manifest, settlement |
| Logistics partners | couriers, van/truck list, delivery zones, parcel categories, SLA, POD review, insurance, business accounts |
| Pricing / Commission | see `pricing-commission.md` |
| Dispatch console | live map, active requests/trips/deliveries/bus trips, driver+courier availability, manual assignment, stuck-trip + SOS + route-deviation alerts, high-cancellation zones |
| Safety Center | see `safety.md` |
| Dispute Center | fare / cancellation / parcel damage / missing parcel / wrong delivery / driver no-show / rider no-show / bus missed trip; refund approval; evidence review |
| Finance & Settlement | driver/courier/operator/fleet settlement, refunds, chargebacks, wallet recon, cash-collection recon, commission + revenue reports |
| Promotions | promo codes, event ride promo, fan bus promo, driver bonus, referral, first-ride/bus/parcel discounts, sponsored rides |
| Reports | trip, driver, rider, safety, revenue, commission, settlement, cancellation, zone, bus, parcel, towing, mover |

---

## Claude Code Build Prompt (canonical)
Build the Paymax Mobility module inside the existing Paymax super app using the existing design system, authentication, wallet, notification, profile, and admin infrastructure.

**Integration first (do this before anything else):** read the mobile design system at `/Users/paymax/Desktop/wordpress/spotlight/new/mobile-app/reactnative/DESIGN-Mobile.md` and build all UI from its tokens and components. Consume the existing auth system — do not build login/session/OTP/biometric flows; Mobility starts from an already-authenticated user. Reuse existing shared components, wallet, notifications, and profile rather than reimplementing them. See `integration.md`.

Create a modular transportation system covering ride-hailing, ride-sharing, scheduled rides, bus booking, parcel delivery, intercity parcel, car hire, towing, mover trucks, event transport, and business logistics. Implement customer mobile screens, driver/partner app screens, admin dashboard screens, backend services, shared types, API clients, mock data, state management, validation, and all UI states (loading, empty, error, restricted), plus feature flags.

Use a **hybrid fare system** where the backend supports instant fare, rider offer, and driver counteroffer within admin-configured fare floors and ceilings. **Do not allow negotiation below driver-profitability thresholds.**

Integrate Paymax wallet for payments, driver earnings, refunds, escrow, settlements, and promo credits. All financial operations use server-side validation, idempotency keys, ledger entries, and reconciliation queues.

Implement driver onboarding (document upload, vehicle verification, service-category approval, inspection status, training status, admin review) and rider verification + safety trust levels. Implement safety tools: trip PIN, live trip sharing, trusted contacts, SOS, route-deviation detection, unexpected-stop check-in, report unsafe behavior, lost item, offline-trip reporting.

Implement admin controls for users, drivers, vehicles, fleets, bus operators, logistics partners, pricing, commission, zones, dispatch, safety incidents, disputes, refunds, settlements, reconciliation, promotions, notifications, reports, roles, permissions, feature flags, and audit logs.

Prioritize reliability, local Nigerian realities, driver economics, rider safety, transparent pricing, and multi-modal expansion.
