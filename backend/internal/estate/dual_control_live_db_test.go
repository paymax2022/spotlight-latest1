package estate

// ESTD-D027 (S1) live-DB coverage — maker-checker on high-risk estate admin
// actions (UAT EST-UAT-0421 approval-threshold changes, EST-UAT-0428
// administrator maker-checker). Skipped unless TEST_DATABASE_URL is set.
// Reuses the vendor payout fixtures from vendor_payout_live_db_test.go.

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type dcFixture struct {
	pool     *pgxpool.Pool
	svc      *Service
	estateID string
	adminA   string // maker
	adminB   string // checker
	adminC   string // third admin
}

func newDualControlFixture(t *testing.T) *dcFixture {
	t.Helper()
	pool := vendorPayoutPool(t)
	ctx := context.Background()
	svc, _ := newVendorPayoutService(pool)
	svc = svc.WithDualControl(true)
	estateID, adminA := seedVendorEstate(t, ctx, pool, svc)
	f := &dcFixture{pool: pool, svc: svc, estateID: estateID, adminA: adminA}
	f.adminB = f.seedMember(t, "estate_admin")
	f.adminC = f.seedMember(t, "estate_admin")
	return f
}

func (f *dcFixture) seedMember(t *testing.T, role string) string {
	t.Helper()
	ctx := context.Background()
	uid := seedVendorPayoutAuthUser(t, ctx, f.pool)
	if _, err := f.pool.Exec(ctx, `INSERT INTO estate_residents (id, estate_id, user_id, unit, role) VALUES ($1,$2,$3,'A1',$4)`,
		uuid.New().String(), f.estateID, uid, role); err != nil {
		t.Fatalf("seed %s: %v", role, err)
	}
	return uid
}

// completedJob seeds a vendor + a completed job of amountKobo.
func (f *dcFixture) completedJob(t *testing.T, amountKobo int64) (string, string) {
	t.Helper()
	ctx := context.Background()
	vendorUserID := seedVendor(t, ctx, f.pool, f.svc, f.estateID)
	jobID := seedVendorJob(t, ctx, f.svc, f.estateID, f.adminA, vendorUserID, amountKobo)
	if _, err := f.pool.Exec(ctx, `UPDATE vendor_jobs SET status='completed', completed_at=NOW() WHERE id=$1`, jobID); err != nil {
		t.Fatalf("complete job: %v", err)
	}
	return vendorUserID, jobID
}

func (f *dcFixture) auditCount(t *testing.T, action, subjectID string) int {
	t.Helper()
	var n int
	if err := f.pool.QueryRow(context.Background(),
		`SELECT count(*) FROM estate_audit_log WHERE estate_id=$1 AND action=$2 AND subject_id=$3`, f.estateID, action, subjectID).Scan(&n); err != nil {
		t.Fatalf("audit count: %v", err)
	}
	return n
}

func payoutRef(estateID, jobID string) string {
	return "estate_vendor_payout:" + estateID + ":" + jobID
}

// assertPaidOnce proves the payout posted exactly one balanced ledger pair and
// moved the vendor wallet by wantKobo since balBefore.
func (f *dcFixture) assertPaidOnce(t *testing.T, stage, jobID, vendorUserID string, wantKobo, balBefore int64) {
	t.Helper()
	cn, ct := creditLegsForRef(t, context.Background(), f.pool, payoutRef(f.estateID, jobID))
	dn, dt := debitLegsForRef(t, context.Background(), f.pool, payoutRef(f.estateID, jobID))
	if cn != 1 || ct != wantKobo || dn != 1 || dt != wantKobo {
		t.Fatalf("%s: legs credit=(%d,%d) debit=(%d,%d), want exactly one balanced %d pair", stage, cn, ct, dn, dt, wantKobo)
	}
	if bal := vendorWalletBalance(t, context.Background(), f.pool, vendorUserID); bal-balBefore != wantKobo {
		t.Fatalf("%s: vendor wallet delta = %d, want %d", stage, bal-balBefore, wantKobo)
	}
}

