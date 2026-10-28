package crypto

import (
	"context"
	"fmt"
	"time"
)

// ReconciliationReport is the output of a swap reconciliation run comparing
// ledger projections vs. Quidax-reported state. Read-only; used for audit
// and drift investigation. No money moves in reconciliation.
type ReconciliationReport struct {
	RunAt              time.Time                 `json:"run_at"`
	TotalOrders        int                       `json:"total_orders"`
	ReconcilledOrders  int                       `json:"reconcilled_orders"` // "executing" or "completed" + ledger_settled
	DriftOrders        int                       `json:"drift_orders"`       // Status mismatch or settlement lag
	FailedOrders       int                       `json:"failed_orders"`
	Orders             []OrderReconciliationRow  `json:"orders,omitempty"`
	Summary            string                    `json:"summary"`
}

// OrderReconciliationRow is one row in a reconciliation report: one order's state.
type OrderReconciliationRow struct {
	OrderID           string     `json:"order_id"`
	UserID            string     `json:"user_id"`
	Status            string     `json:"status"`             // Order status (executing/completed/failed)
	LedgerSettled     bool       `json:"ledger_settled"`     // CR-014: marked as settled
	SwapTransactionID string     `json:"swap_transaction_id"` // Quidax transaction ID
	ProviderStatus    string     `json:"provider_status"`     // Quidax-reported status (from webhook)
	SettledAt         *time.Time `json:"settled_at,omitempty"`
	Drift             string     `json:"drift,omitempty"` // Non-empty if drift detected
}

// ReconcileSwapOrders compares ledger projections vs. Quidax state for all
// swap orders and returns a drift report. Read-only: no money moves. Used
// for audit and drift investigation. Includes all orders; details flag adds
// per-order rows (empty list if details=false).
func (s *Service) ReconcileSwapOrders(ctx context.Context, details bool) (*ReconciliationReport, error) {
	// Get all swap orders (no auth check; read-only reconciliation).
	orders, err := s.repo.AllSwapOrders(ctx)
	if err != nil {
		return nil, fmt.Errorf("crypto: fetch orders: %w", err)
	}

	report := &ReconciliationReport{
		RunAt:   time.Now().UTC(),
		Orders:  []OrderReconciliationRow{},
	}

	// Categorize each order and check for drift.
	for _, o := range orders {
		report.TotalOrders++

		row := OrderReconciliationRow{
			OrderID:           o.ID,
			UserID:            o.UserID,
			Status:            o.Status,
			LedgerSettled:     o.LedgerSettled,
			SwapTransactionID: o.SwapTransactionID,
			ProviderStatus:    o.ProviderStatus,
			SettledAt:         o.SettledAt,
		}

		// Detect drift.
		drift := detectOrderDrift(&o)
		if drift != "" {
			row.Drift = drift
			report.DriftOrders++
		} else {
			// No drift detected.
			if o.Status == "failed" {
				report.FailedOrders++
			} else if o.Status == "executing" || (o.Status == "completed" && o.LedgerSettled) {
				report.ReconcilledOrders++
			}
		}

		if details {
			report.Orders = append(report.Orders, row)
		}
	}

	// Generate summary.
	report.Summary = fmt.Sprintf(
		"%d total orders: %d reconcilled, %d drift, %d failed",
		report.TotalOrders, report.ReconcilledOrders, report.DriftOrders, report.FailedOrders,
	)

	return report, nil
}

// detectOrderDrift returns a non-empty drift description if the order's
// state is inconsistent. Returns empty string if state is consistent.
func detectOrderDrift(o *SwapOrder) string {
	// Rule 1: Completed orders must be settled.
	if o.Status == "completed" && !o.LedgerSettled {
		return "completed but not ledger_settled (settlement lag)"
	}

	// Rule 2: Failed orders don't need settlement (no money moved).
	// Status "failed" is terminal and valid.

	// Rule 3: Executing orders waiting for webhook (no drift yet).
	// Status "executing" + not settled is expected (webhook pending).

	// Rule 4: If ledger_settled is true, status must be completed or failed.
	if o.LedgerSettled && o.Status != "completed" && o.Status != "failed" {
		return fmt.Sprintf("ledger_settled=true but status=%s (invalid state)", o.Status)
	}

	// Rule 5: Quidax-reported status should match order status.
	// Note: ProviderStatus is the raw Quidax response; normalization is in UpdateSwapOrderStatusFromWebhook.
	// For now, we just track it for audit.

	return "" // No drift detected
}

// AllSwapOrders retrieves all swap orders for reconciliation.
// Used by ReconcileSwapOrders and admin reporting.
func (r *Repository) AllSwapOrders(ctx context.Context) ([]SwapOrder, error) {
	const q = `
		SELECT id, user_id, from_asset_id, from_symbol, to_asset_id, to_symbol,
		       status, from_units, to_units, from_price_kobo, to_price_kobo,
		       cash_kobo, spread_kobo, spread_bps, reference, created_at,
		       quotation_id, swap_transaction_id, provider_status,
		       ledger_settled, settled_at
		FROM crypto_swap_orders
		ORDER BY created_at DESC
	`
	rows, err := r.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var orders []SwapOrder
	for rows.Next() {
		var o SwapOrder
		var settledAt *time.Time
		if err := rows.Scan(
			&o.ID, &o.UserID, &o.FromAssetID, &o.FromSymbol, &o.ToAssetID, &o.ToSymbol,
			&o.Status, &o.FromUnits, &o.ToUnits, &o.FromPriceKobo, &o.ToPriceKobo,
			&o.CashKobo, &o.SpreadKobo, &o.SpreadBps, &o.Reference, &o.CreatedAt,
			&o.QuotationID, &o.SwapTransactionID, &o.ProviderStatus,
			&o.LedgerSettled, &settledAt,
		); err != nil {
			return nil, err
		}
		o.SettledAt = settledAt
		orders = append(orders, o)
	}
	return orders, rows.Err()
}
