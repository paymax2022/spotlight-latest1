package app

import (
	"context"
	"log"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/config"
	connectassess "spotlight/backend/internal/connect/networking/assessments"
	connectfeed "spotlight/backend/internal/connect/networking/feed"
	connectjobs "spotlight/backend/internal/connect/networking/jobs"
	connectmentor "spotlight/backend/internal/connect/networking/mentorship"
	connectnetprofile "spotlight/backend/internal/connect/networking/profile"
	connectsafety "spotlight/backend/internal/connect/safety"
	"spotlight/backend/internal/finance/commission"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/finance/wallet"
	"spotlight/backend/internal/loyalty"
	"spotlight/backend/internal/points"
	"spotlight/backend/internal/services"
)

// registerConnectNetworkRoutes wires Paymax Connect Phase 6 networking (jobs/company
// pages/referral bounties, content feed, network profile + recommendations, skill
// assessments, mentorship) onto the member + admin route groups created by the
// Connect orchestrator (connect_routes.go). Both groups already carry
// RequireAuthContext + the c.Set("user_id", ...) mirror; the parent enforces the
// FeatureConnectEnabled gate before calling here.
//
// All five packages are normalized to the single base prefix /networking:
//
//	member: /api/v1/connect/networking/*
//	admin : /api/connect/admin/networking/*
//
// Money path (jobs paid-posting fee + referral bounty payout) REUSES the finance
// ledger/wallet: balanced double-entry, Idempotency-Key required, tier-limit
// fail-closed, audited. The loyalty rail is the single Paymax Black emit seam (PN-8) —
// no second currency. This file edits no existing package; it only constructs the
// narrow ports and calls each package's Register.
func registerConnectNetworkRoutes(member, admin *gin.RouterGroup, cfg config.Config, pool *pgxpool.Pool, rbac services.RBACService) {
	if pool == nil {
		log.Println("[connect-network] nil pool — skipping Connect networking routes")
		return
	}

	// --- Shared audit hook (reuses the Phase 0 connect_audit_log writer via the
	// auditAdapter defined in connect_growth_routes.go — same package). It satisfies
	// every networking package's Auditor (WriteAudit) interface.
	safetySvc := connectsafety.NewService(pool)
	audit := &auditAdapter{svc: safetySvc}

	// --- Finance spine (REUSED for the Phase 6 money path). Redis is nil: idempotency
	// is enforced by the ledger unique constraint (idempotency_key); the Redis
	// fast-path is an optimisation only. *wallet.Service.Debit and *ledger.Service.Credit
	// structurally satisfy connectjobs.WalletDebiter / connectjobs.LedgerCrediter, so
	// the concrete services are passed directly (no adapter needed).
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)
	tiersSvc := tiers.NewService(pool)
	walletSvc := wallet.NewService(ledgerSvc, tiersSvc)

	// --- Loyalty rail (single Paymax Black currency, PN-8). Points/loyalty carry their
	// own audit sink (LogAction, distinct from connect WriteAudit); we pass nil here as
	// the top-5 loyalty wiring does — the connect audit trail is the injected auditAdapter.
	ptsSvc := points.NewService(pool, nil)
	loySvc := loyalty.NewService(pool, ptsSvc, nil)
	loyaltyPort := &networkLoyaltyAdapter{svc: loySvc}

	// --- Standing ledger accounts the jobs money path posts against.
	revenue := &networkRevenueResolver{ledger: ledgerSvc}

	// --- Central Commission & Profit recording (§ profit registry). When the
	// commission feature is on, build a nil-safe recorder so a paid job activation's
	// realized profit lands in commission_earnings under Community/Job. Built WITHOUT a
	// ledger (nil) on purpose: the paid-posting fee debit already books the full fee
	// into paymax_revenue, so a second ledger post would double-count — RecordFor
	// appends the earning ROW only. Flag off ⇒ the seam stays nil ⇒ silent no-op.
	// Declared through the connectjobs.CommissionRecorder interface so the zero value
	// is a true nil interface (avoids the typed-nil trap).
	var jobsCommission connectjobs.CommissionRecorder
	if cfg.FeatureCommissionEnabled {
		jobsCommission = commissionRecorderAdapter{svc: commission.NewService(commission.NewRepository(pool), nil)}
		log.Println("[connect-network] commission recording wired → Community/Job (earning-row only; no ledger re-post)")
	}

	// ── Register all five packages under the normalized /networking prefix ──────────
	connectjobs.Register(member, admin, pool, rbac, walletSvc, ledgerSvc, revenue, loyaltyPort, audit, jobsCommission)
	connectfeed.Register(member, admin, pool, rbac, audit)
	connectnetprofile.Register(member, admin, pool, rbac, audit)
	connectassess.Register(member, admin, pool, rbac, loyaltyPort, audit)
	connectmentor.Register(member, admin, pool, rbac, loyaltyPort, audit)

	log.Println("[connect-network] routes registered — jobs/feed/profile/assessments/mentorship under /networking")
}

// networkRevenueResolver resolves the standing ledger accounts the jobs module posts
// against: paymax_revenue (credited when a paid job-posting fee debits the poster's
// wallet) and referral_reward_expense (debited as the counterpart of the CREDIT to a
// referrer's wallet when a bounty is paid out). Implements connectjobs.RevenueResolver.
type networkRevenueResolver struct{ ledger *ledger.Service }

func (r *networkRevenueResolver) RevenueAccountID(ctx context.Context) (string, error) {
	acc, err := r.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		return "", err
	}
	return acc.ID, nil
}

func (r *networkRevenueResolver) ReferralExpenseAccountID(ctx context.Context) (string, error) {
	acc, err := r.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountReferralReward)
	if err != nil {
		return "", err
	}
	return acc.ID, nil
}

// networkLoyaltyAdapter is the single Paymax Black emit seam (PN-8). It wraps
// loyalty.Service.AwardFor (which returns *points.Entry) behind the narrow
// AwardFor(ctx, userID, module, trigger, ref) error port shared by the jobs,
// assessments, and mentorship packages, discarding the entry.
type networkLoyaltyAdapter struct{ svc *loyalty.Service }

func (l *networkLoyaltyAdapter) AwardFor(ctx context.Context, userID, module, trigger, ref string) error {
	_, err := l.svc.AwardFor(ctx, userID, module, trigger, points.EarnContext{
		Module:    module,
		Reference: ref,
	})
	return err
}
