# Platform lane — shared-layer findings (UAT Oct 2026)

Worktree `/tmp/uat-platform`, branch `uat/platform`, off main @ `f0816a2c4`.
All findings verified against a live local stack (see BASELINE.md): Go backend
:8090, Supabase :54321/:54322, Redis :6380, Mailpit+fake-Brevo for OTP email.

## 1. Auth & identity — STRONG

Registration, OTP, login/lockout, password reset, suspension all verified live.

- **OTP service** (`internal/otp/`): purpose allowlist, email HMAC'd into the
  storage key (no enumeration oracle in DB), atomic single-use `Consume`,
  attempt ceiling via atomic increment, TTL enforced on read, per-address AND
  per-IP Postgres limiters (fail-closed), pepper required at construction,
  constant-time digest compare. Test-mode deterministic OTP (`test_mode.go`,
  merged earlier) is properly gated: flag + `MocksAllowed()` + reserved
  `+234999*` prefix; Verify path untouched.
- **Live flows proved end-to-end**: register → verify_email OTP → login →
  MFA step-up (login OTP) → session; request-password-reset → OTP →
  resetToken ticket → reset (ticket single-use, old password rejected,
  new accepted); wrong code → `invalid code` (same vocabulary as
  unknown-address — anti-enumeration).
- **Lockout**: 5 wrong passwords → `status=locked`, `failed_login_attempts=5`,
  `locked_until=now+30min`; correct password refused during lock. GoTrue
  outages classified `ErrAuthUnavailable` — no false strikes.
- **Suspension**: `platform_users.status=suspended` → still-valid JWT gets
  403 `account restricted` on the next request; admin
  `PATCH /api/admin/users/:id/{suspend,unsuspend}` works live.
- **Gap (flag-gated)**: `FEATURE_SESSION_HARDENING_ENABLED` defaults off →
  tracked-session revocation enforcement inactive; `/api/auth/sessions*`
  answers `feature_disabled`. GoTrue-side logout IS wired (`/auth/v1/logout`).
- **Gap**: no self-serve account-deletion endpoint found; `deleted_at` is
  enforced at login/status gate (admin-side deletion only).

## 2. Customer→merchant upgrade — WORKS, one real defect FIXED

Live end-to-end: draft create → duplicate refused → submit w/o Idempotency-Key
→ 400 → requires_business CAC gate blocks → seeded verified business → schema
validation (per-field errors) → submit → same-key replay converges → admin
approve → `marketplace_seller` role granted → `/me/capabilities` ACTIVE.

- CAC `requires_business` gate enforced at BOTH Submit and Approve
  (defense-in-depth, applicant-side identity).
