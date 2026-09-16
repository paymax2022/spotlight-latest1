package trading

// Integration test for the module wiring: the Module-KYC service is the wallet's
// REAL access gate. A user with no verification is refused a deposit; once KYC is
// APPROVED the same deposit succeeds. This is what replaces the wallet's deny-all
// default. Skipped unless TEST_DATABASE_URL is set —
// deliberately with NO fallback to DATABASE_URL, which the root .env points
// at the PRODUCTION Supabase pooler.

import (
	"context"
	"errors"
	"os"
	"testing"

	goredis "github.com/redis/go-redis/v9"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/trading/kyc"
	"spotlight/backend/internal/trading/wallet"

	"spotlight/backend/internal/testsupport"
)

func TestLiveDB_KycGatesWallet(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL — skipping trading gate wiring test")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)

	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	kycSvc := kyc.NewService(pool)
	// Exactly the Register wiring: kycSvc is the wallet's AccessGate.
	walSvc := wallet.NewService(pool, led, kycSvc, 2000, 0)

	// Seed a funded user with NO trading KYC.
	u := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	testsupport.CleanupUser(t, pool, u)
	src, _ := led.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err := led.Credit(ctx, u, "seed", "seed:"+u+":"+uuid.NewString(), src.ID, 5_000_000); err != nil {
		t.Fatalf("fund wallet: %v", err)
	}

	// Without Module-KYC, the deposit is refused by the gate.
	if _, err := walSvc.Subscribe(ctx, u, "wire:"+uuid.NewString(), 1_000_000); !errors.Is(err, wallet.ErrNoAccess) {
		t.Fatalf("deposit without module-KYC must be refused; got %v", err)
	}

	// Approve Module-KYC → the SAME gate now grants access.
	reviewer := uuid.NewString()
	if err := kycSvc.Submit(ctx, u); err != nil {
		t.Fatalf("submit: %v", err)
	}
	if err := kycSvc.StartReview(ctx, reviewer, u); err != nil {
		t.Fatalf("start review: %v", err)
	}
	if err := kycSvc.Approve(ctx, reviewer, u, "id_verified"); err != nil {
		t.Fatalf("approve: %v", err)
	}
	o, err := walSvc.Subscribe(ctx, u, "wire2:"+uuid.NewString(), 1_000_000)
	if err != nil {
		t.Fatalf("deposit after KYC approval must succeed; got %v", err)
	}
	if o.UnitsDelta <= 0 {
		t.Fatalf("approved deposit minted no units: %d", o.UnitsDelta)
	}
}
