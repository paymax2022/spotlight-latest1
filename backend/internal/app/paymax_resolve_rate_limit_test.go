package app

// .review/cashtag-security.md MAJOR M1: GET /finance/transfers/paymax/resolve
// is an identity-lookup oracle, and cashtag addressing turned it into an
// enumerable one — the accepted handle grammar is a short, low-entropy,
// dictionary-shaped namespace (real handles are names, so the attack space is
// a wordlist, not 36^30). Mounted unmetered, throughput is bounded only by the
// auth middleware and the DB; each hit costs two cheap indexed reads. Every
// money-moving POST beside it already carries the same per-user limiter
// (E2E-SEC-058), and POST /resolve-account was metered for exactly this class
// of cost — "spends a lookup per call" describes the resolve GET even more
// directly.
//
// This pins the WIRING through the real route mount, the same way
// TestCardDirectWiring_InitiateIsPerUserRateLimited does for card-direct
// initiates: budget 1/min, first resolve reaches the handler (empty phone →
// 404 recipient_not_found, before any I/O), second from the same principal →
// 429, another principal has their own budget.

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/config"
	"spotlight/backend/internal/integrations"
)

const paymaxResolvePath = "/api/finance/transfers/paymax/resolve"

func TestPaymaxResolveGETIsPerUserRateLimited(t *testing.T) {
	// Supabase stub: the real RequireAuthContext middleware verifies the bearer
	// token against GET {baseURL}/auth/v1/user; echo the token back as the
	// subject so each test principal gets their own limiter bucket.
	authStub := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/auth/v1/user" {
			http.NotFound(w, r)
			return
		}
		token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"id":%q,"email":%q}`, token, token+"@test.dev")
	}))
	defer authStub.Close()

	// pgxpool.New is lazy: no connection is opened, so registration runs DB-free.
	pool, err := pgxpool.New(context.Background(), "postgres://postgres:postgres@127.0.0.1:1/postgres")
	if err != nil {
		t.Fatalf("pgxpool.New: %v", err)
	}
	defer pool.Close()

	gin.SetMode(gin.TestMode)
	r := gin.New()
	registerFinanceRoutes(r, config.Config{
		AppEnv:                        "test",
		DatabaseURL:                   "postgres://postgres:postgres@127.0.0.1:1/postgres",
		FeatureWalletTransfersEnabled: true,
		FinanceTransferRatePerMin:     1,
	}, integrations.NewSupabaseRestClient(authStub.URL, "test-key"), top5AdminRBAC{}, pool, nil, platformGuards{})

	if !routeExists(r, http.MethodGet, paymaxResolvePath) {
		t.Fatalf("resolve route missing from the mount: %s", paymaxResolvePath)
	}

	do := func(user string) int {
		// phone= is empty on purpose: the handler fails fast with 404
		// recipient_not_found before touching the store, so the only state
		// under test is the limiter's.
		req := httptest.NewRequest(http.MethodGet, paymaxResolvePath, nil)
		req.Header.Set("Authorization", "Bearer "+user)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w.Code
	}

	if c := do("u1"); c != http.StatusNotFound {
		t.Fatalf("first resolve must reach the handler (404 recipient_not_found on an empty phone), got %d", c)
	}
	if c := do("u1"); c != http.StatusTooManyRequests {
		t.Errorf("second resolve from the same user: %d, want 429 — the resolve oracle is unmetered (M1)", c)
	}
	if c := do("u2"); c != http.StatusNotFound {
		t.Errorf("another user has their own budget: %d", c)
	}
}
