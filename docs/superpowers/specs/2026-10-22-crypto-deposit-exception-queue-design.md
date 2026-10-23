# Crypto deposit exception queue — design

**Workstream:** GAP-DEP-01 (inbound crypto money-IN), follow-on to the deposit engine +
reconciler + read surfaces already shipped (PR #856).
**Date:** 2026-10-22
**Status:** design approved in section by the partner; this doc is the spec.
**Decision gate:** Option A money model (credit lands in `crypto_holdings`, backed by an
append-only `crypto_deposits` journal) was approved 2026-10-21 and is **unchanged** here.
This design adds only a *descriptive side ledger* for transfers that did **not** credit
anyone. It introduces **no privileged money action.**

## 1. Problem

The settlement engine (`internal/crypto/deposit`) already classifies every inbound transfer,
but it only persists the ones that **credit a balance**:

- `Settled` / `Duplicate` → a `crypto_deposits` row (the money journal).
- `Awaiting` → transient, nothing written (by design).
- `Unmapped` (no `crypto_accounts` owner for the sub-account) and `Rejected` (non-final
  failed/reorged, non-positive amount, overflow) → a `Result` with a `Reason` that is
  **discarded**. No row anywhere. The raw webhook body lingers only as a dedupe row in
  `webhook_events`, which is deleted on any processing error and is not a queryable queue.

The reconciler already **auto-heals** both classes: an `Unmapped` transfer credits the moment
a `crypto_accounts` mapping appears, and a below-floor transfer credits once confirmations
pass. So money is not permanently lost. The real gap is **operational visibility**: today an
operator cannot see *which* transfers are stuck, *why*, *how long*, or *that an orphan sub-
account keeps receiving money with nowhere to go* — and has no way to acknowledge and close a
case that will never self-heal.

## 2. Goals / non-goals

**Goals**
- Persist every `Unmapped` and `Rejected` transfer as one queryable, state-tracked exception.
- Keep exceptions coherent with the auto-heal: when the same transfer later settles, its
  exception flips to `resolved` and links to the credit.
- Let a `crypto.admin` read and **close-with-note** an exception (audit trail), and surface
  open-exception counts next to the reconciler health view.
- Zero change to the money paths, the once-only/confirmation invariants, or the
  "recipient never trusted from the payload" rule.

**Non-goals (explicit, deferred)**
- **No manual crediting.** An admin cannot attribute an unmapped transfer to a user by hand.
  Crediting stays fully automatic (webhook + reconciler through the same once-only settler).
  This is what removes the maker-checker / privileged-money surface from scope.
- **No ledger reversal.** A reorg *after* a credit is surfaced as an exception but never
  auto-reversed (see §6). Reversal is a separate, larger money-state design.
- **`Awaiting` visibility** is out (self-heals, too noisy to persist).
- **Per-customer deposit-address ownership** (guaranteeing each customer a mapped sub-account)
  is the *other* open GAP-DEP-01 sub-item and is a separate design, not this one.
- Live Quidax contract confirmation (event names, per-transfer confirmations) is independent
  and remains blocked on the sandbox.

## 3. Data model — `crypto_deposit_exceptions` (additive migration)

Why a new table and not a column on `crypto_deposits`: that journal requires
`user_id NOT NULL` (an unmapped transfer has no owner) and `units bigint CHECK > 0` (a
rejected transfer may be non-positive/overflow), and its `UNIQUE(provider_op_id)` is the
*credit* idempotency anchor. Overloading it would break "a row = a credit" and endanger
anything downstream that assumes every row moved money. The exception is therefore a
**descriptive side ledger**, written by the same engine.

| Column | Type / constraint | Meaning |
|---|---|---|
| `id` | uuid PK default gen_random_uuid() | |
| `provider` | text NOT NULL | provider name (e.g. `quidax`) |
| `provider_op_id` | text NOT NULL | provider's deposit operation id |
| `UNIQUE (provider, provider_op_id)` | | one row per transfer; every re-observation is an **upsert** |
| `provider_account_id` | text NOT NULL | receiving sub-account; **no FK** (an orphan is exactly the case we record) |
| `kind` | text NOT NULL CHECK IN ('unmapped','rejected') | which non-settled class |
| `reason` | text NOT NULL | engine `Result.Reason` verbatim — human-readable, no secrets |
| `symbol` / `network` / `address` | text | provider-reported facts (nullable: a rejected may lack some) |
| `amount_whole` | text | the provider whole-unit decimal as **text** (e.g. `0.001`); never integer minor units, never used to credit |
| `confirmations` / `required_confs` | int | why it did not settle (0/0 if unknown) |
| `tx_hash` | text | on-chain reference for audit |
| `state` | text NOT NULL CHECK IN ('open','resolved','closed') DEFAULT 'open' | lifecycle |
| `deposit_id` | uuid NULL | set on auto-resolve: the `crypto_deposits` row that later credited it |
| `resolved_user_id` | uuid NULL | the owner credited on auto-resolve |
| `first_seen_at` | timestamptz NOT NULL default now() | |
| `last_seen_at` | timestamptz NOT NULL default now() | bumped on every re-observation (sweep/webhook) |
| `seen_count` | int NOT NULL default 1 | observations; distinguishes "one stuck transfer" from N |
| `closed_at` | timestamptz NULL / `closed_by` text NULL / `close_note` text NULL | operator close |
| `created_at` / `updated_at` | timestamptz NOT NULL default now() | row bookkeeping, per the repo migration convention; `updated_at` is stamped by the auto-resolve of §4.3 |

Indexes: `(state, last_seen_at)` for the active queue ordered oldest-first;
`(provider, state)` for filtered reads.

**Who writes `state`:** only the engine (insert/reopen as `open`, `resolved` on auto-resolve)
and the admin close endpoint (`closed`). Nothing else mutates it, so the allowed transitions
are exactly: `∅ → open`, `open|closed|resolved → open` (a materially different re-observation,
§4.1), `open|closed → resolved` (a real credit, §4.3), `open → closed` (operator
acknowledgement, §5). A `resolved` row can only leave `resolved` by being reopened as `open`.

Migration file follows the repo convention (additive, timestamped, e.g.
`2027107xxxxxx_crypto_deposit_exceptions.sql`).

**RLS:** `service_role` ALL only. **No customer-facing policy** — an unmapped row has no
legitimate owner to expose and a rejected transfer is not the user's money to see; admin reads
go through the Go layer under `crypto.admin` (mirrors the swap review reads). The engine and
reconciler write via the service role.

Migration is additive and reversible (`CREATE TABLE IF NOT EXISTS …; DROP TABLE` to undo); it
must never run against production by this workflow.

## 4. Write path

The **engine is the only place that records exceptions**, so the webhook and the reconciler
both get it with no duplicated logic and no `cryptosvc` change.

- `deposit.Store` gains `RecordException(ctx, Exception) error`. `PGStore` implements it; the
  in-mem test store gets a fake. `ApplyCredit` gains the auto-resolve step (§4.3).
- **Recording rule:** in `Settler.Settle` / `SettleDeposit`, immediately before returning, call
  `RecordException` **iff `err == nil` AND outcome ∈ {Unmapped, Rejected}**.
  - A *decided* non-settlement (orphan, non-final failed/reorged, non-positive, overflow) →
    persisted.
  - `Awaiting` → never persisted.
  - A **dependency error** (resolver/DB failure returns `(Result, err)`) → **not** recorded.
    That is "retry": the bridge surfaces 5xx so the provider redelivers; recording it would
    flood the queue with transient noise.
  - The amount recorded is the provider re-query value (`cryptoprov.Deposit.Amount`), stored
    as whole-unit text; the payload is never trusted.

### 4.1 Upsert semantics (`ON CONFLICT (provider, provider_op_id)`)
- Row absent → insert `state='open'`, `seen_count=1`, `first_seen_at=last_seen_at=now`.
- Row present, `state='open'` → bump `last_seen_at`, `seen_count+1`, refresh
  `kind/reason/amount_whole/confirmations/required_confs`.
- Row present, `state='closed'` → stay `closed` but bump `last_seen_at`/`seen_count` (an
  operator acknowledged it; a bare repeat of the same facts does not reopen). If the new
  observation changes `kind` or `reason`, reopen to `open` and update the reason.
- Row present, `state='resolved'` → this is a transfer that was credited then a terminal
  reject/reorg arrived: reopen to `open`, append reason "reorg/reject after credit —
  investigate", keep the `deposit_id` link. (Money-critical; see §6.)

### 4.2 Exception recording is best-effort (never fails the money path)
If `RecordException` errors, **log + alert and continue** with the primary outcome already
decided. A recording failure must not turn a `Unmapped/Rejected` 200 into a 5xx redelivery
storm, and must not stall a reconciler pass. The transfer simply isn't surfaced this time
(covered next sweep). This keeps visibility work strictly subordinate to settlement.

### 4.3 Auto-resolve (inside the settle transaction)
`ApplyCredit`'s settle transaction adds:
```
UPDATE crypto_deposit_exceptions
   SET state='resolved', deposit_id=$credit_row, resolved_user_id=$owner, updated_at=now()
 WHERE provider=$1 AND provider_op_id=$2 AND state IN ('open','closed')
```
A legitimate credit always trumps a human close. Zero rows touched when there was no
exception, so the common settle path is byte-for-byte unchanged in cost. Duplicate settle
(at-least-once redelivery) re-runs the same idempotent update.

## 5. Read surface + admin API

Reuses the swap-review machinery in the `cryptosvc` admin plane (advisory lock,
idempotency-key regex, mandatory note, RBAC `crypto.admin`, `crypto_audit_log` via
`PGAuditor`) rather than re-implementing it in the legacy read plane.

- **`GET /admin/crypto/deposits/exceptions`** → `{success, exceptions, count}`.
  Filters: `state` (`open` default | `resolved` | `closed` | `all`), `kind`, `provider`,
  `limit`/`offset` (bounded). Order: `open` rows `last_seen_at ASC` (oldest stuck first), then
  `resolved`/`closed` newest-first. Unscoped read, RBAC-gated upstream.
- **`POST /admin/crypto/deposits/exceptions/:id/close`** → body `{note}` (required, non-empty),
  mandatory `Idempotency-Key` header. Service method `AdminCloseDepositException(actor,
  idemKey, id, note)`:
  - takes advisory lock `exception:<id>`;
  - `open → closed`, recording `closed_by='admin:<uid>'`, `closed_at`, `close_note`;
  - never moves money; a later settle still flips `closed → resolved` (§4.3);
  - audits action `crypto.deposit_exception.closed` with `old→new` state + the note;
  - errors mirror swap resolve: `not_found` 404, `already_resolved` 409 (a healthy settled
    row is not closeable — closing it is a no-op the UI shouldn't offer), `note_required` /
    `idempotency_key_required` / `bad_request` 400, double-close is an idempotent 200.
- **Reconciler tie-in** — `GET /admin/crypto/deposits/reconciler` adds
  `open_exceptions: { unmapped: N, rejected: M, oldest_age_seconds }` (one cheap grouped
  count) so "is money stuck?" and "why?" answer from a single view.
- **Admin UI** — extend the shipped Deposits tab with an **Exceptions** panel: open-count /
  oldest-age KPI, `kind` badges, `reason`, `amount_whole`+symbol, age, and a Close-with-note
  action that requires the note (client + server enforced). Reuses the swap-review table idiom.
- **Customer-facing: none.** Exceptions are `service_role`-only; a customer's mobile screen
  keeps showing "watching". We never tell a user their money hit an orphan (no owner to
  attribute, and it would leak internal custody state).

## 6. Error handling & edge cases

- **Reorg/failure after a credit:** surfaced as a reopened `open` exception holding the
  `deposit_id` link and a "reorg after credit — investigate" reason. The design does **not**
  reverse the credit; that is a separate money-state change beyond visibility-only. The
  exception is the escalation trigger, not the fix.
- **Race between a sweep settle and a concurrent observation:** the `UNIQUE(provider,
  provider_op_id)` guarantees one row; `ApplyCredit` resolves inside the credit transaction;
  a subsequent reject reopens it. No double-count, no lost update.
- **Duplicate observations** (N webhooks + N sweeps of one orphan) → one row, `seen_count=N`.
- **Recording failure** → swallowed + alerted, outcome unchanged (§4.2).
- **No new trusted-input path:** exceptions are write-once-from-provider-requery and read-only
  to ops; they never feed any credit decision, so the recipient-trust invariant is untouched.

## 7. Testing (TDD; mock provider + local Postgres; never live funds)

**Pure domain (in-mem store), DB-free**
- `RecordException` is called iff outcome ∈ {unmapped, rejected} and `err == nil`; never for
  awaiting/duplicate/settled; never on a resolver error.
- Upsert: `seen_count` bump + `last_seen_at` move; same-facts repeat on a `closed` row stays
  closed; changed kind/reason reopens; `resolved` row reopens with the reorg reason + keeps link.
- `ApplyCredit` flips `open`/`closed` → `resolved` and stamps `deposit_id`/`resolved_user_id`.

**Live-DB (`TEST_DATABASE_URL`), over the real migrated schema + mock provider**
1. unmapped (no `crypto_accounts` row) → `open` `kind=unmapped`, credits 0; insert mapping,
   re-sweep → settled once (holdings +exact amount), exception → `resolved` + linked, 2nd sweep
   moves nothing.
2. rejected (provider `failed` / non-positive) → `open` `kind=rejected`, no credit, no holdings row.
3. reorg-after-credit → settle first (credit), then a `reorged` observation reopens the
   exception; credit is NOT reversed.
4. duplicate observations (2 webhooks + 2 sweeps, same op) → exactly one exception row,
   `seen_count=4`.

**Admin handler (cryptosvc)**
- list filters + ordering; close requires idempotency-key + note; close writes
  `crypto_audit_log` (`crypto.deposit_exception.closed`, actor, old→new); closing a healthy
  `resolved` row → 409; double-close idempotent; reconciler status includes open counts;
  the payload never leaks provider secrets.

**frontend-admin**
- vitest: Exceptions panel renders rows + kind badges, Close requires a non-empty note and
  calls the service; tsc clean. (Browser/device run is NOT part of this slice's evidence.)

## 8. UAT / traceability impact

- Surfaces the "review unmapped / awaiting" acceptance of **GAP-DEP-01 / E2E-27** as a real,
  queryable queue with an acknowledged-close audit. Move E2E-27 from *Blocked* to **Partial**
  only against mock + local Postgres (live Quidax still unverified). It does **not** close the
  exception→*resolution* cases that would require manual crediting or reversal — those remain
  out of scope by design.
- `docs/uat/crypto/gap-backlog.md` Slice 3 note gets a follow-on: exception persistence
  delivered (visibility-only); address-ownership + manual credit + reversal remain open.

## 9. Rollout

- Ships as: additive migration + engine seam change + `cryptosvc` admin read/close + reconciler
  status field + frontend-admin panel, behind the existing `FEATURE_CRYPTO_SWAPS_ENABLED` +
  wired-deposit-settler gate (the engine only runs when the deposit settler is wired, so the
  exceptions table is only written when deposits are active).
- Backfill: none required — exceptions accumulate from the next observation of any still-open
  orphan; already-credited history stays only in `crypto_deposits`. (A one-off backfill from
  `webhook_events` is possible later if desired; not in scope.)
- Config: no new env var. `CRYPTO_DEPOSIT_CONFIRMATIONS` already governs the floor.
