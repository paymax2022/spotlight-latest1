# SWARM-BUILD-PLAN.md
### Execution plan for an autonomous multi-agent build — School Fees, Payments & Cross-School Competition Module
**Reads with:** `PAYMAX-EDTECH-FEES-BUILD.md` (the contract) · `TASKS.md` (the live claimable board)

---

## 1. How this differs from a single-agent build plan

A sequential Claude Code session can hold the whole plan in its head and build in order. A swarm of autonomous agents working concurrently cannot — two agents editing the same file at the same time is the failure mode this document exists to prevent. Everything below optimizes for one thing: **letting agents work in parallel without stepping on each other**, using file-scope ownership and an explicit dependency graph instead of a human coordinator.

---

## 2. Swarm coordination protocol

### 2.1 The task board is the source of truth

`TASKS.md` is a live file, not a plan you read once. Every task has a `status`. An agent:

1. Reads `TASKS.md`.
2. Finds tasks with `status: todo` whose `depends_on` are all `status: done`.
3. Picks one whose `file_scope` does not overlap with any task currently `status: in_progress`.
4. Immediately commits a one-line status change to `in_progress` with its agent ID, **before writing any code** — this is the claim. First commit wins; if two agents race, the second to push must re-check the board and pick a different task rather than force-push over the claim.
5. Works only inside its declared `file_scope`. Touching a file outside that scope is a protocol violation — if the work genuinely requires it, stop and open a new task in `TASKS.md` for that file scope instead of silently expanding.
6. On completion: runs the task's test gate, updates status to `in_review`, opens a PR referencing the task ID.
7. A merge queue (§2.3) serializes actual merges — `in_review` is not `done` until merged.

### 2.2 File-scope ownership prevents collisions

Every task in `TASKS.md` declares an explicit `file_scope` — one or more directories or files it alone may write to for the duration of the task. Two tasks with overlapping scopes are never both `in_progress` simultaneously; the DAG in §3 is deliberately structured so that within a phase, parallel-eligible tasks have disjoint scopes.

**Shared primitives are frozen after their owning task completes.** The state-machine library, the data-model migrations, and `REUSE-MAP.md` are each owned by exactly one early task (T0.x). Once merged, no other task may modify them directly — a task that discovers it needs a shared-primitive change must open a new, explicitly-scoped change-request task rather than editing inline. This is the swarm analogue of "no module forks a shared primitive" from the root `CLAUDE.md`.

### 2.3 Merge queue

