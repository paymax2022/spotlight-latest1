package fractionalre

import (
	"context"
	"net/http"

	"github.com/gin-gonic/gin"
)

// Escrow reconciliation (work order 5): a read-only, PermFinance-gated admin
// view comparing, per live offering, the escrowed/allocated subscription total
// (recomputed from source rows) against the offering's raised_kobo projection.
// Any non-zero delta is flagged — projections must always reconcile to source.

// reconcileDelta is the pure integer-kobo comparison (unit-testable, no DB).
func reconcileDelta(raisedKobo, subscribedKobo int64) (deltaKobo int64, mismatch bool) {
	deltaKobo = raisedKobo - subscribedKobo
	return deltaKobo, deltaKobo != 0
}

// Reconciliation returns per-offering rows plus the count of mismatches.
func (s *Service) Reconciliation(ctx context.Context) ([]ReconciliationRow, int, error) {
	rows, err := s.repo.ListReconciliation(ctx)
	if err != nil {
		return nil, 0, err
	}
	mismatches := 0
	for _, r := range rows {
		if r.Mismatch {
			mismatches++
		}
	}
	return rows, mismatches, nil
}

// Reconciliation handles GET /admin/finance/reconciliation (PermFinance).
func (h *AdminHandler) Reconciliation(c *gin.Context) {
	rows, mismatches, err := h.svc.Reconciliation(c.Request.Context())
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"reconciliation": rows, "mismatch_count": mismatches})
}

// GetMarketControls handles GET /admin/market/controls (work order 6) — the
// read companion to the existing PUT.
func (h *AdminHandler) GetMarketControls(c *gin.Context) {
	mc, err := h.svc.GetMarketControls(c.Request.Context())
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, mc)
}
