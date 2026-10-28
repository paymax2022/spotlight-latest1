package onboarding

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/doctor"
)

// Everything below runs inside one transaction that is always rolled back, so it
// can be pointed at a shared development database without leaving a row behind.

func liveTx(t *testing.T) (pgx.Tx, context.Context) {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set - skipping onboarding live-DB test")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = tx.Rollback(ctx) })
	return tx, ctx
}

func mustExec(t *testing.T, ctx context.Context, tx pgx.Tx, sql string, args ...any) {
	t.Helper()
	if _, err := tx.Exec(ctx, sql, args...); err != nil {
		t.Fatalf("%v\nSQL: %s", err, sql)
	}
}

func newUser(t *testing.T, ctx context.Context, tx pgx.Tx) string {
	t.Helper()
	id := uuid.NewString()
	mustExec(t, ctx, tx, `INSERT INTO auth.users (id, email) VALUES ($1, $2)`, id, id+"@onboarding-test.invalid")
	return id
}

func profile(t *testing.T, ctx context.Context, tx pgx.Tx, uid, name, draft, verification string) {
	t.Helper()
	mustExec(t, ctx, tx, `
		INSERT INTO doctor_profiles (user_id, name, email, profile_draft, verification, mdcn_number)
		VALUES ($1, $2, $2 || '@x.invalid', $3::jsonb, $4, 'MDCN/TEST/1')`, uid, name, draft, verification)
}

func TestLive_StagesListSearchCountsAndDetail(t *testing.T) {
	tx, ctx := liveTx(t)
	s := &pgStore{db: tx}

	// started: profile row, nothing chosen.
	started := newUser(t, ctx, tx)
	profile(t, ctx, tx, started, "zz-started", `{}`, "unsubmitted")
	// type_selected: provider type chosen.
	picked := newUser(t, ctx, tx)
	profile(t, ctx, tx, picked, "zz-picked", `{"providerType":"veterinarian"}`, "unsubmitted")
	// in_progress: upgrade requested + 3 consents + 1 permission.
	prog := newUser(t, ctx, tx)
	profile(t, ctx, tx, prog, "zz-progress", `{"providerType":"doctor"}`, "unsubmitted")
	mustExec(t, ctx, tx, `INSERT INTO doctor_merchant_upgrades (user_id, state, requested_at) VALUES ($1,'requested',now())`, prog)
	for _, k := range []string{"terms_of_service", "medical_privacy", "hipaa_data_protection"} {
		mustExec(t, ctx, tx, `INSERT INTO doctor_legal_consents (user_id, consent_kind, accepted, accepted_at) VALUES ($1,$2,true,now())`, prog, k)
	}
	mustExec(t, ctx, tx, `INSERT INTO doctor_legal_consents (user_id, consent_kind, accepted) VALUES ($1,'telemedicine_policy',false)`, prog)
	mustExec(t, ctx, tx, `INSERT INTO doctor_app_permissions (user_id, permission_kind, state, decided_at) VALUES ($1,'camera','granted',now()),($1,'microphone','denied',now())`, prog)
	// pending_review.
	pend := newUser(t, ctx, tx)
	profile(t, ctx, tx, pend, "zz-pending", `{"providerType":"specialist"}`, "pending")
	var verifID string
	if err := tx.QueryRow(ctx, `INSERT INTO doctor_verifications (user_id, status, mdcn_number, submitted_at)
		VALUES ($1,'pending','MDCN/TEST/9', now()) RETURNING id::text`, pend).Scan(&verifID); err != nil {
		t.Fatal(err)
	}
	mustExec(t, ctx, tx, `INSERT INTO doctor_verification_documents (verification_id, user_id, doc_type, label, file_name, required)
		VALUES ($1,$2,'licence','MDCN licence','lic.pdf',true)`, verifID, pend)
	// needs_info / approved / rejected / suspended.
	mk := func(name, vstatus, pverif string) string {
		u := newUser(t, ctx, tx)
		profile(t, ctx, tx, u, name, `{"providerType":"doctor"}`, pverif)
		mustExec(t, ctx, tx, `INSERT INTO doctor_verifications (user_id, status, submitted_at) VALUES ($1,$2,now())`, u, vstatus)
		return u
	}
	need := mk("zz-need", "needs_info", "needs_info")
	appr := mk("zz-appr", "approved", "approved")
	rej := mk("zz-rej", "rejected", "rejected")
	susp := mk("zz-susp", "approved", "suspended")

	want := map[string]Stage{
		started: StageStarted, picked: StageTypeSelected, prog: StageInProgress, pend: StagePendingReview,
		need: StageNeedsInfo, appr: StageApproved, rej: StageRejected, susp: StageSuspended,
	}
	all, err := s.List(ctx, ListQuery{Q: "zz-", Limit: 200})
	if err != nil {
		t.Fatal(err)
	}
	if all.Total != len(want) || len(all.Items) != len(want) {
		t.Fatalf("total=%d items=%d want %d", all.Total, len(all.Items), len(want))
	}
	for _, it := range all.Items {
		if it.Stage != want[it.UserID] {
			t.Errorf("%s: stage %s want %s", it.Name, it.Stage, want[it.UserID])
		}
		if it.ConsentsRequired != 5 {
			t.Errorf("consents_required = %d", it.ConsentsRequired)
		}
	}
	for _, st := range allStages {
		if all.Counts[string(st)] != 1 {
			t.Errorf("count[%s] = %d, want 1", st, all.Counts[string(st)])
		}
	}
	if all.Items[0].Stage != StagePendingReview {
		t.Errorf("pending review must sort first, got %s", all.Items[0].Stage)
	}

	one, err := s.List(ctx, ListQuery{Stage: "pending_review", Q: "zz-", Limit: 10})
	if err != nil || one.Total != 1 || one.Items[0].UserID != pend {
		t.Fatalf("stage filter: %+v err=%v", one, err)
	}
	if one.Counts["approved"] != 1 {
		t.Errorf("counts must ignore the stage filter, got %v", one.Counts)
	}
	byMDCN, err := s.List(ctx, ListQuery{Q: "MDCN/TEST/9", Limit: 10})
	if err != nil || byMDCN.Total != 1 || byMDCN.Items[0].UserID != pend {
		t.Fatalf("mdcn search: %+v err=%v", byMDCN, err)
	}
	none, _ := s.List(ctx, ListQuery{Q: "no-such-applicant-xyz", Limit: 10})
	if none.Total != 0 || len(none.Items) != 0 || none.Items == nil {
		t.Fatalf("empty search must return an empty, non-nil list: %+v", none)
	}

	d, err := s.Detail(ctx, prog)
	if err != nil {
		t.Fatal(err)
	}
	if d.ConsentsAccepted != 3 || d.PermissionsGranted != 1 || len(d.Consents) != 4 || len(d.Permissions) != 2 ||
		d.UpgradeState == nil || *d.UpgradeState != "requested" || d.CanDecide {
		t.Fatalf("progress detail: %+v", d)
	}
	pd, err := s.Detail(ctx, pend)
	if err != nil {
		t.Fatal(err)
	}
	if !pd.CanDecide || len(pd.Documents) != 1 || pd.Documents[0].DocType != "licence" ||
		len(pd.Verifications) != 1 || pd.VerificationID == nil || *pd.VerificationID != verifID || pd.ReviewPath == "" {
		t.Fatalf("pending detail: %+v", pd)
	}
	if _, err := s.Detail(ctx, uuid.NewString()); err != ErrNotFound {
		t.Fatalf("unknown user err = %v", err)
	}
}

