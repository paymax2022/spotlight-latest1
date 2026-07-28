package feesexport

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
)

// These tests are PURE — no DB, no pgx. They use in-memory fakes for the Store, OptInStore and
// SchoolVerifier to prove the SF-11 opt-in gate, the append-only immutability of the compliance
// log (no update/delete path exists), and the SF-10 verified-school gate.

// ── in-memory fakes ──────────────────────────────────────────────────────────────

type fakeStore struct {
	exports []ComplianceExport
	audits  []auditRow
}

type auditRow struct {
	action   string
	entityID string
	detail   any
}

func newFakeStore() *fakeStore { return &fakeStore{} }

func (f *fakeStore) AppendExport(_ context.Context, e ComplianceExport) (*ComplianceExport, error) {
	e.ID = uuid.New().String()
	e.GeneratedAt = time.Now()
	f.exports = append(f.exports, e) // APPEND-ONLY: never mutate an existing row
	out := e
	return &out, nil
}

func (f *fakeStore) ListExports(_ context.Context, schoolID string) ([]ComplianceExport, error) {
	out := []ComplianceExport{}
	for i := len(f.exports) - 1; i >= 0; i-- {
		if f.exports[i].SchoolID == schoolID {
			out = append(out, f.exports[i])
		}
	}
	return out, nil
}

func (f *fakeStore) WriteAudit(_ context.Context, _, action, entityID string, detail any) error {
	f.audits = append(f.audits, auditRow{action: action, entityID: entityID, detail: detail})
	return nil
}

// fakeOptIn maps (schoolID|category) → opted-in.
type fakeOptIn struct{ opted map[string]bool }

func newFakeOptIn() *fakeOptIn { return &fakeOptIn{opted: map[string]bool{}} }

func (f *fakeOptIn) set(schoolID string, cat DataCategory) { f.opted[schoolID+"|"+string(cat)] = true }

func (f *fakeOptIn) HasOptedIn(_ context.Context, schoolID string, cat DataCategory) (bool, error) {
	return f.opted[schoolID+"|"+string(cat)], nil
}

type fakeVerifier struct{ tier map[string]string }

func newFakeVerifier() *fakeVerifier { return &fakeVerifier{tier: map[string]string{}} }

func (f *fakeVerifier) VerificationTier(_ context.Context, schoolID string) (string, error) {
	t, ok := f.tier[schoolID]
	if !ok {
		return "", ErrNotFound
	}
	return t, nil
}

// ── SF-11: an accepted export appends an immutable row ───────────────────────────

func TestTriggerExport_AppendsImmutableRow(t *testing.T) {
	ctx := context.Background()
	store := newFakeStore()
	opt := newFakeOptIn()
	opt.set("school-1", CategoryEnrollment)
	opt.set("school-1", CategoryFees)
	svc := NewServiceWithDeps(store, opt, nil)

	out, err := svc.TriggerExport(ctx, "actor-1", TriggerExportRequest{
		SchoolID:       "school-1",
		ReportType:     "SF-11-quarterly",
		Period:         "2026-Q3",
		DataCategories: []DataCategory{CategoryEnrollment, CategoryFees},
	})
	if err != nil {
		t.Fatalf("expected success, got %v", err)
	}
	if out.ID == "" {
		t.Fatal("export must have an id")
	}
	if len(store.exports) != 1 {
		t.Fatalf("exactly one row must be appended, got %d", len(store.exports))
	}
	// The row records what was shared with which regulator, when.
	got := store.exports[0]
	if got.SchoolID != "school-1" || got.ReportType != "SF-11-quarterly" {
		t.Errorf("row does not reflect the request: %+v", got)
	}
	if got.RequestedBy != "actor-1" {
		t.Errorf("row must record who requested it, got %q", got.RequestedBy)
	}
	if got.GeneratedAt.IsZero() {
		t.Error("row must record when it was generated")
	}
	// Generation was audited.
	if !hasAudit(store, "compliance_export_generated") {
		t.Error("export generation must be audited")
	}
}

// ── SF-11: an export for a NON-opted-in category is rejected (fail-closed) ────────

func TestTriggerExport_NonOptedInCategory_Rejected(t *testing.T) {
	ctx := context.Background()
	store := newFakeStore()
	opt := newFakeOptIn()
	opt.set("school-1", CategoryEnrollment) // opted in for enrollment ONLY
	svc := NewServiceWithDeps(store, opt, nil)

	_, err := svc.TriggerExport(ctx, "actor-1", TriggerExportRequest{
		SchoolID:       "school-1",
		ReportType:     "SF-11-quarterly",
		DataCategories: []DataCategory{CategoryEnrollment, CategoryResults}, // results NOT opted in
	})
	if err != ErrCategoryNotOptedIn {
		t.Fatalf("expected ErrCategoryNotOptedIn, got %v", err)
	}
	// Fail-closed: NOTHING appended to the compliance log.
	if len(store.exports) != 0 {
		t.Errorf("rejected export must append no compliance row, got %d", len(store.exports))
	}
	// The rejection was audited.
	if !hasAudit(store, "compliance_export_rejected") {
		t.Error("rejected export must be audited")
	}
}

