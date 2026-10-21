package restaurant

// FOOD-UAT-F-002: two-tier dispute-refund approval. A gin middleware mounted AFTER
// the base restaurant.admin.disputes permission on both food-dispute resolve routes
// (the module's own and the shared /api/finance/admin/disputes/:id/resolve). It
// computes the refund the call WOULD pay and, when that exceeds the current
// refund_tier_config threshold, requires restaurant.admin.refund_large. It runs
// before the service so disputes_service.go is untouched.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
)

const (
	// PermRefundLarge is the elevated permission for refunds above the threshold.
	PermRefundLarge = "restaurant.admin.refund_large"
	// DefaultRefundThresholdKobo is NGN 5,000, used only if the config row is unreadable.
	DefaultRefundThresholdKobo int64 = 500000

	maxRefundBodyBytes = 1 << 20
)

// PermissionChecker is satisfied by services.RBACService.
type PermissionChecker interface {
	CheckPermission(userID, permission, scopeType, scopeID string) (bool, error)
}

// RefundThresholdKobo returns the threshold currently in effect.
func (s *Service) RefundThresholdKobo(ctx context.Context) int64 {
	var t int64
	err := s.db.QueryRow(ctx, `
		SELECT threshold_kobo FROM refund_tier_config
		 WHERE effective_from <= now()
		 ORDER BY effective_from DESC, created_at DESC LIMIT 1`).Scan(&t)
	if err != nil {
		return DefaultRefundThresholdKobo
	}
	return t
}

// pendingRefundKobo is the refund the resolve call would pay: the requested amount
// (<=0 means "whatever remains") clamped to the order's remaining refund budget — the
// same cap AdminResolveFoodDispute enforces.
func (s *Service) pendingRefundKobo(ctx context.Context, disputeID string, requested int64) (int64, error) {
	budget, err := s.refundBudgetKobo(ctx, disputeID)
	if err != nil {
		return 0, err
	}
	if budget < 0 {
		budget = 0
	}
	if requested <= 0 || requested > budget {
		return budget, nil
	}
	return requested, nil
}

// RefundApprovalGate returns the middleware. rbac must be non-nil.
func (h *Handler) RefundApprovalGate(rbac PermissionChecker) gin.HandlerFunc {
	return func(c *gin.Context) {
		raw, err := io.ReadAll(io.LimitReader(c.Request.Body, maxRefundBodyBytes))
		if err != nil {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{keyError: "invalid request body"})
			return
		}
		c.Request.Body = io.NopCloser(bytes.NewReader(raw))
		var body struct {
			Resolution string `json:"resolution"`
			RefundKobo int64  `json:"refund_kobo"`
		}
		// A malformed body is the downstream handler's 400 to give.
		if json.Unmarshal(raw, &body) != nil {
			c.Next()
			return
		}
		switch body.Resolution {
		case string(FoodRefundFull), string(FoodRefundPartial), "refunded":
		default:
			c.Next() // not a cash refund
			return
		}
		adminID := ginutil.UserID(c)
		ctx := c.Request.Context()
		disputeID := c.Param("id")

		amount, err := h.svc.pendingRefundKobo(ctx, disputeID, body.RefundKobo)
		if err != nil && errors.Is(err, ErrDisputeInvalid) {
			c.Next() // unknown / non-food dispute: downstream rejects it
			return
		}
		threshold := h.svc.RefundThresholdKobo(ctx)
		// Fail closed: if the amount cannot be determined, demand the elevated permission.
		amountUnknown := err != nil
		elevated := amountUnknown || amount > threshold
		tier := "auto"
		if elevated {
			tier = "elevated"
			ok, perr := rbac.CheckPermission(adminID, PermRefundLarge, "global", "")
			if perr != nil || !ok {
				h.svc.auditRefundDecision(adminID, disputeID, amount, threshold, tier, "denied")
				c.AbortWithStatusJSON(http.StatusForbidden, gin.H{keyError: fmt.Sprintf(
					"refund requires lead approval: it exceeds the %d kobo auto-approve threshold and needs the %s permission",
					threshold, PermRefundLarge)})
				return
			}
		}
		h.svc.auditRefundDecision(adminID, disputeID, amount, threshold, tier, "approved")
		c.Next()
	}
}

func (s *Service) auditRefundDecision(actor, disputeID string, amount, threshold int64, tier, decision string) {
	if s.audit == nil {
		return
	}
	sev := "info"
	if tier == "elevated" {
		sev = "warning"
	}
	s.audit.LogAction(actor, "", "restaurant.refund."+decision, "restaurant", "dispute", disputeID, nil,
		map[string]any{"actor": actor, "amount_kobo": amount, "threshold_kobo": threshold, "tier": tier, "decision": decision},
		"", "", sev)
}
