package social

// LIVE-DB regression tests for the S4/S2 pool money-rail fixes:
//  S4 — PayoutPool used to flip OPEN→PAID_OUT and record the drain BEFORE
//       crediting the beneficiary. A failed credit left the pool marked
//       drained-but-unpaid: canPool blocked every retry and nothing healed it.
//       The new order credits first (claim reverts on failure) and a PAID_OUT
//       re-entry converges on the ledger — stale PAID_OUT-but-unpaid residue
//       is paid out on the next call.
//  S2 — ContributePool passed the raw caller Idempotency-Key as the ledger
//       journal key on a debit-only path. A same-amount collision on another
//       account satisfied the ledger's replay check while posting nothing —
//       and the ON CONFLICT insert swallowed it, leaving a phantom
//       "contributed" state. Journal keys are now namespaced + pool-scoped
//       ("social:pool:<pool>:<key>") and the debit leg is verified on THIS
//       contributor's wallet (account + key + amount), so a colliding key is
//       refused instead of phantom-paid.
//  S5 — every social money path must emit an audit event (NL-12 / iron rule);
//       a recording Auditor proves the events fire.
// ⚠️ GATED ON TEST_DATABASE_URL — these move money. Run:
//	TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres' \
//	  go test ./internal/social/ -run 'TestLiveDB_' -v

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/cashtag"
	"spotlight/backend/internal/finance/ledger"
)

// recordingAuditor captures audit events to prove the NL-12 seam fires.
type recordingAuditor struct{ actions []string }

func (r *recordingAuditor) LogAction(_, _, action, _, _, _ string, _, _ map[string]any, _, _, _ string) {
	r.actions = append(r.actions, action)
}

func socialServiceWithAudit(pool *pgxpool.Pool, audit Auditor) *Service {
	return NewService(pool, ledger.NewService(ledger.NewRepository(pool), nil),
		cashtag.NewService(pool), NewAML(pool, DefaultAMLConfig()), audit)
}

func fundedContributor(t *testing.T, ctx context.Context, pool *pgxpool.Pool, led *ledger.Service, kobo int64) string {
	t.Helper()
	u := socialTestUser(t, pool)
	setKycTier(t, pool, u, 1)
	fundWallet(t, ctx, led, u, kobo)
	return u
}

