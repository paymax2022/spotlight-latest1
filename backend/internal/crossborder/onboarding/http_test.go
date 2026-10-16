package onboarding

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/finance/tiers"
)

// multiStore is a per-user in-memory Store so cross-user isolation is real.
type multiStore struct {
	mu       sync.Mutex
	accts    map[string]*GlobalAccount // by user
	wallets  map[string][]ProviderWallet
	fundings map[string][]FundingDetail
}

func newMultiStore() *multiStore {
	return &multiStore{accts: map[string]*GlobalAccount{}, wallets: map[string][]ProviderWallet{}, fundings: map[string][]FundingDetail{}}
}

func (m *multiStore) CreateAccount(_ context.Context, a *GlobalAccount, _ string, _ int) (*GlobalAccount, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if e, ok := m.accts[a.UserID]; ok {
		c := *e
		return &c, nil
	}
	c := *a
	c.ID = "acct-" + a.UserID
	m.accts[a.UserID] = &c
	r := c
	return &r, nil
}
func (m *multiStore) GetAccountByUser(_ context.Context, u, _ string) (*GlobalAccount, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if a, ok := m.accts[u]; ok {
		c := *a
		return &c, nil
	}
	return nil, nil
}
func (m *multiStore) GetAccountByCompanyID(context.Context, string, string) (*GlobalAccount, error) {
	return nil, nil
}
func (m *multiStore) UpdateStatus(_ context.Context, id string, from, to Status, _ StatusUpdate) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, a := range m.accts {
		if a.ID == id {
			a.Status = to
			return nil
		}
	}
	return ErrStaleStatus
}
func (m *multiStore) UpsertWallet(_ context.Context, w *ProviderWallet) (*ProviderWallet, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	c := *w
	c.ID = "w-" + w.AccountID + "-" + w.Currency
	m.wallets[w.AccountID] = append(m.wallets[w.AccountID], c)
	return &c, nil
}
func (m *multiStore) UpsertFundingDetail(_ context.Context, f *FundingDetail) (*FundingDetail, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.fundings[f.WalletID] = append(m.fundings[f.WalletID], *f)
	return f, nil
}
func (m *multiStore) RecordSubmission(context.Context, string, int, string, []byte, string) error {
	return nil
}
func (m *multiStore) RecordConsent(context.Context, *Consent) error { return nil }
func (m *multiStore) ListWallets(_ context.Context, id string) ([]ProviderWallet, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]ProviderWallet(nil), m.wallets[id]...), nil
}
func (m *multiStore) ListFundingDetails(_ context.Context, id string) ([]FundingDetail, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]FundingDetail(nil), m.fundings[id]...), nil
}

type pinStub struct {
	has      bool
	good     string
	verified int
}

func (p *pinStub) HasPin(context.Context, string) (bool, error) { return p.has, nil }
func (p *pinStub) VerifyPin(_ context.Context, _ string, pin string) error {
	p.verified++
	if pin != p.good {
		return ErrStepUpRejected
	}
	return nil
}

type httpFixture struct {
	r     *gin.Engine
	store *multiStore
	svc   *Service
	pin   *pinStub
}

func newHTTPFixture(t *testing.T, tier tiers.Tier) *httpFixture {
	t.Helper()
	gin.SetMode(gin.TestMode)
	st := newMultiStore()
	fp := &fakeProvider{}
	prof := stubProfiles{Profile{Email: "a@b.co", Phone: "+2348000000000"}}
	svc := NewService(Deps{
		Store: st, Accounts: fp, Wallets: fp, KYC: stubKYC{}, Tiers: stubTier{t: tier},
		Profiles: prof, Clock: fixedClock{},
		DocTypeID: map[DocumentKind]string{DocIdentity: "t1", DocAddressProof: "t2", DocIncorporation: "t3"},
	})
	pin := &pinStub{has: true, good: "1234"}
	h := NewHandler(svc, prof, pin, HandlerConfig{TnCVersion: "v1", TnCURL: "https://example.test/tnc"})
	r := gin.New()
	g := r.Group("/v1/global")
	// Test auth: the caller identity comes ONLY from this header-fed middleware,
	// standing in for RequireAuthContext.
	g.Use(func(c *gin.Context) {
		if u := c.GetHeader("X-Test-User"); u != "" {
			c.Set("user_id", u)
		}
		c.Next()
	})
	h.Register(g)
	return &httpFixture{r: r, store: st, svc: svc, pin: pin}
}

func (f *httpFixture) do(method, path, user, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	if user != "" {
		req.Header.Set("X-Test-User", user)
	}
	w := httptest.NewRecorder()
	f.r.ServeHTTP(w, req)
	return w
}

