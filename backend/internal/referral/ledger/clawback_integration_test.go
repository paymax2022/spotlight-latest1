package ledger

// Live-DB integration test for REF-011: ClawBack must actually reverse a real
// prior payout's wallet credit, not just flip referral_reward_ledger.state.
//
// Verifies:
//   (1) clawback of a 'paid', non-house reward posts a balanced REVERSAL
//       entry — the beneficiary's wallet balance returns to what it was
//       before the original payout, and referral_reward_ledger.state ends at
//       'clawed_back'.
//   (2) clawback of a NOT-YET-PAID reward stays state-only: no reversal is
//       posted (nothing was ever credited), balance is untouched.
//   (3) a REPLAYED clawback (same reward, called twice) is a safe idempotent
//       no-op — no double-reversal, balance unchanged on the second call.
//
// SKIPPED whenever TEST_DATABASE_URL is unset (see withdraw_integration_test.go
// for the rationale — this test also moves money and must never point at the
// production Supabase pooler via DATABASE_URL).
//
//	TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres' \
//	  go test ./internal/referral/ledger/ -run TestClawBack -v

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	financeledger "spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/testsupport"
)

// seedVerifiedUserForClawback mirrors seedVerifiedUser in
// withdraw_integration_test.go (kept separate to avoid coupling the two test
// files' fixture shapes).
func seedVerifiedUserForClawback(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	uid := uuid.NewString()
	email := "cb-" + uid + "@test.local"
	mustExec(t, pool, `INSERT INTO auth.users (id, email) VALUES ($1,$2)`, uid, email)
	testsupport.CleanupUser(t, pool, uid)
	mustExec(t, pool,
		`INSERT INTO user_profiles (id, email, kyc_tier, kyc_status) VALUES ($1,$2,1,'verified')
		 ON CONFLICT (id) DO UPDATE SET kyc_tier=1, kyc_status='verified'`, uid, email)
	return uid
}

func TestClawBack_PaidReward_PostsBalancedReversal_Integration(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	svc := newSvc(pool)
	fin := financeledger.NewService(financeledger.NewRepository(pool), nil)

	uid := seedVerifiedUserForClawback(t, pool)

	rewardID, err := svc.Accrue(ctx, AccrueInput{
		BeneficiaryID:  uid,
		Kind:           KindReferrer,
		AmountKobo:     45_000,
		IdempotencyKey: "cb-accrue-" + uid,
	})
	if err != nil {
		t.Fatalf("accrue: %v", err)
	}

	// Drive the reward through a REAL pending -> vesting -> eligible -> paid
	// chain, exactly like a genuine payout (not a direct DB seed at 'paid'),
	// so the original credit is posted the same way production posts it.
	if err := svc.Transition(ctx, rewardID, StatePending, "cb-t1-"+rewardID); err != nil {
		t.Fatalf("transition to pending: %v", err)
	}
	if err := svc.Transition(ctx, rewardID, StateVesting, "cb-t2-"+rewardID); err != nil {
		t.Fatalf("transition to vesting: %v", err)
	}
	if err := svc.Transition(ctx, rewardID, StateEligible, "cb-t3-"+rewardID); err != nil {
		t.Fatalf("transition to eligible: %v", err)
	}
	if err := svc.Transition(ctx, rewardID, StatePaid, "cb-t4-"+rewardID); err != nil {
		t.Fatalf("transition to paid: %v", err)
	}

	balAfterPayout, err := fin.GetBalance(ctx, uid)
	if err != nil {
		t.Fatalf("balance after payout: %v", err)
	}
	if balAfterPayout != 45_000 {
		t.Fatalf("balance after payout = %d, want 45000", balAfterPayout)
	}

	// (1) Claw it back: must post a REAL balanced reversal.
	if err := svc.ClawBack(ctx, rewardID, "cb-clawback-"+rewardID); err != nil {
		t.Fatalf("clawback: %v", err)
	}

	balAfterClawback, err := fin.GetBalance(ctx, uid)
	if err != nil {
		t.Fatalf("balance after clawback: %v", err)
	}
	if balAfterClawback != 0 {
		t.Fatalf("balance after clawback = %d, want 0 (reversal must restore pre-payout balance)", balAfterClawback)
	}

	var state string
	if err := pool.QueryRow(ctx, `SELECT state FROM referral_reward_ledger WHERE id=$1`, rewardID).Scan(&state); err != nil {
		t.Fatalf("read state: %v", err)
	}
	if state != StateClawedBack {
		t.Fatalf("state = %q, want %q", state, StateClawedBack)
	}

	var reversalEntries int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM ledger_entries WHERE reference = $1`, "referral:clawback:"+rewardID,
	).Scan(&reversalEntries); err != nil {
		t.Fatalf("count reversal entries: %v", err)
	}
	if reversalEntries != 2 {
		t.Fatalf("reversal ledger entries = %d, want 2 (balanced REVERSAL_DEBIT/REVERSAL_CREDIT pair)", reversalEntries)
	}

	// (3) Replay: a second ClawBack call on the same (already clawed-back)
	// reward must be a safe no-op — no double-reversal, balance unchanged.
	if err := svc.ClawBack(ctx, rewardID, "cb-clawback-REPLAY-"+rewardID); err != nil {
		t.Fatalf("replayed clawback: %v", err)
	}
	balAfterReplay, err := fin.GetBalance(ctx, uid)
	if err != nil {
		t.Fatalf("balance after replayed clawback: %v", err)
	}
	if balAfterReplay != 0 {
		t.Fatalf("balance after replayed clawback = %d, want 0 (no double-reversal)", balAfterReplay)
	}
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM ledger_entries WHERE reference = $1`, "referral:clawback:"+rewardID,
	).Scan(&reversalEntries); err != nil {
		t.Fatalf("count reversal entries after replay: %v", err)
	}
	if reversalEntries != 2 {
		t.Fatalf("reversal ledger entries after replay = %d, want still 2 (idempotent)", reversalEntries)
	}
}

