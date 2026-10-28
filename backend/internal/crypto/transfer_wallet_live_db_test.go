//go:build ignore
// +build ignore

package crypto

// RED-PHASE LIVE-DB tests for crypto wallet-to-wallet transfer. The Postgres
// store is the real one (TransferDeps.Store left nil => pgx default); PIN, AML
// and recipient resolution are faked. They need the PROPOSED additive schema
// documented in transfer_wallet_stub.go (crypto_wallet_transfers,
// crypto_ledger_entries). SKIPPED whenever TEST_DATABASE_URL is unset.
// Test prefix: TestLiveDB_CryptoTransfer_

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/testsupport"
)

type liveXfer struct {
	ctx           context.Context
	pool          *pgxpool.Pool
	svc           *Service
	asset         *Asset
	sender, recip string
	pin           *xferPINFake
	res           *liveResolver
}

type liveResolver struct{ m map[string]string }

func (r *liveResolver) ResolveRecipient(_ context.Context, ident string) (string, string, error) {
	if id, ok := r.m[ident]; ok {
		return id, "Live Recipient", nil
	}
	return "", "", ErrNotFound
}

type allowAML struct{}

func (allowAML) ScreenTransfer(context.Context, string, string, string, int64, int64) error {
	return nil
}

func newLiveXfer(t *testing.T, senderUnits int64) *liveXfer {
	t.Helper()
	ctx := context.Background()
	pool := livePool(t)
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	svc := NewService(pool, led, NewMockPriceProvider())

	admin := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, admin, admin+"@seed.test"); err != nil {
		t.Fatalf("seed admin: %v", err)
	}
	testsupport.CleanupUser(t, pool, admin)
	a, err := svc.AdminConfigAsset(ctx, admin, "USDT", "Tether USD", 1_000_000, true)
	if err != nil {
		t.Fatalf("config USDT: %v", err)
	}
	sender := seedLiveUser(t, ctx, pool, led, testsupport.KycTierUnlimited, 0)
	recip := seedLiveUser(t, ctx, pool, led, testsupport.KycTierUnlimited, 0)
	seedHoldings(t, ctx, pool, sender, a.ID, senderUnits)

	l := &liveXfer{ctx: ctx, pool: pool, svc: svc, asset: a, sender: sender, recip: recip,
		pin: &xferPINFake{want: xferPIN},
		res: &liveResolver{m: map[string]string{"r@example.com": recip, "s@example.com": sender}}}
	svc.WithTransferDeps(TransferDeps{
		PIN: l.pin, AML: allowAML{}, Resolver: l.res, // Store nil => real pgx store
		Flags: TransferFlags{CryptoEnabled: true, WalletTransfersEnabled: true},
	})
	return l
}

func (l *liveXfer) in(units, key string) TransferInput {
	return TransferInput{SenderID: l.sender, RecipientIdentifier: "r@example.com", Asset: "USDT",
		Units: units, PIN: xferPIN, IdempotencyKey: key}
}

func (l *liveXfer) holding(t *testing.T, user string) int64 {
	t.Helper()
	var n int64
	if err := l.pool.QueryRow(l.ctx,
		`SELECT COALESCE((SELECT units FROM crypto_holdings WHERE user_id=$1 AND asset_id=$2),0)`,
		user, l.asset.ID).Scan(&n); err != nil {
		t.Fatalf("holding: %v", err)
	}
	return n
}

// ledgerSigned returns (rows, signed sum: CREDIT +, DEBIT -) for the two users.
func (l *liveXfer) ledgerSigned(t *testing.T) (int, int64) {
	t.Helper()
	var n int
	var sum int64
	if err := l.pool.QueryRow(l.ctx,
		`SELECT COUNT(*), COALESCE(SUM(CASE WHEN direction='CREDIT' THEN units ELSE -units END),0)
		   FROM crypto_ledger_entries WHERE asset_id=$1 AND user_id IN ($2,$3)`,
		l.asset.ID, l.sender, l.recip).Scan(&n, &sum); err != nil {
		t.Fatalf("ledger: %v", err)
	}
	return n, sum
}

