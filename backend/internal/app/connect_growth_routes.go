package app

import (
	"context"
	"log"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	connectcreator "spotlight/backend/internal/connect/creator"
	connectevents "spotlight/backend/internal/connect/events"
	connectmonetization "spotlight/backend/internal/connect/monetization"
	connectprofessional "spotlight/backend/internal/connect/professional"
	connectsafety "spotlight/backend/internal/connect/safety"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/finance/wallet"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// registerConnectGrowthRoutes wires Paymax Connect Phases 2,3,4,6 onto the
// member + admin route groups created by the Connect orchestrator
// (connect_routes.go, read-only here for the auth/RBAC patterns). Both groups
// already have RequireAuthContext applied and c.Set("user_id", ...) populated.
//
//   - member: /api/v1/connect  (member-authenticated)
//   - admin : /api/connect/admin (member-authenticated; per-route RBAC added here)
//
// Money path (Phase 6) reuses the finance ledger/wallet: balanced double-entry,
// idempotency-keyed, tier-checked, audited. No money is mutated outside the
// ledger; entitlements are enforced server-side.
func registerConnectGrowthRoutes(member *gin.RouterGroup, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService) {
	if pool == nil {
		log.Println("[connect-growth] nil pool — skipping Connect growth routes")
		return
	}

	// --- Shared audit hook (reuses the Phase 0 connect_audit_log writer) ---
	safetySvc := connectsafety.NewService(pool)
	audit := &auditAdapter{svc: safetySvc}

	// --- Finance stack (REUSED for the Phase 6 money path) ---
	// Redis is nil here: idempotency is still enforced by the ledger unique
	// constraint (idempotency_key) — the Redis fast-path is an optimisation only.
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)
	tiersSvc := tiers.NewService(pool)
	walletSvc := wallet.NewService(ledgerSvc, tiersSvc)
	revenue := &revenueAdapter{ledger: ledgerSvc}

	// ── Phase 2 — Professional ────────────────────────────────────────────────
	proSvc := connectprofessional.NewService(pool, audit)
	pro := connectprofessional.NewHandler(proSvc)
	p := member.Group("/professional")
	p.GET("/profile", pro.GetProfile)
	p.PATCH("/profile", pro.UpsertProfile)
	p.POST("/verification", pro.RequestVerification) // encrypted evidence_ref only
	p.GET("/discovery", pro.Discover)
	p.POST("/intro", pro.SendIntro) // consent-before-messaging
	p.POST("/intro/:id/respond", pro.RespondIntro)
	p.PATCH("/business-card", pro.UpsertCard)
	p.POST("/contacts", pro.ExchangeCard) // requires accepted intro
	p.GET("/contacts", pro.ListContacts)
	p.POST("/rooms", pro.CreateRoom)
	p.POST("/rooms/:id/join", pro.JoinRoom)
	p.POST("/rooms/:id/moderate", pro.ModerateRoom)

	// ── Phase 3 — Event networking (reuses events/event_tickets) ──────────────
	evSvc := connectevents.NewService(pool, audit)
	ev := connectevents.NewHandler(evSvc)
	e := member.Group("/events")
	e.POST("/:id/networking/opt-in", ev.OptIn) // explicit opt-in
	e.GET("/:id/attendees", ev.Attendees)      // opt-in-privacy discovery
	e.POST("/:id/checkin", ev.CheckIn)
	e.POST("/:id/qr/scan", ev.ScanQR) // organiser scans ticket QR
	e.POST("/:id/contacts", ev.SaveContact)
	e.GET("/contacts", ev.ListContacts) // follow-up

	// ── Phase 4 — Creator ─────────────────────────────────────────────────────
	crSvc := connectcreator.NewService(pool, audit)
	cr := connectcreator.NewHandler(crSvc)
	cg := member.Group("/creator")
	cg.GET("/profile", cr.GetProfile)
	cg.PATCH("/profile", cr.UpsertProfile)
	cg.POST("/portfolio", cr.AddPortfolio) // moderated before public
	cg.GET("/portfolio", cr.ListPortfolio)
	cg.POST("/verification", cr.RequestVerification) // encrypted evidence_ref only
	cg.PATCH("/fan-messages", cr.SetFanPolicy)       // server-side fan control
	cg.POST("/collab-requests", cr.SubmitCollab)
	cg.GET("/collab-requests", cr.ListCollabs)
	cg.POST("/collab-requests/:id/respond", cr.RespondCollab)

	// ── Phase 6 — Monetization (Paymax wallet; server-side entitlements) ───────
	monSvc := connectmonetization.NewService(pool, walletSvc, revenue, audit)
	mon := connectmonetization.NewHandler(monSvc)
	mg := member.Group("/")
	mg.GET("/plans", mon.ListPlans)
	mg.POST("/subscriptions", mon.Subscribe) // Idempotency-Key required
	mg.POST("/boosts", mon.BuyBoost)         // Idempotency-Key required
	mg.POST("/passes", mon.BuyPass)          // Idempotency-Key required
	mg.GET("/entitlements", mon.Entitlements)
	mg.POST("/date-plans/:id/ride", mon.BookRide)       // reuses Mobility + wallet
	mg.POST("/date-plans/:id/tickets", mon.BookTickets) // reuses Events + wallet

	// ── Admin (per-route RBAC) ────────────────────────────────────────────────
	admin.POST("/business/verification",
		middleware.RequirePermission(rbac, "connect.business.review"), pro.AdminReviewVerification)
	admin.GET("/creator/verification",
		middleware.RequirePermission(rbac, "connect.creator.view"), cr.AdminVerificationQueue)
	admin.POST("/creator/verification",
		middleware.RequirePermission(rbac, "connect.creator.review"), cr.AdminReviewVerification)
	admin.POST("/plans",
		middleware.RequirePermission(rbac, "connect.plans.manage"), mon.AdminUpsertPlan)
	admin.GET("/orders",
		middleware.RequirePermission(rbac, "connect.payments.reconcile"), mon.AdminListOrders)

	log.Println("[connect-growth] routes registered — professional/events/creator/monetization live")
}

// auditAdapter bridges the per-package Auditor interface to the Phase 0
// connect_audit_log writer (connect_safety.Service.WriteAudit). Every money
// mutation and admin decision flows through here.
type auditAdapter struct{ svc *connectsafety.Service }

func (a *auditAdapter) WriteAudit(ctx context.Context, action, actorID, entityType, entityID string, newValue map[string]any) error {
	return a.svc.WriteAudit(ctx, connectsafety.AuditInput{
		ActorID:    actorID,
		Action:     action,
		EntityType: entityType,
		EntityID:   entityID,
		NewValue:   newValue,
	})
}

// revenueAdapter resolves the standing paymax_revenue ledger account that Connect
// purchases credit (the debit side is the buyer's user wallet).
type revenueAdapter struct{ ledger *ledger.Service }

func (r *revenueAdapter) RevenueAccountID(ctx context.Context) (string, error) {
	acc, err := r.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		return "", err
	}
	return acc.ID, nil
}
