package app

import (
	"context"
	"log"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	connectaml "spotlight/backend/internal/connect/aml"
	connectgifting "spotlight/backend/internal/connect/gifting"
	connectpayouts "spotlight/backend/internal/connect/payouts"
	connectsafety "spotlight/backend/internal/connect/safety"
	connectvoting "spotlight/backend/internal/connect/voting"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/finance/wallet"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// RegisterConnectMoney wires the Paymax Connect money path (gifting, voting,
// AML, payouts) onto the member + admin route groups created by the Connect
// orchestrator (connect_routes.go). Both groups already have RequireAuthContext
// applied and c.Set("user_id", ...) populated; FeatureConnectEnabled is enforced
// upstream by the parent group, so these routes inherit the same gate.
//
//   - member: /api/v1/connect      (member-authenticated)
//   - admin : /api/connect/admin   (member-authenticated; per-route RBAC added here)
//
// Money path reuses the finance ledger/wallet: every mutation posts a balanced
// double-entry, requires an Idempotency-Key, is tier-checked fail-closed, emits
// an audit event, and is reported to AML. No money is mutated outside the ledger
// and no balance column is ever written.
//
// The orchestrator (connect_routes.go) calls this; this file is the only one the
// orchestrator wires in. It edits no existing file.
func RegisterConnectMoney(member *gin.RouterGroup, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService) {
	if pool == nil {
		log.Println("[connect-money] nil pool — skipping Connect money routes")
		return
	}

	// --- Shared audit hook (reuses the Phase 0 connect_audit_log writer) ---
	safetySvc := connectsafety.NewService(pool)
	audit := &connectMoneyAuditAdapter{svc: safetySvc}

	// --- Finance stack (REUSED for the money path) ---
	// Redis is nil here: idempotency is still enforced by the ledger unique
	// constraint (idempotency_key); the Redis fast-path is an optimisation only.
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)
	tiersSvc := tiers.NewService(pool)
	walletSvc := wallet.NewService(ledgerSvc, tiersSvc)

	revenue := &connectRevenueAdapter{ledger: ledgerSvc}
	settlement := &connectSettlementAdapter{ledger: ledgerSvc}
	transfer := &connectWalletTransferAdapter{ledger: ledgerSvc}
	tierGate := &connectTierGateAdapter{tiers: tiersSvc}

	// --- AML monitoring + NFIU case scaffold (hooks shared by all money flows) ---
	amlSvc := connectaml.NewService(
		connectaml.NewRepository(pool),
		audit,
		connectaml.NoopScreener{}, // production wires a real sanctions/PEP screener
		connectaml.DefaultThresholds(),
	)

	// --- Gifting (wallet→wallet real-Naira gift) ---
	giftSvc := connectgifting.NewService(
		connectgifting.NewRepository(pool), transfer, tiersSvc, audit, amlSvc)
	connectgifting.Register(member, giftSvc)

	// --- Voting (free polls + paid voting) ---
	voteSvc := connectvoting.NewService(
		connectvoting.NewRepository(pool), walletSvc, revenue, audit, amlSvc)
	connectvoting.Register(member, voteSvc)

	// --- Payouts (creator gift-revenue payout request) ---
	payoutSvc := connectpayouts.NewService(
		connectpayouts.NewRepository(pool), walletSvc, settlement, tierGate,
		nil, // settlement provider hook wired in production (stub: no auto-settle)
		audit, amlSvc)
	connectpayouts.Register(member, payoutSvc)

	// --- AML admin (per-route RBAC connect.aml.*) ---
	guard := func(permission string) gin.HandlerFunc {
		return middleware.RequirePermission(rbac, permission)
	}
	connectaml.Register(admin, amlSvc, guard)

	log.Println("[connect-money] routes registered — gifting/voting/aml/payouts live")
}

// connectMoneyAuditAdapter bridges the per-package Auditor interface to the
// Phase 0 connect_audit_log writer (connect_safety.Service.WriteAudit).
type connectMoneyAuditAdapter struct{ svc *connectsafety.Service }

func (a *connectMoneyAuditAdapter) WriteAudit(ctx context.Context, action, actorID, entityType, entityID string, newValue map[string]any) error {
	return a.svc.WriteAudit(ctx, connectsafety.AuditInput{
		ActorID:    actorID,
		Action:     action,
		EntityType: entityType,
		EntityID:   entityID,
		NewValue:   newValue,
	})
}

// connectRevenueAdapter resolves the standing paymax_revenue ledger account that
// paid-vote revenue credits.
type connectRevenueAdapter struct{ ledger *ledger.Service }

func (r *connectRevenueAdapter) RevenueAccountID(ctx context.Context) (string, error) {
	acc, err := r.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		return "", err
	}
	return acc.ID, nil
}

// connectSettlementAdapter resolves the standing settlement account that creator
// payout debits are parked in pending bank settlement.
type connectSettlementAdapter struct{ ledger *ledger.Service }

func (s *connectSettlementAdapter) SettlementAccountID(ctx context.Context) (string, error) {
	acc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountSettlement)
	if err != nil {
		return "", err
	}
	return acc.ID, nil
}

// connectWalletTransferAdapter performs a wallet→wallet transfer as a single
// balanced double-entry via the ledger: DR sender user_wallet, CR recipient
// user_wallet, keyed by idempotencyKey. It checks the sender's available balance
// first and posts immutable entries — it never writes a balance column.
type connectWalletTransferAdapter struct{ ledger *ledger.Service }

func (t *connectWalletTransferAdapter) Transfer(ctx context.Context, fromUserID, toUserID, reference, idempotencyKey string, amountKobo int64) error {
	if amountKobo <= 0 {
		return ledger.ErrInsufficientFunds
	}
	fromAcc, err := t.ledger.GetOrCreateUserWallet(ctx, fromUserID)
	if err != nil {
		return err
	}
	toAcc, err := t.ledger.GetOrCreateUserWallet(ctx, toUserID)
	if err != nil {
		return err
	}
	// Available-balance check on the sender (ledger projection; no balance column).
	balance, err := t.ledger.GetBalance(ctx, fromUserID)
	if err != nil {
		return err
	}
	if balance < amountKobo {
		return ledger.ErrInsufficientFunds
	}
	// Balanced double-entry, idempotent (ledger unique constraint on the key).
	return t.ledger.PostJournal(ctx, ledger.JournalEntry{
		Reference:       reference,
		IdempotencyKey:  idempotencyKey,
		AmountKobo:      amountKobo,
		DebitAccountID:  fromAcc.ID,
		CreditAccountID: toAcc.ID,
	})
}

// connectTierGateAdapter adapts tiers.Service.GetUserTier (returns tiers.Tier) to
// the payouts TierGate interface (returns int).
type connectTierGateAdapter struct{ tiers *tiers.Service }

func (g *connectTierGateAdapter) GetUserTier(ctx context.Context, userID string) (int, error) {
	t, err := g.tiers.GetUserTier(ctx, userID)
	if err != nil {
		return 0, err
	}
	return int(t), nil
}
