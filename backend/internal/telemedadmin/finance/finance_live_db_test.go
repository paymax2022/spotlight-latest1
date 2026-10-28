package finance

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Live-DB check of every query in store.go. All fixtures are inserted inside one
// transaction that is ALWAYS rolled back, so the database is left untouched.
// Skipped unless TEST_DATABASE_URL is set.
func TestLiveDB_FinanceQueries(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping telemedicine admin finance live-DB test")
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

	// Two real auth users that are not already doctors: one doctor, one patient.
	var docUser, patient string
	rows, err := tx.Query(ctx, `SELECT id::text FROM auth.users
		WHERE id NOT IN (SELECT user_id FROM doctors) ORDER BY created_at LIMIT 2`)
	if err != nil {
		t.Fatalf("pick users: %v", err)
	}
	var ids []string
	for rows.Next() {
		var id string
		_ = rows.Scan(&id)
		ids = append(ids, id)
	}
	rows.Close()
	if len(ids) < 2 {
		t.Skip("need two auth.users rows to build fixtures")
	}
	docUser, patient = ids[0], ids[1]

	var doctorID string
	must(t, tx.QueryRow(ctx, `INSERT INTO doctors (user_id, name, specialty, consult_fee_kobo)
		VALUES ($1, 'Fixture Doc', 'general', 500000) RETURNING id::text`, docUser).Scan(&doctorID))

	// Three completed consults (fees chosen so floor(fee*15/100) is not exact),
	// one booked and one cancelled that must NOT count.
	for i, fee := range []int64{500001, 12345, 99} {
		_, err := tx.Exec(ctx, `INSERT INTO appointments (patient_id, doctor_id, scheduled_at, status, fee_kobo, idempotency_key, platform_fee_kobo)
			VALUES ($1, $2, now(), 'completed', $3, $4, $5)`, patient, doctorID, fee, uuid.NewString(), int64(i)*100)
		must(t, err)
	}
	for _, st := range []string{"booked", "cancelled"} {
		_, err := tx.Exec(ctx, `INSERT INTO appointments (patient_id, doctor_id, scheduled_at, status, fee_kobo, idempotency_key)
			VALUES ($1, $2, now(), $3, 777777, $4)`, patient, doctorID, st, uuid.NewString())
		must(t, err)
	}

	var bankID string
	must(t, tx.QueryRow(ctx, `INSERT INTO doctor_bank_accounts (user_id, bank_name, account_number, account_name, is_verified, tax_info)
		VALUES ($1, 'Fixture Bank', '0123456789', 'Fixture Doc', true, '{"tin":"SECRET-TIN"}') RETURNING id::text`, docUser).Scan(&bankID))

	var paidID, pendingID string
	must(t, tx.QueryRow(ctx, `INSERT INTO doctor_payouts (user_id, amount_kobo, status, bank_account_id, consult_count, idempotency_key, paid_at)
		VALUES ($1, 100000, 'paid', $2, 2, $3, now()) RETURNING id::text`, docUser, bankID, uuid.NewString()).Scan(&paidID))
	must(t, tx.QueryRow(ctx, `INSERT INTO doctor_payouts (user_id, amount_kobo, status, bank_account_id, idempotency_key)
		VALUES ($1, 25000, 'pending', $2, $3) RETURNING id::text`, docUser, bankID, uuid.NewString()).Scan(&pendingID))
	_, err = tx.Exec(ctx, `INSERT INTO doctor_payouts (user_id, amount_kobo, status, idempotency_key)
		VALUES ($1, 9999, 'failed', $2)`, docUser, uuid.NewString())
	must(t, err)

	var disputeID string
	must(t, tx.QueryRow(ctx, `INSERT INTO doctor_settlement_disputes (user_id, payout_id, status, reason, detail, idempotency_key)
		VALUES ($1, $2, 'open', 'short paid', '{"expected_kobo":30000}', $3) RETURNING id::text`, docUser, pendingID, uuid.NewString()).Scan(&disputeID))
	_, err = tx.Exec(ctx, `INSERT INTO doctor_commission_config (user_id, commission_bps, vat_bps, payout_cycle)
		VALUES ($1, 1200, 750, 'weekly')`, docUser)
	must(t, err)
	_, err = tx.Exec(ctx, `INSERT INTO doctor_invoices (user_id, gross_kobo, commission_kobo, vat_kobo, net_kobo, status)
		VALUES ($1, 10000, 1500, 100, 8400, 'issued')`, docUser)
	must(t, err)

	s := store{db: tx}
	all := window{}
	pg := page{Limit: 50}

	// --- earnings: per-doctor integer math over COMPLETED consults only ---
	er, err := s.earnings(ctx, &docUser, all, pg)
	must(t, err)
	if er.Total != 1 || len(er.Items) != 1 {
		t.Fatalf("earnings rows = %d (total %d), want 1", len(er.Items), er.Total)
	}
	e := er.Items[0]
	wantGross := int64(500001 + 12345 + 99)
	wantComm := commissionKobo(500001) + commissionKobo(12345) + commissionKobo(99)
	if e.CompletedConsultations != 3 || e.GrossKobo != wantGross || e.CommissionKobo != wantComm {
		t.Errorf("earnings = %+v, want 3 consults, gross %d, commission %d", e, wantGross, wantComm)
	}
	if e.NetKobo != wantGross-wantComm || e.CommissionKobo+e.NetKobo != e.GrossKobo {
		t.Errorf("net %d does not conserve gross %d / commission %d", e.NetKobo, e.GrossKobo, e.CommissionKobo)
	}
	if e.PlatformBookingFeesKobo != 0+100+200 {
		t.Errorf("platform booking fees = %d, want 300", e.PlatformBookingFeesKobo)
	}
	if e.PaidOutKobo != 100000 || e.InFlightKobo != 25000 {
		t.Errorf("paid/in-flight = %d/%d, want 100000/25000 (failed must be excluded)", e.PaidOutKobo, e.InFlightKobo)
	}

	// --- summary ---
	sum, err := s.summary(ctx, all)
	must(t, err)
	if sum.CompletedConsultations < 3 || sum.GrossConsultFeesKobo < wantGross {
		t.Errorf("summary missing fixture consults: %+v", sum)
	}
	if sum.DoctorNetKobo != sum.GrossConsultFeesKobo-sum.PlatformCommissionKobo {
		t.Error("summary net != gross - commission")
	}
	if sum.OpenDisputes < 1 {
		t.Errorf("open disputes = %d, want >= 1", sum.OpenDisputes)
	}
	byStatus := map[string]PayoutStatusTotal{}
	for _, p := range sum.PayoutsByStatus {
		byStatus[p.Status] = p
	}
	if byStatus["paid"].AmountKobo < 100000 || byStatus["pending"].AmountKobo < 25000 || byStatus["failed"].Count < 1 {
		t.Errorf("payouts by status wrong: %+v", sum.PayoutsByStatus)
	}

	// --- payouts list: filters, masking, dispute count ---
	st := "pending"
	pl, err := s.payouts(ctx, &st, &docUser, all, pg)
	must(t, err)
	if pl.Total != 1 || len(pl.Items) != 1 {
		t.Fatalf("pending payouts = %d (total %d), want 1", len(pl.Items), pl.Total)
	}
	p := pl.Items[0]
	if p.ID != pendingID || p.DoctorName != "Fixture Doc" || p.OpenDisputes != 1 {
		t.Errorf("payout row = %+v", p)
	}
	if p.BankAccount.Last4 == nil || *p.BankAccount.Last4 != "6789" || !p.BankAccount.IsVerified {
		t.Errorf("bank mask = %+v, want last4 6789", p.BankAccount)
	}
	allPayouts, err := s.payouts(ctx, nil, &docUser, all, page{Limit: 1})
	must(t, err)
	if allPayouts.Total != 3 || len(allPayouts.Items) != 1 {
		t.Errorf("pagination: total %d items %d, want 3/1", allPayouts.Total, len(allPayouts.Items))
	}

	// --- payout detail ---
	pd, err := s.payout(ctx, pendingID)
	must(t, err)
	if len(pd.Disputes) != 1 || pd.Disputes[0].ID != disputeID {
		t.Errorf("payout detail disputes = %+v", pd.Disputes)
	}
	if _, err := s.payout(ctx, uuid.NewString()); err != errNotFound {
		t.Errorf("unknown payout err = %v, want errNotFound", err)
	}

	// --- disputes ---
	dl, err := s.disputes(ctx, ptr("open"), nil, pg)
	must(t, err)
	found := false
	for _, d := range dl.Items {
		found = found || d.ID == disputeID
	}
	if !found {
		t.Error("fixture dispute missing from open queue")
	}
	dd, err := s.dispute(ctx, disputeID)
	must(t, err)
	if dd.Payout == nil || dd.Payout.ID != pendingID || dd.Detail["expected_kobo"] == nil || dd.Reason == nil {
		t.Errorf("dispute detail = %+v", dd)
	}
	if _, err := s.dispute(ctx, uuid.NewString()); err != errNotFound {
		t.Errorf("unknown dispute err = %v", err)
	}

	// --- invoices & commission config ---
	inv, err := s.invoices(ctx, &docUser, nil, all, pg)
	must(t, err)
	if inv.Total != 1 || inv.Items[0].NetKobo != 8400 || inv.Items[0].DoctorName != "Fixture Doc" {
		t.Errorf("invoices = %+v", inv)
	}
	cc, err := s.commissionConfig(ctx)
	must(t, err)
	if cc.PlatformCommissionBps != 1500 || cc.DoctorShareBps != 8500 {
		t.Errorf("platform bps = %d/%d", cc.PlatformCommissionBps, cc.DoctorShareBps)
	}
	hit := false
	for _, o := range cc.Overrides {
		hit = hit || (o.DoctorUserID == docUser && o.CommissionBps == 1200 && o.PayoutCycle == "weekly")
	}
	if !hit {
		t.Error("fixture commission override missing")
	}

	// --- the response never carries the full account number or tax info ---
	if b := strings.ToLower(marshal(t, pl)); strings.Contains(b, "0123456789") || strings.Contains(b, "secret-tin") {
		t.Errorf("payout JSON leaks bank data: %s", b)
	}
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

func ptr(s string) *string { return &s }

func marshal(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}
