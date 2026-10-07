# ADR-PR553 — Connect: one profile record per member, rendered as Date/Network views

**Date:** 2026-10-08
**Status:** Accepted
**Scope:** `backend/internal/connect/profile/{service.go,me.go}`, `backend/internal/connect/onboarding/service.go`,
`supabase/migrations/20271012000000_connect_profile_details.sql`, `contracts/connect-phase1.openapi.yaml`,
`mobile-app/reactnative/src/features/connect/profile/*`, `app/connect/(tabs)/me.tsx`.

## Context

A member who completed Connect onboarding could not see what they had entered. The wizard collected gender,
headline and preferences but `connect_profiles` had no columns for them; the age gate validated a DOB and then
discarded it; photos stayed as local `file://` URIs; and the profile screens only worked against mock data whose shape
(`dateProfile` / `networkProfile`, each with its own photos and bio) the backend never produced. The backend model is
one `connect_profiles` row per member plus `connect_profile_modes` rows that carry only visibility, intent tags and
privacy.

## Decision

1. **Keep the single-record backend model.** Bio, headline, interests, gender, city and photos live on the one
   profile; each mode keeps its own visibility wall and intent. The app's Date and Network views are built from that
   record (`GET /connect/profile/me`). Per-mode bios/photos would need a new storage model and moderation story and
   are explicitly out of scope; if the product needs separate romantic and professional personas, that is a separate
   ADR and migration.
2. **Persist the DOB at the age gate, first value wins.** The gate already owns DOB; keeping it lets the profile show
   an age. Only the derived age is serialised (the field stays unexported). `COALESCE` keeps the first accepted value so
   a later call cannot move it.
3. **Photos are R2 object keys, signed on read.** The server mints the key under `connect/profile/<user>/` and a
   registered key must start with the caller's own prefix, so one member can never attach another's upload. The bucket
   is not public, so keys are turned into short-lived signed GET URLs when the owner reads their profile. Uploads
   reuse the R2 presigner and its write probe (ADR-PR549) and fail closed with 503 when storage is unconfigured.
4. **Ordering and limits are server-side.** `sort_order` defines the primary photo; reorder must name exactly the
   caller's photo set (no partial/duplicate/foreign lists); a profile holds at most 9 photos.
5. **Onboarding never uploads twice.** Completion uploads each picked photo, counts failures and keeps only failed
   ones in the draft, so re-running the step cannot duplicate a photo and the UI can say how many did not upload.

## Consequences

- Date and Network views currently share bio, headline, interests and photos.
- New photos are `pending` moderation; the owner sees them (tagged "In review"), other members only see approved.
- Rollout order: apply the migration, deploy the backend, then ship an APK.
