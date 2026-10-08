package votebridge

// LIVE-DB regression tests for the replay-after-reversal wedge in
// Handler.DebitForVotes: once DebitWithBalanceCheck converges a committed
// journal BEFORE the balance gate (fix/debit-replay-before-balance), a nil
// return from VoteDebit no longer proves the money is held — saga
// compensation may already have posted the reversal legs. Fulfilling votes on
// that replay would credit against ₦0 held. The handler must verify the
// durable reversal marker on the success path too, and the pre-debit replay
// probe must scope the adoption to THIS caller's wallet — the raw
// idempotency key lives in the global namespace.
//
// SKIPPED whenever TEST_DATABASE_URL is unset — same gate as the other
// live-DB suites:
//
//	export TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
//	go test ./internal/votebridge/ -run TestLiveDB_ -v

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/finance/wallet"
	"spotlight/backend/internal/testsupport"
)

func mustVotePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect TEST_DATABASE_URL: %v", err)
	}
	t.Cleanup(pool.Close)
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping TEST_DATABASE_URL: %v", err)
	}
	return pool
}

func seedVoteUser(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	ctx := context.Background()
	id := uuid.NewString()
	if _, err := pool.Exec(ctx,
		`INSERT INTO auth.users (id, email) VALUES ($1, $2)`,
		id, "votebridge-replay-"+id+"@example.invalid"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}
	testsupport.CleanupUser(t, pool, id)
	testsupport.SetKycTier(t, ctx, pool, id, testsupport.KycTierUnlimited)
	return id
}

func voteFixture(t *testing.T, pool *pgxpool.Pool) (*wallet.Service, *Handler) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	led := ledger.NewService(ledger.NewRepository(pool), nil)
	walletSvc := wallet.NewService(led, tiers.NewService(pool))
	return walletSvc, NewHandler(walletSvc)
}

func voteCtx(t *testing.T, userID string, body []byte) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequestWithContext(context.Background(),
		http.MethodPost, "/api/finance/vote-bridge/debit", bytes.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set("user_id", userID)
	return c, w
}

const voteTestCost = int64(10_000)

