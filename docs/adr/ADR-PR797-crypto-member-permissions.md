# ADR-PR797: Crypto member permissions

- Status: accepted
- Date: 2026-10-16

## Context
`crypto.view`, `crypto.trade` and `crypto.admin` were seeded (20260815001600_crypto.sql) and
attached only to `super-admin` and `system-admin`. All crypto member routes are guarded by
`RequirePermission(crypto.view | crypto.trade)`, so no ordinary member could reach any of them
(HTTP 403 `forbidden`), regardless of feature flags. A local end-to-end of the swap pipeline
found it: the request died at the permission gate before any quote, PIN, tier or ledger code ran.

## Decision
Grant `crypto.view` and `crypto.trade` to the default member roles `registered-user` and
`verified-user` (migration 20271042000000), following 20260903000000_connect_discovery_boosts.sql.
`crypto.admin` stays admin-only.

## Why grant to members at all, and why both roles
The permission is only the doorway; the real controls are elsewhere and unchanged:
feature flags (routes unmounted when off), KYC tier gate (minimum Tier 1 for swaps), the
transaction PIN as a second factor, per-user rate limits, and the ledger's own checks.
Withholding the permission instead would make those controls unreachable and leave a feature
nobody can use. `registered-user` is the default role of every account; `verified-user` is the
verified variant. Granting both avoids a lockout when a user moves between them.

## Consequences
- Production is unaffected until `FEATURE_CRYPTO_ENABLED` is turned on, which stays blocked on the
  compliance sign-off (PR #703).
- On staging the legacy crypto routes are already mounted, so members there gain access (tier-gated).
- To withdraw access later, delete the two `role_permissions` rows; no code change is needed.
- A live-DB test pins the grant and the absence of `crypto.admin` on member roles.
