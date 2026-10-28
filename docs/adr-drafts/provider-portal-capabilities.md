# ADR-PR<pr-number>: Exclusive provider portal driven by an ownership-derived capabilities endpoint

> DRAFT. Move to `docs/adr/ADR-PR<real PR number>-provider-portal-capabilities.md` once the PR
> exists, and replace every `<pr-number>` below with it. Never pick a number by hand
> (`adr-guard.yml`). Do not create the file with the literal placeholder in its name: it cannot be
> checked out on Windows.

Status: proposed (flag-off: `FEATURE_PROVIDER_PORTAL_ENABLED`)

## Context
Merchants and service providers (doctor, vet, pharmacist, lab, then restaurant, rider, driver,
marketplace seller, event organiser, estate manager, property owner) must each have a portal to
run their own business that no one else can use. Today provider screens are scattered
(`app/(doctor)`, `health/vet/provider`, `health/pharmacy/provider`, `health/lab/provider`,
`(merchant)`), each with its own entry point, and none checks that the signed-in user is that
kind of provider: any signed-in user can open `/health/vet/provider/earnings` by URL. The
backend still enforces ownership on the data, so this is an exposure of empty or error screens
and of the app's structure, not of other providers' data. The existing `/modules/access` is
admin-granted module visibility, not "what kind of provider am I".

## Decision
1. One read-only endpoint, `GET /health/provider-portal/me`, returns the provider capabilities
   the caller **owns**, derived from existing rows (`doctor_profiles`, `health_providers`). No
   new table, no new role store, no client-supplied identity.
2. The mobile app has one portal area. A `ProviderGate` wraps every provider-side screen and
   admits a user only when they hold an `approved` capability of the matching type. Anyone else
   is redirected to a status or "apply as a provider" screen.
3. The gate is a UX control only. Provider-side API routes enforce ownership server-side;
   hiding a screen never grants or removes access. Approval enforcement is NOT uniform today:
   vet, pharmacy and lab owner write routes check approval, but the doctor routes
   (`/api/v1/doctor`) check ownership only, and a few vet/pharmacy/lab owner-scoped reads
   (availability, earnings) do not check approval. Those are follow-ups, listed below; until
   they land the client guard is the only approval check on those paths.
4. A caller with no provider records receives `200` with `capabilities: []`, never 404, so a
   non-provider cannot be told apart from a provider of another type by probing.
5. Further business types are added by extending the `type` enum and the endpoint's source
   query; the portal shell does not change.

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

## Open questions
- Should a single user holding several provider types see a type switcher (planned) or be
  asked to choose at sign-in?
- Restaurant, rider, driver, marketplace, events, estate and property sources live in other
  modules; each needs its own ownership query when its slice lands.
