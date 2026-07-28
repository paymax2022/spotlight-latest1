package feespromotion

import (
	"context"
	"errors"
	"testing"
	"time"

	feesstatemachine "spotlight/backend/internal/academy/fees/statemachine"
)

// PURE tests — no DB. The pgx Repository is replaced by an in-memory fakeStore so the
// full promotion lifecycle, the SF-3 two-approval guard, and the idempotent rollover are
// all exercised without a live DB (mirrors feessession/session_test.go isolation).
//
// SF-3 is a RELEASE BLOCKER, so this file makes a REAL bypass attempt: it explicitly
// calls Apply from promotion_computed and from promotion_reviewed and asserts BOTH fail
// with ErrApprovalRequired. A test that never attempts the bypass proves nothing.

// ── in-memory fake store ──────────────────────────────────────────────────────

type fakeStore struct {
	promos   map[string]*PromotionRecord
	students map[string]*Student
	scores   map[string]float64 // key: session|class|student
	roster   map[string][]string
	seq      int
	// reassignCount tracks how many times ReassignStudent actually ran (idempotency).
	reassignCount int
	// feeReassignCount tracks fee-schedule reassignments (idempotency).
	feeReassignCount int
}

func newFakeStore() *fakeStore {
	return &fakeStore{
		promos:   map[string]*PromotionRecord{},
		students: map[string]*Student{},
		scores:   map[string]float64{},
		roster:   map[string][]string{},
	}
}

func skey(session, class, student string) string { return session + "|" + class + "|" + student }
func rkey(school, class string) string           { return school + "|" + class }

func (f *fakeStore) ListClassStudentIDs(_ context.Context, schoolID, classID string) ([]string, error) {
	return f.roster[rkey(schoolID, classID)], nil
}

func (f *fakeStore) UpsertScore(_ context.Context, schoolID, classID, sessionID, studentID string, score float64) error {
	f.scores[skey(sessionID, classID, studentID)] = score
	// Stage a session_active promotion record per (student, session, class) — mirrors
	// the repository's staging behaviour.
	for _, p := range f.promos {
		if p.StudentID == studentID && deref(p.SessionID) == sessionID && deref(p.FromClassID) == classID {
			p.ExamScore = f64(score)
			return nil
		}
	}
	f.seq++
	id := "promo-" + itoa(f.seq)
	f.promos[id] = &PromotionRecord{
		ID:          id,
		StudentID:   studentID,
		FromClassID: ptrOrNil(classID),
		SessionID:   ptrOrNil(sessionID),
		ExamScore:   f64(score),
		State:       StateSessionActive,
		CreatedAt:   time.Now(),
	}
	return nil
}

func (f *fakeStore) ListScores(_ context.Context, schoolID, classID, sessionID string) (map[string]float64, error) {
	out := map[string]float64{}
	for _, sid := range f.roster[rkey(schoolID, classID)] {
		if v, ok := f.scores[skey(sessionID, classID, sid)]; ok {
			out[sid] = v
		}
	}
	return out, nil
}

func (f *fakeStore) InsertPromotion(_ context.Context, p PromotionRecord) (*PromotionRecord, error) {
	f.seq++
	p.ID = "promo-" + itoa(f.seq)
	cp := p
	f.promos[p.ID] = &cp
	out := cp
	return &out, nil
}

func (f *fakeStore) GetPromotion(_ context.Context, id string) (*PromotionRecord, error) {
	p, ok := f.promos[id]
	if !ok {
		return nil, ErrNotFound
	}
	out := *p
	return &out, nil
}

func (f *fakeStore) ListPromotionsByClass(_ context.Context, sessionID, classID string) ([]PromotionRecord, error) {
	out := []PromotionRecord{}
	for _, p := range f.promos {
		if deref(p.SessionID) == sessionID && deref(p.FromClassID) == classID {
			out = append(out, *p)
		}
	}
	return out, nil
}

