# Super-App Authentication & RBAC — Comprehensive Test Plan

**Scope:** one identity, ~30 modules, two worlds on the same app — **consumers** (wallet, bills,
crypto, health, mobility, events…) and **providers/merchants** (doctors, drivers, schools,
restaurants, hotels/stays suppliers, creators, associations, estate admins…). This plan tests the
**identity, authentication, session, and authorization (RBAC)** layer that gates *all* of them.
It is deliberately paranoid: in a super app the blast radius of one auth/RBAC defect is the whole
platform and its money.

Companion to `cross-cutting/authentication.md`, `cross-cutting/rbac-and-permissions.md`,
`cross-cutting/session-and-tokens.md`, `cross-cutting/kyc-and-tiers.md`. This file goes deeper on
the **multi-persona, cross-module** dimension those files summarize. Case-ID scheme per
`README.md` (`<PREFIX>-<LAYER>-<NNN>`).

---

## 1. System under test (grounded in the real implementation)

| Concern | Reality (test implications) |
|---|---|
| Identity provider | Supabase Auth (JWT/HS256). `Authorization: Bearer <token>`. |
| Token validation | **No local signature verification** — `middleware/auth_context.go` calls Supabase `GET /auth/v1/user` (`integrations/supabase_http.go`). Trust is delegated; a token is valid iff Supabase resolves a non-empty `id`. |
| Account-status gate | After identity resolves, `rbac.GetUserStatus` rejects `suspended`/`locked`/`deleted` → **403 `account restricted`**, even for a technically valid token. |
| Session revocation | `RequireAuthContextWithSessions` + flag → revoked/expired `auth_session` rejected **401 fail-closed**. |
| Global authz | `RequirePermission(rbac, "slug")` → 403 `forbidden` on deny **or error** (deny-by-default / fail-closed); 401 if no `authUser`. |
| Scoped authz | `RequireScopedPermission(rbac, "slug", scopeType, scopeIDParam)` — scope id read **from the path param**, checked within that scope. |
| Service-layer invariants (`services/rbac_service.go`) | System roles/permissions immutable; **critical perms** (`votes.override`, `payments.refund`, `permissions.assign`, `roles.delete`, `users.roles.assign`, `permissions.delete`) assignable **only by `super-admin`**; **last-super-admin cannot be removed**. |
| Provider role variants | Per-module guard closures (`GuardFunc`, e.g. `creators.verify`); STEM via `x-stem-role` header (`middleware/stem_authz.go`); role grants issued on provider **approval** (`internal/onboarding/grant.go` — idempotent `user_roles` upsert + profile upsert + audit-on-first-approve). |
| Machine identities | Service token (`LEDGER_SERVICE_TOKEN`, constant-time, **fail-closed 503** if unset); admin key (`x-admin-api-key`, **dev-permissive if unset**). |
| Capability surface | `/api/v1/me/capabilities` projects the caller's effective grants to the client. |

**Two structural facts that shape the whole plan:**
1. **Authorization is server-authoritative and identity comes from the token, never the request body.** Every case that can, sends a *spoofed* `user_id`/`role`/`scope` in the body/query and asserts the server ignores it.
2. **One human can wear many hats simultaneously** (consumer + merchant + driver + scoped estate-admin). The dangerous bugs live at the seams between hats — that's §7 and §9.

---

## 2. Actor & role taxonomy (the personas to seed)

| Persona | Roles / grants | Represents |
|---|---|---|
| `qa-super-admin` | `super-admin` | Root of trust; critical-perm + last-super-admin cases. |
| `qa-platform-admin` | `finance.admin` (global) | Back-office operator with a *subset* of admin power. |
| `qa-scoped-admin-A/B` | e.g. `estate.manage`@estateA / @estateB | Multi-tenant scope isolation. |
| `qa-consumer` | authenticated user, KYC T1 | Baseline app user. |
| `qa-consumer-2` | authenticated user, KYC T1 | The *other* user for IDOR/object-level. |
| `qa-consumer-kyc0` | no KYC | Tier/role gating that depends on KYC. |
| `qa-merchant` | merchant owner (approved) | Merchant/business world. |
| `qa-merchant-staff` | staff role under `qa-merchant` | Delegated sub-account authz. |
| `qa-doctor` | clinician (MDCN-verified) | Health provider; PII access. |
| `qa-driver` | driver (approved) | Mobility provider. |
| `qa-school-admin` | `academy.*`@schoolS1 | EdTech scoped provider. |
| `qa-stays-supplier` | extranet supplier | Hospitality provider portal. |
| `qa-support-agent` | support role (impersonation-capable, if such exists) | Delegated/assumed access. |
| `qa-omni` | **consumer + merchant + driver + estate-admin@A** all at once | The multi-hat human — the star of §7/§9. |
| `qa-suspended` / `qa-locked` / `qa-deleted` | any, with that status | Status-gate cases. |
| `qa-pending-provider` | applied, **not yet approved** | Pre-grant boundary. |

