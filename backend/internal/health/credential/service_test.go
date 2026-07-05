package credential

import (
	"context"
	"errors"
	"testing"
	"time"

	providers "spotlight/backend/internal/health/providers"
)

// ---- fakes (no DB) ----

type fakeStore struct {
	records   map[string]*VerificationRecord
	meta      map[string]*AppMeta // applicationID → meta
	docs      map[string]*DocRef
	accessLog []string // "docID:accessor:basis"
	expirySet map[string]time.Time
	seq       int
}

func newFakeStore() *fakeStore {
	return &fakeStore{records: map[string]*VerificationRecord{}, meta: map[string]*AppMeta{}, docs: map[string]*DocRef{}, expirySet: map[string]time.Time{}}
}

func (f *fakeStore) CreateRecord(_ context.Context, rec *VerificationRecord) error {
	f.seq++
	rec.ID = "rec-" + itoa(f.seq)
	rec.CreatedAt = time.Now()
	cp := *rec
	f.records[rec.ID] = &cp
	return nil
}
func (f *fakeStore) GetRecord(_ context.Context, id string) (*VerificationRecord, error) {
	r, ok := f.records[id]
	if !ok {
		return nil, ErrNotFound
	}
	cp := *r
	return &cp, nil
}
func (f *fakeStore) LatestByApplication(_ context.Context, appID string) (*VerificationRecord, error) {
	for _, r := range f.records {
		if r.ProviderApplicationID == appID {
			cp := *r
			return &cp, nil
		}
	}
	return nil, ErrNotFound
}
func (f *fakeStore) ListQueue(_ context.Context, status Status, _ int) ([]QueueItem, error) {
	var out []QueueItem
	for _, r := range f.records {
		if r.Status == status {
			out = append(out, QueueItem{Record: r, IdentityFlag: hasIdentityFlag(r.MatchedFields)})
		}
	}
	return out, nil
}
func (f *fakeStore) DecideRecord(_ context.Context, id string, from, to Status, reviewerID, notes string, exp *time.Time) (bool, error) {
	r, ok := f.records[id]
	if !ok || r.Status != from {
		return false, nil
	}
	r.Status = to
	r.ReviewerID = &reviewerID
	r.Notes = notes
	if exp != nil {
		r.LicenceExpiry = exp
	}
	return true, nil
}
func (f *fakeStore) SetLicenceExpiryOnDoc(_ context.Context, appID string, expiry time.Time) error {
	f.expirySet[appID] = expiry
	return nil
}
func (f *fakeStore) GetDoc(_ context.Context, docID string) (*DocRef, error) {
	d, ok := f.docs[docID]
	if !ok {
		return nil, ErrNotFound
	}
	return d, nil
}
func (f *fakeStore) LogDocAccess(_ context.Context, docID, accessorID, basis string) error {
	f.accessLog = append(f.accessLog, docID+":"+accessorID+":"+basis)
	return nil
}
func (f *fakeStore) GetApplicationMeta(_ context.Context, appID string) (*AppMeta, error) {
	m, ok := f.meta[appID]
	if !ok {
		return nil, ErrNotFound
	}
	return m, nil
}

type fakeProviders struct {
	apps          map[string]*providers.Application // appID → app (with owner)
	decisions     []string                          // "appID:action"
	addedDocs     int
	suspendCalls  int
	suspendReturn int
	failDecision  bool
}

func (p *fakeProviders) GetApplication(_ context.Context, ownerID, appID string) (*providers.Application, error) {
	a, ok := p.apps[appID]
	if !ok || a.OwnerUserID != ownerID {
		return nil, errors.New("forbidden")
	}
	cp := *a
	return &cp, nil
}
func (p *fakeProviders) AddCredential(_ context.Context, ownerID, appID string, d providers.CredentialDoc) (*providers.CredentialDoc, error) {
	p.addedDocs++
	d.ID = "doc-" + itoa(p.addedDocs)
	return &d, nil
}
func (p *fakeProviders) Submit(_ context.Context, ownerID, appID string) (*providers.Application, error) {
	if a := p.apps[appID]; a != nil {
		a.State = providers.StateSubmitted
	}
	return p.apps[appID], nil
}
func (p *fakeProviders) Decision(_ context.Context, actorID, appID, action, note string) (*providers.Application, error) {
	p.decisions = append(p.decisions, appID+":"+action)
	if p.failDecision {
		return nil, errors.New("decision failed")
	}
	if a := p.apps[appID]; a != nil && action == "approve" {
		a.State = providers.StateApproved
	}
	return p.apps[appID], nil
}
func (p *fakeProviders) SuspendExpired(_ context.Context, _ time.Time) (int, error) {
	p.suspendCalls++
	return p.suspendReturn, nil
}

