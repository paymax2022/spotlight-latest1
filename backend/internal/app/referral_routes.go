package app

import (
	"context"
	"log"
	"spotlight/backend/internal/handlers"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	financeledger "spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/referrals"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/referral/attribution"
	referralconfig "spotlight/backend/internal/referral/config"
	referralevents "spotlight/backend/internal/referral/events"
	referralhouse "spotlight/backend/internal/referral/house"
	"spotlight/backend/internal/referral/invite"
	referralledger "spotlight/backend/internal/referral/ledger"
	"spotlight/backend/internal/services"
)

// RegisterReferral wires the §7A Referral Earning core onto the finance member
// group and a referral admin group. The orchestrator (finance_routes.go) calls
// this — this file is the only one wired in; it edits no existing file.
//
//   - member: /api/finance/referral/*  (member-authenticated; user_id mirrored)
//   - admin : /api/referral/admin/*    (member-authenticated; per-route RBAC referral.*)
//
// FeatureReferralsEnabled is enforced upstream by the parent finance group, so
// these routes inherit the same gate. Money path reuses the finance ledger: real
// payouts post balanced double-entries with idempotency keys; house accruals are
// notional (non-withdrawable), excluded from override chains and K-factor.
// NewSignupAttributor builds the §7A attribution service AND the Module 8
// Direct Referral Rewards engine's own attribution step, composed into the one
// function the auth handler calls on every registration (Go-backed signups —
// today, every frontend-web and mobile-app signup — funnel through here; this
// is the single point where "every user has a referrer" actually becomes true
// for all of them, rather than depending on each client separately remembering
// to call POST /v1/referrals/attribute after signup).
//
// §7A runs FIRST exactly as before (unchanged behavior: its own house/global
// fallback chain, config, events, K-factor accounting). Module 8's
// AttributeOrDefault runs SECOND and CLAIMS §7A's placeholder row when §7A
// left referrer_id NULL (its house-fallback shape) — seeing referrer_id NULL,
// Module 8 sets it to a real referrer or to Admin (see
// RewardService.claimOrRespectAttribution) — and awards the one-time signup
// point. Neither step's failure blocks the other or the registration itself;
// each is logged independently with its own tag so a failure is attributable.
//
// Returns nil on a nil pool, and the handler then skips attribution rather than
// failing signup.
func NewSignupAttributor(pool *pgxpool.Pool) handlers.ReferralAttributor {
	if pool == nil {
		return nil
	}
	legacySvc := newAttributionService(pool)
	ledgerSvc := financeledger.NewService(financeledger.NewRepository(pool), nil)
	rewardSvc := referrals.NewRewardService(pool, ledgerSvc)
	return func(ctx context.Context, userID, referralCode string) error {
		if _, err := legacySvc.ResolveReferrer(ctx, userID, attribution.ResolveOpts{CodeEntered: referralCode}); err != nil {
			log.Printf("[referral] §7A attribution failed for %s: %v", userID, err)
		}
		if _, _, _, err := rewardSvc.AttributeOrDefault(ctx, userID, referralCode); err != nil {
			log.Printf("[referral] Module 8 attribution failed for %s: %v", userID, err)
		} else if err := rewardSvc.AwardSignupPoints(ctx, userID); err != nil {
			log.Printf("[referral] Module 8 signup points failed for %s: %v", userID, err)
		}
		return nil
	}
}

// newAttributionService assembles the §7A dependency graph. Extracted so signup
// and the referral routes build it the same way instead of drifting.
func newAttributionService(pool *pgxpool.Pool) *attribution.Service {
	financeLedgerSvc := financeledger.NewService(financeledger.NewRepository(pool), nil)
	codeSvc := referrals.NewService(pool, financeLedgerSvc)
	cfgSvc := referralconfig.NewService(pool)
	eventsSvc := referralevents.NewService(pool)
	houseSvc := referralhouse.NewService(pool)
	rewardSvc := referralledger.NewService(pool, financeLedgerSvc)
	return attribution.NewService(pool, codeSvc, houseSvc, rewardSvc, cfgSvc, eventsSvc)
}

