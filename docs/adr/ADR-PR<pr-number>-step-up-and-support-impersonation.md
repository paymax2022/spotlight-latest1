# ADR-PR<pr-number> — Platform step-up gate and read-only support view-as

**Date:** 2026-10-28
**Status:** Proposed
**Deciders:** platform security

## Context

Two S1 defects from the Oct-2026 Estate UAT (cluster D):

- **ESTD-D014 (EST-UAT-0385).** `estate_member_settings.two_factor_enabled` is a
  stored preference that nothing enforces. Finance and super-admin privileged
  actions must be restricted until a fresh second-factor check completes.
- **ESTD-D028 (EST-UAT-0422).** No support impersonation surface exists.
  Support access requires strong authorization, an explicit notice to the
  impersonated user, and a full audit trail.

Constraints: fail closed everywhere, no forged user JWTs, additive-only
migrations, every new capability behind a flag.

## Decision

### Step-up grant (ESTD-D014)

A step-up grant is a row in `auth_step_up_grants` bound to
`(user_id, sha256(access_token))`, minted by
`POST /api/auth/step-up/verify` after the caller redeems an email OTP
(`purpose=step_up`, reusing the existing `otp.Service` store, send budgets and
attempt ceiling). TTL `STEP_UP_TTL_SECONDS` (default 300s, clamped 60-900).

`step_up` is a non-public purpose (`otp.IsPublicPurpose`): the public
`/api/auth/otp/request` cannot issue it and `/api/auth/otp/verify` cannot
redeem it — the same treatment `login` already gets, because both proofs must
stay bound to the flow that owns them.

`middleware.RequireStepUp` mounts on high-risk routes. It refuses with a
machine-readable `code`: `step_up_required` (403, no grant),
`step_up_expired` (403), `step_up_unavailable` (503 — no verifier wired,
lookup failed, OTP service unconfigured). Flag `FEATURE_STEP_UP_ENFORCED`
defaults **true** (the repo convention for enforcement rails — same as
`FEATURE_TIER_LIMITS_ENABLED`, `FEATURE_INSURANCE_NIN_REQUIRED`,
`TRANSFER_FAILOVER_ENABLED`: skipping the rail is an explicit opt-out, never
the forgotten default). Flag off = exact prior behaviour.

Routes gated (the exhaustive list — grep `guards.stepUp(`):

- `/api/admin` RBAC mutations: role create/update/clone/delete; permission
  create/update/delete; role↔permission assign/remove (+ bulk); user role
  assign/remove (+ both bulk endpoints); suspend/unsuspend/lock/unlock;
  user PATCH; force-logout; force-password-reset.
- `/api/v1/admin` console mutations: KYC review, asset control update,
  withdrawal review, risk-limit update, fee update, feature-flag set,
  approval approve/reject.
- `/api/finance` admin: transfer retry, transfer reverse.
- `/api/finance/estate` admin: resident ban/restore, subscription plan,
  vendor job assignment, dues invoice create, restriction apply/lift.

Not gated (deliberately): member self-service money paths (a resident paying
their own dues is a normal payment, not a privileged act — gating it would
break the module for every user), reads, and all non-admin mutations.

### Support view-as (ESTD-D028)

No forged tokens. The agent keeps their own bearer token and adds
`X-Support-Impersonation: <session id>`, naming a row in
`support_impersonation_sessions` bound to the agent AND their token hash,
time-boxed (default 15m, hard max 60m enforced by DB CHECK).

- **Authorization.** `POST /api/support/impersonation` requires
  `middleware.RequireExplicitPermission("support.impersonate")` — it checks
  the caller's effective-permission set only, so the `super-admin` bypass in
  `RequirePermission`/`user_has_permission()` cannot confer it — plus an
  always-enforced step-up grant (a new capability has no prior behaviour to
  preserve), a reason (10-500 chars), a ticket ref (3-64), a target that
  exists, is not the caller, and holds no privileged role (super-admin,
  system-admin, support-impersonation-agent).
- **Read-only by construction.** `GuardSupportImpersonation` runs engine-wide
  before routing: any request carrying the header is refused unless it is a
  GET on the explicit allow-list — mutations and every other route die before
  auth, handler or service runs. `ApplySupportImpersonation` re-checks inside
  the finance group, validates the session, writes the request audit row
  (fail closed: no audit row, no response) and only then swaps the request
  identity to the target — with no roles, no permissions and no token.
- **Allow-list (EST-UAT-0422 scope: resident estate account).**
  `GET /api/finance/estate/:id/dashboard`, `/profile`, `/dues/invoices`,
  `/notifications`, `/access-request/me`, `/bookings`, `/access-codes`.
  Each handler was verified to be a pure read (no writes on the path —
  e.g. `GET /:id/settings` is excluded because it upserts a default row).
  Pinned by `TestSupportImpersonationAllowListIsUnderFinance`.
- **Audit + notice.** `support_impersonation_events` is append-only: start,
  stop, every request (with stamped response status), every refusal and
  expiry are rows, written in the same transaction as the session mutation.
  The impersonated user is emailed a security notice
  (`services.EventSupportAccess`) and can list every access to their account
  at `GET /api/auth/support-access`.
- **Flag.** `FEATURE_SUPPORT_IMPERSONATION_ENABLED` defaults **false** (the
  repo convention for a new capability: ships dark). While off, any request
  carrying the header is refused `impersonation_disabled` — never silently
  ignored, so an agent cannot believe they are viewing-as when they are not.

## Consequences

### Positive
- Privileged actions now require a fresh proof, closing the advisory-flag gap.
- Support can debug a resident's view with a complete, tamper-evident trail.
- No token material is minted, stored raw, or given to the agent.

### Negative / trade-offs
- Environments without the OTP email service (Brevo) get 503
  `step_up_unavailable` on gated routes while the flag is on; they must set
  `FEATURE_STEP_UP_ENFORCED=false` or wire OTP.
- A rotated access token invalidates the grant (intended — the grant is a
  property of the session, not the user).

### Risks
- The allow-list is narrow by design; widening it requires verifying each
  candidate handler is a pure read — the pinning test only proves the listed
  routes exist.

## Alternatives considered

| Alternative | Why rejected |
|-------------|--------------|
| Enforce `two_factor_enabled` per-user on member money paths | The defect is scoped to privileged roles; gating member self-service would break normal use for every resident. The grant machinery is reusable if that scope is ever wanted. |
| Mint a short-lived target-user JWT for the agent | Creates real token material for another user; revocation and audit are harder and a leaked token is a full session. The session-header design keeps the agent's identity verifiable end to end. |
| Read-only enforced per-handler | Impossible to keep complete — any handler that grows a write re-opens the hole. The engine-level gate refuses by default. |
| Reuse `RequirePermission` for support.impersonate | Its super-admin bypass would let every super-admin view-as without a grant; `RequireExplicitPermission` checks the effective set only. |

## Related

- `docs/qa/estate-uat-443/defects-estate-d.csv` rows ESTD-D014, ESTD-D028
- `backend/internal/stepup/`, `backend/internal/supportimpersonation/`,
  `backend/internal/middleware/step_up.go`,
  `backend/internal/middleware/support_impersonation.go`
- Migrations `20271068003000_auth_step_up_grants.sql`,
  `20271068003010_support_impersonation.sql`
