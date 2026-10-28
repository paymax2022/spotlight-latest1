package claims

// Live-DB tests for the claims/referrals admin store. Skipped unless
// TEST_DATABASE_URL is set. Every test runs inside one transaction that is rolled
// back, with the store pointed at the transaction (nested Begin = savepoint), so
// no fixture row survives and no shared data is touched.

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
)

const (
	fxUser    = "aaaaaaaa-0000-4000-8000-0000000000c1"
	fxAdmin   = "aaaaaaaa-0000-4000-8000-0000000000c2"
	fxClaim   = "bbbbbbbb-0000-4000-8000-0000000000c1"
	fxClaim2  = "bbbbbbbb-0000-4000-8000-0000000000c2"
	fxPre     = "cccccccc-0000-4000-8000-0000000000c1"
	fxWarn    = "dddddddd-0000-4000-8000-0000000000c1"
	fxRefOut  = "eeeeeeee-0000-4000-8000-0000000000c1"
	fxRefIn   = "eeeeeeee-0000-4000-8000-0000000000c2"
	fxOpinion = "eeeeeeee-0000-4000-8000-0000000000c3"
)

func liveStore(t *testing.T) (*store, context.Context) {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping claims admin live-DB tests")
	}
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(func() { _ = conn.Close(ctx) })
	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	t.Cleanup(func() { _ = tx.Rollback(ctx) })

	exec := func(sql string, args ...any) {
		if _, err := tx.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("fixture %q: %v", strings.Fields(sql)[0:3], err)
		}
	}
	exec(`INSERT INTO auth.users (id, email) VALUES ($1, 'claims-fx@example.test')`, fxUser)
	exec(`INSERT INTO doctors (id, user_id, name, specialty, consult_fee_kobo) VALUES (gen_random_uuid(), $1, 'Dr Fixture', 'general', 100)`, fxUser)
	exec(`INSERT INTO doctor_hmo_claims (id, user_id, ref, patient_id, status, amount_kobo, detail)
		VALUES ($1, $2, 'CLM-FX-1', 'patient-secret-1', 'submitted', 250000,
		        '{"reason":"visible","patient_name":"Secret Name","hmo":"Hygeia"}')`, fxClaim, fxUser)
	exec(`INSERT INTO doctor_hmo_claims (id, user_id, ref, patient_id, status, amount_kobo) VALUES ($1, $2, 'CLM-FX-2', 'p2', 'disputed', 1000)`, fxClaim2, fxUser)
	exec(`INSERT INTO doctor_hmo_preauth_requests (id, user_id, patient_id, status, auth_code, amount_kobo, detail)
		VALUES ($1, $2, 'patient-secret-1', 'approved', 'AUTH-SECRET', 5000, '{"service":"MRI","diagnosis":"hidden"}')`, fxPre, fxUser)
	exec(`INSERT INTO doctor_hmo_fraud_warnings (id, user_id, severity, detail)
		VALUES ($1, $2, 'high', '{"message":"Unusual claim volume","patient_name":"Secret Name"}')`, fxWarn, fxUser)
	exec(`INSERT INTO doctor_referrals (id, user_id, specialist_id, patient_id, direction, status, reason)
		VALUES ($1, $2, 'spec-1', 'patient-secret-1', 'outgoing', 'pending', 'Needs cardiology review')`, fxRefOut, fxUser)
	exec(`INSERT INTO doctor_incoming_referrals (id, user_id, referring_doctor, patient_id, status, reason)
		VALUES ($1, $2, 'Dr Sender', 'patient-secret-1', 'accepted', 'Follow-up')`, fxRefIn, fxUser)
	exec(`INSERT INTO doctor_opinion_requests (id, user_id, patient_id, status, question)
		VALUES ($1, $2, 'patient-secret-1', 'pending', 'Second look at the ECG?')`, fxOpinion, fxUser)
	return &store{db: tx}, ctx
}

