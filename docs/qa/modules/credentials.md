# Module: Academy Credentials (Verifiable Credentials + Earning Bridge)

**Risk tier:** 2 &nbsp;·&nbsp; **Money-path:** no (records routing only; role-upgrade deferred to Paymax) &nbsp;·&nbsp; **Feature flag:** `FEATURE_ACADEMY_CREDENTIALS_ENABLED` (`FlagCredentials` = `academy.credentials`; registered inside `if credentialsEnabled`)
**Code:** `backend/internal/academy/credentials/` — `handler.go`, `service.go`, `model.go`, `statemachine.go`, `rails.go`, `repository.go`, `credentials_test.go`; wiring in `backend/internal/app/academy_routes.go` (`RegisterAcademyCredentials`, `RoleUpgrader` = nil).
**Slug:** `CREDENTIALS`

## 1. Overview & scope

Verifiable credential issuance and the "learn-to-earn" bridge. Passing a trade/academic assessment
issues a signed (HMAC-SHA256) credential with a public QR-shareable `VerificationID`; anyone can verify
it (sanitized, no PII). A learner then applies to an `EarningOpportunity` (driver/agent/creator/…);
eligibility requires the right ISSUED credentials, and `Apply` records the routed application
idempotently. **`RoleUpgrader` is nil at wiring** — Apply records routing only; the actual privileged
Paymax role-upgrade/KYC onboarding is client-initiated (never auto-granted server-side). Credential
lifecycle is a guarded FSM (`pending → issued → revoked`). Admin routes gated `academy.credentials`.

Applicable cross-cutting: `../cross-cutting/authentication.md`,
`../cross-cutting/rbac-and-permissions.md` (admin `academy.credentials`),
`../cross-cutting/feature-flags-and-audit.md`.

## 2. Services / endpoints in scope

Member base `/api/finance/academy`; admin base `/api/academy/admin`.

| Operation | Method + path | Auth / permission | Money-path? |
|---|---|---|---|
| List my credentials | `GET /credentials` | member; owner | no |
| Public verify | `GET /credentials/verify/:verificationId` | member (auth); sanitized | no |
| Get one credential | `GET /credentials/:id` | member; owner | no |
| List eligible opportunities | `GET /earning/opportunities` | member | no |
| Get opportunity | `GET /earning/opportunities/:id` | member | no |
| Apply to opportunity | `POST /earning/apply` | member; owner + `Idempotency-Key` | no (records routing) |
| Revoke credential | `POST /credentials/:id/revoke` | `academy.credentials` | no |
| Admin list/create/update opportunities | `GET/POST/PUT /earning/opportunities[/:id]` | `academy.credentials` | no |

