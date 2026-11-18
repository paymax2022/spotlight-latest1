package app

// Route-mount regression test for the FX virtual cards vertical. Commit 254229cf4
// (remove Maplerad) unmounted every /api/v1/fx/cards* route and dropped
// WithCards(...) from the orchestration handler chain, but kept the CardStore,
// the handlers and the orch_fx_cards tables. The mobile Cards screen then got a
// 404 from the BFF and rendered "Couldn't load cards". The store and handlers
// both support a nil issuer (synthesized card material / stubs), so the routes
// are safe to mount without a card-issuing provider.

import (
	"context"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/config"
)

func TestFXCardRoutesMounted(t *testing.T) {
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
		FeatureFXOrchestrationEnabled: true,
	}, nil, nil, pool, nil, platformGuards{})

	for _, want := range []struct{ method, path string }{
		{"GET", "/api/v1/fx/cards"},
		{"POST", "/api/v1/fx/cards"},
		{"GET", "/api/v1/fx/cards/:id"},
		{"GET", "/api/v1/fx/cards/:id/transactions"},
		{"POST", "/api/v1/fx/cards/:id/reveal"},
		{"POST", "/api/v1/fx/cards/:id/fund"},
		{"POST", "/api/v1/fx/cards/:id/freeze"},
		{"POST", "/api/v1/fx/cards/:id/unfreeze"},
		{"POST", "/api/v1/fx/cards/:id/terminate"},
		{"PATCH", "/api/v1/fx/cards/:id/controls"},
	} {
		if !routeExists(r, want.method, want.path) {
			t.Errorf("card route missing: %s %s", want.method, want.path)
		}
	}
}
