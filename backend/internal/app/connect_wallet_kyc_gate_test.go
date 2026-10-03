package app

// Route-mount regression test for E2E-SEC-064: the Connect wallet/KYC surface
// (/api/v1/wallet/*, /api/v1/kyc/*, /api/v1/me/tier) used to mount whenever the
// pool existed, ignoring FEATURE_CONNECT_ENABLED entirely.
//
// Fix: the mount honors an EXPLICIT flag value — explicitly-false unmounts the
// surface (404 for an authenticated member), while an UNSET flag preserves the
// pre-existing behavior (mounted) so deployments that never had the variable
// do not lose their wallet endpoints on upgrade. The independent
// FEATURE_CONNECT_WALLET_FUND_ENABLED sub-gate on POST /wallet/fund is
// unchanged (see connect_wallet_fund_gate_test.go).
//
// pgxpool.New is lazy — no connection is opened until the first query, so the
// registration runs DB-free (see connect_wallet_fund_gate_test.go).

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/config"
)

// gatedConnectWalletEngine mirrors router.go: the wallet/KYC mount runs only
// when connectWalletKYCMountAllowed(cfg) — the same predicate the router uses.
func gatedConnectWalletEngine(t *testing.T, cfg config.Config) *gin.Engine {
	t.Helper()
	pool, err := pgxpool.New(context.Background(), "postgres://postgres:postgres@127.0.0.1:1/postgres")
	if err != nil {
		t.Fatalf("pgxpool.New: %v", err)
	}
	t.Cleanup(pool.Close)

	gin.SetMode(gin.TestMode)
	r := gin.New()
	if connectWalletKYCMountAllowed(cfg) {
		registerConnectWalletRoutes(r, cfg, nil, nil, authedStub(), pool, nil, nil)
	}
	return r
}

func mountedPaths(r *gin.Engine) map[string]bool {
	mounted := map[string]bool{}
	for _, rt := range r.Routes() {
		mounted[rt.Method+" "+rt.Path] = true
	}
	return mounted
}

var connectWalletKYCRoutes = []string{
	"GET /api/v1/wallet/summary",
	"GET /api/v1/wallet/history",
	"GET /api/v1/wallet/gifting/catalog",
	"GET /api/v1/kyc/status",
	"POST /api/v1/kyc/tier1",
	"GET /api/v1/me/tier",
	"GET /api/v1/wallet/payouts/eligibility",
}

func TestConnectWalletKYC_MountedWhenFlagUnset(t *testing.T) {
	// FeatureConnectFlagSet=false ⇔ FEATURE_CONNECT_ENABLED absent from env.
	r := gatedConnectWalletEngine(t, config.Config{})
	mounted := mountedPaths(r)
	for _, want := range connectWalletKYCRoutes {
		if !mounted[want] {
			t.Errorf("route missing with flag unset (legacy mount must be preserved): %s", want)
		}
	}
}

func TestConnectWalletKYC_UnmountedWhenFlagExplicitlyFalse(t *testing.T) {
	r := gatedConnectWalletEngine(t, config.Config{
		FeatureConnectFlagSet: true, // FEATURE_CONNECT_ENABLED=false in env
	})
	mounted := mountedPaths(r)
	for _, path := range connectWalletKYCRoutes {
		if mounted[path] {
			t.Errorf("route mounted while FEATURE_CONNECT_ENABLED is explicitly false: %s", path)
		}
	}

	// An authenticated member must get 404 — the surface does not exist.
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/wallet/summary", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("flag off: GET /api/v1/wallet/summary = %d, want 404", w.Code)
	}
}

func TestConnectWalletKYC_MountedWhenFlagExplicitlyTrue(t *testing.T) {
	r := gatedConnectWalletEngine(t, config.Config{
		FeatureConnectFlagSet: true,
		FeatureConnectEnabled: true,
	})
	mounted := mountedPaths(r)
	for _, want := range connectWalletKYCRoutes {
		if !mounted[want] {
			t.Errorf("route missing with flag explicitly true: %s", want)
		}
	}
}

func TestConnectWalletKYCMountAllowed_TruthTable(t *testing.T) {
	cases := []struct {
		name string
		cfg  config.Config
		want bool
	}{
		{"flag unset (legacy)", config.Config{}, true},
		{"explicitly false", config.Config{FeatureConnectFlagSet: true}, false},
		{"explicitly true", config.Config{FeatureConnectFlagSet: true, FeatureConnectEnabled: true}, true},
	}
	for _, tc := range cases {
		if got := connectWalletKYCMountAllowed(tc.cfg); got != tc.want {
			t.Errorf("%s: connectWalletKYCMountAllowed = %v, want %v", tc.name, got, tc.want)
		}
	}
}