// SetPromotionState is the GUARDED write: it refuses when the record is not in `from`.
// This is what makes an out-of-order Apply attempt actually fail at the store, matching
// the pgx Repository's WHERE state=$from guard.
func (f *fakeStore) SetPromotionState(_ context.Context, id string, from, to State) (*PromotionRecord, error) {
	p, ok := f.promos[id]
	if !ok {
		return nil, ErrNotFound
	}
	if p.State != from {
		return nil, ErrIllegalTransition
	}
	p.State = to
	out := *p
	return &out, nil
}

func (f *fakeStore) RecordTeacherApproval(_ context.Context, id, approverID string, at time.Time, from, to State) (*PromotionRecord, error) {
	p, ok := f.promos[id]
	if !ok {
		return nil, ErrNotFound
	}
	if p.State != from {
		return nil, ErrIllegalTransition
	}
	p.TeacherApprovedBy = ptrOrNil(approverID)
	tt := at
	p.TeacherApprovedAt = &tt
	p.State = to
	out := *p
	return &out, nil
}

func (f *fakeStore) RecordAdminApproval(_ context.Context, id, approverID string, at time.Time, from, to State) (*PromotionRecord, error) {
	p, ok := f.promos[id]
	if !ok {
		return nil, ErrNotFound
	}
	if p.State != from {
		return nil, ErrIllegalTransition
	}
	p.AdminApprovedBy = ptrOrNil(approverID)
	tt := at
	p.AdminApprovedAt = &tt
	p.State = to
	out := *p
	return &out, nil
}

// SetProposal persists the proposed decision + destination (no state change) so Compute
// can record its proposal — mirrors the pgx Repository's SetProposal guard.
func (f *fakeStore) SetProposal(_ context.Context, id string, decision Decision, toClassID *string) error {
	p, ok := f.promos[id]
	if !ok {
		return ErrNotFound
	}
	d := decision
	p.Decision = &d
	p.ToClassID = toClassID
	return nil
}

func (f *fakeStore) GetStudent(_ context.Context, id string) (*Student, error) {
	s, ok := f.students[id]
	if !ok {
		return nil, ErrNotFound
	}
	out := *s
	return &out, nil
}

func (f *fakeStore) ReassignStudent(_ context.Context, studentID string, classID *string, status StudentStatus) (*Student, error) {
	s, ok := f.students[studentID]
	if !ok {
		return nil, ErrNotFound
	}
	s.ClassID = classID
	s.Status = status
	f.reassignCount++
	out := *s
	return &out, nil
}

func (f *fakeStore) ReassignFeeSchedule(_ context.Context, schoolID, studentID, toClassID, sessionID string) error {
	f.feeReassignCount++
	return nil
}

func (f *fakeStore) WriteAudit(_ context.Context, _, _, _, _, _, _ string, _ any) error { return nil }

// ── helpers ───────────────────────────────────────────────────────────────────

func f64(v float64) *float64 { return &v }

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
}

// seedStudent registers a student in the roster + student map.
func (f *fakeStore) seedStudent(school, class, id string) {
	f.students[id] = &Student{ID: id, SchoolID: school, ClassID: ptrOrNil(class), Status: StudentActive}
	f.roster[rkey(school, class)] = append(f.roster[rkey(school, class)], id)
}