func TestClawBack_NotYetPaidReward_StateOnly_NoReversal_Integration(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	svc := newSvc(pool)
	fin := financeledger.NewService(financeledger.NewRepository(pool), nil)

	uid := seedVerifiedUserForClawback(t, pool)

	rewardID, err := svc.Accrue(ctx, AccrueInput{
		BeneficiaryID:  uid,
		Kind:           KindReferrer,
		AmountKobo:     20_000,
		IdempotencyKey: "cb-notpaid-accrue-" + uid,
	})
	if err != nil {
		t.Fatalf("accrue: %v", err)
	}
	if err := svc.Transition(ctx, rewardID, StatePending, "cb-notpaid-t1-"+rewardID); err != nil {
		t.Fatalf("transition to pending: %v", err)
	}

	// Never reached 'paid', so nothing was ever credited.
	if err := svc.ClawBack(ctx, rewardID, "cb-notpaid-clawback-"+rewardID); err != nil {
		t.Fatalf("clawback: %v", err)
	}

	bal, err := fin.GetBalance(ctx, uid)
	if err != nil {
		t.Fatalf("balance: %v", err)
	}
	if bal != 0 {
		t.Fatalf("balance = %d, want 0 (reward was never paid, so nothing to reverse)", bal)
	}

	var state string
	if err := pool.QueryRow(ctx, `SELECT state FROM referral_reward_ledger WHERE id=$1`, rewardID).Scan(&state); err != nil {
		t.Fatalf("read state: %v", err)
	}
	if state != StateClawedBack {
		t.Fatalf("state = %q, want %q", state, StateClawedBack)
	}

	var reversalEntries int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM ledger_entries WHERE reference = $1`, "referral:clawback:"+rewardID,
	).Scan(&reversalEntries); err != nil {
		t.Fatalf("count reversal entries: %v", err)
	}
	if reversalEntries != 0 {
		t.Fatalf("reversal ledger entries = %d, want 0 (no reversal for a never-paid reward)", reversalEntries)
	}
}
