package app

import (
	"context"
	"log"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	financeledger "spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/referrals"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// RegisterReferralRewards wires the Direct Referral Rewards ENGINE (single-level,
// purchase-triggered) onto the ROOT engine at NEW prefixes, leaving the older §7A
// /api/finance/referral routes intact (additive brownfield rule):
//
//   - user   : /v1/referrals/*                 (Bearer; object-level authZ = own data)
//   - admin  : /v1/admin/referrals/*           (Bearer; per-route RBAC referral.admin.*)
//   - internal:/internal/referrals/*           (service-to-service; X-Internal-Secret)
//
// Gated upstream by FeatureReferralRewardsEnabled + a non-nil pool (see
// finance_routes.go). The money path REUSES the finance ledger: ongoing-share
// rewards CREDIT the referrer wallet with a balanced double-entry keyed on the
// reward id; refunds post a balanced REVERSAL; milestone bonuses credit once,
// idempotently. Nothing here edits an existing file beyond the single call site.
//
// internalSecret guards the /internal hooks (empty ⇒ hooks fail closed). authMW is
// RequireAuthContext (validates the bearer + mirrors user_id).
func RegisterReferralRewards(
	r *gin.Engine,
	pool *pgxpool.Pool,
	rbac services.RBACService,
	authMW gin.HandlerFunc,
	internalSecret string,
) *referrals.RewardService {
	if pool == nil {
		log.Println("[referral-rewards] nil pool — skipping engine routes")
		return nil
	}

	// Reused finance ledger (Redis nil here → the ledger unique idempotency
	// constraint still enforces at-most-once postings).
	ledgerSvc := financeledger.NewService(financeledger.NewRepository(pool), nil)
	svc := referrals.NewRewardService(pool, ledgerSvc)
	h := referrals.NewRewardHandler(svc, internalSecret)

	// --- User API (/v1/referrals) — Bearer auth; object-level authZ in handlers ---
	user := r.Group("/v1/referrals")
	user.Use(authMW)
	user.Use(requireUserID())
	user.POST("/link", h.PostLink)
	user.POST("/attribute", h.PostAttribute)
	user.GET("/me/dashboard", h.GetDashboard)
	user.GET("/me/referrals", h.GetReferrals)
	user.GET("/me/earnings", h.GetEarnings)
	user.GET("/me/milestones", h.GetMilestones)

	// --- Admin API (/v1/admin/referrals) — per-route RBAC referral.admin.* ---
	guard := func(permission string) gin.HandlerFunc {
		return middleware.RequirePermission(rbac, permission)
	}
	admin := r.Group("/v1/admin/referrals")
	admin.Use(authMW)
	admin.Use(requireUserID())
	admin.GET("/config", guard("referral.admin.config"), h.AdminGetConfig)               // A1
	admin.PUT("/config", guard("referral.admin.config"), h.AdminPutConfig)               // A1
	admin.GET("/analytics", guard("referral.admin.analytics"), h.AdminAnalytics)         // A2
	admin.GET("/fraud-queue", guard("referral.admin.fraud"), h.AdminFraudQueue)          // A3
	admin.POST("/fraud-queue", guard("referral.admin.fraud"), h.AdminFraudAction)        // A3
	admin.GET("/ledger", guard("referral.admin.ledger"), h.AdminLedger)                  // A4
	admin.GET("/:referrerId/case", guard("referral.admin.case"), h.AdminGetCase)         // A5
	admin.POST("/:referrerId/case", guard("referral.admin.case"), h.AdminAdjustCase)     // A5
	admin.GET("/milestones-log", guard("referral.admin.milestones"), h.AdminMilestonesLog) // A6
	admin.GET("/module-status", guard("referral.admin.module"), h.AdminModuleStatus)     // A7

	// --- Internal hooks (/internal/referrals) — service-to-service shared secret ---
	// Both the in-process Service.OnPurchase{Settled,Refunded} hooks AND these HTTP
	// endpoints are the integration contract (PRD §7). No user auth; X-Internal-Secret
	// verified inside the handler (fail-closed when unset).
	internal := r.Group("/internal/referrals")
	internal.POST("/purchase-settled", h.PostPurchaseSettled)
	internal.POST("/purchase-refunded", h.PostPurchaseRefunded)
	internal.POST("/recalc-tiers", h.PostRecalcTiers)

	// --- Nightly recalc scheduler ---
	// No shared cron scheduler exists for this concern (the FX StartReconScheduler is
	// module-local), so we start a ctx-scoped daily ticker here, mirroring the
	// StartTreasuryMonitor / StartReconScheduler pattern in finance_routes.go. The
	// POST /internal/referrals/recalc-tiers trigger above remains available for an
	// external cron. NOTE: in a multi-instance deployment, run the recalc from ONE
	// instance (external cron hitting recalc-tiers) to avoid duplicate sweeps; the
	// milestone/tier writes are idempotent so a double-run is safe but wasteful.
	startReferralRecalcScheduler(context.Background(), svc, 24*time.Hour)

	log.Println("[referral-rewards] engine routes registered — /v1/referrals + /v1/admin/referrals + /internal/referrals; nightly recalc ticker started")
	return svc
}

// startReferralRecalcScheduler runs RecalculateTiers on a fixed interval until ctx
// is cancelled. First run fires after one interval (not at boot) to avoid competing
// with startup. Errors are logged, not fatal.
func startReferralRecalcScheduler(ctx context.Context, svc *referrals.RewardService, every time.Duration) {
	go func() {
		t := time.NewTicker(every)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				if err := svc.RecalculateTiers(ctx); err != nil {
					log.Printf("[referral-rewards] nightly recalc error: %v", err)
				}
			}
		}
	}()
}
