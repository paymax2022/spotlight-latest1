package orchestration

// Handler-level tests for the FX virtual-cards vertical. These exercise the HTTP
// contract + money-path GUARDS (402 on insufficient funds, idempotent funding,
// customer-object scoping) against an in-memory CardStore fake — no DB required.
// The double-entry ledger INVARIANT (balanced DEBIT/CREDIT legs) is proven
// separately against a live database in backend/tests/fx/cards_funding_live_db_test.go
// (env-gated on TEST_DATABASE_URL), because ledger legs are a SQL-store concern the
// fake cannot model.

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/gin-gonic/gin"
)

// ─── in-memory CardStore fake ─────────────────────────────────────────────────

type memCardStore struct {
	mu      sync.Mutex
	cards   map[string]Card   // id → card
	owner   map[string]string // id → business
	wallet  map[string]int64  // business|currency → minor
	funded  map[string]bool   // business|idemKey → applied (idempotency)
	created int
}

func newMemCardStore() *memCardStore {
	return &memCardStore{
		cards:  map[string]Card{},
		owner:  map[string]string{},
		wallet: map[string]int64{},
		funded: map[string]bool{},
	}
}

// compile-time assertion the fake satisfies the interface.
var _ CardStore = (*memCardStore)(nil)

func (m *memCardStore) seedWallet(business, currency string, minor int64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.wallet[business+"|"+currency] = minor
}

func (m *memCardStore) owned(business, id string) bool { return m.owner[id] == business }

func (m *memCardStore) ListCards(_ context.Context, business string) ([]Card, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]Card, 0)
	for id, c := range m.cards {
		if m.owner[id] == business {
			out = append(out, c)
		}
	}
	return out, nil
}

func (m *memCardStore) GetCard(_ context.Context, business, id string) (Card, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.owned(business, id) {
		return Card{}, false, nil
	}
	return m.cards[id], true, nil
}

func (m *memCardStore) CreateCard(_ context.Context, business string, draft CardDraft) (Card, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.created++
	cur := strings.ToUpper(draft.Currency)
	if cur == "" {
		cur = "USD"
	}
	c := Card{
		ID: "card_test_" + strconv.Itoa(m.created), Label: draft.Label, Brand: "visa", Currency: cur,
		Last4: "4242", ExpMonth: 1, ExpYear: 30, CardholderName: "TEST USER",
		Status: "active", Color: "purple", Controls: defaultCardControls(), Provider: "maplerad",
		CreatedAt: "2026-01-01T00:00:00Z",
	}
	m.cards[c.ID] = c
	m.owner[c.ID] = business
	return c, nil
}

// FundCard mirrors the SQL store's GUARD semantics (not its ledger legs): unknown
// card → ErrCardNotFound; replayed idemKey → no-op; short wallet → ErrInsufficientCardBalance.
func (m *memCardStore) FundCard(_ context.Context, business, id string, amountMinor int64, idemKey string) (Card, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.owned(business, id) {
		return Card{}, ErrCardNotFound
	}
	if idemKey != "" && m.funded[business+"|"+idemKey] {
		return m.cards[id], nil // idempotent replay
	}
	c := m.cards[id]
	wkey := business + "|" + c.Currency
	if m.wallet[wkey] < amountMinor {
		return Card{}, ErrInsufficientCardBalance
	}
	m.wallet[wkey] -= amountMinor
	c.Balance += amountMinor
	m.cards[id] = c
	if idemKey != "" {
		m.funded[business+"|"+idemKey] = true
	}
	return c, nil
}

func (m *memCardStore) setStatus(business, id, status string) (Card, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.owned(business, id) {
		return Card{}, false, nil
	}
	c := m.cards[id]
	c.Status = status
	m.cards[id] = c
	return c, true, nil
}

func (m *memCardStore) FreezeCard(_ context.Context, business, id string) (Card, bool, error) {
	return m.setStatus(business, id, "frozen")
}
func (m *memCardStore) UnfreezeCard(_ context.Context, business, id string) (Card, bool, error) {
	return m.setStatus(business, id, "active")
}
func (m *memCardStore) TerminateCard(_ context.Context, business, id string) error {
	if !m.owned(business, id) {
		return ErrCardNotFound
	}
	_, _, _ = m.setStatus(business, id, "terminated")
	return nil
}
func (m *memCardStore) UpdateControls(_ context.Context, business, id string, controls SpendingControls) (Card, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.owned(business, id) {
		return Card{}, false, nil
	}
	c := m.cards[id]
	c.Controls = controls
	m.cards[id] = c
	return c, true, nil
}
func (m *memCardStore) ListCardTransactions(_ context.Context, business, cardID string) ([]CardTransaction, error) {
	return []CardTransaction{}, nil
}
func (m *memCardStore) RevealCard(_ context.Context, business, id string) (CardSensitive, bool, error) {
	if !m.owned(business, id) {
		return CardSensitive{}, false, nil
	}
	return CardSensitive{Pan: "4242 4242 4242 4242", Cvv: "123", Expiry: "01/30"}, true, nil
}

