# Crypto Deposit Exception Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist every inbound crypto transfer the settlement engine decides NOT to credit (`unmapped` / `rejected`) as one queryable, state-tracked exception row, keep it coherent with the auto-heal, and let a `crypto.admin` read and close-with-note it.

**Architecture:** The engine (`backend/internal/crypto/deposit`) stays the only writer: `Settler` records an exception whenever it decides a non-settlement, and `PGStore.ApplyCredit` flips that row to `resolved` inside the same credit transaction. A new additive table `crypto_deposit_exceptions` is a *descriptive side ledger* — it never feeds a credit decision. Reads and the operator close reuse the `cryptosvc` admin plane (advisory lock, idempotency-key regex, mandatory note, `crypto_audit_log`, RBAC `crypto.admin`), so `internal/app` wiring is untouched. `frontend-admin` gains an Exceptions panel on the shipped Deposits tab.

**Tech Stack:** Go 1.24 (gin, pgx/v5, shopspring/decimal), Supabase Postgres migrations, Next.js + TypeScript + vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-10-22-crypto-deposit-exception-queue-design.md` — read it before starting; this plan implements §3–§7 and the traceability move in §8.

## Global Constraints

- Money-IN invariants are **unchanged**: finality, once-only per `provider_op_id`, recipient resolved from `crypto_accounts` and never from the payload, strictly positive amounts. No task in this plan may move money, credit a balance, reverse a credit, or add a manual-credit path (spec §2 non-goals).
- Exception **recording is best-effort** (spec §4.2): a `RecordException` failure logs `[crypto][ALERT] …` and never changes the decided `Outcome` and never turns a 200 into a 5xx.
- A **dependency error** (`(Result, err)` from the resolver or the store) is a *retry*, not an exception — it is never recorded.
- `Awaiting` and `Duplicate` and `Settled` are never recorded as exceptions.
- Table is `service_role` RLS only. **No customer-facing policy, no customer-facing endpoint** (spec §5): an unmapped transfer has no owner to expose.
- The migration is additive and reversible and is applied **only** to the local dev database (`postgresql://postgres:postgres@127.0.0.1:54322/postgres`, container `supabase_db_spotlight`). Never run it against staging or production, never `supabase db reset`, never `DROP` anything that already exists.
- Verification gates (run from `backend/`): `go build ./...`, `go test -p 2 ./...`; live-DB tests need `TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"` and skip without it. From `frontend-admin/`: `npm run test` and `npm run type-check`. **ESLint is not runnable** in either package — do not add it.
- Copy rules for the admin UI: every money-relevant mutation requires a non-empty operator note, enforced client-side *and* server-side, with a derived `Idempotency-Key` from `src/services/idempotency.ts::operationKey`.
- Commit hygiene: stage only the files a task names, by explicit path, one commit per task, never push without a per-batch go-ahead from the partner.

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20271403000000_crypto_deposit_exceptions.sql` | *create* — the exception table, constraints, indexes, RLS |
| `backend/internal/crypto/deposit/exception.go` | *create* — `Exception`, `ExceptionKind`, the two `exceptionOf*` builders, `Settler.record` |
| `backend/internal/crypto/deposit/store.go` | *modify* — `Store` gains `RecordException` |
| `backend/internal/crypto/deposit/settler.go` | *modify* — `Settle`/`SettleDeposit` become thin wrappers over `decide`/`decideDeposit` + `record` |
| `backend/internal/crypto/deposit/pgxstore.go` | *modify* — `RecordException` upsert; auto-resolve inside `ApplyCredit` |
| `backend/internal/crypto/deposit/deposit_test.go` | *modify* — `memStore` records exceptions and models §4.1/§4.3 in memory |
| `backend/internal/crypto/deposit/exceptions_test.go` | *create* — DB-free recording-rule + upsert + flip tests |
| `backend/internal/crypto/deposit/exceptions_live_db_test.go` | *create* — schema guard and the four spec §7 live scenarios |
| `backend/internal/cryptosvc/exceptions.go` | *create* — `DepositException`, filter/counts/view types, the three `Service` methods, the two admin handlers (one feature file, the `fees.go` pattern) |
| `backend/internal/cryptosvc/store.go` | *modify* — `Store` gains 4 methods + 2 sentinel errors |
| `backend/internal/cryptosvc/pgxstore.go` | *modify* — `exceptionCols`, `scanException`, the four PG methods; adds `fmt`, `strconv`, `strings` imports |
| `backend/internal/cryptosvc/admin.go` | *modify* — 2 routes + `open_exceptions` on the deposit reconciler view |
| `backend/internal/cryptosvc/memstore_test.go` | *modify* — fake exception store |
| `backend/internal/cryptosvc/exceptions_service_test.go` | *create* — service-level close semantics (lock, audit, 404/409, idempotent) |
| `backend/internal/cryptosvc/exceptions_http_test.go` | *create* — handler/validation/counts/route-collision tests |
| `backend/internal/cryptosvc/exceptions_live_db_test.go` | *create* — `PGStore` read/filter/order/close over the real migrated schema |
| `frontend-admin/src/types/cryptoAdmin.ts` | *modify* — `CryptoDepositException`, `open_exceptions` |
| `frontend-admin/src/services/cryptoAdminService.ts` | *modify* — list + close fns |
| `frontend-admin/app/admin/crypto/deposits/ExceptionsPanel.tsx` | *create* — the queue table + close-with-note |
| `frontend-admin/app/admin/crypto/deposits/exceptions-panel.test.tsx` | *create* — vitest for the panel |
| `frontend-admin/app/admin/crypto/deposits/page.tsx` | *modify* — mount the panel, correct the DisclosureNote copy |
| `frontend-admin/app/admin/crypto/deposits/deposits.test.tsx` | *modify* — mock the two new service fns, update the copy assertion |
| `docs/uat/crypto/{gap-backlog,run-log,e2e-journeys-traceability}.…` | *modify* — traceability move (spec §8) |
| `docs/adr/ADR-<PR>-crypto-deposit-exception-queue.md` | *create* — the decision record |

---

## Task 1: Additive migration + schema guard

**Files:**
- Create: `supabase/migrations/20271403000000_crypto_deposit_exceptions.sql`
- Create: `backend/internal/crypto/deposit/exceptions_live_db_test.go` (schema-guard test only in this task)

**Interfaces:**
- Produces: table `public.crypto_deposit_exceptions` with `UNIQUE (provider, provider_op_id)`; every later task's SQL names these columns exactly: `id, provider, provider_account_id, provider_op_id, kind, reason, symbol, network, address, amount_whole, confirmations, required_confs, tx_hash, state, deposit_id, resolved_user_id, first_seen_at, last_seen_at, seen_count, closed_at, closed_by, close_note, created_at, updated_at`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20271403000000_crypto_deposit_exceptions.sql`. The timestamp sorts after `20271402000000_fx_ops_overview.sql` (the current max), so it applies last; the spec's `2027107xxxxxx` was illustrative. `amount_whole` is **text** on purpose: a rejected transfer may be non-positive or overflow minor units, and this column is descriptive only — it must never be coerced into something a credit path could read.

```sql
-- Crypto deposit exception queue (GAP-DEP-01 follow-on, spec 2026-10-22).
-- Additive only: a descriptive side ledger for inbound transfers the settlement engine
-- decided NOT to credit (unmapped orphan sub-account / rejected non-final or bad amount).
-- It never feeds a credit decision and never moves money; the money journal
-- (crypto_deposits) and the balance projection (crypto_holdings) are untouched.
--
-- Why not a column on crypto_deposits: that journal requires user_id NOT NULL and
-- units > 0, and its UNIQUE(provider_op_id) is the *credit* idempotency anchor. A row
-- there means "money moved"; these rows mean the opposite.
--
-- Idempotency anchor: UNIQUE (provider, provider_op_id) — one row per transfer, every
-- re-observation (webhook redelivery or reconciler sweep) is an upsert that bumps
-- last_seen_at and seen_count.
--
-- No FK on provider_account_id: an orphaned sub-account is exactly the case being
-- recorded. No FK on resolved_user_id either: an operator's acknowledgement of a closed
-- case must not be erased if that user row later disappears.

CREATE TABLE IF NOT EXISTS public.crypto_deposit_exceptions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider            text   NOT NULL,
  provider_account_id text   NOT NULL,
  provider_op_id      text   NOT NULL,
  kind                text   NOT NULL CHECK (kind IN ('unmapped','rejected')),
  reason              text   NOT NULL,
  symbol              text,
  network             text,
  address             text,
  amount_whole        text,
  confirmations       int    NOT NULL DEFAULT 0,
  required_confs      int    NOT NULL DEFAULT 0,
  tx_hash             text,
  state               text   NOT NULL DEFAULT 'open'
                        CHECK (state IN ('open','resolved','closed')),
  deposit_id          uuid,
  resolved_user_id    uuid,
  first_seen_at       timestamptz NOT NULL DEFAULT now(),
  last_seen_at        timestamptz NOT NULL DEFAULT now(),
  seen_count          int    NOT NULL DEFAULT 1 CHECK (seen_count > 0),
  closed_at           timestamptz,
  closed_by           text,
  close_note          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crypto_deposit_exceptions_provider_op
    UNIQUE (provider, provider_op_id)
);

-- Active queue oldest-first, and provider-filtered reads.
CREATE INDEX IF NOT EXISTS idx_cde_state_last_seen
  ON public.crypto_deposit_exceptions (state, last_seen_at);
CREATE INDEX IF NOT EXISTS idx_cde_provider_state
  ON public.crypto_deposit_exceptions (provider, state);

-- service_role writes (engine + reconciler), admin reads go through the Go layer under
-- crypto.admin. Deliberately NO owner policy: an unmapped transfer has no legitimate
-- owner to expose and a rejected one is not the user's money to see.
DO $$
BEGIN
  EXECUTE 'ALTER TABLE public.crypto_deposit_exceptions ENABLE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS crypto_deposit_exceptions_service ON public.crypto_deposit_exceptions';
  EXECUTE 'CREATE POLICY crypto_deposit_exceptions_service ON public.crypto_deposit_exceptions FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')';
END $$;

-- Reversible: DROP TABLE public.crypto_deposit_exceptions; (local dev database only).
```

- [ ] **Step 2: Apply it to the local dev database**

Run from the repo root (additive; never `supabase db reset`, never against staging/production):

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20271403000000_crypto_deposit_exceptions.sql
```

Expected: `CREATE TABLE`, `CREATE INDEX` ×2, `DO`, no errors. Re-running the file must also succeed (everything is `IF NOT EXISTS` / guarded by `DROP POLICY IF EXISTS`) — run it twice to prove it.

- [ ] **Step 3: Prove reversibility without destroying anything**

DDL is transactional in Postgres, so reversibility is proven by rolling a copy back rather than dropping anything:

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
DROP TABLE public.crypto_deposit_exceptions;
ROLLBACK;
SELECT to_regclass('public.crypto_deposit_exceptions') IS NOT NULL AS still_present;
SQL
```

Expected last row: `t`.

- [ ] **Step 4: Write the failing schema guard**

Create `backend/internal/crypto/deposit/exceptions_live_db_test.go`:

```go
package deposit

// Live-DB tests for the deposit exception queue (spec 2026-10-22 §3, §4.1, §4.3, §7).
// SKIPPED unless TEST_DATABASE_URL is set. The table is shared, so every test asserts on
// the delta its own uuid operation ids cause and never on global row counts.

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

// TestLive_ExceptionSchemaIsExactlyWhatTheEngineWrites guards the contract between the
// migration and the SQL in pgxstore.go: a renamed column or a loosened CHECK turns this
// red before any write path is built on top of it.
func TestLive_ExceptionSchemaIsExactlyWhatTheEngineWrites(t *testing.T) {
	pool := livePool(t)
	ctx := context.Background()

	var cols []string
	rows, err := pool.Query(ctx, `
		SELECT column_name FROM information_schema.columns
		 WHERE table_schema='public' AND table_name='crypto_deposit_exceptions'`)
	if err != nil {
		t.Fatalf("columns: %v", err)
	}
	for rows.Next() {
		var c string
		if err := rows.Scan(&c); err != nil {
			t.Fatal(err)
		}
		cols = append(cols, c)
	}
	rows.Close()
	want := []string{
		"id", "provider", "provider_account_id", "provider_op_id", "kind", "reason",
		"symbol", "network", "address", "amount_whole", "confirmations", "required_confs",
		"tx_hash", "state", "deposit_id", "resolved_user_id", "first_seen_at", "last_seen_at",
		"seen_count", "closed_at", "closed_by", "close_note", "created_at", "updated_at",
	}
	got := map[string]bool{}
	for _, c := range cols {
		got[c] = true
	}
	for _, c := range want {
		if !got[c] {
			t.Fatalf("column %q missing — migration not applied, or renamed", c)
		}
	}
	if len(cols) != len(want) {
		t.Fatalf("unexpected columns: have %d want %d (%v)", len(cols), len(want), cols)
	}

	// The unique anchor the whole idempotency story rests on.
	var uniq int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM pg_constraint
		 WHERE conrelid='public.crypto_deposit_exceptions'::regclass AND contype='u'
		   AND conname='crypto_deposit_exceptions_provider_op'`).Scan(&uniq); err != nil {
		t.Fatalf("unique constraint: %v", err)
	}
	if uniq != 1 {
		t.Fatal("UNIQUE (provider, provider_op_id) is missing")
	}

	// RLS on, and exactly one policy: service_role. No owner policy may ever appear.
	var rls bool
	if err := pool.QueryRow(ctx, `
		SELECT relrowsecurity FROM pg_class WHERE oid='public.crypto_deposit_exceptions'::regclass`).Scan(&rls); err != nil {
		t.Fatalf("rls: %v", err)
	}
	if !rls {
		t.Fatal("crypto_deposit_exceptions must have RLS enabled")
	}
	var policies []string
	prows, err := pool.Query(ctx, `SELECT polname FROM pg_policy WHERE polrelid='public.crypto_deposit_exceptions'::regclass`)
	if err != nil {
		t.Fatalf("policies: %v", err)
	}
	for prows.Next() {
		var p string
		if err := prows.Scan(&p); err != nil {
			t.Fatal(err)
		}
		policies = append(policies, p)
	}
	prows.Close()
	if len(policies) != 1 || policies[0] != "crypto_deposit_exceptions_service" {
		t.Fatalf("expected exactly the service_role policy, got %v — a customer-facing policy on this table leaks custody state", policies)
	}
}

func TestLive_ExceptionKindAndStateChecksRejectGarbage(t *testing.T) {
	pool := livePool(t)
	ctx := context.Background()

	ins := func(kind, state string) error {
		_, err := pool.Exec(ctx, `
			INSERT INTO crypto_deposit_exceptions
				(provider, provider_account_id, provider_op_id, kind, reason, state)
			VALUES ('quidax', $1, $2, $3, 'seed', $4)`,
			"acct-"+uuid.NewString(), uuid.NewString(), kind, state)
		return err
	}
	if err := ins("unmapped", "open"); err != nil {
		t.Fatalf("a valid row must insert: %v", err)
	}
	if err := ins("credited", "open"); err == nil {
		t.Fatal("kind='credited' must be rejected by the CHECK")
	}
	if err := ins("unmapped", "pending"); err == nil {
		t.Fatal("state='pending' must be rejected by the CHECK")
	}
}
```

- [ ] **Step 5: Run the guard**

```bash
cd backend
TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  go test -p 2 -run 'TestLive_Exception' -v ./internal/crypto/deposit/
```

Expected: both PASS (Step 2 applied the migration; if you skipped it, the first test fails with `column … missing` — that is the point).

- [ ] **Step 6: Full gate, then commit**

```bash
cd backend && go build ./... && go test -p 2 ./... | tail -20
```

Expected: `ok` for every package, no FAIL.

```bash
git add supabase/migrations/20271403000000_crypto_deposit_exceptions.sql \
        backend/internal/crypto/deposit/exceptions_live_db_test.go
git commit -m "feat(crypto): additive crypto_deposit_exceptions table with service-role RLS"
```

---

## Task 2: The recording rule — engine persists what it refused to credit

**Files:**
- Create: `backend/internal/crypto/deposit/exception.go`
- Modify: `backend/internal/crypto/deposit/store.go` (interface + 1 method)
- Modify: `backend/internal/crypto/deposit/settler.go` (`Settle`/`SettleDeposit` → wrappers)
- Modify: `backend/internal/crypto/deposit/deposit_test.go` (`memStore` fake)
- Create: `backend/internal/crypto/deposit/exceptions_test.go`

**Interfaces:**
- Consumes: `Outcome`, `Result`, `Credit`, `Apply` (existing); `cryptoprov.Deposit` fields `ID, AccountID, Currency, Network, Address, Amount, Confirmations, Status, TxHash`.
- Produces: `Exception`, `ExceptionKind`, `ExceptionUnmapped`, `ExceptionRejected`, `exceptionOfCredit(Credit) Exception`, `exceptionOfDeposit(string, cryptoprov.Deposit) Exception`, `(*Settler).record(context.Context, Exception, Result, error)`, and `Store.RecordException(ctx context.Context, e Exception) error`. Task 3 implements `PGStore.RecordException`; nothing reads the table yet.

- [ ] **Step 1: Write the failing tests**

Create `backend/internal/crypto/deposit/exceptions_test.go`:

```go
package deposit

// DB-free tests for the exception recording rule (spec §4, §4.2, §7 first block): the
// engine persists exactly the transfers it *decided* not to credit, and a recording
// failure never changes the decided outcome.

import (
	"context"
	"errors"
	"testing"

	"github.com/shopspring/decimal"

	"spotlight/backend/internal/cryptoprov"
)

func ownerBTC(confs int) Owner {
	return Owner{UserID: "usr-1", AssetID: "ast-btc", MinorUnitScale: 100_000_000, RequiredConfs: confs}
}

func rig(owners map[string]Owner, storeErr error) (*Settler, *memStore) {
	m := newMemStore()
	m.recordErr = storeErr
	return NewSettler(resolverWith(owners), m), m
}

func TestRecordedOnlyForUnmappedAndRejectedDecisions(t *testing.T) {
	ctx := context.Background()
	acct := "acct-known"
	owners := map[string]Owner{acct: ownerBTC(3)}

	type case_ struct {
		name   string
		credit Credit
		want   bool
		kind   ExceptionKind
	}
	orphan := Credit{Provider: "quidax", ProviderAccountID: "acct-orphan", ProviderOpID: "op-orphan",
		Symbol: "BTC", Network: "bitcoin", Units: 1, Confirmations: 9, Status: StatusConfirmed}
	awaiting := Credit{Provider: "quidax", ProviderAccountID: acct, ProviderOpID: "op-wait",
		Symbol: "BTC", Network: "bitcoin", Units: 1, Confirmations: 1, Status: StatusConfirmed}
	nonFinal := Credit{Provider: "quidax", ProviderAccountID: acct, ProviderOpID: "op-reorg",
		Symbol: "BTC", Network: "bitcoin", Units: 1, Confirmations: 9, Status: StatusReorged}
	badAmount := Credit{Provider: "quidax", ProviderAccountID: acct, ProviderOpID: "op-zero",
		Symbol: "BTC", Network: "bitcoin", Units: 0, Confirmations: 9, Status: StatusConfirmed}
	settled := Credit{Provider: "quidax", ProviderAccountID: acct, ProviderOpID: "op-ok",
		Symbol: "BTC", Network: "bitcoin", Units: 500_000, Confirmations: 9, Status: StatusConfirmed}

	for _, c := range []case_{
		{"orphan", orphan, true, ExceptionUnmapped},
		{"non-final", nonFinal, true, ExceptionRejected},
		{"zero amount", badAmount, true, ExceptionRejected},
		{"awaiting", awaiting, false, ""},
		{"settled", settled, false, ""},
	} {
		s, m := rig(owners, nil)
		res, err := s.Settle(ctx, c.credit)
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		got := m.recorded()
		if c.want && len(got) != 1 {
			t.Fatalf("%s: recorded=%d want exactly 1 (outcome=%s)", c.name, len(got), res.Outcome)
		}
		if !c.want && len(got) != 0 {
			t.Fatalf("%s: recorded=%d want 0 (outcome=%s)", c.name, len(got), res.Outcome)
		}
		if !c.want {
			continue
		}
		e := got[0]
		if e.Kind != c.kind || e.Reason != res.Reason || e.ProviderOpID != c.credit.ProviderOpID {
			t.Fatalf("%s: exception = %+v, want kind=%s reason=%q", c.name, e, c.kind, res.Reason)
		}
	}
}

func TestResolverErrorIsRetryNotException(t *testing.T) {
	m := newMemStore()
	s := NewSettler(fakeResolver{err: errors.New("db down")}, m)
	c := Credit{Provider: "quidax", ProviderAccountID: "a", ProviderOpID: "op-x",
		Symbol: "BTC", Units: 1, Confirmations: 9, Status: StatusConfirmed}
	if _, err := s.Settle(context.Background(), c); err == nil {
		t.Fatal("a resolver failure must surface as an error (retry)")
	}
	if len(m.recorded()) != 0 {
		t.Fatal("a dependency error must NOT be recorded — it would flood the queue with transient noise")
	}
}

func TestRecordingFailureNeverChangesTheOutcome(t *testing.T) {
	boom := errors.New("exception table unreachable")
	s, m := rig(map[string]Owner{"acct-orphan": ownerBTC(1)}, boom)
	c := Credit{Provider: "quidax", ProviderAccountID: "acct-orphan", ProviderOpID: "op-y",
		Symbol: "BTC", Units: 1, Confirmations: 9, Status: StatusConfirmed}
	res, err := s.Settle(context.Background(), c)
	if err != nil {
		t.Fatalf("a recording failure must not become an error: %v", err)
	}
	if res.Outcome != OutcomeUnmapped {
		t.Fatalf("outcome = %s, want unmapped", res.Outcome)
	}
	if m.recordFailures != 1 {
		t.Fatalf("failed-record attempts = %d, want 1 (the call was made and swallowed, not propagated)", m.recordFailures)
	}
}