// driveToApproved runs the happy path up to promotion_approved and returns the record id.
func driveToApproved(t *testing.T, svc *Service, fs *fakeStore, school, session, fromClass, toClass, student string, score, passMark float64) string {
	t.Helper()
	ctx := context.Background()
	// scores → results_finalized
	if err := svc.ImportScores(ctx, "bursar-1", ImportScoresRequest{
		SchoolID: school, ClassID: fromClass, SessionID: session,
		Scores: []StudentScore{{StudentID: student, Score: score}},
	}); err != nil {
		t.Fatalf("import scores: %v", err)
	}
	// compute → promotion_computed (proposal only)
	recs, err := svc.Compute(ctx, "bursar-1", session, fromClass, ComputeRequest{
		SchoolID: school, PassMark: passMark, ToClassID: toClass,
	})
	if err != nil {
		t.Fatalf("compute: %v", err)
	}
	if len(recs) != 1 {
		t.Fatalf("expected 1 computed record, got %d", len(recs))
	}
	id := recs[0].ID
	if recs[0].State != StateComputed {
		t.Fatalf("after compute want state=%s, got %s", StateComputed, recs[0].State)
	}
	// teacher approval #1 → reviewed
	if _, err := svc.TeacherApprove(ctx, "teacher-1", id); err != nil {
		t.Fatalf("teacher approve: %v", err)
	}
	// admin approval #2 (distinct) → approved
	if _, err := svc.AdminApprove(ctx, "head-1", id); err != nil {
		t.Fatalf("admin approve: %v", err)
	}
	rec, _ := svc.Get(ctx, id)
	if rec.State != StateApproved {
		t.Fatalf("after both approvals want state=%s, got %s", StateApproved, rec.State)
	}
	return id
}

// ── TEST: full happy path ──────────────────────────────────────────────────────

func TestPromotion_HappyPath_AppliesAndRolls(t *testing.T) {
	ctx := context.Background()
	fs := newFakeStore()
	svc := NewServiceWithStore(fs)
	fs.seedStudent("school-1", "jss1", "stu-1")

	id := driveToApproved(t, svc, fs, "school-1", "sess-1", "jss1", "jss2", "stu-1", 75, 50)

	out, err := svc.Apply(ctx, "bursar-1", id)
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if out.State != StateApplied {
		t.Fatalf("want applied, got %s", out.State)
	}
	stu, _ := fs.GetStudent(ctx, "stu-1")
	if deref(stu.ClassID) != "jss2" {
		t.Fatalf("promoted student must move to jss2, got %q", deref(stu.ClassID))
	}
	if stu.Status != StudentPromoted {
		t.Fatalf("want status promoted, got %s", stu.Status)
	}
	if fs.feeReassignCount != 1 {
		t.Fatalf("fee schedule must be reassigned exactly once, got %d", fs.feeReassignCount)
	}
}

// ── TEST: SF-3 BYPASS (required) ────────────────────────────────────────────────
//
// Explicitly attempt to reach `applied` skipping approvals and assert BOTH fail with
// ErrApprovalRequired. This is the release-blocker proof.

func TestPromotion_SF3_BypassAttempts_AllFail(t *testing.T) {
	ctx := context.Background()

	// (1) Apply directly from promotion_computed (no approvals at all).
	{
		fs := newFakeStore()
		svc := NewServiceWithStore(fs)
		fs.seedStudent("school-1", "jss1", "stu-1")
		if err := svc.ImportScores(ctx, "bursar-1", ImportScoresRequest{
			SchoolID: "school-1", ClassID: "jss1", SessionID: "sess-1",
			Scores: []StudentScore{{StudentID: "stu-1", Score: 80}},
		}); err != nil {
			t.Fatalf("import: %v", err)
		}
		recs, err := svc.Compute(ctx, "bursar-1", "sess-1", "jss1", ComputeRequest{
			SchoolID: "school-1", PassMark: 50, ToClassID: "jss2"})
		if err != nil {
			t.Fatalf("compute: %v", err)
		}
		id := recs[0].ID
		// BYPASS ATTEMPT: computed → applied.
		if _, err := svc.Apply(ctx, "bursar-1", id); !errors.Is(err, ErrApprovalRequired) {
			t.Fatalf("SF-3 BYPASS computed→applied MUST fail with ErrApprovalRequired, got %v", err)
		}
		rec, _ := svc.Get(ctx, id)
		if rec.State == StateApplied {
			t.Fatalf("SF-3 VIOLATION: record reached applied via bypass")
		}
		if fs.reassignCount != 0 {
			t.Fatalf("SF-3 VIOLATION: rollover ran on a bypass, count=%d", fs.reassignCount)
		}
	}

	// (2) Apply from promotion_reviewed (only ONE approval).
	{
		fs := newFakeStore()
		svc := NewServiceWithStore(fs)
		fs.seedStudent("school-1", "jss1", "stu-1")
		if err := svc.ImportScores(ctx, "bursar-1", ImportScoresRequest{
			SchoolID: "school-1", ClassID: "jss1", SessionID: "sess-1",
			Scores: []StudentScore{{StudentID: "stu-1", Score: 80}},
		}); err != nil {
			t.Fatalf("import: %v", err)
		}
		recs, _ := svc.Compute(ctx, "bursar-1", "sess-1", "jss1", ComputeRequest{
			SchoolID: "school-1", PassMark: 50, ToClassID: "jss2"})
		id := recs[0].ID
		if _, err := svc.TeacherApprove(ctx, "teacher-1", id); err != nil {
			t.Fatalf("teacher approve: %v", err)
		}
		rec, _ := svc.Get(ctx, id)
		if rec.State != StateReviewed {
			t.Fatalf("want reviewed after single approval, got %s", rec.State)
		}
		// BYPASS ATTEMPT: reviewed → applied (admin approval skipped).
		if _, err := svc.Apply(ctx, "bursar-1", id); !errors.Is(err, ErrApprovalRequired) {
			t.Fatalf("SF-3 BYPASS reviewed→applied MUST fail with ErrApprovalRequired, got %v", err)
		}
		rec, _ = svc.Get(ctx, id)
		if rec.State == StateApplied {
			t.Fatalf("SF-3 VIOLATION: record reached applied with a single approval")
		}
		if fs.reassignCount != 0 {
			t.Fatalf("SF-3 VIOLATION: rollover ran with a single approval")
		}
	}
}