Seed via the repo convention (`seedUser` synthetic `auth.users` + `seedWallet` via ledger). Grants via `rbac_service` / `onboarding.grant`. Never real PII.

---

## 3. Manual test suites

### 3.1 Registration & account creation — `REG`

| Case ID | Title | Pri | Steps | Expected |
|---|---|---|---|---|
| REG-INT-001 | Consumer signup happy path | P0 | Register email+pw → verify OTP | Account created; unverified state until OTP; then active |
| REG-INT-002 | Duplicate email rejected | P0 | Register with an existing email | Rejected; no second account; **no info leak** on whether it's a merchant vs consumer |
| REG-SEC-001 | Email/username enumeration | P1 | Register/login/reset with known-vs-unknown email; compare responses & timing | Uniform response & timing — cannot enumerate accounts |
| REG-SEC-002 | Weak / breached password policy | P1 | Register with weak/common password | Rejected per policy |
| REG-SEC-003 | Registration cannot self-assign a role | P0 | Register with `role=admin`/`is_merchant=true` in body | Body ignored; account gets only the default consumer role |
| REG-INT-003 | Provider registration path distinct from consumer | P1 | Register as merchant/provider (apply flow) | Creates a *pending* provider profile, **not** an active provider — role granted only on approval (see §3.9) |
| REG-SEC-004 | Same human, second role, same email | P1 | Existing consumer applies to become a merchant | One identity gains a *pending* merchant profile; no duplicate `auth.users`; consumer access unchanged |
| REG-SEC-005 | Provider registering under a victim's email | P0 | Attempt to onboard a provider using `qa-consumer-2`'s email | Cannot attach a provider profile to another user's identity without that user's authenticated action |

### 3.2 Login, logout, session — `LOGIN` / `SESS`

| Case ID | Title | Pri | Steps | Expected |
|---|---|---|---|---|
| LOGIN-INT-001 | Correct credentials | P0 | Login | 200 + token; protected call succeeds |
| LOGIN-INT-002 | Wrong password | P0 | Login wrong pw | 401; no token; failure recorded |
| LOGIN-SEC-001 | Lockout after N failures | P1 | Fail `AUTH_MAX_FAILED_LOGIN_ATTEMPTS` times → try correct pw | Locked for `AUTH_ACCOUNT_LOCK_MINUTES`; correct pw blocked during window |
| LOGIN-SEC-002 | Impossible-travel / anomaly | P2 | Two logins geo-distant within a short window | Escalation per `AUTH_SUSPICIOUS_ESCALATION_POLICY` (challenge/lock) |
| SESS-INT-001 | Session issue → validate | P0 | Login → protected call | Validates |
| SESS-SEC-001 | Logout revokes | P0 | Logout → reuse token (enforcement on) | 401 `session revoked` |
| SESS-SEC-002 | Multi-device revoke | P1 | Login on device A & B; revoke A | A's token rejected; B still valid (or global logout if that's the design — assert the intended one) |
| SESS-SEC-003 | Idle & absolute timeout | P1 | Leave session idle past TTL; and past absolute max | Expired → 401 fail-closed |
| SESS-SEC-004 | Concurrent-session cap (if any) | P2 | Exceed allowed concurrent sessions | Oldest evicted or new blocked per policy |

### 3.3 Token validation & integrity — `TOKEN`