func RegisterReferral(member *gin.RouterGroup, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService) {
	if pool == nil {
		log.Println("[referral] nil pool — skipping referral routes")
		return
	}

	// Finance ledger (reused for real reward payouts; Redis nil → ledger unique
	// constraint still enforces idempotency).
	financeLedgerSvc := financeledger.NewService(financeledger.NewRepository(pool), nil)

	// Reuse the existing referral-code seed as the CodeResolver (do not break it).
	codeSvc := referrals.NewService(pool, financeLedgerSvc)

	// §7A core services.
	cfgSvc := referralconfig.NewService(pool)
	eventsSvc := referralevents.NewService(pool)
	houseSvc := referralhouse.NewService(pool)
	rewardSvc := referralledger.NewService(pool, financeLedgerSvc)
	// Durable audit for the withdraw money mutation → referral events sink.
	rewardSvc.SetAuditSink(func(ctx context.Context, event, userID string, payload map[string]any, idem string) error {
		return eventsSvc.Record(ctx, referralevents.Input{
			EventType:      event,
			UserID:         userID,
			Payload:        payload,
			IdempotencyKey: idem,
		})
	})
	attribSvc := attribution.NewService(pool, codeSvc, houseSvc, rewardSvc, cfgSvc, eventsSvc)

	cfgHandler := referralconfig.NewHandler(cfgSvc)
	houseHandler := referralhouse.NewHandler(houseSvc, pool)
	rewardHandler := referralledger.NewHandler(rewardSvc)
	attribHandler := attribution.NewHandler(attribSvc, pool)
	inviteHandler := invite.NewHandler(pool)

	// --- Member routes (/api/finance/referral) ---
	// `member` is ALREADY the /referral group (see finance_routes.go); grouping
	// "/referral" again mounted these eight routes at
	// /api/finance/referral/referral/*, which no client could reach — the sibling
	// Register fns (Econ, Trust) correctly use `member` directly.
	mg := member
	mg.GET("/config", cfgHandler.Get)                      // config-read
	mg.GET("/my-attribution", attribHandler.MyAttribution) // M-ONB-10 result
	mg.POST("/claim-code", attribHandler.ClaimCode)        // M-INV-10 late claim
	mg.GET("/my-rewards", rewardHandler.MySummary)         // M-HOME-03 summary
	mg.GET("/withdraw-eligible", rewardHandler.MyEligible) // eligible balance
	mg.POST("/withdraw", rewardHandler.MyWithdraw)         // sweep eligible → wallet
	mg.GET("/invite/vanity", inviteHandler.ListVanity)     // M-INV-05 list vanity links
	mg.POST("/invite/vanity", inviteHandler.CreateVanity)  // M-INV-05 create vanity link

	// --- Admin routes (/api/referral/admin, per-route RBAC referral.*) ---
	guard := func(permission string) gin.HandlerFunc {
		return middleware.RequirePermission(rbac, permission)
	}
	ag := admin.Group("")
	ag.GET("/config",
		guard("referral.config.view"), cfgHandler.Get)
	ag.PUT("/config",
		guard("referral.config.manage"), cfgHandler.Update)
	ag.GET("/house",
		guard("referral.house.view"), houseHandler.GetGlobal)
	ag.GET("/house/ledger",
		guard("referral.house.view"), houseHandler.Ledger)
	ag.GET("/reassignments",
		guard("referral.attribution.reassign"), attribHandler.ListReassignments)
	ag.POST("/reassignments",
		guard("referral.attribution.reassign"), attribHandler.Reassign)
	ag.GET("/ledger",
		guard("referral.ledger.view"), rewardHandler.AdminList)

	log.Println("[referral] routes registered — §7A attribution/house/ledger/config live")
}
