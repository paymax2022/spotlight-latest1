package app

import (
	"log"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/finance/wallet"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/placement"
	"spotlight/backend/internal/services"
)

// RegisterPlacement wires the Featured Placement module (paid landing-page promotion)
// onto the member finance group, an admin group, and a PUBLIC (unauthenticated) group.
// The orchestrator (finance_routes.go) calls this; this file edits no existing module.
//
//   - member : /api/finance/placement/*  (member-authenticated; user_id mirrored upstream)
//   - admin  : /api/placement/admin/*     (member-authenticated; per-route RBAC placement.admin.*)
//   - public : /api/finance/placement/*   (NO auth — landing resolver + analytics ingest)
//
// FeaturePlacementEnabled is enforced UPSTREAM by the caller. The money path REUSES the
// finance ledger primitives: HOLD = wallet.Debit (tier-checked) → PLACEMENT_ESCROW;
// REFUND = ledger.PostReversal (escrow → merchant wallet); RECOGNIZE = ledger.PostJournal
// (escrow → PLACEMENT_REVENUE). The standing accounts auto-create on first use.
//
// Dependency note: ledger/wallet/tiers are passed in (they are constructed once in
// finance_routes.go); pool + rbac are the shared infra. Eligibility external hooks
// default to the permissive impl (dev/CI) — see ExternalEligibility TODO.
func RegisterPlacement(
	member *gin.RouterGroup,
	admin *gin.RouterGroup,
	public *gin.RouterGroup,
	pool *pgxpool.Pool,
	rbac services.RBACService,
	ledgerSvc *ledger.Service,
	walletSvc *wallet.Service,
	tiersSvc *tiers.Service,
) {
	if pool == nil {
		log.Println("[placement] nil pool — skipping placement routes")
		return
	}

	svc := placement.NewService(placement.Deps{
		Repo:   placement.NewRepository(pool),
		Ledger: ledgerSvc,
		Wallet: walletSvc,
		Tiers:  tiersSvc,
		// External eligibility defaults to permissive (KYC/subject wiring is a TODO);
		// Config defaults to DefaultEligibilityConfig (cap/cooldown/creative enforced).
	})
	h := placement.NewHandler(svc)

	// --- Member routes (/api/finance/placement) ---
	mg := member.Group("/placement")
	mg.POST("/campaigns", h.CreateCampaign)
	mg.GET("/campaigns", h.ListCampaigns)
	mg.GET("/campaigns/:id", h.GetCampaign)
	mg.POST("/campaigns/:id/quote", h.Quote)
	mg.POST("/campaigns/:id/submit", h.Submit) // Idempotency-Key required
	mg.POST("/campaigns/:id/pay", h.Pay)       // Idempotency-Key required (PENDING_PAYMENT retry)
	mg.POST("/campaigns/:id/cancel", h.Cancel)
	mg.POST("/campaigns/:id/pause", h.Pause)
	mg.POST("/campaigns/:id/resume", h.Resume)
	mg.GET("/campaigns/:id/analytics", h.Analytics)
	mg.GET("/zones", h.Zones)

	// --- Admin routes (/api/placement/admin, per-route RBAC placement.admin.*) ---
	guard := func(permission string) gin.HandlerFunc {
		return middleware.RequirePermission(rbac, permission)
	}
	ag := admin.Group("")
	ag.GET("/review-queue", guard("placement.admin.review"), h.AdminReviewQueue)
	ag.GET("/campaigns/:id", guard("placement.admin.review"), h.AdminGetCampaign)
	ag.POST("/campaigns/:id/approve", guard("placement.admin.approve"), h.AdminApprove)
	ag.POST("/campaigns/:id/reject", guard("placement.admin.reject"), h.AdminReject)
	ag.POST("/campaigns/:id/request-info", guard("placement.admin.review"), h.AdminRequestInfo)
	ag.POST("/campaigns/:id/suspend", guard("placement.admin.suspend"), h.AdminSuspend)

	// --- Public routes (NO requireUserID): landing resolver + analytics ingest ---
	// Mounted on the root engine group (copy of the restaurant public-WS pattern):
	// consumer landing pages cannot send a Bearer, so these are unauthenticated.
	pg := public.Group("/placement")
	pg.GET("/landing", h.Landing)
	pg.POST("/events", h.Events)

	// Scheduler jobs (RunActivations/RunExpirations/RunReminders/RunReconciliation)
	// are exposed on the service; the orchestrator should schedule them on a ticker.
	// See placement.Scheduler doc + the TODO in scheduler.go for the wiring point.

	log.Println("[placement] routes registered — campaigns/quote/submit/approve saga + public landing/events")
}
