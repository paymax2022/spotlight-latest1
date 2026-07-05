package app

import (
	"log"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	financeledger "spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/integrations"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
	"spotlight/backend/internal/spotlightwealth"
)

// RegisterSpotlightwealthRoutes wires the Spotlight Wealth module under
// /api/v1/spotlight/* — the exact base path the mobile spotlightwealth feature
// calls (mobile-app/reactnative/src/features/spotlightwealth/api/spotlight.api.ts).
// The group carries RequireAuthContext (bearer validated; user_id mirrored onto
// the gin context), matching the invest/learn convention.
//
// Reads (videos / challenges / leaderboard / reward-wallet / campaigns) are
// education-first. The one money path — completing a challenge — pays WALLET
// CREDIT redistributed from the paymax_revenue standing account through the
// shared finance double-entry ledger under an Idempotency-Key (never minted;
// NL-1/NL-8/NL-9). Leaderboards rank LEARNING points, never profit.
func RegisterSpotlightwealthRoutes(r *gin.Engine, supabase *integrations.SupabaseRestClient, rbac services.RBACService, pool *pgxpool.Pool) {
	if pool == nil {
		log.Println("[spotlightwealth] nil pool — skipping spotlight routes")
		return
	}

	// Reuse the finance ledger (money path) — challenge rewards are ledger-posted.
	ledgerSvc := financeledger.NewService(financeledger.NewRepository(pool), nil)

	svc := spotlightwealth.NewService(pool, ledgerSvc, nil) // nil audit sink (nil-safe)
	h := spotlightwealth.NewHandler(svc)

	g := r.Group("/api/v1/spotlight")
	g.Use(middleware.RequireAuthContext(supabase, rbac))
	spotlightwealth.RegisterSpotlightwealth(g, h)

	log.Println("[spotlightwealth] routes registered — videos / challenges / leaderboard / reward-wallet / campaigns live under /api/v1/spotlight")
}