| Case ID | Title | Pri | Steps | Expected |
|---|---|---|---|---|
| TOKEN-SEC-001 | Missing / malformed bearer | P0 | No header / `Token abc` | 401 `missing bearer token` |
| TOKEN-SEC-002 | Invalid / expired token | P0 | Garbage/expired JWT | 401 `invalid token` (Supabase rejects) |
| TOKEN-SEC-003 | Tampered claims | P0 | Edit a valid JWT's payload (elevate role/sub) then call | Rejected — server trusts Supabase resolution, not client claims |
| TOKEN-SEC-004 | `alg:none` / signature strip | P0 | Present an unsigned/`none`-alg token | Rejected |
| TOKEN-SEC-005 | Cross-user token confusion | P0 | Use `qa-consumer` token, put `qa-consumer-2` id in body | Resolves to the *token's* user; body id ignored (run on wallet + transfers + profile) |
| TOKEN-SEC-006 | Token for suspended user | P0 | Valid token, user suspended after issue | 403 `account restricted` (status gate beats token validity) |
| TOKEN-SEC-007 | Replay after password change | P1 | Change password; reuse old session token | Old token/session invalidated |

### 3.4 Credential recovery & MFA — `PWD` / `OTP`

| Case ID | Title | Pri | Steps | Expected |
|---|---|---|---|---|
| PWD-INT-001 | Forgot → reset → login | P0 | Request reset → use token → set new pw → login | Old pw rejected; new works; existing sessions invalidated |
| PWD-SEC-001 | Reset-token single-use & expiry | P0 | Reuse a reset token; use an expired one | Rejected; cannot reset twice |
| PWD-SEC-002 | Reset does not leak account existence | P1 | Reset for unknown email | Same "if it exists, we sent…" response |
| OTP-INT-001 | OTP verify + resend | P1 | Wrong OTP (reject) → resend → correct | Wrong rejected; correct verifies; old OTP invalid after resend |
| OTP-SEC-001 | OTP brute-force throttle | P1 | Rapid wrong OTPs | Rate-limited / locked |
| OTP-SEC-002 | Step-up MFA for sensitive actions | P1 | Trigger a high-risk action (payout, role grant, bank change) | Step-up challenge required if configured; blocked without it |

### 3.5 Account-status lifecycle & cascades — `STATUS`

| Case ID | Title | Pri | Steps | Expected |
|---|---|---|---|---|
| STATUS-SEC-001 | Suspend blocks everything | P0 | Suspend `qa-consumer` mid-session | Next request across *any* module → 403 |
| STATUS-SEC-002 | Lock vs suspend vs delete semantics | P1 | Apply each | Each maps to the documented gate; delete also revokes sessions & tokens |
| STATUS-SEC-003 | Merchant suspension cascades to staff | P0 | Suspend `qa-merchant` | `qa-merchant-staff` loses merchant-scoped access; personal consumer access (if separate identity) unaffected |
| STATUS-SEC-004 | Provider de-verification revokes provider role | P0 | Revoke `qa-doctor` MDCN verification | Clinician endpoints denied; consumer identity intact |
| STATUS-SEC-005 | Delete → data & session handling | P0 | Delete `qa-deleted` | Sessions killed, token rejected, PII handled per policy; no orphaned active grants |
| STATUS-SEC-006 | Reactivation restores prior grants correctly | P2 | Suspend then reactivate | Only previously-held roles restored; nothing extra |

### 3.6 Role assignment & the RBAC invariants — `ROLE`

