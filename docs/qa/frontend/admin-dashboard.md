# Surface: Admin Dashboard (`frontend-admin/`)

**Stack:** Next.js 15, client-only dashboard (no `route.ts` handlers) that calls the backend
gateway directly. Console at `http://localhost:3001/admin`. Also an embedded admin under
`frontend-web/app/admin/(dashboard)/**`. **Risk tier: 0** — admin actions move money, grant
roles, approve KYC/withdrawals, and override votes.

Every case here layers on `../cross-cutting/rbac-and-permissions.md` (deny-by-default,
critical-permission, scope isolation) and `../cross-cutting/feature-flags-and-audit.md` (audit
on every privileged action). Auth is the same Supabase Bearer + RBAC; admin sections are gated
by `RequirePermission`/`RequireScopedPermission` on the backend.

## 1. Sections in scope (each manages a super-app domain)

Academy/EdTech, Arena, Association, Connect (incl. RBAC roles/permissions, AML, underage,
moderation), Creators, Crowdfunding, Crypto, Invest, FX, Finance (disputes/kyc/kyc-verify/
transfers/wallets), FractionalRE, Health (doctor/lab/pharmacy/vet audits), Telemedicine,
Nutrition, Insurance, Mobility, Restaurant, Estate, Stays, Marketplace, P2P, Savings, Loyalty
(+Black), Referral (+Rewards/Risk), Points, Social (+Escrow), Spray, Events, STEM/Reality/
Open-mic/Voting, Maps, Realtor, and the Platform/RBAC/security console (users, roles,
permissions, permissions-matrix, audit-logs, login-activity, security-events, unauthorized).

## 2. Manual test cases (the admin behaviors that must not break)

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| ADM-AUTHZ-001 | Non-admin cannot load console | P0 | `qa-user-a` | Open `/admin` | — | Blocked/redirected; backend calls 403 |
| ADM-AUTHZ-002 | Admin sees only permitted sections | P0 | `qa-admin` with a subset of perms | Load console | — | Unpermitted sections hidden AND backend-denied (defense in depth) |
| ADM-AUTHZ-003 | Scoped admin confined to scope | P0 | school/estate-scoped admin | Act in own scope (allow) then another (deny) | scope A, B | A allowed, B 403 (`RequireScopedPermission`) |
| ADM-SEC-001 | Critical action needs super-admin | P0 | `qa-admin` (not super) | Attempt role grant / `payments.refund` / vote override | — | Denied `critical permissions can only be assigned by super admin` |
| ADM-INT-001 | KYC review approve/reject | P0 | pending KYC in queue | Approve one, reject another | — | State transitions per KYC FSM; audit written; tier upgrade on approve |
| ADM-INT-002 | Withdrawal approval (maker-checker) | P0 | pending withdrawal | Maker submits, checker approves | — | Two-person control enforced; single payout; audit |
| ADM-INT-003 | Refund / reversal | P0 | a settled payment | Issue refund | — | Reversing ledger entries (I7); balance restored; audit; requires `payments.refund` |
| ADM-INT-004 | Vote override / freeze / adjust | P0 | a contest | Freeze voting, adjust, reverse a vote | — | Requires `votes.override`; effect + audit; brownfield contest data via API only |
| ADM-INT-005 | Utility ops: requery/resolve/reverse | P1 | a pending utility tx | Requery, then resolve/reverse | — | Correct terminal state; no double-refund |
| ADM-INT-006 | Reports (revenue, reconciliation, profitability) | P1 | seeded data | Generate reports | — | Figures reconcile to ledger; kobo-exact |
| ADM-INT-007 | User lifecycle: suspend/lock | P0 | `qa-user-a` active | Suspend the user | — | User's next request 403 (`../cross-cutting/authentication.md`); audit |
| ADM-AUDIT-001 | Every privileged action audited | P0 | — | Perform any of the above | — | Exactly one audit event with actor=admin token identity, target, before/after |
| ADM-SEC-002 | Admin-key/service endpoints | P0 | — | See `../cross-cutting/session-and-tokens.md` | — | `ADMIN_API_KEY` enforced in prod config |
| ADM-E2E-001 | Grant→use→revoke journey | P0 | staging | Per RBAC-E2E-001 | — | Allowed while granted, denied after revoke |

## 3. Automated specs to add

- Playwright admin RBAC journey (grant→use→revoke) — gap G4.
- Per-section smoke: load + one read op with a correctly-permissioned persona and a 403 with an
  under-permissioned one.
- Reconciliation report vs ledger assertion for finance/crypto/fx sections.

## 4. Exit criteria

All P0 admin cases green; maker-checker on withdrawals proven; refund/override require the
correct critical permission; every privileged action audited; scoped admins strictly confined.
