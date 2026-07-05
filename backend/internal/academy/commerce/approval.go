package commerce

import (
	"context"
	"errors"
)

// approval.go — child-safety purchase-approval gate (CLAUDE.md golden rule 8 +
// screens P7). A minor's purchase must be approved by their guardian before the
// money rail is charged / entitlement granted. The gate is INJECTED (nil ⇒ no gate,
// e.g. when the parent layer is disabled), keeping commerce decoupled from the
// parent package. The parent-backed adapter creates a pending PurchaseApproval on
// first attempt; the guardian approves (screens P7), then the minor retries.

// ErrApprovalRequired is returned by a money mutation when the buyer is a minor
// and the order has no approved guardian approval yet.
var ErrApprovalRequired = errors.New("commerce: guardian approval required")

// ApprovalGate authorizes a purchase for a buyer. It returns nil when the purchase
// may proceed (non-minor, or an approved approval exists), ErrApprovalRequired when
// a guardian must approve first (a pending approval is created as a side effect), or
// another error on failure.
type ApprovalGate interface {
	Authorize(ctx context.Context, userID, orderID string) error
}

// WithApprovalGate injects the child-safety gate. Returns the service for chaining.
func (s *Service) WithApprovalGate(g ApprovalGate) *Service {
	s.gate = g
	return s
}

// authorize runs the gate when configured (nil-safe).
func (s *Service) authorize(ctx context.Context, userID, orderID string) error {
	if s.gate == nil {
		return nil
	}
	return s.gate.Authorize(ctx, userID, orderID)
}
