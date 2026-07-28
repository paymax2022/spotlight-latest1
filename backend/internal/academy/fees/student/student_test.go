package feesstudent

import (
	"context"
	"errors"
	"strings"
	"testing"
)

// PURE tests — no DB. The pgx Repository is replaced by an in-memory fakeStore and a fake
// identity checker, mirroring feeschedule_test.go / edupay_test.go isolation.
//
// The identity-reuse tests ACTIVELY assert that the fake identity store is never written
// to (grep-proof: fakeStore has NO identity-insert method and fakeIdentity only READS),
// and that linking a non-existent identity is refused — proving we reuse, never mint.

// ── fakes ─────────────────────────────────────────────────────────────────────

type fakeStore struct {
	items map[string]*Student
	seq   int
	// (school_id|admission_number) → true, mirrors the DB UNIQUE (school_id, admission_number)
	adm map[string]bool
}

func newFakeStore() *fakeStore {
	return &fakeStore{items: map[string]*Student{}, adm: map[string]bool{}}
}

func admKey(schoolID, adm string) string { return schoolID + "|" + adm }

func (f *fakeStore) Insert(_ context.Context, s Student) (*Student, error) {
	if s.AdmissionNumber != nil && *s.AdmissionNumber != "" {
		k := admKey(s.SchoolID, *s.AdmissionNumber)
		if f.adm[k] {
			return nil, ErrAdmissionNumberTaken // enforce UNIQUE (school_id, admission_number)
		}
		f.adm[k] = true
	}
	f.seq++
	s.ID = "stu-" + itoa(f.seq)
	s.Status = StudentActive
	if s.GuardianUserIDs == nil {
		s.GuardianUserIDs = []string{}
	}
	cp := s
	f.items[s.ID] = &cp
	return &cp, nil
}

func (f *fakeStore) Get(_ context.Context, id string) (*Student, error) {
	s, ok := f.items[id]
	if !ok {
		return nil, ErrNotFound
	}
	out := *s
	out.GuardianUserIDs = cloneSlice(s.GuardianUserIDs)
	return &out, nil
}

func (f *fakeStore) List(_ context.Context, schoolID, classID string) ([]Student, error) {
	out := []Student{}
	for _, s := range f.items {
		if s.SchoolID != schoolID {
			continue
		}
		if classID != "" && (s.ClassID == nil || *s.ClassID != classID) {
			continue
		}
		out = append(out, *s)
	}
	return out, nil
}

func (f *fakeStore) ExistsAdmissionNumber(_ context.Context, schoolID, adm string) (bool, error) {
	if strings.TrimSpace(adm) == "" {
		return false, nil
	}
	return f.adm[admKey(schoolID, adm)], nil
}

func (f *fakeStore) SetGuardians(_ context.Context, id string, guardianUserIDs []string) (*Student, error) {
	s, ok := f.items[id]
	if !ok {
		return nil, ErrNotFound
	}
	s.GuardianUserIDs = cloneSlice(guardianUserIDs)
	out := *s
	out.GuardianUserIDs = cloneSlice(s.GuardianUserIDs)
	return &out, nil
}

func (f *fakeStore) WriteAudit(_ context.Context, _, _, _, _, _ string, _ any) error { return nil }

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

// fakeIdentity is a READ-ONLY view over a set of existing identities. It has no create
// method — proving this package can only REUSE identities, never mint them.
type fakeIdentity struct {
	known map[string]bool
}

func newFakeIdentity(ids ...string) *fakeIdentity {
	m := map[string]bool{}
	for _, id := range ids {
		m[id] = true
	}
	return &fakeIdentity{known: m}
}

func (f *fakeIdentity) IdentityExists(_ context.Context, userID string) (bool, error) {
	return f.known[userID], nil
}

// ── admission_number uniqueness per school ───────────────────────────────────────