func TestLiveDB_CryptoTransfer_Conservation_LedgerBalancedAndAudited(t *testing.T) {
	l := newLiveXfer(t, 100_000_000)
	res, err := l.svc.TransferHoldings(l.ctx, l.in("12.5", "lx-"+uuid.NewString()))
	if err != nil {
		t.Fatalf("transfer: %v", err)
	}
	s, r := l.holding(t, l.sender), l.holding(t, l.recip)
	if s != 87_500_000 || r != 12_500_000 || s+r != 100_000_000 {
		t.Errorf("sender=%d recipient=%d, want 87.5e6 / 12.5e6 summing to 100e6", s, r)
	}
	if n, sum := l.ledgerSigned(t); n != 2 || sum != 0 {
		t.Errorf("ledger rows=%d signed sum=%d, want one balanced pair (2, 0)", n, sum)
	}
	var audits int
	if err := l.pool.QueryRow(l.ctx,
		`SELECT count(*) FROM crypto_audit_log WHERE action='crypto.wallet_transfer' AND entity_id=$1 AND actor_id=$2`,
		res.ID, l.sender).Scan(&audits); err != nil || audits != 1 {
		t.Errorf("audit rows = %d (err %v), want 1", audits, err)
	}
}

func TestLiveDB_CryptoTransfer_Atomicity_CreditFailureRollsBackDebit(t *testing.T) {
	l := newLiveXfer(t, 50_000_000)
	// Recipient id that violates crypto_holdings.user_id -> auth.users FK: the
	// credit step fails AFTER the debit step has run inside the tx.
	ghost := uuid.NewString()
	l.res.m["ghost@example.com"] = ghost
	in := l.in("10", "lx-atomic-"+uuid.NewString())
	in.RecipientIdentifier = "ghost@example.com"
	_, err := l.svc.TransferHoldings(l.ctx, in)
	if err == nil || errors.Is(err, errNotImplemented) {
		t.Fatalf("want a real DB failure from the credit step, got %v", err)
	}
	if got := l.holding(t, l.sender); got != 50_000_000 {
		t.Errorf("sender debited despite rollback: %d", got)
	}
	var n int
	if err := l.pool.QueryRow(l.ctx, `SELECT count(*) FROM crypto_ledger_entries WHERE user_id IN ($1,$2)`, l.sender, ghost).Scan(&n); err != nil || n != 0 {
		t.Errorf("ledger rows after rollback = %d (err %v), want 0", n, err)
	}
}

func TestLiveDB_CryptoTransfer_IdempotentReplayAndConflict(t *testing.T) {
	l := newLiveXfer(t, 100_000_000)
	key := "lx-replay-" + uuid.NewString()
	first, err := l.svc.TransferHoldings(l.ctx, l.in("5", key))
	if err != nil {
		t.Fatalf("first: %v", err)
	}
	second, err := l.svc.TransferHoldings(l.ctx, l.in("5", key))
	if err != nil {
		t.Fatalf("replay: %v", err)
	}
	if first.ID != second.ID || first.AlreadyProcessed || !second.AlreadyProcessed {
		t.Errorf("replay must return same transfer flagged already_processed: %+v / %+v", first, second)
	}
	if l.holding(t, l.recip) != 5_000_000 {
		t.Errorf("replay moved money again: recipient=%d", l.holding(t, l.recip))
	}
	if n, _ := l.ledgerSigned(t); n != 2 {
		t.Errorf("ledger rows = %d, want 2", n)
	}
	_, err = l.svc.TransferHoldings(l.ctx, l.in("6", key))
	if !errors.Is(err, ErrIdempotencyConflict) {
		t.Errorf("same key different body: want ErrIdempotencyConflict, got %v", err)
	}
	if l.holding(t, l.recip) != 5_000_000 {
		t.Errorf("conflict moved money: recipient=%d", l.holding(t, l.recip))
	}
}

func TestLiveDB_CryptoTransfer_ConcurrentIdenticalRequests_MoveOnce(t *testing.T) {
	l := newLiveXfer(t, 100_000_000)
	key := "lx-race-" + uuid.NewString()
	const n = 16
	var wg sync.WaitGroup
	errs := make([]error, n)
	start := make(chan struct{})
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			_, errs[i] = l.svc.TransferHoldings(l.ctx, l.in("7", key))
		}(i)
	}
	close(start)
	wg.Wait()
	for i, e := range errs {
		if e != nil {
			t.Fatalf("request %d: %v", i, e)
		}
	}
	if l.holding(t, l.recip) != 7_000_000 || l.holding(t, l.sender) != 93_000_000 {
		t.Errorf("money moved other than once: sender=%d recipient=%d", l.holding(t, l.sender), l.holding(t, l.recip))
	}
	if rows, sum := l.ledgerSigned(t); rows != 2 || sum != 0 {
		t.Errorf("ledger rows=%d sum=%d, want 2/0", rows, sum)
	}
}