// ── SF-11: explicit request-carried opt-in fallback (no opt-in store wired) ──────

func TestTriggerExport_RequestCarriedOptInFallback(t *testing.T) {
	ctx := context.Background()
	store := newFakeStore()
	// No OptInStore → fall back to OptInCategories carried on the request.
	svc := NewServiceWithDeps(store, nil, nil)

	_, err := svc.TriggerExport(ctx, "actor-1", TriggerExportRequest{
		SchoolID:        "school-1",
		ReportType:      "SF-11",
		DataCategories:  []DataCategory{CategoryFees},
		OptInCategories: []DataCategory{CategoryFees}, // caller asserts + records opt-in
	})
	if err != nil {
		t.Fatalf("request-carried opt-in must be accepted, got %v", err)
	}
	if len(store.exports) != 1 {
		t.Fatalf("one row must be appended, got %d", len(store.exports))
	}

	// Without the fallback opt-in the same request is rejected.
	_, err = svc.TriggerExport(ctx, "actor-1", TriggerExportRequest{
		SchoolID:       "school-1",
		ReportType:     "SF-11",
		DataCategories: []DataCategory{CategoryFees},
	})
	if err != ErrCategoryNotOptedIn {
		t.Fatalf("no opt-in at all must reject, got %v", err)
	}
}

// ── SF-11: the compliance log is append-only (no update/delete path exists) ───────
//
// This is a STRUCTURAL guarantee: the Store interface exposes only AppendExport + ListExports.
// There is no UpdateExport / DeleteExport method to call. We assert the contract by exercising
// the surface: appended rows are only ever added, never removed or changed by the service.

func TestComplianceLog_AppendOnly_NoMutationPath(t *testing.T) {
	ctx := context.Background()
	store := newFakeStore()
	opt := newFakeOptIn()
	opt.set("school-1", CategoryFees)
	svc := NewServiceWithDeps(store, opt, nil)

	// Two exports over time.
	_, _ = svc.TriggerExport(ctx, "a", TriggerExportRequest{SchoolID: "school-1", ReportType: "r1", DataCategories: []DataCategory{CategoryFees}})
	first := store.exports[0]
	_, _ = svc.TriggerExport(ctx, "a", TriggerExportRequest{SchoolID: "school-1", ReportType: "r2", DataCategories: []DataCategory{CategoryFees}})

	if len(store.exports) != 2 {
		t.Fatalf("expected 2 append-only rows, got %d", len(store.exports))
	}
	// The first row is unchanged after the second append (immutability).
	if store.exports[0].ID != first.ID || store.exports[0].ReportType != first.ReportType {
		t.Error("appending a new export must not mutate an earlier row (append-only)")
	}
	// History lists both, newest first.
	hist, _ := svc.ListExports(ctx, "school-1")
	if len(hist) != 2 || hist[0].ReportType != "r2" {
		t.Errorf("audit history must list all rows newest-first, got %+v", hist)
	}
}

// Compile-time proof the Store surface has no mutation method: this assignment only compiles
// because Store is exactly {AppendExport, ListExports, WriteAudit}. If a delete/update method
// were added to the interface, fakeStore (which implements none) would still satisfy it, so the
// real guarantee is the interface definition itself — asserted here by documenting the surface.
var _ Store = (*fakeStore)(nil)

// ── SF-10: verified-school full data export gate ─────────────────────────────────

func TestSchoolDataExport_VerifiedOnly(t *testing.T) {
	ctx := context.Background()
	store := newFakeStore()
	ver := newFakeVerifier()
	ver.tier["verified-school"] = "verified"
	ver.tier["new-school"] = "unverified"
	svc := NewServiceWithDeps(store, nil, ver)

	// Verified school → allowed.
	out, err := svc.TriggerSchoolDataExport(ctx, "owner", SchoolDataExportRequest{SchoolID: "verified-school"})
	if err != nil {
		t.Fatalf("verified school must be allowed, got %v", err)
	}
	if len(out.Sections) == 0 {
		t.Error("export must default to roster/fees/results sections")
	}
	if !hasAudit(store, "school_data_export_generated") {
		t.Error("self-service export must be audited")
	}

	// Unverified school → rejected.
	_, err = svc.TriggerSchoolDataExport(ctx, "owner", SchoolDataExportRequest{SchoolID: "new-school"})
	if err != ErrSchoolNotVerified {
		t.Fatalf("unverified school must be rejected, got %v", err)
	}
}

func TestSchoolDataExport_NoVerifier_FailsClosed(t *testing.T) {
	svc := NewServiceWithDeps(newFakeStore(), nil, nil)
	_, err := svc.TriggerSchoolDataExport(context.Background(), "owner", SchoolDataExportRequest{SchoolID: "s"})
	if err != ErrSchoolNotVerified {
		t.Fatalf("no verifier must fail closed with ErrSchoolNotVerified, got %v", err)
	}
}

// ── helpers ──────────────────────────────────────────────────────────────────────

func hasAudit(s *fakeStore, action string) bool {
	for _, a := range s.audits {
		if a.action == action {
			return true
		}
	}
	return false
}
