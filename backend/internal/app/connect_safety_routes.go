package app

import (
	"log"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	connectchat "spotlight/backend/internal/connect/chat"
	connectdatesafety "spotlight/backend/internal/connect/datesafety"
	connectmoderation "spotlight/backend/internal/connect/moderation"
	connectsafety "spotlight/backend/internal/connect/safety"
	connecttrust "spotlight/backend/internal/connect/trust"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// registerConnectSafetyRoutes wires the Phase-1 safety + Phase-5 trust surface
// for Paymax Connect: chat (mutual-match-gated), report/block, the date-safety
// center, the guardrailed AI assistant, scam-shield, and the admin moderation
// queues. The orchestrator (registerConnectRoutes in connect_routes.go) calls
// this with the already-auth-wrapped member group and the admin group, so this
// function does NOT re-create auth — it adds per-route RBAC for admin routes only.
//
// Gating: the whole Connect surface is already behind cfg.FeatureConnectEnabled
// and the 18+/consent onboarding gate at the orchestrator level; these routes
// inherit that. Admin routes are deny-by-default via RequirePermission.
//
// Signature is fixed by the build contract:
//
//	func registerConnectSafetyRoutes(member *gin.RouterGroup, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService)
func registerConnectSafetyRoutes(member *gin.RouterGroup, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService) {
	// Shared backbones.
	safetySvc := connectsafety.NewService(pool)
	safetyHandler := connectsafety.NewHandler(safetySvc)

	cfgReader := connecttrust.NewConfigReader(pool)
	shield := connecttrust.NewShieldStore(pool, cfgReader, safetySvc)
	coach := connecttrust.NewAICoach(pool, connecttrust.NewStubLLM())
	trustHandler := connecttrust.NewHandler(coach, shield)

	chatSvc := connectchat.NewService(pool, cfgReader, shield, safetySvc)
	chatHandler := connectchat.NewHandler(chatSvc)

	dateSvc := connectdatesafety.NewService(pool, safetySvc)
	dateHandler := connectdatesafety.NewHandler(dateSvc)

	modSvc := connectmoderation.NewService(pool, safetySvc)
	modHandler := connectmoderation.NewHandler(modSvc)

	// ── Member routes (auth already applied by the orchestrator) ──────────────
	// Chat: available ONLY after a mutual match (enforced in the chat service).
	member.POST("/matches/:matchId/conversation", chatHandler.OpenConversation)
	member.GET("/conversations/:id/messages", chatHandler.ListMessages)
	member.POST("/conversations/:id/messages", chatHandler.SendMessage)

	// Report/block (report handler is the existing one; block is the additive one).
	member.POST("/safety/block", safetyHandler.Block)
	member.DELETE("/safety/block/:blockedId", safetyHandler.Unblock)

	// Date-safety center.
	member.GET("/safety/trusted-contacts", dateHandler.ListContacts)
	member.POST("/safety/trusted-contacts", dateHandler.AddContact)
	member.DELETE("/safety/trusted-contacts/:id", dateHandler.DeleteContact)
	member.POST("/date-plans", dateHandler.CreatePlan)
	member.POST("/date-plans/:id/share", dateHandler.Share)
	member.POST("/date-plans/:id/checkin", dateHandler.CheckIn)
	member.POST("/date-plans/:id/feedback", dateHandler.Feedback)

	// Guardrailed AI assistant (Phase 5).
	member.POST("/ai/assist", trustHandler.AIGenerate)

	// ── Admin routes (auth applied by orchestrator; RBAC per route here) ───────
	admin.GET("/moderation/conversations",
		middleware.RequirePermission(rbac, "connect.moderation.view"),
		modHandler.ListFlaggedConversations)
	admin.GET("/moderation/messages",
		middleware.RequirePermission(rbac, "connect.moderation.view"),
		modHandler.ListFlaggedMessages)
	admin.GET("/moderation/decisions",
		middleware.RequirePermission(rbac, "connect.moderation.view"),
		modHandler.ListDecisions)
	admin.POST("/moderation/decisions",
		middleware.RequirePermission(rbac, "connect.moderation.manage"),
		modHandler.RecordDecision)
	admin.PATCH("/moderation/conversations/:id",
		middleware.RequirePermission(rbac, "connect.moderation.manage"),
		modHandler.SetConversationState)
	admin.GET("/scam-shield",
		middleware.RequirePermission(rbac, "connect.moderation.view"),
		trustHandler.ListShieldFlags)

	log.Println("[connect] safety+trust routes registered — chat, block, date-safety, AI, moderation")
}