Because multiple agents can reach `in_review` at similar times, merges are serialized: rebase onto latest main, re-run the full test gate (not just the task's own tests — the full suite, to catch cross-task interaction), then merge. If a rebase surfaces a real conflict, that's a signal two tasks' file scopes overlapped more than intended — flag it in `TASKS.md` rather than resolving silently, so the DAG can be corrected for the remaining tasks.

### 2.4 Definition of Ready / Definition of Done (per task)

**Ready:** all `depends_on` tasks are `done` and merged · `file_scope` doesn't overlap any `in_progress` task · the task's relevant section of `PAYMAX-EDTECH-FEES-BUILD.md` has been read.

**Done:** code within declared `file_scope` only · every SF invariant listed in the task's `invariants` column has a corresponding test · idempotency test for any money-touching endpoint · full test suite green after rebase · PR merged.

### 2.5 Blocking rule

`T0.1` (brownfield audit) and `T0.2`/`T0.3` (shared schema + state-machine library) block **every** other task in this plan. No agent should claim anything else until these three are `done` and merged. This is the one place parallelism is deliberately withheld — getting the shared foundation wrong and discovering it after five agents have built on top of it is far more expensive than a short serialized start.

---

## 3. Dependency graph (epics)

```
T0 Foundation (blocking, serialized)
 ├─ T0.1 Brownfield audit → REUSE-MAP.md
 ├─ T0.2 Schema migrations (all entities, §2 of build spec)
 └─ T0.3 State-machine library (Invoice, FeesVault, Promotion, Competition)
      │
      ├── E1 School onboarding & fee schedules ──────┐
      │                                                │
      ├── E10 Super Admin Console (school directory) ─┤ (can start once E1's School entity exists)
      │                                                │
      E1 ──> E2 Guardian/student linking & invoicing ──> E3 Payments & installments ──> E5 Hardship/defaulters
      E1 ──> E4 Fees Vault (parallel to E2/E3)
      E1 ──> E6 Promotion engine (independent of payment track)
      E1 + [Academy quiz engine, existing] ──> E7 Competition layer ──> E12 Broadcast tie-in (Spotlight Schools Cup ops)
      E3 + E7 ──> E9 School Trust Score & Sponsor-a-Student
      E1 + E6 ──> E8 Government reporting
      E1 ──> E11 Staff & role management
```

Everything under `E1` becomes claimable in parallel once `T0` is done: `E1`, `E4`, `E6`, and the school-directory slice of `E10` have no dependency on each other and are the first real parallel-execution opportunity for the swarm.

---

## 4. Epics, story points, and task tags

Tags: `[BE]` backend service · `[FE-M]` mobile · `[ADM-S]` school-admin console · `[ADM-SU]` super-admin console · `[T]` test/QA · `[S]` shared/foundation.

| Epic | Scope | Points | Depends on |
|---|---|---|---|
| T0 | Brownfield audit, schema, state-machine library | 24 | — |
| E1 | School setup wizard, fee schedule builder, installment policy | 22 | T0 |
| E2 | Guardian/student onboarding & linking, invoice issuance | 20 | E1 |
| E3 | Payment collection, installments, receipts, reconciliation | 24 | E2 |
| E4 | Fees Vault — contribute, auto-save, apply-to-invoice | 18 | E1 |
| E5 | Hardship/freeze requests, defaulter review queue | 14 | E3 |
| E6 | Promotion engine — score import, two-step approval, rollover | 22 | E1 |
| E7 | Cross-school leaderboards, tournaments, challenge mode, badges | 26 | E1, Academy quiz engine |
| E8 | Government/regulator opt-in reporting exports | 16 | E1, E6 |
| E9 | School Trust Score, Sponsor-a-Student | 18 | E3, E7 |
| E10 | Super Admin Console — directory, verification, collections, fraud, audit log | 28 | E1 |
| E11 | Staff & bursar role management | 10 | E1 |
| E12 | Spotlight Schools Cup production ops (Super Admin) | 16 | E7 |
| **Total** | | **258** | |

---

## 5. Phased checkpoints (for human sign-off, not agent blocking)

Even though agents work the DAG rather than a phase list, a human should sanity-check at these checkpoints before the swarm proceeds past them — these are the points where a wrong shared decision is expensive to unwind:

- **Checkpoint A** — after T0: confirm `REUSE-MAP.md` matches reality and the state-machine library's guarded transitions match §3 of the build spec exactly.
- **Checkpoint B** — after E1–E4 merged: a real school, real guardian, and real invoice can move through draft → issued → paid end to end, including a Fees Vault applying to an invoice.
- **Checkpoint C** — after E6 merged: run a full mock end-of-session promotion on seed data and manually verify both approval steps are structurally required (attempt to bypass one in a test — it should fail).
- **Checkpoint D** — after E7 merged: verify SF-7 by attempting to fetch a minor student's full identity on a public leaderboard endpoint without consent — it should be rejected or stripped.
- **Checkpoint E** — after E10 merged: confirm a school-level role has zero access to any Super Admin Console route, and vice versa isn't assumed either.

---

## 6. First tasks to seed the swarm

These are the exact tasks that should exist in `TASKS.md` with `status: todo` at swarm start — everything else stays `blocked` until T0 is done:

1. `T0.1` — Brownfield audit → `REUSE-MAP.md`
2. `T0.2` — Schema migrations for all new entities
3. `T0.3` — State-machine library + full guarded-transition test suite

See `TASKS.md` for the complete seeded board, including every E1–E12 task pre-broken-down with `file_scope` and `depends_on` populated.
