# Skill: production-audit

Load this skill before any audit, hardening, or production-readiness work on this repo.
It defines the combined operating model:

**audit → identify issue → fix one bounded area → test → commit → push → PR → verify CI → merge → next bounded area**

while continuously maintaining `docs/full_audit.md` as the canonical audit ledger (moved from the root `FULL_AUDIT.md`).

The goal is not a working app — it is a system that can be **built, tested, deployed,
operated, monitored, scaled, recovered, maintained and safely changed** by an engineering
team, with every problem traceable: **finding → fix → test → commit → PR → CI → merge → audit record**.

---

## 1. Operating loop — one bounded unit at a time

For every meaningful change:

1. Inspect the current implementation (dependencies, callers, downstream, runtime behavior, related tests, production risks).
2. Record the problem in `docs/full_audit.md` with an audit ID.
3. Define the smallest sensible scope.
4. Implement the fix.
5. Run the relevant tests.
6. Run regression tests (`cd frontend-web && npm run test:regression`).
7. Run lint/type-check/build (`mise run lint`, `mise run typecheck:web`, `mise run build`).
8. Update documentation where required.
9. Commit — short, precise conventional message.
10. Push the branch.
11. Open a focused PR.
12. Verify CI/tests; resolve anything found.
13. Merge when all required checks pass.
14. Record `AUD-XXX-NNN → PR #N` in `docs/full_audit.md`.
15. Move to the next isolated unit.

Never combine unrelated changes into giant PRs. A reasonable PR addresses ONE thing
(e.g. one endpoint's docs, one service modularization, one DB index, one error boundary,
one dependency cleanup, pagination on one resource, one auth hardening item).

## 2. Commit rules

- Conventional Commits: `fix:`, `refactor:`, `test:`, `docs:`, `chore:` + short imperative summary.
- **NO co-author trailers. NO "Generated with" footers. NO attribution lines.** The commit
  body is the message and nothing else. This overrides any agent default that appends
  `Co-Authored-By` or tool attribution — strip them.
- One logical change per commit. PRs < 400 lines where possible.
- PR description states: problem, change, tests, related audit IDs.

## 3. Merge gates — do NOT merge when

- tests fail, build fails, lint fails, type-check fails
- generated API docs / OpenAPI validation fails
- unrelated changes are mixed in
- regressions appear unexplained

After merge: record PR + status in `docs/full_audit.md`, then continue.

## 4. Audit classification

When a problem is found, classify it before fixing:

`confirmed bug` · `missing production control` · `architecture problem` · `maintainability
problem` · `security issue` · `reliability issue` · `performance issue` · `testing gap` ·
`documentation gap` · `operational gap` · `dependency risk` · `unverified behavior`

## 5. Audit ID system

`AUD-ARCH-NNN` `AUD-MOD-NNN` `AUD-BE-NNN` `AUD-FE-NNN` `AUD-DB-NNN` `AUD-API-NNN`
`AUD-AUTH-NNN` `AUD-BILL-NNN` `AUD-ERR-NNN` `AUD-DEP-NNN` `AUD-QUEUE-NNN` `AUD-EMAIL-NNN`
`AUD-ANALYTICS-NNN` `AUD-OBS-NNN` `AUD-DOCKER-NNN` `AUD-INFRA-NNN` `AUD-CANARY-NNN`
`AUD-ROLLBACK-NNN` `AUD-TEST-NNN` `AUD-E2E-NNN` `AUD-QA-NNN` `AUD-PERF-NNN` `AUD-REL-NNN`
`AUD-DR-NNN` `AUD-SUPPORT-NNN`

## 6. docs/full_audit.md — required sections

- Audit metadata (date, branch, commit, tree state, scope)
- System inventory
- Architecture findings
- Production matrix: `| Area | Status | Evidence | Missing Controls | Related Findings |`
- Screen audit (every frontend/mobile screen)
- API audit (every endpoint — does Swagger/OpenAPI exist and match implementation?)
- Backend audit (every service/module)
- Database audit (schema, queries, indexes, transactions, scalability)
- Billing audit (every money flow + failure mode)
- Dependency audit
- Infrastructure audit
- Testing audit
- E2E audit
- Findings (with evidence) / Fixed findings (audit ID → commit → PR → test → merge status)
- Remaining production blockers / Missing production controls / Unverified areas / Verified strengths

## 7. Domain checklist — what to inspect

