package app

import (
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/integrations/llm"
	"spotlight/backend/internal/nutrition"
	"spotlight/backend/internal/services"
)

// registerNutritionRoutes wires the Nutrition Resolution Engine (NRE). It is the
// app-layer wrapper that builds the Tier-3 LLM client (claude-sonnet-4-6, per the
// playbook) the same way the estate/restaurant blocks do, then delegates to
// nutrition.RegisterNutrition. An empty ANTHROPIC_API_KEY yields a disabled
// client; the engine then falls back to the deterministic nutrition mock so it
// resolves end-to-end without a key.
//
// apiKey is cfg.AnthropicAPIKey (already present in config). member is the authed
// finance group; admin is /api/nutrition/admin (already carries requireUserID()).
func registerNutritionRoutes(member, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService, apiKey string) {
	llmClient := llm.NewAnthropicClient(apiKey).WithModel("claude-sonnet-4-6")
	nutrition.RegisterNutrition(member, admin, pool, rbac, llmClient)
}
