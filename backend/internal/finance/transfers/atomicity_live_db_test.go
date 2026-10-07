package transfers

// Live-DB regression tests for the transfers-rail atomicity fixes (issue #500
// class):
//
//   - settleTransfer / markFunded now post their journal legs AND the
//     bank_transfers status flip in ONE pgx transaction. The crash-window test
//     below forces the status UPDATE to land 0 rows (row deleted mid-flight)
//     and asserts the ledger entries rolled back with it — before the fix the
//     journal had already committed in its own tx.
//   - AdminRetry is claim-then-act: a per-transfer advisory lock
//     (payoutLegLockKey) means a second concurrent payout leg gets
//     ErrPayoutLegInFlight instead of double-calling InitiatePayoutFailover.
//   - The sufficiency check moved inside the debiting tx (balanceTx) behind
//     BOTH advisory-lock namespaces ("wallet:"+uid and the SQL-RPC plane's
//     hashtext(account_id)); the concurrent overdraw test proves two racing
//     debits can no longer both pass the balance gate.
//
// ── Bring-up note ─────────────────────────────────────────────────────────
//  1. Local Supabase running with all migrations applied
//     (bank_transfers, ledger_entries, ledger_accounts, user_transaction_pin,
//     user_profiles, handle_new_user trigger).
//  2. Point at a disposable database — NEVER production:
//       export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//  3. Run:
//       cd backend && go test ./internal/finance/transfers/ -run LiveDB -v

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/provider/disbursement"
	"spotlight/backend/internal/testsupport"
)

// liveDBPool gates on TEST_DATABASE_URL ALONE — never falling back to
// DATABASE_URL (the root .env points at PRODUCTION). These tests write real
// journal + transfer rows; a fallback would move money in production the
// moment someone sourced .env and ran `go test ./...`.
func liveDBPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping live-DB transfers atomicity test; see bring-up note")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func newLiveLedgerService(pool *pgxpool.Pool) *ledger.Service {
	return ledger.NewService(ledger.NewRepository(pool), nil)
}

// mockRegistry wires a deterministic offline disbursement provider named
// "paystack" — the bank_transfers.provider CHECK only admits
// ('paystack','monnify'), so the mock carries a real provider's name.
func mockRegistry() *disbursement.Registry {
	return disbursement.NewRegistry(
		disbursement.Config{DefaultProvider: "paystack", FailoverEnabled: false},
		disbursement.NewMock("paystack"),
	)
}

func seedUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT DO NOTHING`, id, id+"@seed.test"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}
	testsupport.CleanupUser(t, pool, id)
	testsupport.SetKycTier(t, ctx, pool, id, testsupport.KycTierUnlimited)
	return id
}

// seedWallet credits the user's wallet straight through the ledger so tests
// have spendable balance without going through a top-up rail.
func seedWallet(t *testing.T, ctx context.Context, led *ledger.Service, userID string, amountKobo int64) {
	t.Helper()
	clearing, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		t.Fatalf("clearing acct: %v", err)
	}
	if err := led.Credit(ctx, userID, "seed:"+uuid.New().String(), "seed-"+uuid.New().String(), clearing.ID, amountKobo); err != nil {
		t.Fatalf("seed wallet: %v", err)
	}
}

// seedBankTransfer inserts a bank_transfers row directly at the requested
// status, with every NOT NULL column the base + multiprovider migrations
// require, and returns it freshly scanned.
func seedBankTransfer(t *testing.T, ctx context.Context, pool *pgxpool.Pool, svc *Service, userID, status, sourceType string, amountKobo, feeKobo int64) *BankTransfer {
	t.Helper()
	reference := "test-" + uuid.New().String()
	idem := "idem-" + uuid.New().String()
	fundingRef := "fund-" + reference
	var fundingStatus *string
	var fr *string
	if sourceType == string(SourceBank) {
		fr = &fundingRef
		fs := "pending"
		fundingStatus = &fs
	}
	var id string
	err := pool.QueryRow(ctx, `
		INSERT INTO bank_transfers
			(user_id, amount_kobo, fee_kobo, bank_code, bank_name, account_number_last4,
			 account_name, paystack_recipient_code, reference, status, idempotency_key,
			 source_type, provider, funding_reference, funding_status)
		VALUES ($1,$2,$3,'044','Test Bank','6789','SEED TESTER','pending',$4,$5,$6,$7,'paystack',$8,$9)
		RETURNING id`,
		userID, amountKobo, feeKobo, reference, status, idem, sourceType, fr, fundingStatus).Scan(&id)
	if err != nil {
		t.Fatalf("seed bank_transfers: %v", err)
	}
	bt, err := svc.getBankTransfer(ctx, id)
	if err != nil {
		t.Fatalf("re-read bank transfer: %v", err)
	}
	return bt
}

// uniquePhone mints a per-run valid Nigerian mobile ("080" + 8 digits from a
// fresh uuid) so recipient-resolution fixtures never collide with leftovers
// from earlier test runs.
func uniquePhone(t *testing.T) string {
	t.Helper()
	var n uint64
	for _, c := range uuid.New().String() {
		if c >= '0' && c <= '9' {
			n = n*10 + uint64(c-'0')
			if n >= 100_000_000 {
				break
			}
		}
	}
	return "080" + fmt.Sprintf("%08d", n%100_000_000)
}

func countEntries(t *testing.T, ctx context.Context, pool *pgxpool.Pool, reference string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM ledger_entries WHERE reference=$1`, reference).Scan(&n); err != nil {
		t.Fatalf("count ledger entries: %v", err)
	}
	return n
}