func TestLiveClaimsListDetailAndMasking(t *testing.T) {
	st, ctx := liveStore(t)

	items, total, err := st.listClaims(ctx, ListQuery{Q: "CLM-FX", Limit: 10})
	if err != nil || total != 2 || len(items) != 2 {
		t.Fatalf("list by ref: err=%v total=%d len=%d", err, total, len(items))
	}
	if items[0].DoctorName != "Dr Fixture" {
		t.Errorf("doctor name = %q", items[0].DoctorName)
	}
	for _, it := range items {
		if strings.Contains(it.PatientMasked, "secret") || strings.Contains(it.PatientMasked, "patient-secret-1") {
			t.Errorf("patient leaked in list: %q", it.PatientMasked)
		}
	}
	if got, _, _ := st.listClaims(ctx, ListQuery{Status: "disputed", Q: "CLM-FX", Limit: 10}); len(got) != 1 || got[0].ID != fxClaim2 {
		t.Errorf("status filter wrong: %+v", got)
	}
	if got, _, _ := st.listClaims(ctx, ListQuery{Q: "Dr Fixt", Limit: 10}); len(got) < 2 {
		t.Errorf("doctor-name search found %d", len(got))
	}
	if got, total, _ := st.listClaims(ctx, ListQuery{Q: "100%_", Limit: 10}); len(got) != 0 || total != 0 {
		t.Errorf("LIKE metacharacters must match literally, got %d", len(got))
	}
	if got, _, _ := st.listClaims(ctx, ListQuery{Q: "CLM-FX", Limit: 1, Offset: 1}); len(got) != 1 {
		t.Errorf("pagination returned %d rows", len(got))
	}

	det, err := st.getClaim(ctx, fxClaim)
	if err != nil {
		t.Fatalf("getClaim: %v", err)
	}
	if det.Detail["reason"] != "visible" || det.Detail["hmo"] != "Hygeia" {
		t.Errorf("allow-listed detail missing: %v", det.Detail)
	}
	if _, leaked := det.Detail["patient_name"]; leaked {
		t.Errorf("patient_name leaked in detail")
	}
	if _, err := st.getClaim(ctx, "bbbbbbbb-0000-4000-8000-0000000000ff"); err != ErrNotFound {
		t.Errorf("unknown id = %v, want ErrNotFound", err)
	}
}

func TestLivePreAuthNeverExposesCode(t *testing.T) {
	st, ctx := liveStore(t)
	items, total, err := st.listPreAuth(ctx, ListQuery{Status: "approved", Q: "Fixture", Limit: 10})
	if err != nil || total != 1 || len(items) != 1 || !items[0].AuthCodePresent {
		t.Fatalf("list preauth: err=%v total=%d items=%+v", err, total, items)
	}
	d, err := st.getPreAuth(ctx, fxPre)
	if err != nil || d.Detail["service"] != "MRI" {
		t.Fatalf("getPreAuth: %v %+v", err, d)
	}
	if _, leaked := d.Detail["diagnosis"]; leaked {
		t.Errorf("diagnosis leaked")
	}
}

func TestLiveReviewClaimWritesAuditAndKeepsStatus(t *testing.T) {
	st, ctx := liveStore(t)

	if _, err := st.reviewClaim(ctx, fxAdmin, fxClaim, "no"); err == nil {
		t.Fatal("short note must be rejected")
	}
	out, err := st.reviewClaim(ctx, fxAdmin, fxClaim, "Checked against HMO remittance")
	if err != nil {
		t.Fatalf("reviewClaim: %v", err)
	}
	if out.Status != "submitted" {
		t.Errorf("status changed to %q — review must not transition status", out.Status)
	}
	rev, _ := out.Detail["admin_review"].(map[string]any)
	if rev["note"] != "Checked against HMO remittance" || rev["reviewer"] != fxAdmin {
		t.Errorf("admin_review not stamped: %v", out.Detail["admin_review"])
	}
	if len(out.Audit) != 1 || out.Audit[0].Action != actionClaimReview || out.Audit[0].ActorID != fxAdmin {
		t.Fatalf("audit trail wrong: %+v", out.Audit)
	}
	var n int
	if err := st.db.QueryRow(ctx, `SELECT count(*) FROM doctor_compliance_audit WHERE entity_id = $1 AND user_id = $2`, fxClaim, fxUser).Scan(&n); err != nil || n != 1 {
		t.Errorf("audit rows = %d (%v), want exactly 1 against the owning doctor", n, err)
	}
	if _, err := st.reviewClaim(ctx, fxAdmin, "bbbbbbbb-0000-4000-8000-0000000000ff", "valid note here"); err != ErrNotFound {
		t.Errorf("unknown claim = %v, want ErrNotFound", err)
	}
}