func TestSettleDepositRecordsProviderWholeUnitAmount(t *testing.T) {
	s, m := rig(map[string]Owner{}, nil)
	d := cryptoprov.Deposit{
		ID: "op-z", AccountID: "acct-orphan", Currency: "BTC", Network: "bitcoin",
		Address: "bc1q", Amount: decimal.RequireFromString("0.001"),
		Confirmations: 9, Status: cryptoprov.DepositConfirmed, TxHash: "0xdead",
	}
	res, err := s.SettleDeposit(context.Background(), "quidax", d)
	if err != nil || res.Outcome != OutcomeUnmapped {
		t.Fatalf("outcome=%s err=%v", res.Outcome, err)
	}
	got := m.recorded()
	if len(got) != 1 {
		t.Fatalf("recorded=%d want 1", len(got))
	}
	e := got[0]
	// The amount comes from the provider re-query, never from a webhook payload.
	if e.AmountWhole != "0.001" || e.Provider != "quidax" || e.ProviderOpID != "op-z" ||
		e.TxHash != "0xdead" || e.Confirmations != 9 || e.RequiredConfs != 0 {
		t.Fatalf("exception = %+v", e)
	}
}
```

Note on `e.RequiredConfs != 0`: the confirmation policy is only consulted once an owner resolves, and a recorded exception is by definition a transfer that never got that far — so `required_confs` is the spec's "0 if unknown" case. That is deliberate, not a gap.

- [ ] **Step 2: Extend the fake store so the tests compile against the new rule**

In `deposit_test.go`, add the fields and methods to `memStore` (keep everything already there):

```go
type memStore struct {
	mu       sync.Mutex
	applied  map[string]bool
	user     map[[2]string]int64 // {userID, assetID} -> units
	custody  map[string]int64    // assetID -> units held in custody
	applyErr error
	// recordErr makes RecordException fail, to prove the money path is unaffected.
	recordErr error
	// recordFailures counts the swallowed RecordException errors.
	recordFailures int
	// exc is the in-memory stand-in for crypto_deposit_exceptions, keyed
	// provider + "\x00" + provider_op_id — the same anchor the table uses.
	exc map[string]*excRow
}

type excRow struct {
	e         Exception
	state     string
	seen      int
	depositID string
	resolved  string
}

func (m *memStore) RecordException(_ context.Context, e Exception) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.recordErr != nil {
		m.recordFailures++
		return m.recordErr
	}
	if m.exc == nil {
		m.exc = map[string]*excRow{}
	}
	// Task 2 only needs the recording rule; Task 3 replaces this with the §4.1 upsert.
	key := e.Provider + "\x00" + e.ProviderOpID
	if _, ok := m.exc[key]; ok {
		return nil
	}
	m.exc[key] = &excRow{e: e, state: "open", seen: 1}
	return nil
}

func (m *memStore) recorded() []Exception {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []Exception
	for _, r := range m.exc {
		out = append(out, r.e)
	}
	return out
}
```

Also update `newMemStore()` to initialise `exc: map[string]*excRow{}`.

- [ ] **Step 3: Write the exception type**

Create `backend/internal/crypto/deposit/exception.go`:

```go
package deposit

import (
	"context"
	"log"

	"spotlight/backend/internal/cryptoprov"
)

// ExceptionKind is which class of non-credit decision produced an exception. Only these
// two classes are ever persisted: Awaiting self-heals and is noise, and a dependency
// error is a retry rather than a decision (spec §4).
type ExceptionKind string

const (
	ExceptionUnmapped ExceptionKind = "unmapped" // no crypto_accounts owner for the sub-account
	ExceptionRejected ExceptionKind = "rejected" // non-final, non-positive, or unrepresentable amount
)

// Exception is one transfer the engine decided NOT to credit, as it is persisted to
// crypto_deposit_exceptions. It is a descriptive side ledger: nothing reads it to decide
// a credit, so it cannot influence money. AmountWhole is the provider's whole-unit decimal
// as text (never minor units) because a rejected transfer may carry an amount that has no
// valid minor-unit form — which is exactly why it was rejected.
type Exception struct {
	Provider          string
	ProviderAccountID string
	ProviderOpID      string
	Kind              ExceptionKind
	Reason            string
	Symbol            string
	Network           string
	Address           string
	AmountWhole       string
	Confirmations     int
	RequiredConfs     int
	TxHash            string
}

// exceptionOfCredit builds the record from a Credit. AmountWhole is empty: a Credit
// carries integer minor units whose scale is only known once an owner and an asset row
// resolve — and "unmapped" is precisely the decision where they do not.
func exceptionOfCredit(c Credit) Exception {
	return Exception{
		Provider:          c.Provider,
		ProviderAccountID: c.ProviderAccountID,
		ProviderOpID:      c.ProviderOpID,
		Symbol:            c.Symbol,
		Network:           c.Network,
		Address:           c.Address,
		Confirmations:     c.Confirmations,
		TxHash:            c.TxHash,
	}
}

// exceptionOfDeposit builds the record from the provider re-query. The amount is the
// authoritative decimal the provider reported, not anything a webhook claimed.
func exceptionOfDeposit(provider string, d cryptoprov.Deposit) Exception {
	return Exception{
		Provider:          provider,
		ProviderAccountID: d.AccountID,
		ProviderOpID:      d.ID,
		Symbol:            d.Currency,
		Network:           d.Network,
		Address:           d.Address,
		AmountWhole:       d.Amount.String(),
		Confirmations:     d.Confirmations,
		TxHash:            d.TxHash,
	}
}

// record persists a decided non-settlement. It is best-effort by design (spec §4.2): a
// failure must not turn a 200 into a 5xx redelivery storm, must not stall a reconciler
// pass, and must never change the outcome already decided — the next sweep covers it.
func (s *Settler) record(ctx context.Context, e Exception, res Result, err error) {
	if err != nil {
		return // a dependency failure is a retry, not a decision
	}
	switch res.Outcome {
	case OutcomeUnmapped:
		e.Kind = ExceptionUnmapped
	case OutcomeRejected:
		e.Kind = ExceptionRejected
	default:
		return // settled / duplicate / awaiting are not exceptions
	}
	e.Reason = res.Reason
	if rerr := s.store.RecordException(ctx, e); rerr != nil {
		log.Printf("[crypto][ALERT] deposit exception record failed provider=%s op=%s kind=%s err=%v",
			e.Provider, e.ProviderOpID, e.Kind, rerr)
	}
}
```

- [ ] **Step 4: Widen the Store seam and wrap the two entry points**

In `store.go`, append to the interface (the doc-comment already says the Store is the persistence seam):

```go
	// RecordException upserts one non-credit decision (spec §4.1). It is safe to call
	// repeatedly for the same (Provider, ProviderOpID): the row count never exceeds one and
	// seen_count/last_seen_at move. Implementations must not be relied on to be
	// transactional with ApplyCredit — recording is best-effort (§4.2).
	RecordException(ctx context.Context, e Exception) error
```

In `settler.go`, rename the two exported bodies to unexported decision functions and add thin wrappers, so every caller (webhook bridge, deposit reconciler) gets exception recording without any change of its own:

```go
// Settle classifies and (when appropriate) applies c. … (keep the existing doc comment)
func (s *Settler) Settle(ctx context.Context, c Credit) (Result, error) {
	res, err := s.decide(ctx, c)
	s.record(ctx, exceptionOfCredit(c), res, err)
	return res, err
}

func (s *Settler) decide(ctx context.Context, c Credit) (Result, error) {
	// … the previous body of Settle, unchanged (settler.go:39-65)
}

// SettleDeposit is the provider-deposit entry point: … (keep the existing doc comment)
func (s *Settler) SettleDeposit(ctx context.Context, provider string, d cryptoprov.Deposit) (Result, error) {
	res, err := s.decideDeposit(ctx, provider, d)
	s.record(ctx, exceptionOfDeposit(provider, d), res, err)
	return res, err
}

func (s *Settler) decideDeposit(ctx context.Context, provider string, d cryptoprov.Deposit) (Result, error) {
	// … the previous body of SettleDeposit, unchanged (settler.go:73-107)
}
```

Do not change `checkAndApply`, `mapProviderStatus` or `toMinorUnits`. No production wiring changes: `internal/app/crypto_deposit_bridge.go:27` already constructs `deposit.NewPGStore(pool)`, which will satisfy the widened interface in Task 3.

- [ ] **Step 5: Run the tests**

```bash
cd backend && go test -p 2 -run 'TestRecorded|TestResolverError|TestRecordingFailure|TestSettleDepositRecords' -v ./internal/crypto/deposit/
```

Expected: all PASS. Then the whole package, which proves the rename broke nothing:

```bash
cd backend && go test -p 2 ./internal/crypto/deposit/ ./internal/cryptosvc/
```

Expected: `ok` both.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/crypto/deposit/exception.go backend/internal/crypto/deposit/store.go \
        backend/internal/crypto/deposit/settler.go backend/internal/crypto/deposit/deposit_test.go \
        backend/internal/crypto/deposit/exceptions_test.go
git commit -m "feat(crypto): deposit engine records refused credits as exceptions"
```

## Task 3: Upsert semantics — one row per transfer, observations counted

**Files:**
- Modify: `backend/internal/crypto/deposit/pgxstore.go` (add `RecordException`)
- Modify: `backend/internal/crypto/deposit/deposit_test.go` (`memStore` becomes the §4.1 state machine)
- Modify: `backend/internal/crypto/deposit/exceptions_test.go` (upsert rules)
- Modify: `backend/internal/crypto/deposit/exceptions_live_db_test.go` (reopen rules + §7 scenarios 2 and 4)

**Interfaces:**
- Consumes: `Exception` (Task 2), table columns (Task 1).
- Produces: `(*deposit.PGStore).RecordException(ctx, Exception) error` — the concrete §4.1 upsert; `(*memStore).view(provider, op string) (ExcView, bool)` and `(*memStore).mark(provider, op, state, depositID, closedBy string)` for DB-free assertions. Task 4 adds the `resolved` flip; Task 5's admin read only consumes the table.

- [ ] **Step 1: Write the failing DB-free upsert tests**

Append to `backend/internal/crypto/deposit/exceptions_test.go`:

```go
func excOf(op string, kind ExceptionKind, reason string) Exception {
	return Exception{
		Provider: "quidax", ProviderAccountID: "acct-1", ProviderOpID: op,
		Kind: kind, Reason: reason, Symbol: "BTC", Network: "bitcoin",
		Address: "bc1q", AmountWhole: "0.001", Confirmations: 9,
	}
}

func TestUpsertKeepsOneRowAndCountsObservations(t *testing.T) {
	ctx := context.Background()
	m := newMemStore()
	for i := 0; i < 4; i++ {
		if err := m.RecordException(ctx, excOf("op-1", ExceptionUnmapped, "no owner for provider sub-account acct-1")); err != nil {
			t.Fatal(err)
		}
	}
	v, ok := m.view("quidax", "op-1")
	if !ok {
		t.Fatal("no row")
	}
	if v.Seen != 4 || v.State != "open" {
		t.Fatalf("seen=%d state=%s, want 4/open", v.Seen, v.State)
	}
}

func TestUpsertRefreshesFactsAndKeepsNullableHistory(t *testing.T) {
	ctx := context.Background()
	m := newMemStore()
	first := excOf("op-2", ExceptionUnmapped, "no owner")
	first.AmountWhole = "0.001"
	if err := m.RecordException(ctx, first); err != nil {
		t.Fatal(err)
	}
	second := excOf("op-2", ExceptionRejected, "transfer is not final (failed)")
	second.AmountWhole = "" // the Credit path has no whole-unit figure (Task 2)
	if err := m.RecordException(ctx, second); err != nil {
		t.Fatal(err)
	}
	v, _ := m.view("quidax", "op-2")
	if v.E.Kind != ExceptionRejected || v.E.Reason != "transfer is not final (failed)" {
		t.Fatalf("kind/reason not refreshed: %+v", v.E)
	}
	if v.E.AmountWhole != "0.001" {
		t.Fatalf("an empty new amount must not erase the amount we already knew: %q", v.E.AmountWhole)
	}
}

func TestUpsertClosedRowStaysClosedOnTheSameFacts(t *testing.T) {
	ctx := context.Background()
	m := newMemStore()
	e := excOf("op-3", ExceptionUnmapped, "no owner")
	if err := m.RecordException(ctx, e); err != nil {
		t.Fatal(err)
	}
	m.mark("quidax", "op-3", "closed", "", "admin:op")
	if err := m.RecordException(ctx, e); err != nil {
		t.Fatal(err)
	}
	v, _ := m.view("quidax", "op-3")
	if v.State != "closed" || v.Seen != 2 {
		t.Fatalf("state=%s seen=%d, want closed/2 — an operator acknowledged this case", v.State, v.Seen)
	}
	if v.ClosedBy != "admin:op" {
		t.Fatal("the acknowledgement must survive a bare repeat")
	}
}

func TestUpsertClosedRowReopensWhenTheFactsChange(t *testing.T) {
	ctx := context.Background()
	m := newMemStore()
	if err := m.RecordException(ctx, excOf("op-4", ExceptionUnmapped, "no owner")); err != nil {
		t.Fatal(err)
	}
	m.mark("quidax", "op-4", "closed", "", "admin:op")
	if err := m.RecordException(ctx, excOf("op-4", ExceptionRejected, "transfer is not final (failed)")); err != nil {
		t.Fatal(err)
	}
	v, _ := m.view("quidax", "op-4")
	if v.State != "open" || v.ClosedBy != "" {
		t.Fatalf("state=%s closed_by=%q, want open/\"\" — a materially different observation is a new problem", v.State, v.ClosedBy)
	}
}

func TestUpsertResolvedRowReopensWithTheInvestigateReason(t *testing.T) {
	ctx := context.Background()
	m := newMemStore()
	if err := m.RecordException(ctx, excOf("op-5", ExceptionUnmapped, "no owner")); err != nil {
		t.Fatal(err)
	}
	m.mark("quidax", "op-5", "resolved", "dep-99", "usr-1")
	if err := m.RecordException(ctx, excOf("op-5", ExceptionRejected, "transfer is not final (reorged)")); err != nil {
		t.Fatal(err)
	}
	v, _ := m.view("quidax", "op-5")
	if v.State != "open" {
		t.Fatalf("state=%s want open", v.State)
	}
	if v.E.Reason != "no owner — reorg/reject after credit — investigate" {
		t.Fatalf("reason=%q", v.E.Reason)
	}
	if v.DepositID != "dep-99" {
		t.Fatal("the credit link is what makes this actionable — it must be kept")
	}
}
```

- [ ] **Step 2: Make the fake implement §4.1 literally**

Replace the Task 2 placeholder body of `memStore.RecordException` in `deposit_test.go` with the same decision table the SQL will use, and add the two accessors:

```go
// ExcView is the test-facing projection of a fake crypto_deposit_exceptions row.
type ExcView struct {
	E         Exception
	State     string
	Seen      int
	DepositID string
	ClosedBy  string
}

func (m *memStore) RecordException(_ context.Context, e Exception) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.recordErr != nil {
		m.recordFailures++
		return m.recordErr
	}
	if m.exc == nil {
		m.exc = map[string]*excRow{}
	}
	key := e.Provider + "\x00" + e.ProviderOpID
	cur, ok := m.exc[key]
	if !ok {
		m.exc[key] = &excRow{e: e, state: "open", seen: 1}
		return nil
	}
	reopen := cur.state == "resolved" ||
		(cur.state == "closed" && (e.Kind != cur.e.Kind || e.Reason != cur.e.Reason))
	if cur.state == "resolved" {
		e.Reason = cur.e.Reason + " — reorg/reject after credit — investigate"
	}
	keep := func(old, newer string) string {
		if newer == "" {
			return old
		}
		return newer
	}
	e.AmountWhole = keep(cur.e.AmountWhole, e.AmountWhole)
	e.Symbol = keep(cur.e.Symbol, e.Symbol)
	e.Network = keep(cur.e.Network, e.Network)
	e.Address = keep(cur.e.Address, e.Address)
	e.TxHash = keep(cur.e.TxHash, e.TxHash)
	cur.e = e
	if reopen {
		cur.state = "open"
		cur.closedBy = ""
	}
	cur.seen++
	return nil
}

func (m *memStore) view(provider, op string) (ExcView, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.exc[provider+"\x00"+op]
	if !ok {
		return ExcView{}, false
	}
	return ExcView{E: r.e, State: r.state, Seen: r.seen, DepositID: r.depositID, ClosedBy: r.closedBy}, true
}

// mark stands in for the writers this task cannot reach yet: ApplyCredit sets resolved
// (Task 4) and the admin endpoint sets closed (Task 6).
func (m *memStore) mark(provider, op, state, depositID, closedBy string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if r, ok := m.exc[provider+"\x00"+op]; ok {
		r.state, r.depositID, r.closedBy = state, depositID, closedBy
	}
}
```

Add `closedBy string` to the `excRow` struct (it already has `depositID` and `resolved`).

- [ ] **Step 3: Implement the SQL upsert**

Append to `backend/internal/crypto/deposit/pgxstore.go`. The reopen predicate appears four times, so it is named once in Go rather than repeated four times in SQL:

```go
// reopenWhenChanged is spec §4.1's rule: a resolved transfer that is observed again is a
// reorg/reject AFTER the credit (escalate it), and a closed one only reopens when the new
// observation says something materially different — a bare repeat must not undo an
// operator's acknowledgement.
const reopenWhenChanged = `ex.state = 'resolved'
	OR (ex.state = 'closed' AND (EXCLUDED.kind IS DISTINCT FROM ex.kind
	                             OR EXCLUDED.reason IS DISTINCT FROM ex.reason))`

// RecordException upserts one non-credit decision (§4.1). One statement, so it is atomic
// against a concurrent webhook + reconciler observation of the same transfer: UNIQUE
// (provider, provider_op_id) makes the second writer take the DO UPDATE branch.
//
// The insert-side deposit_id subquery covers the transfer that was credited BEFORE this
// table existed and then reports a terminal failure: there is no exception row yet, so the
// insert must still carry the credit link, or the escalation would look like an orphan.
func (s *PGStore) RecordException(ctx context.Context, e Exception) error {
	q := fmt.Sprintf(`
		INSERT INTO public.crypto_deposit_exceptions AS ex
			(provider, provider_account_id, provider_op_id, kind, reason,
			 symbol, network, address, amount_whole, confirmations, required_confs, tx_hash, deposit_id)
		VALUES ($1,$2,$3,$4,$5,NULLIF($6,''),NULLIF($7,''),NULLIF($8,''),NULLIF($9,''),$10,$11,NULLIF($12,''),
			(SELECT d.id FROM public.crypto_deposits d
			  WHERE d.provider = $1 AND d.provider_op_id = $3))
		ON CONFLICT (provider, provider_op_id) DO UPDATE SET
			provider_account_id = EXCLUDED.provider_account_id,
			kind                = EXCLUDED.kind,
			reason              = CASE WHEN ex.state = 'resolved'
			                           THEN ex.reason || ' — reorg/reject after credit — investigate'
			                           ELSE EXCLUDED.reason END,
			symbol              = COALESCE(EXCLUDED.symbol, ex.symbol),
			network             = COALESCE(EXCLUDED.network, ex.network),
			address             = COALESCE(EXCLUDED.address, ex.address),
			amount_whole        = COALESCE(EXCLUDED.amount_whole, ex.amount_whole),
			tx_hash             = COALESCE(EXCLUDED.tx_hash, ex.tx_hash),
			confirmations       = EXCLUDED.confirmations,
			required_confs      = EXCLUDED.required_confs,
			state               = CASE WHEN %[1]s THEN 'open' ELSE ex.state END,
			closed_at           = CASE WHEN %[1]s THEN NULL ELSE ex.closed_at END,
			closed_by           = CASE WHEN %[1]s THEN NULL ELSE ex.closed_by END,
			close_note          = CASE WHEN %[1]s THEN NULL ELSE ex.close_note END,
			deposit_id          = COALESCE(ex.deposit_id, EXCLUDED.deposit_id),
			resolved_user_id    = ex.resolved_user_id,
			last_seen_at        = now(),
			seen_count          = ex.seen_count + 1,
			updated_at          = now()`, reopenWhenChanged)

	_, err := s.pool.Exec(ctx, q,
		e.Provider, e.ProviderAccountID, e.ProviderOpID, string(e.Kind), e.Reason,
		e.Symbol, e.Network, e.Address, e.AmountWhole,
		e.Confirmations, e.RequiredConfs, e.TxHash)
	if err != nil {
		return fmt.Errorf("deposit: record exception: %w", err)
	}
	return nil
}
```

`fmt` is already imported there. Note `required_confs = EXCLUDED.required_confs` follows §4.1's "refresh" wording; the engine always records 0 (the policy is only consulted once an owner resolves), so nothing meaningful is overwritten.

- [ ] **Step 4: Run the DB-free rules**

```bash
cd backend && go test -p 2 -run 'TestUpsert' -v ./internal/crypto/deposit/
```

Expected: all PASS.

- [ ] **Step 5: Write the failing live tests**

Append to `backend/internal/crypto/deposit/exceptions_live_db_test.go`:

```go
func excState(t *testing.T, pool *pgxpool.Pool, op string) (kind, state, reason string, seen int, depositID *string) {
	t.Helper()
	err := pool.QueryRow(context.Background(), `
		SELECT kind, state, reason, seen_count, deposit_id
		  FROM public.crypto_deposit_exceptions
		 WHERE provider='quidax' AND provider_op_id=$1`, op).Scan(&kind, &state, &reason, &seen, &depositID)
	if err != nil {
		t.Fatalf("read exception %s: %v", op, err)
	}
	return
}

func depositCount(t *testing.T, pool *pgxpool.Pool, op string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM public.crypto_deposits WHERE provider='quidax' AND provider_op_id=$1`, op).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// TestLive_DuplicateObservationsMakeOneExceptionRow is spec §7 scenario 4: N deliveries of
// one orphan collapse to one row with seen_count = N, and nobody is credited.
func TestLive_DuplicateObservationsMakeOneExceptionRow(t *testing.T) {
	pool := livePool(t)
	ctx := context.Background()
	acct := "acct-orphan-" + uuid.NewString()
	op := uuid.NewString()
	s := newSettler(pool, 2)

	for i := 0; i < 4; i++ {
		if res, err := s.Settle(ctx, credit(acct, op, 250_000, 3)); err != nil || res.Outcome != OutcomeUnmapped {
			t.Fatalf("observation %d: outcome=%s err=%v", i, res.Outcome, err)
		}
	}
	var rows, seen int
	if err := pool.QueryRow(ctx, `
		SELECT count(*), COALESCE(max(seen_count),0) FROM public.crypto_deposit_exceptions
		 WHERE provider='quidax' AND provider_op_id=$1`, op).Scan(&rows, &seen); err != nil {
		t.Fatal(err)
	}
	if rows != 1 || seen != 4 {
		t.Fatalf("rows=%d seen=%d, want exactly 1 row with seen_count=4", rows, seen)
	}
	if n := depositCount(t, pool, op); n != 0 {
		t.Fatalf("an orphan made %d credit rows", n)
	}
}

// TestLive_RejectedTransferIsRecordedAndCreditsNobody is spec §7 scenario 2.
func TestLive_RejectedTransferIsRecordedAndCreditsNobody(t *testing.T) {
	pool := livePool(t)
	ctx := context.Background()
	_, acct := seedUser(t, pool, "quidax")
	op := uuid.NewString()
	s := newSettler(pool, 2)

	c := credit(acct, op, 500_000, 3)
	c.Status = StatusFailed
	if res, err := s.Settle(ctx, c); err != nil || res.Outcome != OutcomeRejected {
		t.Fatalf("outcome=%s err=%v", res.Outcome, err)
	}
	kind, state, reason, _, _ := excState(t, pool, op)
	if kind != "rejected" || state != "open" {
		t.Fatalf("kind=%s state=%s want rejected/open", kind, state)
	}
	if !strings.Contains(reason, "not final") {
		t.Fatalf("reason=%q must carry the engine's own words", reason)
	}
	if n := depositCount(t, pool, op); n != 0 {
		t.Fatal("a rejected transfer must never reach the money journal")
	}
}

// TestLive_ReopenRulesAreExactlyTheDecisionTable drives the three §4.1 branches that the
// engine cannot reach on its own by setting the state the way ApplyCredit / the admin
// endpoint would, then re-observing.
func TestLive_ReopenRulesAreExactlyTheDecisionTable(t *testing.T) {
	pool := livePool(t)
	ctx := context.Background()
	s := newSettler(pool, 2)
	base := Exception{
		Provider: "quidax", ProviderAccountID: "acct-reopen", ProviderOpID: uuid.NewString(),
		Kind: ExceptionUnmapped, Reason: "no owner", Symbol: "BTC", Network: "bitcoin",
		AmountWhole: "0.002", Confirmations: 9,
	}

	if err := s.store.RecordException(ctx, base); err != nil {
		t.Fatal(err)
	}

	// (a) closed + same facts -> still closed, counted.
	if _, err := pool.Exec(ctx, `UPDATE public.crypto_deposit_exceptions SET state='closed', closed_by='admin:op', close_note='seen', closed_at=now()
		  WHERE provider=$1 AND provider_op_id=$2`, base.Provider, base.ProviderOpID); err != nil {
		t.Fatal(err)
	}
	if err := s.store.RecordException(ctx, base); err != nil {
		t.Fatal(err)
	}
	if _, state, _, seen, _ := excState(t, pool, base.ProviderOpID); state != "closed" || seen != 2 {
		t.Fatalf("state=%s seen=%d want closed/2", state, seen)
	}

	// (b) closed + a different reason -> reopened, acknowledgement cleared.
	changed := base
	changed.Kind, changed.Reason = ExceptionRejected, "transfer is not final (reorged)"
	if err := s.store.RecordException(ctx, changed); err != nil {
		t.Fatal(err)
	}
	var closedBy string
	if err := pool.QueryRow(ctx, `SELECT closed_by FROM public.crypto_deposit_exceptions WHERE provider=$1 AND provider_op_id=$2`,
		base.Provider, base.ProviderOpID).Scan(&closedBy); err != nil {
		t.Fatal(err)
	}
	if _, state, reason, _, _ := excState(t, pool, base.ProviderOpID); state != "open" || reason != changed.Reason {
		t.Fatalf("state=%s reason=%q want open/%q", state, reason, changed.Reason)
	}
	if closedBy != "" {
		t.Fatalf("closed_by=%q must be cleared on reopen (the audit log still holds the acknowledgement)", closedBy)
	}

	// (c) resolved + any observation -> reopened with the investigate suffix, link kept.
	if _, err := pool.Exec(ctx, `UPDATE public.crypto_deposit_exceptions SET state='resolved', resolved_user_id=NULL
		  WHERE provider=$1 AND provider_op_id=$2`, base.Provider, base.ProviderOpID); err != nil {
		t.Fatal(err)
	}
	if err := s.store.RecordException(ctx, changed); err != nil {
		t.Fatal(err)
	}
	_, state, reason, seen, _ := excState(t, pool, base.ProviderOpID)
	if state != "open" || !strings.HasSuffix(reason, "reorg/reject after credit — investigate") {
		t.Fatalf("state=%s reason=%q", state, reason)
	}
	if seen != 4 {
		t.Fatalf("seen=%d want 4", seen)
	}
}
```

Add `"strings"` to the import block of `exceptions_live_db_test.go` (it already imports `context`, `os`, `sync`, `testing`, uuid, pgxpool, decimal, cryptoprov, testsupport — keep only what is used).

- [ ] **Step 6: Run the live tests**

```bash
cd backend
TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  go test -p 2 -run 'TestLive_' -v ./internal/crypto/deposit/
```

Expected: PASS. If the reopen assertions fail first, that is the fake and the SQL disagreeing — fix the SQL, not the assertion; the spec table is the contract.

- [ ] **Step 7: Commit**

```bash
git add backend/internal/crypto/deposit/pgxstore.go backend/internal/crypto/deposit/deposit_test.go \
        backend/internal/crypto/deposit/exceptions_test.go backend/internal/crypto/deposit/exceptions_live_db_test.go
git commit -m "feat(crypto): deposit exception upsert counts observations and reopens on change"
```

---

## Task 4: Auto-resolve — a legitimate credit closes its own exception

**Files:**
- Modify: `backend/internal/crypto/deposit/pgxstore.go` (`ApplyCredit`)
- Modify: `backend/internal/crypto/deposit/deposit_test.go` (`memStore.ApplyCredit` flips)
- Modify: `backend/internal/crypto/deposit/exceptions_test.go`, `exceptions_live_db_test.go`

**Interfaces:**
- Consumes: `crypto_deposits.id` from the insert, `Apply.UserID/Provider/ProviderOpID`.
- Produces: on `OutcomeSettled` only, the exception row for the same `(provider, provider_op_id)` becomes `state='resolved'` with `deposit_id` and `resolved_user_id` set, inside the same transaction as the credit.

- [ ] **Step 1: Write the failing tests**

Append to `exceptions_test.go`:

```go
func TestSettledCreditFlipsItsOpenExceptionToResolved(t *testing.T) {
	ctx := context.Background()
	m := newMemStore()
	if err := m.RecordException(ctx, excOf("op-6", ExceptionUnmapped, "no owner")); err != nil {
		t.Fatal(err)
	}
	s := NewSettler(resolverWith(map[string]Owner{"acct-1": ownerBTC(3)}), m)
	if res, err := s.Settle(ctx, Credit{Provider: "quidax", ProviderAccountID: "acct-1", ProviderOpID: "op-6",
		Symbol: "BTC", Network: "bitcoin", Units: 500_000, Confirmations: 9, Status: StatusConfirmed}); err != nil || res.Outcome != OutcomeSettled {
		t.Fatalf("outcome=%s err=%v", res.Outcome, err)
	}
	v, _ := m.view("quidax", "op-6")
	if v.State != "resolved" || v.DepositID == "" {
		t.Fatalf("state=%s deposit_id=%q, want resolved + a credit link", v.State, v.DepositID)
	}
}

func TestDuplicateSettleDoesNotFlipAnEscalatedException(t *testing.T) {
	ctx := context.Background()
	m := newMemStore()
	owners := map[string]Owner{"acct-1": ownerBTC(3)}
	s := NewSettler(resolverWith(owners), m)
	first := Credit{Provider: "quidax", ProviderAccountID: "acct-1", ProviderOpID: "op-7",
		Symbol: "BTC", Network: "bitcoin", Units: 500_000, Confirmations: 9, Status: StatusConfirmed}
	if res, err := s.Settle(ctx, first); err != nil || res.Outcome != OutcomeSettled {
		t.Fatalf("outcome=%s err=%v", res.Outcome, err)
	}
	// A terminal reorg observation then escalates the (now resolved) row back to open.
	reorg := first
	reorg.Status = StatusReorged
	if res, err := s.Settle(ctx, reorg); err != nil || res.Outcome != OutcomeRejected {
		t.Fatalf("outcome=%s err=%v", res.Outcome, err)
	}
	if v, _ := m.view("quidax", "op-7"); v.State != "open" {
		t.Fatalf("state=%s want open after the reorg", v.State)
	}
	// The provider redelivers the original confirmed webhook: duplicate, credit unchanged,
	// and the escalation MUST survive. See the documented deviation from spec §4.3.
	if res, err := s.Settle(ctx, first); err != nil || res.Outcome != OutcomeDuplicate {
		t.Fatalf("outcome=%s err=%v", res.Outcome, err)
	}
	if v, _ := m.view("quidax", "op-7"); v.State != "open" {
		t.Fatalf("state=%s — a redelivered webhook erased the reorg escalation", v.State)
	}
	if m.balance("usr-1", "ast-btc") != 500_000 {
		t.Fatalf("balance moved on a duplicate: %d", m.balance("usr-1", "ast-btc"))
	}
}
```

- [ ] **Step 2: Make the fake flip**

In `deposit_test.go`'s `memStore.ApplyCredit`, on the settled branch only — after the `user`/`custody` movements and before `return OutcomeSettled, nil` — mirror §4.3 (the `applied` map already guarantees this branch is first-time, so a duplicate never reaches it):

```go
	// Auto-resolve exactly as PGStore.ApplyCredit does: only open or closed rows flip.
	if r, ok := m.exc[a.Provider+"\x00"+a.ProviderOpID]; ok && (r.state == "open" || r.state == "closed") {
		r.state = "resolved"
		r.depositID = "dep-" + a.ProviderOpID
		r.resolved = a.UserID
	}
```

The key is built from `a.Provider`, not a literal, because `Apply` names the provider the exception was recorded under. `ApplyCredit` already holds `m.mu` from the top of the method, so no extra locking is needed.

- [ ] **Step 3: Implement the in-transaction flip**

In `pgxstore.go`'s `ApplyCredit`, immediately after the `crypto_holdings` upsert and **before** `tx.Commit`:

```go
	// Auto-resolve (§4.3): the credit that just landed is the resolution of any exception
	// for this transfer, so the queue cannot contradict the ledger. Runs only on the branch
	// that actually credited — see the deviation note below. Zero rows touched when there
	// was no exception, so the common settle path costs one extra no-op statement.
	const resolveExc = `
		UPDATE public.crypto_deposit_exceptions
		   SET state='resolved', deposit_id=$1, resolved_user_id=$2, updated_at=now()
		 WHERE provider=$3 AND provider_op_id=$4 AND state IN ('open','closed')`
	if _, err := tx.Exec(ctx, resolveExc, id, a.UserID, a.Provider, a.ProviderOpID); err != nil {
		return OutcomeRejected, fmt.Errorf("deposit: resolve exception: %w", err)
	}
```

`id` is the `crypto_deposits` id already scanned above; `resolved_user_id` is the owner the credit went to. A `resolved` row is not matched, so a re-credit attempt cannot double-stamp it.

**Documented deviation from spec §4.3.** The spec sentence "Duplicate settle re-runs the same idempotent update" is not implemented, deliberately: if a duplicate also flips the row, then the sequence *credit → reorg observation (reopens `open`) → redelivered confirmed webhook (duplicate)* would silently re-resolve the exception and delete the only signal that money may have moved out from under a balance. Skipping the flip on duplicates keeps `crypto_holdings` and the queue consistent in the case that matters, and costs nothing in the normal case (the row is already `resolved` from the first settle). Record this in the Task 10 ADR, and append the same note to spec §4.3 so the two documents do not disagree:

```markdown
> 2026-10-31 amendment: the flip runs only on the newly-settled branch, not on a duplicate.
> A replayed webhook must not re-resolve an exception that a post-credit reorg observation
> reopened. See ADR-<PR>-crypto-deposit-exception-queue.md.
```

- [ ] **Step 4: Run the DB-free tests**

```bash
cd backend && go test -p 2 -run 'TestSettledCreditFlips|TestDuplicateSettle' -v ./internal/crypto/deposit/
```

Expected: PASS. Then the package, which proves the money invariants still hold:

```bash
cd backend && go test -p 2 ./internal/crypto/deposit/
```

- [ ] **Step 5: Write the failing live scenarios**

Append to `exceptions_live_db_test.go`:

```go
// TestLive_UnmappedThenMappedSettlesOnceAndResolvesTheException is spec §7 scenario 1, end
// to end over the real schema: orphan -> open exception, no credit; mapping appears ->
// settled exactly once, holdings +exact, exception resolved and linked; a third pass moves
// nothing.
func TestLive_UnmappedThenMappedSettlesOnceAndResolvesTheException(t *testing.T) {
	pool := livePool(t)
	ctx := context.Background()
	u, _ := seedUser(t, pool, "quidax") // also proves the mapping is what changed
	asset := btcAssetID(t, pool)
	acct := "acct-late-map-" + uuid.NewString()
	op := uuid.NewString()
	s := newSettler(pool, 2)
	c := credit(acct, op, 250_000, 3)

	if res, err := s.Settle(ctx, c); err != nil || res.Outcome != OutcomeUnmapped {
		t.Fatalf("outcome=%s err=%v", res.Outcome, err)
	}
	if _, state, _, _, _ := excState(t, pool, op); state != "open" {
		t.Fatalf("state=%s want open", state)
	}
	if bal, _ := Balance(ctx, pool, u, asset); bal != 0 {
		t.Fatalf("an orphan credited %d units", bal)
	}

	if _, err := pool.Exec(ctx,
		`INSERT INTO crypto_accounts (user_id, provider, provider_account_id) VALUES ($1,'quidax',$2)`, u, acct); err != nil {
		t.Fatalf("map the sub-account: %v", err)
	}
	if res, err := s.Settle(ctx, c); err != nil || res.Outcome != OutcomeSettled {
		t.Fatalf("after mapping: outcome=%s err=%v", res.Outcome, err)
	}
	if bal, _ := Balance(ctx, pool, u, asset); bal != 250_000 {
		t.Fatalf("balance=%d want 250000", bal)
	}
	kind, state, _, seen, depositID := excState(t, pool, op)
	if kind != "unmapped" || state != "resolved" || seen != 2 {
		t.Fatalf("kind=%s state=%s seen=%d want unmapped/resolved/2", kind, state, seen)
	}
	var want string
	if err := pool.QueryRow(ctx, `SELECT id FROM public.crypto_deposits WHERE provider='quidax' AND provider_op_id=$1`, op).Scan(&want); err != nil {
		t.Fatal(err)
	}
	if depositID == nil || want != *depositID {
		t.Fatalf("deposit_id=%v want %s", deref(depositID), want)
	}
	var resolvedUser string
	if err := pool.QueryRow(ctx, `SELECT resolved_user_id::text FROM public.crypto_deposit_exceptions WHERE provider='quidax' AND provider_op_id=$1`, op).Scan(&resolvedUser); err != nil {
		t.Fatal(err)
	}
	if resolvedUser != u {
		t.Fatalf("resolved_user_id=%s want %s", resolvedUser, u)
	}

	if res, err := s.Settle(ctx, c); err != nil || res.Outcome != OutcomeDuplicate {
		t.Fatalf("third pass: outcome=%s err=%v", res.Outcome, err)
	}
	if bal, _ := Balance(ctx, pool, u, asset); bal != 250_000 {
		t.Fatalf("a redelivery moved the balance to %d", bal)
	}
	if _, state, _, _, _ := excState(t, pool, op); state != "resolved" {
		t.Fatalf("state=%s want resolved", state)
	}
}

// TestLive_ReorgAfterCreditReopensWithoutReversing is spec §7 scenario 3 and §6: the
// exception is the escalation trigger, never the fix.
func TestLive_ReorgAfterCreditReopensWithoutReversing(t *testing.T) {
	pool := livePool(t)
	ctx := context.Background()
	u, acct := seedUser(t, pool, "quidax")
	asset := btcAssetID(t, pool)
	op := uuid.NewString()
	s := newSettler(pool, 2)

	if res, err := s.Settle(ctx, credit(acct, op, 500_000, 3)); err != nil || res.Outcome != OutcomeSettled {
		t.Fatalf("outcome=%s err=%v", res.Outcome, err)
	}
	if _, state, _, _, _ := excState(t, pool, op); state == "open" {
		t.Fatal("a settled transfer must not leave an open exception")
	}

	reorg := credit(acct, op, 500_000, 3)
	reorg.Status = StatusReorged
	if res, err := s.Settle(ctx, reorg); err != nil || res.Outcome != OutcomeRejected {
		t.Fatalf("outcome=%s err=%v", res.Outcome, err)
	}
	_, state, reason, _, depositID := excState(t, pool, op)
	if state != "open" {
		t.Fatalf("state=%s want open (reopened)", state)
	}
	if !strings.Contains(reason, "investigate") {
		t.Fatalf("reason=%q want the investigate suffix", reason)
	}
	if depositID == nil {
		t.Fatal("the reopened exception lost its link to the credit it is questioning")
	}
	if bal, _ := Balance(ctx, pool, u, asset); bal != 500_000 {
		t.Fatalf("visibility-only design must NOT reverse the credit: balance=%d", bal)
	}
}

func deref(s *string) string {
	if s == nil {
		return "<null>"
	}
	return *s
}
```

Note: the `TestLive_DuplicateObservationsMakeOneExceptionRow` test from Task 3 leaves its own orphan row behind; every assertion here keys on the test's own uuid `op`, which is why none of them interfere.

- [ ] **Step 6: Run the live tests**

```bash
cd backend
TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  go test -p 2 -run 'TestLive_' -v ./internal/crypto/deposit/
```

Expected: PASS, including the two scenarios above.

- [ ] **Step 7: Full backend gate, then commit**

```bash
cd backend && go build ./... && go test -p 2 ./... | tail -20
```

Expected: no FAIL. (Without `TEST_DATABASE_URL` the live tests skip — that is a skip, not a pass; re-run them with it before calling this done.)

```bash
git add backend/internal/crypto/deposit/pgxstore.go backend/internal/crypto/deposit/deposit_test.go \
        backend/internal/crypto/deposit/exceptions_test.go backend/internal/crypto/deposit/exceptions_live_db_test.go \
        docs/superpowers/specs/2026-10-22-crypto-deposit-exception-queue-design.md
git commit -m "feat(crypto): settled credit auto-resolves its deposit exception"
```

## Task 5: The admin read seam — types, `Store` methods, PG queries

**Files:**
- Create: `backend/internal/cryptosvc/exceptions.go` (types + filter defaulting only; Task 6 appends the `Service` methods, Task 7 the handlers)
- Modify: `backend/internal/cryptosvc/store.go` (`Store` gains 4 methods; 2 sentinel errors)
- Modify: `backend/internal/cryptosvc/pgxstore.go` (`exceptionCols`, `scanException`, the four PG methods; import block gains `fmt`, `strconv`, `strings`)
- Modify: `backend/internal/cryptosvc/memstore_test.go` (fake exception store)
- Create: `backend/internal/cryptosvc/exceptions_live_db_test.go`

**Interfaces:**
- Consumes: the table and its 24 columns exactly as Task 1 defines them.
- Produces: `DepositException`, `ExceptionKind` (`ExceptionKindUnmapped`, `ExceptionKindRejected`), `ExceptionState` (`ExceptionOpen`, `ExceptionResolved`, `ExceptionClosed`, `ExceptionStateAny`), `ExceptionFilter` and its `(ExceptionFilter).normalized()`, `DepositExceptionCounts`, `ErrDepositExceptionNotFound`, `ErrDepositExceptionResolved`, and `Store.DepositExceptions` / `DepositExceptionByID` / `CloseDepositException` / `OpenDepositExceptionCounts`. Task 6 and Task 7 call nothing else.

Only two types implement `Store`: `*PGStore` (`pgxstore.go:21`) and the test fake, and `Wire` constructs the `*PGStore` itself (`wire.go:112`). Widening the interface therefore changes **no** `internal/app` file — do not go looking for wiring to update.

- [ ] **Step 1: Write the failing live tests**

Create `backend/internal/cryptosvc/exceptions_live_db_test.go`. It uses the package's existing `livePool(t)` helper (`pgxstore_live_db_test.go:19`). The table is shared with the engine's own live tests, so every assertion keys on ids this file inserted, and the counts test asserts a **delta**. Rows are deleted in `t.Cleanup` — by their own ids only; never a `TRUNCATE`, never a predicate delete.

```go
package cryptosvc