func entryExists(t *testing.T, ctx context.Context, pool *pgxpool.Pool, idempotencyKey string) bool {
	t.Helper()
	var ok bool
	if err := pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM ledger_entries WHERE idempotency_key=$1)`, idempotencyKey).Scan(&ok); err != nil {
		t.Fatalf("entry exists %s: %v", idempotencyKey, err)
	}
	return ok
}

// TestLiveDB_SettleSuccessful_JournalAndStatusCommitTogether asserts the
// settle path writes the sweep + fee-recognition journals AND lands the
// terminal status, and that a replay is a strict no-op.
func TestLiveDB_SettleSuccessful_JournalAndStatusCommitTogether(t *testing.T) {
	pool := liveDBPool(t)
	ctx := context.Background()
	led := newLiveLedgerService(pool)
	svc := NewService(pool, led, tiers.NewService(pool), nil, nil)
	userID := seedUser(t, ctx, pool)

	bt := seedBankTransfer(t, ctx, pool, svc, userID, string(BankTransferProviderInitiated), string(SourceWallet), 1_000_000, 2_500)

	if err := svc.settleTransfer(ctx, bt, BankTransferSuccessful); err != nil {
		t.Fatalf("settleTransfer: %v", err)
	}

	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM bank_transfers WHERE id=$1`, bt.ID).Scan(&status); err != nil {
		t.Fatalf("read status: %v", err)
	}
	if status != string(BankTransferSuccessful) {
		t.Fatalf("status = %s, want successful", status)
	}
	// Sweep leg: idem:settle:debit + idem:settle:credit; fee leg: idem:fee:*.
	for _, k := range []string{
		LegKey(bt.IdempotencyKey, LegSettle) + ":debit",
		LegKey(bt.IdempotencyKey, LegSettle) + ":credit",
		LegKey(bt.IdempotencyKey, LegFeeRev) + ":debit",
		LegKey(bt.IdempotencyKey, LegFeeRev) + ":credit",
	} {
		if !entryExists(t, ctx, pool, k) {
			t.Fatalf("expected ledger entry %s", k)
		}
	}
	if got := countEntries(t, ctx, pool, bt.Reference); got != 4 {
		t.Fatalf("entries for reference = %d, want 4", got)
	}

	// Replay is a strict no-op — same status, no new entries.
	bt2, err := svc.getBankTransfer(ctx, bt.ID)
	if err != nil {
		t.Fatalf("re-read: %v", err)
	}
	if err := svc.settleTransfer(ctx, bt2, BankTransferSuccessful); err != nil {
		t.Fatalf("settle replay: %v", err)
	}
	if got := countEntries(t, ctx, pool, bt.Reference); got != 4 {
		t.Fatalf("entries after replay = %d, want 4", got)
	}
}

