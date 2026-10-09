package fx

// Live-DB pins for the wave-10 FX backlog (fixture prefix "w10-fx-"):
//   (a) Convert's lookup misses surface clean sentinels — ErrQuoteNotFound /
//       ErrConversionNotFound — never a raw pgx.ErrNoRows that the handler
//       would map to a 500.
//   (b) GetCurrencyWallet (GET /finance/fx/wallets/:currency) is a PURE READ —
//       it returned a get-or-create upsert before, a WRITE on a read. An absent
//       wallet must answer a zero-balance view AND leave currency_wallets
//       untouched; the row is materialised lazily by mirrorCurrencyWalletTx on
//       the first conversion into that currency.
// Skipped unless TEST_DATABASE_URL is set.

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/testsupport"
)

func livePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL — skipping fx live-DB test")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		t.Fatalf("ping: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func seedUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	u := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		u, "w10-fx-"+u+"@seed.test"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	testsupport.CleanupUserCtx(t, ctx, pool, u)
	return u
}

func countWallets(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM currency_wallets WHERE user_id=$1`, userID).Scan(&n); err != nil {
		t.Fatalf("count currency_wallets: %v", err)
	}
	return n
}

func TestLive_GetCurrencyWallet_NeverWrites(t *testing.T) {
	ctx := context.Background()
	pool := livePool(t)
	u := seedUser(t, ctx, pool)
	svc := NewService(pool, nil, nil, nil)

	// Absent wallet: zero-balance view, normalized currency, NO row written.
	w, err := svc.GetCurrencyWallet(ctx, u, "usd")
	if err != nil {
		t.Fatalf("get absent wallet: %v", err)
	}
	if w.Currency != "USD" || w.BalanceMinor != 0 {
		t.Fatalf("absent wallet must read as a zero-balance USD view, got %+v", w)
	}
	if n := countWallets(t, ctx, pool, u); n != 0 {
		t.Fatalf("GET wallet wrote %d currency_wallets rows — a read must never write", n)
	}

	// Materialise the row out-of-band (as a conversion's mirror would), then the
	// read must return the persisted projection — and still write nothing.
	if _, err := pool.Exec(ctx,
		`INSERT INTO currency_wallets (user_id, currency, balance_minor) VALUES ($1,'USD',4200)`, u); err != nil {
		t.Fatalf("seed wallet row: %v", err)
	}
	w, err = svc.GetCurrencyWallet(ctx, u, "USD")
	if err != nil {
		t.Fatalf("get existing wallet: %v", err)
	}
	if w.BalanceMinor != 4200 || w.ID == "" {
		t.Fatalf("existing wallet must return stored id+balance, got %+v", w)
	}
	if n := countWallets(t, ctx, pool, u); n != 1 {
		t.Fatalf("GET wallet on an existing row must not write, found %d rows", n)
	}
}

func TestLive_Convert_UnknownQuote_IsClean404Sentinel(t *testing.T) {
	ctx := context.Background()
	pool := livePool(t)
	u := seedUser(t, ctx, pool)
	svc := NewService(pool, nil, nil, nil)

	// A well-formed but nonexistent quote id — ErrQuoteNotFound, not a raw
	// pgx.ErrNoRows that would 500 at the handler.
	_, err := svc.Convert(ctx, u, ConvertRequest{
		QuoteID:        uuid.NewString(),
		IdempotencyKey: "w10-fx-" + uuid.NewString(),
	})
	if !errors.Is(err, ErrQuoteNotFound) {
		t.Fatalf("convert with unknown quote: got %v, want ErrQuoteNotFound", err)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		t.Fatal("a raw driver error must never escape Convert")
	}
}

func TestLive_ConversionByIdemKey_Miss_IsCleanSentinel(t *testing.T) {
	ctx := context.Background()
	pool := livePool(t)
	svc := NewService(pool, nil, nil, nil)

	// The replay-resolution helper must not leak pgx.ErrNoRows — it feeds the
	// ON CONFLICT lost-race path where a miss otherwise 500s.
	_, err := svc.getConversionByKey(ctx, "w10-fx-no-such-key-"+uuid.NewString())
	if !errors.Is(err, ErrConversionNotFound) {
		t.Fatalf("getConversionByKey miss: got %v, want ErrConversionNotFound", err)
	}
	_, err = svc.getConversion(ctx, uuid.NewString())
	if !errors.Is(err, ErrConversionNotFound) {
		t.Fatalf("getConversion miss: got %v, want ErrConversionNotFound", err)
	}
}