// Live-DB tests for the admin exception queue read/close seam over the real migrated schema
// (spec §5). SKIPPED unless TEST_DATABASE_URL is set. crypto_deposit_exceptions is written by
// the deposit engine, so this file seeds it with SQL and tests only what cryptosvc owns:
// filtering, the triage ordering, the conditional close and the cheap open counts.

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// seedException inserts one row whose last_seen_at is seenAgo in the past and returns its row
// id. The provider is fixed to quidax so the provider-filter test can ask for any other value.
func seedException(t *testing.T, pool *pgxpool.Pool, kind, state string, seenAgo time.Duration) string {
	t.Helper()
	op := uuid.NewString()
	var id string
	err := pool.QueryRow(context.Background(), `
		INSERT INTO public.crypto_deposit_exceptions
			(provider, provider_account_id, provider_op_id, kind, reason,
			 symbol, network, address, amount_whole, confirmations, required_confs, tx_hash,
			 state, first_seen_at, last_seen_at)
		VALUES ('quidax', 'acct-live', $1, $2, 'live seed',
			'BTC', 'bitcoin', 'bc1qlive', '0.001', 9, 3, '0xlive',
			$3, now() - $4::interval, now() - $4::interval)
		RETURNING id::text`, op, kind, state, fmt.Sprintf("%ds", int(seenAgo.Seconds()))).Scan(&id)
	if err != nil {
		t.Fatalf("seed %s/%s: %v", kind, state, err)
	}
	t.Cleanup(func() {
		if _, err := pool.Exec(context.Background(),
			`DELETE FROM public.crypto_deposit_exceptions WHERE id = $1::uuid`, id); err != nil {
			t.Errorf("cleanup %s: %v", id, err)
		}
	})
	return id
}

func excIDs(rows []DepositException) []string {
	out := make([]string, 0, len(rows))
	for _, r := range rows {
		out = append(out, r.ID)
	}
	return out
}

func containsSeq(t *testing.T, got, want []string) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("got %v want exactly %v (in order)", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("position %d: got %v want %v", i, got, want)
		}
	}
}

// TestLive_DepositExceptionsFiltersOrdersAndPages is spec §5's ordering contract: the open
// queue oldest-first (that is the stuck money), closed/resolved newest-first, and every
// filter honoured. A page is a page — never the whole table.
func TestLive_DepositExceptionsFiltersOrdersAndPages(t *testing.T) {
	pool := livePool(t)
	ctx := context.Background()
	st := NewPGStore(pool)

	openOld := seedException(t, pool, "unmapped", "open", 300*time.Second)
	openNew := seedException(t, pool, "rejected", "open", 60*time.Second)
	closed := seedException(t, pool, "unmapped", "closed", 120*time.Second)
	resolved := seedException(t, pool, "unmapped", "resolved", 30*time.Second)

	all, err := st.DepositExceptions(ctx, ExceptionFilter{State: ExceptionStateAny, Limit: 200})
	if err != nil {
		t.Fatal(err)
	}
	// The four seeded rows must appear in the right relative order; other tests' rows may
	// also be present, so assert on the seeded subsequence only.
	seeded := make([]string, 0, 4)
	for _, id := range excIDs(all) {
		switch id {
		case openOld, openNew, closed, resolved:
			seeded = append(seeded, id)
		}
	}
	containsSeq(t, seeded, []string{openOld, openNew, resolved, closed})

	opens, err := st.DepositExceptions(ctx, ExceptionFilter{State: ExceptionOpen, Limit: 200})
	if err != nil {
		t.Fatal(err)
	}
	seeded = seeded[:0]
	for _, id := range excIDs(opens) {
		switch id {
		case openOld, openNew, closed, resolved:
			seeded = append(seeded, id)
		}
	}
	containsSeq(t, seeded, []string{openOld, openNew})

	// kind + provider predicates.
	rejected, err := st.DepositExceptions(ctx, ExceptionFilter{State: ExceptionStateAny, Kind: ExceptionKindRejected, Limit: 200})
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range rejected {
		if e.Kind != ExceptionKindRejected {
			t.Fatalf("kind filter leaked %s", e.Kind)
		}
	}
	if _, err := st.DepositExceptions(ctx, ExceptionFilter{State: ExceptionOpen, Provider: "no-such-provider", Limit: 200}); err != nil {
		t.Fatal(err)
	}

	// limit/offset really page.
	page, err := st.DepositExceptions(ctx, ExceptionFilter{State: ExceptionOpen, Limit: 1, Offset: 1})
	if err != nil {
		t.Fatal(err)
	}
	if len(page) != 1 {
		t.Fatalf("limit=1 returned %d rows", len(page))
	}

	// A full round trip of the fields the admin view shows.
	one, ok, err := st.DepositExceptionByID(ctx, openOld)
	if err != nil || !ok {
		t.Fatalf("by id: ok=%v err=%v", ok, err)
	}
	if one.Provider != "quidax" || one.Symbol != "BTC" || one.AmountWhole != "0.001" ||
		one.Confirmations != 9 || one.RequiredConfs != 3 || one.TxHash != "0xlive" || one.SeenCount != 1 {
		t.Fatalf("row = %+v", one)
	}
}

