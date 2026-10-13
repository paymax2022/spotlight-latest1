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

## Review follow-ups (no blockers)
- **Money fields need the money permission everywhere.** `wallet_balance_kobo` (list and detail) and the lifetime gift totals are
  null unless the caller also holds `connect.gifting.view`, exactly like the dashboard tiles; a missing checker or a permission error
  withholds them. A moderator (who holds `connect.users.view`) can still see who a user is, never what they hold or spent.
- **Status filter in SQL.** The derived status is computed in SQL (a `CASE` that mirrors `userStatus`), so the filter and `has_more`
  are exact over the whole directory instead of over a 1000-row window; a live test pins SQL and Go together.
- **One verification row per user:** the join takes the latest row, because the reconcile migration may leave duplicates.
- **Balance is the NGN wallet** (`currency = 'NGN'`). Today the schema allows one `user_wallet` per user, so a mixed-currency sum
  cannot occur; the filter is defensive and untested for that reason.
- Known and deferred: `ILIKE '%x%'` on display name is unindexed (term capped at 64 chars; admin-only); no cursor for `has_more`.

## Consequences
- DAU/MAU are login-based because Connect keeps no activity log; revisit when one exists.
- `last_active_at` falls back to `created_at` when a user has never logged in; that reads as "joined" rather than "active".
- Reads of user detail are not audited yet; add an access-audit event with the first admin write action.
