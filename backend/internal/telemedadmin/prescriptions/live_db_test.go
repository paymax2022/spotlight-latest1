package prescriptions

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Live-DB test. It runs entirely inside one transaction that is rolled back, by
// passing the pgx.Tx (which satisfies DB, with Begin = savepoint) to the service.
func TestLiveDB_PrescriptionOversight(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set - skipping live-DB test")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer pool.Close()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var doctorUser, admin string
	if err := tx.QueryRow(ctx, `SELECT id::text FROM auth.users ORDER BY created_at LIMIT 1`).Scan(&doctorUser); err != nil {
		t.Skipf("no auth.users row to attach fixtures to: %v", err)
	}
	if err := tx.QueryRow(ctx, `SELECT id::text FROM auth.users ORDER BY created_at DESC LIMIT 1`).Scan(&admin); err != nil {
		t.Fatalf("admin user: %v", err)
	}
	const rx = "22222222-2222-2222-2222-222222222222"
	const ful = "33333333-3333-3333-3333-333333333333"
	const doc = "11111111-1111-1111-1111-111111111111"
	mustExec := func(sql string, args ...any) {
		t.Helper()
		if _, err := tx.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("fixture: %v\n%s", err, sql)
		}
	}
	mustExec(`INSERT INTO doctors (id, user_id, name, specialty, consult_fee_kobo) VALUES ($1, $2, 'Dr Fixture', 'general', 500000)`, doc, doctorUser)
	mustExec(`INSERT INTO doctor_prescriptions (id, user_id, ref, patient_id, patient, diagnosis, status, issued_at)
	          VALUES ($1, $2, 'RX-FIX', 'pat-123456789', '{"name":"Aisha Mohammed"}', 'Malaria', 'issued', now())`, rx, doctorUser)
	mustExec(`INSERT INTO doctor_prescription_items (prescription_id, user_id, name, dosage) VALUES ($1, $2, 'Artemether', '80mg')`, rx, doctorUser)
	mustExec(`INSERT INTO doctor_prescription_audit (prescription_id, user_id, action, new_status) VALUES ($1, $2, 'issued', 'issued')`, rx, doctorUser)
	mustExec(`INSERT INTO doctor_pharmacy_fulfilments (id, user_id, prescription_id, pharmacy, status, total_kobo) VALUES ($1, $2, $3, '{"name":"MedPlus"}', 'pending', 150000)`, ful, doctorUser, rx)
	mustExec(`INSERT INTO doctor_pharmacy_substitutes (fulfilment_id, user_id, original_drug, substitute_drug, status, price_kobo) VALUES ($1, $2, 'A', 'B', 'proposed', 90000)`, ful, doctorUser)
	mustExec(`INSERT INTO doctor_drug_deliveries (fulfilment_id, user_id, status, courier) VALUES ($1, $2, 'pending', 'GIG')`, ful, doctorUser)
	mustExec(`INSERT INTO doctor_refill_requests (user_id, prescription_id, patient, status) VALUES ($1, $2, '{"name":"Aisha Mohammed"}', 'pending')`, doctorUser, rx)

	svc := NewService(tx)

	sum, err := svc.Summary(ctx)
	if err != nil {
		t.Fatalf("summary: %v", err)
	}
	if sum.Issued30d < 1 || sum.PendingFulfilment < 1 || sum.RefillsPending < 1 || sum.SubstitutionsPending < 1 {
		t.Errorf("summary missed fixtures: %+v", sum)
	}

	rows, total, err := svc.List(ctx, ListQuery{Q: "malaria", DoctorID: doc})
	if err != nil || total != 1 || len(rows) != 1 {
		t.Fatalf("list: rows=%d total=%d err=%v", len(rows), total, err)
	}
	if rows[0].PatientMasked != "Aisha M•••" || rows[0].Flagged || rows[0].ItemCount != 1 {
		t.Errorf("row: %+v", rows[0])
	}

	// flag -> list(flagged) -> idempotent repeat -> unflag
	if _, err := svc.SetFlag(ctx, admin, rx, true, "check dosage"); err != nil {
		t.Fatalf("flag: %v", err)
	}
	if _, err := svc.SetFlag(ctx, admin, rx, true, "check dosage"); err != nil {
		t.Fatalf("flag repeat: %v", err)
	}
	yes := true
	rows, _, err = svc.List(ctx, ListQuery{Flagged: &yes, DoctorID: doc})
	if err != nil || len(rows) != 1 || !rows[0].Flagged {
		t.Fatalf("flagged list: %+v err=%v", rows, err)
	}
	var n int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM doctor_prescription_audit WHERE prescription_id=$1 AND action='admin_flagged'`, rx).Scan(&n); err != nil || n != 1 {
		t.Errorf("repeat flag must not add a second audit row: n=%d err=%v", n, err)
	}

	d, err := svc.Get(ctx, admin, rx)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if d.PatientID != "pat-123456789" || len(d.Items) != 1 || len(d.Fulfilments) != 1 || len(d.Refills) != 1 {
		t.Errorf("detail: %+v", d)
	}
	if len(d.Fulfilments[0].Deliveries) != 1 || len(d.Fulfilments[0].Substitutes) != 1 {
		t.Errorf("fulfilment children: %+v", d.Fulfilments[0])
	}
	var actors []string
	for _, a := range d.Audit {
		actors = append(actors, a.Actor+":"+a.Action)
	}
	if len(d.Audit) != 2 || d.Audit[1].Actor != "admin" || d.Audit[1].Action != actionFlag {
		t.Errorf("audit trail: %v", actors)
	}
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM doctor_record_access_log WHERE user_id=$1 AND patient_id='pat-123456789' AND action='view'`, admin).Scan(&n); err != nil || n < 1 {
		t.Errorf("detail must write an access-log row: n=%d err=%v", n, err)
	}

	if _, err := svc.SetFlag(ctx, admin, rx, false, "resolved"); err != nil {
		t.Fatalf("unflag: %v", err)
	}
	d, _ = svc.Get(ctx, admin, rx)
	if d.Flagged {
		t.Error("prescription should be unflagged")
	}

	if _, err := svc.Get(ctx, admin, "99999999-9999-9999-9999-999999999999"); !errors.Is(err, ErrNotFound) {
		t.Errorf("unknown id: %v", err)
	}
	if _, err := svc.SetFlag(ctx, admin, "99999999-9999-9999-9999-999999999999", true, "reason"); !errors.Is(err, ErrNotFound) {
		t.Errorf("flag unknown id: %v", err)
	}

	frows, ftotal, err := svc.ListFulfilments(ctx, PageQuery{Status: "pending"})
	if err != nil || ftotal < 1 || len(frows) < 1 {
		t.Errorf("fulfilments: %v %d", err, ftotal)
	}
	rrows, rtotal, err := svc.ListRefills(ctx, PageQuery{Status: "pending"})
	if err != nil || rtotal < 1 || len(rrows) < 1 || rrows[0].PatientMasked == "" {
		t.Errorf("refills: %v %d", err, rtotal)
	}
}