type fakeIdentity struct{ snap IdentitySnapshot }

func (f fakeIdentity) Snapshot(context.Context, string) (IdentitySnapshot, error) { return f.snap, nil }

type fakeSigner struct{ url string }

func (f fakeSigner) SignGet(context.Context, string) (string, error) { return f.url, nil }

type fakeSched struct{ calls int }

func (f *fakeSched) ScheduleAt(context.Context, string, string, string, time.Time, map[string]any) error {
	f.calls++
	return nil
}

type auditEntry struct{ actor, action, entity string }
type fakeAudit struct{ entries []auditEntry }

func (a *fakeAudit) Log(actor, action, _, entity string, _ map[string]any) {
	a.entries = append(a.entries, auditEntry{actor, action, entity})
}
func (a *fakeAudit) has(action string) bool {
	for _, e := range a.entries {
		if e.action == action {
			return true
		}
	}
	return false
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	return string(b)
}

// ---- helpers ----

const (
	vetOwner = "owner-vet-1"
	appID    = "app-1"
	reviewer = "reviewer-1"
)

func newHarness(t *testing.T) (*Service, *fakeStore, *fakeProviders, *fakeAudit, *fakeSched) {
	t.Helper()
	store := newFakeStore()
	store.meta[appID] = &AppMeta{OwnerUserID: vetOwner, ProviderType: "vet", State: "DRAFT"}
	prov := &fakeProviders{apps: map[string]*providers.Application{
		appID: {ID: appID, OwnerUserID: vetOwner, ProviderType: "vet", State: providers.StateDraft},
	}}
	audit := &fakeAudit{}
	sched := &fakeSched{}
	svc := NewService(store, NewVCNAdapter(), prov, fakeIdentity{snap: IdentitySnapshot{FullName: "Jane Doe", KYCTier: 2}}, fakeSigner{url: "https://signed"}, sched, audit)
	return svc, store, prov, audit, sched
}

func validSubmit() SubmitInput {
	return SubmitInput{
		ApplicationID: appID, RegNumber: "VCN/2020/123", FullName: "Jane Doe", DOB: "1990-01-01",
		Consent: true,
		Docs: []SubmitDoc{
			{Type: "VCN_CERT", StorageKey: "k1"},
			{Type: "ANNUAL_LICENCE", StorageKey: "k2"},
			{Type: "GOV_ID", StorageKey: "k3"},
		},
	}
}

// ---- 1. record state machine (allowed + rejected) ----

func TestRecordStateMachine(t *testing.T) {
	allow := []struct{ from, to Status }{
		{StatusPending, StatusVerified}, {StatusPending, StatusNeedsInfo}, {StatusPending, StatusRejected},
		{StatusNeedsInfo, StatusPending}, {StatusNeedsInfo, StatusRejected},
	}
	for _, c := range allow {
		if !canTransitionStatus(c.from, c.to) {
			t.Errorf("expected %s→%s allowed", c.from, c.to)
		}
	}
	reject := []struct{ from, to Status }{
		{StatusVerified, StatusRejected}, {StatusVerified, StatusPending}, {StatusRejected, StatusVerified},
		{StatusPending, StatusPending}, {StatusNeedsInfo, StatusVerified}, {StatusVerified, StatusVerified},
	}
	for _, c := range reject {
		if canTransitionStatus(c.from, c.to) {
			t.Errorf("expected %s→%s rejected", c.from, c.to)
		}
	}
}

func TestPublicStageNeverLeaksRegisterData(t *testing.T) {
	cases := map[Status]string{
		StatusPending: "pending_review", StatusNeedsInfo: "more_info_needed",
		StatusVerified: "verified", StatusRejected: "not_verified",
	}
	for st, want := range cases {
		if got := publicStage(st); got != want {
			t.Errorf("publicStage(%s)=%s want %s", st, got, want)
		}
	}
}

// ---- 2. identity cross-check ----

func TestComputeMatchedFields(t *testing.T) {
	dob := "1990-01-01"
	m := computeMatchedFields("jane  DOE", "1990-01-01", IdentitySnapshot{FullName: "Jane Doe", DOB: &dob, KYCTier: 1})
	if m["name"] != matchOK || m["dob"] != matchOK || m["kyc"] != matchOK {
		t.Fatalf("expected all match, got %v", m)
	}
	if hasIdentityFlag(m) {
		t.Error("no hard flag expected on full match")
	}
	mm := computeMatchedFields("John Smith", "1985-05-05", IdentitySnapshot{FullName: "Jane Doe", DOB: &dob, KYCTier: 0})
	if mm["name"] != matchMismatch || mm["dob"] != matchMismatch {
		t.Fatalf("expected mismatches, got %v", mm)
	}
	if !hasIdentityFlag(mm) {
		t.Error("expected hard identity flag on mismatch")
	}
	un := computeMatchedFields("Jane Doe", "", IdentitySnapshot{FullName: "", KYCTier: 0})
	if un["name"] != matchUnverifiable || un["dob"] != matchUnverifiable {
		t.Fatalf("expected unverifiable, got %v", un)
	}
	if hasIdentityFlag(un) {
		t.Error("unverifiable must not be a hard flag")
	}
}

