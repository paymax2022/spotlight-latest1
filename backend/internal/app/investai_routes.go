package app

import (
	"log"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/config"
	"spotlight/backend/internal/integrations"
	"spotlight/backend/internal/investai"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// RegisterInvestAIRoutes wires the InvestAI education assistant under
// /api/v1/ai/invest/* — the exact base path the mobile investai feature calls
// (mobile-app/reactnative/src/features/investai/api/ai.api.ts). The route group
// carries RequireAuthContext, which validates the bearer token and mirrors
// user_id onto the gin context (OLA on every endpoint).
//
// The assistant is education-first: it explains how investing works and refuses
// advice-seeking prompts server-side. Every assistant turn is disclaimered. No
// money path is involved. The AIProvider is the real Anthropic client (reused from
// internal/aicare) when ANTHROPIC_API_KEY is set, otherwise a deterministic mock.
func RegisterInvestAIRoutes(r *gin.Engine, cfg config.Config, supabase *integrations.SupabaseRestClient, rbac services.RBACService, pool *pgxpool.Pool) {
	if pool == nil {
		log.Println("[investai] nil pool — skipping investai routes")
		return
	}

	svc := investai.NewService(pool, investai.NewProvider(cfg.AnthropicAPIKey))
	h := investai.NewHandler(svc)

	g := r.Group("/api/v1/ai/invest")
	g.Use(middleware.RequireAuthContext(supabase, rbac))
	investai.RegisterInvestAI(g, h)

	provider := "mock"
	if cfg.AnthropicAPIKey != "" {
		provider = "anthropic"
	}
	log.Printf("[investai] routes registered under /api/v1/ai/invest (provider=%s)", provider)
}