func TestLiveDB_CryptoTransfer_InsufficientHoldings_And_ExactBalance(t *testing.T) {
	l := newLiveXfer(t, 10_000_000)
	_, err := l.svc.TransferHoldings(l.ctx, l.in("10.000001", "lx-insuf-"+uuid.NewString()))
	if !errors.Is(err, ErrInsufficientHoldings) {
		t.Fatalf("want ErrInsufficientHoldings, got %v", err)
	}
	if l.holding(t, l.sender) != 10_000_000 || l.holding(t, l.recip) != 0 {
		t.Error("insufficient transfer moved money")
	}
	if n, _ := l.ledgerSigned(t); n != 0 {
		t.Errorf("ledger rows written on refusal: %d", n)
	}
	if _, err := l.svc.TransferHoldings(l.ctx, l.in("10", "lx-exact-"+uuid.NewString())); err != nil {
		t.Fatalf("exact-balance transfer: %v", err)
	}
	if l.holding(t, l.sender) != 0 || l.holding(t, l.recip) != 10_000_000 {
		t.Errorf("after exact transfer sender=%d recipient=%d", l.holding(t, l.sender), l.holding(t, l.recip))
	}
}

func TestLiveDB_CryptoTransfer_SelfTransferAndMissingPin_TouchNothing(t *testing.T) {
	l := newLiveXfer(t, 10_000_000)
	self := l.in("1", "lx-self-"+uuid.NewString())
	self.RecipientIdentifier = "s@example.com"
	if _, err := l.svc.TransferHoldings(l.ctx, self); !errors.Is(err, ErrSelfTransfer) {
		t.Errorf("self transfer: got %v", err)
	}
	nopin := l.in("1", "lx-nopin-"+uuid.NewString())
	nopin.PIN = ""
	if _, err := l.svc.TransferHoldings(l.ctx, nopin); !errors.Is(err, ErrPinRequired) {
		t.Errorf("missing pin: got %v", err)
	}
	if l.pin.calls.Load() != 0 || l.pin.lockout.Load() != 0 {
		t.Errorf("missing PIN reached the verifier (calls=%d lockout=%d)", l.pin.calls.Load(), l.pin.lockout.Load())
	}
	if l.holding(t, l.sender) != 10_000_000 {
		t.Error("refused transfers moved money")
	}
}

func TestLiveDB_CryptoTransfer_LedgerImmutable_ReversalAppendsNewPair(t *testing.T) {
	l := newLiveXfer(t, 100_000_000)
	res, err := l.svc.TransferHoldings(l.ctx, l.in("30", "lx-rev-"+uuid.NewString()))
	if err != nil {
		t.Fatalf("transfer: %v", err)
	}
	// Direct mutation of ledger rows must be rejected by the database itself.
	if _, err := l.pool.Exec(l.ctx, `UPDATE crypto_ledger_entries SET units = units + 1 WHERE transfer_id=$1`, res.ID); err == nil {
		t.Error("UPDATE on crypto_ledger_entries succeeded; ledger rows must be immutable")
	}
	if _, err := l.pool.Exec(l.ctx, `DELETE FROM crypto_ledger_entries WHERE transfer_id=$1`, res.ID); err == nil {
		t.Error("DELETE on crypto_ledger_entries succeeded; ledger rows must be immutable")
	}
	rev, err := l.svc.ReverseTransfer(l.ctx, res.ID, l.sender, "dispute", "lx-revkey-"+uuid.NewString())
	if err != nil || rev.Status != "reversed" {
		t.Fatalf("reverse: %+v, %v", rev, err)
	}
	if n, sum := l.ledgerSigned(t); n != 4 || sum != 0 {
		t.Errorf("after reversal ledger rows=%d sum=%d, want 4 rows (original pair + new pair) summing to 0", n, sum)
	}
	if l.holding(t, l.sender) != 100_000_000 || l.holding(t, l.recip) != 0 {
		t.Errorf("reversal must restore holdings: sender=%d recipient=%d", l.holding(t, l.sender), l.holding(t, l.recip))
	}
}
