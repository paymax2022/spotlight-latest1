package app

import (
	"log"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/cashtag"
	"spotlight/backend/internal/escrow"
	financeledger "spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/savings"
	"spotlight/backend/internal/scheduler"
	"spotlight/backend/internal/services"
	"spotlight/backend/internal/social"
)

// RegisterSavings wires the Top-5 Phase-1 Savings module (vaults / Ajo-Esusu /
// group-target) onto the finance member group + a savings admin group. The
// orchestrator (finance_routes.go) calls this under FeatureSavingsEnabled; this
// file is the only wiring point and edits no existing file.
//
//   - member: /api/finance/savings/*  (member-authenticated; user_id mirrored)
//   - admin : /api/savings/admin/*     (member-authenticated; per-route RBAC savings.admin.*)
//
// It internally builds the shared spine it needs (scheduler + the reused finance
// ledger). The money path REUSES finance ledger primitives: vault/target/Ajo
// balances are append-only ledger projections (NL-8); deposits/contributions
// debit the main wallet into the shared escrow standing account and credit the
// sub-balance ledger; withdrawals/payouts reverse — Paymax never lends (NL-1),
// never pays yield (NL-2), and Ajo is peer-rotation only (NL-7). Every money leg
// is idempotent (NL-9). Auditing is nil-safe (the orchestrator may inject a sink).
func RegisterSavings(member *gin.RouterGroup, adminGroup *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService) {
	if pool == nil {
		log.Println("[savings] nil pool — skipping savings routes")
		return
	}

	// Reused finance ledger (money path) + shared scheduler (auto-save / Ajo cycles).
	ledgerSvc := financeledger.NewService(financeledger.NewRepository(pool), nil)
	sched := scheduler.NewService(pool)

	var auditor savings.Auditor = nil // optional immutable-audit sink (NL-12)

	vaultSvc := savings.NewVaultService(pool, ledgerSvc, sched, auditor)
	ajoSvc := savings.NewAjoService(pool, ledgerSvc, sched, auditor)
	targetSvc := savings.NewTargetService(pool, ledgerSvc, auditor)

	// Register durable scheduler job handlers (idempotent debits — NL-9).
	vaultSvc.RegisterAutoSave()
	ajoSvc.RegisterCycleRunner()

	guard := func(permission string) gin.HandlerFunc {
		return middleware.RequirePermission(rbac, permission)
	}

	handler := savings.NewHandler(vaultSvc, ajoSvc, targetSvc)
	handler.Register(member, adminGroup, guard)

	log.Println("[savings] routes registered — vaults / ajo / group-target + scheduler handlers live")
}

// RegisterSocialPay wires the Top-5 Phase-1 Social core (P2P send/request,
// split-bill, group pool) onto the finance member group + a social admin group.
// Called by the orchestrator under FeatureSocialPayEnabled.
//
//   - member: /api/finance/social/*  (member-authenticated; user_id mirrored)
//   - admin : /api/social/admin/*     (member-authenticated; per-route RBAC social.admin.*)
//
// It internally builds the cashtag directory and an escrow core (both shared
// spine). P2P/split/pool money moves through the reused finance ledger (NL-8),
// is idempotent (NL-9) and is gated by AML velocity limits (NL-10). Object-level
// authZ is enforced in the service (the session id is always the acting
// identity, so a user can never request/pay/payout as someone else).
func RegisterSocialPay(member *gin.RouterGroup, adminGroup *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService) {
	if pool == nil {
		log.Println("[social] nil pool — skipping social routes")
		return
	}

	ledgerSvc := financeledger.NewService(financeledger.NewRepository(pool), nil)
	tags := cashtag.NewService(pool)
	aml := social.NewAML(pool, social.DefaultAMLConfig())

	var auditor social.Auditor = nil

	// Escrow core (shared spine) — built here so social can park funds-holds for
	// P2P escrow in P3; the funds-hold state machine is ledger-backed + audited.
	_ = escrow.NewService(pool, ledgerSvc, nil)

	svc := social.NewService(pool, ledgerSvc, tags, aml, auditor)

	guard := func(permission string) gin.HandlerFunc {
		return middleware.RequirePermission(rbac, permission)
	}

	handler := social.NewHandler(svc, tags)
	handler.Register(member, adminGroup, guard)

	log.Println("[social] routes registered — cashtag / p2p / split / pool live")
}
