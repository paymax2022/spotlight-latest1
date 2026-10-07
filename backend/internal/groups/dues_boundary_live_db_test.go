package groups

// LIVE-DB regression tests for the ledger-audit CONDITIONAL findings on
// PR #525 affecting the dues rail:
//
//  525-D1 — the PR namespaced the dues journal key ("groups:dues:K") while on
//           main the SAME debit posted under the RAW caller key K (entries
//           K:debit on the member wallet / K:credit on the group wallet). A
//           crash post-legs / pre-row on the old build leaves raw-key legs +
//           no group_payments row; a post-deploy retry used to post a SECOND
//           debit. The legacy key must be probed and converged.
//  525-D6 — PayDues emitted NO audit event at all; a recording auditor proves
//           the dues money path now logs (iron rule).
//  525-D7 — the member-scoped replay check swallowed lookup errors and never
//           compared material params; a same-key/different-plan replay must
//           fail closed with ErrIdempotencyKeyConflict.
// ⚠️ GATED ON TEST_DATABASE_URL — these move money. Run:
//	TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres' \
//	  go test ./internal/groups/ -run 'TestLiveDB_' -v

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
)

// duesRecordingAuditor captures emitted audit actions (D6).
type duesRecordingAuditor struct{ actions []string }

func (r *duesRecordingAuditor) LogAction(_, _, action, _, _, _ string, _, _ map[string]any, _, _, _ string) {
	r.actions = append(r.actions, action)
}

func fundDuesMember(t *testing.T, ctx context.Context, led *ledger.Service, userID string, kobo int64) {
	t.Helper()
	revAcc, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		t.Fatalf("standing acct: %v", err)
	}
	if err := led.Credit(ctx, userID, "seed-fund", "duesfund-"+uuid.NewString(), revAcc.ID, kobo); err != nil {
		t.Fatalf("fund member: %v", err)
	}
}

// D1: legs posted under the RAW caller key by the old build (K:debit on the
// member wallet, K:credit on the group wallet) with no group_payments row
// must converge — record the row, no second debit.
func TestLiveDB_PayDues_LegacyKeyResidue_Converges(t *testing.T) {
	pool := duesPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), nil)
	svc := NewService(pool, led).WithTiers(tiers.NewService(pool))

	creator := uuid.New().String()
	groupID, planID := setupDuesGroup(t, ctx, pool, svc, creator)

	member := uuid.New().String()
	addGroupMember(t, ctx, pool, groupID, member)
	seedGroupKYCTier(t, ctx, pool, member, 3)
	fundDuesMember(t, ctx, led, member, 1_000_000)

	var groupWalletID string
	if err := pool.QueryRow(ctx,
		`SELECT id FROM ledger_accounts WHERE group_id=$1 AND type='group_wallet'`, groupID).Scan(&groupWalletID); err != nil {
		t.Fatalf("group wallet: %v", err)
	}

	key := "dues-legacy-" + uuid.New().String()
	// OLD-convention legs: journal key = the raw caller key.
	if err := led.Debit(ctx, member, "dues:"+groupID+":"+planID, key, groupWalletID, 200_000); err != nil {
		t.Fatalf("seed legacy debit: %v", err)
	}

	payment, err := svc.PayDues(ctx, groupID, member, PayDuesRequest{PlanID: planID, IdempotencyKey: key})
	if err != nil {
		t.Fatalf("dues over legacy residue err = %v, want nil (converge, not double-debit)", err)
	}
	if payment.Status != "paid" {
		t.Fatalf("status = %q, want paid", payment.Status)
	}
	if bal, _ := led.GetBalance(ctx, member); bal != 800_000 {
		t.Fatalf("member balance = %d, want 800000 — the legacy debit must be reused, not posted twice", bal)
	}
	var rows int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM group_payments WHERE idempotency_key=$1`, key).Scan(&rows); err != nil {
		t.Fatalf("count payments: %v", err)
	}
	if rows != 1 {
		t.Fatalf("group_payments rows = %d, want 1 (converge writes the missing row)", rows)
	}
}

// D7: the same member replaying the same key against a DIFFERENT plan (or a
// mismatched amount) must fail closed — the recorded payment must not echo
// back for a divergent request.
func TestLiveDB_PayDues_ReplayDivergentPlan_Conflict(t *testing.T) {
	pool := duesPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), nil)
	svc := NewService(pool, led).WithTiers(tiers.NewService(pool))

	creator := uuid.New().String()
	groupID, planID := setupDuesGroup(t, ctx, pool, svc, creator)

	// A second plan on the same group — same amount, different plan_id.
	plan2 := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO subscription_plans (id, group_id, name, amount_kobo, frequency, due_day) VALUES ($1,$2,'Annual Dues',200000,'annually',1)`,
		plan2, groupID); err != nil {
		t.Fatalf("seed plan2: %v", err)
	}

	member := uuid.New().String()
	addGroupMember(t, ctx, pool, groupID, member)
	seedGroupKYCTier(t, ctx, pool, member, 3)
	fundDuesMember(t, ctx, led, member, 1_000_000)

	key := "dues-diverge-" + uuid.New().String()
	if _, err := svc.PayDues(ctx, groupID, member, PayDuesRequest{PlanID: planID, IdempotencyKey: key}); err != nil {
		t.Fatalf("first dues: %v", err)
	}
	if _, err := svc.PayDues(ctx, groupID, member, PayDuesRequest{PlanID: plan2, IdempotencyKey: key}); !errors.Is(err, ErrIdempotencyKeyConflict) {
		t.Fatalf("divergent-plan replay err = %v, want ErrIdempotencyKeyConflict", err)
	}
	if bal, _ := led.GetBalance(ctx, member); bal != 800_000 {
		t.Fatalf("member balance = %d, want 800000 — a refused replay must never debit", bal)
	}
	var rows int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM group_payments WHERE member_id=$1`, member).Scan(&rows); err != nil {
		t.Fatalf("count payments: %v", err)
	}
	if rows != 1 {
		t.Fatalf("group_payments rows = %d, want 1", rows)
	}
}

// D6: the dues money mutation must emit an audit event — PayDues had no
// auditor wired at all.
func TestLiveDB_PayDues_EmitsAuditEvent(t *testing.T) {
	pool := duesPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), nil)
	rec := &duesRecordingAuditor{}
	svc := NewService(pool, led).WithTiers(tiers.NewService(pool)).WithAuditor(rec)

	creator := uuid.New().String()
	groupID, planID := setupDuesGroup(t, ctx, pool, svc, creator)

	member := uuid.New().String()
	addGroupMember(t, ctx, pool, groupID, member)
	seedGroupKYCTier(t, ctx, pool, member, 3)
	fundDuesMember(t, ctx, led, member, 1_000_000)

	if _, err := svc.PayDues(ctx, groupID, member, PayDuesRequest{PlanID: planID, IdempotencyKey: "dues-audit-" + uuid.New().String()}); err != nil {
		t.Fatalf("dues: %v", err)
	}
	var seen bool
	for _, a := range rec.actions {
		if a == "groups.dues.pay" {
			seen = true
		}
	}
	if !seen {
		t.Fatalf("PayDues emitted no audit — want groups.dues.pay in %v (iron rule: every money mutation audits)", rec.actions)
	}
}
