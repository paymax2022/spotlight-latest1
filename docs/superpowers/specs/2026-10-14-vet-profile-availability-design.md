# Vet profile and availability — design

**Date:** 2026-10-14
**Status:** Approved direction; all three open points answered (see below). Slice 1 not started.
**Scope:** slices 1 and 2 of the vet module build-out. Booking (slice 3) and reviews (slice 4) get their own specs.

## Goal

A pet owner can find a vet, open the vet's profile, see real open slots, and know what the visit costs. Today none of that works on staging: discovery returns a shape the app cannot read, and the profile, availability and reviews routes do not exist.

## Verified current state

- `GET /health/vet/vets` returns `{success, vets: [VetResult]}` with provider fields (`provider_id`, `display_name`, `distance_m`). The app reads a bare `Vet[]` with name, credential, rating, fees, types and species, so the find-vet list cannot render live data.
- `GET /vets/:id`, `GET /vets/:id/availability` and `GET /vets/:id/reviews` are not routed. Nor is `GET/PUT /provider/availability`.
- Discovery reads `health_providers` (domain `VET`, provider_type `vet`, status `APPROVED`, `discoverable = true`).
- Profile content lives in `doctor_vet_profiles` (one row per user; `is_published`, `verification`, `profile_draft`, `detail`).
- Fees live in `vet_services` (`visit_type` TELE/HOME/CLINIC, `price_kobo`, `active`). These are the server-priced amounts a booking uses.
- No table stores a vet's working hours. `doctor_availability` holds a *doctor's* hours (per user, `working_days` JSON) and is not used by the vet module.
- Staging has **zero** vet providers (checked read-only, 2026-10-14). Every test of this slice needs fixtures.

## Decisions

**A. Availability source: a vet-owned table (`vet_availability`).** Vets set their hours in the vet app. The vet module does not depend on the doctor module.

**B. Public profile source: `doctor_vet_profiles`, joined to `health_providers` by `owner_user_id = user_id`.** A vet is listed only when discovery passes (approved and discoverable) *and* the profile is published. Discovery's gate is unchanged; the profile supplies the content.

## Data model (additive)

```
vet_availability            one row per provider
  provider_id    uuid PK  -> health_providers(id) ON DELETE CASCADE
  timezone       text     default 'Africa/Lagos'
  slot_minutes   int      default 30, CHECK in (15,20,30,45,60)
  updated_at     timestamptz

vet_weekly_hours            the recurring working pattern
  id             uuid PK
  provider_id    uuid -> health_providers(id) ON DELETE CASCADE
  weekday        smallint CHECK 0..6   (0 = Sunday)
  start_minute   smallint CHECK 0..1439
  end_minute     smallint CHECK 1..1440, CHECK end_minute > start_minute
  UNIQUE-ish: no overlapping windows per (provider_id, weekday) — enforced in the service, documented here

vet_availability_blocks     one-off unavailable time (leave, emergencies)
  id             uuid PK
  provider_id    uuid -> health_providers(id) ON DELETE CASCADE
  starts_at      timestamptz
  ends_at        timestamptz CHECK ends_at > starts_at
  reason         text
```

RLS: enabled, no anon/authenticated policies, access only through the Go pool (the module convention). Migration is additive; the version is chosen at implementation time and re-checked against `main` and the live `schema_migrations` before merge.

## Slot computation (server-side)

- Window: from now (Lagos time) to 14 days ahead. Times are computed in `vet_availability.timezone`, never the device's.
- Candidate slots: each weekly-hours window, cut into `slot_minutes` steps.
- Remove a candidate if it overlaps (a) a block, or (b) a non-cancelled appointment for that provider, using the scheduling engine's overlap rule (`health_appointments`), not a new one.
- Each open slot is returned once per visit type the vet offers (`vet_services` with `active = true`), because the app's slot carries a single `type`.
- Slot `id` is deterministic: `<provider_id>:<start RFC3339>:<visit_type>`. Booking (slice 3) re-checks the id against this same computation, so a slot cannot be booked if it has since been taken.
- Response: `AvailabilityDay[]` exactly as the app's `types.ts` declares it (`date`, `label`, `slots[{id,start,label,type,available}]`). Days with no open slot are omitted.