// TestLiveDB_SettleFailed_ReversalLegsCommitAtomically covers the
// failed/reversed branch: REVERSAL pair + terminal status in one commit.
func TestLiveDB_SettleFailed_ReversalLegsCommitAtomically(t *testing.T) {
	pool := liveDBPool(t)
	ctx := context.Background()
	led := newLiveLedgerService(pool)
	svc := NewService(pool, led, tiers.NewService(pool), nil, nil)
	userID := seedUser(t, ctx, pool)

	bt := seedBankTransfer(t, ctx, pool, svc, userID, string(BankTransferFundsReserved), string(SourceWallet), 500_000, 1_000)

	if err := svc.settleTransfer(ctx, bt, BankTransferFailed); err != nil {
		t.Fatalf("settleTransfer: %v", err)
	}

	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM bank_transfers WHERE id=$1`, bt.ID).Scan(&status); err != nil {
		t.Fatalf("read status: %v", err)
	}
	if status != string(BankTransferFailed) {
		t.Fatalf("status = %s, want failed", status)
	}
	revKey := bt.IdempotencyKey + ":reversal:" + string(BankTransferFailed)
	for _, k := range []string{revKey + ":rev_debit", revKey + ":rev_credit"} {
		if !entryExists(t, ctx, pool, k) {
			t.Fatalf("expected reversal entry %s", k)
		}
	}
	if got := countEntries(t, ctx, pool, bt.Reference); got != 2 {
		t.Fatalf("entries for reference = %d, want 2", got)
	}
}

// TestLiveDB_Settle_StatusMissRollsBackJournal is the crash-window regression:
// the status UPDATE landing 0 rows (here: the row vanished) must roll the
// journal legs back with it. Pre-fix, the journal had already committed in its
// own transaction and the ledger would show a settled sweep for a transfer the
// row-level state machine never accepted.
func TestLiveDB_Settle_StatusMissRollsBackJournal(t *testing.T) {
	pool := liveDBPool(t)
	ctx := context.Background()
	led := newLiveLedgerService(pool)
	svc := NewService(pool, led, tiers.NewService(pool), nil, nil)
	userID := seedUser(t, ctx, pool)

	bt := seedBankTransfer(t, ctx, pool, svc, userID, string(BankTransferProviderInitiated), string(SourceWallet), 750_000, 1_000)
	if _, err := pool.Exec(ctx, `DELETE FROM bank_transfers WHERE id=$1`, bt.ID); err != nil {
		t.Fatalf("delete row: %v", err)
	}

	if err := svc.settleTransfer(ctx, bt, BankTransferSuccessful); err != nil {
		t.Fatalf("settleTransfer on missing row should be a no-op, got %v", err)
	}
	if got := countEntries(t, ctx, pool, bt.Reference); got != 0 {
		t.Fatalf("journal leaked without status commit: %d entries, want 0", got)
	}
}

// TestLiveDB_MarkFunded_JournalAndStatusCommitTogether covers the bank→bank
// funding leg: DR clearing → CR suspense and the awaiting_funding→funded flip
// commit together; the crash-window variant asserts a 0-row status update
// leaves no journal behind.
func TestLiveDB_MarkFunded_JournalAndStatusCommitTogether(t *testing.T) {
	pool := liveDBPool(t)
	ctx := context.Background()
	led := newLiveLedgerService(pool)
	svc := NewService(pool, led, tiers.NewService(pool), nil, nil) // nil registry ⇒ auto payout leg returns early
	userID := seedUser(t, ctx, pool)

	bt := seedBankTransfer(t, ctx, pool, svc, userID, string(BankTransferAwaitingFunding), string(SourceBank), 900_000, 2_500)

	if err := svc.markFunded(ctx, bt, bt.Status); err != nil {
		t.Fatalf("markFunded: %v", err)
	}
	var status, fundingStatus string
	if err := pool.QueryRow(ctx, `SELECT status, funding_status FROM bank_transfers WHERE id=$1`, bt.ID).Scan(&status, &fundingStatus); err != nil {
		t.Fatalf("read status: %v", err)
	}
	if status != string(BankTransferFunded) || fundingStatus != "successful" {
		t.Fatalf("status = %s/%s, want funded/successful", status, fundingStatus)
	}
	for _, k := range []string{
		LegKey(bt.IdempotencyKey, LegFund) + ":debit",
		LegKey(bt.IdempotencyKey, LegFund) + ":credit",
	} {
		if !entryExists(t, ctx, pool, k) {
			t.Fatalf("expected funding entry %s", k)
		}
	}

	// Replay no-ops at the state-machine gate.
	if err := svc.markFunded(ctx, bt, BankTransferFunded); err != nil {
		t.Fatalf("markFunded replay: %v", err)
	}
	if got := countEntries(t, ctx, pool, bt.Reference); got != 2 {
		t.Fatalf("entries after replay = %d, want 2", got)
	}

	// Crash-window: a second row whose status update can't land must not leave
	// journal entries behind.
	bt2 := seedBankTransfer(t, ctx, pool, svc, userID, string(BankTransferAwaitingFunding), string(SourceBank), 600_000, 1_000)
	if _, err := pool.Exec(ctx, `DELETE FROM bank_transfers WHERE id=$1`, bt2.ID); err != nil {
		t.Fatalf("delete row: %v", err)
	}
	if err := svc.markFunded(ctx, bt2, BankTransferAwaitingFunding); err != nil {
		t.Fatalf("markFunded on missing row should be a no-op, got %v", err)
	}
	if got := countEntries(t, ctx, pool, bt2.Reference); got != 0 {
		t.Fatalf("funding journal leaked without status commit: %d entries, want 0", got)
	}
}

// TestLiveDB_AdminRetry_ClaimSerialises proves the claim-then-act guard: while
// one caller holds the per-transfer leg lock, AdminRetry refuses with
// ErrPayoutLegInFlight (409) instead of double-firing the provider.
func TestLiveDB_AdminRetry_ClaimSerialises(t *testing.T) {
	pool := liveDBPool(t)
	ctx := context.Background()
	led := newLiveLedgerService(pool)
	svc := NewService(pool, led, tiers.NewService(pool), nil, mockRegistry())
	userID := seedUser(t, ctx, pool)

	bt := seedBankTransfer(t, ctx, pool, svc, userID, string(BankTransferFundsReserved), string(SourceWallet), 1_000_000, 2_500)

	// Simulate an in-flight payout leg: another session holds the advisory lock.
	conn, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatalf("acquire conn: %v", err)
	}
	defer conn.Release()
	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock(hashtext($1))`, payoutLegLockKey(bt.ID)); err != nil {
		t.Fatalf("advisory lock: %v", err)
	}

	if _, err := svc.AdminRetry(ctx, bt.ID, userID); !errors.Is(err, ErrPayoutLegInFlight) {
		t.Fatalf("AdminRetry under held lock = %v, want ErrPayoutLegInFlight", err)
	}
	if got := HTTPStatusForError(ErrPayoutLegInFlight); got != http.StatusConflict {
		t.Fatalf("ErrPayoutLegInFlight maps to %d, want 409", got)
	}

	if _, err := conn.Exec(ctx, `SELECT pg_advisory_unlock(hashtext($1))`, payoutLegLockKey(bt.ID)); err != nil {
		t.Fatalf("advisory unlock: %v", err)
	}

	// With the lock free, the retry runs the leg against the deterministic mock.
	retried, err := svc.AdminRetry(ctx, bt.ID, userID)
	if err != nil {
		t.Fatalf("AdminRetry after unlock: %v", err)
	}
	if retried.Status != BankTransferProviderInitiated {
		t.Fatalf("status = %s, want provider_initiated", retried.Status)
	}
	if retried.ProviderTransferRef == nil || *retried.ProviderTransferRef == "" {
		t.Fatal("expected provider_transfer_ref set by the mock payout")
	}
}

