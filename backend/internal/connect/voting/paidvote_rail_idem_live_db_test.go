package connectvoting

// LIVE-DB regression tests for the money-rail idempotency collision (S2):
// PaidVote used to hand the RAW client Idempotency-Key straight to
// wallet.Debit. ledger_entries.idempotency_key is a GLOBAL unique index, so
// the same key arriving from another rail (a topup, a gift, a payout — any
// module that posted under the same key first) made the vote debit a silent
// ON CONFLICT DO NOTHING no-op while connect_votes still recorded a PAID row —
// a vote with no money behind it. And two different voters sending the same
// key collided outright.
//
// Fix under test: the key is scoped per (rail, caller) —
// "connect:paidvote:<voterID>:<key>" — before it enters the ledger keyspace,
// and the same derived value is stored on connect_votes.idempotency_key.
// Every assertion below reads the ledger/balance of record, not the service's
// return value, so a silent no-op fails the test rather than passing it.
//
// GATED ON TEST_DATABASE_URL only — no DATABASE_URL fallback (that points at
// the production pooler). Runs where the other *_live_db_test.go suites run:
//
//	TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres' \
//	  go test ./internal/connect/voting/ -run TestLiveDB_PaidVote -v

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/finance/wallet"
	"spotlight/backend/internal/testsupport"
)

func railTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB connect/voting idempotency test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect test db: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping test db: %v", err)
	}
	// Registered FIRST so it runs LAST (cleanups are LIFO).
	t.Cleanup(pool.Close)
	return pool
}

// railTestVoter seeds a throwaway auth.users row (the handle_new_user trigger
// creates user_profiles) at KYC tier 3 so the fail-closed tier gate never
// rejects the small test debits.
func railTestVoter(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	ctx := context.Background()
	id := uuid.NewString()
	if _, err := pool.Exec(ctx,
		`INSERT INTO auth.users (id, email) VALUES ($1, $2)`,
		id, "connect-voting-rail-test-"+id+"@example.invalid"); err != nil {
		t.Fatalf("seed auth.users voter: %v", err)
	}
	testsupport.CleanupUser(t, pool, id)
	if _, err := pool.Exec(ctx,
		`UPDATE user_profiles SET kyc_tier = 3 WHERE id = $1`, id); err != nil {
		t.Fatalf("seed user_profiles kyc_tier: %v", err)
	}
	return id
}

// railTestContest seeds an open connect_contests row with paid voting enabled
// and the velocity guard disabled (0), so multiple sequential votes in one
// test do not trip the per-minute cap that exists to slow real voters.
func railTestContest(t *testing.T, pool *pgxpool.Pool, paidVoteKobo int64) string {
	t.Helper()
	ctx := context.Background()
	id := uuid.NewString()
	if _, err := pool.Exec(ctx, `
		INSERT INTO public.connect_contests
			(id, title, slug, status, paid_vote_kobo, velocity_per_minute)
		VALUES ($1, $2, $3, 'open', $4, 0)`,
		id, "ZZ rail-idem fixture", "zzrail-"+uuid.NewString()[:8], paidVoteKobo); err != nil {
		t.Fatalf("seed contest: %v", err)
	}
	t.Cleanup(func() {
		c := context.WithoutCancel(ctx)
		_, _ = pool.Exec(c, `DELETE FROM public.connect_votes WHERE contest_id = $1`, id)
		_, _ = pool.Exec(c, `DELETE FROM public.connect_contests WHERE id = $1`, id)
	})
	return id
}

// railRevenueAdapter satisfies RevenueAccountResolver over the real ledger —
// the same standing-account lookup app-wiring's connectRevenueAdapter does.
type railRevenueAdapter struct{ ledger *ledger.Service }

func (r railRevenueAdapter) RevenueAccountID(ctx context.Context) (string, error) {
	acc, err := r.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		return "", err
	}
	return acc.ID, nil
}

type railNoopAuditor struct{}

func (railNoopAuditor) WriteAudit(context.Context, string, string, string, string, map[string]any) error {
	return nil
}

// railTestService wires the REAL production chain (ledger → wallet → voting
// service) so the test exercises the actual money path, not a substitute.
func railTestService(t *testing.T, pool *pgxpool.Pool) (*Service, *ledger.Service) {
	t.Helper()
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)
	walletSvc := wallet.NewService(ledgerSvc, tiers.NewService(pool))
	svc := NewService(NewRepository(pool), walletSvc, railRevenueAdapter{ledgerSvc}, railNoopAuditor{}, nil)
	return svc, ledgerSvc
}