// A stale PAID_OUT row — drain recorded, NO beneficiary credit — is exactly
// the residue the old ordering left on a failed credit. The re-entry path
// must pay the beneficiary and settle, not answer "not payable" forever.
func TestLiveDB_SocialPayoutPool_StalePaidOut_Heals(t *testing.T) {
	pool := socialTestPool(t)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), nil)
	svc := socialService(pool)

	organiser := socialTestUser(t, pool)
	setKycTier(t, pool, organiser, 1)
	beneficiary := fundedContributor(t, ctx, pool, led, 10_000_00)
	contributor := fundedContributor(t, ctx, pool, led, 10_000_00)

	p, err := svc.CreatePool(ctx, organiser, "heal-pool", &beneficiary)
	if err != nil {
		t.Fatalf("create pool: %v", err)
	}
	if _, err := svc.ContributePool(ctx, contributor, p.ID, 400_00, "c-"+shortTag()); err != nil {
		t.Fatalf("contribute: %v", err)
	}

	// Simulate the pre-fix wedge: PAID_OUT + drain row, zero credit legs.
	if _, err := pool.Exec(ctx, `UPDATE group_pools SET state='PAID_OUT' WHERE id=$1`, p.ID); err != nil {
		t.Fatalf("seed stale state: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO pool_contributions (id, pool_id, user_id, amount_kobo, idempotency_key)
		 VALUES (gen_random_uuid(), $1, $2, -40000, $3)`,
		p.ID, beneficiary, "payout:"+p.ID); err != nil {
		t.Fatalf("seed drain row: %v", err)
	}
	if bal, err := svc.PoolBalance(ctx, p.ID); err != nil || bal != 0 {
		t.Fatalf("seeded balance = %d err=%v, want 0 (pool reads drained)", bal, err)
	}

	// Re-entry: must credit the beneficiary — the pool is NOT a tombstone.
	if err := svc.PayoutPool(ctx, organiser, p.ID, "retry-"+shortTag()); err != nil {
		t.Fatalf("heal payout err = %v, want nil", err)
	}
	if bal, _ := led.GetBalance(ctx, beneficiary); bal != 10_400_00 {
		t.Fatalf("beneficiary balance = %d, want 1040000 — the stale PAID_OUT must be paid out, not reported paid", bal)
	}
	// And it stays converged: a second re-entry is a no-op, not a double-pay.
	if err := svc.PayoutPool(ctx, organiser, p.ID, "retry2-"+shortTag()); err != nil {
		t.Fatalf("second re-entry err = %v, want nil", err)
	}
	if bal, _ := led.GetBalance(ctx, beneficiary); bal != 10_400_00 {
		t.Fatalf("beneficiary balance after second re-entry = %d, want 1040000 (exactly one credit)", bal)
	}
}

// A PAID_OUT pool whose drain row is ALSO missing (crash one step earlier
// under the old ordering) must still converge: credit + drain on re-entry,
// and PoolBalance returns to zero.
func TestLiveDB_SocialPayoutPool_PaidOutNoDrain_Heals(t *testing.T) {
	pool := socialTestPool(t)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), nil)
	svc := socialService(pool)

	organiser := socialTestUser(t, pool)
	setKycTier(t, pool, organiser, 1)
	contributor := fundedContributor(t, ctx, pool, led, 10_000_00)

	p, err := svc.CreatePool(ctx, organiser, "nodrain", nil)
	if err != nil {
		t.Fatalf("create pool: %v", err)
	}
	if _, err := svc.ContributePool(ctx, contributor, p.ID, 250_00, "c-"+shortTag()); err != nil {
		t.Fatalf("contribute: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE group_pools SET state='PAID_OUT' WHERE id=$1`, p.ID); err != nil {
		t.Fatalf("seed stale state: %v", err)
	}
	// No drain row → balance still reads positive; credit never posted.
	if bal, err := svc.PoolBalance(ctx, p.ID); err != nil || bal != 250_00 {
		t.Fatalf("seeded balance = %d err=%v, want 25000", bal, err)
	}

	if err := svc.PayoutPool(ctx, organiser, p.ID, "retry-"+shortTag()); err != nil {
		t.Fatalf("heal payout err = %v, want nil", err)
	}
	if bal, _ := led.GetBalance(ctx, organiser); bal != 250_00 {
		t.Fatalf("organiser balance = %d, want 25000", bal)
	}
	if bal, err := svc.PoolBalance(ctx, p.ID); err != nil || bal != 0 {
		t.Fatalf("post-heal balance = %d err=%v, want 0 (drain recorded)", bal, err)
	}
}

