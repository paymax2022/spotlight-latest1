package core

import (
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/health/triage"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// RegisterHealthTriageCore wires the AI Symptom Checker CORE orchestration onto
// the finance member group + a health admin group. The integration owner calls
// this from the aggregator under the triage feature flag — this file edits no
// existing routing file.
//
//   - member: /api/finance/health/triage/*  (member-authenticated; user_id mirrored)
//   - admin : /api/health/admin/* + RBAC health.triage.admin (per route)
//
// Dependency injection (nil → mock-first / deterministic safety net):
//   - engine    nil → triage.MockEngine            (licensed engine when configured)
//   - extractor nil → triage.MockExtractor          (LLM extractor when configured)
//   - redflag   nil → LayeredRedFlag(Default, nil)  (deterministic SC-2 safety net)
//
// The vault + audit sinks are wired by the orchestrator (nil is safe). The engine
// always runs DE-IDENTIFIED (SC-7) and the red-flag layer always overrides toward
// higher urgency (SC-2/SC-3) regardless of which engine is injected.
func RegisterHealthTriageCore(
	member, admin *gin.RouterGroup,
	pool *pgxpool.Pool,
	rbac services.RBACService,
	engine triage.EngineProvider,
	extractor triage.EvidenceExtractor,
	redflag triage.RedFlagEngine,
) {
	if pool == nil {
		return
	}
	if engine == nil {
		engine = triage.MockEngine{}
	}
	if extractor == nil {
		extractor = triage.MockExtractor{}
	}
	if redflag == nil {
		redflag = NewLayeredRedFlag(triage.DefaultRedFlagEngine{}, nil)
	}

	// Audit + vault sinks are left nil here; the orchestrator may inject them via a
	// NewSessionService call instead, but the default wiring is nil-safe (SC-12
	// auditing degrades to no-op rather than failing the money/no-money path).
	svc := NewSessionService(pool, engine, extractor, redflag, nil, nil)
	h := NewHandler(svc)

	// --- Member routes (/api/finance/health/triage) — BARE subpaths ---
	g := member.Group("/health/triage")
	g.GET("/profiles", h.ListProfiles)
	g.POST("/profiles", h.CreateProfile)
	g.POST("/sessions", h.StartSession)
	g.POST("/sessions/:id/intake", h.SubmitIntake)
	g.POST("/sessions/:id/answer", h.Answer)
	g.GET("/sessions/:id", h.GetSession)

	// --- Admin routes (/api/health/admin, RBAC health.triage.admin) ---
	if admin != nil {
		ag := admin.Group("/triage")
		ag.GET("/sessions/:id",
			middleware.RequirePermission(rbac, "health.triage.admin"), h.GetSession)
	}
}