// ---- 3. Submit ----

func TestSubmit_HappyPath(t *testing.T) {
	svc, store, prov, audit, _ := newHarness(t)
	rec, err := svc.Submit(context.Background(), vetOwner, validSubmit())
	if err != nil {
		t.Fatalf("submit: %v", err)
	}
	if rec.Status != StatusPending {
		t.Errorf("status=%s want PENDING", rec.Status)
	}
	if len(rec.EvidenceDocIDs) != 3 || prov.addedDocs != 3 {
		t.Errorf("expected 3 docs attached, got rec=%d prov=%d", len(rec.EvidenceDocIDs), prov.addedDocs)
	}
	// advanced to the ops queue (DRAFT→SUBMITTED→UNDER_REVIEW via start_review)
	if len(prov.decisions) == 0 || prov.decisions[len(prov.decisions)-1] != appID+":start_review" {
		t.Errorf("expected start_review advance, got %v", prov.decisions)
	}
	if !audit.has("health.vcn.verification.submitted") {
		t.Error("expected submit audit (HL-12)")
	}
	if _, ok := store.records[rec.ID]; !ok {
		t.Error("record not persisted")
	}
}

func TestSubmit_RequiresConsent(t *testing.T) {
	svc, _, _, _, _ := newHarness(t)
	in := validSubmit()
	in.Consent = false
	if _, err := svc.Submit(context.Background(), vetOwner, in); err == nil {
		t.Fatal("expected NDPA consent error")
	}
}

func TestSubmit_OwnerOnly(t *testing.T) {
	svc, _, _, _, _ := newHarness(t)
	if _, err := svc.Submit(context.Background(), "other-vet", validSubmit()); !errors.Is(err, ErrForbidden) {
		t.Fatalf("expected ErrForbidden for non-owner, got %v", err)
	}
}

func TestSubmit_IdentityFlagSurfaced(t *testing.T) {
	store := newFakeStore()
	store.meta[appID] = &AppMeta{OwnerUserID: vetOwner, ProviderType: "vet", State: "DRAFT"}
	prov := &fakeProviders{apps: map[string]*providers.Application{appID: {ID: appID, OwnerUserID: vetOwner, ProviderType: "vet", State: providers.StateDraft}}}
	svc := NewService(store, NewVCNAdapter(), prov, fakeIdentity{snap: IdentitySnapshot{FullName: "Totally Different", KYCTier: 1}}, nil, &fakeSched{}, &fakeAudit{})
	rec, err := svc.Submit(context.Background(), vetOwner, validSubmit())
	if err != nil {
		t.Fatal(err)
	}
	if !hasIdentityFlag(rec.MatchedFields) {
		t.Errorf("expected identity mismatch flag, got %v", rec.MatchedFields)
	}
}

// ---- 4. Decide: authZ / idempotency / capability grant / expiry ----

func TestDecide_NoSelfApproval(t *testing.T) {
	svc, store, _, _, _ := newHarness(t)
	rec := mustSubmit(t, svc, store)
	exp := time.Now().Add(365 * 24 * time.Hour)
	// reviewer == owner → forbidden (a vet can NEVER self-approve)
	if _, err := svc.Decide(context.Background(), vetOwner, rec.ID, "approve", &exp, "ok"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("expected ErrForbidden on self-approve, got %v", err)
	}
}

func TestDecide_ApproveGrantsCapabilityAndExpiry(t *testing.T) {
	svc, store, prov, audit, sched := newHarness(t)
	rec := mustSubmit(t, svc, store)
	prov.decisions = nil // reset after submit's start_review
	exp := time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC)
	out, err := svc.Decide(context.Background(), reviewer, rec.ID, "approve", &exp, "verified vs VCN")
	if err != nil {
		t.Fatalf("approve: %v", err)
	}
	if out.Status != StatusVerified {
		t.Errorf("status=%s want VERIFIED", out.Status)
	}
	if len(prov.decisions) != 1 || prov.decisions[0] != appID+":approve" {
		t.Errorf("expected one approve to providers (idempotent grant), got %v", prov.decisions)
	}
	if got, ok := store.expirySet[appID]; !ok || !got.Equal(exp) {
		t.Errorf("licence expiry not mirrored onto ANNUAL_LICENCE doc: %v", store.expirySet)
	}
	if sched.calls != 1 {
		t.Errorf("expected one expiry-sweep schedule, got %d", sched.calls)
	}
	if !audit.has("health.vcn.verification.decided") {
		t.Error("expected decision audit (HL-12)")
	}
}