// fundWallet credits spendable balance through the same ledger the debit uses.
func fundWallet(t *testing.T, ledgerSvc *ledger.Service, userID string, amountKobo int64) {
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

// preClaimRawKey posts a journal under the RAW key K on behalf of another rail
// (the wallet topup path posts exactly this shape: K:debit on the standing
// account, K:credit on the user's wallet). Before the fix, a later PaidVote
// under the same client key collided with these entries and no-opped.
func preClaimRawKey(t *testing.T, ledgerSvc *ledger.Service, userID, rawKey string, amountKobo int64) {
	t.Helper()
	ctx := context.Background()
	clearing, err := ledgerSvc.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		t.Fatalf("clearing account: %v", err)
	}
	if err := ledgerSvc.Credit(ctx, userID, "other-rail:"+rawKey, rawKey, clearing.ID, amountKobo); err != nil {
		t.Fatalf("pre-claim raw key: %v", err)
	}
}

func countPaidVotes(t *testing.T, pool *pgxpool.Pool, contestID, voterID string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM connect_votes WHERE contest_id=$1 AND voter_id=$2 AND paid=true`,
		contestID, voterID).Scan(&n); err != nil {
		t.Fatalf("count paid votes: %v", err)
	}
	return n
}

// TestLiveDB_PaidVote_CrossRailKeyReuse_StillDebits is the phantom-vote
// regression: the raw client key was already claimed by ANOTHER rail's journal.
// Before the fix the vote debit no-opped on the global unique index but the
// paid-vote row still inserted — money never moved. Now the vote must post a
// REAL debit (balance drops, ledger carries the derived key).
func TestLiveDB_PaidVote_CrossRailKeyReuse_StillDebits(t *testing.T) {
	pool := railTestPool(t)
	ctx := context.Background()
	svc, ledgerSvc := railTestService(t, pool)

	voter := railTestVoter(t, pool)
	contest := railTestContest(t, pool, 10_000)
	fundWallet(t, ledgerSvc, voter, 200_000)

	rawKey := "zzrail-xrail-" + uuid.NewString()
	preClaimRawKey(t, ledgerSvc, voter, rawKey, 10_000)

	bal0, err := ledgerSvc.GetBalance(ctx, voter)
	if err != nil {
		t.Fatalf("balance before: %v", err)
	}

	v, err := svc.PaidVote(ctx, contest, voter, rawKey, PaidVoteRequest{OptionRef: "opt-a", Quantity: 1})
	if err != nil {
		t.Fatalf("PaidVote with a key already used on ANOTHER rail must still succeed: %v", err)
	}
	if !v.Paid {
		t.Fatalf("vote not marked paid: %+v", v)
	}

	bal1, err := ledgerSvc.GetBalance(ctx, voter)
	if err != nil {
		t.Fatalf("balance after: %v", err)
	}
	if bal0-bal1 != 10_000 {
		t.Fatalf("wallet debited %d, want 10000 — a cross-rail key collision must never swallow the vote debit",
			bal0-bal1)
	}

	// The ledger must carry the derived, caller-scoped key — not the raw one.
	derived := "connect:paidvote:" + voter + ":" + rawKey
	exists, err := ledgerSvc.Posted(ctx, derived)
	if err != nil {
		t.Fatalf("posted check: %v", err)
	}
	if !exists {
		t.Fatalf("no ledger entry under derived key %q — the vote debit did not post", derived)
	}
	var storedKey string
	if err := pool.QueryRow(ctx,
		`SELECT idempotency_key FROM connect_votes WHERE id = $1`, v.ID).Scan(&storedKey); err != nil {
		t.Fatalf("read stored idem key: %v", err)
	}
	if storedKey != derived {
		t.Fatalf("connect_votes.idempotency_key = %q, want derived %q", storedKey, derived)
	}
}

// TestLiveDB_PaidVote_CrossUserSameKey_BothDebit: two different voters may
// legitimately present the same client-generated key (e.g. a shared client
// idempotency implementation). Caller-scoped derivation gives each its own
// keyspace — both votes must land AND both wallets must be debited.
func TestLiveDB_PaidVote_CrossUserSameKey_BothDebit(t *testing.T) {
	pool := railTestPool(t)
	ctx := context.Background()
	svc, ledgerSvc := railTestService(t, pool)

	voterA := railTestVoter(t, pool)
	voterB := railTestVoter(t, pool)
	contest := railTestContest(t, pool, 10_000)
	fundWallet(t, ledgerSvc, voterA, 200_000)
	fundWallet(t, ledgerSvc, voterB, 200_000)

	rawKey := "zzrail-xuser-" + uuid.NewString()

	balA0, _ := ledgerSvc.GetBalance(ctx, voterA)
	balB0, _ := ledgerSvc.GetBalance(ctx, voterB)

	if _, err := svc.PaidVote(ctx, contest, voterA, rawKey, PaidVoteRequest{OptionRef: "opt-a", Quantity: 1}); err != nil {
		t.Fatalf("voter A PaidVote: %v", err)
	}
	if _, err := svc.PaidVote(ctx, contest, voterB, rawKey, PaidVoteRequest{OptionRef: "opt-b", Quantity: 1}); err != nil {
		t.Fatalf("voter B PaidVote with the same client key must not collide: %v", err)
	}

	balA1, _ := ledgerSvc.GetBalance(ctx, voterA)
	balB1, _ := ledgerSvc.GetBalance(ctx, voterB)
	if balA0-balA1 != 10_000 || balB0-balB1 != 10_000 {
		t.Fatalf("each voter must be debited exactly once: A debited %d, B debited %d",
			balA0-balA1, balB0-balB1)
	}
	if n := countPaidVotes(t, pool, contest, voterA); n != 1 {
		t.Fatalf("voter A paid votes = %d, want 1", n)
	}
	if n := countPaidVotes(t, pool, contest, voterB); n != 1 {
		t.Fatalf("voter B paid votes = %d, want 1", n)
	}
}

// TestLiveDB_PaidVote_TrueReplay_DebitedOnce: a genuine retry of the SAME
// logical request (same voter, key, contest, amount) must never double-charge —
// the second call is rejected as a duplicate and only one vote row exists.
func TestLiveDB_PaidVote_TrueReplay_DebitedOnce(t *testing.T) {
	pool := railTestPool(t)
	ctx := context.Background()
	svc, ledgerSvc := railTestService(t, pool)

	voter := railTestVoter(t, pool)
	contest := railTestContest(t, pool, 10_000)
	fundWallet(t, ledgerSvc, voter, 200_000)

	rawKey := "zzrail-replay-" + uuid.NewString()
	bal0, _ := ledgerSvc.GetBalance(ctx, voter)

	if _, err := svc.PaidVote(ctx, contest, voter, rawKey, PaidVoteRequest{OptionRef: "opt-a", Quantity: 1}); err != nil {
		t.Fatalf("first PaidVote: %v", err)
	}
	if _, err := svc.PaidVote(ctx, contest, voter, rawKey, PaidVoteRequest{OptionRef: "opt-a", Quantity: 1}); err == nil {
		t.Fatal("replayed PaidVote must be rejected, not double-debit")
	}

	if n := countPaidVotes(t, pool, contest, voter); n != 1 {
		t.Fatalf("paid votes = %d, want exactly 1 after a replay", n)
	}
	bal1, _ := ledgerSvc.GetBalance(ctx, voter)
	if bal0-bal1 != 10_000 {
		t.Fatalf("debited %d across a replay, want exactly 10000", bal0-bal1)
	}
}

// TestLiveDB_PaidVote_KeyReuseDifferentContest_Rejected: the same voter
// reusing one key for a DIFFERENT operation (another contest) is a foreign
// claim under the derived key — the strengthened ledger replay check (account
// + reference + amount, not just key presence) must fail it closed.
func TestLiveDB_PaidVote_KeyReuseDifferentContest_Rejected(t *testing.T) {
	pool := railTestPool(t)
	ctx := context.Background()
	svc, ledgerSvc := railTestService(t, pool)

	voter := railTestVoter(t, pool)
	contestA := railTestContest(t, pool, 10_000)
	contestB := railTestContest(t, pool, 10_000)
	fundWallet(t, ledgerSvc, voter, 200_000)

	rawKey := "zzrail-reuse-" + uuid.NewString()
	if _, err := svc.PaidVote(ctx, contestA, voter, rawKey, PaidVoteRequest{OptionRef: "opt-a", Quantity: 1}); err != nil {
		t.Fatalf("first PaidVote: %v", err)
	}
	err := func() error {
		_, err := svc.PaidVote(ctx, contestB, voter, rawKey, PaidVoteRequest{OptionRef: "opt-a", Quantity: 1})
		return err
	}()
	if err == nil {
		t.Fatal("reusing one idempotency key for a different contest must fail closed")
	}
	if !errors.Is(err, ledger.ErrDuplicate) {
		t.Fatalf("expected ledger.ErrDuplicate for a foreign key claim, got %v", err)
	}
	if n := countPaidVotes(t, pool, contestB, voter); n != 0 {
		t.Fatalf("phantom vote rows on contest B = %d, want 0", n)
	}
}