// assertRefusals verifies maker self-approval, self-rejection and non-admin
// approval are all refused and nothing was posted.
func (f *dcFixture) assertRefusals(t *testing.T, reqID, jobID string) {
	t.Helper()
	ctx := context.Background()
	if _, _, err := f.svc.ApproveApproval(ctx, f.estateID, f.adminA, reqID, "lgtm"); !errors.Is(err, ErrApprovalSelf) {
		t.Fatalf("self-approve: err = %v, want ErrApprovalSelf", err)
	}
	if n, _ := creditLegsForRef(t, ctx, f.pool, payoutRef(f.estateID, jobID)); n != 0 {
		t.Fatalf("self-approval posted %d credit legs", n)
	}
	if got, _ := f.svc.GetApproval(ctx, f.estateID, f.adminA, reqID); got.Status != ApprovalPending {
		t.Fatalf("status after refused self-approval = %s, want pending", got.Status)
	}
	// Self-rejection refused too (the maker is not a checker).
	if _, err := f.svc.RejectApproval(ctx, f.estateID, f.adminA, reqID, ""); !errors.Is(err, ErrApprovalSelf) {
		t.Fatalf("self-reject: err = %v, want ErrApprovalSelf", err)
	}
	// A non-admin resident cannot approve.
	resident := f.seedMember(t, "resident")
	if _, _, err := f.svc.ApproveApproval(ctx, f.estateID, resident, reqID, ""); err == nil || !isMembershipErr(err) {
		t.Fatalf("resident approve: err = %v, want membership error", err)
	}
}

// EST-UAT-0428:
// different admin's approval executes it exactly once; replays (same checker,
// another checker) never post a second ledger leg.
func TestLiveDB_DualControl_PayoutSelfApprovalRefused_CrossAdminExecutesOnce(t *testing.T) {
	f := newDualControlFixture(t)
	ctx := context.Background()
	vendorUserID, jobID := f.completedJob(t, 25_000_000) // ₦250,000 ≥ default ₦100,000

	// The vendor can no longer self-release an above-threshold payout.
	if _, err := f.svc.RequestPayout(ctx, f.estateID, vendorUserID, jobID, "vendor-"+uuid.New().String()); !errors.Is(err, ErrDualControlRequired) {
		t.Fatalf("direct vendor payout above threshold: err = %v, want ErrDualControlRequired", err)
	}

	req, err := f.svc.CreateApproval(ctx, f.estateID, f.adminA, CreateApprovalInput{
		Action: ApprovalVendorPayout, SubjectID: jobID, IdempotencyKey: "mk-" + uuid.New().String(),
		// A client-supplied amount is ignored — the job's amount is authoritative.
		Payload: []byte(`{"amount_kobo": 1}`),
	})
	if err != nil {
		t.Fatalf("create approval: %v", err)
	}
	if req.Status != ApprovalPending || !req.RequiresChecker || req.AmountKobo != 25_000_000 {
		t.Fatalf("request = %+v, want pending/requires_checker/25_000_000", req)
	}
	if req.ThresholdKobo == nil || *req.ThresholdKobo != DefaultVendorPayoutThresholdKobo || req.ThresholdVersion != 0 {
		t.Fatalf("threshold snapshot = v%d/%v, want v0/default", req.ThresholdVersion, req.ThresholdKobo)
	}

	f.assertRefusals(t, req.ID, jobID)

	balBefore := vendorWalletBalance(t, ctx, f.pool, vendorUserID)
	got, replayed, err := f.svc.ApproveApproval(ctx, f.estateID, f.adminB, req.ID, "checked invoice")
	if err != nil {
		t.Fatalf("cross-admin approve: %v", err)
	}
	if replayed || got.Status != ApprovalExecuted || got.DecidedBy == nil || *got.DecidedBy != f.adminB || got.ExecutedAt == nil {
		t.Fatalf("after approve: replayed=%v %+v", replayed, got)
	}
	if s := jobStatus(t, ctx, f.pool, jobID); s != "paid" {
		t.Fatalf("job status = %s, want paid", s)
	}
	f.assertPaidOnce(t, "first approve", jobID, vendorUserID, 25_000_000, balBefore)

	// Replays: same checker, a third admin, and the vendor's direct path.
	for _, who := range []string{f.adminB, f.adminC} {
		again, replayed, err := f.svc.ApproveApproval(ctx, f.estateID, who, req.ID, "")
		if err != nil || !replayed || again.Status != ApprovalExecuted {
			t.Fatalf("replay by %s: replayed=%v err=%v", who, replayed, err)
		}
	}
	if _, err := f.svc.RequestPayout(ctx, f.estateID, vendorUserID, jobID, "vendor-"+uuid.New().String()); err != nil {
		t.Fatalf("vendor payout on paid job should be an idempotent no-op: %v", err)
	}
	f.assertPaidOnce(t, "after replays", jobID, vendorUserID, 25_000_000, balBefore)

	// Audit trail: requested / approved / executed exactly once each.
	for _, a := range []string{"APPROVAL_REQUESTED", "APPROVAL_APPROVED", "APPROVAL_EXECUTED"} {
		if n := f.auditCount(t, a, req.ID); n != 1 {
			t.Fatalf("audit %s rows = %d, want 1", a, n)
		}
	}
	if n := f.auditCount(t, "VENDOR_PAYOUT", jobID); n != 1 {
		t.Fatalf("VENDOR_PAYOUT audit rows = %d, want 1", n)
	}

	// DB defence in depth: a forged self-approval is refused by the CHECK.
	if _, err := f.pool.Exec(ctx, `UPDATE estate_admin_approvals SET decided_by=initiated_by WHERE id=$1`, req.ID); err == nil {
		t.Fatal("DB allowed decided_by = initiated_by")
	}
}