func TestDecide_ApproveRequiresExpiry(t *testing.T) {
	svc, store, _, _, _ := newHarness(t)
	rec := mustSubmit(t, svc, store)
	if _, err := svc.Decide(context.Background(), reviewer, rec.ID, "approve", nil, "x"); err == nil {
		t.Fatal("expected error: licence_expiry required to approve")
	}
}

func TestDecide_Idempotent(t *testing.T) {
	svc, store, prov, _, _ := newHarness(t)
	rec := mustSubmit(t, svc, store)
	prov.decisions = nil
	exp := time.Now().Add(24 * time.Hour)
	if _, err := svc.Decide(context.Background(), reviewer, rec.ID, "approve", &exp, "ok"); err != nil {
		t.Fatal(err)
	}
	// second identical decision is a no-op success; no second capability grant
	if _, err := svc.Decide(context.Background(), reviewer, rec.ID, "approve", &exp, "ok"); err != nil {
		t.Fatalf("expected idempotent no-op, got %v", err)
	}
	if len(prov.decisions) != 1 {
		t.Errorf("capability granted more than once: %v", prov.decisions)
	}
}

func TestDecide_IllegalTransition(t *testing.T) {
	svc, store, _, _, _ := newHarness(t)
	rec := mustSubmit(t, svc, store)
	exp := time.Now().Add(24 * time.Hour)
	if _, err := svc.Decide(context.Background(), reviewer, rec.ID, "approve", &exp, "ok"); err != nil {
		t.Fatal(err)
	}
	// VERIFIED → REJECTED is not allowed
	if _, err := svc.Decide(context.Background(), reviewer, rec.ID, "reject", nil, "no"); !errors.Is(err, ErrIllegalTransition) {
		t.Fatalf("expected ErrIllegalTransition, got %v", err)
	}
}

// ---- 5. licence-expiry auto-suspend (HL-2) ----

func TestRunLicenceSweep_AutoSuspends(t *testing.T) {
	svc, _, prov, audit, _ := newHarness(t)
	prov.suspendReturn = 2
	n, err := svc.RunLicenceSweep(context.Background(), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if n != 2 || prov.suspendCalls != 1 {
		t.Errorf("expected SuspendExpired called once returning 2, got n=%d calls=%d", n, prov.suspendCalls)
	}
	if !audit.has("health.vcn.licence.auto_suspended") {
		t.Error("expected auto-suspend audit (HL-12)")
	}
}

// ---- 6. NDPA: document access is access-logged + signed-URL gated ----

func TestDocSignedURL_AccessLoggedAndGated(t *testing.T) {
	svc, store, _, audit, _ := newHarness(t)
	store.docs["d1"] = &DocRef{ID: "d1", ApplicationID: appID, OwnerUserID: vetOwner, CredType: "VCN_CERT", StorageKey: "k1"}

	// owner read → logged with OWNER basis + signed URL returned
	url, err := svc.DocSignedURL(context.Background(), vetOwner, "d1", false)
	if err != nil || url != "https://signed" {
		t.Fatalf("owner read: url=%q err=%v", url, err)
	}
	// reviewer read → logged with REVIEWER basis
	if _, err := svc.DocSignedURL(context.Background(), reviewer, "d1", true); err != nil {
		t.Fatal(err)
	}
	// unrelated user, not reviewer → forbidden, and NOT logged
	if _, err := svc.DocSignedURL(context.Background(), "stranger", "d1", false); !errors.Is(err, ErrForbidden) {
		t.Fatalf("expected ErrForbidden, got %v", err)
	}
	if len(store.accessLog) != 2 {
		t.Fatalf("expected exactly 2 access-log rows (owner, reviewer), got %v", store.accessLog)
	}
	if store.accessLog[0] != "d1:"+vetOwner+":OWNER" || store.accessLog[1] != "d1:"+reviewer+":REVIEWER" {
		t.Errorf("access-log basis wrong: %v", store.accessLog)
	}
	if !audit.has("health.vcn.document.accessed") {
		t.Error("expected document-access audit (HL-12/NDPA)")
	}
}

func mustSubmit(t *testing.T, svc *Service, store *fakeStore) *VerificationRecord {
	t.Helper()
	rec, err := svc.Submit(context.Background(), vetOwner, validSubmit())
	if err != nil {
		t.Fatalf("setup submit: %v", err)
	}
	return rec
}
