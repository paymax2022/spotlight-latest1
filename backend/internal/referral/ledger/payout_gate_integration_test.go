package ledger

// Live-DB integration test for REF-009's payout-side account-status gate.
//
// WithdrawEligible already refused a suspended/locked/deleted account at the
// withdrawal request (see TestWithdrawEligible_AccountStatusGate_Integration).
// That left a narrower gap open: Transition(..., StatePaid, ...) — invoked
// directly (e.g. by an admin/ops action, not through WithdrawEligible) — would
// still post a real payout to a suspended account, since the gate only ever
// sat on the withdrawal path. This closes that gap by applying the identical
// checkAccountEligibleForMoneyMovement gate inside Transition itself, so a
// payout and a withdrawal are refused on the same terms regardless of which
// entry point is used.
//
// SKIPPED whenever TEST_DATABASE_URL is unset (see withdraw_integration_test.go
// for the bring-up recipe).

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestTransition_PayoutAccountStatusGate_Integration(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	svc := newSvc(pool)

	// (a) Suspended account: a direct Transition to 'paid' from 'eligible'
	// must be refused, and — critically — must not silently flip state
	// without moving money (the exact bug class REF-011 fixed elsewhere in
	// this file).
	suspended := seedVerifiedUser(t, pool, 1, "verified")
	rewardID := seedEligibleRewardReturningID(t, pool, suspended, 30_000)
	mustExec(t, pool, `UPDATE platform_users SET status='suspended' WHERE id=$1`, suspended)

	if err := svc.Transition(ctx, rewardID, StatePaid, "payout-suspended-"+rewardID); err != ErrAccountNotEligible {
		t.Fatalf("suspended account: expected ErrAccountNotEligible, got %v", err)
	}

	var state string
	if err := pool.QueryRow(ctx, `SELECT state FROM referral_reward_ledger WHERE id=$1`, rewardID).Scan(&state); err != nil {
		t.Fatalf("reload reward: %v", err)
	}
	if state != StateEligible {
		t.Fatalf("suspended account: reward state changed to %q despite refused payout — state and money must move together or not at all", state)
	}

	var ledgerRows int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM ledger_entries WHERE reference=$1`, "referral:payout:"+rewardID).Scan(&ledgerRows); err != nil {
		t.Fatalf("count ledger entries: %v", err)
	}
	if ledgerRows != 0 {
		t.Fatalf("suspended account: expected zero ledger entries for the refused payout, got %d", ledgerRows)
	}

	// (b) Reinstate the account, retry the SAME transition: it must now
	// succeed and post a real credit — proving the reward wasn't stranded by
	// the earlier refusal.
	mustExec(t, pool, `UPDATE platform_users SET status='active' WHERE id=$1`, suspended)
	if err := svc.Transition(ctx, rewardID, StatePaid, "payout-reinstated-"+rewardID); err != nil {
		t.Fatalf("reinstated account: expected payout to succeed, got %v", err)
	}
	if err := pool.QueryRow(ctx, `SELECT state FROM referral_reward_ledger WHERE id=$1`, rewardID).Scan(&state); err != nil {
		t.Fatalf("reload reward after reinstated payout: %v", err)
	}
	if state != StatePaid {
		t.Fatalf("reinstated account: expected state=paid, got %q", state)
	}

	// (c) Legitimate path unaffected: an active referrer's payout still works
	// on the first attempt.
	active := seedVerifiedUser(t, pool, 1, "verified")
	rewardID2 := seedEligibleRewardReturningID(t, pool, active, 12_000)
	if err := svc.Transition(ctx, rewardID2, StatePaid, "payout-active-"+rewardID2); err != nil {
		t.Fatalf("active account: expected payout to succeed, got %v", err)
	}
}

// seedEligibleRewardReturningID is seedEligibleReward's twin, returning the
// new reward's id so a test can drive it through Transition directly.
func seedEligibleRewardReturningID(t *testing.T, pool *pgxpool.Pool, beneficiary string, kobo int64) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO referral_reward_ledger
		  (beneficiary_id, kind, state, amount_kobo, currency, is_house, idempotency_key)
		VALUES ($1,'referrer','eligible',$2,'NGN',false,$3)
		RETURNING id`,
		beneficiary, kobo, "seed-"+uuid.NewString()).Scan(&id); err != nil {
		t.Fatalf("seed eligible reward: %v", err)
	}
	return id
}