// TestLiveDB_ConcurrentDebits_CannotOverdraw exercises the in-tx sufficiency
// check (balanceTx) behind the wallet advisory lock: two racing transfers of
// 80k each against a 100k balance must end 1×success + 1×ErrInsufficientFunds —
// never two debits. This is the double-spend race the pooled GetBalance left
// open.
func TestLiveDB_ConcurrentDebits_CannotOverdraw(t *testing.T) {
	pool := liveDBPool(t)
	ctx := context.Background()
	led := newLiveLedgerService(pool)
	svc := NewService(pool, led, tiers.NewService(pool), nil, nil)
	sender := seedUser(t, ctx, pool)
	recipient := seedUser(t, ctx, pool)
	seedWallet(t, ctx, led, sender, 100_000)

	// Recipient needs a resolvable phone — UNIQUE per run: seeded profiles from
	// earlier runs can survive cleanup (user_profiles rows outlive auth.users
	// deletes in some paths), and two profiles sharing a number is exactly the
	// ErrAmbiguousRecipient condition this rail refuses on.
	phone := uniquePhone(t)
	if _, err := pool.Exec(ctx, `UPDATE user_profiles SET phone=$1 WHERE id=$2`, phone, recipient); err != nil {
		t.Fatalf("set recipient phone: %v", err)
	}
	if err := svc.pins.Set(ctx, sender, "1234"); err != nil {
		t.Fatalf("set pin: %v", err)
	}

	req := func(key string) WalletTransferRequest {
		return WalletTransferRequest{
			RecipientPhone: phone,
			AmountKobo:     80_000,
			PIN:            "1234",
			IdempotencyKey: key,
		}
	}

	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i := range 2 {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, err := svc.InitiateWalletToWallet(ctx, sender, req("race-"+uuid.New().String()))
			errs[i] = err
		}(i)
	}
	wg.Wait()

	var successes, insufficient int
	for _, err := range errs {
		switch {
		case err == nil:
			successes++
		case errors.Is(err, ledger.ErrInsufficientFunds):
			insufficient++
		default:
			t.Fatalf("unexpected error: %v", err)
		}
	}
	if successes != 1 || insufficient != 1 {
		t.Fatalf("raced debits: successes=%d insufficient=%d, want 1/1 — overdraw race is open", successes, insufficient)
	}
	bal, err := led.GetBalance(ctx, sender)
	if err != nil {
		t.Fatalf("final balance: %v", err)
	}
	if bal != 20_000 {
		t.Fatalf("final balance = %d, want 20000", bal)
	}
}

