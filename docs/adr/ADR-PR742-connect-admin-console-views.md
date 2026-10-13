# ADR-PR742: Connect admin users, dashboard and finance are read-only projections; undefined figures are null

Status: accepted

## Context
Four console routes (`/users`, `/users/:id`, `/dashboard`, `/finance`) did not exist, so those pages 404'd. Their expected shapes
include figures the data model does not hold (devices, tier history, take rate, float, ledger totals, liveness) and some that
span permissions (gift volume is money; the dashboard is an operations view).

## Decision
- **Projection, not new storage.** No migration. Each view reads existing tables (profiles, platform users, KYC tier, verification,
  restrictions, gifts, payouts, votes, cases, alerts, wallet balance).
- **Null over fiction.** Figures with no source or no agreed definition (take rate, float, ledger debit/credit totals) are `null`;
  devices and tier history are `[]`. The console renders a dash / "Not available yet" for null; it never shows a false zero or a false
  "balanced". `ai_confidence`-style invention is rejected throughout.
- **Money needs money permissions.** `/finance` requires both `connect.gifting.view` and `connect.payouts.view`. The dashboard's route
  permission is `connect.cases.view` (operations), and its two gift-volume tiles are null unless the caller also holds
  `connect.gifting.view`; a missing checker or a permission error means "withheld" (fail closed).
- **Masked personal data.** User detail returns a masked email (first character, domain kept) and phone (last three digits); lists carry
  only handle, region and derived state. Activity labels contain codes and types, never names, ids or content.
- **Derived status with an explicit precedence:** banned > suspended > login-locked (restricted) > pending > active; expired restrictions
  are ignored. Deleted accounts are excluded.
- **Safe inputs.** Search terms are capped and their LIKE wildcards escaped; `status` is an allowlist; ids must be UUIDs (404 otherwise);
  `limit` defaults to 100, max 200, with `has_more`.

## Consequences
- DAU/MAU are login-based because Connect keeps no activity log; revisit when one exists.
- Status filtering is applied after the status is derived, over a bounded window (1000 rows) when a non-`all` status is requested, so
  it is exact within that window; a very large directory may need a status column or a SQL-side derivation.
- `last_active_at` falls back to `created_at` when a user has never logged in; that reads as "joined" rather than "active".
- Reads of user detail are not audited yet; add an access-audit event with the first admin write action.
