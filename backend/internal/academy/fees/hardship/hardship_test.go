package feeshardship

import (
	"context"
	"errors"
	"testing"

	feesstatemachine "spotlight/backend/internal/academy/fees/statemachine"
)

// These tests are PURE — no DB, no pgx. The pgx-backed Repository is replaced by an in-memory
// fakeStore, the invoice domain by a fakeInvoiceService, and reviewer authorization by a
// fakeAuthorizer (mirroring feesschool/school_test.go isolation). The SF-9 human-review
// invariant is exercised without a live DB: submission never approves/denies/freezes; only a
// human Approve freezes the invoice (overdue→frozen via the state machine); Deny does not;
// and only an authorized reviewer may approve/deny (fail-closed).

// ── in-memory fake Store ─────────────────────────────────────────────────────────

type fakeStore struct {
	reqs   map[string]*HardshipRequest
	audits []string
	seq    int
}

func newFakeStore() *fakeStore {
	return &fakeStore{reqs: map[string]*HardshipRequest{}}
}

func (f *fakeStore) Insert(_ context.Context, r HardshipRequest) (*HardshipRequest, error) {
	f.seq++
	r.ID = "hr-" + itoa(f.seq)
	r.Status = StatusPending // the real store forces 'pending' — mirror that here
	r.ReviewedBy, r.ReviewedAt, r.ReviewNote = nil, nil, nil
	cp := r
	f.reqs[r.ID] = &cp
	out := cp
	return &out, nil
}

func (f *fakeStore) Get(_ context.Context, id string) (*HardshipRequest, error) {
	r, ok := f.reqs[id]
	if !ok {
		return nil, ErrNotFound
	}
	out := *r
	return &out, nil
}

func (f *fakeStore) ListPendingBySchool(_ context.Context, _ string) ([]HardshipRequest, error) {
	out := []HardshipRequest{}
	for _, r := range f.reqs {
		if r.Status == StatusPending {
			out = append(out, *r)
		}
	}
	return out, nil
}

func (f *fakeStore) SetReviewed(_ context.Context, id, reviewerID string, status RequestStatus, note string) (*HardshipRequest, error) {
	r, ok := f.reqs[id]
	if !ok {
		return nil, ErrNotFound
	}
	if r.Status != StatusPending {
		return nil, ErrAlreadyReviewed // pending-guard: no double-review
	}
	rid := reviewerID
	n := note
	r.Status = status
	r.ReviewedBy = &rid
	if n != "" {
		r.ReviewNote = &n
	}
	out := *r
	return &out, nil
}

func (f *fakeStore) WriteAudit(_ context.Context, _, action, _, _, _ string, _ any) error {
	f.audits = append(f.audits, action)
	return nil
}

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

// ── in-memory fake InvoiceFreezer ────────────────────────────────────────────────

type fakeInvoiceService struct {
	status      feesstatemachine.InvoiceState
	freezeCalls int
	frozen      bool
}

func (f *fakeInvoiceService) CurrentStatus(_ context.Context, _ string) (feesstatemachine.InvoiceState, error) {
	return f.status, nil
}

func (f *fakeInvoiceService) Freeze(_ context.Context, _, _ string) (feesstatemachine.InvoiceState, error) {
	// Apply the real guarded transition so the fake can't drift from the state machine.
	to, err := feesstatemachine.InvoiceTransition(f.status, feesstatemachine.EvInvoiceFreeze)
	if err != nil {
		return f.status, err
	}
	f.freezeCalls++
	f.status = to
	f.frozen = true
	return to, nil
}

// ── in-memory fake ReviewerAuthorizer ────────────────────────────────────────────

type fakeAuthorizer struct{ allow bool }

func (f *fakeAuthorizer) CanReview(_ context.Context, _, _ string) (bool, error) {
	return f.allow, nil
}

// ── helpers ──────────────────────────────────────────────────────────────────────

func newSubmittedRequest(t *testing.T, svc *Service) *HardshipRequest {
	t.Helper()
	r, err := svc.SubmitRequest(context.Background(), "guardian-1", SubmitRequestRequest{
		InvoiceID: "inv-1", Reason: "lost job",
	})
	if err != nil {
		t.Fatalf("submit: %v", err)
	}
	return r
}

// ── SF-9 (REQUIRED): submission never auto-approves/denies/freezes ───────────────