// Concurrent checkers: exactly one executes, the other observes a replay.
func TestLiveDB_DualControl_ConcurrentApproversExecuteOnce(t *testing.T) {
	f := newDualControlFixture(t)
	ctx := context.Background()
	_, jobID := f.completedJob(t, 30_000_000)
	req, err := f.svc.CreateApproval(ctx, f.estateID, f.adminA, CreateApprovalInput{Action: ApprovalVendorPayout, SubjectID: jobID, IdempotencyKey: "cc-" + uuid.New().String()})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	var wg sync.WaitGroup
	var mu sync.Mutex
	executed, replays := 0, 0
	for _, who := range []string{f.adminB, f.adminC} {
		wg.Add(1)
		go func(who string) {
			defer wg.Done()
			_, replayed, err := f.svc.ApproveApproval(ctx, f.estateID, who, req.ID, "")
			mu.Lock()
			defer mu.Unlock()
			switch {
			case err != nil:
				t.Errorf("approve by %s: %v", who, err)
			case replayed:
				replays++
			default:
				executed++
			}
		}(who)
	}
	wg.Wait()
	if executed != 1 || replays != 1 {
		t.Fatalf("executed=%d replays=%d, want 1/1", executed, replays)
	}
	if n, total := creditLegsForRef(t, ctx, f.pool, payoutRef(f.estateID, jobID)); n != 1 || total != 30_000_000 {
		t.Fatalf("credit legs = (%d,%d), want (1, 30000000)", n, total)
	}
}

// Below threshold the request executes immediately (maker only), and the
// vendor's own direct payout still works — today's behaviour is preserved.
func TestLiveDB_DualControl_BelowThresholdExecutesDirectly(t *testing.T) {
	f := newDualControlFixture(t)
	ctx := context.Background()
	_, jobID := f.completedJob(t, 500_000)
	req, err := f.svc.CreateApproval(ctx, f.estateID, f.adminA, CreateApprovalInput{Action: ApprovalVendorPayout, SubjectID: jobID, IdempotencyKey: "bt-" + uuid.New().String()})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if req.Status != ApprovalExecuted || req.RequiresChecker || req.DecidedBy != nil {
		t.Fatalf("below-threshold request = %+v, want executed without checker", req)
	}
	if n, _ := creditLegsForRef(t, ctx, f.pool, payoutRef(f.estateID, jobID)); n != 1 {
		t.Fatalf("credit legs = %d, want 1", n)
	}

	vendor2, job2 := f.completedJob(t, 400_000)
	if j, err := f.svc.RequestPayout(ctx, f.estateID, vendor2, job2, "v-"+uuid.New().String()); err != nil || j.Status != "paid" {
		t.Fatalf("below-threshold vendor payout: %v", err)
	}
}

