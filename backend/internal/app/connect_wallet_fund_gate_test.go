package app

// Route-mount regression test for E2E-SEC-052: POST /api/v1/wallet/fund let
// ANY authenticated user mint money — a balanced DR provider_clearing → CR
// user_wallet journal with no payment proof, no flag, no cap. provider_clearing
// is the standing account reserved for verified Paystack webhooks; the
// documented funding rail ("fund FROM the Paymax super-app wallet", per the
// mobile fund screen) was never implemented.
//
// Fix: the route mounts ONLY when cfg.FeatureConnectWalletFundEnabled
// (FEATURE_CONNECT_WALLET_FUND_ENABLED, default OFF) is set — a deliberate
// operator opt-in while the real funding-source design is decided. Flag off ⇒
// the path 404s even with a valid session. The read routes (summary/history)
// are unaffected.
//
// pgxpool.New is lazy — no connection is opened until the first query, so the
// registration runs DB-free (see social_mount_test.go).

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/config"
)

// authedStub stands in for middleware.RequireAuthContext: it stamps a user_id
// so the request reaches whatever the route would serve a fully
// authenticated member.
func authedStub() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Set("user_id", "user-test-1")
		c.Next()
	}
}

func connectWalletEngine(t *testing.T, cfg config.Config) *gin.Engine {
	t.Helper()
	pool, err := pgxpool.New(context.Background(), "postgres://postgres:postgres@127.0.0.1:1/postgres")
	if err != nil {
		t.Fatalf("pgxpool.New: %v", err)
	}
	t.Cleanup(pool.Close)

	gin.SetMode(gin.TestMode)
	r := gin.New()
	registerConnectWalletRoutes(r, cfg, nil, nil, authedStub(), pool, nil, nil)
	return r
}

func postFund(r *gin.Engine) *httptest.ResponseRecorder {
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/v1/wallet/fund",
		strings.NewReader(`{"amountKobo":10000100}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "e2e-sec-052-test")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestConnectWalletFund_UnmountedByDefault(t *testing.T) {
	r := connectWalletEngine(t, config.Config{}) // FeatureConnectWalletFundEnabled=false

	mounted := map[string]bool{}
	for _, rt := range r.Routes() {
		mounted[rt.Method+" "+rt.Path] = true
	}
	if mounted["POST /api/v1/wallet/fund"] {
		t.Fatal("POST /api/v1/wallet/fund mounted while FEATURE_CONNECT_WALLET_FUND_ENABLED is off")
	}

	// The money-mint hole: a fully authenticated member must get 404 — the
	// route does not exist — not a balanced journal credit.
	if w := postFund(r); w.Code != http.StatusNotFound {
		t.Fatalf("flag off: POST /api/v1/wallet/fund = %d, want 404 (body %s)", w.Code, w.Body.String())
	}

	// Read routes on the same group keep working under the flag.
	for _, want := range []string{
		"GET /api/v1/wallet/summary",
		"GET /api/v1/wallet/history",
		"GET /api/v1/wallet/history/:id",
	} {
		if !mounted[want] {
			t.Errorf("route missing with flag off: %s", want)
		}
	}
}

func TestConnectWalletFund_MountsWhenFlagEnabled(t *testing.T) {
	r := connectWalletEngine(t, config.Config{FeatureConnectWalletFundEnabled: true})

	mounted := map[string]bool{}
	for _, rt := range r.Routes() {
		mounted[rt.Method+" "+rt.Path] = true
	}
	if !mounted["POST /api/v1/wallet/fund"] {
		t.Fatal("POST /api/v1/wallet/fund missing while FEATURE_CONNECT_WALLET_FUND_ENABLED is on")
	}

	// With the flag on the request must clear the gate and reach the handler.
	// The pool points at a dead address, so the money path fails with 500 —
	// anything but 404/401 proves the request was served by FundWallet.
	w := postFund(r)
	if w.Code == http.StatusNotFound || w.Code == http.StatusUnauthorized {
		t.Fatalf("flag on: POST /api/v1/wallet/fund = %d, want the handler (money path), body %s", w.Code, w.Body.String())
	}
}