| Case ID | Title | Pri | Steps | Expected |
|---|---|---|---|---|
| ROLE-AUTHZ-001 | Deny-by-default | P0 | `qa-consumer` calls a permission-gated admin endpoint | 403 `forbidden` |
| ROLE-AUTHZ-002 | Allowed holder succeeds | P0 | `qa-platform-admin` calls its permitted endpoint | 200 |
| ROLE-SEC-001 | CheckPermission error → fail-closed | P0 | Force RBAC lookup to error | 403 (never allow-on-error) |
| ROLE-SEC-002 | Critical perm — non-super-admin blocked | P0 | `qa-platform-admin` assigns `payments.refund` | `critical permissions can only be assigned by super admin` |
| ROLE-SEC-003 | Every critical slug enforced | P0 | Try assigning each of the 6 critical slugs as non-super-admin | Each rejected |
| ROLE-INV-001 | Last super-admin cannot be removed | P0 | Remove `super-admin` from the sole holder | `cannot remove last super admin` |
| ROLE-INV-002 | System role/permission immutable | P0 | Update/delete a system role & permission | Rejected |
| ROLE-SEC-004 | Self-escalation blocked | P0 | Admin grants *themselves* a critical perm / `super-admin` | Rejected |
| ROLE-SEC-005 | Grant race / TOCTOU | P0 | Two admins concurrently remove the last two super-admins | System never drops below one super-admin (serialize / re-check under lock) |
| ROLE-SEC-006 | Revoke takes effect mid-session (staleness) | P0 | Grant role, user acts (allowed); revoke; user immediately retries | Denied on next request — assert no stale permission cache lets it through, or that the cache TTL is bounded & documented |
| ROLE-AUTHZ-003 | Bulk assign respects per-item guards | P1 | Bulk assign incl. a critical perm as non-super-admin | Non-critical succeed; critical item rejected per-item |

### 3.7 Scoped permissions & multi-tenant isolation — `SCOPE`

| Case ID | Title | Pri | Steps | Expected |
|---|---|---|---|---|
| SCOPE-AUTHZ-001 | Grant confined to its scope | P0 | `qa-scoped-admin-A` acts in estateA (allow) then estateB (deny) | A→200, B→403 |
| SCOPE-SEC-001 | Scope id from path, not body | P0 | Call `.../estateB/...` with `scopeId=estateA` in body | 403 — path param governs |
| SCOPE-SEC-002 | Cross-tenant IDOR | P0 | Scoped admin A reads/edits estateB's object by id | 403/404 |
| SCOPE-SEC-003 | Scope leakage across module types | P1 | A grant scoped to *estate* A must not authorize a *school* action even if ids collide | Denied — scopeType is part of the check |
| SCOPE-SEC-004 | Wildcard/global vs scoped confusion | P1 | Present a scoped grant where a global one is required (and vice-versa) | Only the correct scope satisfies |
| SCOPE-INV-001 | Scope enumeration | P2 | Iterate scope ids to find ones you can act on | No oracle; unauthorized scopes indistinguishable (403 vs 404 consistent) |

### 3.8 Multi-role / role-switching / provider↔consumer boundary — `IDN` (outside the box)

The multi-hat human is where super-app RBAC breaks. `qa-omni` is consumer + merchant + driver + estate-admin@A.