- Cross-tenant: user B GET+PATCH of A's application → 403.
- Review/self-approve surfaces gated on `ReviewPermission` — customer → 403.
- **PLT-D001 (S2, FIXED)**: `grantRole`'s `ON CONFLICT (user_id, role_id,
  scope_type, scope_id)` could never fire — `scope_id` is NULL for global
  grants and Postgres unique indexes treat NULLs as distinct. Every approve
  replay inserted a duplicate ACTIVE `user_roles` row (proved: 2 identical
  rows 82ms apart). Fixed with a NULL-scope-aware upsert CTE
  (`internal/onboarding/repository.go`), regression assertion added to
  `TestLiveDB_ApprovalIsIdempotent` (verified pass with and without index),
  and a pending migration (`migrations-platform/user_roles_nulls_not_
  distinct.pending.sql`) that adds a `NULLS NOT DISTINCT` unique index —
  verified live: refuses while dupes exist, makes `ON CONFLICT` work after
  pruning. Revocation (`RemoveRoleFromUser` deletes by user+role) already
  removes duplicates, so no privilege persistence.
- **PLT-D003 (recorded)**: `internal/restaurant/service.go:2067` repeats the
  same broken `ON CONFLICT` pattern (domain-owned; pending index also covers).

## 3. RBAC / tenant isolation — STRONG

- `RequireAuthContext`: Bearer required; GoTrue transport error → 503 (not
  401); status lookup error → 503 fail-closed; suspended/locked/deleted →
  403; roles/permissions resolved PER REQUEST from DB — role/status changes
  take effect immediately, JWT role claims are never trusted.
- `RequirePermission`: local check on request-resolved perms, RPC fallback
  `CheckPermission` on miss; RPC error → 403 fail-closed.
- `RequireAdmin` (API key): fails closed with 503 outside development when
  unconfigured; constant-time compare.
- Live: forged JWT → 401; missing Bearer → 401; customer on admin surfaces
  (ledger, transfers, onboarding review, suspend) → 403 across the board.
- Prior-art `user_profiles` RLS PII leak (USING(true)) — verified FIXED:
  `20270205010000` is live; user B reads only own row via PostgREST.
- AUTH-008 (`service_role` no GRANT on `auth.users`) — verified fixed:
  `20270202000000` live; `verify_email` OTP confirm works end-to-end.

## 4. Money infrastructure — STRONG

- Ledger: INSERT-only repo; balanced pairs in ONE tx under
  `pg_advisory_xact_lock(wallet:<user>)`; in-tx balance projection;
  optional `DebitGuard` (tier daily cap) under the same lock — nil guard
  fails closed (`ErrDebitGuardUnwired`); identity-verified replay
  (`journalLegsMatchTx`/`verifyReplay`) — key reuse for a DIFFERENT journal
  fails closed rather than silently absorbing (phantom-paid-row fix).
- Redis `"idem:"+key` AcquireLock is a 10s fast-path; DB unique
  `idempotency_key` is the durable authority — verified design, tested suites
  green.
- Live: `UPDATE`/`DELETE` on `ledger_entries` blocked by
  `ledger_entries_immutable` trigger (restrict_violation); missing
  `Idempotency-Key` on transfer → 400; PIN gate fires before any ledger
  write (`pin_not_set`, zero rows written).
- Webhooks: Next route verifies HMAC on raw body BEFORE any dispatch
  (uniform 401 — no prefix-oracle leak), malformed → 400; fans out to all
  handlers via allSettled; some-rejected → 500 (Paystack retries,
  idempotent handlers safe), all-rejected → 400. Go receiver: signature →
  parse → dedupe+dispatch, always-200 on deterministic failure to stop
  retry storms, bounded by 10s ctx. Go-owned prefixes routed by confirmer
  seams; ambiguous events deliberately NOT forwarded (double-fulfil guard,
  AUD-INFRA-010).
- **PLT-D002 (S3, FIXED)**: `go-forward.spec.ts` used stale colon refs
  (`feespay:x`) after `e43e3d8b0` moved every rail to `-` separators — the 3
  failure-semantics tests were vacuously passing `{processed:false}` without
  reaching fetch. Fixed refs; 18/18 now pass.
- Go paystack receiver correctly unmounted without `PAYSTACK_SECRET_KEY`
  (fail-closed); Maplerad/Monnify handlers mounted only with real clients
  (mock-verifier anti-pattern documented in wiring).

## Defect summary

| ID | Sev | Status |
|---|---|---|
| PLT-D001 duplicate global user_roles grants on replay | S2 | FIXED (code + regression test + pending index migration) |
| PLT-D002 go-forward.spec stale colon references | S3 | FIXED (test-only) |
| PLT-D003 same ON CONFLICT defect in restaurant backfill | S3 | RECORDED (domain-owned; index covers) |
| PLT-D004 middleware fail-open when Supabase env unset | S4 | RECORDED (documented dev hatch; API auth unaffected) |

## Residual risks / handoffs

- Session-revocation enforcement needs a flag-on run to prove logout-reuse
  denial end-to-end (`FEATURE_SESSION_HARDENING_ENABLED`).
- Concurrent FIRST-grant race on user_roles remains until pending.sql lands
  (sequential replay is closed by code; index closes concurrency).
- No self-serve delete-account surface; deletion is admin-side only.
- `localhost:8080` is a foreign OrbStack container — not this backend; the
  baseline doc warns against mistaking it.