func TestSubmit_LeavesPendingAndInvoiceUnchanged_SF9(t *testing.T) {
	fs := newFakeStore()
	inv := &fakeInvoiceService{status: feesstatemachine.InvoiceOverdue}
	svc := NewServiceWithDeps(fs, inv, &fakeAuthorizer{allow: true})
	ctx := context.Background()

	r := newSubmittedRequest(t, svc)

	// Request must be pending — never a terminal status on submission.
	if r.Status != StatusPending {
		t.Fatalf("submission must leave request pending, got %s", r.Status)
	}
	if r.ReviewedBy != nil || r.ReviewedAt != nil {
		t.Fatalf("submission must not set reviewer fields, got reviewedBy=%v", r.ReviewedBy)
	}
	// Re-read from the store to be sure nothing else advanced it.
	got, _ := svc.Get(ctx, r.ID)
	if got.Status != StatusPending {
		t.Fatalf("stored request must stay pending, got %s", got.Status)
	}
	// No terminal transition happened on the INVOICE either: Freeze was never called and the
	// invoice status is untouched (still overdue).
	if inv.freezeCalls != 0 || inv.frozen {
		t.Fatalf("SF-9 violation: submission froze the invoice (calls=%d frozen=%v)", inv.freezeCalls, inv.frozen)
	}
	if inv.status != feesstatemachine.InvoiceOverdue {
		t.Fatalf("SF-9 violation: submission changed invoice status to %s", inv.status)
	}
}

func TestSubmit_Validation(t *testing.T) {
	svc := NewServiceWithDeps(newFakeStore(), &fakeInvoiceService{}, &fakeAuthorizer{allow: true})
	ctx := context.Background()
	if _, err := svc.SubmitRequest(ctx, "", SubmitRequestRequest{InvoiceID: "inv-1", Reason: "x"}); !errors.Is(err, ErrUnauthenticated) {
		t.Fatalf("expected unauthenticated for empty guardian, got %v", err)
	}
	if _, err := svc.SubmitRequest(ctx, "g", SubmitRequestRequest{InvoiceID: "  ", Reason: "x"}); !errors.Is(err, ErrMissingInvoice) {
		t.Fatalf("expected missing_invoice, got %v", err)
	}
	if _, err := svc.SubmitRequest(ctx, "g", SubmitRequestRequest{InvoiceID: "inv-1", Reason: " "}); !errors.Is(err, ErrMissingReason) {
		t.Fatalf("expected missing_reason, got %v", err)
	}
}

// ── Approve freezes the invoice (overdue→frozen via the state machine) ───────────

func TestApprove_FreezesInvoice(t *testing.T) {
	fs := newFakeStore()
	inv := &fakeInvoiceService{status: feesstatemachine.InvoiceOverdue}
	svc := NewServiceWithDeps(fs, inv, &fakeAuthorizer{allow: true})
	ctx := context.Background()

	r := newSubmittedRequest(t, svc)

	out, err := svc.Approve(ctx, "reviewer-1", r.ID, "verified hardship")
	if err != nil {
		t.Fatalf("approve: %v", err)
	}
	if out.Status != StatusApproved {
		t.Fatalf("expected request approved, got %s", out.Status)
	}
	if deref(out.ReviewedBy) != "reviewer-1" {
		t.Fatalf("expected reviewer recorded, got %v", out.ReviewedBy)
	}
	// The invoice was frozen exactly once, via the state machine (overdue→frozen).
	if inv.freezeCalls != 1 || !inv.frozen {
		t.Fatalf("expected exactly one freeze via state machine, got calls=%d frozen=%v", inv.freezeCalls, inv.frozen)
	}
	if inv.status != feesstatemachine.InvoiceFrozen {
		t.Fatalf("expected invoice frozen, got %s", inv.status)
	}
}

func TestApprove_NonOverdueInvoiceRejectedFailClosed(t *testing.T) {
	fs := newFakeStore()
	// issued (not overdue) — overdue→frozen is NOT a legal edge from here.
	inv := &fakeInvoiceService{status: feesstatemachine.InvoiceIssued}
	svc := NewServiceWithDeps(fs, inv, &fakeAuthorizer{allow: true})
	ctx := context.Background()

	r := newSubmittedRequest(t, svc)
	if _, err := svc.Approve(ctx, "reviewer-1", r.ID, ""); !errors.Is(err, ErrInvoiceNotFreezable) {
		t.Fatalf("expected invoice_not_freezable, got %v", err)
	}
	// Fail-closed: nothing froze, request stays pending.
	if inv.freezeCalls != 0 {
		t.Fatalf("expected no freeze on illegal edge, got %d", inv.freezeCalls)
	}
	got, _ := svc.Get(ctx, r.ID)
	if got.Status != StatusPending {
		t.Fatalf("rejected approval must leave request pending, got %s", got.Status)
	}
}

// ── Deny does NOT freeze the invoice ──────────────────────────────────────────────