// Create is idempotent on the key, and only one open request per subject.
func TestLiveDB_DualControl_CreateIdempotentAndOneOpenPerSubject(t *testing.T) {
	f := newDualControlFixture(t)
	ctx := context.Background()
	_, jobID := f.completedJob(t, 20_000_000)
	key := "idem-" + uuid.New().String()
	in := CreateApprovalInput{Action: ApprovalVendorPayout, SubjectID: jobID, IdempotencyKey: key}
	r1, err := f.svc.CreateApproval(ctx, f.estateID, f.adminA, in)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	r2, err := f.svc.CreateApproval(ctx, f.estateID, f.adminA, in)
	if err != nil || r2.ID != r1.ID {
		t.Fatalf("replayed create: id %v vs %v, err %v", r2, r1.ID, err)
	}
	in.IdempotencyKey = "other-" + uuid.New().String()
	if _, err := f.svc.CreateApproval(ctx, f.estateID, f.adminB, in); !errors.Is(err, ErrApprovalOpen) {
		t.Fatalf("second open request: err = %v, want ErrApprovalOpen", err)
	}
	// A rejected request frees the subject and can never be approved.
	rej, err := f.svc.RejectApproval(ctx, f.estateID, f.adminB, r1.ID, "invoice mismatch")
	if err != nil || rej.Status != ApprovalRejected {
		t.Fatalf("reject: %v %+v", err, rej)
	}
	if _, _, err := f.svc.ApproveApproval(ctx, f.estateID, f.adminC, r1.ID, ""); !errors.Is(err, ErrApprovalNotPending) {
		t.Fatalf("approve after reject: err = %v, want ErrApprovalNotPending", err)
	}
	if n := f.auditCount(t, "APPROVAL_REJECTED", r1.ID); n != 1 {
		t.Fatalf("APPROVAL_REJECTED rows = %d", n)
	}
	if s := jobStatus(t, ctx, f.pool, jobID); s != "completed" {
		t.Fatalf("rejected payout moved job to %s", s)
	}
}

// Resident ban (direct endpoint) is filed for approval; a different admin
// executes it. The ban target cannot be the checker.
func TestLiveDB_DualControl_ResidentBanNeedsSecondAdmin(t *testing.T) {
	f := newDualControlFixture(t)
	ctx := context.Background()
	target := f.seedMember(t, "resident")

	err := f.svc.BanResident(ctx, f.estateID, f.adminA, target, "noise complaints")
	var pa *PendingApprovalError
	if !errors.As(err, &pa) || pa.Request.Action != ApprovalResidentBan || pa.Request.Status != ApprovalPending {
		t.Fatalf("BanResident with dual control: err = %v, want PendingApprovalError", err)
	}
	var banned bool
	_ = f.pool.QueryRow(ctx, `SELECT banned_at IS NOT NULL FROM estate_residents WHERE estate_id=$1 AND user_id=$2`, f.estateID, target).Scan(&banned)
	if banned {
		t.Fatal("resident banned before second-admin approval")
	}
	// Filing again returns the same open request instead of a duplicate.
	err = f.svc.BanResident(ctx, f.estateID, f.adminB, target, "again")
	var pa2 *PendingApprovalError
	if !errors.As(err, &pa2) || pa2.Request.ID != pa.Request.ID {
		t.Fatalf("second ban filing: %v", err)
	}
	if _, _, err := f.svc.ApproveApproval(ctx, f.estateID, f.adminA, pa.Request.ID, ""); !errors.Is(err, ErrApprovalSelf) {
		t.Fatalf("self-approve ban: %v", err)
	}
	if _, _, err := f.svc.ApproveApproval(ctx, f.estateID, f.adminB, pa.Request.ID, ""); err != nil {
		t.Fatalf("approve ban: %v", err)
	}
	_ = f.pool.QueryRow(ctx, `SELECT banned_at IS NOT NULL FROM estate_residents WHERE estate_id=$1 AND user_id=$2`, f.estateID, target).Scan(&banned)
	if !banned {
		t.Fatal("resident not banned after approval")
	}

	// Banning an admin: that admin cannot be the checker of their own ban.
	req, err := f.svc.CreateApproval(ctx, f.estateID, f.adminA, CreateApprovalInput{Action: ApprovalResidentBan, SubjectID: f.adminC, IdempotencyKey: "ban-c-" + uuid.New().String()})
	if err != nil {
		t.Fatalf("file admin ban: %v", err)
	}
	if _, _, err := f.svc.ApproveApproval(ctx, f.estateID, f.adminC, req.ID, ""); !errors.Is(err, ErrApprovalSelf) {
		t.Fatalf("target approving own ban: err = %v, want ErrApprovalSelf", err)
	}
}

