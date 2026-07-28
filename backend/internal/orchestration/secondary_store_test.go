package orchestration

// Unit tests for the FX secondary features (beneficiaries + rate alerts):
//   - store-contract tests against an in-memory fake (round-trip semantics)
//   - customer-scoping / object-level authZ (customer B cannot touch A's rows)
//   - handler tests via httptest proving the handler threads customerID(c) through
//
// No DB required: the in-memory fake implements the SecondaryStore interface, and
// the production pgx impl (sqlSecondaryStore) is exercised separately against a
// live/local database (see docs/runbooks/fx-e2e-test.md).

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

// ─── in-memory fake ───────────────────────────────────────────────────────────

type memSecondaryStore struct {
	mu     sync.Mutex
	bens   map[string][]Beneficiary // customer → beneficiaries
	alerts map[string][]RateAlert   // customer → rate alerts
}

func newMemSecondaryStore() *memSecondaryStore {
	return &memSecondaryStore{bens: map[string][]Beneficiary{}, alerts: map[string][]RateAlert{}}
}

// compile-time assertion that the fake satisfies the interface.
var _ SecondaryStore = (*memSecondaryStore)(nil)

func (m *memSecondaryStore) ListBeneficiaries(_ context.Context, customer string) ([]Beneficiary, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := append([]Beneficiary(nil), m.bens[customer]...)
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Favorite != out[j].Favorite {
			return out[i].Favorite // favorites first
		}
		return out[i].CreatedAt > out[j].CreatedAt // newest first
	})
	return out, nil
}

func (m *memSecondaryStore) CreateBeneficiary(_ context.Context, customer string, b Beneficiary) (Beneficiary, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if b.CreatedAt == "" {
		b.CreatedAt = time.Now().UTC().Format(time.RFC3339)
	}
	m.bens[customer] = append(m.bens[customer], b)
	return b, nil
}

func (m *memSecondaryStore) UpdateBeneficiary(_ context.Context, customer, id string, b Beneficiary) (Beneficiary, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	list := m.bens[customer]
	for i := range list {
		if list[i].ID == id {
			b.ID = id
			b.CreatedAt = list[i].CreatedAt
			b.Favorite = list[i].Favorite // favorite is changed via its own endpoint
			list[i] = b
			return b, true, nil
		}
	}
	return Beneficiary{}, false, nil
}

func (m *memSecondaryStore) SetBeneficiaryFavorite(_ context.Context, customer, id string, favorite bool) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.bens[customer] {
		if m.bens[customer][i].ID == id {
			m.bens[customer][i].Favorite = favorite
		}
	}
	return nil
}

func (m *memSecondaryStore) DeleteBeneficiary(_ context.Context, customer, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	list := m.bens[customer]
	for i := range list {
		if list[i].ID == id {
			m.bens[customer] = append(list[:i], list[i+1:]...)
			return nil
		}
	}
	return nil
}

func (m *memSecondaryStore) ListRateAlerts(_ context.Context, customer string) ([]RateAlert, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]RateAlert(nil), m.alerts[customer]...), nil
}

func (m *memSecondaryStore) CreateRateAlert(_ context.Context, customer string, a RateAlert) (RateAlert, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if a.CreatedAt == "" {
		a.CreatedAt = time.Now().UTC().Format(time.RFC3339)
	}
	a.Active = true
	m.alerts[customer] = append(m.alerts[customer], a)
	return a, nil
}

func (m *memSecondaryStore) DeleteRateAlert(_ context.Context, customer, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	list := m.alerts[customer]
	for i := range list {
		if list[i].ID == id {
			m.alerts[customer] = append(list[:i], list[i+1:]...)
			return nil
		}
	}
	return nil
}

// ─── store-contract tests ─────────────────────────────────────────────────────