// txDecider stands in for the MDCN review service (which needs the real pool) by
// applying the same row change inside the test transaction.
type txDecider struct {
	ctx context.Context
	tx  pgx.Tx
}

func (d *txDecider) Decide(_ context.Context, _, verificationID string, in doctor.MDCNDecision) (*doctor.MDCNReviewRecord, error) {
	to := map[string]string{"approve": "approved", "need_info": "needs_info", "reject": "rejected"}[in.Action]
	_, err := d.tx.Exec(d.ctx, `UPDATE doctor_verifications SET status=$2, decided_at=now() WHERE id=$1`, verificationID, to)
	return &doctor.MDCNReviewRecord{}, err
}

func TestLive_DecisionRecordsUpgradeAndAuditIdempotently(t *testing.T) {
	tx, ctx := liveTx(t)
	reviewer := newUser(t, ctx, tx)
	applicant := newUser(t, ctx, tx)
	profile(t, ctx, tx, applicant, "zz-decide", `{"providerType":"doctor"}`, "pending")
	mustExec(t, ctx, tx, `INSERT INTO doctor_verifications (user_id, status, submitted_at) VALUES ($1,'pending',now())`, applicant)
	mustExec(t, ctx, tx, `INSERT INTO doctor_merchant_upgrades (user_id, state, requested_at) VALUES ($1,'requested',now())`, applicant)

	svc := newService(&pgStore{db: tx}, &txDecider{ctx: ctx, tx: tx})

	// need_info: upgrade state unchanged, review note stored, audit written.
	if _, err := svc.Decide(ctx, reviewer, applicant, DecisionRequest{Action: "need_info", Notes: "licence photo is blurry"}); err != nil {
		t.Fatal(err)
	}
	var state string
	var note *string
	if err := tx.QueryRow(ctx, `SELECT state, detail->'review'->>'notes' FROM doctor_merchant_upgrades WHERE user_id=$1`, applicant).Scan(&state, &note); err != nil {
		t.Fatal(err)
	}
	if state != "requested" || note == nil || *note != "licence photo is blurry" {
		t.Fatalf("after need_info: state=%s note=%v", state, note)
	}

	// approve: upgrade completes, completed_at set, stage becomes approved.
	d, err := svc.Decide(ctx, reviewer, applicant, DecisionRequest{Action: "approve", LicenceExpiry: "2999-01-01", Discipline: "medical"})
	if err != nil {
		t.Fatal(err)
	}
	if d.Stage != StageApproved || d.CanDecide {
		t.Fatalf("stage=%s canDecide=%v", d.Stage, d.CanDecide)
	}
	var completedSet bool
	if err := tx.QueryRow(ctx, `SELECT state, completed_at IS NOT NULL FROM doctor_merchant_upgrades WHERE user_id=$1`, applicant).Scan(&state, &completedSet); err != nil {
		t.Fatal(err)
	}
	if state != "completed" || !completedSet {
		t.Fatalf("after approve: state=%s completed_at set=%v", state, completedSet)
	}

	// Retrying the same approve must not add another audit row.
	if _, err := svc.Decide(ctx, reviewer, applicant, DecisionRequest{Action: "approve", LicenceExpiry: "2999-01-01", Discipline: "medical"}); err != nil {
		t.Fatal(err)
	}
	var audits int
	if err := tx.QueryRow(ctx, `SELECT COUNT(*) FROM doctor_compliance_audit
		WHERE action='doctor.onboarding.admin.decided' AND entity_id=$1`, applicant).Scan(&audits); err != nil {
		t.Fatal(err)
	}
	if audits != 2 { // one for needs_info, one for approved; the retry added none
		t.Fatalf("audit rows = %d, want 2", audits)
	}
	if len(d.Audit) == 0 {
		t.Error("detail must surface the audit trail")
	}

	// A settled approval cannot be flipped to a rejection.
	if _, err := svc.Decide(ctx, reviewer, applicant, DecisionRequest{Action: "reject", Notes: "x"}); err == nil {
		t.Fatal("rejecting an approved verification must fail")
	}
}