| Case ID | Title | Pri | Steps | Expected |
|---|---|---|---|---|
| IDN-SEC-001 | Provider context can't do consumer-privileged acts | P0 | In driver/provider context, attempt a consumer wallet transfer without the consumer capability | Authorized by *capability*, not by "is logged in" — allowed only if the identity holds it, regardless of active "mode" |
| IDN-SEC-002 | Consumer context can't reach provider tools | P0 | As plain consumer, call driver dispatch / doctor consult-notes endpoints | 403 — provider role required |
| IDN-SEC-003 | Confused deputy across modules | P0 | Doctor (allowed to read patient P's record) tries to use that identity to read P's **wallet/transactions** | Denied — cross-module capability is not implied by clinical access |
| IDN-SEC-004 | Role removal is independent | P0 | Revoke `qa-omni`'s driver role | Driver endpoints denied; merchant/estate/consumer still work — no collateral revoke |
| IDN-SEC-005 | Mode/"active profile" is a UI hint, not an authz boundary | P0 | Force-set an "acting as merchant" flag in the request while calling a consumer endpoint the identity lacks | Server authorizes by held grants, not the client-asserted mode |
| IDN-SEC-006 | Capability endpoint accuracy & least-leak | P1 | `GET /me/capabilities` for `qa-omni` | Lists exactly the effective grants; does **not** leak other tenants' scopes or internal-only permissions |
| IDN-SEC-007 | Aggregate privilege ≠ escalation | P1 | Hold two non-critical roles whose union approximates a critical one | Union does not grant a critical permission neither role has |

### 3.9 Provider onboarding → verification → role grant (state machine) — `PROV`

Grounded in `internal/onboarding/grant.go` (idempotent grant + audit-on-first-approve), doctor MDCN review FSM, merchant apply/types/status.

| From | Event | To | Side effect | Case ID |
|---|---|---|---|---|
| (none) | apply | `SUBMITTED` | pending provider profile; **no role yet** | PROV-FSM-001 |
| SUBMITTED | start review | `UNDER_REVIEW` | — | PROV-FSM-002 |
| UNDER_REVIEW | approve | `APPROVED` | provider role granted (idempotent `user_roles` upsert), profile activated, audit once | PROV-FSM-003 |
| UNDER_REVIEW | reject | `REJECTED` | **no role granted** | PROV-FSM-004 |
| UNDER_REVIEW | needs-info | `NEEDS_MORE_INFO` | resubmit allowed | PROV-FSM-005 |
| NEEDS_MORE_INFO | resubmit | `UNDER_REVIEW` | — | PROV-FSM-006 |
| APPROVED | approve again | `APPROVED` | **idempotent — no double role grant** | PROV-FSM-007 |

| Case ID | Title | Pri | Steps | Expected |
|---|---|---|---|---|
| PROV-SEC-001 | Pending provider has no provider powers | P0 | `qa-pending-provider` calls provider endpoints | 403 until APPROVED |
| PROV-SEC-002 | Approval is the *only* path to the role | P0 | Try to obtain the provider role without approval (direct grant attempt, body flag) | Blocked; only the approval flow grants it, and only by a permitted reviewer |
| PROV-SEC-003 | Reviewer authz + audit | P0 | Non-reviewer approves; reviewer approves | Non-reviewer 403; reviewer approve writes an audit event with actor identity |
| PROV-SEC-004 | KYC/credential gate before grant | P0 | Approve a provider missing required KYC/licence (MDCN/PCN/CAC) | Blocked until credential verified |
| PROV-SEC-005 | Re-approval idempotency (no double grant) | P0 | Approve an already-approved provider twice | Single role; single profile; no duplicate audit-of-first-grant |
| PROV-SEC-006 | Illegal transition rejected | P0 | Approve a `REJECTED` app without resubmit | Rejected |

### 3.10 Profile management & PII — `PROF`

| Case ID | Title | Pri | Steps | Expected |
|---|---|---|---|---|
| PROF-AUTHZ-001 | Read own profile only | P0 | `qa-consumer` reads own; then `qa-consumer-2`'s | Own 200; other 403/404 (IDOR) |
| PROF-AUTHZ-002 | Edit own; cannot edit others | P0 | Edit own fields; attempt to edit `qa-consumer-2` | Own succeeds; other blocked |
| PROF-SEC-001 | Cannot change identity-defining/authz fields via profile | P0 | PATCH `role`, `kyc_tier`, `user_status`, `email` (verified) through the profile edit | Server ignores privileged fields; email change requires re-verification |
| PROF-SEC-002 | Admin edit is authz'd + audited | P1 | Admin edits a user profile | Requires permission; audited; still cannot set critical role via profile |
| PROF-SEC-003 | PII exposure minimisation | P1 | Read profile / capability / directory listings | No over-exposure of PII, tokens, internal ids, other users' data |
| PROF-SEC-004 | Provider profile ≠ consumer profile boundary | P1 | Merchant edits business profile | Cannot mutate the underlying consumer identity's security fields |

### 3.11 Cross-module authorization consistency — `XMOD` (the 30-module sweep)

The point of a super app: the *same* guard behavior must hold on *every* module. This suite is a matrix, not a handful of cases.

| Case ID | Title | Pri | Method | Expected |
|---|---|---|---|---|
| XMOD-AUTHZ-001 | Every protected endpoint denies the anonymous caller | P0 | Enumerate protected routes across all ~30 modules; call each with no token | 401 uniformly |
| XMOD-AUTHZ-002 | Every protected endpoint denies the wrong-role caller | P0 | For each module's privileged endpoint, call as a persona lacking the grant | 403 uniformly (no endpoint "forgets" its guard) |
| XMOD-AUTHZ-003 | Every money mutation binds actor to token | P0 | Per money module, send spoofed `user_id`; assert token identity used | Token wins everywhere |
| XMOD-SEC-001 | No unguarded admin route | P0 | Static + dynamic scan for admin groups mounted with only `requireUserID()` (see the confirmed `finance_routes.go` gaps: crowdfunding/wallet/disputes admin) | Every admin group carries `RequirePermission`/`RequireScopedPermission` |
| XMOD-SEC-002 | Flag-off closes the module's auth surface too | P1 | Disable a module flag; call its routes | Not mounted / 404 — no half-open auth surface |
| XMOD-SEC-003 | Consistent 401-vs-403 semantics | P2 | Compare unauthenticated vs unauthorized across modules | 401 = who are you, 403 = not allowed — consistent, no info leak |

> Implementation note: XMOD is best driven by the **route-inventory** approach in §5 (generate the (route, method, required-permission) table from code, then assert each row from both an allowed and a denied persona).

### 3.12 Delegated / assumed access (support, impersonation) — `IMP` (outside the box)

| Case ID | Title | Pri | Steps | Expected |
|---|---|---|---|---|
| IMP-SEC-001 | Impersonation requires explicit permission | P0 | Support agent "acts as" a user | Only with a dedicated permission; plain admin can't silently become a user |
| IMP-SEC-002 | Impersonation is bounded & audited | P0 | Assume a user; perform actions | Every action tagged with the real actor + the assumed subject; session time-boxed |
| IMP-SEC-003 | Money & credential actions blocked under impersonation | P0 | While impersonating, attempt a transfer / password change / bank-detail change | Blocked — impersonation is read/support-scoped, not a money key |
| IMP-SEC-004 | Impersonation can't self-escalate | P0 | Assume a super-admin | Disallowed, or at minimum cannot grant roles while assumed |

### 3.13 Machine identities — `SVC`

| Case ID | Title | Pri | Steps | Expected |
|---|---|---|---|---|
| SVC-SEC-001 | Service token required + fail-closed | P0 | Call internal endpoint with wrong/absent token; and with `LEDGER_SERVICE_TOKEN` unset | Rejected; **503 when unset** (never open) |
| SVC-SEC-002 | Admin key enforced in prod config | P0 | Wrong/absent `x-admin-api-key` with key set; confirm dev-permissive only when unset | Enforced when set; go-live asserts it's set |
| SVC-SEC-003 | STEM header role gate | P1 | Missing/incorrect `x-stem-role`; correct role | Denied vs allowed per `RequireStemRoles` |
| SVC-SEC-004 | Constant-time token compare | P2 | Vary token prefix lengths | No timing oracle |

### 3.14 KYC-tier ↔ capability gating — `KYCG`

| Case ID | Title | Pri | Steps | Expected |
|---|---|---|---|---|
| KYCG-AUTHZ-001 | KYC-gated capability blocked without KYC | P0 | `qa-consumer-kyc0` attempts bank transfer / crypto withdraw / referral withdraw / provider payout | Blocked with KYC-required |
| KYCG-SEC-001 | Fail-closed on KYC/tier lookup error | P0 | Force the tier/KYC lookup to error | Blocked (503), never allowed |
| KYCG-AUTHZ-002 | Tier boundary exactness | P1 | Action at exactly the tier limit vs +1 | At-limit allowed; over-limit denied |
| KYCG-SEC-002 | Role grant that requires KYC honors it | P1 | Approve a provider role that mandates KYC while KYC incomplete | Blocked (ties to PROV-SEC-004) |

---

## 4. Security & abuse — the "outside the box" escalation matrix — `ESC`

A focused red-team pass. Each is a hypothesis the tester actively tries to *prove*.

| Case ID | Attack | Pri | What to attempt | Pass = |
|---|---|---|---|---|
| ESC-SEC-001 | **Vertical escalation** | P0 | Consumer → admin action via any route/param/role-flag manipulation | Impossible |
| ESC-SEC-002 | **Horizontal escalation (IDOR)** | P0 | Act on another user's/tenant's object across every module that takes an id | Impossible |
| ESC-SEC-003 | **Confused deputy** | P0 | Get module A (which you can call) to perform module B's privileged action on your behalf without B re-checking | B always re-authorizes |
| ESC-SEC-004 | **Mass-assignment escalation** | P0 | Inject `role`/`permissions`/`kyc_tier`/`scope`/`is_verified` into create/update bodies | Privileged fields never bound from client input |
| ESC-SEC-005 | **JWT / claim forgery** | P0 | Forge/tamper token claims (sub, role, scope, exp) | Rejected (Supabase-verified) |
| ESC-SEC-006 | **Session fixation / hijack** | P0 | Pre-set a session, reuse another's token, fix a session across login | New session on auth; tokens bound to user |
| ESC-SEC-007 | **Permission-cache poisoning / staleness** | P0 | Cause a grant to be cached, then revoked; race the cache | Revocation wins within bounded, documented TTL |
| ESC-SEC-008 | **Grant/revoke race (TOCTOU)** | P0 | Concurrent role mutations incl. last-super-admin | Invariants hold under concurrency |
| ESC-SEC-009 | **Provider↔consumer boundary crossing** | P0 | Use provider credentials to reach consumer money, or vice-versa | Capability-checked, not role-implied |
| ESC-SEC-010 | **Deactivation bypass** | P0 | Act with a token minted just before suspension; queued/async jobs of a suspended user | Status re-checked at execution |
| ESC-SEC-011 | **Injection on auth inputs** | P1 | SQLi/NoSQLi/header injection in email, token, scope id, role slug, `x-*-role` headers | Sanitised; no auth bypass |
| ESC-SEC-012 | **Account/scope enumeration** | P1 | Timing/response diffing on login, reset, scoped-403-vs-404 | Uniform, non-oracular |
| ESC-SEC-013 | **Onboarding forgery** | P0 | Self-approve a provider app; approve without required credential; replay approval | Only permitted reviewer + credential gate; idempotent |
| ESC-SEC-014 | **Impersonation abuse** | P0 | Escalate or move money while impersonating | Blocked + audited (see IMP) |
| ESC-SEC-015 | **Rate-limit / lockout evasion** | P1 | Rotate IPs/user-agents to dodge login lockout & OTP throttle | Per-account limits hold regardless of IP |

---

## 5. Automated test strategy

Mirror the existing repo conventions (see `TEST_PLAN.md` §7); do not invent a new harness.

### 5.1 Unit (Go, table-driven) — the guards & invariants
- `middleware/auth_context_test.go` — bearer parsing table; each `user_status` → status/error (fake `SupabaseRestClient` + fake `RBACService`); session-enforce on/off.
- `middleware/authorization_test.go` — global deny-by-default, **fail-closed on error**, 401-vs-403; scoped: grant@A allows A / denies B, **scope id from path not body**, scopeType isolation.
- `services/rbac_service_test.go` — all 6 critical slugs restricted to super-admin; system role/perm immutability; **last-super-admin** (single holder blocked, two holders one-removable); self-escalation blocked.
- `middleware/service_token_test.go` — set/unset(→503)/correct/incorrect; `middleware/admin_auth_test.go` — empty-key dev-permissive vs set-key enforcement; `middleware/stem_authz_test.go` — header role gate.
- `onboarding/grant_test.go` — approve grants role idempotently, reject grants nothing, re-approve = no double grant, audit-on-first-approve (fake store, no DB).

### 5.2 Integration (live-DB, `TEST_DATABASE_URL`-gated) — the seams unit can't reach
- Grant→revoke→immediate-deny (ROLE-SEC-006) against the real permission store (cache/TTL behavior).
- **Concurrent** last-super-admin removal + concurrent grant/revoke (ROLE-SEC-005 / ESC-SEC-008) — N goroutines vs the real unique constraint / advisory lock.
- Scope isolation & IDOR against real rows (SCOPE-SEC-002).
- Suspend-mid-session and async-job status re-check (ESC-SEC-010).
- KYC fail-closed at the DB seam (KYCG-SEC-001).

### 5.3 Contract — the client relies on shapes
- `/me/capabilities`, login, and the RBAC admin endpoints: response shape, status codes, and **enum membership** for roles/permissions vs `contracts/openapi.yaml` (extend the `contract_finance_test.go` pattern).
- Negative contract: privileged fields are *not* accepted in create/update bodies (mass-assignment guard as a contract test).

### 5.4 The route-inventory / authorization matrix (generated, covers all ~30 modules)
The scalable way to test XMOD without hand-writing hundreds of cases:
1. **Generate** the `(module, method, path, required-permission/scope, guard-kind)` table by walking the route registrations (`internal/app/*routes*.go`, per-module `Register`), resolving `RequirePermission`/`RequireScopedPermission`/`GuardFunc`/`RequireStemRoles`/`requireUserID` to a literal.
2. **Assert two rows per route**: an allowed persona → 2xx/whitelisted; a denied persona → 403 (and anonymous → 401).
3. **Flag any route whose guard is only `requireUserID()`** (authenticated-but-unauthorized) for admin/privileged paths — this is exactly the confirmed `crowdfunding`/`wallet`/`disputes` finding; the generated matrix turns that into a standing regression test.
4. **Reconcile** enforced permission slugs against the slugs seeded in `public.permissions` — drift in either direction fails CI.

### 5.5 E2E (Playwright, few, high-value)
- Consumer: signup → verify → login → suspended-mid-session → 403.
- Admin RBAC: super-admin grants a role → grantee performs the action → revoke → grantee denied → audit visible.
- Multi-hat: `qa-omni` uses consumer + provider surfaces in one session; revoke driver role → driver UI gone, rest intact.
- Provider lifecycle: apply → (pending has no powers) → reviewer approves with credential → provider tools unlocked.
- Impersonation: support assumes a user (read-only), attempts a transfer → blocked; audit trail shows both identities.

---

## 6. Authorization matrix (how to represent "who can do what")

Maintain a **roles × capabilities** matrix as the single source of truth, generated from §5.4 and reconciled with `public.permissions`. Rows = roles/personas (incl. scoped + provider + machine identities); columns = capabilities grouped by module. Cell = allow / deny / allow-in-scope / step-up-required. Every allow **and** every deny cell is a test assertion. New module = new columns; the matrix makes "did we forget a guard?" mechanically answerable.

---

## 7. Non-functional

| Area | Check |
|---|---|
| Permission-check latency | p95 of an authz check under load (it gates every request across 30 modules — it's hot). |
| Concurrency | Grant/revoke and last-super-admin under parallel load (ties ESC-SEC-008). |
| Cache correctness | If permissions are cached, TTL bounded & revocation-consistent (ROLE-SEC-006 / ESC-SEC-007). |
| Audit completeness | Every role grant/revoke, status change, impersonation, provider approval, and money action emits exactly one audit event with the **real** actor identity (not a spoofed body id). |
| Availability of the auth seam | Supabase `/auth/v1/user` outage → fail-closed (deny), never fail-open; degraded-mode behavior documented. |

---

## 8. Entry / exit criteria

**Entry:** personas & scoped grants seeded; feature flags at go-live state; Supabase + RBAC store reachable; `ADMIN_API_KEY` & `LEDGER_SERVICE_TOKEN` set; dev-bypass flags off.

**Exit (auth/RBAC sign-off):**
- All P0 cases green across §3–§4 on staging.
- The §5.4 authorization matrix passes for **every** module (no unguarded admin route; no `requireUserID`-only privileged group).
- Invariants proven under concurrency: last-super-admin, grant/revoke TOCTOU, KYC fail-closed.
- No open S1/S2 in the escalation matrix (§4).
- Every privileged action audited with the token identity; impersonation bounded + audited.
- The 5 E2E journeys (§5.5) green.

## 9. Coverage targets

Middleware (`auth_context`, `authorization`, `service_token`, `admin_auth`, `stem_authz`) and RBAC service ≥ **90%** on pure-logic functions (this is the platform's front door — hold it higher than the 85% money-path floor). The generated authorization matrix must cover **100% of protected routes** with both an allowed and a denied assertion. Do not chase coverage on inert DTOs.

---

## 10. Traceability

Every case ID here is unique and folds into `traceability-matrix.md`. Confirmed defects already found in this dimension (RBAC gaps on `finance_routes.go` admin groups → `task_6fa26cd4`) are the seed of the XMOD-SEC-001 regression; keep the register current as the matrix runs.