// Role escalation to estate_admin is only reachable via approval.
func TestLiveDB_DualControl_RoleGrant(t *testing.T) {
	f := newDualControlFixture(t)
	ctx := context.Background()
	r := f.seedMember(t, "resident")
	req, err := f.svc.CreateApproval(ctx, f.estateID, f.adminA, CreateApprovalInput{Action: ApprovalRoleGrant, SubjectID: r, Payload: []byte(`{"role":"estate_admin"}`), IdempotencyKey: "rg-" + uuid.New().String()})
	if err != nil {
		t.Fatalf("file role grant: %v", err)
	}
	if _, _, err := f.svc.ApproveApproval(ctx, f.estateID, f.adminA, req.ID, ""); !errors.Is(err, ErrApprovalSelf) {
		t.Fatalf("self-approve role grant: %v", err)
	}
	if _, _, err := f.svc.ApproveApproval(ctx, f.estateID, f.adminB, req.ID, ""); err != nil {
		t.Fatalf("approve role grant: %v", err)
	}
	role, err := f.svc.roleIn(ctx, f.estateID, r)
	if err != nil || role != "estate_admin" {
		t.Fatalf("role = %q (%v), want estate_admin", role, err)
	}
	if n := f.auditCount(t, "ROLE_GRANT", r); n != 1 {
		t.Fatalf("ROLE_GRANT audit rows = %d", n)
	}
	if _, err := f.svc.CreateApproval(ctx, f.estateID, f.adminA, CreateApprovalInput{Action: ApprovalRoleGrant, SubjectID: f.seedMember(t, "resident"), Payload: []byte(`{"role":"superuser"}`), IdempotencyKey: "rg2-" + uuid.New().String()}); !errors.Is(err, ErrApprovalInvalid) {
		t.Fatalf("unsupported role: %v", err)
	}
}

