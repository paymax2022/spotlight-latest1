package feesschool

import (
	"context"
	"errors"
	"testing"
)

// These tests are PURE — no DB, no pgx. The pgx-backed Repository is replaced by an
// in-memory fakeStore (mirroring edupay_test.go / schools_test.go isolation), so the
// verification-tier guard, ownership fail-closed checks, and SF-10 export gate are all
// exercised without a live DB.

// ── in-memory fake Store ─────────────────────────────────────────────────────────

type fakeStore struct {
	schools map[string]*School
	roster  map[string][]ExportStudent
	fees    map[string][]ExportFee
	audits  []string // action log for assertions
	seq     int
}

func newFakeStore() *fakeStore {
	return &fakeStore{schools: map[string]*School{}, roster: map[string][]ExportStudent{}, fees: map[string][]ExportFee{}}
}

func (f *fakeStore) Insert(_ context.Context, s School) (*School, error) {
	f.seq++
	s.ID = "school-" + itoa(f.seq)
	s.Status = "active"
	s.VerificationTier = TierUnverified
	cp := s
	f.schools[s.ID] = &cp
	out := cp
	return &out, nil
}

func (f *fakeStore) Get(_ context.Context, id string) (*School, error) {
	s, ok := f.schools[id]
	if !ok {
		return nil, ErrNotFound
	}
	out := *s
	return &out, nil
}

func (f *fakeStore) List(_ context.Context, ownerUserID string) ([]School, error) {
	out := []School{}
	for _, s := range f.schools {
		if ownerUserID == "" || deref(s.OwnerUserID) == ownerUserID {
			out = append(out, *s)
		}
	}
	return out, nil
}

func (f *fakeStore) Update(_ context.Context, id string, req UpdateSchoolRequest) (*School, error) {
	s, ok := f.schools[id]
	if !ok {
		return nil, ErrNotFound
	}
	if req.Name != "" {
		s.Name = req.Name
	}
	out := *s
	return &out, nil
}

func (f *fakeStore) SetVerificationTier(_ context.Context, id string, from, to VerificationTier) (*School, error) {
	s, ok := f.schools[id]
	if !ok {
		return nil, ErrNotFound
	}
	if s.VerificationTier != from {
		return nil, ErrIllegalTierMove // concurrent-move guard
	}
	s.VerificationTier = to
	out := *s
	return &out, nil
}

func (f *fakeStore) ExportRoster(_ context.Context, schoolID string) ([]ExportStudent, error) {
	return f.roster[schoolID], nil
}

func (f *fakeStore) ExportFees(_ context.Context, schoolID string) ([]ExportFee, error) {
	return f.fees[schoolID], nil
}

func (f *fakeStore) WriteAudit(_ context.Context, _, action, _, _, _ string, _ any) error {
	f.audits = append(f.audits, action)
	return nil
}

// itoa is a tiny dependency-free int→string for fake ids.
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

// ── Verification-tier state machine: legal + illegal (pure) ──────────────────────

func TestVerifyTransition_LegalMoves(t *testing.T) {
	legal := [][2]VerificationTier{
		{TierUnverified, TierPending},
		{TierPending, TierVerified},
		{TierVerified, TierPremium},
		{TierPremium, TierVerified},   // admin demotion
		{TierVerified, TierPending},   // re-review
		{TierPending, TierUnverified}, // reject
	}
	for _, tr := range legal {
		got, err := VerifyTransition(tr[0], tr[1])
		if err != nil {
			t.Errorf("expected %s→%s legal, got err %v", tr[0], tr[1], err)
		}
		if got != tr[1] {
			t.Errorf("expected target %s, got %s", tr[1], got)
		}
	}
}

func TestVerifyTransition_IllegalSkipsAndUnknown(t *testing.T) {
	// Forward skips are illegal — review must pass through `pending`.
	illegal := [][2]VerificationTier{
		{TierUnverified, TierVerified}, // skip pending
		{TierUnverified, TierPremium},  // skip everything
		{TierPending, TierPremium},     // skip verified
		{TierUnverified, TierUnverified},
	}
	for _, tr := range illegal {
		if _, err := VerifyTransition(tr[0], tr[1]); !errors.Is(err, ErrIllegalTierMove) {
			t.Errorf("expected %s→%s to be ErrIllegalTierMove, got %v", tr[0], tr[1], err)
		}
	}
	// Unknown tier ⇒ ErrInvalidTier.
	if _, err := VerifyTransition(TierUnverified, VerificationTier("gold")); !errors.Is(err, ErrInvalidTier) {
		t.Errorf("expected ErrInvalidTier for unknown tier, got %v", err)
	}
}

// ── Service.Verify: legal transition succeeds; invalid rejected ──────────────────

