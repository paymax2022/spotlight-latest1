package credentials

import (
	"context"
	"testing"
)

// These tests are PURE — no DB, no pgx. They exercise the guarded credential state
// machine, the earning-bridge eligibility predicate, and the service behaviours that
// matter for the golden rules: Apply idempotency (double = one route) and revoke
// updating the public verification registry. The Service is driven through a small
// in-memory fake store + fake RoleUpgrader.

// ── Credential SM: allowed + illegal transitions ────────────────────────────────

func TestCanCred_Allowed(t *testing.T) {
	if !canCred(CredPending, CredIssued) {
		t.Error("pending→issued must be allowed")
	}
	if !canCred(CredIssued, CredRevoked) {
		t.Error("issued→revoked must be allowed")
	}
}

func TestCanCred_Illegal(t *testing.T) {
	illegal := [][2]CredState{
		{CredPending, CredRevoked}, // skip issued
		{CredPending, CredPending}, // self-loop
		{CredIssued, CredIssued},   // self-loop (replay is idem, not SM)
		{CredIssued, CredPending},  // backwards
		{CredRevoked, CredIssued},  // terminal
		{CredRevoked, CredRevoked}, // terminal self-loop
		{CredState("bogus"), CredIssued},
	}
	for _, tr := range illegal {
		if canCred(tr[0], tr[1]) {
			t.Errorf("expected %s→%s to be ILLEGAL", tr[0], tr[1])
		}
	}
}

// ── Eligibility rules (pure) ─────────────────────────────────────────────────────

func sp(s string) *string { return &s }

func TestEligible_Rules(t *testing.T) {
	solar := []Credential{{State: CredIssued, Kind: KindTrade, TradeTrack: sp("solar")}}
	pendingOnly := []Credential{{State: CredPending, Kind: KindTrade, TradeTrack: sp("solar")}}

	// Matching trade track, default min 1.
	if !eligible(EligibilityRules{TradeTrack: "solar"}, solar) {
		t.Error("issued solar credential should satisfy {trade_track: solar}")
	}
	// Pending credentials never count.
	if eligible(EligibilityRules{TradeTrack: "solar"}, pendingOnly) {
		t.Error("pending credential must NOT satisfy eligibility")
	}
	// Wrong track.
	if eligible(EligibilityRules{TradeTrack: "plumbing"}, solar) {
		t.Error("solar credential must not satisfy {trade_track: plumbing}")
	}
	// Empty rules → any single issued credential qualifies.
	if !eligible(EligibilityRules{}, solar) {
		t.Error("empty rules should qualify on any issued credential")
	}
	// min_credentials enforced.
	if eligible(EligibilityRules{TradeTrack: "solar", MinCredentials: 2}, solar) {
		t.Error("one credential must not satisfy min_credentials: 2")
	}
	two := append([]Credential{}, solar...)
	two = append(two, Credential{State: CredIssued, Kind: KindTrade, TradeTrack: sp("solar")})
	if !eligible(EligibilityRules{TradeTrack: "solar", MinCredentials: 2}, two) {
		t.Error("two matching credentials should satisfy min_credentials: 2")
	}
	// Kind filter.
	if eligible(EligibilityRules{Kind: KindAcademic}, solar) {
		t.Error("trade credential must not satisfy {kind: academic}")
	}
}

// ── Fake store + upgrader ────────────────────────────────────────────────────────

type fakeStore struct {
	issued    []Credential
	opps      map[string]*EarningOpportunity
	apps      map[string]*EarningApplication // by id
	byIdem    map[string]*EarningApplication // by idempotency_key
	verif     map[string]*PublicVerification // by verification_id
	insertCnt int
	routeCnt  int
}

func newFakeStore() *fakeStore {
	return &fakeStore{
		opps:   map[string]*EarningOpportunity{},
		apps:   map[string]*EarningApplication{},
		byIdem: map[string]*EarningApplication{},
		verif:  map[string]*PublicVerification{},
	}
}

func (f *fakeStore) HolderName(context.Context, string) string { return "Ada" }