// TestLive_CloseDepositExceptionIsConditional pins the one write cryptosvc may make to this
// table: open -> closed with the operator stamp, and nothing else. A resolved row (money
// already credited) must never be closeable, and a second close must not re-stamp.
func TestLive_CloseDepositExceptionIsConditional(t *testing.T) {
	pool := livePool(t)
	ctx := context.Background()
	st := NewPGStore(pool)
	at := time.Now().UTC().Truncate(time.Microsecond) // timestamptz keeps microseconds

	openID := seedException(t, pool, "unmapped", "open", time.Minute)
	rec, applied, err := st.CloseDepositException(ctx, openID, "admin:op-1", "provider dashboard confirms the transfer never existed", at)
	if err != nil || !applied {
		t.Fatalf("close: applied=%v err=%v", applied, err)
	}
	if rec.State != ExceptionClosed || rec.ClosedBy != "admin:op-1" ||
		rec.CloseNote != "provider dashboard confirms the transfer never existed" || !rec.ClosedAt.Equal(at) {
		t.Fatalf("closed row = %+v", rec)
	}

	_, applied, err = st.CloseDepositException(ctx, openID, "admin:op-2", "second attempt", at.Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if applied {
		t.Fatal("a second close must not re-stamp an acknowledged case (the audit log would show two)")
	}
	if again, _, _ := st.DepositExceptionByID(ctx, openID); again.ClosedBy != "admin:op-1" {
		t.Fatalf("closed_by moved to %q", again.ClosedBy)
	}

	resolvedID := seedException(t, pool, "unmapped", "resolved", time.Minute)
	_, applied, err = st.CloseDepositException(ctx, resolvedID, "admin:op-1", "should never land", at)
	if err != nil {
		t.Fatal(err)
	}
	if applied {
		t.Fatal("a resolved exception is not closeable — the credit already resolved it")
	}
	if again, _, _ := st.DepositExceptionByID(ctx, resolvedID); again.State != ExceptionResolved {
		t.Fatalf("state moved to %s", again.State)
	}

	// A well-formed uuid that is not a row is a plain not-found, not an error.
	if _, ok, err := st.CloseDepositException(ctx, uuid.NewString(), "admin:op-1", "n", at); err != nil || ok {
		t.Fatalf("unknown id: applied=%v err=%v", ok, err)
	}
}

// TestLive_OpenDepositExceptionCountsAreOpenOnly proves the count block answers "is money
// stuck, and why" and that acknowledging a case takes it out of the numbers. Deltas, because
// the table is shared; OldestLastSeenAt's zero case is covered by the fake in Task 6, since no
// shared table can be guaranteed empty.
func TestLive_OpenDepositExceptionCountsAreOpenOnly(t *testing.T) {
	pool := livePool(t)
	ctx := context.Background()
	st := NewPGStore(pool)

	before, err := st.OpenDepositExceptionCounts(ctx)
	if err != nil {
		t.Fatal(err)
	}
	a := seedException(t, pool, "unmapped", "open", 10*time.Minute)
	b := seedException(t, pool, "unmapped", "open", time.Hour)
	c := seedException(t, pool, "rejected", "open", 5*time.Minute)

	after, err := st.OpenDepositExceptionCounts(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if after.Unmapped != before.Unmapped+2 || after.Rejected != before.Rejected+1 {
		t.Fatalf("counts = %+v, want +%d/+1 from %+v", after, 2, before)
	}
	if after.OldestLastSeenAt.IsZero() || after.OldestLastSeenAt.After(before.OldestLastSeenAt) {
		t.Fatalf("oldest moved the wrong way: before=%v after=%v", before.OldestLastSeenAt, after.OldestLastSeenAt)
	}

	at := time.Now().UTC()
	for _, id := range []string{a, b, c} {
		if _, applied, err := st.CloseDepositException(ctx, id, "admin:op-1", "seeded by a live test", at); err != nil || !applied {
			t.Fatalf("close %s: applied=%v err=%v", id, applied, err)
		}
	}
	back, err := st.OpenDepositExceptionCounts(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if back.Unmapped != before.Unmapped || back.Rejected != before.Rejected {
		t.Fatalf("closing left %+v, want the pre-seed %+v", back, before)
	}
}
```

- [ ] **Step 2: Run them to watch them fail**

```bash
cd backend && TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  go test -p 2 -run 'TestLive_Deposit|TestLive_OpenDeposit' ./internal/cryptosvc/
```

Expected: compilation failure — `undefined: DepositException`, `st.DepositExceptions undefined`. That is the red state; do not "fix" it by weakening the test.

- [ ] **Step 3: The types**

Create `backend/internal/cryptosvc/exceptions.go`:

```go
package cryptosvc

import (
	"errors"
	"strings"
	"time"
)

// The deposit exception queue's admin half (spec 2026-10-22 §5). The deposit engine writes
// crypto_deposit_exceptions when it DECIDES not to credit a transfer; this file is how ops
// read and acknowledge those rows. It lives in the cryptosvc admin plane next to the swap
// review queue because that is where the lock, audit trail, idempotency rule and crypto.admin
// gate already exist. Nothing here moves money: the table is a descriptive side ledger and the
// only write is a state stamp on it, which changes no balance and no credit decision.

// ExceptionKind is which class of non-credit decision produced the row. It mirrors
// deposit.ExceptionKind: cryptosvc must not import the engine's types (the engine is wired
// behind an interface precisely so the swap plane stays independent), so the two vocabularies
// are held in step by the live-DB tests rather than by a shared package.
type ExceptionKind string

const (
	ExceptionKindUnmapped ExceptionKind = "unmapped" // no crypto_accounts owner for the sub-account
	ExceptionKindRejected ExceptionKind = "rejected" // non-final, or an amount that cannot be credited
)

// ExceptionState is the row's lifecycle. ExceptionStateAny is a request word ("all") and is
// never a column value: the store skips the state predicate only for it.
type ExceptionState string

const (
	ExceptionOpen     ExceptionState = "open"
	ExceptionResolved ExceptionState = "resolved"
	ExceptionClosed   ExceptionState = "closed"
	ExceptionStateAny ExceptionState = "all"
)

// DepositException is one inbound transfer the settlement engine decided NOT to credit.
// AmountWhole is the provider's whole-unit figure as text: an unmapped transfer has no
// resolved minor-unit scale to convert with, and a rejected one may carry an amount that has no
// valid minor-unit form at all — which is exactly why it was rejected.
type DepositException struct {
	ID                string
	Provider          string
	ProviderAccountID string
	ProviderOpID      string
	Kind              ExceptionKind
	Reason            string
	Symbol            string
	Network           string
	Address           string
	AmountWhole       string
	Confirmations     int
	RequiredConfs     int
	TxHash            string
	State             ExceptionState
	DepositID         string // set once a credit exists for this transfer
	ResolvedUserID    string // the owner that credit went to
	FirstSeenAt       time.Time
	LastSeenAt        time.Time
	SeenCount         int // observations of this transfer (webhook redeliveries + sweeps)
	ClosedAt          time.Time
	ClosedBy          string
	CloseNote         string
}

// ExceptionFilter bounds one admin list request. Values come from the query string, so they
// are untrusted until normalized() has run.
type ExceptionFilter struct {
	State    ExceptionState
	Kind     ExceptionKind
	Provider string
	Limit    int
	Offset   int
}

// normalized applies the queue's defaults: the active (open) queue and a bounded page; an
// empty Kind or Provider means "no predicate". Defaulting lives here, not in the handler, so
// every caller — including the reconciler status view — gets identical page semantics.
func (f ExceptionFilter) normalized() ExceptionFilter {
	if f.State == "" {
		f.State = ExceptionOpen
	}
	if f.Limit <= 0 {
		f.Limit = reviewDefaultLimit
	}
	if f.Limit > reviewMaxLimit {
		f.Limit = reviewMaxLimit
	}
	if f.Offset < 0 {
		f.Offset = 0
	}
	f.Kind = ExceptionKind(strings.TrimSpace(string(f.Kind)))
	f.Provider = strings.TrimSpace(f.Provider)
	return f
}

// DepositExceptionCounts is the cheap grouped count behind "is money stuck, and why?".
// OldestLastSeenAt is the zero time when no open row exists.
type DepositExceptionCounts struct {
	Unmapped       int64
	Rejected       int64
	OldestLastSeenAt time.Time
}

var (
	// ErrDepositExceptionNotFound is an unknown id, or one that is not a uuid at all. The
	// handler answers 404 either way: an existence oracle is not worth a distinct code.
	ErrDepositExceptionNotFound = errors.New("cryptosvc: deposit exception not found")
	// ErrDepositExceptionResolved refuses to close a row the ledger already resolved. The
	// transfer WAS credited; a closed state there would hide a settled credit from triage.
	ErrDepositExceptionResolved = errors.New("cryptosvc: deposit exception is resolved by a credit and cannot be closed")
)
```

- [ ] **Step 4: Widen the `Store` interface**

In `store.go`, insert these four methods inside the `Store` interface (after `SaveProviderAccount`, before the closing brace), and add the two sentinels to the `var (...)` block below it:

```go
	// DepositExceptions reads the admin exception queue. The filter must already be normalized:
	// an empty State matches NOTHING (it is not "everything"), so a caller that forgets to
	// normalize gets an empty page instead of an unbounded dump. Ordering is the triage
	// contract — open rows oldest last_seen_at first, then resolved/closed newest first, id as
	// the stable tiebreak. Read-only; it must not lock rows.
	DepositExceptions(ctx context.Context, f ExceptionFilter) ([]DepositException, error)
	// DepositExceptionByID reads one row with no user scoping (the surface is crypto.admin-gated
	// upstream, exactly like SwapByIDAny).
	DepositExceptionByID(ctx context.Context, id string) (DepositException, bool, error)
	// CloseDepositException stamps an operator's acknowledgement ONLY while the row is still
	// 'open'; applied is false when a settle transaction resolved it or another close won the
	// race. `at` is the caller's clock so the stamp is testable. It never touches a credit, a
	// balance, or crypto_deposits.
	CloseDepositException(ctx context.Context, id, closedBy, note string, at time.Time) (DepositException, bool, error)
	// OpenDepositExceptionCounts is one grouped count over the OPEN rows: how many per kind and
	// the oldest last_seen_at (zero when there are none). Read-only; no row locks.
	OpenDepositExceptionCounts(ctx context.Context) (DepositExceptionCounts, error)
```

- [ ] **Step 5: The fake, so the package compiles**

In `memstore_test.go`: add to the `memStore` struct

```go
	// exceptions is the in-memory crypto_deposit_exceptions, keyed by our id.
	exceptions      map[string]*DepositException
	failExc         error  // makes every exception read or write fail
	lastExcFilter   ExceptionFilter // what the fake was actually asked for
	onClose         func(id string) // runs before the conditional close (a racing settle)
```

initialise `exceptions: map[string]*DepositException{}` in `newMemStore()`, and append the methods:

```go
func (s *memStore) DepositExceptions(_ context.Context, f ExceptionFilter) ([]DepositException, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.failExc != nil {
		return nil, s.failExc
	}
	s.lastExcFilter = f
	var out []DepositException
	for _, e := range s.exceptions {
		if e.State != f.State && f.State != ExceptionStateAny {
			continue
		}
		if f.Kind != "" && e.Kind != f.Kind {
			continue
		}
		if f.Provider != "" && e.Provider != f.Provider {
			continue
		}
		out = append(out, *e)
	}
	sort.Slice(out, func(i, j int) bool { // mirrors the SQL ordering
		oi, oj := out[i].State == ExceptionOpen, out[j].State == ExceptionOpen
		if oi != oj {
			return oi
		}
		if !out[i].LastSeenAt.Equal(out[j].LastSeenAt) {
			if oi {
				return out[i].LastSeenAt.Before(out[j].LastSeenAt) // open: oldest first
			}
			return out[i].LastSeenAt.After(out[j].LastSeenAt) // resolved/closed: newest first
		}
		return out[i].ID < out[j].ID
	})
	if f.Offset >= len(out) {
		return nil, nil
	}
	out = out[f.Offset:]
	if f.Limit > 0 && len(out) > f.Limit {
		out = out[:f.Limit]
	}
	return out, nil
}

func (s *memStore) DepositExceptionByID(_ context.Context, id string) (DepositException, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.failExc != nil {
		return DepositException{}, false, s.failExc
	}
	if e := s.exceptions[id]; e != nil {
		return *e, true, nil
	}
	return DepositException{}, false, nil
}

func (s *memStore) CloseDepositException(_ context.Context, id, closedBy, note string, at time.Time) (DepositException, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.failExc != nil {
		return DepositException{}, false, s.failExc
	}
	if s.onClose != nil {
		s.onClose(id) // simulate the settle that lands between the read and the update
	}
	e := s.exceptions[id]
	if e == nil || e.State != ExceptionOpen {
		return DepositException{}, false, nil
	}
	e.State, e.ClosedBy, e.CloseNote, e.ClosedAt = ExceptionClosed, closedBy, note, at
	out := *e
	return out, true, nil
}

func (s *memStore) OpenDepositExceptionCounts(_ context.Context) (DepositExceptionCounts, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.failExc != nil {
		return DepositExceptionCounts{}, s.failExc
	}
	var c DepositExceptionCounts
	for _, e := range s.exceptions {
		if e.State != ExceptionOpen {
			continue
		}
		switch e.Kind {
		case ExceptionKindUnmapped:
			c.Unmapped++
		case ExceptionKindRejected:
			c.Rejected++
		}
		if c.OldestLastSeenAt.IsZero() || e.LastSeenAt.Before(c.OldestLastSeenAt) {
			c.OldestLastSeenAt = e.LastSeenAt
		}
	}
	return c, nil
}

// addException plants a row in the fake. Tests fill in whatever they assert on.
func (s *memStore) addException(e DepositException) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.exceptions == nil {
		s.exceptions = map[string]*DepositException{}
	}
	cp := e
	s.exceptions[cp.ID] = &cp
}
```

`DepositException` deliberately has no `UpdatedAt` field: the PG close statement does
`SET updated_at = now()` inside its own SQL (Step 6), and nothing reads the column back into the
struct, so the fake mirrors exactly the fields `DepositException` declares.

- [ ] **Step 6: The PG implementation**

Append to `pgxstore.go`. Its import block gains `fmt`, `strconv` and `strings` (all three are used below; `go build` fails until they are added):

```go
// exceptionCols is the exact 22-field projection of DepositException. Nullable columns are
// COALESCEd to "" so a missing address never becomes a scan error, and uuids are cast to text
// so the struct stays free of uuid types. closed_at stays nullable because "never closed" is a
// real state, not an empty string.
const exceptionCols = `id::text, provider, provider_account_id, provider_op_id, kind, reason,
	COALESCE(symbol,''), COALESCE(network,''), COALESCE(address,''), COALESCE(amount_whole,''),
	confirmations, required_confs, COALESCE(tx_hash,''), state,
	COALESCE(deposit_id::text,''), COALESCE(resolved_user_id::text,''),
	first_seen_at, last_seen_at, seen_count, closed_at, COALESCE(closed_by,''), COALESCE(close_note,'')`

func scanException(row pgx.Row) (DepositException, error) {
	var (
		e        DepositException
		kind     string
		state    string
		closedAt *time.Time
	)
	if err := row.Scan(&e.ID, &e.Provider, &e.ProviderAccountID, &e.ProviderOpID, &kind, &e.Reason,
		&e.Symbol, &e.Network, &e.Address, &e.AmountWhole, &e.Confirmations, &e.RequiredConfs,
		&e.TxHash, &state, &e.DepositID, &e.ResolvedUserID, &e.FirstSeenAt, &e.LastSeenAt, &e.SeenCount,
		&closedAt, &e.ClosedBy, &e.CloseNote); err != nil {
		return DepositException{}, err
	}
	e.Kind, e.State = ExceptionKind(kind), ExceptionState(state)
	if closedAt != nil {
		e.ClosedAt = *closedAt
	}
	return e, nil
}

// DepositExceptions builds one parameterised query from the (already normalized) filter. Every
// value goes in as a positional placeholder through push, so no request string can become SQL
// text — the ordering below is the only literal, and it is constant.
func (s *PGStore) DepositExceptions(ctx context.Context, f ExceptionFilter) ([]DepositException, error) {
	var (
		where []string
		args  []any
		push  = func(clause string, v any) {
			args = append(args, v)
			where = append(where, fmt.Sprintf(clause, len(args)))
		}
	)
	if f.State != ExceptionStateAny {
		push("state = $%d", string(f.State))
	}
	if f.Kind != "" {
		push("kind = $%d", string(f.Kind))
	}
	if f.Provider != "" {
		push("provider = $%d", f.Provider)
	}
	q := `SELECT ` + exceptionCols + ` FROM public.crypto_deposit_exceptions`
	if len(where) > 0 {
		q += ` WHERE ` + strings.Join(where, ` AND `)
	}
	// Triage order, spec §5: open rows oldest-first (that is the stuck money), then
	// resolved/closed newest-first. One CASE pair, id as the stable tiebreak.
	q += ` ORDER BY CASE WHEN state = 'open' THEN 0 ELSE 1 END,
		CASE WHEN state = 'open' THEN EXTRACT(epoch FROM last_seen_at)
		     ELSE -EXTRACT(epoch FROM last_seen_at) END, id`
	args = append(args, f.Limit)
	q += ` LIMIT $` + strconv.Itoa(len(args))
	args = append(args, f.Offset)
	q += ` OFFSET $` + strconv.Itoa(len(args))

	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DepositException
	for rows.Next() {
		e, err := scanException(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func (s *PGStore) DepositExceptionByID(ctx context.Context, id string) (DepositException, bool, error) {
	e, err := scanException(s.pool.QueryRow(ctx,
		`SELECT `+exceptionCols+` FROM public.crypto_deposit_exceptions WHERE id = $1::uuid`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return DepositException{}, false, nil
	}
	return e, err == nil, err
}

// CloseDepositException is a single conditional UPDATE ... RETURNING: the read and the write
// are one statement, so a settle that resolves the row concurrently cannot be stepped on.
// applied is false when the row was not open.
func (s *PGStore) CloseDepositException(ctx context.Context, id, closedBy, note string, at time.Time) (DepositException, bool, error) {
	e, err := scanException(s.pool.QueryRow(ctx, `
		UPDATE public.crypto_deposit_exceptions
		   SET state = 'closed', closed_at = $2, closed_by = $3, close_note = $4, updated_at = now()
		 WHERE id = $1::uuid AND state = 'open'
		RETURNING `+exceptionCols, id, at, closedBy, note))
	if errors.Is(err, pgx.ErrNoRows) {
		return DepositException{}, false, nil
	}
	return e, err == nil, err
}

// OpenDepositExceptionCounts is one statement over the open rows. The min() must be scanned
// into a *time.Time: an aggregate over an empty set returns one row with NULL, not zero rows.
func (s *PGStore) OpenDepositExceptionCounts(ctx context.Context) (DepositExceptionCounts, error) {
	var (
		c      DepositExceptionCounts
		oldest *time.Time
	)
	err := s.pool.QueryRow(ctx, `
		SELECT count(*) FILTER (WHERE kind = 'unmapped'),
		       count(*) FILTER (WHERE kind = 'rejected'),
		       min(last_seen_at)
		  FROM public.crypto_deposit_exceptions
		 WHERE state = 'open'`).Scan(&c.Unmapped, &c.Rejected, &oldest)
	if err != nil {
		return DepositExceptionCounts{}, err
	}
	if oldest != nil {
		c.OldestLastSeenAt = *oldest
	}
	return c, nil
}
```

- [ ] **Step 7: Run the gate**

```bash
cd backend && go build ./... && go test -p 2 ./internal/cryptosvc/ | tail -5
```

Expected: clean build, `ok` (the DB-free suite does not use the new methods yet; it must simply still compile and pass).

```bash
cd backend && TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  go test -p 2 -run 'TestLive_Deposit|TestLive_OpenDeposit' -v ./internal/cryptosvc/
```

Expected: all PASS. If the ordering assertion fails, the `CASE` pair is wrong — fix the SQL; the test states the contract.

- [ ] **Step 8: Commit**

```bash
git add backend/internal/cryptosvc/exceptions.go backend/internal/cryptosvc/store.go \
        backend/internal/cryptosvc/pgxstore.go backend/internal/cryptosvc/memstore_test.go \
        backend/internal/cryptosvc/exceptions_live_db_test.go
git commit -m "feat(crypto): deposit exception read and conditional close over Postgres"
```

---

## Task 6: Service semantics — read, counts, and the audited close

**Files:**
- Modify: `backend/internal/cryptosvc/exceptions.go` (append the three `Service` methods + the audit helper; import block gains `context`)
- Create: `backend/internal/cryptosvc/exceptions_service_test.go`

**Interfaces:**
- Consumes: `Store.DepositExceptions` / `DepositExceptionByID` / `CloseDepositException` / `OpenDepositExceptionCounts`, `ExceptionFilter.normalized()`, the sentinels (all Task 5); `Service.locked` (`service.go:116`), `Service.cfg.Now`, `Auditor.Audit` (`audit.go:38`).
- Produces: `(*Service).DepositExceptions(ctx, ExceptionFilter) ([]DepositException, error)`, `(*Service).DepositExceptionCounts(ctx) (DepositExceptionCounts, error)`, `(*Service).AdminCloseDepositException(ctx, actor, idemKey, id, note string) (DepositException, error)`. Task 7's handlers call exactly these three.

`AdminResolve` uses the package's `s.audit(...)` helper; that helper cannot set `EntityType` or `Old` (`service.go:101-106`), and the spec requires the audit record to say `entity_type = crypto_deposit_exception` with an old→new state. So `auditException` calls `s.cfg.Audit.Audit` directly, exactly as the fee-schedule path does.

- [ ] **Step 1: Write the failing tests**

Create `backend/internal/cryptosvc/exceptions_service_test.go`:

```go
package cryptosvc

// Service-level semantics of the deposit exception queue (spec §5): the close is locked,
// conditional, idempotent, never monetary, and audited with old -> new. The rig's Service has no
// Auditor by default, so excRig installs one; asserting on it is the point of most of these.

import (
	"context"
	"errors"
	"testing"
	"time"
)

func excRig(t *testing.T) (*svcRig, *auditSink) {
	t.Helper()
	r := newSvcRig(t)
	sink := &auditSink{}
	r.svc.cfg.Audit = sink // same package; newSvcRig leaves the auditor nil on purpose
	return r, sink
}

func openExc(id string) DepositException {
	seen := time.Date(2026, 10, 12, 8, 0, 0, 0, time.UTC)
	return DepositException{
		ID: id, Provider: "quidax", ProviderAccountID: "acct-orphan", ProviderOpID: "op-" + id,
		Kind: ExceptionKindUnmapped, Reason: "no owner for provider sub-account acct-orphan",
		Symbol: "BTC", Network: "bitcoin", AmountWhole: "0.001", Confirmations: 9,
		State: ExceptionOpen, FirstSeenAt: seen, LastSeenAt: seen, SeenCount: 2,
	}
}

const excID = "0a0a0a0a-0000-4000-8000-00000000000a"

func TestAdminCloseDepositExceptionStampsAndAudits(t *testing.T) {
	r, sink := excRig(t)
	r.store.addException(openExc(excID))

	got, err := r.svc.AdminCloseDepositException(context.Background(), "admin:op-1", "idem-1", excID, "checked the provider dashboard")
	if err != nil {
		t.Fatal(err)
	}
	if got.State != ExceptionClosed || got.ClosedBy != "admin:op-1" ||
		got.CloseNote != "checked the provider dashboard" || !got.ClosedAt.Equal(r.now) {
		t.Fatalf("closed row = %+v (want closed_by/note and closed_at = the rig clock %v)", got, r.now)
	}
	if len(sink.ev) != 1 {
		t.Fatalf("audit events = %v, want exactly one", sink.actions())
	}
	e := sink.ev[0]
	if e.Actor != "admin:op-1" || e.Action != "crypto.deposit_exception.closed" ||
		e.EntityType != "crypto_deposit_exception" || e.EntityID != excID {
		t.Fatalf("audit = %+v", e)
	}
	if e.Reason != "checked the provider dashboard" {
		t.Fatalf("the note must be the audited reason, got %q", e.Reason)
	}
	if e.Old["state"] != "open" || e.Detail["state"] != "closed" {
		t.Fatalf("old/new = %v / %v", e.Old, e.Detail)
	}
	if e.Detail["idempotency_key"] != "idem-1" || e.Detail["provider_op_id"] != "op-"+excID ||
		e.Detail["kind"] != "unmapped" || e.Detail["provider"] != "quidax" {
		t.Fatalf("detail = %v", e.Detail)
	}
}

func TestAdminCloseDepositExceptionIsIdempotent(t *testing.T) {
	r, sink := excRig(t)
	r.store.addException(openExc(excID))
	ctx := context.Background()
	if _, err := r.svc.AdminCloseDepositException(ctx, "admin:op-1", "idem-1", excID, "first"); err != nil {
		t.Fatal(err)
	}
	second, err := r.svc.AdminCloseDepositException(ctx, "admin:op-1", "idem-1", excID, "first")
	if err != nil {
		t.Fatalf("a double click must not error: %v", err)
	}
	if second.State != ExceptionClosed {
		t.Fatalf("state = %s", second.State)
	}
	if len(sink.ev) != 1 {
		t.Fatalf("audit events = %v, want one — the second call performed nothing", sink.actions())
	}
}

func TestAdminCloseRejectsAResolvedException(t *testing.T) {
	r, sink := excRig(t)
	e := openExc(excID)
	e.State, e.DepositID, e.ResolvedUserID = ExceptionResolved, "dep-1", "usr-1"
	r.store.addException(e)
	_, err := r.svc.AdminCloseDepositException(context.Background(), "admin:op-1", "idem-1", excID, "no")
	if !errors.Is(err, ErrDepositExceptionResolved) {
		t.Fatalf("err = %v, want ErrDepositExceptionResolved", err)
	}
	if len(sink.ev) != 0 {
		t.Fatal("a refused close must not audit")
	}
	if got, _, _ := r.store.DepositExceptionByID(context.Background(), excID); got.State != ExceptionResolved {
		t.Fatalf("state moved to %s — a resolved exception is the ledger's own answer", got.State)
	}
}

func TestAdminCloseUnknownID(t *testing.T) {
	r, sink := excRig(t)
	_, err := r.svc.AdminCloseDepositException(context.Background(), "admin:op-1", "idem-1",
		"0b0b0b0b-0000-4000-8000-00000000000b", "no")
	if !errors.Is(err, ErrDepositExceptionNotFound) {
		t.Fatalf("err = %v, want ErrDepositExceptionNotFound", err)
	}
	if len(sink.ev) != 0 {
		t.Fatal("not-found must not audit")
	}
}

// TestAdminCloseLostRaceReportsTheCurrentRow covers the interleaving the conditional update
// exists for: the row was open when read and is not when updated.
func TestAdminCloseLostRaceReportsTheCurrentRow(t *testing.T) {
	r, sink := excRig(t)
	r.store.addException(openExc(excID))
	r.store.onClose = func(id string) { // a settle lands mid-call
		if cur, ok := r.store.exceptions[id]; ok {
			cur.State, cur.DepositID = ExceptionResolved, "dep-race"
		}
	}
	got, err := r.svc.AdminCloseDepositException(context.Background(), "admin:op-1", "idem-1", excID, "note")
	if err != nil {
		t.Fatalf("a lost race is not an operator error: %v", err)
	}
	if got.State != ExceptionResolved || got.DepositID != "dep-race" {
		t.Fatalf("row = %+v, want the resolved state the race produced", got)
	}
	if len(sink.ev) != 0 {
		t.Fatal("auditing a close that did not happen would lie in the audit log")
	}
}

func TestAdminCloseFailsClosedWithoutALocker(t *testing.T) {
	r := newSvcRig(t)
	r.store.addException(openExc(excID))
	noLock := NewService(ServiceConfig{Store: r.store}) // Locker nil by construction
	if _, err := noLock.AdminCloseDepositException(context.Background(), "admin:op-1", "k", excID, "n"); err == nil {
		t.Fatal("without a locker the close must refuse to run")
	}
	if got, _, _ := r.store.DepositExceptionByID(context.Background(), excID); got.State != ExceptionOpen {
		t.Fatalf("state = %s — the row moved without a lock", got.State)
	}
}

func TestDepositExceptionsNormalizesBeforeTheStore(t *testing.T) {
	r, _ := excRig(t)
	first := openExc(excID)
	second := openExc("0a0a0a0a-0000-4000-8000-00000000000b")
	second.State, second.LastSeenAt = ExceptionClosed, first.LastSeenAt.Add(time.Hour)
	r.store.addException(first)
	r.store.addException(second)

	if _, err := r.svc.DepositExceptions(context.Background(), ExceptionFilter{Limit: 99999}); err != nil {
		t.Fatal(err)
	}
	f := r.store.lastExcFilter
	if f.State != ExceptionOpen {
		t.Fatalf("state = %q, want the open queue by default", f.State)
	}
	if f.Limit != reviewMaxLimit {
		t.Fatalf("limit = %d, want the page capped at %d", f.Limit, reviewMaxLimit)
	}
	if _, err := r.svc.DepositExceptions(context.Background(), ExceptionFilter{State: ExceptionOpen, Kind: "  rejected "}); err != nil {
		t.Fatal(err)
	}
	if r.store.lastExcFilter.Kind != ExceptionKindRejected {
		t.Fatalf("kind = %q, want trimmed", r.store.lastExcFilter.Kind)
	}
	// The default page is the open queue, so the closed row the same rig planted is not in it.
	if _, err := r.svc.DepositExceptions(context.Background(), ExceptionFilter{State: ExceptionStateAny}); err != nil {
		t.Fatal(err)
	}
	if r.store.lastExcFilter.State != ExceptionStateAny {
		t.Fatalf("state = %q, want the explicit all passthrough", r.store.lastExcFilter.State)
	}
}

func TestDepositExceptionCountsDelegatesAndZeroFills(t *testing.T) {
	r, _ := excRig(t)
	c, err := r.svc.DepositExceptionCounts(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if c.Unmapped != 0 || c.Rejected != 0 || !c.OldestLastSeenAt.IsZero() {
		t.Fatalf("counts = %+v, want zero-filled with no rows", c)
	}
	r.store.addException(openExc(excID))
	c, _ = r.svc.DepositExceptionCounts(context.Background())
	if c.Unmapped != 1 || !c.OldestLastSeenAt.Equal(time.Date(2026, 10, 12, 8, 0, 0, 0, time.UTC)) {
		t.Fatalf("counts = %+v", c)
	}
}

func TestDepositExceptionsStoreErrorPropagates(t *testing.T) {
	r, _ := excRig(t)
	r.store.failExc = errors.New("connection reset")
	if _, err := r.svc.DepositExceptions(context.Background(), ExceptionFilter{}); err == nil {
		t.Fatal("a store failure must surface (the handler answers 500, not an empty queue)")
	}
	if _, err := r.svc.DepositExceptionCounts(context.Background()); err == nil {
		t.Fatal("same for the counts")
	}
	if _, err := r.svc.AdminCloseDepositException(context.Background(), "admin:op-1", "k", excID, "n"); err == nil {
		t.Fatal("same for the close")
	}
}
```

- [ ] **Step 2: Run them to watch them fail**

```bash
cd backend && go test -p 2 -run 'TestAdminClose|TestDepositException' ./internal/cryptosvc/
```

Expected: `r.svc.AdminCloseDepositException undefined` (and friends). Red.

- [ ] **Step 3: The three `Service` methods**

Append to `backend/internal/cryptosvc/exceptions.go` and add `"context"` to its import block:

```go
// DepositExceptions is the admin queue read. It is read-only and delegates straight to the
// store: no locks, no row mutation, no reload. It normalizes the (untrusted) filter so every
// caller gets the same default page.
func (s *Service) DepositExceptions(ctx context.Context, f ExceptionFilter) ([]DepositException, error) {
	return s.cfg.Store.DepositExceptions(ctx, f.normalized())
}

// DepositExceptionCounts backs the reconciler view's "why is money stuck" block. Read-only.
func (s *Service) DepositExceptionCounts(ctx context.Context) (DepositExceptionCounts, error) {
	return s.cfg.Store.OpenDepositExceptionCounts(ctx)
}

// AdminCloseDepositException acknowledges an open exception: it records who closed it, when and
// why, and audits old -> new. It NEVER moves money — there is no credit, debit, reversal or
// manual settle on this path (spec §2 non-goals). Ordering, mirroring AdminResolve:
//   - unknown id                            -> ErrDepositExceptionNotFound (404)
//   - already closed                        -> the row, no second audit (an idempotent 200)
//   - resolved by a credit                  -> ErrDepositExceptionResolved (409)
//   - open, and this call wins the update   -> the closed row + one audit
//   - open, but a settle won the race       -> the current row, no audit (nothing was closed)
//
// The whole decision runs under the per-row advisory lock "exception:<id>" so a concurrent
// close, a webhook observation and the reconciler sweep serialize. actor is "admin:<uid>".
func (s *Service) AdminCloseDepositException(ctx context.Context, actor, idemKey, id, note string) (DepositException, error) {
	var out DepositException
	err := s.locked(ctx, "exception:"+id, func(ctx context.Context) error {
		cur, ok, err := s.cfg.Store.DepositExceptionByID(ctx, id)
		if err != nil {
			return err
		}
		if !ok {
			return ErrDepositExceptionNotFound
		}
		switch cur.State {
		case ExceptionClosed:
			out = cur // idempotent repeat: report, do not re-audit
			return nil
		case ExceptionResolved:
			return ErrDepositExceptionResolved
		}
		rec, applied, err := s.cfg.Store.CloseDepositException(ctx, id, actor, note, s.cfg.Now())
		if err != nil {
			return err
		}
		if !applied {
			// Something else moved the row between the read and the conditional update. Report
			// the current state rather than an error the operator cannot act on; a close that
			// did not happen must not be audited as if it had.
			fresh, _, rerr := s.cfg.Store.DepositExceptionByID(ctx, id)
			if rerr != nil {
				return rerr
			}
			out = fresh
			return nil
		}
		out = rec
		s.auditExceptionClosed(ctx, actor, idemKey, cur, rec)
		return nil
	})
	if err != nil {
		return DepositException{}, err
	}
	return out, nil
}

// auditExceptionClosed writes the acknowledgement to the append-only crypto_audit_log. It goes
// through cfg.Audit directly rather than the s.audit helper because the helper cannot set
// EntityType (it would record crypto_swap) or Old (the state before) — both of which this
// action needs. Auditor.Audit returns nothing by contract: a failed audit write never fails the
// close it describes.
func (s *Service) auditExceptionClosed(ctx context.Context, actor, idemKey string, before, after DepositException) {
	if s.cfg.Audit == nil {
		return
	}
	s.cfg.Audit.Audit(ctx, AuditEvent{
		Actor:      actor,
		Action:     "crypto.deposit_exception.closed",
		EntityType: "crypto_deposit_exception",
		EntityID:   after.ID,
		Reason:     after.CloseNote,
		Old:        map[string]any{"state": string(before.State)},
		Detail: map[string]any{
			"state":           string(after.State),
			"kind":            string(after.Kind),
			"provider":        after.Provider,
			"provider_op_id":  after.ProviderOpID,
			"closed_by":       after.ClosedBy,
			"idempotency_key": idemKey,
		},
	})
}
```

- [ ] **Step 4: Run the tests**

```bash
cd backend && go test -p 2 -run 'TestAdminClose|TestDepositException' -v ./internal/cryptosvc/
```

Expected: all PASS. Then the whole package (the exception fake must not disturb the swap suite):

```bash
cd backend && go test -p 2 ./internal/cryptosvc/ | tail -5
```

- [ ] **Step 5: Live-DB proof of the close under the real schema, then commit**

```bash
cd backend && TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  go test -p 2 -run 'TestLive_' ./internal/cryptosvc/ ./internal/crypto/deposit/ | tail -5
```

Expected: `ok` for both packages.

```bash
git add backend/internal/cryptosvc/exceptions.go \
        backend/internal/cryptosvc/exceptions_service_test.go
git commit -m "feat(crypto): audited, idempotent deposit exception close on the service"
```

---

## Task 7: The HTTP surface — two admin routes, validation, and the reconciler tie-in

**Files:**
- Modify: `backend/internal/cryptosvc/exceptions.go` (append `DepositExceptionView`, `exceptionViewOf`, the two handlers, `validExceptionID`; import block gains `net/http`, gin, `ginutil`)
- Modify: `backend/internal/cryptosvc/admin.go` (`RegisterAdminRoutes` +2 routes; `depositReconcilerStatus` restructured to add `open_exceptions`)
- Create: `backend/internal/cryptosvc/exceptions_http_test.go`

**Interfaces:**
- Consumes: `Service.DepositExceptions`, `Service.DepositExceptionCounts`, `Service.AdminCloseDepositException` (Task 6); `fail`, `boundedQuery`, `idemKeyRe`, `maxJSONBytes`, `validSwapID`, `ts`, `reviewDefaultLimit`, `reviewMaxLimit` (existing); `ginutil.UserID`.
- Produces: `GET /api/v1/admin/crypto/deposits/exceptions`, `POST /api/v1/admin/crypto/deposits/exceptions/:id/close`, and `open_exceptions` inside the `GET /deposits/reconciler` body. Task 8's frontend consumes these exact shapes.

Route safety, already checked: the legacy admin plane (`internal/crypto/handler.go:319`) adds exactly one path under `/deposits` — `GET /deposits` — and the owner-scoped `GET /deposits/:id` lives on the **member** group. The new static `/deposits/exceptions` and `/deposits/exceptions/:id/close` therefore sit in a gin tree with no competing wildcard; Step 6 proves it instead of trusting the reading.

- [ ] **Step 1: The view and handlers**

Append to `exceptions.go`, adding `"net/http"`, `"github.com/gin-gonic/gin"` and `"spotlight/backend/go-common/ginutil"` to its imports:

```go
// DepositExceptionView is the admin-console representation of one exception row. Like
// AdminReviewSwap it DOES expose the provider sub-account and operation ids, because ops need
// them to find the transfer at the provider and the surface is gated by crypto.admin. It
// carries no credential material: the row stores none, and
// TestDepositExceptionViewJSONKeys pins the exact key set so a future column cannot ride along
// unnoticed.
type DepositExceptionView struct {
	ID                string `json:"id"`
	Provider          string `json:"provider"`
	ProviderAccountID string `json:"provider_account_id"`
	ProviderOpID      string `json:"provider_op_id"`
	Kind              string `json:"kind"`
	Reason            string `json:"reason"`
	Symbol            string `json:"symbol"`
	Network           string `json:"network"`
	Address           string `json:"address,omitempty"`
	AmountWhole       string `json:"amount_whole"`
	Confirmations     int    `json:"confirmations"`
	RequiredConfs     int    `json:"required_confs"`
	TxHash            string `json:"tx_hash,omitempty"`
	State             string `json:"state"`
	DepositID         string `json:"deposit_id,omitempty"`
	ResolvedUserID    string `json:"resolved_user_id,omitempty"`
	FirstSeenAt       string `json:"first_seen_at"`
	LastSeenAt        string `json:"last_seen_at"`
	SeenCount         int    `json:"seen_count"`
	AgeSeconds        int64  `json:"age_seconds"`
	ClosedAt          string `json:"closed_at,omitempty"`
	ClosedBy          string `json:"closed_by,omitempty"`
	CloseNote         string `json:"close_note,omitempty"`
}

func exceptionViewOf(e DepositException, now time.Time) DepositExceptionView {
	v := DepositExceptionView{
		ID: e.ID, Provider: e.Provider, ProviderAccountID: e.ProviderAccountID, ProviderOpID: e.ProviderOpID,
		Kind: string(e.Kind), Reason: e.Reason, Symbol: e.Symbol, Network: e.Network,
		Address: e.Address, AmountWhole: e.AmountWhole, Confirmations: e.Confirmations,
		RequiredConfs: e.RequiredConfs, TxHash: e.TxHash, State: string(e.State),
		DepositID: e.DepositID, ResolvedUserID: e.ResolvedUserID, SeenCount: e.SeenCount,
		FirstSeenAt: ts(e.FirstSeenAt), LastSeenAt: ts(e.LastSeenAt),
		ClosedAt: ts(e.ClosedAt), ClosedBy: e.ClosedBy, CloseNote: e.CloseNote,
	}
	if !e.LastSeenAt.IsZero() {
		if d := now.Sub(e.LastSeenAt); d > 0 {
			v.AgeSeconds = int64(d.Seconds())
		}
	}
	return v
}

// validExceptionID is the same uuid domain check as validSwapID, under its own name: the two id
// spaces belong to different tables and different endpoints, and a future change to one must not
// silently widen the other.
func validExceptionID(id string) bool { return validSwapID(id) }

// depositExceptions GET /admin/crypto/deposits/exceptions?state=&kind=&provider=&limit=&offset=
// — the queue the settlement engine wrote, oldest stuck transfer first. Read-only.
func (h *adminHandler) depositExceptions(c *gin.Context) {
	state := ExceptionState(strings.TrimSpace(c.Query("state")))
	switch state {
	case "":
		state = ExceptionOpen // the active queue is what "no filter" means
	case ExceptionOpen, ExceptionResolved, ExceptionClosed, ExceptionStateAny:
	default:
		fail(c, http.StatusBadRequest, "bad_state")
		return
	}
	kind := ExceptionKind(strings.TrimSpace(c.Query("kind")))
	switch kind {
	case "":
	case ExceptionKindUnmapped, ExceptionKindRejected:
	default:
		fail(c, http.StatusBadRequest, "bad_kind")
		return
	}
	f := ExceptionFilter{
		State:    state,
		Kind:     kind,
		Provider: strings.TrimSpace(c.Query("provider")),
		Limit:    boundedQuery(c, "limit", reviewDefaultLimit, 1, reviewMaxLimit),
		Offset:   boundedQuery(c, "offset", 0, 0, 1_000_000),
	}
	rows, err := h.d.Service.DepositExceptions(c.Request.Context(), f)
	if err != nil {
		fail(c, http.StatusInternalServerError, "exceptions_list_failed")
		return
	}
	now := h.now()
	out := make([]DepositExceptionView, 0, len(rows))
	for _, e := range rows {
		out = append(out, exceptionViewOf(e, now))
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "exceptions": out, "count": len(out)})
}

// closeExceptionBody is the operator's acknowledgement.
type closeExceptionBody struct {
	Note string `json:"note"`
}

// closeDepositException POST /admin/crypto/deposits/exceptions/:id/close — acknowledge an open
// exception. Idempotency-Key and a non-empty note are mandatory (the same iron-rule pair the
// swap resolve endpoint enforces). This changes NO money state: it stamps who looked at the
// case and why they consider it done. See Service.AdminCloseDepositException for the ordering.
func (h *adminHandler) closeDepositException(c *gin.Context) {
	id := c.Param("id")
	if !validExceptionID(id) {
		fail(c, http.StatusNotFound, "exception_not_found")
		return
	}
	idemKey := c.GetHeader("Idempotency-Key")
	if !idemKeyRe.MatchString(idemKey) {
		fail(c, http.StatusBadRequest, "idempotency_key_required")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxJSONBytes)
	var body closeExceptionBody
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, http.StatusBadRequest, "bad_request")
		return
	}
	note := strings.TrimSpace(body.Note)
	if note == "" {
		fail(c, http.StatusBadRequest, "note_required")
		return
	}
	exc, err := h.d.Service.AdminCloseDepositException(c.Request.Context(), "admin:"+ginutil.UserID(c), idemKey, id, note)
	if err != nil {
		switch {
		case errors.Is(err, ErrDepositExceptionNotFound):
			fail(c, http.StatusNotFound, "exception_not_found")
		case errors.Is(err, ErrDepositExceptionResolved):
			fail(c, http.StatusConflict, "already_resolved")
		default:
			fail(c, http.StatusInternalServerError, "close_failed")
		}
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "exception": exceptionViewOf(exc, h.now())})
}
```

- [ ] **Step 2: Mount the routes**

In `admin.go`'s `RegisterAdminRoutes`, after the `deposits/reconciler` line:

```go
	admin.GET("/deposits/exceptions", h.depositExceptions)
	admin.POST("/deposits/exceptions/:id/close", h.closeDepositException)
```

- [ ] **Step 3: The reconciler tie-in (without breaking the rigs that have no Service)**

`depositReconcilerStatus` currently ends with a single inline `c.JSON(...)`. Replace that final statement with a built payload plus a best-effort count block. The existing test rig `depositReconRig` (`admin_deposit_reconciler_test.go`) mounts the handler with `HandlerDeps{}` — no `Service` — so the block MUST be nil-guarded or the shipped test panics:

```go
	payload := gin.H{
		"success": true,
		"note":    "the deposit reconciler sweeps provider ListDeposits and re-submits each transfer to the once-only settler; it can never double-credit. replica is this process's state; only the elected leader sweeps.",
		"replica": gin.H{
			"started_at": ts(snap.StartedAt), "runs": snap.Runs, "led_runs": snap.LedRuns, "skipped_runs": snap.SkippedRuns,
			"last_run_at": ts(snap.LastRunAt), "last_led_at": ts(snap.LastLedAt), "last_led": snap.LastLed,
			"last_error": snap.LastError,
			"last_result": gin.H{
				"accounts": snap.LastResult.Accounts, "scanned": snap.LastResult.Scanned,
				"settled": snap.LastResult.Settled, "duplicates": snap.LastResult.Duplicates,
				"awaiting": snap.LastResult.Awaiting, "ignored": snap.LastResult.Ignored,
				"truncated": snap.LastResult.Truncated, "errors": snap.LastResult.Errors,
			},
			"totals": gin.H{
				"settled": snap.Totals.Settled, "duplicates": snap.Totals.Duplicates, "awaiting": snap.Totals.Awaiting,
				"ignored": snap.Totals.Ignored, "errors": snap.Totals.Errors,
			},
			"recent_alerts": alerts,
		},
	}
	// The exception queue is the "why" next to the sweep's "what", so "is money stuck?" and
	// "why?" answer from this one view (spec §5). Best-effort by design: a count failure must
	// never turn a working status view into a 5xx, and a build with no Service wired (the
	// admin-view tests, a partially wired app) simply reports no block at all.
	if h.d.Service != nil {
		if cnt, err := h.d.Service.DepositExceptionCounts(c.Request.Context()); err == nil {
			oldest := int64(0)
			if !cnt.OldestLastSeenAt.IsZero() {
				if d := h.now().Sub(cnt.OldestLastSeenAt); d > 0 {
					oldest = int64(d.Seconds())
				}
			}
			payload["open_exceptions"] = gin.H{
				"unmapped": cnt.Unmapped, "rejected": cnt.Rejected, "oldest_age_seconds": oldest,
			}
		}
	}
	c.JSON(http.StatusOK, payload)
```

Only the final `c.JSON(...)` statement changes shape here: it becomes the `payload` local above,
the guarded block, and the trailing `c.JSON(http.StatusOK, payload)`. The `snap` and `alerts`
locals it references already exist a few lines earlier in the same function.

Keep every existing key inside `replica` byte-for-byte; `TestDepositReconcilerStatusReportsCounts` and the account-id non-leak test depend on them.

- [ ] **Step 4: Write the handler tests**

Create `backend/internal/cryptosvc/exceptions_http_test.go`. It reuses `adminHTTPRig` (`admin_test.go:312`, which calls `RegisterAdminRoutes` with the rig's `Service`), `auditSink` (`review_test.go:16`), and the `newSvcRig` clock `r.now` = 2026-10-12T10:00Z.

```go
package cryptosvc

// HTTP surface of the deposit exception queue: query validation, the mandatory idempotency key
// and note, the 404/409 mapping, the exact JSON key set, coexistence with the legacy /deposits
// route, and the reconciler view's open_exceptions block.

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func getExceptions(t *testing.T, r *gin.Engine, qs string) (int, map[string]any) {
	t.Helper()
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/admin/crypto/deposits/exceptions"+qs, nil))
	var out map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	return w.Code, out
}

func postExcClose(t *testing.T, r *gin.Engine, id string, body any, hdr map[string]string) (int, map[string]any) {
	t.Helper()
	var buf []byte
	if body != nil {
		buf, _ = json.Marshal(body)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/crypto/deposits/exceptions/"+id+"/close", bytes.NewReader(buf))
	req.Header.Set("Content-Type", "application/json")
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var out map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	return w.Code, out
}

func httpExcRig(t *testing.T) (*svcRig, *auditSink, *gin.Engine) {
	t.Helper()
	r, sink := excRig(t)
	return r, sink, adminHTTPRig(t, r, "op-42")
}

func TestExceptionsHTTPListDefaultsAndFilters(t *testing.T) {
	r, _, e := httpExcRig(t)
	r.store.addException(openExc(excID))

	if code, body := getExceptions(t, e, ""); code != http.StatusOK {
		t.Fatalf("GET default -> %d %v", code, body)
	}
	if f := r.store.lastExcFilter; f.State != ExceptionOpen || f.Limit != reviewDefaultLimit || f.Offset != 0 {
		t.Fatalf("default filter = %+v, want open / %d / 0", f, reviewDefaultLimit)
	}
	for _, qs := range []string{"?state=all", "?state=closed", "?state=resolved", "?state=open", "?kind=unmapped", "?kind=rejected", "?provider=quidax"} {
		if code, body := getExceptions(t, e, qs); code != http.StatusOK {
			t.Fatalf("GET %s -> %d %v", qs, code, body)
		}
	}
	if code, body := getExceptions(t, e, "?state=pending"); code != http.StatusBadRequest || body["error"] != "bad_state" {
		t.Fatalf("bad state -> %d %v", code, body)
	}
	if code, body := getExceptions(t, e, "?kind=credited"); code != http.StatusBadRequest || body["error"] != "bad_kind" {
		t.Fatalf("bad kind -> %d %v", code, body)
	}
	// A hostile page size is clamped, never honoured.
	if _, body := getExceptions(t, e, "?limit=99999999"); body["success"] != true {
		t.Fatalf("body = %v", body)
	}
	if got := r.store.lastExcFilter.Limit; got != reviewMaxLimit {
		t.Fatalf("limit = %d, want the clamp %d", got, reviewMaxLimit)
	}
}

func TestExceptionsHTTPListPayloadShape(t *testing.T) {
	r, _, e := httpExcRig(t)
	row := openExc(excID)
	row.Reason = "no owner for provider sub-account acct-orphan"
	r.store.addException(row)

	code, body := getExceptions(t, e, "?state=all")
	if code != http.StatusOK || body["success"] != true {
		t.Fatalf("%d %v", code, body)
	}
	if body["count"].(float64) != 1 {
		t.Fatalf("count = %v", body["count"])
	}
	list := body["exceptions"].([]any)
	view := list[0].(map[string]any)
	keys := make([]string, 0, len(view))
	for k := range view {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	want := []string{
		"age_seconds", "amount_whole", "confirmations", "first_seen_at", "id", "kind", "last_seen_at",
		"network", "provider", "provider_account_id", "provider_op_id", "reason", "required_confs",
		"seen_count", "state", "symbol",
	}
	if strings.Join(keys, ",") != strings.Join(want, ",") {
		t.Fatalf("keys = %v, want exactly %v (omitempty hides the rest for an open row)", keys, want)
	}
	if view["age_seconds"].(float64) <= 0 {
		t.Fatalf("age_seconds = %v, want the rig clock minus last_seen_at", view["age_seconds"])
	}
	if view["state"] != "open" || view["kind"] != "unmapped" {
		t.Fatalf("view = %v", view)
	}
}

func TestExceptionsHTTPCloseValidation(t *testing.T) {
	r, sink, e := httpExcRig(t)
	r.store.addException(openExc(excID))
	idem := map[string]string{"Idempotency-Key": "close-1"}

	// A malformed id is a 404 before anything else — never a 500 from the store.
	for _, bad := range []string{"not-a-uuid", "1%3B%20drop%20table"} {
		if code, body := postExcClose(t, e, bad, map[string]any{"note": "x"}, idem); code != http.StatusNotFound || body["error"] != "exception_not_found" {
			t.Fatalf("%q -> %d %v", bad, code, body)
		}
	}
	// An encoded slash decodes to an extra path segment, so it can 404 in gin's router before the
	// handler runs. Only the status is promised here — that is the security property (no 5xx, no
	// store round trip), and review_test.go pins the same ids the same way.
	wBad := httptest.NewRecorder()
	e.ServeHTTP(wBad, httptest.NewRequest(http.MethodPost, "/api/v1/admin/crypto/deposits/exceptions/..%2Fetc/close", nil))
	if wBad.Code != http.StatusNotFound {
		t.Fatalf("..%%2Fetc -> %d, want 404", wBad.Code)
	}
	// The iron-rule pair: no key, no note.
	if code, body := postExcClose(t, e, excID, map[string]any{"note": "x"}, nil); code != http.StatusBadRequest || body["error"] != "idempotency_key_required" {
		t.Fatalf("missing key -> %d %v", code, body)
	}
	if code, body := postExcClose(t, e, excID, map[string]any{"note": "   "}, idem); code != http.StatusBadRequest || body["error"] != "note_required" {
		t.Fatalf("blank note -> %d %v", code, body)
	}
	if code, body := postExcClose(t, e, excID, nil, idem); code != http.StatusBadRequest || body["error"] != "bad_request" {
		t.Fatalf("empty body -> %d %v", code, body)
	}
	// An unknown but well-formed id is a 404.
	if code, body := postExcClose(t, e, "0c0c0c0c-0000-4000-8000-00000000000c", map[string]any{"note": "x"}, idem); code != http.StatusNotFound || body["error"] != "exception_not_found" {
		t.Fatalf("unknown id -> %d %v", code, body)
	}
	if len(sink.ev) != 0 {
		t.Fatalf("a rejected request must not audit: %v", sink.actions())
	}

	code, body := postExcClose(t, e, excID, map[string]any{"note": "  acknowledged on the provider dashboard  "}, idem)
	if code != http.StatusOK || body["success"] != true {
		t.Fatalf("happy close -> %d %v", code, body)
	}
	view := body["exception"].(map[string]any)
	if view["state"] != "closed" || view["closed_by"] != "admin:op-42" ||
		view["close_note"] != "acknowledged on the provider dashboard" {
		t.Fatalf("view = %v", view)
	}
	if len(sink.ev) != 1 || sink.ev[0].Actor != "admin:op-42" {
		t.Fatalf("audit = %v", sink.actions())
	}
}

func TestExceptionsHTTPCloseResolvedIs409(t *testing.T) {
	r, _, e := httpExcRig(t)
	row := openExc(excID)
	row.State, row.DepositID = ExceptionResolved, "dep-1"
	r.store.addException(row)
	code, body := postExcClose(t, e, excID, map[string]any{"note": "x"}, map[string]string{"Idempotency-Key": "k"})
	if code != http.StatusConflict || body["error"] != "already_resolved" {
		t.Fatalf("%d %v — a credited transfer is not closeable", code, body)
	}
}

// TestAdminRoutesCoexistWithTheLegacyDepositsRoute guards the one thing a route addition can
// break globally: gin panics while building the tree if two patterns conflict. The legacy
// crypto plane registers exactly GET /deposits on the same admin group
// (internal/crypto/handler.go:319); the owner-scoped GET /deposits/:id is on the MEMBER group.
// Registering both here, in the order the app does, proves the new static segment and the new
// :id wildcard fit the tree.
func TestAdminRoutesCoexistWithTheLegacyDepositsRoute(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := newSvcRig(t)
	e := gin.New()
	grp := e.Group("/api/v1/admin/crypto")
	grp.GET("/deposits", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"legacy": true}) })
	// RegisterAdminRoutes panics while building the tree if any of its patterns conflicts, so
	// this line is itself the assertion.
	RegisterAdminRoutes(grp, HandlerDeps{Service: r.svc})

	w := httptest.NewRecorder()
	e.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/admin/crypto/deposits", nil))
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), "legacy") {
		t.Fatalf("legacy GET /deposits -> %d %s", w.Code, w.Body.String())
	}
	if code, _ := getExceptions(t, e, ""); code != http.StatusOK {
		t.Fatalf("GET /deposits/exceptions -> %d", code)
	}
	if code, body := postExcClose(t, e, excID, map[string]any{"note": "x"}, map[string]string{"Idempotency-Key": "k"}); code != http.StatusNotFound {
		t.Fatalf("POST /deposits/exceptions/:id/close -> %d %v", code, body) // the rig store is empty
	}
	w2 := httptest.NewRecorder()
	e.ServeHTTP(w2, httptest.NewRequest(http.MethodGet, "/api/v1/admin/crypto/deposits/reconciler", nil))
	if w2.Code != http.StatusServiceUnavailable {
		t.Fatalf("GET /deposits/reconciler -> %d, want 503 with no reconciler wired", w2.Code)
	}
}

