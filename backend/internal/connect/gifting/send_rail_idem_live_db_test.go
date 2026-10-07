package connectgifting

// LIVE-DB regression tests for the connect gifting money path (S2 + S6):
//   - S2: Service.Send used to hand the RAW client Idempotency-Key to the
//     wallet→wallet transfer. ledger_entries.idempotency_key is a GLOBAL
//     unique index, so the same key arriving from another rail collided there;
//     on the atomic debit path that is a silent no-op — a connect_gifts row
//     with no money behind it. The key is now scoped per (rail, caller):
//     "connect:gift:<senderID>:<key>".
//   - S6: the transfer adapter must route through the atomic check+debit
//     primitive (ledger.Service.Debit → DebitWithBalanceCheck under the
//     wallet advisory lock), not an unlocked GetBalance + PostJournal. This
//     test wires the same primitive so concurrent sends serialise per sender.
//
// GATED ON TEST_DATABASE_URL only — never DATABASE_URL (production pooler):
//
//	TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres' \
//	  go test ./internal/connect/gifting/ -run TestLiveDB_SendGift -v

import (
	"context"
	"errors"
	"os"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/testsupport"
)

func giftTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB connect/gifting test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect test db: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping test db: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// giftTestUser seeds a throwaway auth.users row (handle_new_user creates
// user_profiles) at KYC tier 3 so the fail-closed tier gate never rejects the
// small test transfers.
func giftTestUser(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	ctx := context.Background()
	id := uuid.NewString()
	if _, err := pool.Exec(ctx,
		`INSERT INTO auth.users (id, email) VALUES ($1, $2)`,
		id, "connect-gifting-rail-test-"+id+"@example.invalid"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}
	testsupport.CleanupUser(t, pool, id)
	if _, err := pool.Exec(ctx,
		`UPDATE user_profiles SET kyc_tier = 3 WHERE id = $1`, id); err != nil {
		t.Fatalf("seed user_profiles kyc_tier: %v", err)
	}
	return id
}

// liveWalletTransfer mirrors the PRODUCTION connectWalletTransferAdapter in
// internal/app/connect_routes.go — one atomic check+debit via
// ledger.Service.Debit (advisory lock + in-tx balance projection + balanced
// pair). The adapter itself is exercised against the real thing in
// internal/app's connect_wallet_transfer_live_db_test.go; here it is the
// seam the service's derived key flows through.
type liveWalletTransfer struct{ l *ledger.Service }

func (w *liveWalletTransfer) Transfer(ctx context.Context, fromUserID, toUserID, reference, idempotencyKey string, amountKobo int64) error {
	toAcc, err := w.l.GetOrCreateUserWallet(ctx, toUserID)
	if err != nil {
		return err
	}
	return w.l.Debit(ctx, fromUserID, reference, idempotencyKey, toAcc.ID, amountKobo)
}

type giftNoopAuditor struct{}

func (giftNoopAuditor) WriteAudit(context.Context, string, string, string, string, map[string]any) error {
	return nil
}

func giftTestService(t *testing.T, pool *pgxpool.Pool) (*Service, *ledger.Service) {
	t.Helper()
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)
	svc := NewService(NewRepository(pool),
		&liveWalletTransfer{l: ledgerSvc}, tiers.NewService(pool), giftNoopAuditor{}, nil)
	return svc, ledgerSvc
}

func giftFundWallet(t *testing.T, ledgerSvc *ledger.Service, userID string, amountKobo int64) {
	t.Helper()
	ctx := context.Background()
	clearing, err := ledgerSvc.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		t.Fatalf("clearing account: %v", err)
	}
	key := "test:fund:" + uuid.NewString()
	if err := ledgerSvc.Credit(ctx, userID, key, key, clearing.ID, amountKobo); err != nil {
		t.Fatalf("fund wallet: %v", err)
	}
}