func TestLiveAcknowledgeWarningIsIdempotentAndAudited(t *testing.T) {
	st, ctx := liveStore(t)

	open := false
	list, total, err := st.listWarnings(ctx, &open, "high", 50, 0)
	if err != nil || total < 1 {
		t.Fatalf("open warnings: %v total=%d", err, total)
	}
	found := false
	for _, w := range list {
		if w.ID == fxWarn {
			found = true
			if w.Summary != "Unusual claim volume" {
				t.Errorf("summary = %q", w.Summary)
			}
		}
	}
	if !found {
		t.Fatal("fixture warning missing from open list")
	}

	w1, err := st.acknowledgeWarning(ctx, fxAdmin, fxWarn)
	if err != nil || !w1.Acknowledged || w1.AcknowledgedAt == nil {
		t.Fatalf("ack: %v %+v", err, w1)
	}
	w2, err := st.acknowledgeWarning(ctx, fxAdmin, fxWarn)
	if err != nil || !w2.AcknowledgedAt.Equal(*w1.AcknowledgedAt) {
		t.Fatalf("second ack changed state: %v", err)
	}
	var n int
	if err := st.db.QueryRow(ctx, `SELECT count(*) FROM doctor_compliance_audit WHERE entity_id = $1 AND action = $2`, fxWarn, actionWarningAck).Scan(&n); err != nil || n != 1 {
		t.Errorf("audit rows after two acks = %d (%v), want 1", n, err)
	}
	if _, err := st.acknowledgeWarning(ctx, "", fxWarn); err == nil {
		t.Error("ack without reviewer must fail closed")
	}
}

func TestLiveSummariesAndReferrals(t *testing.T) {
	st, ctx := liveStore(t)

	cs, err := st.claimsSummary(ctx)
	if err != nil || cs.ClaimsTotal < 2 || cs.ClaimsByStatus["disputed"] < 1 || cs.ClaimsAmountKobo < 251000 || cs.PreauthTotal < 1 || cs.FraudWarningsHighOpen < 1 {
		t.Fatalf("claims summary: %v %+v", err, cs)
	}
	rs, err := st.referralsSummary(ctx)
	if err != nil || rs.OutgoingTotal < 1 || rs.IncomingByStatus["accepted"] < 1 || rs.OpinionsTotal < 1 {
		t.Fatalf("referrals summary: %v %+v", err, rs)
	}

	for _, c := range []struct {
		sp   refSpec
		id   string
		want string
	}{
		{specOutgoing, fxRefOut, "spec-1"},
		{specIncoming, fxRefIn, "Dr Sender"},
		{specOpinion, fxOpinion, ""},
	} {
		items, _, err := st.listReferrals(ctx, c.sp, ListQuery{Q: "Fixture", Limit: 50})
		if err != nil {
			t.Fatalf("%s list: %v", c.sp.kind, err)
		}
		ok := false
		for _, it := range items {
			if it.ID == c.id {
				ok = true
				if it.Kind != c.sp.kind || it.Counterpart != c.want || it.DoctorName != "Dr Fixture" || strings.Contains(it.PatientMasked, "secret") {
					t.Errorf("%s row wrong: %+v", c.sp.kind, it)
				}
			}
		}
		if !ok {
			t.Errorf("%s fixture not listed", c.sp.kind)
		}
		d, err := st.getReferral(ctx, c.sp, c.id)
		if err != nil || d.ID != c.id {
			t.Errorf("%s detail: %v", c.sp.kind, err)
		}
		// A row from another referral table must not resolve through this spec.
		other := fxRefIn
		if c.sp.kind == "incoming" {
			other = fxRefOut
		}
		if _, err := st.getReferral(ctx, c.sp, other); err != ErrNotFound {
			t.Errorf("%s resolved a foreign id: %v", c.sp.kind, err)
		}
	}
	if got, _, _ := st.listReferrals(ctx, specOutgoing, ListQuery{Status: "pending", Q: "Fixture", Limit: 5}); len(got) != 1 {
		t.Errorf("status filter on outgoing = %d rows", len(got))
	}
}
