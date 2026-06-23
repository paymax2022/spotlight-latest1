package invest

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// ─────────────────────────────────────────────────────────────────────────────
// Reconciliation: compare the investment ledger against order/settlement state
// and surface exceptions for the Finance / Trading-Ops admins. The mock broker
// settles synchronously, so in steady state broker-clearing nets to ~zero; with
// a real broker this is where unmatched balances and stuck settlements show up.
// ─────────────────────────────────────────────────────────────────────────────

// ReconSummary is the headline reconciliation view.
type ReconSummary struct {
	BrokerClearingNetKobo  int64 `json:"broker_clearing_net_kobo"`  // standing clearing account balance
	FeeIncomeKobo          int64 `json:"fee_income_kobo"`           // total commission captured
	UserCashKobo           int64 `json:"user_cash_total_kobo"`      // all users' available cash
	LockedCashKobo         int64 `json:"locked_cash_total_kobo"`    // cash locked for pending buys
	SettlementSuspenseKobo int64 `json:"settlement_suspense_kobo"`  // owed to users post-sell, pre-release
	ExternalFundingNetKobo int64 `json:"external_funding_net_kobo"` // net deposited (≈ user cash + invested)
	StuckSettlements       int   `json:"stuck_settlements"`         // PendingSettlement past due + grace
	TrappedFunds           int   `json:"trapped_funds"`             // terminal orders still holding locks
	Balanced               bool  `json:"balanced"`                  // double-entry integrity holds
}

// standingBalance projects a standing (system) account's balance.
func (r *Repository) standingBalance(ctx context.Context, accType string) (int64, error) {
	const q = `SELECT COALESCE(SUM(
		CASE WHEN e.type IN ('CREDIT','REVERSAL_DEBIT') THEN e.amount_kobo ELSE -e.amount_kobo END),0)
		FROM invest_ledger_entries e JOIN invest_ledger_accounts a ON a.id=e.account_id
		WHERE a.user_id IS NULL AND a.type=$1`
	var v int64
	err := r.db.QueryRow(ctx, q, accType).Scan(&v)
	return v, err
}

// typeBalance projects the aggregate balance across ALL accounts of a type
// (used for per-user account types summed across users).
func (r *Repository) typeBalance(ctx context.Context, accType string) (int64, error) {
	const q = `SELECT COALESCE(SUM(
		CASE WHEN e.type IN ('CREDIT','REVERSAL_DEBIT') THEN e.amount_kobo ELSE -e.amount_kobo END),0)
		FROM invest_ledger_entries e JOIN invest_ledger_accounts a ON a.id=e.account_id
		WHERE a.type=$1`
	var v int64
	err := r.db.QueryRow(ctx, q, accType).Scan(&v)
	return v, err
}

// ledgerBalanced verifies global double-entry integrity: the signed sum of every
// entry across every account must be exactly zero.
func (r *Repository) ledgerBalanced(ctx context.Context) (bool, error) {
	const q = `SELECT COALESCE(SUM(
		CASE WHEN type IN ('CREDIT','REVERSAL_DEBIT') THEN amount_kobo ELSE -amount_kobo END),0)
		FROM invest_ledger_entries`
	var net int64
	if err := r.db.QueryRow(ctx, q).Scan(&net); err != nil {
		return false, err
	}
	return net == 0, nil
}

// StuckSettlements returns orders that should have settled but haven't (their
// settlement_due_at is older than cutoff). With the mock broker this is
// normally empty. Passing a concrete cutoff timestamp avoids interval parsing.
func (r *Repository) StuckSettlements(ctx context.Context, cutoff time.Time, limit int) ([]Order, error) {
	const q = "SELECT " + orderCols + ` FROM invest_orders
		WHERE status='PendingSettlement' AND settlement_due_at IS NOT NULL
		  AND settlement_due_at < $1
		ORDER BY settlement_due_at LIMIT $2`
	rows, err := r.db.Query(ctx, q, cutoff, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Order{}
	for rows.Next() {
		var o Order
		if err := scanOrder(rows, &o); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

// TrappedFunds returns terminal-status orders that still report a non-zero lock
// — an invariant violation the failed-order release path should prevent.
func (r *Repository) TrappedFunds(ctx context.Context, limit int) ([]Order, error) {
	const q = "SELECT " + orderCols + ` FROM invest_orders
		WHERE status IN ('Failed','Rejected','Cancelled')
		  AND (locked_cash_kobo > 0 OR locked_quantity > 0)
		ORDER BY updated_at DESC LIMIT $1`
	rows, err := r.db.Query(ctx, q, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Order{}
	for rows.Next() {
		var o Order
		if err := scanOrder(rows, &o); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

// Reconciliation assembles the full summary.
func (r *Repository) Reconciliation(ctx context.Context) (*ReconSummary, []Order, []Order, error) {
	var s ReconSummary
	var err error
	if s.BrokerClearingNetKobo, err = r.standingBalance(ctx, AcctBrokerClearing); err != nil {
		return nil, nil, nil, err
	}
	if s.FeeIncomeKobo, err = r.standingBalance(ctx, AcctFeeIncome); err != nil {
		return nil, nil, nil, err
	}
	if s.ExternalFundingNetKobo, err = r.standingBalance(ctx, AcctExternalFunding); err != nil {
		return nil, nil, nil, err
	}
	if s.UserCashKobo, err = r.typeBalance(ctx, AcctCash); err != nil {
		return nil, nil, nil, err
	}
	if s.LockedCashKobo, err = r.typeBalance(ctx, AcctLockedCash); err != nil {
		return nil, nil, nil, err
	}
	if s.SettlementSuspenseKobo, err = r.typeBalance(ctx, AcctSettlement); err != nil {
		return nil, nil, nil, err
	}
	if s.Balanced, err = r.ledgerBalanced(ctx); err != nil {
		return nil, nil, nil, err
	}
	stuck, err := r.StuckSettlements(ctx, time.Now().Add(-time.Hour), 100)
	if err != nil {
		return nil, nil, nil, err
	}
	trapped, err := r.TrappedFunds(ctx, 100)
	if err != nil {
		return nil, nil, nil, err
	}
	s.StuckSettlements = len(stuck)
	s.TrappedFunds = len(trapped)
	return &s, stuck, trapped, nil
}

// Reconciliation HTTP handler (admin, RBAC-gated by the router).
func (h *AdminHandler) Reconciliation(c *gin.Context) {
	summary, stuck, trapped, err := h.svc.repo.Reconciliation(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"summary":           summary,
		"stuck_settlements": stuck,
		"trapped_funds":     trapped,
	})
}
