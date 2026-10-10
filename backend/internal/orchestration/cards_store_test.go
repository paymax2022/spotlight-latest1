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

type memCardStore struct {
	mu        sync.Mutex
	cards     map[string]Card   // id → card
	owner     map[string]string // id → business
	wallet    map[string]int64  // business|currency → minor
	funded    map[string]bool   // business|idemKey → applied (funding idempotency)
	createdBy map[string]string // business|idemKey → card id (create idempotency)
	created   int
}

func newMemCardStore() *memCardStore {
	return &memCardStore{
		cards:     map[string]Card{},
		owner:     map[string]string{},
		wallet:    map[string]int64{},
		funded:    map[string]bool{},
		createdBy: map[string]string{},
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

// CreateCard mirrors the SQL store's dedupe semantics: a replayed idemKey
// returns the card it first created instead of inserting a second row.
func (m *memCardStore) CreateCard(_ context.Context, business string, draft CardDraft, idemKey string) (Card, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if idemKey != "" {
		if id, ok := m.createdBy[business+"|"+idemKey]; ok {
			return m.cards[id], nil // idempotent replay
		}
	}
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
	if idemKey != "" {
		m.createdBy[business+"|"+idemKey] = c.ID
	}
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
	_, _, _ = m.setStatus(business, id, "terminated") //nolint:dogsled // tuple: only side-effect matters
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

func cardsRouter(store CardStore, userID string) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	h := NewHandler(nil).WithCards(store)
	r.Use(func(c *gin.Context) { c.Set("user_id", userID); c.Next() })
	r.GET("/cards", h.ListCards)
	r.POST("/cards", h.CreateCard)
	r.GET("/cards/:id", h.GetCard)
	r.POST("/cards/:id/fund", h.FundCard)
	r.POST("/cards/:id/freeze", h.FreezeCard)
	r.POST("/cards/:id/terminate", h.TerminateCard)
	return r
}

func doCardJSON(t *testing.T, r *gin.Engine, method, path, body string, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestFundCard_InsufficientFunds_402(t *testing.T) {
	store := newMemCardStore()
	card, _ := store.CreateCard(nil, "cust-A", CardDraft{Currency: "USD"}, "")
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
	card, _ := store.CreateCard(nil, "cust-A", CardDraft{Currency: "USD"}, "")
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
	card, _ := store.CreateCard(nil, "cust-A", CardDraft{Currency: "USD"}, "")
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

// Replaying POST /cards with the same Idempotency-Key must return the SAME card
// and persist exactly one row — the create leg dedupes on (business, key), not
// just the funding leg.
func TestCreateCard_IdempotentReplay(t *testing.T) {
	store := newMemCardStore()
	r := cardsRouter(store, "cust-A")
	hdr := map[string]string{"Idempotency-Key": "create-key-1"}
	body := `{"label":"Subscriptions","brand":"visa","currency":"USD","color":"purple","fundingAmount":0}`

	w1 := doCardJSON(t, r, http.MethodPost, "/cards", body, hdr)
	if w1.Code != http.StatusCreated {
		t.Fatalf("first create: status = %d, want 201; body=%s", w1.Code, w1.Body.String())
	}
	w2 := doCardJSON(t, r, http.MethodPost, "/cards", body, hdr)
	if w2.Code != http.StatusCreated {
		t.Fatalf("replay create: status = %d, want 201; body=%s", w2.Code, w2.Body.String())
	}
	var c1, c2 Card
	if err := json.Unmarshal(w1.Body.Bytes(), &c1); err != nil {
		t.Fatalf("decode first card: %v", err)
	}
	if err := json.Unmarshal(w2.Body.Bytes(), &c2); err != nil {
		t.Fatalf("decode replayed card: %v", err)
	}
	if c1.ID != c2.ID {
		t.Fatalf("replay must return the SAME card: got %s then %s", c1.ID, c2.ID)
	}
	if len(store.cards) != 1 {
		t.Fatalf("replay must persist one row, got %d", len(store.cards))
	}
}

// A different Idempotency-Key is a different client intent → a second card row.
func TestCreateCard_DifferentKeysSeparateCards(t *testing.T) {
	store := newMemCardStore()
	r := cardsRouter(store, "cust-A")
	body := `{"label":"Subscriptions","brand":"visa","currency":"USD","color":"purple","fundingAmount":0}`

	w1 := doCardJSON(t, r, http.MethodPost, "/cards", body, map[string]string{"Idempotency-Key": "k-a"})
	w2 := doCardJSON(t, r, http.MethodPost, "/cards", body, map[string]string{"Idempotency-Key": "k-b"})
	var c1, c2 Card
	_ = json.Unmarshal(w1.Body.Bytes(), &c1)
	_ = json.Unmarshal(w2.Body.Bytes(), &c2)
	if w1.Code != http.StatusCreated || w2.Code != http.StatusCreated {
		t.Fatalf("both creates: got %d and %d, want 201 each", w1.Code, w2.Code)
	}
	if c1.ID == c2.ID {
		t.Fatalf("different keys must create distinct cards, both got %s", c1.ID)
	}
	if len(store.cards) != 2 {
		t.Fatalf("want 2 card rows, got %d", len(store.cards))
	}
}

// Replay of a create-with-funding under the same key must not double-fund: the
// create leg returns the existing card and the funding leg dedupes on the key.
func TestCreateCard_ReplayWithFunding(t *testing.T) {
	store := newMemCardStore()
	store.seedWallet("cust-A", "USD", 100000)
	r := cardsRouter(store, "cust-A")
	hdr := map[string]string{"Idempotency-Key": "create-fund-1"}
	body := `{"label":"Subscriptions","brand":"visa","currency":"USD","color":"purple","fundingAmount":30000}`

	w1 := doCardJSON(t, r, http.MethodPost, "/cards", body, hdr)
	w2 := doCardJSON(t, r, http.MethodPost, "/cards", body, hdr)
	if w1.Code != http.StatusCreated || w2.Code != http.StatusCreated {
		t.Fatalf("create+fund replay: got %d and %d, want 201 each; bodies %s | %s",
			w1.Code, w2.Code, w1.Body.String(), w2.Body.String())
	}
	var c1, c2 Card
	_ = json.Unmarshal(w1.Body.Bytes(), &c1)
	_ = json.Unmarshal(w2.Body.Bytes(), &c2)
	if c1.ID != c2.ID {
		t.Fatalf("replay must return the same card: %s vs %s", c1.ID, c2.ID)
	}
	if len(store.cards) != 1 {
		t.Fatalf("replay must persist one row, got %d", len(store.cards))
	}
	if got := store.cards[c1.ID].Balance; got != 30000 {
		t.Fatalf("replay must not double-fund: balance=%d want 30000", got)
	}
	if got := store.wallet["cust-A|USD"]; got != 70000 {
		t.Fatalf("wallet debited once: got %d want 70000", got)
	}
}

// Two different businesses may reuse the same key — dedupe is scoped by
// (business, key), matching orch_fx_cards_idem_uniq.
func TestCreateCard_IdemKeyScopedByBusiness(t *testing.T) {
	store := newMemCardStore()
	body := `{"label":"Subscriptions","brand":"visa","currency":"USD","color":"purple","fundingAmount":0}`
	hdr := map[string]string{"Idempotency-Key": "shared-key"}

	rA := cardsRouter(store, "cust-A")
	rB := cardsRouter(store, "cust-B")
	wA := doCardJSON(t, rA, http.MethodPost, "/cards", body, hdr)
	wB := doCardJSON(t, rB, http.MethodPost, "/cards", body, hdr)
	var cA, cB Card
	_ = json.Unmarshal(wA.Body.Bytes(), &cA)
	_ = json.Unmarshal(wB.Body.Bytes(), &cB)
	if cA.ID == cB.ID {
		t.Fatalf("same key under different businesses must not dedupe: both got %s", cA.ID)
	}
}

func TestListCards_Shape(t *testing.T) {
	store := newMemCardStore()
	_, _ = store.CreateCard(nil, "cust-A", CardDraft{Currency: "USD"}, "")
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
