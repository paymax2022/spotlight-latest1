package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"paymax/crypto-backend/internal/domain"
	"paymax/crypto-backend/internal/engine"
	"paymax/crypto-backend/internal/ledger"
	"paymax/crypto-backend/internal/store"
)

// buyThroughHandler drives a market buy end-to-end through the postBuy handler
// against a persisted server quote, returning the resulting order. The store is
// eligible + flags enabled by default (store.New / admin seed), so the money path
// executes as in production.
func buyThroughHandler(t *testing.T, s *Server, repo *store.Store, idemKey string) domain.Order {
	t.Helper()
	usdc, ok := repo.Asset("ast_usdc")
	if !ok {
		t.Fatal("seed asset ast_usdc missing")
	}
	q := engine.BuildQuote(usdc, "buy", "fiat", 1_000_00, "NGN", true) // ₦1,000
	repo.PutQuote(q)

	body, _ := json.Marshal(map[string]string{"quoteId": q.ID})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/crypto/buy", bytes.NewReader(body))
	req.Header.Set("Idempotency-Key", idemKey)
	rec := httptest.NewRecorder()

	s.postBuy(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("postBuy status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var order domain.Order
	if err := json.Unmarshal(rec.Body.Bytes(), &order); err != nil {
		t.Fatalf("decode order: %v", err)
	}
	if order.Status != "Filled" {
		t.Fatalf("order status = %q, want Filled", order.Status)
	}
	return order
}

// TestShadowPostReflectsBuyCashLeg proves the wiring: with a MockLedger injected as
// s.ledger and shadow ENABLED, a successful buy additively posts the cash leg
// (user_wallet → settlement for the all-in TotalFiat).
func TestShadowPostReflectsBuyCashLeg(t *testing.T) {
	repo := store.New()
	s := NewServer(repo)

	ml := ledger.NewMock()
	s.ledger = ml
	s.ledgerShadowEnabled = true

	order := buyThroughHandler(t, s, repo, "idem-buy-shadow")

	// No auth context on the httptest request → UserID is "". Assert against it.
	const uid = ""
	settlement, _ := ml.Balance(context.Background(), uid, "settlement")
	if settlement != order.TotalFiat.Amount {
		t.Errorf("shadow settlement balance = %d, want %d (TotalFiat)", settlement, order.TotalFiat.Amount)
	}
	wallet, _ := ml.Balance(context.Background(), uid, "user_wallet")
	if wallet != -order.TotalFiat.Amount {
		t.Errorf("shadow user_wallet balance = %d, want %d", wallet, -order.TotalFiat.Amount)
	}
}

// TestNoShadowPostWhenDisabled proves the additive guard: with shadow DISABLED, a
// successful buy touches the injected ledger not at all — the store path returns the
// identical order regardless.
func TestNoShadowPostWhenDisabled(t *testing.T) {
	repo := store.New()
	s := NewServer(repo)

	ml := ledger.NewMock()
	s.ledger = ml
	s.ledgerShadowEnabled = false

	order := buyThroughHandler(t, s, repo, "idem-buy-noshadow")
	if order.Status != "Filled" {
		t.Fatalf("order status = %q, want Filled", order.Status)
	}

	if bal, _ := ml.Balance(context.Background(), "", "settlement"); bal != 0 {
		t.Errorf("shadow disabled but settlement = %d, want 0", bal)
	}
	if bal, _ := ml.Balance(context.Background(), "", "user_wallet"); bal != 0 {
		t.Errorf("shadow disabled but user_wallet = %d, want 0", bal)
	}
}
