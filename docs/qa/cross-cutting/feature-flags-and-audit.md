# Cross-cutting: Feature Flags & Audit

**Risk tier: 0/1.** Every module is flag-gated; every money and privileged mutation must emit
an audit event. Sources: `backend/internal/config/config.go` (flag loading),
`backend/internal/platform/audit/`, per-module `audit.go` (e.g. `crypto/audit.go`),
`backend/internal/services/audit_service.go`, admin audit-log handlers.

## 1. Feature flags

Convention: `FEATURE_<MODULE>_ENABLED` (full list in `../environments-and-data.md` §4). **No
flag, no route.** A disabled module must make its routes inaccessible (not-found/forbidden), not
throw a 500. Dev-bypass flags (`FEATURE_INVEST_PIN_DEV_BYPASS`) must be **off** outside dev.

| Case ID | Title | Priority | Steps | Expected result |
|---|---|---|---|---|
| FLAG-SEC-001 | Disabled module route inaccessible | P0 | With `FEATURE_<M>_ENABLED` off, call the module's endpoint | Route not mounted / 404 / forbidden — never 500 |
| FLAG-SEC-002 | Enabled module route works | P0 | Flip flag on, restart, call endpoint | Behaves per module spec |
| FLAG-SEC-003 | Dev-bypass off in staging/prod | P0 | Confirm `FEATURE_INVEST_PIN_DEV_BYPASS` (and similar) off | PIN/verification enforced; no bypass |
| FLAG-UNIT-001 | Flag parsing defaults | P1 | Load config with flag unset | Defaults to safe (off) per `config_test`/`validate_test` |

> Per-module files each carry a `<MODULE>-SEC-00x` flag-off case referencing FLAG-SEC-001.

## 2. Audit

Every money mutation and every privileged admin action (role grant, refund, override, KYC
decision, withdrawal approval) must write **exactly one** audit event capturing actor, action,
target, amount (where money), and an idempotency/correlation reference. Audit is append-only.

| Case ID | Title | Priority | Steps | Expected result |
|---|---|---|---|---|
| AUDIT-INT-001 | Money mutation writes audit | P0 | Perform a wallet debit; inspect audit sink | One event: actor, amount (kobo), ref |
| AUDIT-INT-002 | Privileged admin action writes audit | P0 | Grant a role / approve a withdrawal | One event with actor + target + before/after |
| AUDIT-INT-003 | Audit append-only | P1 | Attempt to modify/delete an audit row via API | No API path mutates history |
| AUDIT-INT-004 | Idempotent op writes one audit, not two | P1 | Replay a money op with same Idempotency-Key | Single audit event (no duplicate) |
| AUDIT-INT-005 | Failed action audited appropriately | P2 | Trigger a denied/failed privileged action | Denial recorded (security-events / audit) |
| AUDIT-SEC-001 | Audit actor is token identity | P0 | Perform action with spoofed `user_id` in body | Audit records the **token** identity, not the spoofed value |

## 3. Automated specs to add

- Per-module: assert audit emission in the money-path integration test (reuse existing
  `crypto/audit.go` pattern as the template).
- `config` flag-default test coverage for any new flag (extend `validate_test.go`).

## 4. Coverage target & exit criteria

Exit: every Tier-0 module proven to (a) be inaccessible when its flag is off and (b) emit
exactly one audit event per mutation; dev-bypass flags confirmed off for the target env.
