package adminext_test

// LIVE-DB regression for the F-1 re-audit finding: an ErrDuplicate from
// DebitGated used to be trusted as "the payout journal committed" and the
// withdrawal flipped COMPLETED with zero durable legs behind it. Key
// EXISTENCE is never proof — the duplicate could be a bare Redis-lock claim
// (no legs) or a foreign journal under the same key. ApproveWithdrawal now
// re-probes the ledger of record (Posted + per-leg EntryByKey identity)
// before the COMPLETED flip is allowed:
//   - partial/phantom claim (lone leg, no balanced pair) → retryable
//     ErrWithdrawalPayoutPending, row stays PENDING;
//   - foreign journal under the payout key → ErrDuplicate-wrapped conflict,
//     row stays PENDING;
//   - a genuine same-journal replay converges and completes normally.
// SKIPPED whenever TEST_DATABASE_URL is unset.

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/crowdfunding/adminext"
	financeledger "spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/testsupport"
)

func withdrawPool(t *testing.T) *pgxpool.Pool {
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

// withdrawRig seeds a creator, a non-frozen campaign and a PENDING withdrawal,
// returning the service + ids. Cleanup removes the module rows before the user.
func withdrawRig(t *testing.T, amount int64) (context.Context, *pgxpool.Pool, *adminext.Service, *financeledger.Service, string, string) {
	t.Helper()
	ctx := context.Background()
	pool := withdrawPool(t)
	ledgerSvc := financeledger.NewService(financeledger.NewRepository(pool), nil)
	svc := adminext.NewService(pool).WithLedger(ledgerSvc)

	creator := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		creator, creator+"@seed.test"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	testsupport.CleanupUser(t, pool, creator)
	// The gated payout runs the strict in-tx tier guard — promote the fixture
	// past tier 0 so the debit is permitted.
	testsupport.SetKycTier(t, ctx, pool, creator, testsupport.KycTierUnlimited)

	campaignID := uuid.NewString()
	withdrawalID := uuid.NewString()
	if _, err := pool.Exec(ctx,
		`INSERT INTO campaigns (id, creator_id, title, goal_kobo, deadline, review_status)
		 VALUES ($1,$2,'Payout test campaign',1000000, NOW()+INTERVAL '7 days','ACTIVE')`,
		campaignID, creator); err != nil {
		t.Fatalf("seed campaign: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO cf_withdrawals (id, campaign_id, creator_id, reference, amount_kobo, bank_label, status, idempotency_key)
		 VALUES ($1,$2,$3,$4,$5,'Test Bank','PENDING',$6)`,
		withdrawalID, campaignID, creator, "wd-"+withdrawalID[:8], amount, "idem-"+withdrawalID[:8]); err != nil {
		t.Fatalf("seed withdrawal: %v", err)
	}
	t.Cleanup(func() {
		c := context.WithoutCancel(ctx)
		_, _ = pool.Exec(c, `DELETE FROM cf_withdrawals WHERE id=$1`, withdrawalID)
		_, _ = pool.Exec(c, `DELETE FROM campaigns WHERE id=$1`, campaignID)
	})
	return ctx, pool, svc, ledgerSvc, creator, withdrawalID
}

func withdrawalStatus(t *testing.T, pool *pgxpool.Pool, withdrawalID string) string {
	t.Helper()
	var st string
	if err := pool.QueryRow(context.Background(),
		`SELECT status FROM cf_withdrawals WHERE id=$1`, withdrawalID).Scan(&st); err != nil {
		t.Fatalf("read withdrawal status: %v", err)
	}
	return st
}

// A partial claim on the payout key — a lone ":debit" leg with no balanced
// pair — produces ErrDuplicate out of DebitGated (key held, journal
// mismatched) while Posted() reports nothing durable. The approval must
// refuse with the RETRYABLE pending error and leave the row PENDING, never
// COMPLETED on a phantom journal.
func TestLiveDB_Withdrawal_PhantomDuplicate_StaysPending(t *testing.T) {
	ctx, pool, svc, ledgerSvc, _, withdrawalID := withdrawRig(t, 500_000)

	payoutIdem := "cf:withdraw:payout:" + withdrawalID
	escrowAcc, err := ledgerSvc.GetOrCreateStandingAccount(ctx, financeledger.AccountEscrow)
	if err != nil {
		t.Fatalf("standing acct: %v", err)
	}
	// Plant ONLY the debit leg — a partial claim the ledger's own journal txes
	// can never produce, standing in for a bare duplicate with no durable pair.
	if _, err := pool.Exec(ctx,
		`INSERT INTO ledger_entries (account_id, type, amount_kobo, reference, idempotency_key)
		 VALUES ($1,'DEBIT',1,'foreign:partial',$2)`,
		escrowAcc.ID, payoutIdem+":debit"); err != nil {
		t.Fatalf("plant partial leg: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(ctx),
			`DELETE FROM ledger_entries WHERE idempotency_key=$1`, payoutIdem+":debit")
	})

	_, err = svc.ApproveWithdrawal(ctx, withdrawalID, "admin-1", "approve-"+withdrawalID[:8])
	if !errors.Is(err, adminext.ErrWithdrawalPayoutPending) {
		t.Fatalf("phantom duplicate must return ErrWithdrawalPayoutPending, got %v", err)
	}
	if st := withdrawalStatus(t, pool, withdrawalID); st != "PENDING" {
		t.Fatalf("withdrawal must stay PENDING on a phantom duplicate, got %s", st)
	}
}

// A FOREIGN balanced journal holding the payout key (different accounts,
// amount and reference) must fail CLOSED — an ErrDuplicate-wrapped conflict,
// not the retryable pending error, and never COMPLETED.
func TestLiveDB_Withdrawal_ForeignJournal_Refuses(t *testing.T) {
	ctx, pool, svc, ledgerSvc, _, withdrawalID := withdrawRig(t, 500_000)

	payoutIdem := "cf:withdraw:payout:" + withdrawalID
	escrowAcc, err := ledgerSvc.GetOrCreateStandingAccount(ctx, financeledger.AccountEscrow)
	if err != nil {
		t.Fatalf("standing acct: %v", err)
	}
	revAcc, err := ledgerSvc.GetOrCreateStandingAccount(ctx, financeledger.AccountPaymaxRevenue)
	if err != nil {
		t.Fatalf("standing acct: %v", err)
	}
	// Balanced pair under the SAME base key but a different identity entirely.
	if err := ledgerSvc.PostJournal(ctx, financeledger.JournalEntry{
		Reference:       "foreign:journal",
		IdempotencyKey:  payoutIdem,
		AmountKobo:      777,
		DebitAccountID:  escrowAcc.ID,
		CreditAccountID: revAcc.ID,
	}); err != nil {
		t.Fatalf("post foreign journal: %v", err)
	}
	t.Cleanup(func() {
		c := context.WithoutCancel(ctx)
		_, _ = pool.Exec(c, `DELETE FROM ledger_entries WHERE idempotency_key IN ($1,$2)`,
			payoutIdem+":debit", payoutIdem+":credit")
	})

	_, err = svc.ApproveWithdrawal(ctx, withdrawalID, "admin-1", "approve-"+withdrawalID[:8])
	if err == nil {
		t.Fatal("a foreign journal under the payout key must fail closed")
	}
	if errors.Is(err, adminext.ErrWithdrawalPayoutPending) {
		t.Fatal("a foreign claim is a permanent conflict, not retryable pending")
	}
	if !errors.Is(err, financeledger.ErrDuplicate) {
		t.Fatalf("want ErrDuplicate-wrapped conflict, got %v", err)
	}
	if st := withdrawalStatus(t, pool, withdrawalID); st != "PENDING" {
		t.Fatalf("withdrawal must stay PENDING on a foreign claim, got %s", st)
	}
}

// The healthy replay: the SAME journal already durable (posted by an earlier
// attempt) → DebitGated's in-tx replay check matches and returns nil, the
// approval converges and completes — Posted=false (this call moved nothing).
func TestLiveDB_Withdrawal_DurableReplay_Completes(t *testing.T) {
	ctx, pool, svc, ledgerSvc, creator, withdrawalID := withdrawRig(t, 500_000)

	rev, err := ledgerSvc.GetOrCreateStandingAccount(ctx, financeledger.AccountPaymaxRevenue)
	if err != nil {
		t.Fatalf("standing acct: %v", err)
	}
	if err := ledgerSvc.Credit(ctx, creator, "seed-fund", "wd-fund-"+withdrawalID[:8], rev.ID, 2_000_000); err != nil {
		t.Fatalf("fund creator: %v", err)
	}

	res, err := svc.ApproveWithdrawal(ctx, withdrawalID, "admin-1", "approve-"+withdrawalID[:8])
	if err != nil {
		t.Fatalf("first approval: %v", err)
	}
	if res.Status != "COMPLETED" || !res.Posted {
		t.Fatalf("first approval must post and complete, got %+v", res)
	}
	// Retry — durable journal + COMPLETED row converge to an idempotent no-op.
	res2, err := svc.ApproveWithdrawal(ctx, withdrawalID, "admin-1", "approve-"+withdrawalID[:8])
	if err != nil {
		t.Fatalf("replay approval: %v", err)
	}
	if res2.Status != "COMPLETED" || res2.Posted {
		t.Fatalf("replay must converge without reposting, got %+v", res2)
	}
	if st := withdrawalStatus(t, pool, withdrawalID); st != "COMPLETED" {
		t.Fatalf("withdrawal must be COMPLETED, got %s", st)
	}
}