func TestDeny_LeavesInvoiceUnchanged(t *testing.T) {
	fs := newFakeStore()
	inv := &fakeInvoiceService{status: feesstatemachine.InvoiceOverdue}
	svc := NewServiceWithDeps(fs, inv, &fakeAuthorizer{allow: true})
	ctx := context.Background()

	r := newSubmittedRequest(t, svc)

	out, err := svc.Deny(ctx, "reviewer-1", r.ID, "insufficient evidence")
	if err != nil {
		t.Fatalf("deny: %v", err)
	}
	if out.Status != StatusDenied {
		t.Fatalf("expected request denied, got %s", out.Status)
	}
	// The invoice must be untouched by a denial.
	if inv.freezeCalls != 0 || inv.frozen {
		t.Fatalf("deny must not freeze the invoice (calls=%d frozen=%v)", inv.freezeCalls, inv.frozen)
	}
	if inv.status != feesstatemachine.InvoiceOverdue {
		t.Fatalf("deny must leave invoice status unchanged, got %s", inv.status)
	}
}

// ── Only an authorized reviewer can approve/deny (fail-closed) ────────────────────

func TestReview_UnauthorizedReviewerRejected(t *testing.T) {
	fs := newFakeStore()
	inv := &fakeInvoiceService{status: feesstatemachine.InvoiceOverdue}
	// Authorizer denies.
	svc := NewServiceWithDeps(fs, inv, &fakeAuthorizer{allow: false})
	ctx := context.Background()

	r := newSubmittedRequest(t, svc)

	if _, err := svc.Approve(ctx, "reviewer-1", r.ID, ""); !errors.Is(err, ErrForbidden) {
		t.Fatalf("expected forbidden for unauthorized approve, got %v", err)
	}
	if _, err := svc.Deny(ctx, "reviewer-1", r.ID, ""); !errors.Is(err, ErrForbidden) {
		t.Fatalf("expected forbidden for unauthorized deny, got %v", err)
	}
	// Nothing changed: no freeze, request still pending.
	if inv.freezeCalls != 0 {
		t.Fatalf("unauthorized review must not freeze the invoice, got %d", inv.freezeCalls)
	}
	got, _ := svc.Get(ctx, r.ID)
	if got.Status != StatusPending {
		t.Fatalf("unauthorized review must leave request pending, got %s", got.Status)
	}
}

func TestReview_MissingReviewerRejected(t *testing.T) {
	svc := NewServiceWithDeps(newFakeStore(), &fakeInvoiceService{}, &fakeAuthorizer{allow: true})
	if _, err := svc.Approve(context.Background(), "", "hr-1", ""); !errors.Is(err, ErrUnauthenticated) {
		t.Fatalf("expected unauthenticated for empty reviewer, got %v", err)
	}
}

// ── Fail-closed when NO authorizer is wired (defense in depth) ────────────────────

func TestReview_NoAuthorizerDeniesAll(t *testing.T) {
	fs := newFakeStore()
	inv := &fakeInvoiceService{status: feesstatemachine.InvoiceOverdue}
	svc := NewServiceWithDeps(fs, inv, nil) // no authorizer injected
	ctx := context.Background()
	r := newSubmittedRequest(t, svc)
	if _, err := svc.Approve(ctx, "reviewer-1", r.ID, ""); !errors.Is(err, ErrForbidden) {
		t.Fatalf("expected forbidden when no authorizer is wired, got %v", err)
	}
}

// ── Double-review is rejected (no re-freeze) ──────────────────────────────────────

func TestApprove_DoubleReviewRejected(t *testing.T) {
	fs := newFakeStore()
	inv := &fakeInvoiceService{status: feesstatemachine.InvoiceOverdue}
	svc := NewServiceWithDeps(fs, inv, &fakeAuthorizer{allow: true})
	ctx := context.Background()

	r := newSubmittedRequest(t, svc)
	if _, err := svc.Approve(ctx, "reviewer-1", r.ID, ""); err != nil {
		t.Fatalf("first approve: %v", err)
	}
	// Second review of the same request must be rejected as already-reviewed.
	if _, err := svc.Deny(ctx, "reviewer-2", r.ID, ""); !errors.Is(err, ErrAlreadyReviewed) {
		t.Fatalf("expected already_reviewed on second review, got %v", err)
	}
	if inv.freezeCalls != 1 {
		t.Fatalf("expected exactly one freeze across double-review, got %d", inv.freezeCalls)
	}
}

// deref returns the pointed-to string or "" for a nil pointer (test-local; the production
// deref lived in repository.go but was removed as unused there).
func deref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