// TestLiveDB_SendGift_CrossRailKeyReuse_StillTransfers is the phantom-gift
// regression: the raw client key is already claimed by ANOTHER rail's journal
// (the wallet credit below posts K:debit/K:credit). The gift must still move
// real money under its derived key — sender down, recipient up — and the
// connect_gifts row must carry the derived key.
func TestLiveDB_SendGift_CrossRailKeyReuse_StillTransfers(t *testing.T) {
	pool := giftTestPool(t)
	ctx := context.Background()
	svc, ledgerSvc := giftTestService(t, pool)

	sender := giftTestUser(t, pool)
	recipient := giftTestUser(t, pool)
	giftFundWallet(t, ledgerSvc, sender, 200_000)

	rawKey := "zzrail-xrail-" + uuid.NewString()
	clearing, err := ledgerSvc.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		t.Fatalf("clearing account: %v", err)
	}
	if err := ledgerSvc.Credit(ctx, sender, "other-rail:"+rawKey, rawKey, clearing.ID, 50_000); err != nil {
		t.Fatalf("pre-claim raw key: %v", err)
	}

	s0, _ := ledgerSvc.GetBalance(ctx, sender)
	r0, _ := ledgerSvc.GetBalance(ctx, recipient)

	g, err := svc.Send(ctx, sender, rawKey, SendGiftRequest{RecipientID: recipient, AmountKobo: 50_000})
	if err != nil {
		t.Fatalf("Send with a key already used on ANOTHER rail must still succeed: %v", err)
	}

	s1, _ := ledgerSvc.GetBalance(ctx, sender)
	r1, _ := ledgerSvc.GetBalance(ctx, recipient)
	if s0-s1 != 50_000 || r1-r0 != 50_000 {
		t.Fatalf("transfer must move real money: sender delta=%d, recipient delta=%d, want -50000/+50000",
			s0-s1, r1-r0)
	}

	derived := "connect:gift:" + sender + ":" + rawKey
	// The RETURNING clause does not surface idempotency_key — read the row of
	// record, which is also the stronger assertion.
	var storedKey string
	if err := pool.QueryRow(ctx,
		`SELECT idempotency_key FROM connect_gifts WHERE id = $1`, g.ID).Scan(&storedKey); err != nil {
		t.Fatalf("read stored idem key: %v", err)
	}
	if storedKey != derived {
		t.Fatalf("connect_gifts.idempotency_key = %q, want derived %q", storedKey, derived)
	}
	exists, err := ledgerSvc.Posted(ctx, derived)
	if err != nil {
		t.Fatalf("posted check: %v", err)
	}
	if !exists {
		t.Fatalf("no ledger entry under derived key %q — the gift transfer did not post", derived)
	}
}

// TestLiveDB_SendGift_ConcurrentCannotOverdraw is the S6 regression: N
// concurrent sends from ONE sender, distinct keys, each 60_000 against a
// 100_000 balance. Serialised by the wallet advisory lock inside
// ledger.Service.Debit, exactly one may succeed — the old
// GetBalance-then-PostJournal shape let every caller pass an unlocked balance
// check and overdraw.
func TestLiveDB_SendGift_ConcurrentCannotOverdraw(t *testing.T) {
	pool := giftTestPool(t)
	ctx := context.Background()
	svc, ledgerSvc := giftTestService(t, pool)

	sender := giftTestUser(t, pool)
	recipient := giftTestUser(t, pool)
	giftFundWallet(t, ledgerSvc, sender, 100_000)

	const attempts = 8
	var wg sync.WaitGroup
	var mu sync.Mutex
	var succeeded, insufficient int
	for i := range attempts {
		wg.Go(func() {
			_, err := svc.Send(ctx, sender, "zzrail-conc-"+uuid.NewString(), SendGiftRequest{
				RecipientID: recipient, AmountKobo: 60_000,
			})
			mu.Lock()
			defer mu.Unlock()
			switch {
			case err == nil:
				succeeded++
			case errors.Is(err, ledger.ErrInsufficientFunds):
				insufficient++
			default:
				t.Errorf("send %d: unexpected error: %v", i, err)
			}
		})
	}
	wg.Wait()

	if succeeded != 1 {
		t.Fatalf("concurrent sends that together exceed the balance must collapse to one winner; "+
			"got %d successes (insufficient=%d) — the check+debit is not atomic", succeeded, insufficient)
	}
	bal, err := ledgerSvc.GetBalance(ctx, sender)
	if err != nil {
		t.Fatalf("final balance: %v", err)
	}
	if bal != 40_000 {
		t.Fatalf("sender balance = %d after %d concurrent 60000 sends on 100000 — overdraw", bal, attempts)
	}
	var giftRows int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM connect_gifts WHERE sender_id=$1`, sender).Scan(&giftRows); err != nil {
		t.Fatalf("count gifts: %v", err)
	}
	if giftRows != succeeded {
		t.Fatalf("connect_gifts rows = %d but successful debits = %d — every recorded gift must be backed by money",
			giftRows, succeeded)
	}
}