func TestBeneficiaryStoreRoundTrip(t *testing.T) {
	ctx := context.Background()
	s := newMemSecondaryStore()

	created, err := s.CreateBeneficiary(ctx, "cust_A", Beneficiary{ID: "ben_1", Name: "Ada", Currency: "NGN", Validated: true})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if created.CreatedAt == "" {
		t.Fatal("expected CreatedAt to be set on create")
	}

	list, _ := s.ListBeneficiaries(ctx, "cust_A")
	if len(list) != 1 || list[0].ID != "ben_1" {
		t.Fatalf("list after create = %+v, want 1 with ben_1", list)
	}

	upd, ok, _ := s.UpdateBeneficiary(ctx, "cust_A", "ben_1", Beneficiary{Name: "Ada L.", Currency: "USD", Validated: true})
	if !ok || upd.Name != "Ada L." || upd.Currency != "USD" {
		t.Fatalf("update = %+v ok=%v, want renamed", upd, ok)
	}
	if upd.CreatedAt != created.CreatedAt {
		t.Fatal("update must preserve CreatedAt")
	}

	if err := s.SetBeneficiaryFavorite(ctx, "cust_A", "ben_1", true); err != nil {
		t.Fatalf("favorite: %v", err)
	}
	list, _ = s.ListBeneficiaries(ctx, "cust_A")
	if !list[0].Favorite {
		t.Fatal("favorite flag not persisted")
	}

	if err := s.DeleteBeneficiary(ctx, "cust_A", "ben_1"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	list, _ = s.ListBeneficiaries(ctx, "cust_A")
	if len(list) != 0 {
		t.Fatalf("list after delete = %+v, want empty", list)
	}
}

func TestBeneficiaryCrossCustomerIsolation(t *testing.T) {
	ctx := context.Background()
	s := newMemSecondaryStore()
	if _, err := s.CreateBeneficiary(ctx, "cust_A", Beneficiary{ID: "ben_1", Name: "Ada"}); err != nil {
		t.Fatalf("seed: %v", err)
	}

	// Customer B must not see, update, or delete customer A's beneficiary.
	if list, _ := s.ListBeneficiaries(ctx, "cust_B"); len(list) != 0 {
		t.Fatalf("B sees A's rows: %+v", list)
	}
	if _, ok, _ := s.UpdateBeneficiary(ctx, "cust_B", "ben_1", Beneficiary{Name: "hijack"}); ok {
		t.Fatal("B was able to update A's beneficiary")
	}
	_ = s.DeleteBeneficiary(ctx, "cust_B", "ben_1")
	if list, _ := s.ListBeneficiaries(ctx, "cust_A"); len(list) != 1 {
		t.Fatalf("A's beneficiary was affected by B's delete: %+v", list)
	}
}

func TestRateAlertStoreRoundTripAndIsolation(t *testing.T) {
	ctx := context.Background()
	s := newMemSecondaryStore()

	a, err := s.CreateRateAlert(ctx, "cust_A", RateAlert{ID: "al_1", Pair: "USD-NGN", From: "USD", To: "NGN", Direction: "above", Target: 1700})
	if err != nil || !a.Active {
		t.Fatalf("create alert = %+v err=%v", a, err)
	}
	if list, _ := s.ListRateAlerts(ctx, "cust_A"); len(list) != 1 {
		t.Fatalf("list = %+v, want 1", list)
	}
	if list, _ := s.ListRateAlerts(ctx, "cust_B"); len(list) != 0 {
		t.Fatalf("B sees A's alerts: %+v", list)
	}
	_ = s.DeleteRateAlert(ctx, "cust_A", "al_1")
	if list, _ := s.ListRateAlerts(ctx, "cust_A"); len(list) != 0 {
		t.Fatalf("list after delete = %+v, want empty", list)
	}
}

// ─── handler tests (httptest) ─────────────────────────────────────────────────

// testEngine wires the beneficiary/rate-alert routes with a middleware that fixes
// the caller identity (mimics RequireAuthContext setting user_id).
func testEngine(sec SecondaryStore, userID string) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	h := NewHandler(nil).WithSecondary(sec)
	r.Use(func(c *gin.Context) { c.Set("user_id", userID); c.Next() })
	r.GET("/beneficiaries", h.ListBeneficiaries)
	r.POST("/beneficiaries", h.CreateBeneficiary)
	r.POST("/beneficiaries/validate", h.ValidateBeneficiary)
	r.PUT("/beneficiaries/:id", h.UpdateBeneficiary)
	r.PATCH("/beneficiaries/:id", h.FavoriteBeneficiary)
	r.DELETE("/beneficiaries/:id", h.DeleteBeneficiary)
	r.GET("/rate-alerts", h.ListRateAlerts)
	r.POST("/rate-alerts", h.CreateRateAlert)
	r.DELETE("/rate-alerts/:id", h.DeleteRateAlert)
	return r
}

func doJSON(t *testing.T, r *gin.Engine, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestHandlerBeneficiaryCreateThenList(t *testing.T) {
	store := newMemSecondaryStore()
	rA := testEngine(store, "cust_A")

	body := `{"name":"Ada","rail":"bank_transfer","scheme":"BANK","currency":"ngn","accountNumber":"0123456789","countryCode":"ng"}`
	w := doJSON(t, rA, http.MethodPost, "/beneficiaries", body)
	if w.Code != http.StatusCreated {
		t.Fatalf("create status = %d, want 201; body=%s", w.Code, w.Body.String())
	}
	var created Beneficiary
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode create: %v", err)
	}
	if created.ID == "" || created.Currency != "NGN" || !created.Validated {
		t.Fatalf("created = %+v, want id set, currency upper-cased, validated", created)
	}

	// Same user lists it back.
	w = doJSON(t, rA, http.MethodGet, "/beneficiaries", "")
	var listResp struct {
		Data []Beneficiary `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &listResp); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if len(listResp.Data) != 1 || listResp.Data[0].ID != created.ID {
		t.Fatalf("list = %+v, want the created beneficiary", listResp.Data)
	}
}

func TestHandlerBeneficiaryObjectLevelAuthZ(t *testing.T) {
	store := newMemSecondaryStore()
	rA := testEngine(store, "cust_A")
	rB := testEngine(store, "cust_B")

	body := `{"name":"Ada","rail":"bank_transfer","scheme":"BANK","currency":"NGN","accountNumber":"0123456789","countryCode":"NG"}`
	if w := doJSON(t, rA, http.MethodPost, "/beneficiaries", body); w.Code != http.StatusCreated {
		t.Fatalf("seed create status = %d", w.Code)
	}

	// Customer B's list must be empty (must not see A's rows).
	w := doJSON(t, rB, http.MethodGet, "/beneficiaries", "")
	var listResp struct {
		Data []Beneficiary `json:"data"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &listResp)
	if len(listResp.Data) != 0 {
		t.Fatalf("customer B saw customer A's beneficiaries: %+v", listResp.Data)
	}
}

