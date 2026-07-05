package doctor

import (
	"context"
	"errors"
	"testing"
	"time"

	"spotlight/backend/internal/health/credential"
)

// ── fakes (no DB) ──

type fakeMDCNStore struct {
	owner      map[string]string // verificationID → doctor user_id
	status     map[string]string // verificationID → status
	docs       map[string]*MDCNDocRef
	accessLog  []string // docID:accessor:basis
	profileSet []string // userID:verification:publish
	matched    map[string]map[string]string
	audits     []string // action
	suspendN   int
	suspendHit int
}

func newFakeStore() *fakeMDCNStore {
	return &fakeMDCNStore{owner: map[string]string{}, status: map[string]string{}, docs: map[string]*MDCNDocRef{}, matched: map[string]map[string]string{}}
}

func (f *fakeMDCNStore) ListPendingMDCN(_ context.Context, _ int) ([]MDCNQueueItem, error) {
	var out []MDCNQueueItem
	for id, st := range f.status {
		if st == "pending" || st == "needs_info" {
			out = append(out, MDCNQueueItem{VerificationID: id, UserID: f.owner[id], Status: st})
		}
	}
	return out, nil
}
func (f *fakeMDCNStore) GetMDCNVerification(_ context.Context, id string) (*MDCNReviewRecord, error) {
	st, ok := f.status[id]
	if !ok {
		return nil, ErrNotFound
	}
	return &MDCNReviewRecord{VerificationID: id, UserID: f.owner[id], DoctorName: "Dr Jane Doe", Status: st, MatchedFields: f.matched[id]}, nil
}
func (f *fakeMDCNStore) PersistMatchedFields(_ context.Context, id string, m map[string]string) error {
	f.matched[id] = m
	return nil
}
func (f *fakeMDCNStore) GetVerificationOwner(_ context.Context, id string) (string, string, error) {
	o, ok := f.owner[id]
	if !ok {
		return "", "", ErrNotFound
	}
	return o, f.status[id], nil
}
func (f *fakeMDCNStore) DecideMDCN(_ context.Context, id, from, to, _ , _ string, _ *time.Time, _ *string, _ *string) (bool, error) {
	if f.status[id] != from {
		return false, nil
	}
	f.status[id] = to
	return true, nil
}
func (f *fakeMDCNStore) SetProfileVerification(_ context.Context, userID, verification string, publish *bool) error {
	p := "nil"
	if publish != nil {
		if *publish {
			p = "true"
		} else {
			p = "false"
		}
	}
	f.profileSet = append(f.profileSet, userID+":"+verification+":"+p)
	return nil
}
func (f *fakeMDCNStore) GetVerificationDoc(_ context.Context, docID string) (*MDCNDocRef, error) {
	d, ok := f.docs[docID]
	if !ok {
		return nil, ErrNotFound
	}
	return d, nil
}
func (f *fakeMDCNStore) LogVerificationDocAccess(_ context.Context, docID, accessorID, basis string) error {
	f.accessLog = append(f.accessLog, docID+":"+accessorID+":"+basis)
	return nil
}
func (f *fakeMDCNStore) SuspendExpiredDoctorLicences(_ context.Context, _ time.Time) (int, error) {
	f.suspendHit++
	return f.suspendN, nil
}
func (f *fakeMDCNStore) InsertAudit(_ context.Context, _, action, _, _, _ string, _ any) error {
	f.audits = append(f.audits, action)
	return nil
}
func (f *fakeMDCNStore) hasAudit(a string) bool {
	for _, x := range f.audits {
		if x == a {
			return true
		}
	}
	return false
}

type fakeIdentity struct{ snap credential.IdentitySnapshot }

func (f fakeIdentity) Snapshot(context.Context, string) (credential.IdentitySnapshot, error) {
	return f.snap, nil
}

type fakeSched struct{ calls int }

func (f *fakeSched) ScheduleAt(context.Context, string, string, string, time.Time, map[string]any) error {
	f.calls++
	return nil
}

const (
	docOwner = "doctor-1"
	verifID  = "verif-1"
	reviewer = "reviewer-1"
)

func newSvc(store *fakeMDCNStore, snapName string, sched *fakeSched) *MDCNReviewService {
	return NewMDCNReviewService(store, credential.NewMDCNAdapter(),
		fakeIdentity{snap: credential.IdentitySnapshot{FullName: snapName, KYCTier: 2}}, nil, sched)
}

// ── 1. status SM ──

func TestDoctorVerifSM(t *testing.T) {
	allow := [][2]string{{"pending", "approved"}, {"pending", "needs_info"}, {"pending", "rejected"}, {"needs_info", "approved"}, {"needs_info", "rejected"}}
	for _, c := range allow {
		if !canDoctorVerif(c[0], c[1]) {
			t.Errorf("expected %s→%s allowed", c[0], c[1])
		}
	}
	reject := [][2]string{{"approved", "rejected"}, {"rejected", "approved"}, {"approved", "approved"}, {"needs_info", "pending"}, {"pending", "pending"}}
	for _, c := range reject {
		if canDoctorVerif(c[0], c[1]) {
			t.Errorf("expected %s→%s rejected", c[0], c[1])
		}
	}
}

// ── 2-6. Decide ──

func setup(t *testing.T) (*MDCNReviewService, *fakeMDCNStore, *fakeSched) {
	t.Helper()
	store := newFakeStore()
	store.owner[verifID] = docOwner
	store.status[verifID] = "pending"
	sched := &fakeSched{}
	return newSvc(store, "Dr Jane Doe", sched), store, sched
}