func (f *fakeStore) IssueCredential(_ context.Context, _ string, c Credential, holder string) (*Credential, error) {
	c.ID = "cred-" + c.VerificationID
	c.State = CredIssued
	f.issued = append(f.issued, c)
	f.verif[c.VerificationID] = &PublicVerification{
		VerificationID: c.VerificationID, HolderName: holder, Title: c.Title, Kind: c.Kind, Status: VerifValid,
	}
	return &c, nil
}

func (f *fakeStore) RevokeCredential(_ context.Context, _, id, reason string) (*Credential, error) {
	for i := range f.issued {
		if f.issued[i].ID == id {
			if !canCred(f.issued[i].State, CredRevoked) {
				return nil, ErrIllegalTransition
			}
			f.issued[i].State = CredRevoked
			f.issued[i].Reason = &reason
			// Registry is the public source of truth — flip it too.
			if v, ok := f.verif[f.issued[i].VerificationID]; ok {
				v.Status = VerifRevoked
			}
			return &f.issued[i], nil
		}
	}
	return nil, ErrNotFound
}

func (f *fakeStore) GetVerification(_ context.Context, id string) (*PublicVerification, error) {
	if v, ok := f.verif[id]; ok {
		return v, nil
	}
	return nil, ErrNotFound
}

func (f *fakeStore) ListCredentialsByUser(context.Context, string) ([]Credential, error) {
	return f.issued, nil
}

func (f *fakeStore) ListIssuedByUser(context.Context, string) ([]Credential, error) {
	out := []Credential{}
	for _, c := range f.issued {
		if c.State == CredIssued {
			out = append(out, c)
		}
	}
	return out, nil
}

func (f *fakeStore) GetOpportunity(_ context.Context, id string) (*EarningOpportunity, error) {
	if o, ok := f.opps[id]; ok {
		return o, nil
	}
	return nil, ErrNotFound
}

func (f *fakeStore) ListOpportunities(_ context.Context, activeOnly bool) ([]EarningOpportunity, error) {
	out := []EarningOpportunity{}
	for _, o := range f.opps {
		if activeOnly && o.Status != "active" {
			continue
		}
		out = append(out, *o)
	}
	return out, nil
}

func (f *fakeStore) InsertOpportunity(context.Context, string, CreateOpportunityRequest) (*EarningOpportunity, error) {
	return nil, nil
}
func (f *fakeStore) UpdateOpportunity(context.Context, string, string, UpdateOpportunityRequest) (*EarningOpportunity, error) {
	return nil, nil
}

func (f *fakeStore) FindApplicationByIdem(_ context.Context, idemKey string) (*EarningApplication, error) {
	if a, ok := f.byIdem[idemKey]; ok {
		return a, nil
	}
	return nil, ErrNotFound
}

func (f *fakeStore) InsertApplication(_ context.Context, userID, oppID, idemKey string) (*EarningApplication, error) {
	f.insertCnt++
	a := &EarningApplication{ID: "app-1", UserID: userID, OpportunityID: oppID, State: AppSubmitted}
	if idemKey != "" {
		a.IdempotencyKey = &idemKey
		f.byIdem[idemKey] = a
	}
	f.apps[a.ID] = a
	return a, nil
}

func (f *fakeStore) GetApplication(_ context.Context, id string) (*EarningApplication, error) {
	if a, ok := f.apps[id]; ok {
		return a, nil
	}
	return nil, ErrNotFound
}

func (f *fakeStore) MarkApplicationRouted(_ context.Context, _, id, ref string) (*EarningApplication, error) {
	f.routeCnt++
	a := f.apps[id]
	a.State = AppRouted
	a.PaymaxRef = &ref
	return a, nil
}

type fakeUpgrader struct{ calls int }

func (u *fakeUpgrader) UpgradeRole(_ context.Context, _, role, ref string) (string, error) {
	u.calls++
	return "paymax-" + role + "-" + ref, nil
}

func newTestService(store credentialStore, up RoleUpgrader) *Service {
	return &Service{repo: store, upgrader: up, secret: []byte("test-secret")}
}