func dataOf(t *testing.T, w *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var out struct {
		Data map[string]any `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("bad json %q: %v", w.Body.String(), err)
	}
	return out.Data
}

const activateBody = `{"pin":"1234","subject_type":"individual"}`

func TestStatus_RequiresAuth(t *testing.T) {
	f := newHTTPFixture(t, tiers.Tier2)
	if w := f.do("GET", "/v1/global/status", "", ""); w.Code != http.StatusUnauthorized {
		t.Fatalf("got %d, want 401", w.Code)
	}
}

func TestStatus_HappyPathShape(t *testing.T) {
	f := newHTTPFixture(t, tiers.Tier2)
	w := f.do("GET", "/v1/global/status", "alice", "")
	if w.Code != 200 {
		t.Fatalf("got %d: %s", w.Code, w.Body)
	}
	d := dataOf(t, w)
	if d["status"] != "NOT_STARTED" || d["next_step"] != "activate" || d["exists"] != false {
		t.Fatalf("unexpected status payload: %v", d)
	}
	if _, ok := d["wallets"].([]any); !ok {
		t.Fatalf("wallets must be an array: %v", d)
	}
}

// Object-level authz: user B must never see or reach user A's account,
// wallets, or funding details, even though A's data exists in the same store.
func TestStatus_RequiresOwnership(t *testing.T) {
	f := newHTTPFixture(t, tiers.Tier2)
	if w := f.do("POST", "/v1/global/activate", "alice", activateBody); w.Code != 200 {
		t.Fatalf("activate A: %d %s", w.Code, w.Body)
	}
	// Force A ACTIVE with wallets provisioned.
	a := f.store.accts["alice"]
	a.Status = StatusActive
	if err := f.svc.ensureWallets(context.Background(), a); err != nil {
		t.Fatal(err)
	}

	// A sees their own.
	if d := dataOf(t, f.do("GET", "/v1/global/status", "alice", "")); d["status"] != "ACTIVE" {
		t.Fatalf("A should see ACTIVE, got %v", d)
	}
	if w := f.do("GET", "/v1/global/wallets/USD/funding-details", "alice", ""); w.Code != 200 {
		t.Fatalf("A own funding details: %d", w.Code)
	}

	// B sees NONE of it.
	d := dataOf(t, f.do("GET", "/v1/global/status", "bob", ""))
	if d["status"] != "NOT_STARTED" || d["exists"] != false {
		t.Fatalf("B must not see A's account, got %v", d)
	}
	if w := f.do("GET", "/v1/global/wallets", "bob", ""); w.Code != http.StatusNotFound {
		t.Fatalf("B wallets: got %d, want 404", w.Code)
	}
	w := f.do("GET", "/v1/global/wallets/USD/funding-details", "bob", "")
	if w.Code != http.StatusNotFound {
		t.Fatalf("B funding details: got %d, want 404", w.Code)
	}
	if strings.Contains(w.Body.String(), "123USD") {
		t.Fatalf("A's account number leaked to B: %s", w.Body)
	}
	// Spoofed identity hints in the request must be ignored.
	req := httptest.NewRequest("GET", "/v1/global/wallets?user_id=alice", nil)
	req.Header.Set("X-Test-User", "bob")
	rec := httptest.NewRecorder()
	f.r.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("query user_id must be ignored: got %d", rec.Code)
	}
	// B's mutating calls act on B's (nonexistent) account, not A's.
	if w := f.do("PUT", "/v1/global/onboarding/documents", "bob",
		`{"documents":[{"kind":"IDENTITY","document_id":"d1"}]}`); w.Code != http.StatusNotFound {
		t.Fatalf("B documents: got %d, want 404", w.Code)
	}
}

func TestActivate_StepUpRequired(t *testing.T) {
	f := newHTTPFixture(t, tiers.Tier2)

	// Missing PIN: 400, and the verifier is never consulted (no lockout guess).
	if w := f.do("POST", "/v1/global/activate", "alice", `{"subject_type":"individual"}`); w.Code != http.StatusBadRequest {
		t.Fatalf("missing pin: got %d", w.Code)
	}
	if f.pin.verified != 0 {
		t.Fatalf("verifier called for an absent PIN")
	}
	// Wrong PIN: 403, nothing created.
	if w := f.do("POST", "/v1/global/activate", "alice", `{"pin":"0000","subject_type":"individual"}`); w.Code != http.StatusForbidden {
		t.Fatalf("wrong pin: got %d", w.Code)
	}
	if f.store.accts["alice"] != nil {
		t.Fatalf("account created without step-up")
	}
	// No PIN set: 403.
	f.pin.has = false
	if w := f.do("POST", "/v1/global/activate", "alice", activateBody); w.Code != http.StatusForbidden {
		t.Fatalf("pin not set: got %d", w.Code)
	}
	f.pin.has = true
	// Correct PIN: 200.
	w := f.do("POST", "/v1/global/activate", "alice", activateBody)
	if w.Code != 200 {
		t.Fatalf("activate: %d %s", w.Code, w.Body)
	}
	d := dataOf(t, w)
	if d["status"] != "SUBMITTED" || d["subject_type"] != "individual" {
		t.Fatalf("unexpected activate payload: %v", d)
	}
}

func TestActivate_NilStepUpFailsClosed(t *testing.T) {
	f := newHTTPFixture(t, tiers.Tier2)
	h := NewHandler(f.svc, stubProfiles{}, nil, HandlerConfig{})
	r := gin.New()
	r.Use(func(c *gin.Context) { c.Set("user_id", "alice"); c.Next() })
	h.Register(r.Group("/g"))
	req := httptest.NewRequest("POST", "/g/activate", bytes.NewBufferString(activateBody))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("nil step-up must fail closed, got %d", w.Code)
	}
}

func TestActivate_TierTooLow(t *testing.T) {
	f := newHTTPFixture(t, tiers.Tier1)
	if w := f.do("POST", "/v1/global/activate", "alice", activateBody); w.Code != http.StatusForbidden {
		t.Fatalf("got %d, want 403", w.Code)
	}
}

func TestActivate_ContactDataIsServerHeld(t *testing.T) {
	f := newHTTPFixture(t, tiers.Tier2)
	// A client-supplied email/phone is ignored (profile reader is the source).
	w := f.do("POST", "/v1/global/activate", "alice",
		`{"pin":"1234","subject_type":"individual","email":"evil@x.co","phone":"+1"}`)
	if w.Code != 200 {
		t.Fatalf("got %d %s", w.Code, w.Body)
	}
}

func TestActivate_InvalidSubjectAndBusiness(t *testing.T) {
	f := newHTTPFixture(t, tiers.Tier2)
	if w := f.do("POST", "/v1/global/activate", "alice", `{"pin":"1234","subject_type":"alien"}`); w.Code != 400 {
		t.Fatalf("bad subject: %d", w.Code)
	}
	if w := f.do("POST", "/v1/global/activate", "alice", `{"pin":"1234","subject_type":"business"}`); w.Code != 400 {
		t.Fatalf("business without data: %d", w.Code)
	}
}

func TestTnC_StepUpAndVersion(t *testing.T) {
	f := newHTTPFixture(t, tiers.Tier2)
	f.do("POST", "/v1/global/activate", "alice", activateBody)
	f.store.accts["alice"].Status = StatusAwaitingTnC

	if w := f.do("POST", "/v1/global/onboarding/tnc", "alice", `{"accepted":true,"version":"v1"}`); w.Code != 400 {
		t.Fatalf("missing pin: %d", w.Code)
	}
	if w := f.do("POST", "/v1/global/onboarding/tnc", "alice", `{"pin":"bad","accepted":true,"version":"v1"}`); w.Code != 403 {
		t.Fatalf("wrong pin: %d", w.Code)
	}
	if w := f.do("POST", "/v1/global/onboarding/tnc", "alice", `{"pin":"1234","accepted":true,"version":"v0"}`); w.Code != 409 {
		t.Fatalf("version mismatch: %d", w.Code)
	}
	if f.store.accts["alice"].Status != StatusAwaitingTnC {
		t.Fatalf("status moved without valid acceptance")
	}
	if w := f.do("POST", "/v1/global/onboarding/tnc", "alice", `{"pin":"1234","accepted":true,"version":"v1"}`); w.Code != 200 {
		t.Fatalf("tnc: %d %s", w.Code, w.Body)
	}
	if f.store.accts["alice"].Status != StatusActive {
		t.Fatalf("want ACTIVE, got %s", f.store.accts["alice"].Status)
	}
	if len(f.store.wallets["acct-alice"]) != len(WalletCurrencies) {
		t.Fatalf("wallets not provisioned")
	}
}

func TestFundingDetails_ShapeAndNoStore(t *testing.T) {
	f := newHTTPFixture(t, tiers.Tier2)
	f.do("POST", "/v1/global/activate", "alice", activateBody)
	a := f.store.accts["alice"]
	a.Status = StatusActive
	if err := f.svc.ensureWallets(context.Background(), a); err != nil {
		t.Fatal(err)
	}
	w := f.do("GET", "/v1/global/wallets/usd/funding-details", "alice", "")
	if w.Code != 200 {
		t.Fatalf("got %d %s", w.Code, w.Body)
	}
	if w.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("funding details must be no-store")
	}
	d := dataOf(t, w)
	fds, _ := d["funding_details"].([]any)
	if d["currency"] != "USD" || len(fds) != 1 {
		t.Fatalf("unexpected payload: %v", d)
	}
	if fd := fds[0].(map[string]any); fd["account_number"] != "123USD" {
		t.Fatalf("unexpected funding detail: %v", fd)
	}
	if w := f.do("GET", "/v1/global/wallets/XXX/funding-details", "alice", ""); w.Code != 404 {
		t.Fatalf("unknown ccy: %d", w.Code)
	}
	if w := f.do("GET", "/v1/global/wallets/US/funding-details", "alice", ""); w.Code != 400 {
		t.Fatalf("malformed ccy: %d", w.Code)
	}
}

func TestDocuments_ActionValidationAndDelete(t *testing.T) {
	f := newHTTPFixture(t, tiers.Tier2)
	// Require an identity doc so the account waits NOT_STARTED for documents.
	f.svc.d.RequiredDocs = map[SubjectType][]DocumentKind{SubjectIndividual: {DocIdentity}}
	if w := f.do("POST", "/v1/global/activate", "alice", activateBody); w.Code != 200 {
		t.Fatalf("activate: %d", w.Code)
	}
	if f.store.accts["alice"].Status != StatusNotStarted {
		t.Fatalf("expected NOT_STARTED awaiting docs")
	}
	if w := f.do("PUT", "/v1/global/onboarding/documents", "alice",
		`{"documents":[{"kind":"IDENTITY","document_id":"d1","action":"BOGUS"}]}`); w.Code != 400 {
		t.Fatalf("bad action: %d", w.Code)
	}
	// DELETE of the only identity doc leaves the gate unmet.
	if w := f.do("PUT", "/v1/global/onboarding/documents", "alice",
		`{"documents":[{"kind":"IDENTITY","document_id":"d1","action":"DELETE"}]}`); w.Code != 422 {
		t.Fatalf("delete leaves incomplete: %d %s", w.Code, w.Body)
	}
	if w := f.do("PUT", "/v1/global/onboarding/documents", "alice",
		`{"documents":[{"kind":"IDENTITY","document_id":"d1"}]}`); w.Code != 200 {
		t.Fatalf("add: %d %s", w.Code, w.Body)
	}
	if f.store.accts["alice"].Status != StatusSubmitted {
		t.Fatalf("want SUBMITTED, got %s", f.store.accts["alice"].Status)
	}
}

func TestUploadLink_OwnAccountOnly(t *testing.T) {
	f := newHTTPFixture(t, tiers.Tier2)
	f.svc.d.RequiredDocs = map[SubjectType][]DocumentKind{SubjectIndividual: {DocIdentity}}
	f.do("POST", "/v1/global/activate", "alice", activateBody)
	body := `{"kind":"IDENTITY","file_name":"id.png","content_type":"image/png"}`
	if w := f.do("POST", "/v1/global/onboarding/documents/upload-link", "bob", body); w.Code != 404 {
		t.Fatalf("B on A's account: %d", w.Code)
	}
	if w := f.do("POST", "/v1/global/onboarding/documents/upload-link", "alice", `{"kind":"IDENTITY","file_name":"../x"}`); w.Code != 400 {
		t.Fatalf("path in filename: %d", w.Code)
	}
	if w := f.do("POST", "/v1/global/onboarding/documents/upload-link", "alice", body); w.Code != 200 {
		t.Fatalf("A upload link: %d %s", w.Code, w.Body)
	}
}

func TestActivate_IncompleteKYCFailsClosed422(t *testing.T) {
	f := newHTTPFixture(t, tiers.Tier2)
	f.svc.d.KYC = incompleteKYC{}
	w := f.do("POST", "/v1/global/activate", "alice", activateBody)
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("got %d %s", w.Code, w.Body)
	}
	if f.store.accts["alice"] != nil {
		t.Fatalf("no account may be created from incomplete KYC")
	}
}

type incompleteKYC struct{}

func (incompleteKYC) GetKYCView(context.Context, string) (KYCView, error) {
	return KYCView{FirstName: "Ada", LastName: "Obi", DateOfBirth: "1990-01-02", HasBVN: true}, nil
}