func TestLive_ApproveWithoutUpgradeRowCreatesCompletedOne(t *testing.T) {
	tx, ctx := liveTx(t)
	reviewer := newUser(t, ctx, tx)
	applicant := newUser(t, ctx, tx)
	profile(t, ctx, tx, applicant, "zz-noupgrade", `{"providerType":"doctor"}`, "pending")
	mustExec(t, ctx, tx, `INSERT INTO doctor_verifications (user_id, status, submitted_at) VALUES ($1,'pending',now())`, applicant)
	svc := newService(&pgStore{db: tx}, &txDecider{ctx: ctx, tx: tx})
	if _, err := svc.Decide(ctx, reviewer, applicant, DecisionRequest{Action: "approve", LicenceExpiry: "2999-01-01", Discipline: "dental"}); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := tx.QueryRow(ctx, `SELECT COUNT(*) FROM doctor_merchant_upgrades WHERE user_id=$1 AND state='completed'`, applicant).Scan(&n); err != nil || n != 1 {
		t.Fatalf("completed upgrade rows = %d err=%v", n, err)
	}
	// A rejection with no upgrade row must not invent one.
	other := newUser(t, ctx, tx)
	profile(t, ctx, tx, other, "zz-rejnone", `{"providerType":"doctor"}`, "pending")
	mustExec(t, ctx, tx, `INSERT INTO doctor_verifications (user_id, status, submitted_at) VALUES ($1,'pending',now())`, other)
	if _, err := svc.Decide(ctx, reviewer, other, DecisionRequest{Action: "reject", Notes: "not registered"}); err != nil {
		t.Fatal(err)
	}
	if err := tx.QueryRow(ctx, `SELECT COUNT(*) FROM doctor_merchant_upgrades WHERE user_id=$1`, other).Scan(&n); err != nil || n != 0 {
		t.Fatalf("rejection created %d upgrade rows", n)
	}
}