func medical() *string { s := "medical"; return &s }
func expiry() *time.Time { t := time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC); return &t }

func TestDecide_NoSelfApproval(t *testing.T) {
	svc, _, _ := setup(t)
	_, err := svc.Decide(context.Background(), docOwner, verifID, MDCNDecision{Action: "approve", LicenceExpiry: expiry(), Discipline: medical()})
	if !errors.Is(err, ErrReviewForbidden) {
		t.Fatalf("expected ErrReviewForbidden on self-approval, got %v", err)
	}
}

func TestDecide_ApproveRequiresExpiryAndDiscipline(t *testing.T) {
	svc, _, _ := setup(t)
	if _, err := svc.Decide(context.Background(), reviewer, verifID, MDCNDecision{Action: "approve", Discipline: medical()}); err == nil {
		t.Error("expected error when licence_expiry missing")
	}
	if _, err := svc.Decide(context.Background(), reviewer, verifID, MDCNDecision{Action: "approve", LicenceExpiry: expiry()}); err == nil {
		t.Error("expected error when discipline missing")
	}
}

func TestDecide_ApproveGrantsDiscoverability(t *testing.T) {
	svc, store, sched := setup(t)
	rec, err := svc.Decide(context.Background(), reviewer, verifID, MDCNDecision{Action: "approve", LicenceExpiry: expiry(), Discipline: medical()})
	if err != nil {
		t.Fatalf("approve: %v", err)
	}
	if rec.Status != "approved" {
		t.Errorf("status=%s want approved", rec.Status)
	}
	if len(store.profileSet) != 1 || store.profileSet[0] != docOwner+":approved:true" {
		t.Errorf("expected discoverability grant (publish true), got %v", store.profileSet)
	}
	if sched.calls != 1 {
		t.Errorf("expected one licence-expiry sweep scheduled, got %d", sched.calls)
	}
	if !store.hasAudit("doctor.mdcn.verification.decided") {
		t.Error("expected decision audit (HL-12)")
	}
}

func TestDecide_Idempotent(t *testing.T) {
	svc, _, sched := setup(t)
	if _, err := svc.Decide(context.Background(), reviewer, verifID, MDCNDecision{Action: "approve", LicenceExpiry: expiry(), Discipline: medical()}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Decide(context.Background(), reviewer, verifID, MDCNDecision{Action: "approve", LicenceExpiry: expiry(), Discipline: medical()}); err != nil {
		t.Fatalf("expected idempotent no-op, got %v", err)
	}
	if sched.calls != 1 {
		t.Errorf("idempotent approve scheduled the sweep twice: %d", sched.calls)
	}
}

func TestDecide_IllegalTransition(t *testing.T) {
	svc, store, _ := setup(t)
	store.status[verifID] = "approved"
	if _, err := svc.Decide(context.Background(), reviewer, verifID, MDCNDecision{Action: "reject", Notes: "x"}); !errors.Is(err, ErrReviewIllegalTransition) {
		t.Fatalf("expected ErrReviewIllegalTransition (approved→rejected), got %v", err)
	}
}

// ── 7. licence-expiry auto-suspend ──

func TestRunLicenceSweep(t *testing.T) {
	svc, store, _ := setup(t)
	store.suspendN = 3
	n, err := svc.RunLicenceSweep(context.Background(), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if n != 3 || store.suspendHit != 1 {
		t.Errorf("expected sweep once returning 3, got n=%d hit=%d", n, store.suspendHit)
	}
	if !store.hasAudit("doctor.mdcn.licence.auto_suspended") {
		t.Error("expected auto-suspend audit (HL-12)")
	}
}

// ── 8. NDPA doc access ──

func TestDocSignedURL_AccessLoggedAndGated(t *testing.T) {
	svc, store, _ := setup(t)
	store.docs["d1"] = &MDCNDocRef{ID: "d1", UserID: docOwner, FileKey: "doctor/x/doc/abc", DocType: "mdcn_certificate"}

	if _, err := svc.DocSignedURL(context.Background(), docOwner, "d1", false); err != nil {
		t.Fatalf("owner read: %v", err)
	}
	if _, err := svc.DocSignedURL(context.Background(), reviewer, "d1", true); err != nil {
		t.Fatalf("reviewer read: %v", err)
	}
	if _, err := svc.DocSignedURL(context.Background(), "stranger", "d1", false); !errors.Is(err, ErrReviewForbidden) {
		t.Fatalf("expected ErrReviewForbidden for stranger, got %v", err)
	}
	if len(store.accessLog) != 2 || store.accessLog[0] != "d1:"+docOwner+":OWNER" || store.accessLog[1] != "d1:"+reviewer+":REVIEWER" {
		t.Errorf("access-log wrong: %v", store.accessLog)
	}
	if !store.hasAudit("doctor.mdcn.document.accessed") {
		t.Error("expected document-access audit (HL-12/NDPA)")
	}
}

// ── 9. identity cross-check surfaced ──

func TestGetForReview_IdentityFlag(t *testing.T) {
	store := newFakeStore()
	store.owner[verifID] = docOwner
	store.status[verifID] = "pending"
	// KYC name differs from the doctor profile name → hard mismatch flag.
	svc := newSvc(store, "Totally Different Person", &fakeSched{})
	rec, err := svc.GetForReview(context.Background(), verifID)
	if err != nil {
		t.Fatal(err)
	}
	if !credential.HasIdentityFlag(rec.MatchedFields) {
		t.Errorf("expected identity mismatch flag, got %v", rec.MatchedFields)
	}
	if store.matched[verifID] == nil {
		t.Error("expected matched fields persisted for the queue")
	}
}