// TestPromotion_SF3_PureMachine_NoBypassEdge asserts at the state-machine layer that the
// forbidden jumps are structurally impossible (defence in depth for the bypass test).
func TestPromotion_SF3_PureMachine_NoBypassEdge(t *testing.T) {
	if _, err := feesstatemachine.PromotionTransition(feesstatemachine.PromotionComputed, feesstatemachine.EvAdminApply); !errors.Is(err, ErrApprovalRequired) {
		t.Fatalf("computed→apply must be ErrApprovalRequired, got %v", err)
	}
	if _, err := feesstatemachine.PromotionTransition(feesstatemachine.PromotionReviewed, feesstatemachine.EvAdminApply); !errors.Is(err, ErrApprovalRequired) {
		t.Fatalf("reviewed→apply must be ErrApprovalRequired, got %v", err)
	}
}

// ── TEST: apply with only one approval column set ──────────────────────────────
//
// Defence-in-depth assertion: even if a record were somehow in promotion_approved with a
// missing approver column, Apply refuses. We simulate that corrupt state directly.

func TestPromotion_Apply_MissingApproverColumn_Fails(t *testing.T) {
	ctx := context.Background()
	fs := newFakeStore()
	svc := NewServiceWithStore(fs)
	fs.seedStudent("school-1", "jss1", "stu-1")
	// Craft a record in promotion_approved but with only the teacher approver present.
	dec := DecisionPromoted
	fs.promos["p9"] = &PromotionRecord{
		ID: "p9", StudentID: "stu-1", FromClassID: ptrOrNil("jss1"), ToClassID: ptrOrNil("jss2"),
		SessionID: ptrOrNil("sess-1"), Decision: &dec, State: StateApproved,
		TeacherApprovedBy: ptrOrNil("teacher-1"), // admin approver deliberately nil
	}
	if _, err := svc.Apply(ctx, "bursar-1", "p9"); !errors.Is(err, ErrApprovalsIncomplete) {
		t.Fatalf("apply with missing admin approver MUST fail ErrApprovalsIncomplete, got %v", err)
	}
	if fs.reassignCount != 0 {
		t.Fatalf("rollover must not run on incomplete approvals")
	}
}

// ── TEST: distinct-approver guard (stronger SF-3) ──────────────────────────────

