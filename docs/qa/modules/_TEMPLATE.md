# Module: <Name>

<!--
This is the fixed template EVERY module file follows. Copy it, fill every section, delete these
comments. Keep cases behavioral and grounded in the real code. Do not repeat cross-cutting
invariants — reference them. Case-ID prefix = the module's uppercase slug (see below).
-->

**Risk tier:** 0 | 1 | 2 &nbsp;·&nbsp; **Money-path:** yes/no &nbsp;·&nbsp; **Feature flag:** `FEATURE_<M>_ENABLED`
**Code:** `backend/internal/<path>/` (list key files: handler.go, service.go, routes.go, model.go, statemachine.go, *_test.go)
**Slug:** `<SLUG>` (uppercase, used in Case IDs)

## 1. Overview & scope

One paragraph: what the module does, who calls it, and why it matters for testing. Note if it
sits behind a guard/scoped permission, and which cross-cutting files apply
(`../cross-cutting/money-invariants.md`, `authentication.md`, `rbac-and-permissions.md`,
`kyc-and-tiers.md`, `webhooks-and-providers.md`).

## 2. Services / endpoints in scope

| Operation | Method + path (or service func) | Auth / permission | Money-path? |
|---|---|---|---|
| … | `POST /api/…` | `RequirePermission("…")` / owner | yes/no |

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage (cite file) | Status |
|---|---|---|---|
| … | unit / inv / con / int / e2e / authz / fsm / sec | `internal/<m>/xxx_test.go` or — | AUTOMATED / PARTIAL / MANUAL / TODO |

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `<SLUG>-<LAYER>-001` | … | P0/P1/P2 | … | … | … (kobo integers for money) | … (kobo-exact) |

Cover, in order: happy path(s) · input validation / negative · authorization (allowed vs
denied caller, IDOR/object-level) · boundary values · idempotency/replay (money) · concurrency
(money) · flag-off (`<SLUG>-SEC-00x` → see `../cross-cutting/feature-flags-and-audit.md`).
Target ~10–25 cases (more for Tier 0, fewer for thin Tier 2 modules).

## 5. State-machine transitions (only if the module has an FSM)

| From | Event | To | Side effect | Case ID |
|---|---|---|---|---|
| … | … | … | … | `<SLUG>-FSM-00x` |

List illegal transitions and assert they are rejected. Re-entering a terminal state must be
idempotent.

## 6. Security & abuse cases

Authz bypass, IDOR, missing/invalid Idempotency-Key, webhook signature forgery (if applicable),
tier/KYC gate (if applicable), amount tampering / server-side re-pricing, injection on inputs,
fail-closed on dependency error. Reference cross-cutting cases rather than re-deriving them.

## 7. Automated specs to add

- `path/to/new_test.go` — one-line description, following <existing convention> (table-driven
  Go / hoisted-mock Vitest / `page.route` Playwright). Mark TODO in the traceability matrix.

## 8. Coverage target & exit criteria

Coverage floor (Tier 0 ≥ 85% pure-logic). Exit criteria: which P0 cases must pass before the
module is considered release-ready.
