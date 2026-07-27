# Spotlight Super-App — QA Test Suite

This directory is the **authoritative, human- and machine-runnable test plan** for the
Spotlight super-app. It covers authentication, RBAC, and every backend module and frontend
surface at a uniform depth. It **wraps and extends** the existing automated tests — it does
not replace them. Where a behavior already has a test, the module file cites it; where it
does not, the module file lists the spec to add.

> Read this first, then `TEST_PLAN.md` (strategy), then the file for the area you are testing.

## How this suite is organized

| File / dir | What it is |
|---|---|
| `TEST_PLAN.md` | Master strategy: scope, pyramid, risk tiering, tooling, entry/exit + go-live sign-off, known gaps. |
| `environments-and-data.md` | Test environments, `TEST_DATABASE_URL`, seed data, feature flags, provider sandboxes. |
| `traceability-matrix.md` | Every Case ID → module → layer → automation status. The coverage ledger. |
| `cross-cutting/` | Concerns that span all modules: auth, RBAC, sessions/tokens, money invariants, webhooks, KYC/tiers, feature-flags/audit. **Module files reference these instead of repeating them.** |
| `modules/<module>.md` | One file per backend module. Same template everywhere. |
| `frontend/` | Web API routes, admin dashboard, Stays extranet, mobile app, standalone trading backend. |

## How to use it (manual QA)

1. Read `environments-and-data.md` and bring up the stack described there.
2. Pick the module file. Execute the cases in its **Manual test cases** table top-to-bottom.
3. Record pass/fail against the **Case ID** in your tracker (or the status column in
   `traceability-matrix.md`). A failing Tier-0 case is a **release blocker** (see severity
   scale in `TEST_PLAN.md`).
4. For money/auth/RBAC modules, the cross-cutting files (`money-invariants.md`,
   `authentication.md`, `rbac-and-permissions.md`) carry cases that apply to *this* module too —
   run them with the module's data.

## How to use it (automation)

Each module file's **Automated specs to add** section lists concrete specs to write, with the
target path and the existing convention to follow. These feed the backlog; do not invent a new
harness — reuse the patterns in `TEST_PLAN.md` §Tooling.

## Case-ID scheme

```
<MODULE>-<LAYER>-<NNN>
```

- `<MODULE>` — short uppercase slug (e.g. `LEDGER`, `TRANSFERS`, `RBAC`, `CRYPTO`, `STAYS`).
- `<LAYER>` — the test level this case is written for:

  | Code | Layer | Meaning |
  |---|---|---|
  | `UNIT` | Unit | Pure logic, no I/O. |
  | `INV` | Invariant | Money/data invariant (conservation, no-float, idempotent replay). |
  | `CON` | Contract | Request/response shape, status codes, enum membership vs openapi. |
  | `INT` | Integration | Handler + real DB / queue / provider (mocked at network edge). |
  | `E2E` | End-to-end | Whole user journey through the real stack. |
  | `AUTHZ` | Authorization | Allowed vs denied caller, object-level (IDOR) checks. |
  | `FSM` | State machine | Allowed transition + rejected illegal transition. |
  | `SEC` | Security/abuse | Injection, signature forgery, replay, fail-closed. |

- `<NNN>` — zero-padded sequence within (module, layer), e.g. `LEDGER-INV-001`.

Case IDs are **stable and unique** across the whole suite. Never renumber; retire with a
strikethrough note rather than reusing an ID.

## Priority & status legend

**Priority** (drives execution order and blocking):

| Priority | Meaning |
|---|---|
| **P0** | Critical path (money movement, auth, RBAC grant, data integrity). Red = do not ship. |
| **P1** | Important user-facing behavior; red = blocks the affected feature. |
| **P2** | Secondary/edge; red = tracked defect, not necessarily a blocker. |

**Status** (used in the traceability matrix):

| Status | Meaning |
|---|---|
| `AUTOMATED` | A committed test covers this case (path cited). |
| `PARTIAL` | Partially covered (e.g. logic covered, DB seam not). |
| `MANUAL` | Executed by a human; no automation yet. |
| `TODO` | Spec identified in "Automated specs to add", not yet written. |

## Related prior audits (pre-existing in this directory)

These static-analysis documents predate this suite and complement it — read them alongside the
relevant module files (they carry concrete `file:line` findings this plan turns into cases):

- `admin-rbac.md` — admin console ↔ backend route ↔ RBAC three-way alignment audit.
- `journeys.md` — static hop-by-hop e2e journey traces (screen → API → handler → DB).
- `money-paths.md` — money-path invariant trace against the CLAUDE.md iron rules.
- `round2-money.md`, `round2-rbac-wiring.md` — follow-up P0 re-verification passes.

## Ground rules for editing this suite

- **Brownfield safety:** the legacy Spotlight contest modules (contests, voting, applicants,
  legacy auth) are protected. Test them via **observable behavior only** — never propose edits
  to protected paths as part of a test. See `TEST_PLAN.md` §Guardrails.
- **Money = kobo, integer.** Every monetary value in test data is an integer in minor units.
  No floats, ever. Assertions are **kobo-exact**.
- **Synthetic data only.** No production data, no real PII, no live card/bank numbers.
- Keep cases **behavioral** — assert observable inputs/outputs and side effects, so they
  survive refactors.
