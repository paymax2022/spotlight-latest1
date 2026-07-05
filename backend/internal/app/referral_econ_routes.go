package app

import (
	"log"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	financeledger "spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/referral/campaigns"
	referralevents "spotlight/backend/internal/referral/events"
	"spotlight/backend/internal/referral/gamification"
	referralledger "spotlight/backend/internal/referral/ledger"
	"spotlight/backend/internal/referral/merchant"
	"spotlight/backend/internal/referral/network"
	"spotlight/backend/internal/services"
)

// RegisterReferralEcon wires the Referral ECONOMY half (RB1) onto the same finance
// member group and referral admin group RB0 uses. The orchestrator calls this —
// it edits no existing file; it provides only this aggregator.
//
//   - member: /api/finance/referral/{campaigns,gamification,network}/*
//   - admin : /api/referral/admin/{campaigns,gamification,network,merchants}/*
//
// FeatureReferralsEnabled is enforced upstream by the parent finance group, so
// these routes inherit the same gate. Money paths reuse the finance + RB0 reward
// ledgers: campaign/mission/override rewards accrue via RB0 ledger.Accrue
// (idempotent); merchant funding posts a balanced double-entry with an
// Idempotency-Key. Gamification points are NON-CASH and never touch a wallet.
// Overrides are activity-based, capped server-side, and exclude house-attributed
// signups (referral_attributions.is_house) from the override base.
func RegisterReferralEcon(member *gin.RouterGroup, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService) {
	if pool == nil {
		log.Println("[referral-econ] nil pool — skipping referral economy routes")
		return
	}

	// Shared services (reuse RB0 + finance).
	financeLedgerSvc := financeledger.NewService(financeledger.NewRepository(pool), nil)
	eventsSvc := referralevents.NewService(pool)
	rewardSvc := referralledger.NewService(pool, financeLedgerSvc)

	// 1) Campaigns + budget governor.
	campaignSvc := campaigns.NewService(campaigns.NewRepository(pool), eventsSvc)
	campaigns.Register(member, admin, campaignSvc, rbac)

	// 2) Gamification (cash rewards via RB0 ledger; points non-cash).
	gamSvc := gamification.NewService(gamification.NewRepository(pool), rewardSvc)
	gamification.Register(member, admin, gamSvc, rbac)

	// 3) Ambassador/agent overrides (activity-based, capped, house-excluded).
	netSvc := network.NewService(network.NewRepository(pool), rewardSvc, eventsSvc)
	network.Register(member, admin, netSvc, rbac)

	// 4) Merchant-funded campaigns + partner API (settlement hook nil stub).
	merchantSvc := merchant.NewService(merchant.NewRepository(pool), financeLedgerSvc, nil)
	merchant.Register(admin, merchantSvc, rbac)

	log.Println("[referral-econ] routes registered — campaigns/gamification/network/merchant live")
}