// EST-UAT-0421: a threshold change activates only with approval, creates a
// new append-only version, and earlier requests keep their snapshot.
func TestLiveDB_DualControl_ThresholdChangeVersionedHistory(t *testing.T) {
	f := newDualControlFixture(t)
	ctx := context.Background()

	_, jobOld := f.completedJob(t, 6_000_000) // below default ₦100k
	_, jobPending := f.completedJob(t, 12_000_000)
	pendingReq, err := f.svc.CreateApproval(ctx, f.estateID, f.adminA, CreateApprovalInput{Action: ApprovalVendorPayout, SubjectID: jobPending, IdempotencyKey: "tp-" + uuid.New().String()})
	if err != nil || pendingReq.ThresholdVersion != 0 {
		t.Fatalf("pre-change request: %v %+v", err, pendingReq)
	}

	change := func(kobo string, maker, checker string) *ApprovalRequest {
		t.Helper()
		req, err := f.svc.CreateApproval(ctx, f.estateID, maker, CreateApprovalInput{Action: ApprovalThresholdChange, Payload: []byte(`{"vendor_payout_kobo": ` + kobo + `}`), IdempotencyKey: "th-" + uuid.New().String()})
		if err != nil {
			t.Fatalf("file threshold change: %v", err)
		}
		if req.Status != ApprovalPending {
			t.Fatalf("threshold change must wait for a checker, got %s", req.Status)
		}
		if cur, _ := f.svc.CurrentThresholds(ctx, f.estateID); cur.ApprovalRequestID != nil && *cur.ApprovalRequestID == req.ID {
			t.Fatal("threshold active before approval")
		}
		if _, _, err := f.svc.ApproveApproval(ctx, f.estateID, maker, req.ID, ""); !errors.Is(err, ErrApprovalSelf) {
			t.Fatalf("self-approve threshold: %v", err)
		}
		if _, _, err := f.svc.ApproveApproval(ctx, f.estateID, checker, req.ID, ""); err != nil {
			t.Fatalf("approve threshold: %v", err)
		}
		return req
	}
	r1 := change("5000000", f.adminA, f.adminB)
	cur, err := f.svc.CurrentThresholds(ctx, f.estateID)
	if err != nil || cur.Version != 1 || cur.VendorPayoutKobo != 5_000_000 || cur.ApprovalRequestID == nil || *cur.ApprovalRequestID != r1.ID {
		t.Fatalf("after v1: %+v %v", cur, err)
	}
	// The new ₦50k line now dual-controls a ₦60k job created before the change.
	req, err := f.svc.CreateApproval(ctx, f.estateID, f.adminA, CreateApprovalInput{Action: ApprovalVendorPayout, SubjectID: jobOld, IdempotencyKey: "to-" + uuid.New().String()})
	if err != nil || req.Status != ApprovalPending || req.ThresholdVersion != 1 {
		t.Fatalf("post-change payout: %v %+v", err, req)
	}

	change("20000000", f.adminB, f.adminC)
	cur, history, err := f.svc.GetApprovalThresholds(ctx, f.estateID, f.adminA)
	if err != nil || cur.Version != 2 || len(history) != 2 || history[1].VendorPayoutKobo != 5_000_000 {
		t.Fatalf("history: cur=%+v len=%d err=%v", cur, len(history), err)
	}
	// Prior approvals preserved: the request filed under v0 still carries v0.
	if got, _ := f.svc.GetApproval(ctx, f.estateID, f.adminA, pendingReq.ID); got.ThresholdVersion != 0 || got.Status != ApprovalPending {
		t.Fatalf("pre-change request rewritten: %+v", got)
	}
	// Append-only at the DB.
	if _, err := f.pool.Exec(ctx, `UPDATE estate_approval_thresholds SET vendor_payout_kobo=1 WHERE estate_id=$1`, f.estateID); err == nil {
		t.Fatal("thresholds history accepted an UPDATE")
	}
	if _, err := f.pool.Exec(ctx, `DELETE FROM estate_approval_thresholds WHERE estate_id=$1`, f.estateID); err == nil {
		t.Fatal("thresholds history accepted a DELETE")
	}
	if n := f.auditCount(t, "APPROVAL_THRESHOLD_ACTIVATED", f.estateID); n != 2 {
		t.Fatalf("threshold activation audit rows = %d, want 2", n)
	}
	// Fractional kobo refused.
	if _, err := f.svc.CreateApproval(ctx, f.estateID, f.adminA, CreateApprovalInput{Action: ApprovalThresholdChange, Payload: []byte(`{"vendor_payout_kobo": 10.5}`), IdempotencyKey: "tf-" + uuid.New().String()}); !errors.Is(err, ErrApprovalInvalid) {
		t.Fatalf("float threshold: %v", err)
	}
}

// Flag OFF = today's behaviour: bans and above-threshold vendor payouts are
// single-actor, and approvals are refused.
func TestLiveDB_DualControl_FlagOffKeepsSingleActor(t *testing.T) {
	pool := vendorPayoutPool(t)
	ctx := context.Background()
	svc, _ := newVendorPayoutService(pool) // dual control OFF
	f := &dcFixture{pool: pool, svc: svc}
	f.estateID, f.adminA = seedVendorEstate(t, ctx, pool, svc)
	target := f.seedMember(t, "resident")
	if err := svc.BanResident(ctx, f.estateID, f.adminA, target, "x"); err != nil {
		t.Fatalf("flag-off ban: %v", err)
	}
	vendorUserID, jobID := f.completedJob(t, 50_000_000)
	if j, err := svc.RequestPayout(ctx, f.estateID, vendorUserID, jobID, "off-"+uuid.New().String()); err != nil || j.Status != "paid" {
		t.Fatalf("flag-off payout: %v", err)
	}
	if _, err := svc.CreateApproval(ctx, f.estateID, f.adminA, CreateApprovalInput{Action: ApprovalResidentBan, SubjectID: target, IdempotencyKey: "k"}); !errors.Is(err, ErrDualControlDisabled) {
		t.Fatalf("flag-off create: %v", err)
	}
}