func TestAdmissionNumberUniquePerSchool(t *testing.T) {
	f := newFakeStore()
	svc := NewServiceWithStore(f)
	ctx := context.Background()

	if _, err := svc.CreateStudent(ctx, "bursar-1", "school-1", CreateStudentRequest{AdmissionNumber: "ADM-001"}); err != nil {
		t.Fatalf("first create: %v", err)
	}
	// Same admission number, SAME school → rejected.
	if _, err := svc.CreateStudent(ctx, "bursar-1", "school-1", CreateStudentRequest{AdmissionNumber: "ADM-001"}); !errors.Is(err, ErrAdmissionNumberTaken) {
		t.Fatalf("duplicate admission number in same school must be rejected, got %v", err)
	}
	// Same admission number, DIFFERENT school → allowed (uniqueness is per school).
	if _, err := svc.CreateStudent(ctx, "bursar-1", "school-2", CreateStudentRequest{AdmissionNumber: "ADM-001"}); err != nil {
		t.Fatalf("same admission number in a different school must be allowed, got %v", err)
	}
}

// ── guardian link reuses existing identity (never creates one) ────────────────────

func TestLinkGuardian_ReusesExistingIdentity(t *testing.T) {
	f := newFakeStore()
	id := newFakeIdentity("guardian-existing")
	svc := NewServiceWithDeps(f, id)
	ctx := context.Background()

	st, err := svc.CreateStudent(ctx, "bursar-1", "school-1", CreateStudentRequest{AdmissionNumber: "ADM-1"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	// Linking an EXISTING identity succeeds and records the association.
	out, err := svc.LinkGuardian(ctx, "bursar-1", st.ID, "guardian-existing")
	if err != nil {
		t.Fatalf("link existing guardian: %v", err)
	}
	if !contains(out.GuardianUserIDs, "guardian-existing") {
		t.Fatal("guardian id must be recorded on the student")
	}

	// Linking a NON-existent identity is refused — we never mint an identity.
	if _, err := svc.LinkGuardian(ctx, "bursar-1", st.ID, "ghost-not-a-user"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("linking an unknown identity must be refused (reuse-only), got %v", err)
	}

	// Idempotent: re-linking the same guardian does not duplicate it.
	out2, err := svc.LinkGuardian(ctx, "bursar-1", st.ID, "guardian-existing")
	if err != nil {
		t.Fatalf("re-link: %v", err)
	}
	n := 0
	for _, g := range out2.GuardianUserIDs {
		if g == "guardian-existing" {
			n++
		}
	}
	if n != 1 {
		t.Fatalf("guardian must appear exactly once, got %d", n)
	}
}

func TestUnlinkGuardian(t *testing.T) {
	f := newFakeStore()
	id := newFakeIdentity("g1", "g2")
	svc := NewServiceWithDeps(f, id)
	ctx := context.Background()

	st, _ := svc.CreateStudent(ctx, "bursar-1", "school-1", CreateStudentRequest{
		AdmissionNumber: "ADM-1", GuardianUserIDs: []string{"g1", "g2"},
	})
	out, err := svc.UnlinkGuardian(ctx, "bursar-1", st.ID, "g1")
	if err != nil {
		t.Fatalf("unlink: %v", err)
	}
	if contains(out.GuardianUserIDs, "g1") {
		t.Fatal("g1 must be removed")
	}
	if !contains(out.GuardianUserIDs, "g2") {
		t.Fatal("g2 must remain")
	}
	// Idempotent: unlinking a non-linked guardian is a no-op.
	if _, err := svc.UnlinkGuardian(ctx, "bursar-1", st.ID, "g1"); err != nil {
		t.Fatalf("idempotent unlink: %v", err)
	}
}

// ── minor_flag defaults true ─────────────────────────────────────────────────────

func TestMinorFlagDefaultsTrue(t *testing.T) {
	f := newFakeStore()
	svc := NewServiceWithStore(f)
	ctx := context.Background()
	st, err := svc.CreateStudent(ctx, "bursar-1", "school-1", CreateStudentRequest{AdmissionNumber: "ADM-1"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if !st.MinorFlag {
		t.Fatal("minor_flag must default to true (build-spec §2)")
	}
	adult := false
	st2, err := svc.CreateStudent(ctx, "bursar-1", "school-1", CreateStudentRequest{AdmissionNumber: "ADM-2", MinorFlag: &adult})
	if err != nil {
		t.Fatalf("create adult: %v", err)
	}
	if st2.MinorFlag {
		t.Fatal("explicit minor_flag=false must be honoured")
	}
}

// ── bulk import validation rejects bad rows ──────────────────────────────────────

func TestBulkImport_ValidatesAndRejectsBadRows(t *testing.T) {
	f := newFakeStore()
	id := newFakeIdentity("guardian-ok")
	svc := NewServiceWithDeps(f, id)
	ctx := context.Background()

	// Seed an existing student so a CSV row collides with the DB.
	if _, err := svc.CreateStudent(ctx, "bursar-1", "school-1", CreateStudentRequest{AdmissionNumber: "EXISTING-1"}); err != nil {
		t.Fatalf("seed: %v", err)
	}

	csv := strings.Join([]string{
		"admission_number,class_id,student_user_id,guardian_user_ids,minor_flag",
		"NEW-1,class-a,,guardian-ok,true",       // valid
		",class-a,,,true",                        // invalid: missing admission_number
		"EXISTING-1,class-a,,,true",              // invalid: admission_number already taken in DB
		"NEW-2,class-a,,ghost-guardian,true",     // invalid: unknown guardian identity
		"DUP-1,class-a,,,true",                   // valid (first occurrence)
		"DUP-1,class-b,,,true",                   // invalid: duplicate within batch
	}, "\n")

	preview, err := svc.ParseAndValidateImport(ctx, "school-1", csv)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}

	// 6 data rows total.
	if len(preview.Rows) != 6 {
		t.Fatalf("expected 6 rows, got %d", len(preview.Rows))
	}
	// Valid: NEW-1 and the first DUP-1 = 2.
	if preview.ValidCount != 2 {
		t.Fatalf("expected 2 valid rows, got %d", preview.ValidCount)
	}
	if preview.ErrorCount != 4 {
		t.Fatalf("expected 4 error rows, got %d", preview.ErrorCount)
	}

	byErr := map[string]int{}
	for _, r := range preview.Rows {
		if !r.Valid {
			byErr[r.Error]++
		}
	}
	if byErr["missing_admission_number"] != 1 {
		t.Fatalf("expected 1 missing_admission_number, got %d", byErr["missing_admission_number"])
	}
	if byErr["admission_number_taken"] != 1 {
		t.Fatalf("expected 1 admission_number_taken, got %d", byErr["admission_number_taken"])
	}
	if byErr["unknown_guardian_identity"] != 1 {
		t.Fatalf("expected 1 unknown_guardian_identity, got %d", byErr["unknown_guardian_identity"])
	}
	if byErr["duplicate_admission_number_in_batch"] != 1 {
		t.Fatalf("expected 1 duplicate_admission_number_in_batch, got %d", byErr["duplicate_admission_number_in_batch"])
	}

	// Preview must not have written anything (approval queue: pending until approved).
	if got, _ := svc.ListStudents(ctx, "school-1", ""); len(got) != 1 {
		t.Fatalf("preview must not create students; expected 1 (the seed), got %d", len(got))
	}

	// Approving the preview creates ONLY the valid rows.
	created, skipped, err := svc.ApproveImport(ctx, "bursar-1", "school-1", preview)
	if err != nil {
		t.Fatalf("approve: %v", err)
	}
	if len(created) != 2 {
		t.Fatalf("expected 2 created, got %d", len(created))
	}
	if len(skipped) != 4 {
		t.Fatalf("expected 4 skipped, got %d", len(skipped))
	}
	if got, _ := svc.ListStudents(ctx, "school-1", ""); len(got) != 3 { // seed + 2 approved
		t.Fatalf("expected 3 students after approval, got %d", len(got))
	}
}
