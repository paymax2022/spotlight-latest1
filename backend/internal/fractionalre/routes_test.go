package fractionalre

// Route-table regression: every handler must actually be mounted. pgxpool.New
// is lazy — the pool never dials — so Register() can run fully offline and the
// gin engine's route table is asserted directly.

import (
	"context"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestRegister_MountsRoundLifecycleRoutes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	pool, err := pgxpool.New(context.Background(), "postgres://127.0.0.1:1/unused")
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	t.Cleanup(pool.Close)

	r := gin.New()
	if svc := Register(r, Deps{DB: pool, Enabled: true}); svc == nil {
		t.Fatal("Register returned nil with flag on and a pool")
	}

	want := map[string]string{
		"POST": "/api/finance/fractionalre/admin/rounds/:id/open",
	}
	// Guard the whole lifecycle surface, not just the regression: build the set
	// of mounted method+path pairs and assert each expected route is present.
	mounted := map[string]bool{}
	for _, ri := range r.Routes() {
		mounted[ri.Method+" "+ri.Path] = true
	}
	expected := []string{
		"POST /api/finance/fractionalre/admin/sponsors",
		"POST /api/finance/fractionalre/admin/assets",
		"POST /api/finance/fractionalre/admin/assets/:id/title-verify",
		"POST /api/finance/fractionalre/admin/assets/:id/transition",
		"POST /api/finance/fractionalre/admin/assets/:id/rounds",
		"POST /api/finance/fractionalre/admin/rounds/:id/open",
		"POST /api/finance/fractionalre/admin/rounds/:id/close",
		"POST /api/finance/fractionalre/admin/rounds/:id/refund",
		"POST /api/finance/fractionalre/admin/rounds/:id/allocate",
		"POST /api/finance/fractionalre/admin/distributions",
		"POST /api/finance/fractionalre/admin/distributions/:id/approve",
		"POST /api/finance/fractionalre/offerings/:id/subscribe",
		"POST /api/finance/fractionalre/market/list",
		"POST /api/finance/fractionalre/market/listings/:id/buy",
	}
	for _, e := range expected {
		if !mounted[e] {
			t.Errorf("route not mounted: %s", e)
		}
	}
	if !mounted["POST "+want["POST"]] {
		t.Error("rounds/:id/open missing")
	}
}
