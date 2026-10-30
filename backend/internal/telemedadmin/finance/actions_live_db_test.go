package finance

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Live-DB check of actions.go. The hold migration is applied inside the test
// transaction (it is idempotent) and everything is rolled back afterwards.
func TestLiveDB_FinanceActions(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping telemedicine admin finance actions live-DB test")
	}
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer conn.Close(ctx)
	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	mig, err := os.ReadFile("../../../../supabase/migrations/20271400000210_telemed_admin_payout_hold.sql")
	must(t, err)
	_, err = tx.Exec(ctx, string(mig))
	must(t, err)

	var docUser, admin string
	if err := tx.QueryRow(ctx, `SELECT id::text FROM auth.users
		WHERE id NOT IN (SELECT user_id FROM doctors) ORDER BY created_at LIMIT 1`).Scan(&docUser); err != nil {
		t.Skip("need an auth.users row to build fixtures")
	}
	admin = uuid.NewString()
	_, err = tx.Exec(ctx, `INSERT INTO doctors (user_id, name, specialty, consult_fee_kobo) VALUES ($1, 'Fixture Doc', 'general', 500000)`, docUser)
	must(t, err)
	var payoutID, disputeID string
	must(t, tx.QueryRow(ctx, `INSERT INTO doctor_payouts (user_id, amount_kobo, status, idempotency_key)
		VALUES ($1, 25000, 'pending', $2) RETURNING id::text`, docUser, uuid.NewString()).Scan(&payoutID))
	must(t, tx.QueryRow(ctx, `INSERT INTO doctor_settlement_disputes (user_id, payout_id, reason)
		VALUES ($1, $2, 'short paid') RETURNING id::text`, docUser, payoutID).Scan(&disputeID))

	s := actionStore{db: tx}

	// Hold, then a second hold (new key) conflicts, then replay of the first key succeeds.
	h1, err := s.holdPayout(ctx, "hold-key-0001", admin, payoutID, "bank mismatch")
	must(t, err)
	if _, err := s.holdPayout(ctx, "hold-key-0002", admin, payoutID, "again"); !errors.Is(err, errConflict) {
		t.Fatalf("second hold err = %v, want conflict", err)
	}
	r1, err := s.holdPayout(ctx, "hold-key-0001", admin, payoutID, "bank mismatch")
	must(t, err)
	if !r1.Replayed || r1.AuditID != h1.AuditID {
		t.Errorf("replay = %+v, want same audit %s", r1, h1.AuditID)
	}
	if _, err := s.approvePayout(ctx, "hold-key-0001", admin, payoutID, ""); !errors.Is(err, errKeyReuse) {
		t.Errorf("key reuse across actions err = %v", err)
	}

	// Approve clears the hold and moves pending → processing exactly once.
	a, err := s.approvePayout(ctx, "approve-key-01", admin, payoutID, "ok")
	must(t, err)
	if a.Status != "processing" {
		t.Errorf("approve status = %s", a.Status)
	}
	var status string
	var held bool
	must(t, tx.QueryRow(ctx, `SELECT status, held_at IS NOT NULL FROM doctor_payouts WHERE id = $1`, payoutID).Scan(&status, &held))
	if status != "processing" || held {
		t.Errorf("payout after approve = %s held=%v", status, held)
	}
	if _, err := s.approvePayout(ctx, "approve-key-02", admin, payoutID, ""); !errors.Is(err, errConflict) {
		t.Errorf("double approve err = %v, want conflict", err)
	}

	// Dispute resolve.
	d, err := s.resolveDispute(ctx, "resolve-key-1", admin, disputeID, "rejected", "paid in full")
	must(t, err)
	var dstatus, outcome string
	must(t, tx.QueryRow(ctx, `SELECT status, detail->'resolution'->>'outcome' FROM doctor_settlement_disputes WHERE id = $1`, disputeID).Scan(&dstatus, &outcome))
	if d.Status != "rejected" || dstatus != "rejected" || outcome != "rejected" {
		t.Errorf("dispute = %s / %s / %s", d.Status, dstatus, outcome)
	}

	// Commission upsert twice (insert then update), and an unknown doctor 404s.
	_, err = s.updateCommission(ctx, "comm-key-0001", admin, docUser, CommissionUpdate{CommissionBps: 1200, VATBps: 750, PayoutCycle: "weekly"})
	must(t, err)
	_, err = s.updateCommission(ctx, "comm-key-0002", admin, docUser, CommissionUpdate{CommissionBps: 1000, VATBps: 750, PayoutCycle: "monthly"})
	must(t, err)
	var bps int
	var cycle string
	must(t, tx.QueryRow(ctx, `SELECT commission_bps, payout_cycle FROM doctor_commission_config WHERE user_id = $1`, docUser).Scan(&bps, &cycle))
	if bps != 1000 || cycle != "monthly" {
		t.Errorf("commission = %d %s", bps, cycle)
	}
	if _, err := s.updateCommission(ctx, "comm-key-0003", admin, uuid.NewString(), CommissionUpdate{PayoutCycle: "weekly"}); !errors.Is(err, errNotFound) {
		t.Errorf("unknown doctor err = %v", err)
	}

	// Every successful decision left exactly one audit row.
	var n int
	must(t, tx.QueryRow(ctx, `SELECT COUNT(*) FROM doctor_compliance_audit WHERE action LIKE 'admin.finance.%' AND user_id = $1`, docUser).Scan(&n))
	if n != 5 {
		t.Errorf("audit rows = %d, want 5 (hold, approve, resolve, 2 commission)", n)
	}
}
