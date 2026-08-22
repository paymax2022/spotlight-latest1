package modulegate

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

type stubSource struct {
	keys []string
	err  error
	n    int
}

func (s *stubSource) VisibleKeys(context.Context) ([]string, error) {
	s.n++
	return s.keys, s.err
}

func serve(t *testing.T, h gin.HandlerFunc, path string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(h)
	r.Any("/*any", func(c *gin.Context) { c.String(http.StatusOK, "reached") })
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
	return w
}

// TestModuleForResolvesOnlyVerifiedPrefixes: the map is partial by design, so an
// unmapped path must resolve to "" (allow) rather than to a near-miss module.
func TestModuleForResolvesOnlyVerifiedPrefixes(t *testing.T) {
	cases := map[string]string{
		"/api/finance/wallet":           "wallet",
		"/api/finance/wallet/balance":   "wallet",
		"/api/finance/transfers/paymax": "walletTransfers", // NOT "wallet"
		"/api/finance/va/provision":     "virtualAccounts", // name != prefix
		"/api/v1/pharmacy/orders":       "healthPharmacy",
		"/api/finance/unmapped-thing":   "",
		"/api/v1/trading/orders":        "",
		"/":                             "",
	}
	for path, want := range cases {
		if got := ModuleFor(path); got != want {
			t.Errorf("ModuleFor(%q) = %q, want %q", path, got, want)
		}
	}
}

// TestModuleForRequiresAPathBoundary: "/api/finance/wallets-export" must not be
// attributed to the "wallet" module — a substring match would 503 an unrelated route.
func TestModuleForRequiresAPathBoundary(t *testing.T) {
	for _, p := range []string{"/api/finance/wallets", "/api/finance/wallet-export", "/api/finance/savingsx"} {
		if got := ModuleFor(p); got != "" {
			t.Errorf("ModuleFor(%q) = %q, want \"\" — prefix matching must respect path boundaries", p, got)
		}
	}
}

// TestAdminPathsAreNeverGated: administering a module is exactly what you do while it
// is hidden. Gating /admin would make a hidden module impossible to publish.
func TestAdminPathsAreNeverGated(t *testing.T) {
	src := &stubSource{keys: []string{}} // nothing published at all
	h := New(src, Options{Enabled: true})
	for _, p := range []string{
		"/api/finance/admin/kyc",
		"/api/restaurant/admin/delivery-config",
		"/api/finance/restaurant/admin",
	} {
		if w := serve(t, h, p); w.Code != http.StatusOK {
			t.Errorf("%s -> %d, want 200; admin surfaces must never be gated", p, w.Code)
		}
	}
}

// TestUnpublishedModuleIsRefused is the whole point of the gate.
func TestUnpublishedModuleIsRefused(t *testing.T) {
	src := &stubSource{keys: []string{"wallet"}} // savings NOT published
	h := New(src, Options{Enabled: true})

	if w := serve(t, h, "/api/finance/wallet/balance"); w.Code != http.StatusOK {
		t.Errorf("published module -> %d, want 200", w.Code)
	}
	w := serve(t, h, "/api/finance/savings/vaults")
	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("unpublished module -> %d, want 503", w.Code)
	}
	if body := w.Body.String(); body == "reached" {
		t.Error("handler ran for an unpublished module — the gate did not abort")
	}
}

// TestDisabledGateObservesButAllows: the rollout switch must let the map be validated
// against real traffic before it can cost an outage.
func TestDisabledGateObservesButAllows(t *testing.T) {
	src := &stubSource{keys: []string{}}
	h := New(src, Options{Enabled: false})
	if w := serve(t, h, "/api/finance/savings/vaults"); w.Code != http.StatusOK {
		t.Errorf("gate disabled -> %d, want 200 (observe-only)", w.Code)
	}
}

// TestRegistryFailureAllowsTraffic: refusing every module because a config table is
// unreadable converts a small fault into a total outage. Fail OPEN, loudly.
func TestRegistryFailureAllowsTraffic(t *testing.T) {
	src := &stubSource{err: errors.New("db down")}
	h := New(src, Options{Enabled: true})
	if w := serve(t, h, "/api/finance/savings/vaults"); w.Code != http.StatusOK {
		t.Errorf("registry unreadable -> %d, want 200 (fail open)", w.Code)
	}
}

// TestEmptyRegistryIsNotTreatedAsUnreadable: a genuinely empty published set MUST
// refuse. Conflating "nothing published" with "cannot read" would make the gate
// silently ineffective in exactly the state it matters most.
func TestEmptyRegistryIsNotTreatedAsUnreadable(t *testing.T) {
	src := &stubSource{keys: []string{}} // successful read, nothing published
	h := New(src, Options{Enabled: true})
	if w := serve(t, h, "/api/finance/savings/vaults"); w.Code != http.StatusServiceUnavailable {
		t.Errorf("empty-but-readable registry -> %d, want 503", w.Code)
	}
}

// TestCacheBoundsRegistryReads: a per-request query would put a DB round trip in front
// of every API call in the product.
func TestCacheBoundsRegistryReads(t *testing.T) {
	src := &stubSource{keys: []string{"wallet"}}
	h := New(src, Options{Enabled: true, TTL: time.Hour})
	for i := 0; i < 25; i++ {
		serve(t, h, "/api/finance/wallet/balance")
	}
	if src.n != 1 {
		t.Errorf("registry read %d times for 25 requests, want 1 (cached)", src.n)
	}
}