// ── Apply idempotency: double call = one route ───────────────────────────────────

func TestApply_Idempotent(t *testing.T) {
	f := newFakeStore()
	f.opps["opp-1"] = &EarningOpportunity{
		ID: "opp-1", Code: "driver", Role: "driver", Status: "active",
		EligibilityRules: EligibilityRules{TradeTrack: "solar"},
	}
	f.issued = []Credential{{ID: "c1", State: CredIssued, Kind: KindTrade, TradeTrack: sp("solar")}}
	up := &fakeUpgrader{}
	s := newTestService(f, up)
	ctx := context.Background()

	r1, err := s.Apply(ctx, "user-1", "opp-1", "idem-key-1")
	if err != nil {
		t.Fatalf("first apply: %v", err)
	}
	if r1.AlreadyRouted {
		t.Error("first apply should not be flagged already_routed")
	}
	if r1.Application.State != AppRouted {
		t.Errorf("first apply should be routed, got %s", r1.Application.State)
	}

	r2, err := s.Apply(ctx, "user-1", "opp-1", "idem-key-1")
	if err != nil {
		t.Fatalf("replay apply: %v", err)
	}
	if !r2.AlreadyRouted {
		t.Error("replay should be flagged already_routed")
	}

	if f.insertCnt != 1 {
		t.Errorf("expected exactly ONE application insert, got %d", f.insertCnt)
	}
	if f.routeCnt != 1 {
		t.Errorf("expected exactly ONE route, got %d", f.routeCnt)
	}
	if up.calls != 1 {
		t.Errorf("expected exactly ONE Paymax role-upgrade call, got %d", up.calls)
	}
	if r1.PaymaxRef != r2.PaymaxRef {
		t.Errorf("replay must return same paymax ref: %q != %q", r1.PaymaxRef, r2.PaymaxRef)
	}
}

func TestApply_NotEligible(t *testing.T) {
	f := newFakeStore()
	f.opps["opp-1"] = &EarningOpportunity{
		ID: "opp-1", Role: "driver", Status: "active",
		EligibilityRules: EligibilityRules{TradeTrack: "solar"},
	}
	// No issued credentials → not eligible, fail closed.
	s := newTestService(f, &fakeUpgrader{})
	if _, err := s.Apply(context.Background(), "user-1", "opp-1", "k"); err != ErrNotEligible {
		t.Errorf("expected ErrNotEligible, got %v", err)
	}
	if f.insertCnt != 0 {
		t.Error("ineligible apply must not insert an application")
	}
}

// ── Revoke updates the public registry ───────────────────────────────────────────

func TestRevoke_UpdatesRegistry(t *testing.T) {
	f := newFakeStore()
	s := newTestService(f, &fakeUpgrader{})
	ctx := context.Background()

	// Issue first so a verification registry row exists (status=valid).
	credID, verID, err := s.IssueTradeCredential(ctx, "user-1", "solar", "Solar Installer")
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	v, _ := s.Verify(ctx, verID)
	if v.Status != VerifValid {
		t.Fatalf("issued credential should verify as valid, got %s", v.Status)
	}

	if _, err := s.Revoke(ctx, "admin-1", credID, "fraud"); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	v2, _ := s.Verify(ctx, verID)
	if v2.Status != VerifRevoked {
		t.Errorf("revoke must flip registry to revoked, got %s", v2.Status)
	}
}

// Revoking a non-issued credential is rejected by the guard.
func TestRevoke_IllegalRejected(t *testing.T) {
	f := newFakeStore()
	// Seed a pending credential directly (never issued).
	f.issued = append(f.issued, Credential{ID: "cred-x", State: CredPending, VerificationID: "vx"})
	f.verif["vx"] = &PublicVerification{VerificationID: "vx", Status: VerifValid}
	s := newTestService(f, &fakeUpgrader{})
	if _, err := s.Revoke(context.Background(), "admin-1", "cred-x", "reason"); err != ErrIllegalTransition {
		t.Errorf("revoking a pending credential must be illegal, got %v", err)
	}
}