// TestDepositReconcilerStatusReportsOpenExceptions wires a real reconciler AND a Service and
// asserts the new block; the nil-Service half is already covered by the shipped
// TestDepositReconcilerStatusReportsCounts, which must keep passing unchanged.
func TestDepositReconcilerStatusReportsOpenExceptions(t *testing.T) {
	s, _ := excRig(t)
	gin.SetMode(gin.TestMode)
	// The mock provider is registered but never seeded: this test asserts the counts block, and
	// the reconciler's own sweep behaviour is covered by deposit_reconciler_test.go.
	reg, _ := newMockRegistry("quidax")
	rec := NewDepositReconciler(DepositReconcilerConfig{
		ProviderName: "quidax", Registry: reg,
		Settler:  &recordingSettler{outcome: OutcomeApplied},
		Accounts: fakeAccounts{byProvider: map[string][]string{"quidax": {"acct-1"}}},
		Leader:   fakeLeader{lead: true},
		Alert:    func(string, string) {},
	})
	unmapped := openExc(excID)
	unmapped.LastSeenAt = s.now.Add(-90 * time.Minute) // the oldest open row -> 5400s at the rig clock
	s.store.addException(unmapped)
	rejected := openExc("0d0d0d0d-0000-4000-8000-00000000000d")
	rejected.Kind, rejected.ProviderOpID = ExceptionKindRejected, "op-rejected"
	rejected.LastSeenAt = s.now.Add(-10 * time.Minute)
	s.store.addException(rejected)

	h := &adminHandler{d: HandlerDeps{DepositRecon: rec, Service: s.svc}, now: func() time.Time { return s.now }}
	e := gin.New()
	e.Group("/api/v1/admin/crypto").GET("/deposits/reconciler", h.depositReconcilerStatus)

	w := httptest.NewRecorder()
	e.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/admin/crypto/deposits/reconciler", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("status %d body %s", w.Code, w.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	blk, ok := body["open_exceptions"].(map[string]any)
	if !ok {
		t.Fatalf("no open_exceptions block: %s", w.Body.String())
	}
	if blk["unmapped"].(float64) != 1 || blk["rejected"].(float64) != 1 {
		t.Fatalf("block = %v", blk)
	}
	if age := blk["oldest_age_seconds"].(float64); age < 90*60-1 || age > 90*60+1 {
		t.Fatalf("oldest_age_seconds = %v, want ~5400", age)
	}
	// The replica block the shipped test asserts on must survive the restructure.
	if body["replica"] == nil {
		t.Fatal("replica block gone")
	}
}
```

- [ ] **Step 5: Run everything**

```bash
cd backend && go build ./... && go test -p 2 -run 'TestExceptions|TestAdminRoutes|TestDeposit' -v ./internal/cryptosvc/
```

Expected: all PASS. `TestAdminRoutesCoexistWithTheLegacyDepositsRoute` failing with a gin panic means the path really does collide — re-read `internal/crypto/handler.go:319` before changing anything.

```bash
cd backend && go test -p 2 ./internal/cryptosvc/ ./internal/crypto/... | tail -8
```

Expected: `ok`. Especially: `TestDepositReconcilerStatusReportsCounts`, `TestDepositReconcilerStatusIs503WhenNotWired`, `TestDepositReconcilerStatusDoesNotLeakAccountIDs` — the nil-`Service` rig is Step 3's whole reason.

```bash
cd backend && TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" go test -p 2 ./internal/cryptosvc/ | tail -3
```

Expected: `ok`.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/cryptosvc/exceptions.go backend/internal/cryptosvc/admin.go \
        backend/internal/cryptosvc/exceptions_http_test.go
git commit -m "feat(crypto): admin deposit exception queue endpoints and reconciler counts"
```

---

## Task 8: frontend-admin — types and service functions