func TestPromotion_SameApprover_Rejected(t *testing.T) {
	ctx := context.Background()
	fs := newFakeStore()
	svc := NewServiceWithStore(fs)
	fs.seedStudent("school-1", "jss1", "stu-1")
	if err := svc.ImportScores(ctx, "bursar-1", ImportScoresRequest{
		SchoolID: "school-1", ClassID: "jss1", SessionID: "sess-1",
		Scores: []StudentScore{{StudentID: "stu-1", Score: 80}},
	}); err != nil {
		t.Fatalf("import: %v", err)
	}
	recs, _ := svc.Compute(ctx, "bursar-1", "sess-1", "jss1", ComputeRequest{
		SchoolID: "school-1", PassMark: 50, ToClassID: "jss2"})
	id := recs[0].ID
	if _, err := svc.TeacherApprove(ctx, "same-person", id); err != nil {
		t.Fatalf("teacher approve: %v", err)
	}
	// SAME identity for admin approval ⇒ must be refused; state stays reviewed.
	if _, err := svc.AdminApprove(ctx, "same-person", id); !errors.Is(err, ErrApproversMustDiffer) {
		t.Fatalf("same approver MUST fail ErrApproversMustDiffer, got %v", err)
	}
	rec, _ := svc.Get(ctx, id)
	if rec.State != StateReviewed {
		t.Fatalf("state must remain reviewed after rejected same-approver, got %s", rec.State)
	}
}

// ── TEST: repeated decision keeps class ────────────────────────────────────────

func TestPromotion_Repeated_KeepsSameClass(t *testing.T) {
	ctx := context.Background()
	fs := newFakeStore()
	svc := NewServiceWithStore(fs)
	fs.seedStudent("school-1", "jss1", "stu-1")
	// Score below pass mark ⇒ repeated.
	id := driveToApproved(t, svc, fs, "school-1", "sess-1", "jss1", "jss2", "stu-1", 30, 50)
	if _, err := svc.Apply(ctx, "bursar-1", id); err != nil {
		t.Fatalf("apply: %v", err)
	}
	stu, _ := fs.GetStudent(ctx, "stu-1")
	if deref(stu.ClassID) != "jss1" {
		t.Fatalf("repeated student must stay in jss1, got %q", deref(stu.ClassID))
	}
	if stu.Status != StudentRepeated {
		t.Fatalf("want status repeated, got %s", stu.Status)
	}
}

// ── TEST: rollover idempotent (double apply) ───────────────────────────────────

func TestPromotion_Rollover_Idempotent(t *testing.T) {
	ctx := context.Background()
	fs := newFakeStore()
	svc := NewServiceWithStore(fs)
	fs.seedStudent("school-1", "jss1", "stu-1")
	id := driveToApproved(t, svc, fs, "school-1", "sess-1", "jss1", "jss2", "stu-1", 75, 50)

	if _, err := svc.Apply(ctx, "bursar-1", id); err != nil {
		t.Fatalf("first apply: %v", err)
	}
	if fs.reassignCount != 1 {
		t.Fatalf("first apply must reassign once, got %d", fs.reassignCount)
	}
	// Second apply: record is terminal (applied) ⇒ machine refuses, rollover must NOT
	// run again. This proves double-apply doesn't double-reassign.
	if _, err := svc.Apply(ctx, "bursar-1", id); !errors.Is(err, ErrTerminal) {
		t.Fatalf("second apply on terminal record must be ErrTerminal, got %v", err)
	}
	if fs.reassignCount != 1 {
		t.Fatalf("double apply must NOT double-reassign, count=%d", fs.reassignCount)
	}

	// Directly re-run the rollover executor on the already-applied record to prove the
	// executor itself is idempotent (no-op when already in target class+status).
	rec, _ := svc.Get(ctx, id)
	before := fs.reassignCount
	if err := svc.rollover.Execute(ctx, "bursar-1", *rec); err != nil {
		t.Fatalf("rollover re-run: %v", err)
	}
	if fs.reassignCount != before {
		t.Fatalf("rollover executor must be a no-op on re-run, count went %d→%d", before, fs.reassignCount)
	}
}