// The happy path stays convergent: payout → PAID_OUT, one credit, drain to
// zero, and a re-entry under a DIFFERENT caller key replays idempotently.
func TestLiveDB_SocialPayoutPool_HappyPath_IdempotentReentry(t *testing.T) {
	pool := socialTestPool(t)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), nil)
	svc := socialService(pool)

	organiser := socialTestUser(t, pool)
	setKycTier(t, pool, organiser, 1)
	a := fundedContributor(t, ctx, pool, led, 10_000_00)
	b := fundedContributor(t, ctx, pool, led, 10_000_00)

	p, err := svc.CreatePool(ctx, organiser, "happy", nil)
	if err != nil {
		t.Fatalf("create pool: %v", err)
	}
	if _, err := svc.ContributePool(ctx, a, p.ID, 100_00, "ca-"+shortTag()); err != nil {
		t.Fatalf("contribute a: %v", err)
	}
	if _, err := svc.ContributePool(ctx, b, p.ID, 50_00, "cb-"+shortTag()); err != nil {
		t.Fatalf("contribute b: %v", err)
	}
	if err := svc.PayoutPool(ctx, organiser, p.ID, "pay-"+shortTag()); err != nil {
		t.Fatalf("payout: %v", err)
	}
	if bal, _ := led.GetBalance(ctx, organiser); bal != 150_00 {
		t.Fatalf("organiser balance = %d, want 15000", bal)
	}
	if bal, err := svc.PoolBalance(ctx, p.ID); err != nil || bal != 0 {
		t.Fatalf("post-payout balance = %d err=%v, want 0", bal, err)
	}
	got, err := svc.getPool(ctx, p.ID)
	if err != nil || got.State != PoolPaidOut {
		t.Fatalf("pool state = %v err=%v, want PAID_OUT", got, err)
	}
	// Re-entry under a fresh caller key → nil, no second credit.
	if err := svc.PayoutPool(ctx, organiser, p.ID, "pay2-"+shortTag()); err != nil {
		t.Fatalf("re-entry err = %v, want nil", err)
	}
	if bal, _ := led.GetBalance(ctx, organiser); bal != 150_00 {
		t.Fatalf("organiser balance after re-entry = %d, want 15000", bal)
	}
}

// Cross-user key collision (S2): user A contributed ₦1 with key K; user B
// reusing K at the same amount must be REFUSED — the ledger's same-amount
// replay check would otherwise no-op B's debit while the contribution row
// pretends B paid. Namespaced+scoped keys + the account/key/amount verify
// turn that into an explicit error; B's wallet is untouched.
func TestLiveDB_SocialContributePool_CrossUserCollision_Refused(t *testing.T) {
	pool := socialTestPool(t)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), nil)
	svc := socialService(pool)

	organiser := socialTestUser(t, pool)
	setKycTier(t, pool, organiser, 1)
	alice := fundedContributor(t, ctx, pool, led, 10_000_00)
	bob := fundedContributor(t, ctx, pool, led, 10_000_00)

	p, err := svc.CreatePool(ctx, organiser, "collide", nil)
	if err != nil {
		t.Fatalf("create pool: %v", err)
	}
	key := "shared-" + shortTag()
	if _, err := svc.ContributePool(ctx, alice, p.ID, 100_00, key); err != nil {
		t.Fatalf("alice contribute: %v", err)
	}
	if _, err := svc.ContributePool(ctx, bob, p.ID, 100_00, key); err == nil {
		t.Fatal("bob's colliding contribution succeeded — a same-amount collision on another account must be refused, not phantom-paid")
	}
	if bal, _ := led.GetBalance(ctx, bob); bal != 10_000_00 {
		t.Fatalf("bob balance = %d, want 1000000 — a refused contribution must never debit", bal)
	}
	var bobRows int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM pool_contributions WHERE pool_id=$1 AND user_id=$2 AND amount_kobo>0`,
		p.ID, bob).Scan(&bobRows); err != nil {
		t.Fatalf("count bob contributions: %v", err)
	}
	if bobRows != 0 {
		t.Fatalf("bob recorded %d contribution(s) without paying — phantom row", bobRows)
	}

	// And the SAME contributor retrying their own key is a legit replay:
	// no second debit, balance returned.
	if bal, _ := led.GetBalance(ctx, alice); bal != 9_900_00 {
		t.Fatalf("alice balance = %d, want 990000", bal)
	}
	if _, err := svc.ContributePool(ctx, alice, p.ID, 100_00, key); err != nil {
		t.Fatalf("alice same-key retry err = %v, want nil (her own key replays)", err)
	}
	if bal, _ := led.GetBalance(ctx, alice); bal != 9_900_00 {
		t.Fatalf("alice balance after retry = %d, want 990000 (exactly one debit)", bal)
	}
}

// Same-user cross-pool key reuse (F-525-1): the journal key is pool-scoped so
// pool P2's "social:pool:P2:K" debit would post for real while the global
// uq_pool_contributions_idem insert silently no-ops on K — escrowed money with
// no contribution row. The pre-debit key lookup must refuse it BEFORE the
// wallet is touched; a retry of the SAME pool+amount stays a clean replay.
func TestLiveDB_SocialContributePool_CrossPoolSameKey_Refused(t *testing.T) {
	pool := socialTestPool(t)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), nil)
	svc := socialService(pool)

	organiser := socialTestUser(t, pool)
	setKycTier(t, pool, organiser, 1)
	alice := fundedContributor(t, ctx, pool, led, 10_000_00)

	p1, err := svc.CreatePool(ctx, organiser, "pool-one", nil)
	if err != nil {
		t.Fatalf("create pool1: %v", err)
	}
	p2, err := svc.CreatePool(ctx, organiser, "pool-two", nil)
	if err != nil {
		t.Fatalf("create pool2: %v", err)
	}

	key := "reuse-" + shortTag()
	if _, err := svc.ContributePool(ctx, alice, p1.ID, 100_00, key); err != nil {
		t.Fatalf("alice contribute p1: %v", err)
	}
	if _, err := svc.ContributePool(ctx, alice, p2.ID, 100_00, key); err == nil {
		t.Fatal("cross-pool key reuse succeeded — must be refused before the debit posts")
	}
	if bal, _ := led.GetBalance(ctx, alice); bal != 9_900_00 {
		t.Fatalf("alice balance = %d, want 990000 — refused cross-pool reuse must never debit", bal)
	}
	var p2Rows int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM pool_contributions WHERE pool_id=$1 AND amount_kobo>0`,
		p2.ID).Scan(&p2Rows); err != nil {
		t.Fatalf("count p2 contributions: %v", err)
	}
	if p2Rows != 0 {
		t.Fatalf("pool2 recorded %d phantom contribution(s)", p2Rows)
	}
	// Same pool + same key + same amount remains an idempotent replay.
	if _, err := svc.ContributePool(ctx, alice, p1.ID, 100_00, key); err != nil {
		t.Fatalf("same-pool same-key retry err = %v, want nil", err)
	}
	if bal, _ := led.GetBalance(ctx, alice); bal != 9_900_00 {
		t.Fatalf("alice balance after replay = %d, want 990000 (exactly one debit)", bal)
	}
}

