package app

import (
	"context"
	"errors"
	"log"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/config"
	connectaml "spotlight/backend/internal/connect/aml"
	connectgifting "spotlight/backend/internal/connect/gifting"
	connectpayouts "spotlight/backend/internal/connect/payouts"
	connectsafety "spotlight/backend/internal/connect/safety"
	connectvoting "spotlight/backend/internal/connect/voting"
	"spotlight/backend/internal/finance/commission"
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
//   - public: /api/v1/connect      (NO auth — same path prefix as member, but
//     the parent group itself, before connectAuth() was applied to member)
//
// Money path reuses the finance ledger/wallet: every mutation posts a balanced
// double-entry, requires an Idempotency-Key, is tier-checked fail-closed, emits
// an audit event, and is reported to AML. No money is mutated outside the ledger
// and no balance column is ever written.
//
// The orchestrator (connect_routes.go) calls this; this file is the only one the
// orchestrator wires in. It edits no existing file.
func RegisterConnectMoney(member *gin.RouterGroup, admin *gin.RouterGroup, public *gin.RouterGroup, cfg config.Config, pool *pgxpool.Pool, rbac services.RBACService) {
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
	payoutReverser := &connectPayoutReverseAdapter{ledger: ledgerSvc}

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
	// Admin-reporting-only tier lookup (read-only; see gifting/admin.go).
	giftSvc.SetTierReader(&connectTierGateAdapter{tiers: tiersSvc})
	connectgifting.Register(member, giftSvc)

	// --- Voting (free polls + paid voting) ---
	voteSvc := connectvoting.NewService(
		connectvoting.NewRepository(pool), walletSvc, revenue, audit, amlSvc)
	// ── Central Commission & Profit recording (§ profit registry) ──
	// When the commission feature is on, inject a nil-safe recorder so realized
	// paid-vote profit lands in commission_earnings for the profit report. The
	// recorder is built WITHOUT a ledger (nil ledgerService) on purpose: the paid-vote
	// debit already posts the money into paymax_revenue, so a second ledger post would
	// double-count. RecordFor therefore appends the earning ROW only. Recording is
	// best-effort and can never fail or reverse a vote (see recordCommissionSafe). Flag
	// off ⇒ no recorder is set ⇒ the seam stays nil ⇒ silent no-op.
	if cfg.FeatureCommissionEnabled {
		voteSvc.SetCommissionRecorder(commissionRecorderAdapter{svc: commission.NewService(commission.NewRepository(pool), nil)})
		log.Println("[connect-money] commission recording wired → Contest/Voting (earning-row only; no ledger re-post)")
	}
	connectvoting.Register(member, voteSvc, cfg)
	connectvoting.RegisterPublic(public, voteSvc, cfg)
	// Contest expiry loop — closes contests past their voting deadline so a
	// finished contest stops advertising itself as LIVE on the phone and in the
	// web list. Votes were already refused correctly by the closes_at window; this
	// makes the STATUS agree with that. House pattern for periodic work is a
	// background ticker (no pg_cron, no asynq scheduler in this repo).
	// context.Background(): this ticker lives for the process, and
	// RegisterConnectMoney takes no ctx — the same choice finance_routes.go makes
	// for StartReconScheduler. Widening the signature would ripple to the
	// orchestrator for no behavioural gain.
	connectvoting.StartExpiryCloser(context.Background(), pool, connectvoting.DefaultExpiryInterval)

	// --- Payouts (creator gift-revenue payout request) ---
	payoutSvc := connectpayouts.NewService(
		connectpayouts.NewRepository(pool), walletSvc, settlement, tierGate,
		nil, // settlement provider hook wired in production (stub: no auto-settle)
		audit, amlSvc, payoutReverser)
	connectpayouts.Register(member, payoutSvc)

	// --- Admin routes with RBAC (per-route permission checks) ---
	guard := func(permission string) gin.HandlerFunc {
		return middleware.RequirePermission(rbac, permission)
	}
	// Voting admin routes (eviction management, stage progression)
	connectvoting.RegisterAdmin(admin, voteSvc, guard, cfg)
	// AML admin routes
	connectaml.Register(admin, amlSvc, guard)
	// Gifting admin routes (CONNECT-001: gift-transactions ledger, read-only)
	connectgifting.RegisterAdmin(admin, giftSvc, guard)
	// Payouts admin routes (CONNECT-001: the member group only ever exposed
	// creator-facing POST/GET /payouts — there was no admin list/detail/
	// settle/reject surface at all, so the admin payout queue 404'd in
	// production). List/detail read-only; settle/reject are money-adjacent
	// (settle stamps the row only, reject reverses the parked ledger debit).
	connectpayouts.RegisterAdmin(admin, payoutSvc, guard)

	log.Println("[connect-money] routes registered — gifting/voting (+ eviction/stages)/aml/payouts (+ admin) live")
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

// connectPayoutReverseAdapter implements connectpayouts.PayoutReverser for the
// admin reject action. It reverses the parked settlement debit a payout
// Request() posted: a balanced REVERSAL_DEBIT/REVERSAL_CREDIT pair via
// ledger.PostReversal — money moves BACK from the standing settlement account
// to the creator's user_wallet. This is the mirror of connectSettlementAdapter
// (which resolves the same settlement account for the forward debit) and reuses
// the same ledger.Service — no new money-movement code, per CLAUDE.md.
//
// The idempotency key is deterministic (not a client-supplied header) so a
// retried admin request — or a double-click in the console — can never reverse
// the same payout twice; the ledger's own unique-constraint dedup makes the
// second call a safe no-op (see ledger.ErrDuplicate handling below).
type connectPayoutReverseAdapter struct{ ledger *ledger.Service }

func (r *connectPayoutReverseAdapter) ReversePayout(ctx context.Context, creatorID, payoutID string, amountKobo int64) error {
	if amountKobo <= 0 {
		return ledger.ErrInsufficientFunds
	}
	settleAcc, err := r.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountSettlement)
	if err != nil {
		return err
	}
	creatorWallet, err := r.ledger.GetOrCreateUserWallet(ctx, creatorID)
	if err != nil {
		return err
	}
	ref := "connect:payout:reject:" + payoutID
	idem := "connect:payout:reject:" + payoutID
	err = r.ledger.PostReversal(ctx, creatorWallet.ID, settleAcc.ID, amountKobo, ref, idem)
	if errors.Is(err, ledger.ErrDuplicate) {
		return nil // already reversed — idempotent success, mirrors connectRefundAdapter
	}
	return err
}