**Files:**
- Modify: `frontend-admin/src/types/cryptoAdmin.ts` (after `CryptoDepositReconcilerStatus`'s siblings, near line 279)
- Modify: `frontend-admin/src/services/cryptoAdminService.ts` (end of the deposits section, after `adminGetDepositReconcilerStatus`)
- Create: `frontend-admin/src/services/cryptoDepositExceptions.test.ts`

**Interfaces:**
- Consumes: Task 7's `GET /admin/crypto/deposits/exceptions` (`{success, exceptions, count}`), `POST /admin/crypto/deposits/exceptions/:id/close` (`{success, exception}`), and `open_exceptions` on the reconciler body. Existing helpers only: `base()`, `authHeaders()`, `parseErrorMessage()`, `delay()`, `USE_MOCK`, `NOT_IN_FIXTURE_MODE`, `operationKey`.
- Produces: `CryptoDepositException`, `CryptoDepositOpenExceptions`, `CryptoDepositReconcilerStatus.open_exceptions?`, `adminListDepositExceptions(state, limit, offset, kind)`, `adminCloseDepositException(id, note)`. Task 9's panel calls only those two functions.

- [ ] **Step 1: Write the failing service tests**

Create `frontend-admin/src/services/cryptoDepositExceptions.test.ts`, following the convention of `cryptoReconcilerService.test.ts` (node environment, stubbed `fetch`, fresh module import per test):

```ts
// @vitest-environment node
/**
 * Deposit exception client: the queue the settlement engine wrote. A list that is not mounted
 * is an empty queue, not an error; closing is a money-adjacent mutation, so the note is enforced
 * client-side too and fixture mode refuses loudly instead of pretending.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

const ROW = {
  id: '0a0a0a0a-0000-4000-8000-00000000000a', provider: 'quidax',
  provider_account_id: 'acct-orphan', provider_op_id: 'qdx_dep_7001',
  kind: 'unmapped', reason: 'no owner for provider sub-account acct-orphan',
  symbol: 'BTC', network: 'bitcoin', amount_whole: '0.001',
  confirmations: 9, required_confs: 0, state: 'open',
  first_seen_at: '2026-10-14T08:00:00Z', last_seen_at: '2026-10-14T08:30:00Z',
  seen_count: 4, age_seconds: 5400,
};

function respond(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body });
}
async function load() {
  vi.resetModules();
  return import('@/services/cryptoAdminService');
}

describe('adminListDepositExceptions', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it('requests the open queue and reads the exceptions array', async () => {
    const fetchMock = respond(200, { success: true, exceptions: [ROW], count: 1 });
    vi.stubGlobal('fetch', fetchMock);
    const m = await load();
    const rows = await m.adminListDepositExceptions('open', 50, 0);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/admin/crypto/deposits/exceptions?');
    expect(url).toContain('state=open');
    expect(url).toContain('limit=50');
    expect(url).not.toContain('kind=');
    expect(rows[0].provider_op_id).toBe('qdx_dep_7001');
  });

  it('adds kind and passes state=all through', async () => {
    const fetchMock = respond(200, { success: true, exceptions: [], count: 0 });
    vi.stubGlobal('fetch', fetchMock);
    const m = await load();
    expect(await m.adminListDepositExceptions('all', 20, 40, 'rejected')).toEqual([]);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('state=all');
    expect(url).toContain('offset=40');
    expect(url).toContain('kind=rejected');
  });

  it('treats an unmounted queue (404) as empty and a 500 as an error', async () => {
    vi.stubGlobal('fetch', respond(404, { error: 'not_found' }));
    const m = await load();
    expect(await m.adminListDepositExceptions()).toEqual([]);
    vi.stubGlobal('fetch', respond(500, { error: 'exceptions_list_failed' }));
    await expect(m.adminListDepositExceptions()).rejects.toThrow();
  });
});

describe('adminCloseDepositException', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it('posts the trimmed note with a derived Idempotency-Key', async () => {
    const fetchMock = respond(200, { success: true, exception: { ...ROW, state: 'closed' } });
    vi.stubGlobal('fetch', fetchMock);
    const m = await load();
    const out = await m.adminCloseDepositException(ROW.id, '  provider confirms it never landed  ');
    expect(out.state).toBe('closed');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain(`/admin/crypto/deposits/exceptions/${ROW.id}/close`);
    expect(init.method).toBe('POST');
    expect(init.headers['Idempotency-Key']).toBe(`admin:crypto:deposit-exception-close:${ROW.id}`);
    expect(JSON.parse(init.body)).toEqual({ note: 'provider confirms it never landed' });
  });

  it('refuses to post an empty note', async () => {
    const fetchMock = respond(200, { success: true, exception: ROW });
    vi.stubGlobal('fetch', fetchMock);
    const m = await load();
    await expect(m.adminCloseDepositException(ROW.id, '   ')).rejects.toThrow(/note is required/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces 409 already_resolved rather than hiding it', async () => {
    vi.stubGlobal('fetch', respond(409, { error: 'already_resolved' }));
    const m = await load();
    await expect(m.adminCloseDepositException(ROW.id, 'x')).rejects.toThrow(/already_resolved|close failed/i);
  });

  it('never simulates a close in fixture mode', async () => {
    vi.stubEnv('NEXT_PUBLIC_CRYPTO_ADMIN_USE_MOCK', 'true');
    const fetchMock = respond(200, { success: true, exception: ROW });
    vi.stubGlobal('fetch', fetchMock);
    const m = await load();
    await expect(m.adminCloseDepositException(ROW.id, 'x')).rejects.toThrow(/FIXTURE|fixture/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('adminGetDepositReconcilerStatus with the exception block', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it('passes open_exceptions through, and stays valid when it is absent', async () => {
    const base = { success: true, note: 'n', replica: { started_at: '', runs: 0, led_runs: 0, skipped_runs: 0, last_run_at: '', last_led_at: '', last_led: false, last_error: '', last_result: { accounts: 0, scanned: 0, settled: 0, duplicates: 0, awaiting: 0, ignored: 0, truncated: false, errors: 0 }, totals: { settled: 0, duplicates: 0, awaiting: 0, ignored: 0, errors: 0 }, recent_alerts: [] } };
    vi.stubGlobal('fetch', respond(200, { ...base, open_exceptions: { unmapped: 2, rejected: 1, oldest_age_seconds: 7200 } }));
    const m = await load();
    const withBlock = await m.adminGetDepositReconcilerStatus();
    expect(withBlock?.open_exceptions).toEqual({ unmapped: 2, rejected: 1, oldest_age_seconds: 7200 });
    vi.stubGlobal('fetch', respond(200, base));
    const without = await m.adminGetDepositReconcilerStatus();
    expect(without?.open_exceptions).toBeUndefined();
  });
});
```

```bash
cd frontend-admin && npx vitest run src/services/cryptoDepositExceptions.test.ts
```

Expected: FAIL — `adminListDepositExceptions is not a function`.

- [ ] **Step 2: The types**

In `src/types/cryptoAdmin.ts`, after `CryptoDeposit` (before `CryptoDepositReconcilerStatus`):

```ts
// GET /admin/crypto/deposits/exceptions — inbound transfers the settlement engine DECIDED NOT
// to credit. A row means money did NOT move to a customer: kind 'unmapped' = no customer owns
// that provider sub-account, 'rejected' = not final or an uncreditable amount. 'state' is the
// queue lifecycle (open -> closed by an operator, or -> resolved when a credit lands).
// amount_whole is the provider's whole-unit figure as TEXT because an unmapped transfer has no
// resolved minor-unit scale and a rejected one may have no valid minor-unit form; never render
// it with fmtUnits().
export interface CryptoDepositException {
  id: string;
  provider: string;
  provider_account_id: string;
  provider_op_id: string;
  kind: 'unmapped' | 'rejected';
  reason: string;
  symbol: string;
  network: string;
  address?: string;
  amount_whole: string;
  confirmations: number;
  required_confs: number;
  tx_hash?: string;
  state: 'open' | 'resolved' | 'closed';
  deposit_id?: string;
  resolved_user_id?: string;
  first_seen_at: string;
  last_seen_at: string;
  seen_count: number;
  age_seconds: number;
  closed_at?: string;
  closed_by?: string;
  close_note?: string;
}

// The open half of that queue, grouped: the "why is money stuck" block the reconciler view
// carries so ops need only one request.
export interface CryptoDepositOpenExceptions {
  unmapped: number;
  rejected: number;
  oldest_age_seconds: number;
}
```

and add ONE optional field to `CryptoDepositReconcilerStatus`, after `note`:

```ts
  // Absent when the exception queue could not be counted (no service wired, or the count
  // failed) — never zero-by-default.
  open_exceptions?: CryptoDepositOpenExceptions;
```

- [ ] **Step 3: The two service functions**

Append to the deposits section of `src/services/cryptoAdminService.ts`, after `adminGetDepositReconcilerStatus`. Also add `open_exceptions: { unmapped: 1, rejected: 1, oldest_age_seconds: 5400 }` to `MOCK_DEPOSIT_RECONCILER` so fixture mode renders the block, and add the two new type names to the file's existing `import type { … } from '@/types/cryptoAdmin'` block:

```ts
// GET /admin/crypto/deposits/exceptions — the queue of transfers the engine refused to credit
// (backend/internal/cryptosvc, table crypto_deposit_exceptions). DISTINCT from
// adminListDeposits above, which is settled money-IN history. Read-only, crypto.admin. A 404
// (routes not mounted / feature off) is an empty queue, not an error.
const MOCK_DEPOSIT_EXCEPTIONS: CryptoDepositException[] = [
  { id: '0a0a0a0a-0000-4000-8000-00000000000a', provider: 'quidax', provider_account_id: 'acct_orphan_1', provider_op_id: 'qdx_dep_7001', kind: 'unmapped', reason: 'no owner for provider sub-account acct_orphan_1', symbol: 'BTC', network: 'bitcoin', address: 'bc1qorphan', amount_whole: '0.001', confirmations: 9, required_confs: 0, tx_hash: '0xaaaa', state: 'open', first_seen_at: iso(90), last_seen_at: iso(90), seen_count: 4, age_seconds: 5400 },
  { id: '0b0b0b0b-0000-4000-8000-00000000000b', provider: 'quidax', provider_account_id: 'acct_2b9e', provider_op_id: 'qdx_dep_7002', kind: 'rejected', reason: 'transfer is not final (reorged)', symbol: 'USDT', network: 'ethereum', amount_whole: '15', confirmations: 1, required_confs: 12, state: 'open', first_seen_at: iso(30), last_seen_at: iso(2), seen_count: 2, age_seconds: 120 },
];

export async function adminListDepositExceptions(
  state = 'open', limit = 50, offset = 0, kind = '',
): Promise<CryptoDepositException[]> {
  if (USE_MOCK) {
    await delay();
    return kind ? MOCK_DEPOSIT_EXCEPTIONS.filter((e) => e.kind === kind) : [...MOCK_DEPOSIT_EXCEPTIONS];
  }
  const qs = new URLSearchParams({ state, limit: String(limit), offset: String(offset) });
  if (kind) qs.set('kind', kind);
  const res = await fetch(`${base()}/deposits/exceptions?${qs.toString()}`, { cache: 'no-store', headers: authHeaders() });
  if (res.status === 404) return []; // feature off / routes not mounted — nothing to review
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Deposit exceptions fetch failed'));
  const body = await res.json();
  return body?.exceptions ?? [];
}

// POST /admin/crypto/deposits/exceptions/:id/close — acknowledge an open exception. It moves NO
// money (there is nothing to credit or refund here); the mandatory note is what makes the
// acknowledgement auditable, so it is enforced client-side too, and fixture mode refuses loudly
// rather than reporting a close it did not perform (see adminResolveReviewSwap /
// ADMIN_SIMULATED_WRITES.md). The key is derived from the exception id, so a double click
// dedupes at the backend instead of double-posting.
export async function adminCloseDepositException(id: string, note: string): Promise<CryptoDepositException> {
  if (!note.trim()) throw new Error('An operator note is required to close a deposit exception.');
  if (USE_MOCK) throw new Error(`Closing a deposit exception ${NOT_IN_FIXTURE_MODE}`);
  const res = await fetch(`${base()}/deposits/exceptions/${encodeURIComponent(id)}/close`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Idempotency-Key': operationKey('crypto:deposit-exception-close', id) },
    body: JSON.stringify({ note: note.trim() }),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Deposit exception close failed'));
  const body = await res.json();
  return body?.exception ?? body;
}
```

- [ ] **Step 4: Run the gate**

```bash
cd frontend-admin && npx vitest run src/services/cryptoDepositExceptions.test.ts && npm run type-check
```

Expected: the new spec green, `tsc` exit 0. Then the whole suite (the type addition must not disturb any existing assertion):

```bash
cd frontend-admin && npm run test 2>&1 | tail -15
```

Expected: no failures. If `deposits.test.tsx` fails now, it is because the page does not yet render the panel and the mocked service is not yet extended — that is Task 9, not a regression here. Confirm the failure is only in that file before moving on.

- [ ] **Step 5: Commit**

```bash
git add frontend-admin/src/types/cryptoAdmin.ts frontend-admin/src/services/cryptoAdminService.ts \
        frontend-admin/src/services/cryptoDepositExceptions.test.ts
git commit -m "feat(admin-ui): deposit exception queue client and types"
```

---

## Task 9: frontend-admin — the Exceptions panel on the Deposits tab

**Files:**
- Create: `frontend-admin/app/admin/crypto/deposits/ExceptionsPanel.tsx`
- Create: `frontend-admin/app/admin/crypto/deposits/exceptions-panel.test.tsx`
- Modify: `frontend-admin/app/admin/crypto/deposits/page.tsx` (mount the panel, one KPI on the reconciler strip, corrected `DisclosureNote` copy)
- Modify: `frontend-admin/app/admin/crypto/deposits/deposits.test.tsx` (mock the two new service functions, update the copy assertion, assert the panel mounts)

**Interfaces:**
- Consumes: `adminListDepositExceptions`, `adminCloseDepositException` (Task 8), `CryptoDepositException`, `CryptoDepositOpenExceptions`, and the existing `_ui` pieces only (`Card`, `Kpi`, `StateBlock`, `DisclosureNote`-style `AuditNote`, `PermissionBanner`, `FilterBar`, `StatusBadge`, `label`, `select`, `textarea`, `mono`, `fmtAge`, `CRYPTO_PERMS`) plus `vuexy`'s `Button`, `colors`, `thCell`, `tdCell`.
- Produces: `ExceptionsPanel({ canAdmin, globalCounts })`, mounted once by the page.

`canAdmin` arrives as a **prop**, and `globalCounts` as an optional prop: calling `useCryptoPermission` inside the panel would force its test to mock `../_ui` (as `fees.test.tsx` does). The page already knows the answer, so passing it down keeps both tests honest and dependency-free.

- [ ] **Step 1: Write the failing panel tests**

Create `frontend-admin/app/admin/crypto/deposits/exceptions-panel.test.tsx`:

```ts
/**
 * The deposit exception queue panel: transfers the settlement engine refused to credit.
 * Read-mostly — the one action is an acknowledged close that moves no money.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CryptoDepositException, CryptoDepositOpenExceptions } from '@/types/cryptoAdmin';

const mockList = vi.fn();
const mockClose = vi.fn();
vi.mock('@/services/cryptoAdminService', async () => ({
  ...(await vi.importActual<typeof import('@/services/cryptoAdminService')>('@/services/cryptoAdminService')),
  adminListDepositExceptions: (...a: unknown[]) => mockList(...a),
  adminCloseDepositException: (...a: unknown[]) => mockClose(...a),
}));

import ExceptionsPanel from './ExceptionsPanel';

const open = (over: Partial<CryptoDepositException> = {}): CryptoDepositException => ({
  id: '0a0a0a0a-0000-4000-8000-00000000000a', provider: 'quidax',
  provider_account_id: 'acct_orphan_1', provider_op_id: 'qdx_dep_7001', kind: 'unmapped',
  reason: 'no owner for provider sub-account acct_orphan_1', symbol: 'BTC', network: 'bitcoin',
  amount_whole: '0.001', confirmations: 9, required_confs: 0, state: 'open',
  first_seen_at: '2026-10-14T08:00:00Z', last_seen_at: '2026-10-14T08:30:00Z',
  seen_count: 4, age_seconds: 5400, ...over,
});

async function mounted(
  rows: CryptoDepositException[],
  canAdmin = true,
  globalCounts: CryptoDepositOpenExceptions | null = null,
) {
  mockList.mockResolvedValue(rows);
  render(<ExceptionsPanel canAdmin={canAdmin} globalCounts={globalCounts} />);
  await waitFor(() => expect(mockList).toHaveBeenCalled());
}

beforeEach(() => { mockList.mockReset(); mockClose.mockReset(); });
afterEach(() => { cleanup(); });

describe('Deposit exceptions panel', () => {
  it('lists an unmapped transfer with its kind, reason, whole-unit amount and age', async () => {
    await mounted([open()]);
    expect(await screen.findByText('unmapped')).toBeTruthy();
    expect(screen.getByText('qdx_dep_7001')).toBeTruthy();
    expect(screen.getByText('acct_orphan_1')).toBeTruthy();
    expect(screen.getByText('no owner for provider sub-account acct_orphan_1')).toBeTruthy();
    // amount_whole is provider text, rendered verbatim with the symbol — never via fmtUnits.
    expect(screen.getByText('0.001 BTC')).toBeTruthy();
    expect(screen.getByText('9/0')).toBeTruthy();
    expect(screen.getByText(/1h 30m/)).toBeTruthy();
  });

  it('shows how many times a transfer was observed, because that is the stuck signal', async () => {
    await mounted([open(), open({ id: '0b0b0b0b-0000-4000-8000-00000000000b', kind: 'rejected', seen_count: 1, provider_op_id: 'qdx_dep_7002' })]);
    expect(await screen.findByText('×4')).toBeTruthy();
    expect(screen.queryByText('×1')).toBeNull();
  });

  it('requires a non-empty note before it will close', async () => {
    mockClose.mockResolvedValue(open({ state: 'closed' }));
    await mounted([open()]);
    fireEvent.click(await screen.findByRole('button', { name: /close/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirm close/i }));
    expect(mockClose).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm close/i }));
    expect(mockClose).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'provider dashboard shows no such transfer' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm close/i }));
    await waitFor(() => expect(mockClose).toHaveBeenCalledWith('0a0a0a0a-0000-4000-8000-00000000000a', 'provider dashboard shows no such transfer'));
  });

  it('reports the close and re-reads the queue', async () => {
    mockClose.mockResolvedValue(open({ state: 'closed' }));
    await mounted([open()]);
    fireEvent.click(await screen.findByRole('button', { name: /close/i }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'acknowledged' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm close/i }));
    expect(await screen.findByText(/acknowledged/i)).toBeTruthy();
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('surfaces a close failure without losing the row', async () => {
    mockClose.mockRejectedValue(new Error('Error: already_resolved'));
    await mounted([open()]);
    fireEvent.click(await screen.findByRole('button', { name: /close/i }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'try' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm close/i }));
    expect(await screen.findByText(/already_resolved/i)).toBeTruthy();
    expect(screen.getByText('qdx_dep_7001')).toBeTruthy();
  });

  it('filters by state and kind, and resets the page', async () => {
    await mounted([open()]);
    mockList.mockClear();
    fireEvent.change(screen.getByLabelText(/^queue state/i), { target: { value: 'all' } });
    await waitFor(() => expect(mockList).toHaveBeenCalledWith('all', 50, 0, ''));
    mockList.mockClear();
    fireEvent.change(screen.getByLabelText(/^kind/i), { target: { value: 'rejected' } });
    await waitFor(() => expect(mockList).toHaveBeenCalledWith('all', 50, 0, 'rejected'));
  });

  it('shows the global open counts when the page has them, and page counts when it does not', async () => {
    await mounted([open()], true, { unmapped: 7, rejected: 3, oldest_age_seconds: 90 });
    expect(await screen.findByText('Open exceptions (all)')).toBeTruthy();
    expect(screen.getByText('10')).toBeTruthy();
    cleanup();
    mockList.mockReset();
    await mounted([open()]);
    expect(screen.queryByText('Open exceptions (all)')).toBeNull();
    expect(screen.getByText('Open exceptions (this page)')).toBeTruthy();
  });

  it('offers no close control without crypto.admin, and no rows at all in the empty state', async () => {
    await mounted([open()], false);
    await screen.findByText('qdx_dep_7001');
    expect(screen.queryByRole('button', { name: /close/i })).toBeNull();
    cleanup();
    mockList.mockReset();
    await mounted([]);
    expect(await screen.findByText(/no deposit exceptions/i)).toBeTruthy();
  });

  it('surfaces a list failure', async () => {
    mockList.mockRejectedValue(new Error('Error: exceptions_list_failed'));
    render(<ExceptionsPanel canAdmin />);
    expect(await screen.findByText(/exceptions_list_failed/i)).toBeTruthy();
  });
});
```

```bash
cd frontend-admin && npx vitest run app/admin/crypto/deposits/exceptions-panel.test.tsx
```

Expected: FAIL — cannot resolve `./ExceptionsPanel`.

- [ ] **Step 2: The panel**

Create `frontend-admin/app/admin/crypto/deposits/ExceptionsPanel.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminCloseDepositException, adminListDepositExceptions } from '@/services/cryptoAdminService';
import type { CryptoDepositException, CryptoDepositOpenExceptions } from '@/types/cryptoAdmin';
import {
  Card, Kpi, StateBlock, PermissionBanner, FilterBar, StatusBadge, AuditNote,
  label as lbl, select, textarea, mono, fmtAge, fmtDate, CRYPTO_PERMS,
} from '../_ui';
import { Button, colors, thCell, tdCell } from '@/components/ui/vuexy';

const PAGE_SIZE = 50;

/**
 * The queue the settlement engine wrote: inbound transfers it DECIDED not to credit
 * (spec 2026-10-22 §5). Closing a row acknowledges the case was investigated; it moves no
 * money, and if the transfer is ever credited the row flips to `resolved` on its own.
 * `canAdmin` and `globalCounts` come from the page so this component needs no auth or
 * reconciler hook of its own.
 */
export default function ExceptionsPanel({
  canAdmin,
  globalCounts = null,
}: {
  canAdmin: boolean;
  globalCounts?: CryptoDepositOpenExceptions | null;
}) {
  const [rows, setRows] = useState<CryptoDepositException[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [state, setState] = useState('open');
  const [kind, setKind] = useState('');
  const [offset, setOffset] = useState(0);
  const [active, setActive] = useState<CryptoDepositException | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (st: string, k: string, off: number) => {
    setLoading(true); setError(null);
    try { setRows(await adminListDepositExceptions(st, PAGE_SIZE, off, k)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(state, kind, offset); }, [state, kind, offset, load]);

  const pageOpen = rows.filter((r) => r.state === 'open');
  const pageUnmapped = pageOpen.filter((r) => r.kind === 'unmapped').length;
  const oldest = pageOpen.reduce((m, r) => Math.max(m, r.age_seconds || 0), 0);
  const noteMissing = note.trim().length === 0;

  async function submit() {
    if (!active || noteMissing) return;
    setBusy(true); setError(null);
    try {
      const closed = await adminCloseDepositException(active.id, note);
      setMsg(`Exception ${closed.id} closed by ${closed.closed_by || 'you'} — noted for the audit log: "${note.trim()}". No money moved; if this transfer is ever credited, the row resolves itself.`);
      setActive(null); setNote('');
      await load(state, kind, offset);
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ marginTop: '1.25rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
        {globalCounts ? (
          <Kpi
            label="Open exceptions (all)"
            value={String(globalCounts.unmapped + globalCounts.rejected)}
            accent={globalCounts.unmapped + globalCounts.rejected ? colors.danger : undefined}
            sub={`${globalCounts.unmapped} unmapped · ${globalCounts.rejected} rejected · oldest ${fmtAge(globalCounts.oldest_age_seconds)}`}
          />
        ) : (
          <Kpi
            label="Open exceptions (this page)"
            value={String(pageOpen.length)}
            accent={pageOpen.length ? colors.danger : undefined}
            sub={`${pageUnmapped} unmapped · oldest ${fmtAge(oldest)}`}
          />
        )}
      </div>

      {active && (
        <div style={{ marginBottom: '1rem' }}>
          <Card title={`Close deposit exception ${active.id}`}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.5rem', fontSize: '0.82rem', marginTop: 12, marginBottom: '0.75rem' }}>
              <div><strong>Provider:</strong> {active.provider}</div>
              <div><strong>Sub-account:</strong> <span style={mono()}>{active.provider_account_id}</span></div>
              <div><strong>Provider op:</strong> <span style={mono()}>{active.provider_op_id}</span></div>
              <div><strong>Amount:</strong> {active.amount_whole || '—'} {active.symbol}</div>
              <div><strong>Kind:</strong> {active.kind}</div>
              <div><strong>Seen:</strong> {active.seen_count}×</div>
            </div>
            <p style={{ fontSize: '0.8rem', color: colors.muted, marginBottom: '0.6rem' }}>
              Closing this row records that you investigated it. It does <strong>not</strong> credit
              anyone and does <strong>not</strong> reverse anything — there is no manual-credit path here.
              If the transfer is later credited for real, the row moves to <code>resolved</code> by itself.
            </p>
            <label style={lbl()} htmlFor="exc-close-note">Operator note (mandatory — rationale, audited)</label>
            <textarea
              id="exc-close-note"
              style={textarea()}
              placeholder="e.g. Provider dashboard has no such transfer; sub-account belongs to a closed test user"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
              <Button variant="primary" disabled={!canAdmin || noteMissing || busy} onClick={() => void submit()}>
                {busy ? '…' : 'Confirm close'}
              </Button>
              <Button variant="outline" onClick={() => { setActive(null); setNote(''); }}>Cancel</Button>
            </div>
            {noteMissing && <p style={{ color: colors.muted, fontSize: '0.75rem', marginTop: '0.4rem' }}>Submit is disabled until an operator note is entered.</p>}
          </Card>
        </div>
      )}

      {error && <p style={{ color: colors.danger }}>{error}</p>}
      {msg && <AuditNote>{msg}</AuditNote>}

      <Card
        title="Deposit exceptions"
        right={<Button variant="outline" sm onClick={() => void load(state, kind, offset)}>Refresh exceptions</Button>}
      >
        {!canAdmin && <PermissionBanner permission={CRYPTO_PERMS.admin} />}
        <FilterBar>
          <div>
            <label style={lbl()} htmlFor="exc-state">Queue state</label>
            <select id="exc-state" style={select()} value={state} onChange={(e) => { setState(e.target.value); setOffset(0); }}>
              <option value="open">Open</option>
              <option value="resolved">Resolved by a credit</option>
              <option value="closed">Closed by an operator</option>
              <option value="all">All</option>
            </select>
          </div>
          <div>
            <label style={lbl()} htmlFor="exc-kind">Kind</label>
            <select id="exc-kind" style={select()} value={kind} onChange={(e) => { setKind(e.target.value); setOffset(0); }}>
              <option value="">All kinds</option>
              <option value="unmapped">Unmapped (no owner)</option>
              <option value="rejected">Rejected (not creditable)</option>
            </select>
          </div>
        </FilterBar>

        <StateBlock loading={loading} error={null} empty={rows.length === 0} emptyText="No deposit exceptions. Nothing is stuck uncredited.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={thCell}>Kind</th><th style={thCell}>Provider op</th><th style={thCell}>Sub-account</th>
              <th style={thCell}>Amount</th><th style={thCell}>Confs</th><th style={thCell}>Seen</th>
              <th style={thCell}>Reason</th><th style={thCell}>Age</th><th style={thCell}>State</th><th style={thCell} />
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={tdCell}><StatusBadge status={r.kind} /></td>
                  <td style={{ ...tdCell, ...mono() }}>{r.provider_op_id}</td>
                  <td style={{ ...tdCell, ...mono(), maxWidth: 180 }}>{r.provider_account_id}</td>
                  <td style={tdCell}>{r.amount_whole || '—'} {r.symbol}</td>
                  <td style={tdCell}>{r.confirmations}/{r.required_confs}</td>
                  <td style={tdCell}>{r.seen_count > 1 ? `×${r.seen_count}` : '—'}</td>
                  <td style={{ ...tdCell, maxWidth: 260 }}>{r.reason}</td>
                  <td style={tdCell}>{fmtAge(r.age_seconds)}</td>
                  <td style={tdCell}><StatusBadge status={r.state} /></td>
                  <td style={tdCell}>
                    {canAdmin && r.state === 'open' && (
                      <Button variant="outline" sm onClick={() => { setActive(r); setMsg(null); setError(null); }}>Close</Button>
                    )}
                    {r.state === 'resolved' && r.deposit_id && (
                      <span style={{ ...mono(), color: colors.muted }}>credit {r.deposit_id.slice(0, 8)}</span>
                    )}
                    {r.state === 'closed' && (
                      <span style={{ color: colors.muted, fontSize: '0.75rem' }}>
                        {r.closed_by} · {fmtDate(r.closed_at)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>

        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', justifyContent: 'flex-end' }}>
          <Button variant="outline" sm disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Previous</Button>
          <Button variant="outline" sm disabled={rows.length < PAGE_SIZE} onClick={() => setOffset(offset + PAGE_SIZE)}>Next</Button>
        </div>
      </Card>
    </div>
  );
}
```

Five details, each already reflected in the code above:
- `_ui.tsx`'s `Card` takes only `title`, `right` and children — no `style` prop. The close card's
  spacing therefore comes from the wrapper `div` around it, and the shared `Card` is not touched.
- `StatusBadge` maps `rejected` to the danger colour and falls back to neutral text for an unknown
  word, so `unmapped` and the three states render without editing `_ui.tsx`.
- `getByLabelText` only resolves a control that is associated with its label, which the crypto
  console does with `htmlFor`/`id` (see `fees/page.tsx:225-226`). Hence
  `exc-state`/`exc-kind`/`exc-close-note` above; the plain `<label>` + bare `<select>` pattern in
  `deposits/page.tsx` would leave the panel's filter tests unable to find the controls.
- A `closed` row shows `fmtDate(r.closed_at)` — "when it was acknowledged" — while an `open` row
  shows `fmtAge(r.age_seconds)` — "how long it has sat". `age_seconds` on a closed row is neither.
- The panel's refresh button is labelled **Refresh exceptions**, not **Refresh**. The shipped page
  header already owns a `Refresh` button and `deposits.test.tsx` does
  `getByRole('button', { name: 'Refresh' })` — an exact accessible-name match, so two identical
  labels would make that existing test throw on multiple elements.

- [ ] **Step 3: Run the panel tests**

```bash
cd frontend-admin && npx vitest run app/admin/crypto/deposits/exceptions-panel.test.tsx
```

Expected: all PASS. Fix the panel, not the assertions — each of those expectations mirrors a spec §5 bullet (kind badge, reason, whole-unit amount, age, mandatory note, no close without `crypto.admin`).

- [ ] **Step 4: Mount it on the Deposits page and correct the copy**

The page currently tells the operator the exception queue does not exist. It must stop saying that.

In `page.tsx`: import the panel (`import ExceptionsPanel from './ExceptionsPanel';`) and add the open-exceptions KPI plus the mount:

```tsx
          <Kpi label="Sweep errors" value={String(recon.replica.totals.errors)} accent={recon.replica.totals.errors ? colors.danger : undefined} />
          {recon.open_exceptions && (
            <Kpi
              label="Open exceptions"
              value={String(recon.open_exceptions.unmapped + recon.open_exceptions.rejected)}
              accent={colors.danger}
              sub={`${recon.open_exceptions.unmapped} unmapped · ${recon.open_exceptions.rejected} rejected · oldest ${fmtAge(recon.open_exceptions.oldest_age_seconds)}`}
            />
          )}
```

add `fmtAge` to the existing `from '../_ui'` import list, replace the DisclosureNote sentence

```
        Transfers still awaiting confirmations, or unmapped to any customer, are NOT credited and
        are not listed here — that exception queue is a separate design.
```

with

```tsx
        Transfers still awaiting confirmations, or unmapped to a customer, are NOT credited here. The
        panel below is that queue: every transfer the settlement engine decided not to credit, with the
        provider op id and the sub-account it could not resolve, and an operator-only close that records
        the investigation without moving money.
```

Do not write the words "Deposit exceptions" in this sentence — the panel's `Card` title is exactly
that string, and Step 5's mount test finds the panel with `findByText('Deposit exceptions')`, which
must stay a single match.

and mount the panel as the last child inside `<Page>`, after the credits `Card`:

```tsx
      <ExceptionsPanel canAdmin={canAdmin} globalCounts={recon?.open_exceptions ?? null} />
```

- [ ] **Step 5: Update the page test**

In `deposits.test.tsx`: the `vi.mock` factory replaces the whole service module for this file, so the panel's two functions must be mocked too or the mounted page calls real `fetch`. Extend the mock and the resets:

```ts
const mockList = vi.fn();
const mockStatus = vi.fn();
const mockExcList = vi.fn();
const mockExcClose = vi.fn();
vi.mock('@/services/cryptoAdminService', async () => ({
  ...(await vi.importActual<typeof import('@/services/cryptoAdminService')>('@/services/cryptoAdminService')),
  adminListDeposits: (...a: unknown[]) => mockList(...a),
  adminGetDepositReconcilerStatus: (...a: unknown[]) => mockStatus(...a),
  adminListDepositExceptions: (...a: unknown[]) => mockExcList(...a),
  adminCloseDepositException: (...a: unknown[]) => mockExcClose(...a),
}));
```

```ts
beforeEach(() => {
  mockList.mockReset(); mockStatus.mockReset();
  mockExcList.mockReset(); mockExcList.mockResolvedValue([]);
  mockExcClose.mockReset();
});
```

Replace the last test (its regex matched the copy Step 4 removes) with the two that describe what the page now does:

```ts
  it('states that awaiting/unmapped transfers are not credited, and points at the exception queue', async () => {
    await mounted([dep()], status());
    expect(await screen.findByText(/are NOT credited here/i)).toBeTruthy();
  });

  it('mounts the deposit exception queue under the credited history', async () => {
    mockExcList.mockResolvedValue([{
      id: '0a0a0a0a-0000-4000-8000-00000000000a', provider: 'quidax', provider_account_id: 'acct_orphan_1',
      provider_op_id: 'qdx_dep_7001', kind: 'unmapped', reason: 'no owner for provider sub-account acct_orphan_1',
      symbol: 'BTC', network: 'bitcoin', amount_whole: '0.001', confirmations: 9, required_confs: 0, state: 'open',
      first_seen_at: '2026-10-14T08:00:00Z', last_seen_at: '2026-10-14T08:30:00Z', seen_count: 3, age_seconds: 5400,
    }]);
    await mounted([dep()], status());
    expect(await screen.findByText('Deposit exceptions')).toBeTruthy();
    expect(screen.getByText('qdx_dep_7001')).toBeTruthy();
  });
```

and in `status()` add `open_exceptions: { unmapped: 1, rejected: 1, oldest_age_seconds: 5400 }` to the returned object so the KPI strip is exercised by the existing tests.

- [ ] **Step 6: Full frontend gate, then commit**

```bash
cd frontend-admin && npm run test 2>&1 | tail -15 && npm run type-check
```

Expected: every suite green, `tsc` exit 0. There is no ESLint gate in this package (mid-migration, v10 with no flat config) — do not add one.

```bash
git add frontend-admin/app/admin/crypto/deposits/ExceptionsPanel.tsx \
        frontend-admin/app/admin/crypto/deposits/exceptions-panel.test.tsx \
        frontend-admin/app/admin/crypto/deposits/page.tsx \
        frontend-admin/app/admin/crypto/deposits/deposits.test.tsx
git commit -m "feat(admin-ui): deposit exception queue panel on the Deposits tab"
```

---

## Task 10: Traceability, run log, and the ADR

**Files:**
- Modify: `docs/uat/crypto/gap-backlog.md` (GAP-DEP-01 state line + the Slice 3 "NOT delivered" bullet)
- Modify: `docs/uat/crypto/e2e-journeys-traceability.csv` (E2E-05, E2E-10, E2E-27)
- Modify: `docs/uat/crypto/run-log.md` (one entry per command actually run)
- Modify: `docs/uat/crypto/release-readiness.md` (the E2E-27 clause in row 2 of the gate table)
- Create: `docs/adr/ADR-PR916-crypto-deposit-exception-queue.md` (916 = next free after ADR-PR915; use the PR number if one exists — see Step 5)
- Modify: `docs/superpowers/specs/2026-10-22-crypto-deposit-exception-queue-design.md` (only if Task 4's §4.3 amendment is not yet in place)

**Interfaces:** none — documentation. But this task is where the honest verification record lives, so nothing here may claim a result that was not observed.

- [ ] **Step 1: Run the whole gate and capture the real numbers**

```bash
cd backend && go build ./... && go test -p 2 ./... 2>&1 | tail -25
cd backend && TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  go test -p 2 ./internal/cryptosvc/ ./internal/crypto/deposit/ -count=1 2>&1 | tail -10
cd frontend-admin && npm run test 2>&1 | tail -15 && npm run type-check
```

Record, verbatim from the output: the PASS/SKIP/FAIL counts per package, the number of `TestLive_` tests that ran (not skipped), and the frontend suite's total. Anything that skipped for lack of `TEST_DATABASE_URL` is reported as **skipped**, never as passed.

- [ ] **Step 2: gap-backlog.md**

Update the `**State:**` line under `### GAP-DEP-01` to include the new slice, e.g.:

```markdown
**State:** Slice 1 + 2 + 2b built + verified; Slice 3 read surfaces delivered; **exception-queue
persistence + admin queue delivered (visibility-only)**; address-ownership and live Quidax
verification still open.
```

Replace the whole `**NOT delivered — the true exception queue.**` bullet with the delivered statement, keeping the still-open items honest:

```markdown
  - **Exception queue DELIVERED (visibility-only, mock + local Postgres):** additive table
    `crypto_deposit_exceptions`, engine recording of the `unmapped`/`rejected` decisions it
    already refused to credit (best-effort: a recording failure never changes an outcome and
    never moves money), auto-resolve inside the credit transaction, `seen_count` observation
    counting, and an admin queue (`GET /admin/crypto/deposits/exceptions`,
    `POST /admin/crypto/deposits/exceptions/:id/close`, `open_exceptions` on the reconciler
    view) with a mandatory-note, advisory-locked, audited close. The console's Deposits tab
    renders it. No money-IN invariant changed; there is still **no manual credit and no
    reversal**, by design — an exception is the escalation trigger, not the fix.
```

Leave the `Still open in Slice 3` bullet's address-ownership text alone, and remove only the exception-queue half of its final sentence so the two bullets do not contradict each other.

- [ ] **Step 3: e2e-journeys-traceability.csv**

Rewrite these three lines exactly (the `modules` field stays quoted; every line must keep 7 fields). `Partial` in `automated_status` means proven against the mock provider and the local Postgres — `manual_status` stays `Blocked` because no live Quidax delivery has been observed:

```csv
E2E-05,Crypto deposit to available balance,Core,"WAL,DEP,WEB,LED",Partial,Blocked,GAP-DEP-01 slice1+2+exception-queue: settlement core + webhook→provider-requery→settle wired & tested (mock + live-DB: 0.005 BTC credits 500000 units once, replay duplicate, dust/pending/orphan credit nobody; payload never sets value); a refused credit now persists as a crypto_deposit_exceptions row an operator can see and close. Still Blocked — not run against a live Quidax webhook (event name/confirmations unverified)
E2E-10,Signed webhook duplicate storm,Core,"WEB,DEP,FILL,LED",Partial,Not Run,Swap duplicate→200 + dedupe proven; deposit duplicate storm proven on local Postgres — 4 observations of one orphan make exactly one crypto_deposit_exceptions row with seen_count=4 and credit nobody
E2E-27,Source-of-funds investigation,Core,"DEP,KYC,RISK",Partial,Blocked,Exception queue delivered: unmapped/rejected credits are persisted, queryable by kind/state/provider, ordered oldest-stuck-first, and an acknowledged close is audited (crypto.deposit_exception.closed, old→new). Visibility-only by design — no manual credit or reversal. Live Quidax + case tooling still unverified
```

Then check the CSV is still parseable:

```bash
cd /Users/paymax/Documents/spotlight/main && python3 - <<'PY'
import csv
rows = list(csv.reader(open('docs/uat/crypto/e2e-journeys-traceability.csv')))
bad = [r for r in rows if len(r) != 7]
print(len(rows), 'rows;', bad, 'malformed')
PY
```

Expected: `malformed` prints as `[]`.

- [ ] **Step 4: run-log.md and release-readiness.md**

Append to `run-log.md` one block per Step 1 command, in the file's existing `## Command N — <what>` format, with the numbers you actually observed and an explicit line for anything skipped or not run (browser/device run: **Not Run**; live Quidax: **Blocked**; ESLint: **not runnable**). Do not adjust an expected assertion to make a run pass — if something failed, log the failure and go back to the task that owns it.

In `release-readiness.md`, update the E2E-27 clause of gate row 2 from "still Blocked" to "exception queue delivered, Partial against mock + local Postgres (live Quidax run still blocked)". Keep the row's overall **Not met** verdict — the live-provider clause it fails has not changed.

- [ ] **Step 5: The ADR**

Number it with the PR this change opens under. If no PR exists yet, use the next free number and say so in the body:

```bash
ls docs/adr | tail -3   # currently ends at ADR-PR915-provider-portal-capabilities.md
```

Every command below writes `ADR-PR916-…`, the next free number. If this change lands as a PR
first, rename the file to `ADR-PR<that number>-crypto-deposit-exception-queue.md` before the
commit and note the numbering in the ADR body — never leave a literal `<…>` in a path.

Create `docs/adr/ADR-PR916-crypto-deposit-exception-queue.md` with the repo's `## Context` / `## Decision` / `## Consequences` shape, covering:

- **Context** — GAP-DEP-01 left the `unmapped`/`rejected` decisions undurable: `crypto_deposits` requires `user_id NOT NULL` and `units > 0` and its `UNIQUE(provider_op_id)` is the *credit* idempotency anchor, so a refused transfer could not be recorded there, and the webhook dedupe row is deleted on failure. Ops had no answer to "is money stuck, and why".
- **Decision** — a new additive, `service_role`-only table as a descriptive side ledger; the engine stays the only writer; recording is best-effort; `UNIQUE (provider, provider_op_id)` with observation counting; auto-resolve inside the credit transaction; reads and the acknowledged close reuse the `cryptosvc` admin plane (advisory lock, `Idempotency-Key`, mandatory note, `crypto_audit_log`, `crypto.admin`) instead of the legacy read plane; no customer-facing surface, no manual credit, no reversal.
- **The documented deviation from spec §4.3** — the flip runs only on the newly-settled branch, not on a duplicate, because `credit → reorg observation (reopens) → redelivered confirmed webhook` would otherwise silently re-resolve the exception and destroy the only signal that money may have moved out from under a balance. Cross-reference `TestDuplicateSettleDoesNotFlipAnEscalatedException` and the Task 4 amendment already appended to the spec.
- **Consequences** — what ops can now do (see and acknowledge, in one view with the sweep counters); what they still cannot do (credit, reverse, attribute an orphan to a user, and they must keep doing that off-system); `seen_count` as the stuck signal; the queue grows only where deposits are wired; the live-DB tests prove behaviour against the mock provider and the local schema, NOT a live Quidax delivery, and the address-ownership gap is untouched.

- [ ] **Step 6: Self-consistency pass, then commit**

```bash
cd /Users/paymax/Documents/spotlight/main
# Scoped to the shipped surfaces — docs/superpowers legitimately quotes the old wording when it
# says which sentence to replace, and the spec's own "separate design" line is about address
# ownership, not this queue.
grep -rn "separate design" docs/uat frontend-admin/app/admin/crypto || echo "no stale 'separate design' claims"
grep -rn "E2E-27" docs/uat/crypto/ | head
```

Expected: the first prints `no stale 'separate design' claims` — the console, the backlog and the traceability file must all tell the same story. If it prints `deposits/page.tsx`, Step 4's copy replacement did not happen.

```bash
git add docs/uat/crypto/gap-backlog.md docs/uat/crypto/e2e-journeys-traceability.csv \
        docs/uat/crypto/run-log.md docs/uat/crypto/release-readiness.md \
        docs/adr/ADR-PR916-crypto-deposit-exception-queue.md
git commit -m "docs(crypto): deposit exception queue UAT traceability and ADR"
```

If Step 4 recorded any Not Run, Blocked or skipped result, the commit message and the ADR must both say so. A precise NO-GO on the live-provider half of the story is the correct outcome for this slice.