func TestServiceVerify_LegalTransitionSucceeds(t *testing.T) {
	fs := newFakeStore()
	svc := NewServiceWithStore(fs)
	ctx := context.Background()

	sch, err := svc.Create(ctx, "owner-1", CreateSchoolRequest{Name: "Bright Stars"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if sch.VerificationTier != TierUnverified {
		t.Fatalf("new school must start unverified, got %s", sch.VerificationTier)
	}
	// unverified → pending → verified (two legal admin steps).
	if _, err := svc.Verify(ctx, "admin-1", sch.ID, TierPending); err != nil {
		t.Fatalf("verify→pending: %v", err)
	}
	out, err := svc.Verify(ctx, "admin-1", sch.ID, TierVerified)
	if err != nil {
		t.Fatalf("verify→verified: %v", err)
	}
	if out.VerificationTier != TierVerified {
		t.Fatalf("expected verified, got %s", out.VerificationTier)
	}
}

func TestServiceVerify_IllegalSkipRejected(t *testing.T) {
	fs := newFakeStore()
	svc := NewServiceWithStore(fs)
	ctx := context.Background()
	sch, _ := svc.Create(ctx, "owner-1", CreateSchoolRequest{Name: "Bright Stars"})

	// Attempt to jump straight to premium (skips pending+verified) — MUST be refused.
	if _, err := svc.Verify(ctx, "admin-1", sch.ID, TierPremium); !errors.Is(err, ErrIllegalTierMove) {
		t.Fatalf("expected illegal-tier-move on skip, got %v", err)
	}
	// Unknown tier value — MUST be refused.
	if _, err := svc.Verify(ctx, "admin-1", sch.ID, VerificationTier("diamond")); !errors.Is(err, ErrInvalidTier) {
		t.Fatalf("expected invalid-tier, got %v", err)
	}
	// Tier is unchanged after the rejected attempts.
	cur, _ := svc.Get(ctx, sch.ID)
	if cur.VerificationTier != TierUnverified {
		t.Fatalf("tier must be unchanged after rejected verify, got %s", cur.VerificationTier)
	}
}

func TestServiceVerify_MissingActorRejected(t *testing.T) {
	svc := NewServiceWithStore(newFakeStore())
	if _, err := svc.Verify(context.Background(), "", "school-1", TierPending); !errors.Is(err, ErrUnauthenticated) {
		t.Fatalf("expected unauthenticated for empty admin id, got %v", err)
	}
}

// ── Create sets owner = caller and requires a name ───────────────────────────────

func TestServiceCreate_OwnerIsCaller(t *testing.T) {
	svc := NewServiceWithStore(newFakeStore())
	ctx := context.Background()
	sch, err := svc.Create(ctx, "owner-42", CreateSchoolRequest{Name: "Unity Academy"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if deref(sch.OwnerUserID) != "owner-42" {
		t.Fatalf("owner_user_id must be the caller, got %q", deref(sch.OwnerUserID))
	}
}

func TestServiceCreate_RejectsEmptyName(t *testing.T) {
	svc := NewServiceWithStore(newFakeStore())
	if _, err := svc.Create(context.Background(), "owner-1", CreateSchoolRequest{Name: "  "}); !errors.Is(err, ErrMissingName) {
		t.Fatalf("expected missing_name, got %v", err)
	}
	if _, err := svc.Create(context.Background(), "", CreateSchoolRequest{Name: "x"}); !errors.Is(err, ErrUnauthenticated) {
		t.Fatalf("expected unauthenticated for empty owner, got %v", err)
	}
}

// ── SF-10 export: verified-only + owner-only, fail-closed ────────────────────────

func TestServiceExport_RequiresVerifiedAndOwner(t *testing.T) {
	fs := newFakeStore()
	svc := NewServiceWithStore(fs)
	ctx := context.Background()
	sch, _ := svc.Create(ctx, "owner-1", CreateSchoolRequest{Name: "Bright Stars"})
	fs.roster[sch.ID] = []ExportStudent{{StudentID: "stu-1", Status: "active", MinorFlag: true}}
	fs.fees[sch.ID] = []ExportFee{{FeeScheduleID: "fee-1", Name: "Term 1", AmountMinor: 5000000, Currency: "NGN"}}

	// Unverified school ⇒ export refused (SF-10 requires verified tier).
	if _, err := svc.Export(ctx, "owner-1", sch.ID); !errors.Is(err, ErrSchoolNotVerified) {
		t.Fatalf("expected school_not_verified for unverified school, got %v", err)
	}
	// Promote to verified.
	_, _ = svc.Verify(ctx, "admin-1", sch.ID, TierPending)
	_, _ = svc.Verify(ctx, "admin-1", sch.ID, TierVerified)

	// Non-owner ⇒ forbidden even when verified (fail-closed).
	if _, err := svc.Export(ctx, "intruder", sch.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("expected forbidden for non-owner, got %v", err)
	}
	// Owner + verified ⇒ export returns roster + fees.
	exp, err := svc.Export(ctx, "owner-1", sch.ID)
	if err != nil {
		t.Fatalf("export: %v", err)
	}
	if len(exp.Roster) != 1 || len(exp.FeeSchedules) != 1 {
		t.Fatalf("expected 1 roster + 1 fee line, got %d/%d", len(exp.Roster), len(exp.FeeSchedules))
	}
	if exp.Tier != TierVerified {
		t.Fatalf("export must report the verified tier, got %s", exp.Tier)
	}
}