// TestLiveDB_InitiateBankTransfer_EndToEnd drives the wallet→bank rail through
// the mock registry: reserve entries + row insert commit in one tx, then the
// lock-claimed payout leg lands provider_initiated.
func TestLiveDB_InitiateBankTransfer_EndToEnd(t *testing.T) {
	pool := liveDBPool(t)
	ctx := context.Background()
	led := newLiveLedgerService(pool)
	svc := NewService(pool, led, tiers.NewService(pool), nil, mockRegistry())
	userID := seedUser(t, ctx, pool)
	seedWallet(t, ctx, led, userID, 10_000_000)
	if err := svc.pins.Set(ctx, userID, "1234"); err != nil {
		t.Fatalf("set pin: %v", err)
	}

	bt, err := svc.InitiateBankTransfer(ctx, userID, BankTransferRequest{
		AccountNumber:  "0123456789",
		BankCode:       "044",
		AmountKobo:     1_000_000,
		PIN:            "1234",
		IdempotencyKey: "bt-" + uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("InitiateBankTransfer: %v", err)
	}
	if bt.Status != BankTransferProviderInitiated {
		t.Fatalf("status = %s, want provider_initiated (mock payout leg)", bt.Status)
	}
	// Reserve legs are the raw per-leg keys the initiate path writes.
	for _, k := range []string{bt.IdempotencyKey + ":debit", bt.IdempotencyKey + ":suspense"} {
		if !entryExists(t, ctx, pool, k) {
			t.Fatalf("expected reserve entry %s", k)
		}
	}
	// Replay under the same key returns the same transfer — no second debit.
	replay, err := svc.InitiateBankTransfer(ctx, userID, BankTransferRequest{
		AccountNumber:  "0123456789",
		BankCode:       "044",
		AmountKobo:     1_000_000,
		PIN:            "1234",
		IdempotencyKey: bt.IdempotencyKey,
	})
	if err != nil {
		t.Fatalf("replay: %v", err)
	}
	if !replay.AlreadyProcessed || replay.ID != bt.ID {
		t.Fatalf("replay = %+v, want already_processed same transfer", replay)
	}
}