func voteBody(t *testing.T, key string) []byte {
	t.Helper()
	b, err := json.Marshal(DebitForVotesRequest{
		ContestID:      "c-" + key[:8],
		ContestantID:   "k-" + key[:8],
		VoteCount:      10,
		CostKobo:       voteTestCost,
		IdempotencyKey: key,
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return b
}

// Debit votes → refund (saga compensation posts the reversal legs) → spend
// the returned funds so balance < original cost → replay the original key.
// The journal converges (nil) but nothing is held — the replay must 409 and
// the wallet must stay untouched. Before the fix, the nil return fulfilled
// votes against ₦0 held.
func TestLiveDB_DebitForVotes_ReversedReplayRefused(t *testing.T) {
	pool := mustVotePool(t)
	ctx := context.Background()
	walletSvc, h := voteFixture(t, pool)

	uid := seedVoteUser(t, pool)
	key := "vtp-" + uuid.NewString()
	cost := voteTestCost

	revenue, err := ledger.NewService(ledger.NewRepository(pool), nil).
		GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		t.Fatalf("revenue account: %v", err)
	}

	if err := walletSvc.Credit(ctx, uid, "funding:"+key, "fund-"+key, cost+5_000); err != nil {
		t.Fatalf("fund wallet: %v", err)
	}

	c, w := voteCtx(t, uid, voteBody(t, key))
	h.DebitForVotes(c)
	if w.Code != http.StatusOK {
		t.Fatalf("first debit: status %d body %s", w.Code, w.Body.String())
	}

	// Refund via the service-authenticated handler path — user_id travels in
	// the body now (member JWTs no longer reach ReverseForVotes).
	rb, rerr := json.Marshal(ReverseForVotesRequest{
		ContestID:      "c-" + key[:8],
		ContestantID:   "k-" + key[:8],
		UserID:         uid,
		IdempotencyKey: key,
	})
	if rerr != nil {
		t.Fatalf("marshal reverse body: %v", rerr)
	}
	rw := httptest.NewRecorder()
	rc, _ := gin.CreateTestContext(rw)
	rc.Request = httptest.NewRequestWithContext(context.Background(),
		http.MethodPost, "/api/finance/vote-bridge/reverse", bytes.NewReader(rb))
	rc.Request.Header.Set("Content-Type", "application/json")
	h.ReverseForVotes(rc)
	if rw.Code != http.StatusOK {
		t.Fatalf("reverse: %d %s", rw.Code, rw.Body.String())
	}
	reversed, err := walletSvc.VoteDebitReversed(ctx, uid, key)
	if err != nil || !reversed {
		t.Fatalf("reversed marker missing: reversed=%v err=%v", reversed, err)
	}

	// Spend the refunded balance so a balance-check would now fail.
	bal, err := walletSvc.GetBalance(ctx, uid)
	if err != nil {
		t.Fatalf("balance: %v", err)
	}
	if bal.BalanceKobo <= 0 {
		t.Fatalf("expected refundable balance, got %d", bal.BalanceKobo)
	}
	if err := walletSvc.Debit(ctx, uid, "spend:"+key, "spend-"+key, revenue.ID, bal.BalanceKobo); err != nil {
		t.Fatalf("spend refund: %v", err)
	}

	// Replay the ORIGINAL key — journal converges (nil) but nothing is held.
	c2, w2 := voteCtx(t, uid, voteBody(t, key))
	h.DebitForVotes(c2)
	if w2.Code == http.StatusOK {
		t.Fatalf("reversed replay fulfilled votes against ₦0 held: %s", w2.Body.String())
	}
	if w2.Code != http.StatusConflict {
		t.Fatalf("expected 409 for reversed replay, got %d: %s", w2.Code, w2.Body.String())
	}

	bal2, err := walletSvc.GetBalance(ctx, uid)
	if err != nil {
		t.Fatalf("balance2: %v", err)
	}
	if bal2.BalanceKobo != 0 {
		t.Fatalf("replay drained wallet: balance=%d", bal2.BalanceKobo)
	}
}

// A true replay (journal committed, NOT reversed, funds since moved on) must
// still converge — the fast path can't overreach into rejecting legitimate
// retries either.
func TestLiveDB_DebitForVotes_TrueReplayConverges(t *testing.T) {
	pool := mustVotePool(t)
	ctx := context.Background()
	walletSvc, h := voteFixture(t, pool)

	uid := seedVoteUser(t, pool)
	key := "vtp-" + uuid.NewString()
	cost := voteTestCost

	revenue, err := ledger.NewService(ledger.NewRepository(pool), nil).
		GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		t.Fatalf("revenue account: %v", err)
	}

	if err := walletSvc.Credit(ctx, uid, "funding:"+key, "fund-"+key, cost+5_000); err != nil {
		t.Fatalf("fund: %v", err)
	}
	c, w := voteCtx(t, uid, voteBody(t, key))
	h.DebitForVotes(c)
	if w.Code != http.StatusOK {
		t.Fatalf("first debit: %d %s", w.Code, w.Body.String())
	}

	// Spend remaining balance below the debit amount.
	if err := walletSvc.Debit(ctx, uid, "spend:"+key, "spend-"+key, revenue.ID, 5_000); err != nil {
		t.Fatalf("spend: %v", err)
	}
	bal, err := walletSvc.GetBalance(ctx, uid)
	if err != nil {
		t.Fatalf("balance: %v", err)
	}
	if bal.BalanceKobo >= cost {
		t.Fatalf("test setup: balance %d should be < cost %d", bal.BalanceKobo, cost)
	}

	c2, w2 := voteCtx(t, uid, voteBody(t, key))
	h.DebitForVotes(c2)
	if w2.Code != http.StatusOK {
		t.Fatalf("true replay failed to converge: %d %s", w2.Code, w2.Body.String())
	}
}

