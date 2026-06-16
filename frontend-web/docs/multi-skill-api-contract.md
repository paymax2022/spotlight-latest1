 deb# Multi-Skill Competition API Contract (v1)

## Goal
Define stable API contracts for extending Spotlight from a single music flow into a reusable multi-skill competition engine.

## Conventions
- Base path: `/api`
- Response envelope (success): `{ success: true, ... }`
- Response envelope (error): `{ success: false, error: string, code?: string }`
- Auth: Supabase session (cookies/JWT)
- Pagination query params: `page`, `limit`
- Rate limiting on all public write routes

## Public Endpoints

### `GET /api/categories`
Returns active skill categories and lightweight rule metadata.

### `GET /api/competitions`
Query:
- `category` (slug)
- `location` (state/country)
- `age`
- `prize_min`
- `deadline_before`
- `featured`
- `page`, `limit`

### `GET /api/competitions/[slug]`
Returns competition details, windows, category mappings, voting settings, and sponsor placements.

### `GET /api/competitions/[id]/gallery`
Returns published entries for gallery listing.

### `GET /api/competitions/[id]/leaderboard`
Returns ranked entries with weighted score snapshots.

### `GET /api/contestants/[slug]`
Returns public contestant profile, entry media, and vote CTA metadata.

## Authenticated User Endpoints

### `GET /api/skill-profiles`
List current user skill profiles.

### `POST /api/skill-profiles`
Create skill profile.

### `PATCH /api/skill-profiles/[id]`
Update skill profile.

### `DELETE /api/skill-profiles/[id]`
Archive/delete skill profile.

### `POST /api/competitions/[id]/enroll`
Enroll user into a competition category/profile.

Body:
- `skill_profile_id`
- `entry_type` (`solo|team`)
- `team_members[]` (optional)
- `terms_accepted`
- `consent_accepted`
- `eligibility_confirmed`
- `payment_reference` (for paid entry)

### `POST /api/entries`
Create draft entry.

### `PATCH /api/entries/[id]`
Update draft entry and dynamic submission fields.

### `POST /api/entries/[id]/submit`
Finalize entry and lock draft edits based on competition window.

### `GET /api/user/competition-dashboard`
Returns enrollments, entries, vote counts, payment history, and recommendation blocks.

## Moderation + Judging Endpoints

### `GET /api/moderation/entries`
Filters:
- `competition_id`
- `category_id`
- `status`
- `q`
- `page`, `limit`

### `POST /api/moderation/entries/[id]/action`
Actions:
- `approve`
- `reject`
- `request_correction`
- `shortlist`
- `disqualify`
- `mark_live`

### `GET /api/judging/competitions/[id]/entries`
Returns entries assigned to judge.

### `POST /api/judging/entries/[id]/score`
Body:
- `criteria_scores[]`
- `public_note`
- `private_note`
- `finalize`

## Voting + Payments Endpoints

### `POST /api/vote/free`
Validates free caps and anti-fraud checks.

### `POST /api/vote/paid`
Verifies payment and applies paid votes idempotently.

### `GET /api/vote/packs`
Returns vote bundles.

### `GET /api/vote/history`
Authenticated vote transaction history.

## Admin Endpoints

### Categories
- `GET /api/admin/categories`
- `POST /api/admin/categories`
- `PATCH /api/admin/categories/[id]`

### Competitions
- `GET /api/admin/competitions`
- `POST /api/admin/competitions`
- `PATCH /api/admin/competitions/[id]`
- `POST /api/admin/competitions/[id]/duplicate`
- `GET /api/admin/competitions/[id]/categories`
- `PATCH /api/admin/competitions/[id]/categories`

### Winners
- `GET /api/admin/competitions/[id]/winners`
- `POST /api/admin/competitions/[id]/winners/publish`

### Sponsors
- `GET /api/admin/competitions/[id]/sponsors`
- `POST /api/admin/competitions/[id]/sponsors`
- `PATCH /api/admin/competitions/[id]/sponsors/[sponsorId]`

### Pipeline
- `GET /api/admin/pipeline`
- `POST /api/admin/pipeline`
- `PATCH /api/admin/pipeline/[id]`

### Reports
- `GET /api/admin/competitions/[id]/reports`
- `GET /api/admin/competitions/[id]/reports/votes-csv`

## Security + Validation Requirements
- Input validation on all routes.
- RBAC checks for admin/moderator/judge routes.
- Strong upload validation for mime/size/duration.
- Abuse controls: rate limits, velocity checks, duplicate detection.
- Audit logs for moderation, judging, winner publication, vote invalidation.
