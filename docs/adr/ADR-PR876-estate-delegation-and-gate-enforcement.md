# ADR-PR876: Estate delegated officer roles and server-side gate enforcement

**Status:** Accepted · **Date:** 2026-10-22 · **Area:** estate security (SP-01 + SP-02)

## Context

The Estate Visitor Access UAT workplan (443 cases) calls for a gated community where
only authorised people admit visitors, privileges are scoped and revocable, and an
access code can be consumed at most once per use. The pre-existing module had three
structural gaps (gap-analysis themes 1 & 2):

- One coarse `estate_residents.role` (`resident` | `estate_admin`) stood in for seven
  distinct officer capabilities. Any resident could hit the guard endpoints —
  `assertResident` gated `expected-visitors`, `lookup`, `checkin`, `checkout` — so a
  guest's own host, or any member, could admit visitors and forge gate events.
- `CheckInVisitor` incremented `used_count` with an unconditional `UPDATE`, then
  checked validity in Go. Two concurrent admits of a single-use code both saw
  `used_count < max_uses` and both wrote a check-in — the door opened twice.
- `ListEstates` returned every estate to any caller, a cross-estate read leak.
- Anyone could create an estate; the workplan (§2.1) wants an approved estate-manager
  merchant first.

The backend connects as Supabase `service_role`, which bypasses RLS, so the Go service
— not policies — is the authority for these guarantees.

## Decision

Add an additive, expiring **grant plane** and move guard authority onto it. Enforcement
stays in the service because RLS is bypassed.

- **`estate_staff_grants`** carries scoped officer roles (`gate_officer`,
  `gate_supervisor`, `finance_officer`, `election_officer`, `facility_officer`,
  `meeting_secretary`, `auditor`), each with `expires_at` (NULL = forever) and
  `revoked_at`. `estate_admin` is **deliberately not grantable** here — it remains the
  residents-table super role — so a leaked token cannot mint its own super-user.
- **`assertGate(roles…)`** replaces `assertResident` on the guard endpoints. It fails
  closed: non-member → `ErrNotMember`; banned → `ErrAccountBanned`; deleted →
  `ErrAccountDeleted`; member without a live matching grant → `ErrInsufficientRole`.
  Passes only for `estate_admin` or a member with an un-revoked, un-expired grant in
  the role set. Guard admission uses `{gate_officer, gate_supervisor}`.
- **Atomic admit.** `CheckInVisitor` consumes a code with one conditional statement —
  `UPDATE … SET used_count = used_count + 1 … WHERE status='active' AND blacklisted=FALSE
  AND valid_from<=NOW() AND valid_until>=NOW() AND used_count<max_uses` — and denies when
  `RowsAffected == 0`. Expiry, blacklist, single-use and max_uses are all re-checked by
  the row lock inside the UPDATE, so a concurrent burst cannot overshoot.
- **Host-approval codes.** `require_host_approval` on a code keeps the door shut until
  the issuing host approves a live `visitor_arrival_requests` row (guard raises it via
  `RequestArrival`; only the host or an `estate_admin` decides via `DecideArrival`).
  Declined/pending/none all stay denied.
- **`ListEstates`** is scoped to estates where the caller is a member **or** holds a
  live grant; an empty caller id returns `ErrNotMember`.
- **Merchant creation gate** (`CreateEstate`) is behind `FEATURE_ESTATE_MERCHANT_GATE`,
  **default off**, wired through an `EstateMerchantGate` seam so the estate package
  stays free of an onboarding import. When on it fails closed: an error or a false
  decision blocks creation. Guard and code-issuance routes also get per-user rate
  limits (`estate-guard`, `estate-code`).

## Consequences

- **Backwards compatible by default.** The flag is off and `require_host_approval`
  defaults false, so existing estates and auto-admit journeys behave exactly as before.
  Officer delegation is additive; nothing that relied on the two-role model broke.
- **`estate_admin` still sees everything.** The grant plane narrows *guard* writes, not
  the super role. Retiring `estate_admin`'s blanket reach (maker-checker, admin step-up)
  is SP-05, out of scope here.
- **Not yet closed in this slice:** guard `gate_sessions` shift lifecycle, signed/HMAC
  QR, offline buffer with revocation propagation, and a hard gate↔estate binding on
  admit. These remain Missing/Partial in the gap analysis.
- **Verification is split and honest.** The 8 DB-free domain tests
  (`delegation_test.go`) pass. The 10 live-DB tests (`delegation_live_db_test.go`)
  — including the concurrent single-use race and the full E2E journey — pass against
  the local Supabase stack with migration `20271087000000` applied. The live run
  surfaced two bugs the DB-free pass could not: a `gate_id` cast miss in
  `RequestArrival` (text → uuid), and a nullable-scan miss in `ListEstates`
  (`estates.address` now `COALESCE`d). Both are fixed. Wider packages `app`,
  `config`, `cryptosvc`, `onboarding` remain green; `restaurant`, `tests/ledger`,
  `tests/referrals` fail on pre-existing local state unrelated to this slice.
