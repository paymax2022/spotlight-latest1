package invest

// E2E-MTL-002: invest deposit/withdraw idempotency-replay contract.
// A replayed mutation must return the SAME result as the first call — the
// wallet view, status 200 — and post exactly one set of ledger legs. Before the
// fix, the replay propagated ledger.ErrDuplicate (Redis fast-path) or a raw
// 23505 from the invest ledger (no Redis), surfacing as a 500.
//
// Live-DB only, gated on TEST_DATABASE_URL (helpers live in
// live_journey_test.go — same package).

import (
	"context"
	"net/http"
	"testing"

	goredis "github.com/redis/go-redis/v9"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/testsupport"
)

func countInvLegs(t *testing.T, ctx context.Context, pool *pgxpool.Pool, like string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM invest_ledger_entries WHERE idempotency_key LIKE $1`, like).Scan(&n); err != nil {
		t.Fatalf("count invest legs %q: %v", like, err)
	}
	return n
}

// Replay of the same Idempotency-Key must return the identical wallet view and
// exactly one balanced pair on EACH ledger (main :main pair + invest :inv pair).
func TestLiveDB_InvestDepositReplayReturnsSameResult(t *testing.T) {
	ctx := context.Background()
	pool := livePool(t)
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	svc := NewService(pool, led, NewMockBroker(), NewMockMarketData(), NewMockPublicOffer())

	u := seedUser(t, ctx, pool, led, testsupport.KycTierUnlimited, 15_000_000)
	key := "mtl-dep-replay:" + uuid.NewString()

	w1, err := svc.Deposit(ctx, u, key, 10_000_000, "paymax_wallet")
	if err != nil {
		t.Fatalf("deposit: %v", err)
	}
	if w1.AvailableCashKobo != 10_000_000 {
		t.Fatalf("invest cash must equal the deposit, got %d", w1.AvailableCashKobo)
	}

	w2, err := svc.Deposit(ctx, u, key, 10_000_000, "paymax_wallet")
	if err != nil {
		t.Fatalf("replay must return the first result, got error %v", err)
	}
	if *w2 != *w1 {
		t.Fatalf("replay must return the same wallet view: %+v vs %+v", w2, w1)
	}

	// Exactly one balanced pair on each ledger — the contract the idempotency
	// key exists to keep.
	if n, sum := countLegs(t, ctx, pool, key+":main:%"); n != 2 || sum != 20_000_000 {
		t.Fatalf("deposit replay double-posted the main leg: %d rows summing %d", n, sum)
	}
	if n := countInvLegs(t, ctx, pool, key+":inv%"); n != 2 {
		t.Fatalf("deposit replay double-posted the invest leg: %d rows", n)
	}
}

// A replay that arrives AFTER the invest cash has been spent must still return
// a result — the Posted pre-check keeps a completed withdrawal out of
// il.Withdraw's in-tx balance gate.
func TestLiveDB_InvestWithdrawReplayReturnsSameResult(t *testing.T) {
	ctx := context.Background()
	pool := livePool(t)
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	svc := NewService(pool, led, NewMockBroker(), NewMockMarketData(), NewMockPublicOffer())

	u := seedUser(t, ctx, pool, led, testsupport.KycTierUnlimited, 15_000_000)
	if _, err := svc.Deposit(ctx, u, "mtl-wd-seed:"+uuid.NewString(), 10_000_000, "paymax_wallet"); err != nil {
		t.Fatalf("seed deposit: %v", err)
	}

	key := "mtl-wd-replay:" + uuid.NewString()
	w1, err := svc.Withdraw(ctx, u, key, 4_000_000, "paymax_wallet")
	if err != nil {
		t.Fatalf("withdraw: %v", err)
	}
	w2, err := svc.Withdraw(ctx, u, key, 4_000_000, "paymax_wallet")
	if err != nil {
		t.Fatalf("withdraw replay must return the first result, got %v", err)
	}
	if *w2 != *w1 {
		t.Fatalf("replay must return the same wallet view: %+v vs %+v", w2, w1)
	}
	if n := countInvLegs(t, ctx, pool, key+":inv%"); n != 2 {
		t.Fatalf("withdraw replay double-posted the invest leg: %d rows", n)
	}
	if n, _ := countLegs(t, ctx, pool, key+":main:%"); n != 2 {
		t.Fatalf("withdraw replay double-posted the main leg: %d rows", n)
	}
}

// The 202 pending sentinels must be wired into the handler errMap — a replay
// whose leg is locked-but-not-durable answers "not yet", never 500.
func TestErrMap_PendingLegsAre202(t *testing.T) {
	for _, e := range []error{ErrDepositPending, ErrWithdrawPending} {
		if got := errMap.Code(e); got != http.StatusAccepted {
			t.Errorf("errMap.Code(%v) = %d, want 202", e, got)
		}
	}
}