## Endpoints (owner routes under `/health/vet`)

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/vets` | public (authenticated) | **Fix shape**: return `{success, vets: [Vet]}` where each `Vet` is the mobile shape. Keep `provider_id` as `id`. |
| GET | `/vets/:id` | authenticated | One discoverable, published vet. Anything else is **404** (same answer for "not listed" and "does not exist"). |
| GET | `/vets/:id/availability?days=14` | authenticated | Slot computation above. 404 for an unlisted vet. |
| GET | `/provider/availability` | vet owner | Own hours, slot length, timezone, blocks. |
| PUT | `/provider/availability` | vet owner | Replace hours and blocks, validated (no overlaps, end after start, timezone known, slot length in the allowed set). |

`GET /vets` and `GET /vets/:id` build `Vet` from:

| `Vet` field | Source |
|---|---|
| `id` | `health_providers.id` |
| `name` | `health_providers.display_name` |
| `headline`, `bio`, `clinicName`, `address`, `species`, `specialties` | `doctor_vet_profiles` profile content (see open point 1) |
| `credential` | `doctor_vet_profiles.verification` (public status only, never the licence number) |
| `lat`, `lng`, `distanceLabel` | `health_providers.geo`; distance from the request when given |
| `consultFeeKobo`, `homeVisitFeeKobo`, `types` | active `vet_services` (`TELE` and `HOME` prices; `types` lists the offered visit types) |
| `rating`, `reviewCount` | `0` until slice 4 (explicitly zero, not omitted) |
| `availableNow`, `active` | derived from availability; `active` = listed |

## Privacy and authorization

- Public vet reads expose **only** the fields above. No owner id, no licence number, no phone or email, no document references.
- A vet's hours and blocks are visible only through the availability endpoint, which returns open slots and never the reason for a block.
- Object-level: `GET /vets/:id` and `/availability` answer 404 for unlisted vets, so the endpoints are not an existence oracle.
- Provider writes are scoped to the caller's own `health_providers` row (the same owner check as the pet work).

## Resolved points (answered 2026-10-14)

1. **Profile draft shape — resolved.** The vet draft is `VetProfileDraft` (`mobile-app/reactnative/src/types/doctor.batch1.ts`), saved under `doctor_vet_profiles.profile_draft.draft`. The public profile maps from these keys:

   | Public field | Draft key |
   |---|---|
   | name | `personalInfo.title` + `firstName` + `lastName` |
   | bio | `bio` |
   | address / city / state | `personalInfo.address`, `city`, `state` |
   | clinicName | the `affiliations[]` entry with `isPrimary: true`, `name` |
   | species | `speciesTreated` |
   | specialty | `specialtyId` (an id; the label lookup is part of slice 1) |
   | years of experience | `yearsExperience` |
   | credential status | `doctor_vet_profiles.verification` |
   | published | `doctor_vet_profiles.is_published` |

   `headline` has no draft key. Slice 1 returns it empty rather than inventing one.

   **Known risk, not fixed here:** every save replaces the whole `draft` object, so saving one editor step can erase the others (recorded in `doctor.profile.api.ts`). A vet can publish a partial profile. The fix belongs in the profile write path and is a separate change; slice 1 shows whatever is published and does not hide it.

2. **Fees — resolved: `vet_services` only.** The editor's `pricing` fields are ignored by the vet module. Booking and every fee shown to an owner come from active `vet_services` rows.

3. **Staging fixtures — approved.** Approval covers seeding a small set of clearly labelled test vets on staging (approved, discoverable, published, with services and hours). Names will carry a `TEST` marker. Seeding happens after slice 1 merges, so it can be checked live.

## Testing

- Go unit tests: slot generation (weekly windows, slot length, timezone edge at Lagos midnight, DST-free), blocks and existing appointments removing slots, deterministic slot ids, validation of `PUT /provider/availability`.
- Handler guards with a nil service (the pattern used for pets): bad ids → 400, unlisted vet → 404, owner-only writes.
- Live-DB tests (gated on `TEST_DATABASE_URL`): listing rules (approved + discoverable + published only), profile fields (no private fields leak), availability excludes blocked and booked time, owner scoping on `PUT`.
- Mobile: the discovery response mapper and the availability mapper under `node:test`, plus the existing `test:vet-pet` suite.
- `check:confirm`, whole-app type-check and the contract check in CI.

## Contract

Owner-side vet routes are not in any `contracts/*.yaml` today. This slice adds them to `contracts/transport.openapi.yaml` (or a new `contracts/vet.openapi.yaml`, to be chosen in slice 1) before the handler code, per the repo's spec-first rule.

## Rollout

Routes are mounted with the existing vet registration. Slice 1 is read-only, so it can ship before any vet is listed. Availability writes only take effect for vets who set hours. No money moves in slices 1 or 2.