func TestHandlerValidateBeneficiary(t *testing.T) {
	r := testEngine(newMemSecondaryStore(), "cust_A")

	// Too-short account number on a bank rail → invalid.
	w := doJSON(t, r, http.MethodPost, "/beneficiaries/validate",
		`{"name":"X","rail":"bank_transfer","scheme":"BANK","currency":"NGN","accountNumber":"123","countryCode":"NG"}`)
	var res struct {
		Valid        bool   `json:"valid"`
		ResolvedName string `json:"resolvedName"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &res)
	if res.Valid {
		t.Fatalf("expected invalid for short account number; body=%s", w.Body.String())
	}

	// Valid account number → valid + resolved name.
	w = doJSON(t, r, http.MethodPost, "/beneficiaries/validate",
		`{"name":"Ada","rail":"bank_transfer","scheme":"BANK","currency":"NGN","accountNumber":"0123456789","countryCode":"NG"}`)
	_ = json.Unmarshal(w.Body.Bytes(), &res)
	if !res.Valid || res.ResolvedName != "Ada" {
		t.Fatalf("expected valid with resolvedName=Ada; got %+v", res)
	}
}

func TestHandlerBeneficiaryCreateRejectsBadPayload(t *testing.T) {
	r := testEngine(newMemSecondaryStore(), "cust_A")
	cases := map[string]string{
		"unsupported rail":     `{"name":"A","rail":"carrier_pigeon","scheme":"BANK","currency":"NGN","accountNumber":"0123456789","countryCode":"NG"}`,
		"unsupported currency": `{"name":"A","rail":"bank_transfer","scheme":"BANK","currency":"XYZ","accountNumber":"0123456789","countryCode":"NG"}`,
		"missing name":         `{"name":"","rail":"bank_transfer","scheme":"BANK","currency":"NGN","accountNumber":"0123456789","countryCode":"NG"}`,
		"bad country code":     `{"name":"A","rail":"bank_transfer","scheme":"BANK","currency":"NGN","accountNumber":"0123456789","countryCode":"NGA"}`,
	}
	for name, body := range cases {
		w := doJSON(t, r, http.MethodPost, "/beneficiaries", body)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("%s: status = %d, want 400; body=%s", name, w.Code, w.Body.String())
		}
	}
	// A stablecoin currency (USDC, 4 chars) must be accepted.
	w := doJSON(t, r, http.MethodPost, "/beneficiaries",
		`{"name":"A","rail":"stablecoin","scheme":"STABLECOIN","currency":"USDC","accountNumber":"0xabc0000000","countryCode":"NG"}`)
	if w.Code != http.StatusCreated {
		t.Fatalf("USDC beneficiary rejected: status=%d body=%s", w.Code, w.Body.String())
	}
}

func TestHandlerRateAlertCreateValidationAndRoundTrip(t *testing.T) {
	store := newMemSecondaryStore()
	r := testEngine(store, "cust_A")

	// Invalid: target must be positive.
	if w := doJSON(t, r, http.MethodPost, "/rate-alerts",
		`{"from":"USD","to":"NGN","direction":"above","target":0}`); w.Code != http.StatusBadRequest {
		t.Fatalf("zero target: status=%d, want 400", w.Code)
	}
	// Invalid: direction.
	if w := doJSON(t, r, http.MethodPost, "/rate-alerts",
		`{"from":"USD","to":"NGN","direction":"sideways","target":1700}`); w.Code != http.StatusBadRequest {
		t.Fatalf("bad direction: status=%d, want 400", w.Code)
	}
	// Valid → created, then listed.
	w := doJSON(t, r, http.MethodPost, "/rate-alerts",
		`{"from":"usd","to":"ngn","direction":"above","target":1700}`)
	if w.Code != http.StatusCreated {
		t.Fatalf("valid alert: status=%d body=%s", w.Code, w.Body.String())
	}
	var created RateAlert
	_ = json.Unmarshal(w.Body.Bytes(), &created)
	if created.Pair != "USD-NGN" || !created.Active {
		t.Fatalf("created alert = %+v, want pair USD-NGN active", created)
	}
	w = doJSON(t, r, http.MethodGet, "/rate-alerts", "")
	var listResp struct {
		Data []RateAlert `json:"data"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &listResp)
	if len(listResp.Data) != 1 {
		t.Fatalf("rate-alert list = %+v, want 1", listResp.Data)
	}
}
