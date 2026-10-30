# ADR-PR915: Exclusive provider portal driven by an ownership-derived capabilities endpoint


Status: proposed (flag-off: `FEATURE_PROVIDER_PORTAL_ENABLED`)

## Context
Merchants and service providers (doctor, vet, pharmacist, lab, restaurant, rider, driver,
marketplace seller, event organiser, estate manager, property manager, association creator,
crowdfunding creator, bus operator) must each have a portal to run their own business that no
one else can use. Before this change provider screens were scattered (`app/(doctor)`,
`health/vet/provider`, `health/pharmacy/provider`, `health/lab/provider`, `(merchant)`,
`food/restaurant`, `food/rider`, `mobility/driver`, `mobility/bus/provider`,
`marketplace/sell`, `events/organiser`, `estate-admin`, `association/admin`,
`crowdfunding/creator`), each with its own entry point, and none checked that the signed-in
user is that kind of provider: any signed-in user could open another provider area by URL.
The backend still enforces ownership on the data, so this was an exposure of empty or error
screens and of the app's structure, not of other providers' data. The existing
`/modules/access` is admin-granted module visibility, not "what kind of provider am I".

## Decision
1. One read-only endpoint, `GET /health/provider-portal/me`, returns the provider capabilities
   the caller **owns**, derived from existing rows. No new table, no new role store, no
   client-supplied identity. One entry per owned record, except the aggregate types noted:
   - doctor — `doctor_profiles`; vet / pharmacy / lab — `health_providers` OWNER rows
   - restaurant — `restaurants.owner_id` (KYB state when a `restaurant_kyb` row exists)
   - driver **and** rider — the same `drivers` row. The mobility driver API and food
     dispatch both read that table; one row is one driver identity that can run either
     console, so it yields two entries sharing `provider_id` and approval. `drivers` is
     the only driver identity the mobile flows write (`transport_drivers` belongs to the
     unmounted `transport/hail` API and is not a user-facing business).
   - estate manager — `estates.admin_id`; property manager — `property_role_profiles`
     (role `estate_manager`, active + verified)
   - association creator — `assoc_organisations.created_by`
   - crowdfunding creator — `campaigns.creator_id`
   - bus owner — `bus_providers.owner_user_id` (verified only)
   - aggregate, `provider_id` is the caller's own user id: marketplace seller (has an
     `mkt_listings` row), event organiser (has an `events` row).
2. The mobile app has one portal area (`/provider-portal`), linked from the merchant hub. A
   `ProviderRouteGuard` wraps every provider area and admits a user only when they hold an
   `approved` capability of the matching type. Anyone else sees a status or "apply as a
   provider" screen. Rules carry an optional `exact` flag so a console root that shares a path
   segment with a customer screen (`/food/restaurant` owner console vs
   `/food/restaurant/<id>` customer outlet page) is gated without catching customers.
   Every application path stays reachable without a capability (health onboarding,
   driver onboarding, restaurant KYB, bus register, event/association/campaign create).
   Marketplace is deliberately **not** gated: a seller exists only after their first
   listing, and `/marketplace/sell` — the Sell tab — is that funnel. Guarding it would lock
   first-time sellers out of becoming providers; the console still lists only the caller's
   own listings because the API scopes them. Estate management has no self-serve mobile
   application, so its portal entry appears only for existing estate admins.
3. The gate is a UX control only. Provider-side API routes enforce ownership server-side;
   hiding a screen never grants or removes access. Where a module already enforces approval
   (health, rider dispatch, bus verification, property roles) the capability mirrors it.
4. A caller with no provider records receives `200` with `capabilities: []`, never 404, so a
   non-provider cannot be told apart from a provider of another type by probing.
5. Further business types are added by extending the `type` enum and the endpoint's source
   query, and one row in the portal's table; the shell does not change. Tables that have not
   been migrated in an environment are skipped (probed with `to_regclass`) rather than
   failing the endpoint.

## Consequences
- Exclusivity is enforced where it was missing (the client) without a second source of truth for
  roles. Approval changes (suspension) take effect on the next capabilities fetch.
- A stale client can still render a screen briefly after suspension; the API calls behind it
  fail closed.
- The endpoint is auth/PII-adjacent (it reveals that a user is a provider, to that user only),
  so it needs `security-reviewer` before merge.

## Follow-ups (found by security review, out of scope here)
- Doctor routes: add a shared approved-doctor check (prescription issue, consult start/end, payout first).
- Vet `GET/PUT /provider/availability`: require `status='APPROVED'`.
- Pharmacy / lab owner earnings and product/order reads: decide whether a suspended provider keeps read access.
- Doctor `rejected` and unsubmitted both surface as PENDING in the portal; distinguish them.
- Roll the backend flag out before the app build ships: with the flag off the endpoint answers 503
  and the guard shows its error screen to real providers.
- Estate manager covers `estates.admin_id` only; delegated staff (`estate_staff_grants`) use their
  operational screens and are not shown as owning the estate.

## Open questions
- Should a single user holding several provider types see a type switcher (planned) or be
  asked to choose at sign-in?
- Property manager tools are the role-profile screens today; a dedicated console may follow.
- Association creator is ownership-of-record; officer roles granted later are not reflected.