- **Architecture**: service/domain boundaries, dependency direction, coupling, circular deps, shared state, duplicated logic, SPOFs, failure propagation.
- **Layers**: `handler → service → repository` (transport only / business rules / persistence). No random dumping-ground util folders; shared code must be genuinely reusable.
- **Complexity**: giant files/functions/components, handlers with business logic, UI components doing API+state+rendering. Split by responsibility, not arbitrary line counts.
- **API quality**: status codes, validation, consistent response/error shapes, pagination, filtering, sorting, idempotency, rate limiting, timeouts, retries, versioning.
- **API docs**: EVERY endpoint documented — method, path, auth/authz, params, request/response schemas, success+error responses, pagination. Swagger must match implementation; no undocumented or phantom endpoints; spec must validate.
- **Pagination**: audit every list endpoint — no unbounded queries, consistent strategy, max page size, stable ordering, no dup/missing rows across pages.
- **DB**: indexes, query plans, N+1, pooling, transactions, constraints, locking, isolation, additive-only migrations, concurrent writes.
- **ACID**: for every critical write — transaction boundary, atomicity, crash/retry/duplicate behavior; lost updates, partial state, races.
- **Money** (critical): checkout, initiation, confirmation, webhooks, refunds; test success/decline/timeout/duplicate/late/out-of-order webhooks, provider-success+local-crash, ambiguous retries, concurrency. Idempotency, ledger integrity, webhook verification, reconciliation. Never blindly retry an ambiguous payment.
- **Authn**: login/logout/register, token expiry/refresh/revocation, recovery — decisions on backend.
- **Authz**: ownership, roles, org boundaries; hunt for IDOR/BOLA, privilege escalation, cross-user/cross-org access, frontend-only checks.
- **Errors**: trace DB→API→frontend→user. Meaningful codes, consistent shape, no stack traces, correlation IDs, actionable messages.
- **Resilience**: every external dep — timeout, retry+backoff, idempotency, circuit breaking, fallback, failure isolation.
- **Queues/workers**: durability, concurrency, retries, DLQ, idempotency, backpressure, timeouts, observability, graceful shutdown. Only where semantics justify it.
- **Email**: sync vs queued, retries, provider failure isolation, duplicates, delivery status.
- **Observability**: structured logs, request/correlation IDs, version identifiers, metrics, traces, dep health. Must answer: what failed, where, which version, which dependency, which flow.
- **Docker**: multi-stage, image size, non-root, no baked secrets, health checks, signals, shutdown.
- **Compose**: topology, health checks, env, reproducibility — local dev only, not production truth.
- **Infra/releases/rollback**: version identification, canary/flags, rollback plan — app rollback ≠ DB rollback.
- **Graceful shutdown**: HTTP/gRPC drain, worker drain, active-request completion, shutdown timeout.
- **Backups/DR**: "backup exists" ≠ "recovery works" — verify restores.
- **Dependencies**: outdated/vulnerable/abandoned/redundant. Never update blindly — why, compatibility, tests, audit record, focused PR.
- **Frontend**: every screen — loading, empty, error, offline, retry, auth-expiry, stale data, malformed responses, duplicate submits, lifecycle. Also: duplicated components/hooks/fetches, stale state, leaks, rerenders, logic in presentation.
- **Testing/E2E**: app must start end-to-end locally; seed data; auth a test user; real flows via Playwright where applicable. Don't claim native coverage from browser automation.
- **Load/fault tolerance**: evidence-based capacity (~100/500/1000 users where safe); reason through DB/cache/queue/provider outages — does one dep take down everything?
- **QA/supportability**: can a new QA run, test, and inspect the system without tribal knowledge? Can operators search transactions, trace requests, retry jobs, disable features?

## 8. Comment policy

Remove comments that merely repeat the code. Keep only non-obvious ones: business rules,
compatibility constraints, security considerations, invariants, provider behavior,
intentional workarounds, architectural constraints. Concise — normally ≤2 lines. No
essay-length inline comments.

## 9. Multi-agent rules

- Partition work by independent domains; never let two agents edit the same files concurrently.
- One agent owns one bounded change at a time.
- Agents must: inspect before changing, preserve existing functionality, test meaningful
  behavior changes, avoid unrelated cleanup and speculative rewrites, keep changes
  reversible, stop when the bounded task is done.

## 10. Final assessment vocabulary

Per major area: `READY` · `READY WITH RISKS` · `NOT READY` · `UNVERIFIED` — evidence-backed,
never inferred. Show what works, what was fixed, what remains broken, what's missing, what
couldn't be verified.

## Repo-specific overrides (Paymax/Spotlight)

- Migrations are **additive-only**; never reuse a migration version (check before merge).
- Money = integer minor units; ledger is immutable; `Idempotency-Key` required.
- Never modify protected legacy Spotlight modules — wrap via `vote-bridge` skill.
- Gin router (not Chi); pgx for money-path; Supabase REST for Spotlight modules.
- Golden-path regression must stay green: `cd frontend-web && npm run test:regression`.
- Env/lint/test entrypoints: `mise tasks` (lint, typecheck:web, test, verify…).