Enums: `CredState` = pending|issued|revoked; kinds academic|trade; `AppState` =
submitted|routed|approved|rejected; opportunity roles driver|agent|creator|merchant|service_provider.
Signing secret from `ACADEMY_CREDENTIAL_SECRET`. `RoleUpgrader.UpgradeRole(ctx,userID,role,ref)` must be
idempotent on ref; nil → `noopRoleUpgrader`.

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage | Status |
|---|---|---|---|
| Credential FSM legal/illegal | unit/fsm | `credentials_test.go::TestCanCred_Allowed`, `TestCanCred_Illegal` | AUTOMATED |
| Eligibility rules (issued-only, min count) | unit | `credentials_test.go::TestEligible_Rules` | AUTOMATED |
| Apply idempotent single route | unit/inv | `credentials_test.go::TestApply_Idempotent` | AUTOMATED |
| Apply not-eligible fail-closed | unit/sec | `credentials_test.go::TestApply_NotEligible` | AUTOMATED |
| Revoke flips public verification | unit | `credentials_test.go::TestRevoke_UpdatesRegistry` | AUTOMATED |
| Revoke illegal (never issued) rejected | unit/fsm | `credentials_test.go::TestRevoke_IllegalRejected` | AUTOMATED |
| Issue via real service + signature verify | integration | — | TODO |
| Admin revoke authz | integration/authz | — | TODO |

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `CREDENTIALS-INT-001` | Issue credential on pass | P1 | passing trade/academic attempt | issuance triggered | — | Credential `issued`; `VerificationID` (`vc_...`) + HMAC signature set |
| `CREDENTIALS-INT-002` | Public verify returns sanitized valid | P1 | issued credential | `GET /credentials/verify/:verificationId` | — | `valid`; holder display name only, no PII |
| `CREDENTIALS-INT-003` | Revoke flips verification | P1 | issued credential; holder `academy.credentials` | `POST /credentials/:id/revoke` | — | State `revoked`; public verification `valid→revoked` |
| `CREDENTIALS-INT-004` | Apply to eligible opportunity | P1 | learner holds required issued credential | `POST /earning/apply` + key | — | Application `submitted→routed`; `PaymaxRef` recorded; RoleUpgrader called (noop in dev) |
| `CREDENTIALS-VAL-001` | Apply missing idempotency key | P1 | eligible learner | `POST /earning/apply` no key | — | `ErrIdempotencyRequired` → 400 |
| `CREDENTIALS-INV-001` | Apply idempotent replay | P0 | applied | re-POST apply same key | same key | One insert, one route, one upgrader call, same `PaymaxRef` |
| `CREDENTIALS-SEC-001` | Apply without required credentials rejected | P0 | learner lacks issued credential | `POST /earning/apply` | — | `ErrNotEligible`; no insert (fail-closed; pending credentials never count) |
| `CREDENTIALS-AUTHZ-001` | Get one is owner-scoped (IDOR) | P0 | credential owned by A | B `GET /credentials/:id` | A's id | 403/404; B cannot read A's credential (but public verify is by verificationId) |
| `CREDENTIALS-AUTHZ-002` | Revoke denied without permission | P0 | caller lacks `academy.credentials` | `POST /credentials/:id/revoke` | — | 403 `forbidden` |
| `CREDENTIALS-FSM-001` | Revoke a never-issued credential rejected | P1 | credential `pending` | `POST /credentials/:id/revoke` | — | `ErrIllegalTransition` (pending→revoked not legal) |
| `CREDENTIALS-SEC-002` | Signature tamper detected on verify | P1 | issued credential | verify with altered stored signature | tampered | Verification does not report `valid` (HMAC mismatch) |
| `CREDENTIALS-SEC-003` | RoleUpgrader nil does not auto-grant role | P0 | nil RoleUpgrader (wiring default) | apply to opportunity | — | Records routing only; no privileged Paymax role assigned server-side |
| `CREDENTIALS-SEC-004` | Credentials flag-off route inaccessible | P0 | `FEATURE_ACADEMY_CREDENTIALS_ENABLED` off | Call any credentials endpoint | — | Not mounted / 404 — never 500 (FLAG-SEC-001) |

## 5. State-machine transitions

**Credential** (`credTransitions`, `canCred`):

| From | Event | To | Side effect | Case ID |
|---|---|---|---|---|
| pending | issue | issued | verification registered (valid) + HMAC signature | `CREDENTIALS-FSM-002` |
| issued | revoke | revoked (terminal) | public verification → revoked | `CREDENTIALS-FSM-003` |

Self-loops illegal (replay via idempotency, not FSM); `pending→revoked` (skip) rejected
(`TestCanCred_Illegal`, `TestRevoke_IllegalRejected`). Issuance guard `canCred(pending, issued)` is
defence-in-depth before issue. `eligible()` counts only ISSUED credentials; empty track/kind = any;
MinCredentials defaults to 1.

## 6. Security & abuse cases

- **Eligibility fail-closed:** Apply re-checks eligibility; pending credentials never count; unique idem
  index is the DB backstop for concurrent double-apply (`CREDENTIALS-SEC-001`, `CREDENTIALS-INV-001`).
- **No server-side over-grant:** `RoleUpgrader` nil → deterministic no-op; privileged role-upgrade is
  client-initiated into existing Paymax onboarding (`CREDENTIALS-SEC-003`).
- **Signed verification:** HMAC-SHA256 over the credential; tamper detected on verify
  (`CREDENTIALS-SEC-002`); public verify exposes no PII.
- **IDOR:** owner-scope on `GET /credentials/:id`; admin revoke gated `academy.credentials`.
- **Flag-off:** credentials gate (`CREDENTIALS-SEC-004`).

## 7. Automated specs to add

- `credentials/live_db_issue_verify_test.go` — issue via real service, verify signature valid, tamper
  → invalid, revoke → revoked. TODO.
- `credentials/apply_authz_test.go` — owner-scope on get; admin revoke denied without slug. TODO.

## 8. Coverage target & exit criteria

Pure FSM + eligibility + apply-idempotency logic covered by `credentials_test.go`. Exit: issuance +
signature verify + revoke proven; Apply eligibility fail-closed + idempotent; no server-side role
over-grant; admin authz green; credentials flag-off inaccessible.
