package app

import (
	"log"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	financeledger "spotlight/backend/internal/finance/ledger"
	referralevents "spotlight/backend/internal/referral/events"
	referralledger "spotlight/backend/internal/referral/ledger"

	referralanalytics "spotlight/backend/internal/referral/analytics"
	referralcompliance "spotlight/backend/internal/referral/compliance"
	referralfinance "spotlight/backend/internal/referral/finance"
	referralrisk "spotlight/backend/internal/referral/risk"

	"spotlight/backend/internal/services"
)

// RegisterReferralTrust wires the Referral TRUST/FINANCE half (RB2) onto the same
// finance member group and referral admin group RB0/RB1 use. The orchestrator
// calls this — it edits no existing file; it provides only this aggregator
// (mirrors RegisterReferral / RegisterReferralEcon exactly).
//
//   - member: /api/finance/referral/{risk,compliance}/*
//   - admin : /api/referral/admin/{risk,compliance,finance,analytics,users}/*
//
// FeatureReferralsEnabled is enforced upstream by the parent finance group, so
// these routes inherit the same gate. Money paths reuse the finance + RB0 reward
// ledgers: clawbacks post reversing entries through the RB0 ledger (audited);
// payouts post a balanced double-entry to the beneficiary wallet with a unique
// Idempotency-Key. ANALYTICS/K-factor EXCLUDE house rows (excluded_from_kfactor =
// true OR is_house = true) per §7A.6 — house_default is a separate segment.
func RegisterReferralTrust(member *gin.RouterGroup, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService) {
	if pool == nil {
		log.Println("[referral-trust] nil pool — skipping referral trust routes")
		return
	}

	// Shared services (reuse RB0 + finance). Redis nil → ledger unique constraint
	// still enforces idempotency on every posting.
	financeLedgerSvc := financeledger.NewService(financeledger.NewRepository(pool), nil)
	eventsSvc := referralevents.NewService(pool)
	rewardSvc := referralledger.NewService(pool, financeLedgerSvc)

	// 1) Risk / fraud — rules engine, alerts, cases, blocklist, review queue,
	//    clawbacks via the RB0 reward ledger.
	riskSvc := referralrisk.NewService(referralrisk.NewRepository(pool), rewardSvc, eventsSvc)
	referralrisk.Register(member, admin, riskSvc, rbac)

	// 2) Compliance — versioned disclosures, NDPC consents, AML, structural policy,
	//    earnings-claim review, regulatory export.
	compSvc := referralcompliance.NewService(referralcompliance.NewRepository(pool))
	referralcompliance.Register(member, admin, compSvc, rbac)

	// 3) Finance / payouts — Tier/KYC-gated idempotent payout queue posting to the
	//    wallet via the finance ledger; reconciliation; budgets/burn; float; LTV.
	finSvc := referralfinance.NewService(referralfinance.NewRepository(pool), financeLedgerSvc, eventsSvc)
	referralfinance.Register(admin, finSvc, rbac)

	// 4) Analytics — K-factor (house-excluded), funnel, CAC, cohorts, channels,
	//    organic-vs-referred segmentation, user-360.
	anaSvc := referralanalytics.NewService(referralanalytics.NewRepository(pool))
	referralanalytics.Register(admin, anaSvc, rbac)

	log.Println("[referral-trust] routes registered — risk/compliance/finance/analytics live")
}
