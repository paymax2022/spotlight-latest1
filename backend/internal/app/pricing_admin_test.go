package app

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/config"
	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

type denyAllRBAC struct{ services.RBACService }

func (denyAllRBAC) CheckPermission(string, string, string, string) (bool, error) { return false, nil }

func pricingAdminProbe(t *testing.T, cfg config.Config, pool *pgxpool.Pool, path string) (mounted bool, code int) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	auth := func(c *gin.Context) {
		c.Set("user_id", "u1")
		c.Set(middleware.AuthUserContextKey, domain.AuthenticatedUser{ID: "u1"})
		c.Next()
	}
	mounted = mountPricingAdmin(r, &cfg, pool, denyAllRBAC{}, auth, nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
	return mounted, w.Code
}

// Flag off => nothing mounted (404). Flag on => mounted and permission-gated
// (an authenticated admin lacking finance.admin.pricing gets 403, never data).
func TestMountPricingAdmin_FlagGated(t *testing.T) {
	pool, err := pgxpool.New(t.Context(), "postgres://u:p@127.0.0.1:1/none") // lazy: never dials
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)

	paths := []string{
		"/api/finance/admin/fx/rate-card", "/api/finance/admin/fx/fee-schedule", "/api/finance/admin/fx/guardrails",
		"/api/finance/admin/fx/collection-settings", "/api/finance/admin/fx/refund-policy", "/api/finance/admin/fx/spread",
	}
	for _, p := range paths {
		if m, code := pricingAdminProbe(t, config.Config{FeatureSpotlightGlobalEnabled: false}, pool, p); m || code != http.StatusNotFound {
			t.Errorf("flag off %s: mounted=%v code=%d, want unmounted 404", p, m, code)
		}
		if m, code := pricingAdminProbe(t, config.Config{FeatureSpotlightGlobalEnabled: true}, pool, p); !m || code != http.StatusForbidden {
			t.Errorf("flag on %s: mounted=%v code=%d, want mounted 403", p, m, code)
		}
	}
	// Flag on but no DB pool -> inert.
	if m, code := pricingAdminProbe(t, config.Config{FeatureSpotlightGlobalEnabled: true}, nil, paths[0]); m || code != http.StatusNotFound {
		t.Errorf("no pool: mounted=%v code=%d, want unmounted", m, code)
	}
}