// ─── test router ──────────────────────────────────────────────────────────────

func cardsRouter(store CardStore, userID string) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	h := NewHandler(nil).WithCards(store)
	r.Use(func(c *gin.Context) { c.Set("user_id", userID); c.Next() })
	r.GET("/cards", h.ListCards)
	r.GET("/cards/:id", h.GetCard)
	r.POST("/cards/:id/fund", h.FundCard)
	r.POST("/cards/:id/freeze", h.FreezeCard)
	r.POST("/cards/:id/terminate", h.TerminateCard)
	return r
}

func doCardJSON(t *testing.T, r *gin.Engine, method, path, body string, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// ─── tests ────────────────────────────────────────────────────────────────────

func TestFundCard_InsufficientFunds_402(t *testing.T) {
	store := newMemCardStore()
	card, _ := store.CreateCard(nil, "cust-A", CardDraft{Currency: "USD"})
	store.seedWallet("cust-A", "USD", 100) // only ₵1.00 available

	r := cardsRouter(store, "cust-A")
	w := doCardJSON(t, r, http.MethodPost, "/cards/"+card.ID+"/fund", `{"amount":50000}`,
		map[string]string{"Idempotency-Key": "k1"})

	if w.Code != http.StatusPaymentRequired {
		t.Fatalf("want 402, got %d (%s)", w.Code, w.Body.String())
	}
	if store.cards[card.ID].Balance != 0 {
		t.Fatalf("card must not be funded on failure, balance=%d", store.cards[card.ID].Balance)
	}
}

func TestFundCard_Idempotent(t *testing.T) {
	store := newMemCardStore()
	card, _ := store.CreateCard(nil, "cust-A", CardDraft{Currency: "USD"})
	store.seedWallet("cust-A", "USD", 100000)

	r := cardsRouter(store, "cust-A")
	hdr := map[string]string{"Idempotency-Key": "same-key"}
	_ = doCardJSON(t, r, http.MethodPost, "/cards/"+card.ID+"/fund", `{"amount":30000}`, hdr)
	_ = doCardJSON(t, r, http.MethodPost, "/cards/"+card.ID+"/fund", `{"amount":30000}`, hdr)

	if got := store.cards[card.ID].Balance; got != 30000 {
		t.Fatalf("idempotent replay must fund once: balance=%d want 30000", got)
	}
	if got := store.wallet["cust-A|USD"]; got != 70000 {
		t.Fatalf("wallet debited once: got %d want 70000", got)
	}
}

func TestCard_CustomerScoping(t *testing.T) {
	store := newMemCardStore()
	card, _ := store.CreateCard(nil, "cust-A", CardDraft{Currency: "USD"})
	store.seedWallet("cust-B", "USD", 100000)

	// Customer B must not see or fund customer A's card. The orchestration module
	// surfaces "not found" as 400 with code "not_found" (its taxonomy has no 404
	// type — same convention as Transaction-not-found). The security property under
	// test is that B is DENIED access (non-2xx + A's card untouched), not the code.
	rB := cardsRouter(store, "cust-B")
	if w := doCardJSON(t, rB, http.MethodGet, "/cards/"+card.ID, "", nil); w.Code != http.StatusBadRequest {
		t.Fatalf("B get A's card: want 400 not_found, got %d", w.Code)
	}
	if w := doCardJSON(t, rB, http.MethodPost, "/cards/"+card.ID+"/fund", `{"amount":10}`,
		map[string]string{"Idempotency-Key": "b1"}); w.Code != http.StatusBadRequest {
		t.Fatalf("B fund A's card: want 400 not_found, got %d", w.Code)
	}
	if store.cards[card.ID].Balance != 0 {
		t.Fatalf("A's card must be untouched by B")
	}
}

func TestListCards_Shape(t *testing.T) {
	store := newMemCardStore()
	_, _ = store.CreateCard(nil, "cust-A", CardDraft{Currency: "USD"})
	r := cardsRouter(store, "cust-A")
	w := doCardJSON(t, r, http.MethodGet, "/cards", "", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", w.Code)
	}
	var env struct {
		Data []Card `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(env.Data) != 1 {
		t.Fatalf("want 1 card in {data:[...]}, got %d", len(env.Data))
	}
}
