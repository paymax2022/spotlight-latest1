# ADR-PR769: User 360 profile, PR C - referral code and activity

Status: accepted · Follows ADR-PR754 and ADR-PR759. Spec and plan: `docs/superpowers/` (branch `docs/admin-user-360-spec`).

## Context
The profile showed who referred a user (#763) and their reward tier (#753), but not the user's own
referral code, their referral summary, or their referral ledger. The code is the only one of these
with no admin read: `GetOrCreateCode` is the only function that returns it, and it also mints.

## Decisions
1. **`LookupCode` is a pure read; `GetOrCreateCode` is never called from an admin read.** It applies
   the same first-minted-wins rule without writing: `finance_referral_codes`, then `referral_links`
   (the link wins only when its code differs and its row is older), then `platform_users.referral_code`;
   otherwise `ErrNoCode`. A small unexported `QueryRow` seam lets the tests record every statement and
   assert each one is a SELECT. One known divergence: when `GetOrCreateCode`'s converging UPDATE hits a
   unique violation it keeps the finance code, while `LookupCode` would report the older link code.
2. **The `platform_users.referral_code` fallback is unverified.** The column exists, but no writer
   exists anywhere in the repo and its meaning is undocumented (it sits beside `referred_by`, so it could
   mean "code used at signup"). The fallback is effectively dead code today. If a writer is ever added
   that stores the code the user *entered*, the panel would show someone else's code as the user's own
   with `source: platform_users`. Kept because the spec asked for it; revisit or drop.
3. **Permission `referral.admin.case`, no per-user scope check.** This follows the sibling aliases
   (`/referrals/:user_id`, `/referred-by`, tiers), which are global. The UI is scope-safe because the page
   mounts panels only after the scoped `GET /api/admin/users/:id` succeeds; a scoped admin calling the
   endpoint directly could read any user's code (low sensitivity, same exposure class as the siblings).
   A per-user check on all of these routes is one follow-up change.
4. **No new feature flag.** The code lookup is a read over existing data, like its siblings. The summary
   and ledger sections call endpoints that exist only when `FEATURE_REFERRALS_ENABLED` is on and a pool
   is available; when off they answer a bare 404, which the panel renders as "Referral engine is not
   enabled in this environment." The code section's own 404 means "no referral code yet".
5. **Two referral engines appear on one page.** `ReferralTierPanel` and `ReferredByPanel` read the
   rewards engine (`referral_rewards`, `/api/finance/admin/referrals/...`); this panel's summary and
   ledger read the section-7A engine (`referral_reward_ledger`, `referral_attributions`). "Total
   earned" here and the rewards in the tier panel can legitimately disagree.
6. **Two reductions against the plan.** (a) "Referred by" was dropped: #763 shipped `ReferredByPanel`.
   (b) The `getReferralUser360` path fix was reverted: the console page `/admin/referral/users/[id]` calls
   `/users/:id`, which 404s, while the backend serves `/users/:id/referral-360` returning
   `{user:{...}}`. A path-only change would crash the page (it reads `referrals[]`), and an adapter I
   first built invented values (status "active", risk 0/100). Honest handling needs a type and page
   rework, left as a follow-up.
7. **The contract documents the real path** (`/api/finance/admin/referrals/{user_id}/code`). The
   sibling `referred-by` is documented under `/api/v1/...` with a note; this PR does not change that.

## Consequences
- The ledger shows no date column because `ledger.Entry` carries no `created_at`; "most recent 200"
  is stated in the heading.
- Absent numbers default to 0 in the service; the backend's 360 fields never omit them, so this is
  not reachable today.

## Not covered
The `/admin/referral/users/[id]` rework, a per-user scope check on the finance referral aliases,
`created_at` on ledger entries, and the meaning (or removal) of `platform_users.referral_code`.