// Every money mutation must emit an audit event (iron rule): a real
// contribution + payout produces the module-scoped events.
func TestLiveDB_SocialMoneyPath_EmitsAuditEvents(t *testing.T) {
	pool := socialTestPool(t)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), nil)
	rec := &recordingAuditor{}
	svc := socialServiceWithAudit(pool, rec)

	organiser := socialTestUser(t, pool)
	setKycTier(t, pool, organiser, 1)
	contributor := fundedContributor(t, ctx, pool, led, 10_000_00)

	p, err := svc.CreatePool(ctx, organiser, "audited", nil)
	if err != nil {
		t.Fatalf("create pool: %v", err)
	}
	if _, err := svc.ContributePool(ctx, contributor, p.ID, 75_00, "c-"+shortTag()); err != nil {
		t.Fatalf("contribute: %v", err)
	}
	if err := svc.PayoutPool(ctx, organiser, p.ID, "pay-"+shortTag()); err != nil {
		t.Fatalf("payout: %v", err)
	}

	want := map[string]bool{
		"social.pool.create":     false,
		"social.pool.contribute": false,
		"social.pool.payout":     false,
	}
	for _, a := range rec.actions {
		if _, ok := want[a]; ok {
			want[a] = true
		}
	}
	for evt, seen := range want {
		if !seen {
			t.Errorf("audit event %s missing — a social money mutation emitted no audit (NL-12 violation); got %v", evt, rec.actions)
		}
	}
}