// A different user replaying the same global key must NOT adopt the
// commission-side entry: the wallet-side leg belongs to someone else, so the
// replay is a foreign claim and must not fulfil.
func TestLiveDB_DebitForVotes_ForeignKeyRefused(t *testing.T) {
	pool := mustVotePool(t)
	ctx := context.Background()
	walletSvc, h := voteFixture(t, pool)

	victim := seedVoteUser(t, pool)
	attacker := seedVoteUser(t, pool)
	key := "vtp-" + uuid.NewString()
	cost := voteTestCost

	if err := walletSvc.Credit(ctx, victim, "funding:"+key, "fund-v-"+key, cost); err != nil {
		t.Fatalf("fund victim: %v", err)
	}
	c, w := voteCtx(t, victim, voteBody(t, key))
	h.DebitForVotes(c)
	if w.Code != http.StatusOK {
		t.Fatalf("victim debit: %d %s", w.Code, w.Body.String())
	}

	// Attacker (funded) replays the victim's key at the same cost.
	if err := walletSvc.Credit(ctx, attacker, "funding:"+key, "fund-a-"+key, cost); err != nil {
		t.Fatalf("fund attacker: %v", err)
	}
	c2, w2 := voteCtx(t, attacker, voteBody(t, key))
	h.DebitForVotes(c2)
	if w2.Code == http.StatusOK {
		t.Fatalf("foreign key adoption fulfilled votes: %s", w2.Body.String())
	}
	if w2.Code != http.StatusPaymentRequired {
		t.Fatalf("expected 402 for foreign claim, got %d: %s", w2.Code, w2.Body.String())
	}
	ab, err := walletSvc.GetBalance(ctx, attacker)
	if err != nil {
		t.Fatalf("attacker balance: %v", err)
	}
	if ab.BalanceKobo != cost {
		t.Fatalf("attacker wallet touched: balance=%d want %d", ab.BalanceKobo, cost)
	}
}

// Same-user, cross-module journal adoption: the idempotency namespace is
// global, so a member can replay a key their own OTHER-module debit used
// (marketplace boost keys are payer-knowable) to fulfil votes against that
// journal — including journals that were already refunded under their own
// module prefix. The replay probe must verify the vote-purchase reference,
// not just account+amount.
func TestLiveDB_DebitForVotes_CrossModuleJournalRefused(t *testing.T) {
	pool := mustVotePool(t)
	ctx := context.Background()
	walletSvc, h := voteFixture(t, pool)
	led := ledger.NewService(ledger.NewRepository(pool), nil)

	uid := seedVoteUser(t, pool)
	key := "mkt:boost:" + uuid.NewString()[:8] + ":charge"

	commission, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountCommission)
	if err != nil {
		t.Fatalf("commission account: %v", err)
	}

	if err := walletSvc.Credit(ctx, uid, "funding:"+key, "fund-"+key, voteTestCost); err != nil {
		t.Fatalf("fund: %v", err)
	}
	// The member's own marketplace-boost journal: user_wallet → commission at
	// the same amount, NON-vote reference — exactly the shape a naive
	// account+amount probe would adopt.
	if err := led.Debit(ctx, uid, "mkt:boost:premium:charge", key, commission.ID, voteTestCost); err != nil {
		t.Fatalf("seed boost journal: %v", err)
	}

	c, w := voteCtx(t, uid, voteBody(t, key))
	h.DebitForVotes(c)
	if w.Code == http.StatusOK {
		t.Fatalf("cross-module journal adoption fulfilled votes: %s", w.Body.String())
	}
	if w.Code != http.StatusPaymentRequired {
		t.Fatalf("expected 402 for cross-module claim, got %d: %s", w.Code, w.Body.String())
	}
	bal, err := walletSvc.GetBalance(ctx, uid)
	if err != nil {
		t.Fatalf("balance: %v", err)
	}
	if bal.BalanceKobo != 0 {
		t.Fatalf("wallet touched: balance=%d want 0 (boost debit stands)", bal.BalanceKobo)
	}
}
