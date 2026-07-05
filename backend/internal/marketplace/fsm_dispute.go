package marketplace

import "net/http"

// Dispute FSM (§2.3). Explicit guarded transitions only.
//
//	opened          → evidence_window (auto)
//	evidence_window → under_review (evidence_deadline_passed)
//	under_review    → decided (admin decide; dual-approval if amount>₦500k)
//	decided         → executed (ledger tx per §2.2)
//	executed        → closed (auto)
//	closed          → appealed (either party, once, within 7d → back to under_review)
//	appealed        → under_review
//	(no hard terminal — closed can reopen via appeal exactly once)

var disputeTransitions = map[DisputeStatus]map[DisputeStatus]bool{
	DisputeOpened: {
		DisputeEvidenceWindow: true,
	},
	DisputeEvidenceWindow: {
		DisputeUnderReview: true,
	},
	DisputeUnderReview: {
		DisputeDecided: true,
	},
	DisputeDecided: {
		DisputeExecuted: true,
	},
	DisputeExecuted: {
		DisputeClosed: true,
	},
	DisputeClosed: {
		DisputeAppealed: true,
	},
	DisputeAppealed: {
		DisputeUnderReview: true,
	},
}

// canDisputeTransition reports whether from → to is a legal dispute edge.
func canDisputeTransition(from, to DisputeStatus) bool {
	return disputeTransitions[from][to]
}

// guardDisputeTransition returns a typed error when from → to is illegal.
func guardDisputeTransition(from, to DisputeStatus) error {
	if !canDisputeTransition(from, to) {
		return &CodedError{
			Status:  http.StatusConflict,
			Code:    CodeInvalidDisputeTransition,
			Message: "illegal dispute transition " + string(from) + " → " + string(to),
		}
	}
	return nil
}

// disputeDecisionToOrderState maps an admin decision to the resulting order state.
func disputeDecisionToOrderState(decision string) (OrderStatus, bool) {
	switch decision {
	case DecisionRefundBuyer:
		return OrderRefunded, true
	case DecisionReleaseSeller:
		return OrderReleased, true
	case DecisionSplit:
		return OrderSplitSettled, true
	default:
		return "", false
	}
}
